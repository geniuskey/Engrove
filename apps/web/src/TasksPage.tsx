import { Button } from '@engrove/ui';
import {
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useActionDialog } from './ActionDialogProvider.js';
import { allowed, api, ApiError, inputClass, NoticeText, type User } from './App.js';
import { AssigneePicker } from './AssigneePicker.js';
import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuModel,
  menuFromKeyboard,
  menuFromPointer,
} from './ContextMenu.js';
import { FormFieldLabel } from './FormFieldLabel.js';
import { IconAction } from './IconAction.js';
import { useI18n } from './i18n.js';
import { useModalDialog } from './useModalDialog.js';

type Status = string;
type StatusCategory = 'todo' | 'in_progress' | 'done';
type StatusColor = 'slate' | 'sky' | 'violet' | 'amber' | 'rose' | 'emerald';

function isTaskVersionConflict(cause: unknown): cause is ApiError {
  return (
    cause instanceof ApiError &&
    (cause.code === 'TASK_VERSION_CONFLICT' ||
      cause.code === 'TASK_BULK_VERSION_CONFLICT' ||
      cause.code === 'TASK_WORKLOG_VERSION_CONFLICT')
  );
}
interface WorkflowStatus {
  id: string;
  key: Status;
  name: string;
  category: StatusCategory;
  color: StatusColor;
  position: number;
  wip_limit: number | null;
  initial: boolean;
  row_version: number;
  task_count: number;
}
interface WorkflowTransition {
  id: string;
  name: string;
  from_status: Status;
  to_status: Status;
}
interface TaskWorkflow {
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
}
interface TaskFlowInsights {
  calculated_at: string;
  window_days: number;
  stale_after_days: number;
  summary: {
    active_count: number;
    wip_count: number;
    stale_count: number;
    completed_count: number;
    average_cycle_hours: number | null;
    median_cycle_hours: number | null;
    p85_cycle_hours: number | null;
  };
  statuses: Array<{
    key: Status;
    name: string;
    category: StatusCategory;
    color: StatusColor;
    position: number;
    current_count: number;
    wip_limit: number | null;
    average_age_hours: number | null;
    oldest_age_hours: number | null;
    stale_count: number;
  }>;
  flow_statuses: Array<{
    key: Status;
    name: string;
    color: StatusColor;
    position: number;
    archived: boolean;
  }>;
  flow_series: Array<{
    date: string;
    counts: Record<Status, number>;
  }>;
  throughput_series: Array<{
    date: string;
    created_count: number;
    completed_count: number;
  }>;
  aging_tasks: Array<{
    id: string;
    task_key: string;
    title: string;
    status: Status;
    status_name: string;
    assignee_name: string | null;
    age_hours: number;
  }>;
  completed_tasks: Array<{
    id: string;
    task_key: string;
    title: string;
    completed_at: string;
    cycle_time_hours: number;
  }>;
}
interface TaskLink {
  id: string;
  entity_type: string;
  entity_id: string;
  created_at?: string;
  title?: string | null;
  detail?: string | null;
  object_type_public_id?: string | null;
  provider?: string | null;
  url?: string | null;
  external_id?: string | null;
  version?: string | null;
  observed_on?: string | null;
  archived_at?: string | null;
  original_name?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  file_series_name?: string | null;
  file_version_number?: number | null;
  file_status?: string | null;
}
interface Task {
  id: string;
  task_number?: number;
  task_key?: string;
  title: string;
  description: string;
  status: Status;
  priority: 'low' | 'medium' | 'high' | 'critical';
  visibility?: 'project' | 'restricted';
  labels?: string[];
  parent_task_id?: string | null;
  parent_task_key?: string | null;
  parent_task_title?: string | null;
  child_count?: number;
  child_done_count?: number;
  board_position: number;
  assignee_id: string | null;
  assignee_name: string | null;
  due_date: string | null;
  original_estimate_minutes?: number | null;
  remaining_estimate_minutes?: number | null;
  time_spent_minutes?: number;
  row_version: number;
  archived_at: string | null;
  created_by_name?: string;
  created_at?: string;
  updated_at?: string;
  open_blocker_count?: number;
  links: TaskLink[];
}
interface TaskStatusHistory {
  id: string;
  from_status: Status | null;
  to_status: Status;
  changed_at: string;
  changed_by_name: string;
}
interface TaskDetail extends Task {
  status_history: TaskStatusHistory[];
  change_history: TaskChangeHistory[];
  watchers: Array<{ user_id: string; display_name: string }>;
  watcher_count: number;
  watching: boolean;
  comments: TaskComment[];
  relationships: TaskRelationship[];
  link_history: TaskLinkHistory[];
  children?: TaskChild[];
  linked_key_dates?: TaskKeyDate[];
  activity_page_info?: PageInfo;
  worklogs?: TaskWorklog[];
  worklog_page_info?: PageInfo;
}
interface TaskWorklog {
  id: string;
  duration_minutes: number;
  started_at: string;
  note: string;
  author_id: string;
  author_name: string;
  remaining_estimate_before: number | null;
  remaining_estimate_after: number | null;
  row_version: number;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
}
interface TaskWorklogPage {
  items: TaskWorklog[];
  pageInfo: PageInfo;
}
interface PageInfo {
  limit: number;
  offset: number;
  total: number;
  hasNext: boolean;
}
interface TaskActivityPage {
  status_history: TaskStatusHistory[];
  change_history: TaskChangeHistory[];
  link_history: TaskLinkHistory[];
  comments: TaskComment[];
  pageInfo: PageInfo;
}
interface TaskKeyDate {
  id: string;
  title: string;
  status: 'planned' | 'active' | 'at_risk' | 'completed';
  target_date: string;
  archived_at: string | null;
}
interface TaskChild {
  id: string;
  task_key: string;
  title: string;
  status: Status;
  status_category: StatusCategory;
  assignee_id: string | null;
  assignee_name: string | null;
  due_date: string | null;
  archived_at: string | null;
}
interface TaskLinkHistory {
  id: string;
  action: 'task.link_added' | 'task.link_removed';
  changed_by_name: string;
  changed_at: string;
  link_id: string;
  entity_type: string;
  entity_id: string;
  title: string | null;
  url: string | null;
}
interface TaskChangeHistory {
  id: string;
  action: 'task.updated' | 'task.automated';
  changed_by_name: string;
  changed_at: string;
  automation_rule_name: string | null;
  changes: Array<{
    field:
      | 'title'
      | 'description'
      | 'priority'
      | 'assigneeId'
      | 'dueDate'
      | 'labels'
      | 'parentTaskId'
      | 'originalEstimateMinutes'
      | 'remainingEstimateMinutes';
    from: string | null;
    to: string | null;
    changed: boolean;
  }>;
}
interface TaskComment {
  id: string;
  body: string;
  author_id: string;
  author_name: string;
  mentions: Array<{ id: string; displayName: string }>;
  row_version: number;
  revisions: Array<{
    revision: number;
    body: string;
    mentions: Array<{ id: string; displayName: string }>;
    edited_by_name: string;
    edited_at: string;
  }>;
  revision_count: number;
  edited_at: string | null;
  created_at: string;
}
interface TaskRelationship {
  id: string;
  relation_type: 'blocks' | 'relates_to';
  direction: 'outward' | 'inward';
  related_task_id: string;
  related_task_key?: string;
  related_task_title: string;
  related_task_status: Status;
  related_task_archived_at: string | null;
  created_at: string;
}
interface TaskAssignee {
  id: string;
  displayName: string;
  email: string;
}
interface TaskVisibilityGroup {
  id: string;
  name: string;
  color: string;
}
interface TaskVisibilityPolicy {
  visibility: 'project' | 'restricted';
  rowVersion: number;
  members: TaskAssignee[];
  groups: TaskVisibilityGroup[];
}
interface TaskPageInfo {
  limit: number;
  offset: number;
  total: number;
  hasNext: boolean;
}
interface TaskCandidate {
  id: string;
  task_key: string;
  title: string;
  parent_task_id: string | null;
  child_count: number;
}
interface SavedTaskFilter {
  id: string;
  owner_id: string;
  owner_name: string;
  name: string;
  visibility: 'personal' | 'project';
  favorite: boolean;
  is_owner: boolean;
  config: {
    query: string;
    assignee: string;
    priority: 'all' | Task['priority'];
    statuses?: string[];
    labels?: string[];
    view: TaskView;
    sort?: TaskSort;
    direction?: TaskSortDirection;
    group?: TaskGroup;
    listColumns?: TaskListColumn[];
  };
}

function TaskCandidatePicker({
  base,
  disabled = false,
  excludeId,
  label,
  name,
  onChange,
  topLevelOnly = false,
  value,
}: {
  base: string;
  disabled?: boolean;
  excludeId?: string;
  label: string;
  name?: string;
  onChange: (candidate: TaskCandidate | null) => void;
  topLevelOnly?: boolean;
  value: TaskCandidate | null;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TaskCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const requestId = useRef(0);
  useEffect(() => {
    const search = query.trim();
    const request = ++requestId.current;
    if (value || search.length < 2) {
      setResults([]);
      setHasMore(false);
      setLoading(false);
      return;
    }
    const timeout = window.setTimeout(() => {
      const parameters = new URLSearchParams({ query: search, limit: '20' });
      if (topLevelOnly) parameters.set('topLevelOnly', 'true');
      setLoading(true);
      void api<{ items: TaskCandidate[]; pageInfo: TaskPageInfo }>(
        `${base}/task-candidates?${parameters}`,
      )
        .then(
          (page) => {
            if (request !== requestId.current) return;
            setResults(page.items.filter((candidate) => candidate.id !== excludeId));
            setHasMore(page.pageInfo.hasNext);
          },
          () => {
            if (request !== requestId.current) return;
            setResults([]);
            setHasMore(false);
          },
        )
        .finally(() => {
          if (request === requestId.current) setLoading(false);
        });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [base, excludeId, query, topLevelOnly, value]);

  return (
    <div className="grid gap-1">
      {name && <input name={name} type="hidden" value={value?.id ?? ''} />}
      {value ? (
        <div className="flex min-h-10 items-center gap-2 rounded-md border border-slate-700 bg-slate-950 px-2">
          <span className="min-w-0 flex-1 truncate text-xs text-slate-300">
            <span className="mr-1.5 font-mono text-[9px] text-sky-400">{value.task_key}</span>
            {value.title}
          </span>
          <button
            aria-label={t('tasks.clearTaskSelection', { title: value.title })}
            className="grid size-7 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-800 hover:text-slate-200"
            disabled={disabled}
            onClick={() => {
              onChange(null);
              setQuery('');
            }}
            title={t('tasks.clearTaskSelection', { title: value.title })}
            type="button"
          >
            ×
          </button>
        </div>
      ) : (
        <>
          <input
            aria-label={t('tasks.searchCandidate', { label })}
            className={inputClass}
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('tasks.candidateSearchPlaceholder')}
            type="search"
            value={query}
          />
          {query.trim().length < 2 ? (
            <span className="text-[10px] text-slate-600">{t('tasks.candidateSearchHint')}</span>
          ) : loading ? (
            <span className="text-[10px] text-slate-600">{t('common.loading')}</span>
          ) : (
            <div className="max-h-48 overflow-y-auto rounded-md border border-slate-800 bg-slate-950">
              {results.map((candidate) => (
                <button
                  className="block w-full border-b border-slate-800 px-2 py-2 text-left text-xs text-slate-300 last:border-0 hover:bg-slate-900"
                  key={candidate.id}
                  onClick={() => {
                    onChange(candidate);
                    setQuery('');
                  }}
                  type="button"
                >
                  <span className="mr-1.5 font-mono text-[9px] text-sky-400">
                    {candidate.task_key}
                  </span>
                  {candidate.title}
                </button>
              ))}
              {results.length === 0 && (
                <p className="px-2 py-2 text-[10px] text-slate-600">
                  {t('tasks.noCandidateResults')}
                </p>
              )}
              {hasMore && (
                <p className="px-2 py-1.5 text-[9px] text-amber-300">
                  {t('tasks.refineCandidateSearch')}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

type TaskView = 'board' | 'list' | 'calendar';
type TaskSort = 'rank' | 'title' | 'status' | 'priority' | 'assignee' | 'dueDate';
type TaskSortDirection = 'asc' | 'desc';
type TaskGroup = 'none' | 'status' | 'priority' | 'assignee';
type TaskListColumn = Exclude<TaskSort, 'rank'>;
type TaskActivityFilter = 'all' | 'comments' | 'history';
type TaskActivitySort = 'newest' | 'oldest';

function MentionButtons({
  assignees,
  currentUserId,
  selectedIds,
  onToggle,
  title,
}: {
  assignees: TaskAssignee[];
  currentUserId: string;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  title: (name: string) => string;
}) {
  return assignees
    .filter((assignee) => assignee.id !== currentUserId)
    .map((assignee) => {
      const selected = selectedIds.has(assignee.id);
      return (
        <button
          aria-pressed={selected}
          className={`rounded-full border px-2 py-1 text-[10px] ${selected ? 'border-sky-400/40 bg-sky-400/10 text-sky-300' : 'border-slate-700 text-slate-500 hover:text-slate-300'}`}
          key={assignee.id}
          onClick={() => onToggle(assignee.id)}
          title={title(assignee.displayName)}
          type="button"
        >
          @{assignee.displayName}
        </button>
      );
    });
}

function sortSavedFilters(filters: SavedTaskFilter[]): SavedTaskFilter[] {
  return [...filters].sort(
    (left, right) =>
      Number(Boolean(right.favorite)) - Number(Boolean(left.favorite)) ||
      left.name.localeCompare(right.name),
  );
}

function mergeSavedFilters(
  current: SavedTaskFilter[],
  incoming: SavedTaskFilter[],
): SavedTaskFilter[] {
  const byId = new Map(current.map((filter) => [filter.id, filter]));
  for (const filter of incoming) byId.set(filter.id, filter);
  return sortSavedFilters([...byId.values()]);
}

function parseTaskLabels(value: FormDataEntryValue | null): string[] {
  return [
    ...new Set(
      String(value ?? '')
        .normalize('NFKC')
        .split(/[\s,]+/)
        .map((label) => label.trim().toLocaleLowerCase('en-US'))
        .filter(Boolean),
    ),
  ];
}

function placeTaskBefore(
  tasks: Task[],
  taskId: string,
  status: Status,
  beforeTaskId?: string,
): Task[] {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) return tasks;
  const remaining = tasks.filter((candidate) => candidate.id !== taskId);
  const moved = { ...task, status };
  const targetIndex = beforeTaskId
    ? remaining.findIndex((candidate) => candidate.id === beforeTaskId)
    : -1;
  if (targetIndex < 0) return [...remaining, moved];
  return [...remaining.slice(0, targetIndex), moved, ...remaining.slice(targetIndex)];
}

const columnAccent: Record<StatusColor, string> = {
  slate: 'border-t-slate-500',
  sky: 'border-t-sky-400',
  violet: 'border-t-violet-400',
  amber: 'border-t-amber-400',
  rose: 'border-t-rose-400',
  emerald: 'border-t-emerald-400',
};

const defaultWorkflow: TaskWorkflow = {
  statuses: [
    {
      id: 'todo',
      key: 'todo',
      name: 'To do',
      category: 'todo',
      color: 'slate',
      position: 0,
      wip_limit: null,
      initial: true,
      row_version: 1,
      task_count: 0,
    },
    {
      id: 'in_progress',
      key: 'in_progress',
      name: 'In progress',
      category: 'in_progress',
      color: 'sky',
      position: 1,
      wip_limit: null,
      initial: false,
      row_version: 1,
      task_count: 0,
    },
    {
      id: 'blocked',
      key: 'blocked',
      name: 'Blocked',
      category: 'in_progress',
      color: 'rose',
      position: 2,
      wip_limit: null,
      initial: false,
      row_version: 1,
      task_count: 0,
    },
    {
      id: 'done',
      key: 'done',
      name: 'Done',
      category: 'done',
      color: 'emerald',
      position: 3,
      wip_limit: null,
      initial: false,
      row_version: 1,
      task_count: 0,
    },
  ],
  transitions: ['todo', 'in_progress', 'blocked', 'done'].flatMap((from) =>
    ['todo', 'in_progress', 'blocked', 'done']
      .filter((to) => to !== from)
      .map((to) => ({
        id: `${from}:${to}`,
        name: `Move to ${to}`,
        from_status: from,
        to_status: to,
      })),
  ),
};

const priorityStyle: Record<Task['priority'], string> = {
  low: 'bg-slate-500/10 text-slate-300',
  medium: 'bg-sky-500/10 text-sky-300',
  high: 'bg-amber-500/10 text-amber-300',
  critical: 'bg-rose-500/10 text-rose-300',
};
const statusDotStyle: Record<StatusColor, string> = {
  slate: 'bg-slate-400',
  sky: 'bg-sky-400',
  violet: 'bg-violet-400',
  amber: 'bg-amber-400',
  rose: 'bg-rose-400',
  emerald: 'bg-emerald-400',
};
const flowStatusFill: Record<StatusColor, string> = {
  slate: '#94a3b8',
  sky: '#38bdf8',
  violet: '#a78bfa',
  amber: '#fbbf24',
  rose: '#fb7185',
  emerald: '#34d399',
};
const taskFormLabelClass = 'grid gap-1 text-xs text-slate-400';
const defaultTaskListColumns: TaskListColumn[] = [
  'title',
  'status',
  'priority',
  'assignee',
  'dueDate',
];
const taskListColumnWidths: Record<TaskListColumn, string> = {
  title: 'minmax(20rem,1fr)',
  status: '8rem',
  priority: '6rem',
  assignee: '9rem',
  dueDate: '7rem',
};
const activityTimestampOptions: Intl.DateTimeFormatOptions = {
  dateStyle: 'short',
  timeStyle: 'short',
};
const taskBoardPageSize = 50;
const taskListPageSize = 100;
const savedFilterPageSize = 50;
const maxTaskAttachmentBytes = 100 * 1024 * 1024;
const maxTaskEstimateMinutes = 5_256_000;

function parseTaskDuration(value: FormDataEntryValue | string | null): number | null | undefined {
  const normalized = String(value ?? '')
    .trim()
    .toLocaleLowerCase('en-US');
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) {
    const minutes = Number(normalized);
    return minutes <= maxTaskEstimateMinutes ? minutes : undefined;
  }
  const units: Record<string, number> = { w: 5 * 8 * 60, d: 8 * 60, h: 60, m: 1 };
  let minutes = 0;
  let matched = '';
  for (const token of normalized.matchAll(/(\d+)\s*([wdhm])/g)) {
    minutes += Number(token[1]) * units[token[2]!]!;
    matched += token[0];
  }
  const compactInput = normalized.replace(/\s+/g, '');
  const compactMatched = matched.replace(/\s+/g, '');
  return compactInput === compactMatched && minutes <= maxTaskEstimateMinutes ? minutes : undefined;
}

function formatTaskDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const units = [
    ['w', 5 * 8 * 60],
    ['d', 8 * 60],
    ['h', 60],
    ['m', 1],
  ] as const;
  let remaining = minutes;
  const parts: string[] = [];
  for (const [label, size] of units) {
    const value = Math.floor(remaining / size);
    if (value) parts.push(`${value}${label}`);
    remaining %= size;
  }
  return parts.join(' ') || '0m';
}

function localDateTimeInput(value = new Date()): string {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatFileSize(bytes: number, locale: string) {
  if (bytes < 1_024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1_024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && value >= 1_024; index += 1) {
    value /= 1_024;
    unit = units[index]!;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${unit}`;
}

async function fileSha256(contents: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', contents)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeTaskListColumns(columns?: TaskListColumn[]): TaskListColumn[] {
  if (!columns?.length) return [...defaultTaskListColumns];
  const allowedColumns = new Set<TaskListColumn>(defaultTaskListColumns);
  const unique = columns.filter(
    (column, index) => allowedColumns.has(column) && columns.indexOf(column) === index,
  );
  return ['title', ...unique.filter((column) => column !== 'title')];
}

function flowDuration(hours: number | null, locale: string, t: ReturnType<typeof useI18n>['t']) {
  if (hours === null || !Number.isFinite(hours)) return '—';
  if (hours < 24)
    return t('tasks.flowHours', {
      count: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(hours),
    });
  return t('tasks.flowDays', {
    count: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(hours / 24),
  });
}

function cumulativeFlowLayers(insights: TaskFlowInsights) {
  const series = insights.flow_series;
  const statuses = [...insights.flow_statuses].sort(
    (left, right) => left.position - right.position || left.key.localeCompare(right.key),
  );
  const maximum = Math.max(
    1,
    ...series.map((point) =>
      statuses.reduce((total, status) => total + (point.counts[status.key] ?? 0), 0),
    ),
  );
  let lower = series.map(() => 0);
  const x = (index: number) => (series.length <= 1 ? 50 : (index / (series.length - 1)) * 100);
  const y = (value: number) => 40 - (value / maximum) * 40;

  return statuses.map((status) => {
    const base = [...lower];
    const upper = series.map((point, index) => base[index]! + (point.counts[status.key] ?? 0));
    const upperPoints = upper.map((value, index) => `${x(index)},${y(value)}`).join(' L ');
    const lowerPoints = base
      .map((value, index) => `${x(index)},${y(value)}`)
      .reverse()
      .join(' L ');
    lower = upper;
    return {
      ...status,
      currentCount: series.at(-1)?.counts[status.key] ?? 0,
      path: series.length ? `M ${upperPoints} L ${lowerPoints} Z` : '',
    };
  });
}

function throughputChart(insights: TaskFlowInsights) {
  const series = insights.throughput_series;
  const maximum = Math.max(
    1,
    ...series.flatMap((point) => [point.created_count, point.completed_count]),
  );
  const x = (index: number) => (series.length <= 1 ? 50 : (index / (series.length - 1)) * 100);
  const y = (value: number) => 38 - (value / maximum) * 34;
  const points = (field: 'created_count' | 'completed_count') =>
    series.map((point, index) => `${x(index)},${y(point[field])}`).join(' ');
  const created = series.reduce((total, point) => total + point.created_count, 0);
  const completed = series.reduce((total, point) => total + point.completed_count, 0);
  return {
    completed,
    completedPoints: points('completed_count'),
    created,
    createdPoints: points('created_count'),
    net: created - completed,
  };
}

export function TasksPage({ user }: { user: User }) {
  const { formatDate, locale, t } = useI18n();
  const { confirmAction } = useActionDialog();
  const savedFilterSearchFailedMessage = t('tasks.filterSearchFailed');
  const savedFilterRestoreFailedMessage = t('tasks.filterRestoreFailed');
  const { workspaceId, projectId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskPageInfo, setTaskPageInfo] = useState<TaskPageInfo>({
    limit: taskListPageSize,
    offset: 0,
    total: 0,
    hasNext: false,
  });
  const [boardPageInfo, setBoardPageInfo] = useState<Record<string, TaskPageInfo>>({});
  const [loadingMoreKey, setLoadingMoreKey] = useState('');
  const [archivedPageInfo, setArchivedPageInfo] = useState<TaskPageInfo>({
    limit: 100,
    offset: 0,
    total: 0,
    hasNext: false,
  });
  const [workflow, setWorkflow] = useState<TaskWorkflow>(defaultWorkflow);
  const [view, setView] = useState<TaskView>('board');
  const [flowInsightsOpen, setFlowInsightsOpen] = useState(false);
  const [flowInsights, setFlowInsights] = useState<TaskFlowInsights>();
  const [flowInsightsLoading, setFlowInsightsLoading] = useState(false);
  const [flowInsightsError, setFlowInsightsError] = useState('');
  const [flowWindowDays, setFlowWindowDays] = useState(30);
  const flowLayers = useMemo(
    () => (flowInsights ? cumulativeFlowLayers(flowInsights) : []),
    [flowInsights],
  );
  const throughput = useMemo(
    () => (flowInsights ? throughputChart(flowInsights) : undefined),
    [flowInsights],
  );
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [creatorDirty, setCreatorDirty] = useState(false);
  const [creatorSource, setCreatorSource] = useState<Task>();
  const [contextMenu, setContextMenu] = useState<ContextMenuModel>();
  const [draggingTaskId, setDraggingTaskId] = useState('');
  const [dragOverStatus, setDragOverStatus] = useState<Status>();
  const [dragBeforeTaskId, setDragBeforeTaskId] = useState('');
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(() => new Set());
  const [boardAnnouncement, setBoardAnnouncement] = useState('');
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [assigneesLoading, setAssigneesLoading] = useState(false);
  const [assigneesLoadError, setAssigneesLoadError] = useState('');
  const [taskQuery, setTaskQuery] = useState('');
  const [taskQueryRequest, setTaskQueryRequest] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [labelFilter, setLabelFilter] = useState('all');
  const [taskSort, setTaskSort] = useState<TaskSort>('rank');
  const [taskSortDirection, setTaskSortDirection] = useState<TaskSortDirection>('asc');
  const [taskGroup, setTaskGroup] = useState<TaskGroup>('none');
  const [collapsedTaskGroups, setCollapsedTaskGroups] = useState<Set<string>>(() => new Set());
  const [taskListColumns, setTaskListColumns] = useState<TaskListColumn[]>(() => [
    ...defaultTaskListColumns,
  ]);
  const [columnEditorOpen, setColumnEditorOpen] = useState(false);
  const columnEditorRef = useRef<HTMLDivElement>(null);
  const [taskLabels, setTaskLabels] = useState<Array<{ value: string; count: number }>>([]);
  const [createParentCandidate, setCreateParentCandidate] = useState<TaskCandidate | null>(null);
  const [savedFilters, setSavedFilters] = useState<SavedTaskFilter[]>([]);
  const [savedFilterResults, setSavedFilterResults] = useState<SavedTaskFilter[]>([]);
  const [savedFilterPageInfo, setSavedFilterPageInfo] = useState<PageInfo>({
    limit: savedFilterPageSize,
    offset: 0,
    total: 0,
    hasNext: false,
  });
  const [savedFilterPickerOpen, setSavedFilterPickerOpen] = useState(false);
  const [savedFilterQuery, setSavedFilterQuery] = useState('');
  const [savedFilterLoading, setSavedFilterLoading] = useState<'page' | 'more' | ''>('');
  const [savedFilterLoadError, setSavedFilterLoadError] = useState('');
  const savedFilterPickerRef = useRef<HTMLDivElement>(null);
  const savedFilterRequestId = useRef(0);
  const savedFilterRestoreRequestId = useRef(0);
  const savedFilterUrlWriteRef = useRef('');
  const [selectedFilterId, setSelectedFilterId] = useState('');
  const [filterEditorOpen, setFilterEditorOpen] = useState(false);
  const [savedFilterName, setSavedFilterName] = useState('');
  const [savedFilterVisibility, setSavedFilterVisibility] = useState<'personal' | 'project'>(
    'personal',
  );
  const [filterSaving, setFilterSaving] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const selectionAnchorTaskId = useRef('');
  const [bulkStatus, setBulkStatus] = useState<'unchanged' | Status>('unchanged');
  const [bulkPriority, setBulkPriority] = useState<'unchanged' | Task['priority']>('unchanged');
  const [bulkAssignee, setBulkAssignee] = useState('unchanged');
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const selectedTaskId = searchParams.get('task') ?? '';
  const selectedFilterIdFromUrl = searchParams.get('filter') ?? '';
  const setSelectedTaskId = useCallback(
    (taskId: string) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (taskId) next.set('task', taskId);
          else next.delete('task');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const setSavedFilterSelection = useCallback(
    (filterId: string) => {
      if (filterId === selectedFilterIdFromUrl) {
        setSelectedFilterId(filterId);
        return;
      }
      savedFilterUrlWriteRef.current = filterId;
      setSelectedFilterId(filterId);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (filterId) next.set('filter', filterId);
          else next.delete('filter');
          return next;
        },
        { replace: true },
      );
    },
    [selectedFilterIdFromUrl, setSearchParams],
  );
  const applySavedFilterConfig = useCallback((filter: SavedTaskFilter) => {
    setSelectedFilterId(filter.id);
    setTaskQuery(filter.config.query);
    setAssigneeFilter(filter.config.assignee);
    setPriorityFilter(filter.config.priority);
    setStatusFilters(filter.config.statuses ?? []);
    setLabelFilter(filter.config.labels?.[0] ?? 'all');
    setView(filter.config.view);
    setTaskSort(filter.config.sort ?? 'rank');
    setTaskSortDirection(filter.config.direction ?? 'asc');
    setTaskGroup(filter.config.group ?? 'none');
    setTaskListColumns(normalizeTaskListColumns(filter.config.listColumns));
    setCollapsedTaskGroups(new Set());
    setColumnEditorOpen(false);
    setSelectionMode(false);
    setSelectedTaskIds(new Set());
  }, []);
  const [taskDetail, setTaskDetail] = useState<TaskDetail>();
  const [visibilityEditorOpen, setVisibilityEditorOpen] = useState(false);
  const [visibilityPolicy, setVisibilityPolicy] = useState<TaskVisibilityPolicy>();
  const [visibilityGroups, setVisibilityGroups] = useState<TaskVisibilityGroup[]>([]);
  const [visibilityLoading, setVisibilityLoading] = useState(false);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [visibilityError, setVisibilityError] = useState('');
  const [taskDetailConflict, setTaskDetailConflict] = useState<TaskDetail>();
  const [taskDetailDirtyFields, setTaskDetailDirtyFields] = useState<Set<string>>(() => new Set());
  const taskDetailDirty = taskDetailDirtyFields.size > 0;
  const markTaskDetailField = useCallback((field: string, changed: boolean) => {
    setTaskDetailDirtyFields((current) => {
      if (current.has(field) === changed) return current;
      const next = new Set(current);
      if (changed) next.add(field);
      else next.delete(field);
      return next;
    });
  }, []);
  const [detailParentCandidate, setDetailParentCandidate] = useState<TaskCandidate | null>(null);
  const applyTaskDetail = useCallback(
    (detail: TaskDetail) => {
      setTaskDetail(detail);
      setDetailParentCandidate(
        detail.parent_task_id
          ? {
              id: detail.parent_task_id,
              task_key: detail.parent_task_key ?? detail.parent_task_id,
              title: detail.parent_task_title ?? t('tasks.unknownParent'),
              parent_task_id: null,
              child_count: 0,
            }
          : null,
      );
    },
    [t],
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);
  const [watchSaving, setWatchSaving] = useState(false);
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentWatch, setCommentWatch] = useState(true);
  const [editingCommentId, setEditingCommentId] = useState('');
  const [editingCommentText, setEditingCommentText] = useState('');
  const [editingCommentMentions, setEditingCommentMentions] = useState<Set<string>>(
    () => new Set(),
  );
  const [commentEditSaving, setCommentEditSaving] = useState(false);
  const [commentHistoryOpenId, setCommentHistoryOpenId] = useState('');
  const [commentHistoryLoadingId, setCommentHistoryLoadingId] = useState('');
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityFilter, setActivityFilter] = useState<TaskActivityFilter>('all');
  const [activitySort, setActivitySort] = useState<TaskActivitySort>('newest');
  const [worklogSaving, setWorklogSaving] = useState(false);
  const [worklogLoading, setWorklogLoading] = useState(false);
  const [worklogDuration, setWorklogDuration] = useState('');
  const [worklogStartedAt, setWorklogStartedAt] = useState(() => localDateTimeInput());
  const [worklogNote, setWorklogNote] = useState('');
  const [worklogRemainingMode, setWorklogRemainingMode] = useState<'auto' | 'set' | 'unchanged'>(
    'auto',
  );
  const [worklogRemaining, setWorklogRemaining] = useState('');
  const [editingWorklogId, setEditingWorklogId] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentDragging, setAttachmentDragging] = useState(false);
  const [attachmentDownloadingId, setAttachmentDownloadingId] = useState('');
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [externalLinkTitle, setExternalLinkTitle] = useState('');
  const [externalLinkUrl, setExternalLinkUrl] = useState('');
  const [mentionedUserIds, setMentionedUserIds] = useState<Set<string>>(() => new Set());
  const [relationshipSaving, setRelationshipSaving] = useState(false);
  const [relationshipType, setRelationshipType] = useState<'blocks' | 'blocked_by' | 'relates_to'>(
    'blocked_by',
  );
  const [relatedTaskCandidate, setRelatedTaskCandidate] = useState<TaskCandidate | null>(null);
  const autoWatchCommentedRef = useRef(true);
  const taskActivity = useMemo<
    Array<
      | { kind: 'status'; at: string; item: TaskStatusHistory }
      | { kind: 'change'; at: string; item: TaskChangeHistory }
      | { kind: 'link'; at: string; item: TaskLinkHistory }
      | { kind: 'comment'; at: string; item: TaskComment }
    >
  >(
    () =>
      [
        ...(taskDetail?.status_history ?? []).map((item) => ({
          kind: 'status' as const,
          at: item.changed_at,
          item,
        })),
        ...(taskDetail?.change_history ?? []).map((item) => ({
          kind: 'change' as const,
          at: item.changed_at,
          item,
        })),
        ...(taskDetail?.link_history ?? []).map((item) => ({
          kind: 'link' as const,
          at: item.changed_at,
          item,
        })),
        ...(taskDetail?.comments ?? []).map((item) => ({
          kind: 'comment' as const,
          at: item.edited_at ?? item.created_at,
          item,
        })),
      ].sort((left, right) => left.at.localeCompare(right.at)),
    [taskDetail],
  );
  const visibleTaskActivity = useMemo(() => {
    const filtered = taskActivity.filter((activity) => {
      if (activityFilter === 'comments') return activity.kind === 'comment';
      if (activityFilter === 'history') return activity.kind !== 'comment';
      return true;
    });
    return activitySort === 'newest' ? [...filtered].reverse() : filtered;
  }, [activityFilter, activitySort, taskActivity]);
  const detailRequestId = useRef(0);
  const listRequestId = useRef(0);
  const loadedListScope = useRef('');
  const createRequestRef = useRef<{ body: string; idempotencyKey: string } | undefined>(undefined);
  const creatorFormRef = useRef<HTMLFormElement>(null);
  const taskDetailHasDraft =
    taskDetailDirty ||
    Boolean(commentText.trim()) ||
    mentionedUserIds.size > 0 ||
    Boolean(editingCommentId) ||
    Boolean(externalLinkTitle.trim()) ||
    Boolean(externalLinkUrl.trim()) ||
    Boolean(relatedTaskCandidate) ||
    Boolean(worklogDuration.trim()) ||
    Boolean(worklogNote.trim()) ||
    Boolean(worklogRemaining.trim()) ||
    worklogRemainingMode !== 'auto' ||
    Boolean(editingWorklogId);
  const taskDetailOperationPending =
    detailSaving ||
    commentSaving ||
    commentEditSaving ||
    linkSaving ||
    attachmentUploading ||
    relationshipSaving ||
    worklogSaving;
  const closeCreator = useCallback(() => {
    createRequestRef.current = undefined;
    setCreatorDirty(false);
    setCreatorOpen(false);
    setCreatorSource(undefined);
    setCreateParentCandidate(null);
  }, []);
  const dismissCreator = useCallback(() => {
    if (busy) return;
    if (creatorDirty) {
      void confirmAction(t('tasks.discardCreatorConfirm')).then((confirmed) => {
        if (confirmed) closeCreator();
      });
      return;
    }
    closeCreator();
  }, [busy, closeCreator, confirmAction, creatorDirty, t]);
  const confirmDiscardTaskDetail = useCallback(
    async () => !taskDetailHasDraft || (await confirmAction(t('tasks.discardDetailConfirm'))),
    [confirmAction, taskDetailHasDraft, t],
  );
  const dismissTaskDetail = useCallback(() => {
    if (taskDetailOperationPending) return;
    const close = () => {
      setTaskDetailDirtyFields(new Set());
      setSelectedTaskId('');
    };
    if (taskDetailHasDraft) {
      void confirmAction(t('tasks.discardDetailConfirm')).then((confirmed) => {
        if (confirmed) close();
      });
      return;
    }
    close();
  }, [confirmAction, setSelectedTaskId, t, taskDetailHasDraft, taskDetailOperationPending]);
  const selectTaskDetail = useCallback(
    (taskId: string) => {
      if (taskId === selectedTaskId) return;
      if (taskDetailOperationPending) return;
      const select = () => {
        setTaskDetailDirtyFields(new Set());
        setSelectedTaskId(taskId);
      };
      if (taskDetailHasDraft) {
        void confirmAction(t('tasks.discardDetailConfirm')).then((confirmed) => {
          if (confirmed) select();
        });
        return;
      }
      select();
    },
    [
      confirmAction,
      selectedTaskId,
      setSelectedTaskId,
      t,
      taskDetailHasDraft,
      taskDetailOperationPending,
    ],
  );
  const leaveTaskDetailForPath = useCallback(
    async (path: string) => {
      if (taskDetailOperationPending || !(await confirmDiscardTaskDetail())) return;
      setTaskDetailDirtyFields(new Set());
      void navigate(path);
    },
    [confirmDiscardTaskDetail, navigate, taskDetailOperationPending],
  );
  const creatorDialogRef = useModalDialog<HTMLDivElement>(creatorOpen, () => {
    dismissCreator();
  });
  const taskDetailDialogRef = useModalDialog<HTMLElement>(Boolean(selectedTaskId), () => {
    dismissTaskDetail();
  });
  useEffect(() => {
    if (!creatorDirty && !taskDetailHasDraft) return;
    const preserveDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preserveDraft);
    return () => window.removeEventListener('beforeunload', preserveDraft);
  }, [creatorDirty, taskDetailHasDraft]);
  const defaultStatusLabel = useCallback(
    (status: WorkflowStatus) => {
      if (status.key === 'todo' && status.name === 'To do') return t('tasks.todo');
      if (status.key === 'in_progress' && status.name === 'In progress')
        return t('tasks.inProgress');
      if (status.key === 'blocked' && status.name === 'Blocked') return t('tasks.blocked');
      if (status.key === 'done' && status.name === 'Done') return t('tasks.done');
      return status.name;
    },
    [t],
  );
  const columns = useMemo(
    () =>
      workflow.statuses.map((status) => ({
        status: status.key,
        label: defaultStatusLabel(status),
        color: status.color,
        wipLimit: status.wip_limit,
      })),
    [defaultStatusLabel, workflow.statuses],
  );
  const canTransition = useCallback(
    (from: Status, to: Status) =>
      from === to ||
      workflow.transitions.some((item) => item.from_status === from && item.to_status === to),
    [workflow.transitions],
  );
  const priorityLabel = useCallback(
    (priority: Task['priority']) =>
      t(
        priority === 'low'
          ? 'tasks.low'
          : priority === 'medium'
            ? 'tasks.medium'
            : priority === 'high'
              ? 'tasks.high'
              : 'tasks.critical',
      ),
    [t],
  );
  const taskListColumnLabel = useCallback(
    (column: TaskListColumn) =>
      t(
        column === 'title'
          ? 'tasks.title'
          : column === 'status'
            ? 'tasks.status'
            : column === 'priority'
              ? 'tasks.priority'
              : column === 'assignee'
                ? 'tasks.assignee'
                : 'tasks.dueDate',
      ),
    [t],
  );
  const activityAssigneeName = (id: string | null) =>
    id
      ? (assignees.find((assignee) => assignee.id === id)?.displayName ??
        t('tasks.unknownAssignee'))
      : t('tasks.unassigned');
  const activityTaskName = (id: string | null) =>
    id
      ? (tasks.find((candidate) => candidate.id === id)?.task_key ?? t('tasks.unknownParent'))
      : t('tasks.noParent');
  const taskChangeText = (change: TaskChangeHistory['changes'][number]) => {
    if (change.field === 'description') return t('tasks.activityDescriptionChanged');
    if (change.field === 'title')
      return t('tasks.activityTitleChanged', { from: change.from ?? '', to: change.to ?? '' });
    if (change.field === 'priority')
      return t('tasks.activityPriorityChanged', {
        from: priorityLabel((change.from ?? 'medium') as Task['priority']),
        to: priorityLabel((change.to ?? 'medium') as Task['priority']),
      });
    if (change.field === 'assigneeId')
      return t('tasks.activityAssigneeChanged', {
        from: activityAssigneeName(change.from),
        to: activityAssigneeName(change.to),
      });
    if (change.field === 'labels')
      return t('tasks.activityLabelsChanged', {
        from: change.from || t('tasks.noLabels'),
        to: change.to || t('tasks.noLabels'),
      });
    if (change.field === 'parentTaskId')
      return t('tasks.activityParentChanged', {
        from: activityTaskName(change.from),
        to: activityTaskName(change.to),
      });
    if (change.field === 'originalEstimateMinutes' || change.field === 'remainingEstimateMinutes')
      return t(
        change.field === 'originalEstimateMinutes'
          ? 'tasks.activityOriginalEstimateChanged'
          : 'tasks.activityRemainingEstimateChanged',
        {
          from: formatTaskDuration(change.from === null ? null : Number(change.from)),
          to: formatTaskDuration(change.to === null ? null : Number(change.to)),
        },
      );
    return t('tasks.activityDueDateChanged', {
      from: change.from ? formatDate(`${change.from}T00:00:00`) : t('tasks.noDueDate'),
      to: change.to ? formatDate(`${change.to}T00:00:00`) : t('tasks.noDueDate'),
    });
  };
  const loadAssignees = useCallback(async () => {
    setAssigneesLoading(true);
    try {
      const result = await api<{ items: TaskAssignee[] }>(`${base}/task-assignees`);
      setAssignees(
        result.items.filter(
          (item) =>
            typeof item.id === 'string' &&
            typeof item.displayName === 'string' &&
            typeof item.email === 'string',
        ),
      );
      setAssigneesLoadError('');
    } catch (cause) {
      setAssigneesLoadError(cause instanceof Error ? cause.message : t('tasks.assigneesLoadError'));
    } finally {
      setAssigneesLoading(false);
    }
  }, [base, t]);
  useEffect(() => {
    const timeout = window.setTimeout(() => setTaskQueryRequest(taskQuery.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [taskQuery]);
  useEffect(() => {
    if (!columnEditorOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!columnEditorRef.current?.contains(event.target as Node)) setColumnEditorOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setColumnEditorOpen(false);
      columnEditorRef.current?.querySelector<HTMLButtonElement>('[aria-controls]')?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [columnEditorOpen]);
  useEffect(() => {
    if (!savedFilterPickerOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!savedFilterPickerRef.current?.contains(event.target as Node))
        setSavedFilterPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSavedFilterPickerOpen(false);
      savedFilterPickerRef.current
        ?.querySelector<HTMLButtonElement>('[aria-controls="saved-filter-picker"]')
        ?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [savedFilterPickerOpen]);
  const fetchTaskLabelCatalog = useCallback(async () => {
    const result = await api<{ items: Array<{ value: string; count: number }> }>(
      `${base}/task-labels`,
    );
    return result.items.filter(
      (item) => typeof item.value === 'string' && Number.isFinite(item.count),
    );
  }, [base]);
  const loadFlowInsights = useCallback(async () => {
    setFlowInsightsLoading(true);
    try {
      const result = await api<TaskFlowInsights>(
        `${base}/task-flow-insights?windowDays=${flowWindowDays}&staleAfterDays=7`,
      );
      setFlowInsights(result);
      setFlowInsightsError('');
    } catch (cause) {
      setFlowInsightsError(
        cause instanceof Error ? cause.message : t('tasks.flowInsightsLoadFailed'),
      );
    } finally {
      setFlowInsightsLoading(false);
    }
  }, [base, flowWindowDays, t]);
  useEffect(() => {
    if (flowInsightsOpen) void loadFlowInsights();
  }, [flowInsightsOpen, loadFlowInsights]);
  const taskListParameters = useCallback(
    (includeStatusFilters = true) => {
      const parameters = new URLSearchParams();
      if (taskQueryRequest) parameters.set('query', taskQueryRequest);
      if (assigneeFilter !== 'all') parameters.set('assignee', assigneeFilter);
      if (priorityFilter !== 'all') parameters.set('priority', priorityFilter);
      if (includeStatusFilters) {
        for (const statusFilter of statusFilters) parameters.append('status', statusFilter);
      }
      if (labelFilter !== 'all') parameters.append('label', labelFilter);
      return parameters;
    },
    [assigneeFilter, labelFilter, priorityFilter, statusFilters, taskQueryRequest],
  );
  const refresh = useCallback(async () => {
    const currentRequest = ++listRequestId.current;
    const firstLoadForScope = loadedListScope.current !== base;
    if (firstLoadForScope) {
      setTasks([]);
      setLoading(true);
    }
    try {
      const parameters = taskListParameters();
      const archivedParameters = new URLSearchParams(parameters);
      archivedParameters.set('archiveState', 'archived');
      archivedParameters.set('limit', '100');
      const activeRequests =
        view === 'board'
          ? workflow.statuses
              .filter((status) => !statusFilters.length || statusFilters.includes(status.key))
              .map((status) => {
                const statusParameters = taskListParameters(false);
                statusParameters.set('archiveState', 'active');
                statusParameters.append('status', status.key);
                statusParameters.set('limit', String(taskBoardPageSize));
                return api<{ items: Task[]; pageInfo?: TaskPageInfo }>(
                  `${base}/tasks?${statusParameters}`,
                ).then((result) => ({ status: status.key, result }));
              })
          : [
              (() => {
                const activeParameters = new URLSearchParams(parameters);
                activeParameters.set('archiveState', 'active');
                activeParameters.set('limit', String(taskListPageSize));
                if (view === 'list') {
                  activeParameters.set('sort', taskSort);
                  activeParameters.set('direction', taskSortDirection);
                } else {
                  activeParameters.set('hasDueDate', 'true');
                  activeParameters.set('sort', 'dueDate');
                  activeParameters.set('direction', 'asc');
                }
                return api<{ items: Task[]; pageInfo?: TaskPageInfo }>(
                  `${base}/tasks?${activeParameters}`,
                ).then((result) => ({ status: '', result }));
              })(),
            ];
      const [activeResults, archivedResult, labelResult] = await Promise.all([
        Promise.all(activeRequests),
        api<{ items: Task[]; pageInfo?: TaskPageInfo }>(`${base}/tasks?${archivedParameters}`),
        fetchTaskLabelCatalog(),
      ]);
      if (currentRequest !== listRequestId.current) return;
      const activeItems = [
        ...new Map(
          activeResults
            .flatMap(({ status, result }) =>
              result.items.filter(
                (task) => !task.archived_at && (!status || task.status === status),
              ),
            )
            .map((task) => [task.id, task]),
        ).values(),
      ];
      const archivedItems = archivedResult.items.filter((task) => Boolean(task.archived_at));
      setTasks([...activeItems, ...archivedItems]);
      const nextBoardPageInfo = Object.fromEntries(
        activeResults
          .filter(({ status }) => status)
          .map(({ status, result }) => {
            const matchingItems = result.items.filter(
              (task) => !task.archived_at && task.status === status,
            );
            const responsePage = result.pageInfo;
            return [
              status,
              responsePage && (responsePage.offset > 0 || matchingItems.length > 0)
                ? responsePage
                : {
                    limit: taskBoardPageSize,
                    offset: 0,
                    total: matchingItems.length,
                    hasNext: false,
                  },
            ];
          }),
      );
      setBoardPageInfo(nextBoardPageInfo);
      const pageInfos = activeResults.map(
        ({ result }) =>
          result.pageInfo ?? {
            limit: view === 'board' ? taskBoardPageSize : taskListPageSize,
            offset: 0,
            total: result.items.length,
            hasNext: false,
          },
      );
      setTaskPageInfo({
        limit: pageInfos.reduce((total, page) => total + page.limit, 0),
        offset: 0,
        total: pageInfos.reduce((total, page) => total + page.total, 0),
        hasNext: pageInfos.some((page) => page.hasNext),
      });
      setArchivedPageInfo(
        archivedResult.pageInfo ?? {
          limit: 100,
          offset: 0,
          total: archivedItems.length,
          hasNext: false,
        },
      );
      setTaskLabels(labelResult);
      loadedListScope.current = base;
      setLoadError('');
    } catch (cause) {
      if (currentRequest !== listRequestId.current) return;
      setLoadError(cause instanceof Error ? cause.message : t('tasks.loadError'));
    } finally {
      if (currentRequest === listRequestId.current) setLoading(false);
    }
  }, [
    base,
    fetchTaskLabelCatalog,
    statusFilters,
    taskListParameters,
    taskSort,
    taskSortDirection,
    t,
    view,
    workflow.statuses,
  ]);
  useEffect(() => void refresh(), [refresh]);
  const loadMoreTasks = useCallback(
    async (status?: Status) => {
      const key = status ?? view;
      const currentPage = status ? boardPageInfo[status] : taskPageInfo;
      if (!currentPage?.hasNext || loadingMoreKey) return;
      setLoadingMoreKey(key);
      try {
        const parameters = taskListParameters(!status);
        parameters.set('archiveState', 'active');
        parameters.set('limit', String(status ? taskBoardPageSize : taskListPageSize));
        parameters.set(
          'offset',
          String(
            tasks.filter((task) => !task.archived_at && (!status || task.status === status)).length,
          ),
        );
        if (status) {
          parameters.append('status', status);
        } else if (view === 'list') {
          parameters.set('sort', taskSort);
          parameters.set('direction', taskSortDirection);
        } else {
          parameters.set('hasDueDate', 'true');
          parameters.set('sort', 'dueDate');
          parameters.set('direction', 'asc');
        }
        const result = await api<{ items: Task[]; pageInfo?: TaskPageInfo }>(
          `${base}/tasks?${parameters}`,
        );
        const nextItems = result.items.filter((task) => !task.archived_at);
        setTasks((current) => {
          const archived = current.filter((task) => task.archived_at);
          const active = current.filter((task) => !task.archived_at);
          const byId = new Map(active.map((task) => [task.id, task]));
          for (const task of nextItems) byId.set(task.id, task);
          return [...byId.values(), ...archived];
        });
        const nextPage = result.pageInfo ?? {
          limit: status ? taskBoardPageSize : taskListPageSize,
          offset: currentPage.offset + currentPage.limit,
          total: currentPage.total,
          hasNext: false,
        };
        if (status) {
          setBoardPageInfo((current) => ({ ...current, [status]: nextPage }));
          setTaskPageInfo((current) => ({
            ...current,
            hasNext: Object.entries(boardPageInfo).some(([candidateStatus, page]) =>
              candidateStatus === status ? nextPage.hasNext : page.hasNext,
            ),
          }));
        } else {
          setTaskPageInfo(nextPage);
        }
      } catch (cause) {
        setMessageTone('error');
        setMessage(cause instanceof Error ? cause.message : t('tasks.loadError'));
      } finally {
        setLoadingMoreKey('');
      }
    },
    [
      base,
      boardPageInfo,
      loadingMoreKey,
      taskListParameters,
      taskPageInfo,
      taskSort,
      taskSortDirection,
      tasks,
      t,
      view,
    ],
  );
  useEffect(() => void loadAssignees(), [loadAssignees]);
  useEffect(() => {
    let active = true;
    void api<TaskWorkflow>(`${base}/task-workflow`).then(
      (result) => {
        if (active && Array.isArray(result.statuses) && result.statuses.length) setWorkflow(result);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [base]);
  useEffect(() => {
    const request = ++savedFilterRestoreRequestId.current;
    if (!selectedFilterIdFromUrl) {
      setSelectedFilterId('');
      return;
    }
    if (savedFilterUrlWriteRef.current === selectedFilterIdFromUrl) {
      savedFilterUrlWriteRef.current = '';
      return;
    }
    void api<SavedTaskFilter>(`${base}/task-filters/${selectedFilterIdFromUrl}`)
      .then((filter) => {
        if (request !== savedFilterRestoreRequestId.current) return;
        if (!filter?.id || !filter.config) throw new Error(savedFilterRestoreFailedMessage);
        setSavedFilters((current) => mergeSavedFilters(current, [filter]));
        setSavedFilterResults((current) => mergeSavedFilters(current, [filter]));
        applySavedFilterConfig(filter);
      })
      .catch((cause: unknown) => {
        if (request !== savedFilterRestoreRequestId.current) return;
        setSavedFilterSelection('');
        setMessageTone('error');
        setMessage(cause instanceof Error ? cause.message : savedFilterRestoreFailedMessage);
      });
  }, [
    applySavedFilterConfig,
    base,
    savedFilterRestoreFailedMessage,
    selectedFilterIdFromUrl,
    setSavedFilterSelection,
  ]);
  useEffect(() => {
    let active = true;
    setSavedFilters([]);
    setSavedFilterResults([]);
    setSavedFilterPageInfo({
      limit: savedFilterPageSize,
      offset: 0,
      total: 0,
      hasNext: false,
    });
    void api<{ items: SavedTaskFilter[]; pageInfo?: PageInfo }>(`${base}/task-filters`).then(
      (result) => {
        if (active && Array.isArray(result.items)) {
          const items = sortSavedFilters(
            result.items.filter((item) => typeof item?.name === 'string'),
          );
          setSavedFilters((current) => mergeSavedFilters(current, items));
          setSavedFilterResults((current) => mergeSavedFilters(current, items));
          setSavedFilterPageInfo(
            result.pageInfo ?? {
              limit: savedFilterPageSize,
              offset: 0,
              total: items.length,
              hasNext: false,
            },
          );
        }
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [base]);
  useEffect(() => {
    if (!savedFilterPickerOpen) return;
    const timeout = window.setTimeout(() => {
      const request = ++savedFilterRequestId.current;
      const query = savedFilterQuery.trim();
      const path = query
        ? `${base}/task-filters?query=${encodeURIComponent(query)}&limit=${savedFilterPageSize}&offset=0`
        : `${base}/task-filters`;
      setSavedFilterLoading('page');
      void api<{ items: SavedTaskFilter[]; pageInfo?: PageInfo }>(path)
        .then((result) => {
          if (request !== savedFilterRequestId.current) return;
          const items = sortSavedFilters(
            result.items.filter((item) => typeof item?.name === 'string'),
          );
          setSavedFilterResults(items);
          setSavedFilters((current) => mergeSavedFilters(current, items));
          setSavedFilterPageInfo(
            result.pageInfo ?? {
              limit: savedFilterPageSize,
              offset: 0,
              total: items.length,
              hasNext: false,
            },
          );
          setSavedFilterLoadError('');
        })
        .catch((cause: unknown) => {
          if (request !== savedFilterRequestId.current) return;
          setSavedFilterLoadError(
            cause instanceof Error ? cause.message : savedFilterSearchFailedMessage,
          );
        })
        .finally(() => {
          if (request === savedFilterRequestId.current) setSavedFilterLoading('');
        });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [base, savedFilterPickerOpen, savedFilterQuery, savedFilterSearchFailedMessage]);
  useEffect(() => {
    let active = true;
    void api<{ autoWatchCommented: boolean }>('/notifications/preferences').then(
      (preferences) => {
        if (!active || typeof preferences.autoWatchCommented !== 'boolean') return;
        autoWatchCommentedRef.current = preferences.autoWatchCommented;
        setCommentWatch(preferences.autoWatchCommented);
      },
      () => undefined,
    );
    const updatePreference = (event: Event) => {
      const preferences = (event as CustomEvent<{ autoWatchCommented?: unknown }>).detail;
      if (typeof preferences?.autoWatchCommented !== 'boolean') return;
      autoWatchCommentedRef.current = preferences.autoWatchCommented;
      setCommentWatch(preferences.autoWatchCommented);
    };
    window.addEventListener('engrove-notification-preferences', updatePreference);
    return () => {
      active = false;
      window.removeEventListener('engrove-notification-preferences', updatePreference);
    };
  }, []);
  const canManageTaskVisibility = ['owner', 'admin', 'engineer'].includes(user.role);

  async function openVisibilityEditor() {
    if (!taskDetail || !canManageTaskVisibility) return;
    setVisibilityEditorOpen(true);
    setVisibilityLoading(true);
    setVisibilityError('');
    try {
      const [policy, groups] = await Promise.all([
        api<TaskVisibilityPolicy>(
          `${base}/tasks/${taskDetail.task_key ?? taskDetail.id}/visibility`,
        ),
        api<{ items: TaskVisibilityGroup[] }>(`${base}/task-visibility-groups?limit=100`),
      ]);
      setVisibilityPolicy(policy);
      setVisibilityGroups(groups.items);
    } catch (cause) {
      setVisibilityError(cause instanceof Error ? cause.message : t('tasks.visibilityLoadFailed'));
    } finally {
      setVisibilityLoading(false);
    }
  }

  function toggleVisibilitySubject(
    kind: 'members' | 'groups',
    subject: TaskAssignee | TaskVisibilityGroup,
  ) {
    setVisibilityPolicy((current) => {
      if (!current) return current;
      const selected = current[kind] as Array<TaskAssignee | TaskVisibilityGroup>;
      const next = selected.some((candidate) => candidate.id === subject.id)
        ? selected.filter((candidate) => candidate.id !== subject.id)
        : [...selected, subject];
      return { ...current, [kind]: next } as TaskVisibilityPolicy;
    });
  }

  async function saveTaskVisibility() {
    if (!taskDetail || !visibilityPolicy || visibilitySaving) return;
    setVisibilitySaving(true);
    setVisibilityError('');
    try {
      const saved = await api<TaskVisibilityPolicy>(
        `${base}/tasks/${taskDetail.task_key ?? taskDetail.id}/visibility`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            visibility: visibilityPolicy.visibility,
            userIds: visibilityPolicy.members.map((member) => member.id),
            groupIds: visibilityPolicy.groups.map((group) => group.id),
            rowVersion: visibilityPolicy.rowVersion,
          }),
        },
      );
      setVisibilityPolicy(saved);
      setTaskDetail((current) =>
        current
          ? { ...current, visibility: saved.visibility, row_version: saved.rowVersion }
          : current,
      );
      setTasks((current) =>
        current.map((task) =>
          task.id === taskDetail.id
            ? { ...task, visibility: saved.visibility, row_version: saved.rowVersion }
            : task,
        ),
      );
      setVisibilityEditorOpen(false);
      setMessageTone('success');
      setMessage(t('tasks.visibilitySaved'));
    } catch (cause) {
      setVisibilityError(cause instanceof Error ? cause.message : t('tasks.visibilitySaveFailed'));
    } finally {
      setVisibilitySaving(false);
    }
  }

  useEffect(() => {
    if (!selectedTaskId) {
      setTaskDetail(undefined);
      setTaskDetailConflict(undefined);
      setTaskDetailDirtyFields(new Set());
      setDetailParentCandidate(null);
      setRelatedTaskCandidate(null);
      setDetailLoading(false);
      setVisibilityEditorOpen(false);
      setVisibilityPolicy(undefined);
      setVisibilityError('');
      return;
    }
    setTaskDetailConflict(undefined);
    setTaskDetailDirtyFields(new Set());
    setCommentText('');
    setCommentWatch(autoWatchCommentedRef.current);
    setMentionedUserIds(new Set());
    setEditingCommentId('');
    setEditingCommentText('');
    setEditingCommentMentions(new Set());
    setCommentHistoryOpenId('');
    setCommentHistoryLoadingId('');
    setActivityLoading(false);
    setActivityFilter('all');
    setActivitySort('newest');
    setWorklogLoading(false);
    setWorklogDuration('');
    setWorklogStartedAt(localDateTimeInput());
    setWorklogNote('');
    setWorklogRemainingMode('auto');
    setWorklogRemaining('');
    setEditingWorklogId('');
    setRelationshipType('blocked_by');
    setRelatedTaskCandidate(null);
    setExternalLinkTitle('');
    setExternalLinkUrl('');
    setVisibilityEditorOpen(false);
    setVisibilityPolicy(undefined);
    setVisibilityError('');
    const request = ++detailRequestId.current;
    void loadAssignees();
    setDetailLoading(true);
    void api<TaskDetail>(`${base}/tasks/${selectedTaskId}`)
      .then(
        (detail) => {
          if (request !== detailRequestId.current) return;
          applyTaskDetail(detail);
          if (detail.task_key && detail.task_key !== selectedTaskId)
            setSelectedTaskId(detail.task_key);
        },
        (cause: unknown) => {
          if (request !== detailRequestId.current) return;
          setMessageTone('error');
          setMessage(cause instanceof Error ? cause.message : t('tasks.operationError'));
          setSelectedTaskId('');
        },
      )
      .finally(() => {
        if (request === detailRequestId.current) setDetailLoading(false);
      });
  }, [applyTaskDetail, base, loadAssignees, selectedTaskId, t]);

  async function recoverTaskVersionConflict(cause: unknown): Promise<boolean> {
    if (!isTaskVersionConflict(cause)) return false;
    await refresh();
    setMessageTone('error');
    setMessage(t('tasks.versionConflict'));
    return true;
  }

  async function mutate(operation: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await operation();
      await refresh();
      setMessageTone('success');
      setMessage(t('common.changesSaved'));
      return true;
    } catch (cause) {
      if (!(await recoverTaskVersionConflict(cause))) {
        setMessageTone('error');
        setMessage(cause instanceof Error ? cause.message : t('tasks.operationError'));
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const originalEstimateMinutes = parseTaskDuration(data.get('originalEstimate'));
    if (originalEstimateMinutes === undefined) {
      setMessageTone('error');
      setMessage(t('tasks.durationInvalid'));
      return;
    }
    const body = JSON.stringify({
      title: data.get('title'),
      description: data.get('description'),
      priority: data.get('priority'),
      visibility: data.get('visibility') ?? 'project',
      labels: parseTaskLabels(data.get('labels')),
      parentTaskId: String(data.get('parentTaskId') ?? '') || undefined,
      cloneSourceTaskId: creatorSource?.id,
      assigneeId: String(data.get('assigneeId') ?? '') || undefined,
      dueDate: String(data.get('dueDate') ?? '') || undefined,
      originalEstimateMinutes,
      links: [],
    });
    const request =
      createRequestRef.current?.body === body
        ? createRequestRef.current
        : { body, idempotencyKey: crypto.randomUUID() };
    createRequestRef.current = request;
    setBusy(true);
    try {
      const created = await api<Task>(`${base}/tasks`, {
        method: 'POST',
        headers: { 'Idempotency-Key': request.idempotencyKey },
        body,
      });
      await refresh();
      createRequestRef.current = undefined;
      form.reset();
      setCreatorDirty(false);
      setCreatorSource(undefined);
      setCreateParentCandidate(null);
      setCreatorOpen(false);
      setSelectedTaskId(created.task_key ?? created.id);
      setMessageTone('success');
      setMessage(t('common.changesSaved'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.operationError'));
    } finally {
      setBusy(false);
    }
  }

  function creatorFormHasDraft(
    overrides: { assigneeId?: string; parentTaskId?: string } = {},
    form = creatorFormRef.current,
  ): boolean {
    if (!form) return false;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? '');
    return (
      Boolean(value('title')) ||
      Boolean(value('description')) ||
      parseTaskLabels(value('labels')).length > 0 ||
      value('priority') !== 'medium' ||
      value('visibility') === 'restricted' ||
      Boolean(overrides.assigneeId ?? value('assigneeId')) ||
      Boolean(value('dueDate')) ||
      Boolean(value('originalEstimate')) ||
      Boolean(overrides.parentTaskId ?? value('parentTaskId'))
    );
  }

  function currentFilterConfig(): SavedTaskFilter['config'] {
    return {
      query: taskQuery,
      assignee: assigneeFilter,
      priority: priorityFilter as SavedTaskFilter['config']['priority'],
      statuses: statusFilters,
      labels: labelFilter === 'all' ? [] : [labelFilter],
      view,
      sort: taskSort,
      direction: taskSortDirection,
      group: taskGroup,
      listColumns: taskListColumns,
    };
  }

  async function loadMoreSavedFilters() {
    if (!savedFilterPageInfo.hasNext || savedFilterLoading) return;
    const request = ++savedFilterRequestId.current;
    const query = savedFilterQuery.trim();
    const parameters = new URLSearchParams({
      limit: String(savedFilterPageSize),
      offset: String(savedFilterResults.length),
    });
    if (query) parameters.set('query', query);
    setSavedFilterLoading('more');
    try {
      const result = await api<{ items: SavedTaskFilter[]; pageInfo?: PageInfo }>(
        `${base}/task-filters?${parameters}`,
      );
      if (request !== savedFilterRequestId.current) return;
      const items = result.items.filter((item) => typeof item?.name === 'string');
      setSavedFilterResults((current) => mergeSavedFilters(current, items));
      setSavedFilters((current) => mergeSavedFilters(current, items));
      setSavedFilterPageInfo(
        result.pageInfo ?? {
          limit: savedFilterPageSize,
          offset: savedFilterResults.length,
          total: savedFilterPageInfo.total,
          hasNext: false,
        },
      );
      setSavedFilterLoadError('');
    } catch (cause) {
      if (request !== savedFilterRequestId.current) return;
      setSavedFilterLoadError(
        cause instanceof Error ? cause.message : savedFilterSearchFailedMessage,
      );
    } finally {
      if (request === savedFilterRequestId.current) setSavedFilterLoading('');
    }
  }

  function applySavedFilter(filterId: string) {
    if (!filterId) {
      setSavedFilterSelection('');
      return;
    }
    const filter = savedFilters.find((candidate) => candidate.id === filterId);
    if (!filter) return;
    applySavedFilterConfig(filter);
    setSavedFilterSelection(filter.id);
  }

  async function saveCurrentFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!savedFilterName.trim() || filterSaving) return;
    setFilterSaving(true);
    try {
      const created = await api<SavedTaskFilter>(`${base}/task-filters`, {
        method: 'POST',
        body: JSON.stringify({
          name: savedFilterName,
          visibility: savedFilterVisibility,
          config: currentFilterConfig(),
        }),
      });
      setSavedFilters((current) => mergeSavedFilters(current, [created]));
      if (!savedFilterQuery.trim())
        setSavedFilterResults((current) => mergeSavedFilters(current, [created]));
      applySavedFilterConfig(created);
      setSavedFilterSelection(created.id);
      setSavedFilterName('');
      setSavedFilterVisibility('personal');
      setFilterEditorOpen(false);
      setMessageTone('success');
      setMessage(t('tasks.filterSaved'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.operationError'));
    } finally {
      setFilterSaving(false);
    }
  }

  async function deleteSelectedFilter() {
    const selected = savedFilters.find((filter) => filter.id === selectedFilterId);
    if (!selected || !selected.is_owner || filterSaving) return;
    setFilterSaving(true);
    try {
      await api(`${base}/task-filters/${selectedFilterId}`, { method: 'DELETE' });
      setSavedFilters((current) => current.filter((filter) => filter.id !== selectedFilterId));
      setSavedFilterResults((current) =>
        current.filter((filter) => filter.id !== selectedFilterId),
      );
      setSavedFilterSelection('');
      setMessageTone('success');
      setMessage(t('tasks.filterDeleted'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.operationError'));
    } finally {
      setFilterSaving(false);
    }
  }

  async function updateSelectedFilter() {
    const selected = savedFilters.find((filter) => filter.id === selectedFilterId);
    if (!selected || !selected.is_owner || filterSaving) return;
    setFilterSaving(true);
    try {
      const updated = await api<SavedTaskFilter>(`${base}/task-filters/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: selected.name,
          visibility: selected.visibility,
          config: currentFilterConfig(),
        }),
      });
      setSavedFilters((current) =>
        sortSavedFilters(current.map((filter) => (filter.id === updated.id ? updated : filter))),
      );
      setSavedFilterResults((current) =>
        sortSavedFilters(current.map((filter) => (filter.id === updated.id ? updated : filter))),
      );
      setMessageTone('success');
      setMessage(t('tasks.filterUpdated'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.operationError'));
    } finally {
      setFilterSaving(false);
    }
  }

  async function toggleSelectedFilterFavorite() {
    const selected = savedFilters.find((filter) => filter.id === selectedFilterId);
    if (!selected || filterSaving) return;
    setFilterSaving(true);
    try {
      const result = await api<{ favorite: boolean }>(
        `${base}/task-filters/${selected.id}/favorite`,
        {
          method: 'POST',
          body: JSON.stringify({ favorite: !selected.favorite }),
        },
      );
      setSavedFilters((current) =>
        sortSavedFilters(
          current.map((filter) =>
            filter.id === selected.id ? { ...filter, favorite: result.favorite } : filter,
          ),
        ),
      );
      setSavedFilterResults((current) =>
        sortSavedFilters(
          current.map((filter) =>
            filter.id === selected.id ? { ...filter, favorite: result.favorite } : filter,
          ),
        ),
      );
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.operationError'));
    } finally {
      setFilterSaving(false);
    }
  }

  function toggleTaskSelection(taskId: string, extendRange = false) {
    const orderedTaskIds = extendRange
      ? Array.from(
          document.querySelectorAll<HTMLElement>('[data-sid]'),
          (element) => element.dataset.sid!,
        )
      : [];
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      const anchorIndex = orderedTaskIds.indexOf(selectionAnchorTaskId.current);
      const taskIndex = orderedTaskIds.indexOf(taskId);
      if (anchorIndex >= 0 && taskIndex >= 0) {
        for (const id of orderedTaskIds.slice(
          Math.min(anchorIndex, taskIndex),
          Math.max(anchorIndex, taskIndex) + 1,
        ))
          next.add(id);
      } else {
        selectionAnchorTaskId.current = taskId;
        if (next.has(taskId)) next.delete(taskId);
        else next.add(taskId);
      }
      return next;
    });
    setBulkConfirming(false);
  }

  function clearTaskSelection() {
    selectionAnchorTaskId.current = '';
    setSelectedTaskIds(new Set());
    setBulkConfirming(false);
  }

  async function applyBulkUpdate() {
    if (!selectedTaskIds.size || bulkSaving) return;
    if (
      bulkStatus === 'unchanged' &&
      bulkPriority === 'unchanged' &&
      bulkAssignee === 'unchanged'
    ) {
      setMessageTone('error');
      setMessage(t('tasks.bulkChooseChange'));
      return;
    }
    if (!bulkConfirming) {
      setBulkConfirming(true);
      return;
    }
    const selected = tasks.filter((task) => selectedTaskIds.has(task.id));
    const changes: Record<string, string | null> = {};
    if (bulkStatus !== 'unchanged') changes.status = bulkStatus;
    if (bulkPriority !== 'unchanged') changes.priority = bulkPriority;
    if (bulkAssignee !== 'unchanged') changes.assigneeId = bulkAssignee || null;
    setBulkSaving(true);
    try {
      const result = await api<{ items: Task[] }>(`${base}/tasks/bulk-update`, {
        method: 'POST',
        body: JSON.stringify({
          items: selected.map((task) => ({ id: task.id, rowVersion: task.row_version })),
          changes,
        }),
      });
      const updatedById = new Map(result.items.map((task) => [task.id, task]));
      setTasks((current) => current.map((task) => updatedById.get(task.id) ?? task));
      await refresh();
      setMessageTone('success');
      setMessage(t('tasks.bulkUpdated', { count: result.items.length }));
      setBoardAnnouncement(t('tasks.bulkUpdated', { count: result.items.length }));
      clearTaskSelection();
      setSelectionMode(false);
      setBulkStatus('unchanged');
      setBulkPriority('unchanged');
      setBulkAssignee('unchanged');
    } catch (cause) {
      await refresh();
      setMessageTone('error');
      setMessage(
        isTaskVersionConflict(cause)
          ? t('tasks.versionConflict')
          : cause instanceof Error
            ? cause.message
            : t('tasks.operationError'),
      );
      setBulkConfirming(false);
    } finally {
      setBulkSaving(false);
    }
  }

  async function moveTask(
    task: Task,
    status: Status,
    beforeTaskId?: string,
    placement?: 'top' | 'bottom',
  ) {
    if (pendingTaskIds.has(task.id) || !canTransition(task.status, status)) return;
    const previousStatus = task.status;
    const destination = columns.find((column) => column.status === status)?.label ?? status;
    const pageRefreshRequired = Boolean(
      boardPageInfo[previousStatus]?.hasNext || boardPageInfo[status]?.hasNext,
    );
    setPendingTaskIds((current) => new Set(current).add(task.id));
    if (previousStatus !== status) {
      setBoardPageInfo((current) => {
        const next = { ...current };
        if (next[previousStatus]) {
          next[previousStatus] = {
            ...next[previousStatus],
            total: Math.max(0, next[previousStatus].total - 1),
          };
        }
        if (next[status]) next[status] = { ...next[status], total: next[status].total + 1 };
        return next;
      });
    }
    if (!placement) setTasks((current) => placeTaskBefore(current, task.id, status, beforeTaskId));
    setMessage('');
    if (previousStatus !== status)
      setBoardAnnouncement(t('tasks.movingTo', { title: task.title, status: destination }));
    try {
      const updated = await api<Task>(`${base}/tasks/${task.id}/move`, {
        method: 'POST',
        body: JSON.stringify({
          status,
          beforeTaskId: beforeTaskId ?? null,
          ...(placement === undefined ? {} : { placement }),
          rowVersion: task.row_version,
        }),
      });
      const statusOrder = new Map(columns.map((column, index) => [column.status, index]));
      setTasks((current) =>
        current
          .map((candidate) => (candidate.id === task.id ? updated : candidate))
          .sort(
            (left, right) =>
              (statusOrder.get(left.status) ?? Number.MAX_SAFE_INTEGER) -
                (statusOrder.get(right.status) ?? Number.MAX_SAFE_INTEGER) ||
              (left.board_position ?? 0) - (right.board_position ?? 0) ||
              left.id.localeCompare(right.id),
          ),
      );
      setMessageTone('success');
      const success =
        previousStatus === status
          ? t('tasks.ranked', { title: task.title })
          : t('tasks.movedTo', { title: task.title, status: destination });
      setMessage(success);
      setBoardAnnouncement(success);
      if (pageRefreshRequired) await refresh();
    } catch (cause) {
      setTasks((current) =>
        current.map((candidate) =>
          candidate.id === task.id ? { ...candidate, status: previousStatus } : candidate,
        ),
      );
      await refresh();
      setMessageTone('error');
      const error = isTaskVersionConflict(cause)
        ? t('tasks.versionConflict')
        : cause instanceof Error
          ? cause.message
          : t('tasks.operationError');
      setMessage(error);
      setBoardAnnouncement(error);
    } finally {
      setPendingTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  function changeStatus(task: Task, status: Status) {
    if (task.status !== status) void moveTask(task, status);
  }

  function rankTaskByStep(task: Task, direction: -1 | 1) {
    const peers = tasks.filter(
      (candidate) => !candidate.archived_at && candidate.status === task.status,
    );
    const currentIndex = peers.findIndex((candidate) => candidate.id === task.id);
    if (currentIndex < 0) return;
    if (direction < 0) {
      const previous = peers[currentIndex - 1];
      if (previous) void moveTask(task, task.status, previous.id);
      return;
    }
    const next = peers[currentIndex + 1];
    if (!next) return;
    const afterNext = peers[currentIndex + 2];
    if (afterNext) void moveTask(task, task.status, afterNext.id);
    else void moveTask(task, task.status);
  }

  function taskDetailFieldChanged(name: string, value: string): boolean {
    if (!taskDetail) return false;
    if (name === 'title') return value !== taskDetail.title;
    if (name === 'description') return value !== taskDetail.description;
    if (name === 'labels')
      return JSON.stringify(parseTaskLabels(value)) !== JSON.stringify(taskDetail.labels ?? []);
    if (name === 'status') return value !== taskDetail.status;
    if (name === 'priority') return value !== taskDetail.priority;
    if (name === 'dueDate') return value !== (taskDetail.due_date ?? '');
    if (name === 'originalEstimate')
      return parseTaskDuration(value) !== taskDetail.original_estimate_minutes;
    if (name === 'remainingEstimate')
      return parseTaskDuration(value) !== taskDetail.remaining_estimate_minutes;
    return false;
  }

  async function saveTaskDetail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskDetail || detailSaving) return;
    const data = new FormData(event.currentTarget);
    const originalEstimateMinutes = parseTaskDuration(data.get('originalEstimate'));
    const remainingEstimateMinutes = parseTaskDuration(data.get('remainingEstimate'));
    if (originalEstimateMinutes === undefined || remainingEstimateMinutes === undefined) {
      setMessageTone('error');
      setMessage(t('tasks.durationInvalid'));
      return;
    }
    setDetailSaving(true);
    try {
      const updated = await api<TaskDetail>(`${base}/tasks/${taskDetail.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: data.get('title'),
          description: data.get('description'),
          status: data.get('status'),
          priority: data.get('priority'),
          labels: parseTaskLabels(data.get('labels')),
          parentTaskId: String(data.get('parentTaskId') ?? '') || null,
          assigneeId: String(data.get('assigneeId') ?? '') || undefined,
          dueDate: String(data.get('dueDate') ?? '') || undefined,
          originalEstimateMinutes,
          remainingEstimateMinutes,
          rowVersion: taskDetail.row_version,
        }),
      });
      applyTaskDetail(updated);
      setTaskDetailConflict(undefined);
      setTaskDetailDirtyFields(new Set());
      await refresh();
      setMessageTone('success');
      setMessage(t('tasks.detailSaved'));
    } catch (cause) {
      setMessageTone('error');
      if (isTaskVersionConflict(cause)) {
        try {
          const latest = await api<TaskDetail>(`${base}/tasks/${taskDetail.id}`);
          setTaskDetailConflict(latest);
          await refresh();
          setMessage(t('tasks.detailConflictBody'));
        } catch {
          setMessage(t('tasks.versionConflict'));
        }
      } else {
        setMessage(cause instanceof Error ? cause.message : t('tasks.operationError'));
      }
    } finally {
      setDetailSaving(false);
    }
  }

  function resetWorklogDraft() {
    setWorklogDuration('');
    setWorklogStartedAt(localDateTimeInput());
    setWorklogNote('');
    setWorklogRemainingMode('auto');
    setWorklogRemaining('');
    setEditingWorklogId('');
  }

  function editWorklog(worklog: TaskWorklog) {
    setEditingWorklogId(worklog.id);
    setWorklogDuration(formatTaskDuration(worklog.duration_minutes));
    setWorklogStartedAt(localDateTimeInput(new Date(worklog.started_at)));
    setWorklogNote(worklog.note);
    setWorklogRemainingMode('auto');
    setWorklogRemaining('');
  }

  async function saveWorklog() {
    if (!taskDetail || worklogSaving || taskDetailDirty) return;
    const durationMinutes = parseTaskDuration(worklogDuration);
    const remainingEstimateMinutes =
      worklogRemainingMode === 'set' ? parseTaskDuration(worklogRemaining) : null;
    if (
      durationMinutes === undefined ||
      durationMinutes === null ||
      durationMinutes < 1 ||
      durationMinutes > 525_600 ||
      (worklogRemainingMode === 'set' &&
        (remainingEstimateMinutes === undefined || remainingEstimateMinutes === null))
    ) {
      setMessageTone('error');
      setMessage(t('tasks.durationInvalid'));
      return;
    }
    const startedAt = new Date(worklogStartedAt);
    if (!Number.isFinite(startedAt.getTime())) {
      setMessageTone('error');
      setMessage(t('tasks.worklogStartedInvalid'));
      return;
    }
    const editing = (taskDetail.worklogs ?? []).find((worklog) => worklog.id === editingWorklogId);
    if (editingWorklogId && !editing) {
      setMessageTone('error');
      setMessage(t('tasks.worklogChanged'));
      return;
    }
    setWorklogSaving(true);
    try {
      const updated = await api<TaskDetail>(
        editing
          ? `${base}/tasks/${taskDetail.id}/worklogs/${editing.id}`
          : `${base}/tasks/${taskDetail.id}/worklogs`,
        {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify({
            durationMinutes,
            startedAt: startedAt.toISOString(),
            note: worklogNote,
            remainingEstimateMode: worklogRemainingMode,
            ...(worklogRemainingMode === 'set' ? { remainingEstimateMinutes } : {}),
            taskRowVersion: taskDetail.row_version,
            ...(editing ? { worklogRowVersion: editing.row_version } : {}),
          }),
        },
      );
      applyTaskDetail(updated);
      setTaskDetailDirtyFields(new Set());
      resetWorklogDraft();
      await refresh();
      setMessageTone('success');
      setMessage(t(editing ? 'tasks.worklogUpdated' : 'tasks.worklogCreated'));
    } catch (cause) {
      setMessageTone('error');
      if (isTaskVersionConflict(cause)) {
        try {
          applyTaskDetail(await api<TaskDetail>(`${base}/tasks/${taskDetail.id}`));
          await refresh();
          setMessage(t('tasks.worklogChanged'));
        } catch {
          setMessage(t('tasks.versionConflict'));
        }
      } else setMessage(cause instanceof Error ? cause.message : t('tasks.operationError'));
    } finally {
      setWorklogSaving(false);
    }
  }

  async function deleteWorklog(worklog: TaskWorklog) {
    if (
      !taskDetail ||
      worklogSaving ||
      taskDetailDirty ||
      !(await confirmAction(
        t('tasks.deleteWorklogConfirm', { duration: formatTaskDuration(worklog.duration_minutes) }),
        { tone: 'danger' },
      ))
    )
      return;
    setWorklogSaving(true);
    try {
      const updated = await api<TaskDetail>(
        `${base}/tasks/${taskDetail.id}/worklogs/${worklog.id}`,
        {
          method: 'DELETE',
          body: JSON.stringify({
            remainingEstimateMode: 'auto',
            taskRowVersion: taskDetail.row_version,
            worklogRowVersion: worklog.row_version,
          }),
        },
      );
      applyTaskDetail(updated);
      resetWorklogDraft();
      await refresh();
      setMessageTone('success');
      setMessage(t('tasks.worklogDeleted'));
    } catch (cause) {
      if (isTaskVersionConflict(cause)) {
        try {
          applyTaskDetail(await api<TaskDetail>(`${base}/tasks/${taskDetail.id}`));
          await refresh();
        } catch {
          // The actionable conflict message below still applies.
        }
      }
      setMessageTone('error');
      setMessage(
        isTaskVersionConflict(cause)
          ? t('tasks.worklogChanged')
          : cause instanceof Error
            ? cause.message
            : t('tasks.operationError'),
      );
    } finally {
      setWorklogSaving(false);
    }
  }

  async function loadMoreWorklogs() {
    if (!taskDetail?.worklog_page_info?.hasNext || worklogLoading) return;
    setWorklogLoading(true);
    try {
      const page = await api<TaskWorklogPage>(
        `${base}/tasks/${taskDetail.id}/worklogs?limit=20&offset=${taskDetail.worklogs?.length ?? 0}`,
      );
      setTaskDetail((current) =>
        current
          ? {
              ...current,
              worklogs: [
                ...(current.worklogs ?? []),
                ...page.items.filter(
                  (item) => !(current.worklogs ?? []).some((existing) => existing.id === item.id),
                ),
              ],
              worklog_page_info: page.pageInfo,
            }
          : current,
      );
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.operationError'));
    } finally {
      setWorklogLoading(false);
    }
  }

  async function toggleWatching() {
    if (!taskDetail || watchSaving) return;
    setWatchSaving(true);
    try {
      const updated = await api<TaskDetail>(
        `${base}/tasks/${taskDetail.id}/${taskDetail.watching ? 'unwatch' : 'watch'}`,
        { method: 'POST' },
      );
      setTaskDetail(updated);
      setMessageTone('success');
      setMessage(updated.watching ? t('tasks.watching') : t('tasks.notWatching'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.operationError'));
    } finally {
      setWatchSaving(false);
    }
  }

  async function addComment() {
    if (!taskDetail || commentSaving || !commentText.trim()) return;
    setCommentSaving(true);
    try {
      const comment = await api<TaskComment>(`${base}/tasks/${taskDetail.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          body: commentText,
          mentionedUserIds: [...mentionedUserIds],
          watch: commentWatch,
        }),
      });
      setTaskDetail((current) =>
        current
          ? {
              ...current,
              comments: [
                ...(current.comments ?? []),
                {
                  ...comment,
                  revisions: comment.revisions ?? [],
                  revision_count: comment.revision_count ?? 0,
                },
              ],
              ...(current.activity_page_info
                ? {
                    activity_page_info: {
                      ...current.activity_page_info,
                      total: current.activity_page_info.total + 1,
                    },
                  }
                : {}),
              watching: current.watching || commentWatch,
              watcher_count:
                (current.watcher_count ?? 0) + (!current.watching && commentWatch ? 1 : 0),
            }
          : current,
      );
      setCommentText('');
      setMentionedUserIds(new Set());
      setMessageTone('success');
      setMessage(t('tasks.commentAdded'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.commentFailed'));
    } finally {
      setCommentSaving(false);
    }
  }

  function beginCommentEdit(comment: TaskComment) {
    setEditingCommentId(comment.id);
    setEditingCommentText(comment.body);
    setEditingCommentMentions(new Set(comment.mentions.map((mention) => mention.id)));
    setCommentHistoryOpenId('');
  }

  function cancelCommentEdit() {
    setEditingCommentId('');
    setEditingCommentText('');
    setEditingCommentMentions(new Set());
  }

  function commentEditChanged(comment: TaskComment) {
    const before = comment.mentions
      .map((mention) => mention.id)
      .sort()
      .join(',');
    const after = [...editingCommentMentions].sort().join(',');
    return comment.body !== editingCommentText.trim() || before !== after;
  }

  async function saveCommentEdit(comment: TaskComment) {
    if (
      !taskDetail ||
      commentEditSaving ||
      !editingCommentText.trim() ||
      !commentEditChanged(comment)
    )
      return;
    setCommentEditSaving(true);
    try {
      const updated = await api<TaskComment>(
        `${base}/tasks/${taskDetail.id}/comments/${comment.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            body: editingCommentText,
            mentionedUserIds: [...editingCommentMentions],
            rowVersion: comment.row_version,
          }),
        },
      );
      setTaskDetail((current) =>
        current
          ? {
              ...current,
              comments: current.comments.map((item) => (item.id === updated.id ? updated : item)),
            }
          : current,
      );
      cancelCommentEdit();
      setMessageTone('success');
      setMessage(t('common.changesSaved'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.operationError'));
    } finally {
      setCommentEditSaving(false);
    }
  }

  async function loadEarlierActivity() {
    if (!taskDetail || activityLoading || !taskDetail.activity_page_info?.hasNext) return;
    setActivityLoading(true);
    try {
      const page = await api<TaskActivityPage>(
        `${base}/tasks/${taskDetail.id}/activity?limit=50&offset=${taskActivity.length}`,
      );
      const mergeById = <T extends { id: string }>(current: T[], incoming: T[]) => [
        ...new Map([...current, ...incoming].map((item) => [item.id, item])).values(),
      ];
      setTaskDetail((current) =>
        current
          ? {
              ...current,
              status_history: mergeById(current.status_history, page.status_history),
              change_history: mergeById(current.change_history, page.change_history),
              link_history: mergeById(current.link_history, page.link_history),
              comments: mergeById(current.comments, page.comments),
              activity_page_info: page.pageInfo,
            }
          : current,
      );
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.operationError'));
    } finally {
      setActivityLoading(false);
    }
  }

  async function toggleCommentHistory(comment: TaskComment) {
    if (commentHistoryOpenId === comment.id) {
      setCommentHistoryOpenId('');
      return;
    }
    setCommentHistoryOpenId(comment.id);
    if ((comment.revisions?.length ?? 0) > 0 || (comment.revision_count ?? 0) === 0) return;
    await loadCommentRevisions(comment);
  }

  async function loadCommentRevisions(comment: TaskComment) {
    if (!taskDetail || commentHistoryLoadingId === comment.id) return;
    setCommentHistoryLoadingId(comment.id);
    try {
      const page = await api<{ items: TaskComment['revisions']; pageInfo: PageInfo }>(
        `${base}/tasks/${taskDetail.id}/comments/${comment.id}/revisions?limit=20&offset=${comment.revisions?.length ?? 0}`,
      );
      setTaskDetail((current) =>
        current
          ? {
              ...current,
              comments: current.comments.map((item) =>
                item.id === comment.id
                  ? {
                      ...item,
                      revisions: [
                        ...new Map(
                          [...(item.revisions ?? []), ...page.items].map((revision) => [
                            revision.revision,
                            revision,
                          ]),
                        ).values(),
                      ].sort((left, right) => left.revision - right.revision),
                      revision_count: page.pageInfo.total,
                    }
                  : item,
              ),
            }
          : current,
      );
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.operationError'));
    } finally {
      setCommentHistoryLoadingId('');
    }
  }

  async function addExternalLink() {
    if (!taskDetail || linkSaving || !externalLinkTitle.trim() || !externalLinkUrl.trim()) return;
    setLinkSaving(true);
    try {
      const updated = await api<TaskDetail>(`${base}/tasks/${taskDetail.id}/external-links`, {
        method: 'POST',
        body: JSON.stringify({ title: externalLinkTitle, url: externalLinkUrl }),
      });
      setTaskDetail(updated);
      setExternalLinkTitle('');
      setExternalLinkUrl('');
      setTasks((current) =>
        current.map((task) => (task.id === updated.id ? { ...task, links: updated.links } : task)),
      );
      setMessageTone('success');
      setMessage(t('tasks.externalLinkAdded'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.externalLinkFailed'));
    } finally {
      setLinkSaving(false);
    }
  }

  async function attachTaskFile(selected: File) {
    if (!taskDetail || attachmentUploading || selected.size === 0) return;
    if (selected.size > maxTaskAttachmentBytes) {
      setMessageTone('error');
      setMessage(t('tasks.attachmentTooLarge'));
      return;
    }
    setAttachmentUploading(true);
    let finalized = false;
    try {
      const contents = await selected.arrayBuffer();
      const issued = await api<{
        uploadId: string;
        uploadUrl: string;
        headers: Record<string, string>;
      }>(`${base}/file-upload-sessions`, {
        method: 'POST',
        body: JSON.stringify({
          seriesName: selected.name,
          originalName: selected.name,
          contentType: selected.type || 'application/octet-stream',
          sizeBytes: selected.size,
          checksum: await fileSha256(contents),
        }),
      });
      const stored = await fetch(issued.uploadUrl, {
        method: 'PUT',
        headers: issued.headers,
        body: contents,
      });
      if (!stored.ok) throw new Error(t('tasks.attachmentStorageFailed'));
      const completed = await api<{ id: string }>(
        `${base}/file-upload-sessions/${issued.uploadId}/complete`,
        { method: 'POST' },
      );
      finalized = true;
      const updated = await api<TaskDetail>(`${base}/tasks/${taskDetail.id}/file-links`, {
        method: 'POST',
        body: JSON.stringify({ fileId: completed.id }),
      });
      setTaskDetail(updated);
      setTasks((current) =>
        current.map((task) => (task.id === updated.id ? { ...task, links: updated.links } : task)),
      );
      setMessageTone('success');
      setMessage(t('tasks.attachmentAdded', { name: selected.name }));
    } catch (cause) {
      setMessageTone('error');
      setMessage(
        finalized
          ? t('tasks.attachmentSavedNotLinked', { name: selected.name })
          : cause instanceof Error
            ? cause.message
            : t('tasks.attachmentFailed'),
      );
    } finally {
      setAttachmentUploading(false);
      setAttachmentDragging(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    }
  }

  async function downloadTaskFile(link: TaskLink) {
    if (attachmentDownloadingId) return;
    setAttachmentDownloadingId(link.id);
    try {
      const result = await api<{ url: string }>(`${base}/files/${link.entity_id}/download`);
      window.location.assign(result.url);
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.attachmentDownloadFailed'));
    } finally {
      setAttachmentDownloadingId('');
    }
  }

  async function removeTaskLink(linkId: string) {
    if (!taskDetail || linkSaving) return;
    setLinkSaving(true);
    try {
      const updated = await api<TaskDetail>(`${base}/tasks/${taskDetail.id}/links/${linkId}`, {
        method: 'DELETE',
      });
      setTaskDetail(updated);
      setTasks((current) =>
        current.map((task) => (task.id === updated.id ? { ...task, links: updated.links } : task)),
      );
      setMessageTone('success');
      setMessage(t('tasks.externalLinkRemoved'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.externalLinkFailed'));
    } finally {
      setLinkSaving(false);
    }
  }

  async function addRelationship() {
    if (!taskDetail || !relatedTaskCandidate || relationshipSaving) return;
    setRelationshipSaving(true);
    try {
      const updated = await api<TaskDetail>(`${base}/tasks/${taskDetail.id}/relationships`, {
        method: 'POST',
        body: JSON.stringify({ relatedTaskId: relatedTaskCandidate.id, type: relationshipType }),
      });
      setTaskDetail(updated);
      setRelatedTaskCandidate(null);
      await refresh();
      setMessageTone('success');
      setMessage(t('tasks.relationshipAdded'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.relationshipFailed'));
    } finally {
      setRelationshipSaving(false);
    }
  }

  async function removeRelationship(relationshipId: string) {
    if (!taskDetail || relationshipSaving) return;
    setRelationshipSaving(true);
    try {
      const updated = await api<TaskDetail>(
        `${base}/tasks/${taskDetail.id}/relationships/${relationshipId}`,
        { method: 'DELETE' },
      );
      setTaskDetail(updated);
      await refresh();
      setMessageTone('success');
      setMessage(t('tasks.relationshipRemoved'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.relationshipFailed'));
    } finally {
      setRelationshipSaving(false);
    }
  }

  function openTaskDetail(task: Task) {
    selectTaskDetail(task.task_key ?? task.id);
  }

  function openTaskCreator() {
    setCreatorDirty(false);
    setCreatorSource(undefined);
    setCreateParentCandidate(null);
    setCreatorOpen(true);
    void loadAssignees();
  }

  function openTaskClone(task: Task) {
    if (taskDetail?.id === task.id && taskDetailHasDraft) {
      setMessageTone('error');
      setMessage(t('tasks.cloneBlockedByDraft'));
      return;
    }
    const source = taskDetail?.id === task.id ? taskDetail : task;
    setCreatorSource(source);
    setCreateParentCandidate(
      source.parent_task_id
        ? {
            id: source.parent_task_id,
            task_key: source.parent_task_key ?? source.parent_task_id,
            title: source.parent_task_title ?? t('tasks.unknownParent'),
            parent_task_id: null,
            child_count: 0,
          }
        : null,
    );
    setCreatorDirty(true);
    setCreatorOpen(true);
    setTaskDetailDirtyFields(new Set());
    setSelectedTaskId('');
    void loadAssignees();
  }

  function clearDragState() {
    setDraggingTaskId('');
    setDragOverStatus(undefined);
    setDragBeforeTaskId('');
  }

  function startTaskDrag(event: ReactDragEvent<HTMLElement>, task: Task) {
    const target = event.target;
    if (
      selectionMode ||
      !allowed(user, 'task.update') ||
      pendingTaskIds.has(task.id) ||
      (target instanceof Element && Boolean(target.closest('button, select, input, textarea, a')))
    ) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', task.id);
    setDraggingTaskId(task.id);
    setBoardAnnouncement(t('tasks.dragging', { title: task.title }));
  }

  function dragOverColumn(event: ReactDragEvent<HTMLElement>, status: Status) {
    if (selectionMode) return;
    const task = tasks.find((candidate) => candidate.id === draggingTaskId);
    if (task && !canTransition(task.status, status)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dragOverStatus !== status) setDragOverStatus(status);
    if (dragBeforeTaskId) setDragBeforeTaskId('');
  }

  function dropTask(event: ReactDragEvent<HTMLElement>, status: Status) {
    if (selectionMode) return;
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain') || draggingTaskId;
    const task = tasks.find((candidate) => candidate.id === taskId);
    clearDragState();
    if (task) void moveTask(task, status);
  }

  function dragOverTask(event: ReactDragEvent<HTMLElement>, target: Task) {
    event.stopPropagation();
    if (selectionMode || target.id === draggingTaskId) return;
    const task = tasks.find((candidate) => candidate.id === draggingTaskId);
    if (!task || !canTransition(task.status, target.status)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverStatus(target.status);
    setDragBeforeTaskId(target.id);
  }

  function dropTaskBefore(event: ReactDragEvent<HTMLElement>, target: Task) {
    event.stopPropagation();
    if (selectionMode) return;
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain') || draggingTaskId;
    const task = tasks.find((candidate) => candidate.id === taskId);
    clearDragState();
    if (task && task.id !== target.id) void moveTask(task, target.status, target.id);
  }

  function handleTaskKeyDown(event: ReactKeyboardEvent<HTMLElement>, task: Task) {
    if (
      selectionMode &&
      (event.key === 'Enter' || event.key === ' ') &&
      event.currentTarget === event.target
    ) {
      event.preventDefault();
      toggleTaskSelection(task.id, event.shiftKey);
      return;
    }
    if (
      event.altKey &&
      allowed(user, 'task.update') &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      event.preventDefault();
      rankTaskByStep(task, event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (
      (event.key === 'Enter' || event.key === ' ') &&
      event.currentTarget === event.target &&
      !event.altKey
    ) {
      event.preventDefault();
      openTaskDetail(task);
      return;
    }
    if (
      event.altKey &&
      allowed(user, 'task.update') &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      const currentIndex = columns.findIndex((column) => column.status === task.status);
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const candidates = columns
        .slice(direction > 0 ? currentIndex + 1 : 0, direction > 0 ? undefined : currentIndex)
        .filter((column) => canTransition(task.status, column.status));
      const next = direction > 0 ? candidates[0] : candidates.at(-1);
      if (next) {
        event.preventDefault();
        void changeStatus(task, next.status);
      }
      return;
    }
    openTaskMenuFromKeyboard(event, task);
  }

  async function copyTaskValue(label: string, value: string) {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard is unavailable.');
      await navigator.clipboard.writeText(value);
      setMessageTone('success');
      setMessage(t('common.copied', { label }));
    } catch {
      setMessageTone('error');
      setMessage(t('common.copyDenied'));
    }
  }

  function taskShareUrl(taskIdentifier: string) {
    const url = new URL(
      `/workspaces/${encodeURIComponent(workspaceId!)}/projects/${encodeURIComponent(projectId!)}/tasks`,
      window.location.origin,
    );
    url.searchParams.set('task', taskIdentifier);
    return url.toString();
  }

  function taskContextItems(task: Task): ContextMenuItem[] {
    return [
      ...(!task.archived_at && allowed(user, 'task.update')
        ? [
            {
              label: t('tasks.rankTop'),
              icon: '↑',
              shortcut: 'Alt+↑',
              onSelect: () => void moveTask(task, task.status, undefined, 'top'),
            },
            {
              label: t('tasks.rankBottom'),
              icon: '↓',
              shortcut: 'Alt+↓',
              onSelect: () => void moveTask(task, task.status, undefined, 'bottom'),
            },
          ]
        : []),
      ...(!task.archived_at && allowed(user, 'task.update')
        ? columns
            .filter((column) => canTransition(task.status, column.status))
            .map((column, index) => ({
              label: t('tasks.moveTo', { status: column.label }),
              icon: task.status === column.status ? '✓' : '→',
              disabled: task.status === column.status,
              separatorBefore: index === 0,
              onSelect: () => void changeStatus(task, column.status),
            }))
        : []),
      ...(allowed(user, 'task.create') && !task.archived_at
        ? [
            {
              label: t('tasks.cloneTask'),
              icon: '⧉',
              separatorBefore: true,
              onSelect: () => openTaskClone(task),
            },
          ]
        : []),
      {
        label: t('tasks.copyTitle'),
        icon: '⧉',
        separatorBefore: !allowed(user, 'task.create') || Boolean(task.archived_at),
        onSelect: () => void copyTaskValue(t('tasks.title'), task.title),
      },
      ...(task.task_key
        ? [
            {
              label: t('tasks.copyKey'),
              icon: '#',
              onSelect: () => void copyTaskValue(t('tasks.key'), task.task_key!),
            },
          ]
        : []),
      {
        label: t('tasks.copyLink'),
        icon: '⌁',
        onSelect: () =>
          void copyTaskValue(t('tasks.taskLink'), taskShareUrl(task.task_key ?? task.id)),
      },
      {
        label: t('tasks.copyId'),
        icon: '⌗',
        onSelect: () => void copyTaskValue('ID', task.id),
      },
      ...(allowed(user, task.archived_at ? 'task.restore' : 'task.archive')
        ? [
            {
              label: task.archived_at ? t('tasks.restore') : t('tasks.archive'),
              icon: task.archived_at ? '↺' : '×',
              tone: task.archived_at ? ('default' as const) : ('danger' as const),
              separatorBefore: true,
              onSelect: () =>
                void mutate(() =>
                  api(`${base}/tasks/${task.id}/${task.archived_at ? 'restore' : 'archive'}`, {
                    method: task.archived_at ? 'POST' : 'PATCH',
                    body: JSON.stringify({
                      rowVersion: task.row_version,
                      ...(task.archived_at ? {} : { reason: 'Archived from task context menu' }),
                    }),
                  }),
                ),
            },
          ]
        : []),
    ];
  }

  function openTaskMenu(event: ReactMouseEvent<HTMLElement>, task: Task) {
    setContextMenu(menuFromPointer(event, task.title, taskContextItems(task)));
  }

  function openTaskMenuFromKeyboard(event: ReactKeyboardEvent<HTMLElement>, task: Task) {
    const menu = menuFromKeyboard(event, task.title, taskContextItems(task));
    if (menu) setContextMenu(menu);
  }

  const availableAssignees = useMemo(() => {
    const people = new Map(assignees.map((assignee) => [assignee.id, assignee]));
    for (const task of tasks) {
      if (task.assignee_id && task.assignee_name && !people.has(task.assignee_id)) {
        people.set(task.assignee_id, {
          id: task.assignee_id,
          displayName: task.assignee_name,
          email: '',
        });
      }
    }
    if (
      taskDetail?.assignee_id &&
      taskDetail.assignee_name &&
      !people.has(taskDetail.assignee_id)
    ) {
      people.set(taskDetail.assignee_id, {
        id: taskDetail.assignee_id,
        displayName: taskDetail.assignee_name,
        email: '',
      });
    }
    return [...people.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    );
  }, [assignees, taskDetail, tasks]);
  const visibleTasks = useMemo(() => {
    const query = taskQuery.trim().toLocaleLowerCase(locale);
    return tasks.filter((task) => {
      const matchesQuery =
        !query ||
        `${task.task_key ?? ''} ${task.title} ${task.description} ${task.assignee_name ?? ''} ${(task.labels ?? []).join(' ')} ${task.parent_task_key ?? ''} ${task.parent_task_title ?? ''}`
          .toLocaleLowerCase(locale)
          .includes(query);
      const matchesAssignee =
        assigneeFilter === 'all' ||
        (assigneeFilter === 'mine' && task.assignee_id === user.id) ||
        (assigneeFilter === 'unassigned' && !task.assignee_id) ||
        task.assignee_id === assigneeFilter;
      const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter;
      const matchesStatus = !statusFilters.length || statusFilters.includes(task.status);
      const matchesLabel = labelFilter === 'all' || task.labels?.includes(labelFilter);
      return matchesQuery && matchesAssignee && matchesPriority && matchesStatus && matchesLabel;
    });
  }, [
    assigneeFilter,
    labelFilter,
    locale,
    priorityFilter,
    statusFilters,
    taskQuery,
    tasks,
    user.id,
  ]);
  const bulkStatusOptions = useMemo(() => {
    const selected = tasks.filter((task) => selectedTaskIds.has(task.id));
    if (!selected.length) return columns;
    return columns.filter((column) =>
      selected.every((task) => canTransition(task.status, column.status)),
    );
  }, [canTransition, columns, selectedTaskIds, tasks]);
  const filtersActive = Boolean(
    taskQuery.trim() ||
    assigneeFilter !== 'all' ||
    priorityFilter !== 'all' ||
    statusFilters.length > 0 ||
    labelFilter !== 'all',
  );
  const openStatusKeys = workflow.statuses
    .filter((status) => status.category !== 'done')
    .map((status) => status.key);
  const statusFilterValue =
    statusFilters.length === 0
      ? 'all'
      : statusFilters.length === openStatusKeys.length &&
          openStatusKeys.every((status) => statusFilters.includes(status))
        ? 'open'
        : statusFilters.length === 1 &&
            workflow.statuses.some((status) => status.key === statusFilters[0])
          ? statusFilters[0]!
          : 'custom';
  const selectedSavedFilter = savedFilters.find((filter) => filter.id === selectedFilterId);
  const calendar = useMemo(
    () =>
      visibleTasks
        .filter((task) => !task.archived_at && task.due_date)
        .sort((left, right) => left.due_date!.localeCompare(right.due_date!)),
    [visibleTasks],
  );
  const listTasks = useMemo(() => visibleTasks.filter((task) => !task.archived_at), [visibleTasks]);
  const taskGroups = useMemo(() => {
    if (taskGroup === 'none') return [{ key: 'all', label: '', rank: 0, tasks: listTasks }];
    const byId = new Map(listTasks.map((task) => [task.id, task]));
    const groups = new Map<string, { key: string; label: string; rank: number; tasks: Task[] }>();
    for (const task of listTasks) {
      const basis = (task.parent_task_id && byId.get(task.parent_task_id)) || task;
      let key: string;
      let label: string;
      let rank = 0;
      if (taskGroup === 'status') {
        const status = workflow.statuses.find((candidate) => candidate.key === basis.status);
        key = `status:${basis.status}`;
        label = status ? defaultStatusLabel(status) : basis.status;
        rank = status?.position ?? 999;
      } else if (taskGroup === 'priority') {
        key = `priority:${basis.priority}`;
        label = priorityLabel(basis.priority);
        rank = { critical: 0, high: 1, medium: 2, low: 3 }[basis.priority];
      } else {
        key = `assignee:${basis.assignee_id ?? 'unassigned'}`;
        label = basis.assignee_name ?? t('tasks.unassigned');
      }
      const group = groups.get(key) ?? { key, label, rank, tasks: [] };
      group.tasks.push(task);
      groups.set(key, group);
    }
    return [...groups.values()].sort(
      (left, right) => left.rank - right.rank || left.label.localeCompare(right.label, locale),
    );
  }, [defaultStatusLabel, listTasks, locale, priorityLabel, t, taskGroup, workflow.statuses]);
  const detailNavigationIndex = taskDetail
    ? listTasks.findIndex((task) => task.id === taskDetail.id)
    : -1;
  const detailNeighbors = [
    detailNavigationIndex > 0 ? listTasks[detailNavigationIndex - 1] : undefined,
    detailNavigationIndex >= 0 ? listTasks[detailNavigationIndex + 1] : undefined,
  ];
  const navigateTaskDetail = (task: Task | undefined) => {
    if (task) selectTaskDetail(task.task_key ?? task.id);
  };

  function handleListTaskKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, task: Task) {
    if (
      event.altKey &&
      taskSort === 'rank' &&
      allowed(user, 'task.update') &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      event.preventDefault();
      rankTaskByStep(task, event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (selectionMode) toggleTaskSelection(task.id, event.shiftKey);
      else openTaskDetail(task);
      return;
    }
    const direction =
      event.key === 'j' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'k' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (!direction) {
      openTaskMenuFromKeyboard(event, task);
      return;
    }
    event.preventDefault();
    const rows = event.currentTarget
      .closest('[data-task-list]')
      ?.querySelectorAll<HTMLElement>('[data-sid]');
    if (!rows) return;
    const index = [...rows].indexOf(event.currentTarget);
    rows[Math.max(0, Math.min(rows.length - 1, index + direction))]?.focus();
  }

  function changeTaskSort(next: TaskSort) {
    if (next === taskSort) {
      setTaskSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setTaskSort(next);
      setTaskSortDirection('asc');
    }
    setSavedFilterSelection('');
  }

  function toggleTaskListColumn(column: TaskListColumn, visible: boolean) {
    if (column === 'title') return;
    setTaskListColumns((current) =>
      visible ? [...current, column] : current.filter((candidate) => candidate !== column),
    );
    setSavedFilterSelection('');
  }

  function moveTaskListColumn(column: TaskListColumn, direction: -1 | 1) {
    setTaskListColumns((current) => {
      const index = current.indexOf(column);
      const target = Math.max(1, Math.min(current.length - 1, index + direction));
      if (index < 1 || target === index) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setSavedFilterSelection('');
  }

  useEffect(() => {
    if (!selectedTaskId) return;
    const handleTaskShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      const root = taskDetailDialogRef.current;
      if (!root) return;
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        const navigation = root.querySelector<HTMLButtonElement>(
          `[aria-keyshortcuts="Alt+${event.key}"]`,
        );
        if (!navigation || navigation.disabled) return;
        event.preventDefault();
        navigation.click();
        return;
      }
      if (event.altKey) return;
      if (event.key.toLocaleLowerCase() === 'w') {
        const watch = root.querySelector<HTMLButtonElement>('[aria-keyshortcuts="W"]');
        if (!watch || watch.disabled) return;
        event.preventDefault();
        watch.click();
        return;
      }
      if (event.key.toLocaleLowerCase() === 'm') {
        const composer = root.querySelector<HTMLTextAreaElement>('[data-task-comment-composer]');
        if (!composer || composer.disabled) return;
        event.preventDefault();
        composer.focus();
      }
    };
    window.addEventListener('keydown', handleTaskShortcut);
    return () => window.removeEventListener('keydown', handleTaskShortcut);
  }, [selectedTaskId, taskDetailDialogRef]);

  return (
    <>
      <Link className="text-sm text-slate-400 hover:text-sky-300" to={base}>
        ← {t('common.projectBack')}
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('tasks.heading')}
          </h1>
          <p className="mt-2 text-slate-400">
            {t(view === 'list' ? 'tasks.listHelp' : 'tasks.detailHelp')}
          </p>
          {allowed(user, 'task.update') && view === 'board' && (
            <p className="mt-2 text-xs text-slate-500">{t('tasks.dragHint')}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {allowed(user, 'task.create') && (
            <Button aria-label={t('tasks.create')} onClick={openTaskCreator} type="button">
              + {t('tasks.create')}
            </Button>
          )}
          {allowed(user, 'task.update') && view !== 'calendar' && (
            <button
              aria-label={selectionMode ? t('tasks.exitSelectMode') : t('tasks.selectMode')}
              aria-pressed={selectionMode}
              className={`grid size-9 place-items-center rounded-lg border text-sm transition ${selectionMode ? 'border-sky-400 bg-sky-400/15 text-sky-200' : 'border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`}
              onClick={() => {
                setSelectionMode((current) => !current);
                clearTaskSelection();
              }}
              title={selectionMode ? t('tasks.exitSelectMode') : t('tasks.selectMode')}
              type="button"
            >
              <span aria-hidden="true">☑</span>
            </button>
          )}
          <Button
            aria-expanded={flowInsightsOpen}
            aria-label={t('tasks.flowInsights')}
            className="grid size-9 min-h-9 place-items-center p-0"
            onClick={() => setFlowInsightsOpen((current) => !current)}
            title={t('tasks.flowInsights')}
            type="button"
            variant={flowInsightsOpen ? 'primary' : 'quiet'}
          >
            <span aria-hidden="true">⌁</span>
          </Button>
          <div
            className="flex gap-1 rounded-xl border border-slate-800 bg-slate-900/55 p-1"
            role="group"
            aria-label={t('tasks.view')}
          >
            <Button
              aria-label={t('tasks.kanban')}
              aria-pressed={view === 'board'}
              className="grid size-8 min-h-8 place-items-center p-0"
              title={t('tasks.kanban')}
              variant={view === 'board' ? 'primary' : 'quiet'}
              onClick={() => {
                setView('board');
                setSavedFilterSelection('');
                setColumnEditorOpen(false);
              }}
            >
              <span aria-hidden="true">▥</span>
            </Button>
            <Button
              aria-label={t('tasks.list')}
              aria-pressed={view === 'list'}
              className="grid size-8 min-h-8 place-items-center p-0"
              title={t('tasks.list')}
              variant={view === 'list' ? 'primary' : 'quiet'}
              onClick={() => {
                setView('list');
                setSavedFilterSelection('');
                setColumnEditorOpen(false);
              }}
            >
              <span aria-hidden="true">☷</span>
            </Button>
            <Button
              aria-label={t('tasks.calendar')}
              aria-pressed={view === 'calendar'}
              className="grid size-8 min-h-8 place-items-center p-0"
              title={t('tasks.calendar')}
              variant={view === 'calendar' ? 'primary' : 'quiet'}
              onClick={() => {
                setView('calendar');
                setSavedFilterSelection('');
                setColumnEditorOpen(false);
                setSelectionMode(false);
                clearTaskSelection();
              }}
            >
              <span aria-hidden="true">▦</span>
            </Button>
          </div>
        </div>
      </div>
      <section
        aria-label={t('tasks.filters')}
        className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/45 p-2"
      >
        <label className="relative min-w-52 flex-1">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-2 text-slate-600"
          >
            ⌕
          </span>
          <span className="sr-only">{t('tasks.search')}</span>
          <input
            aria-label={t('tasks.search')}
            className="min-h-8 w-full rounded-lg border border-slate-800 bg-slate-950 py-1 pl-8 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-400"
            onChange={(event) => {
              setTaskQuery(event.target.value);
              setSavedFilterSelection('');
            }}
            placeholder={t('tasks.searchPlaceholder')}
            type="search"
            value={taskQuery}
          />
        </label>
        <AssigneePicker
          ariaLabel={t('tasks.filterAssignee')}
          base={base}
          className="min-h-8 w-44 rounded-lg border border-slate-800 bg-slate-950 px-2 text-xs text-slate-300 outline-none focus:border-sky-400"
          initialOptions={availableAssignees}
          onChange={(nextValue) => {
            setAssigneeFilter(nextValue);
            setSavedFilterSelection('');
          }}
          specialOptions={[
            { value: 'all', label: t('tasks.allAssignees') },
            { value: 'mine', label: t('tasks.assignedToMe') },
            { value: 'unassigned', label: t('tasks.unassigned') },
          ]}
          value={assigneeFilter}
        />
        <select
          aria-label={t('tasks.filterPriority')}
          className="min-h-8 rounded-lg border border-slate-800 bg-slate-950 px-2 text-xs text-slate-300 outline-none focus:border-sky-400"
          onChange={(event) => {
            setPriorityFilter(event.target.value);
            setSavedFilterSelection('');
          }}
          value={priorityFilter}
        >
          <option value="all">{t('tasks.allPriorities')}</option>
          {(['low', 'medium', 'high', 'critical'] as const).map((priority) => (
            <option key={priority} value={priority}>
              {priorityLabel(priority)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('tasks.filterStatus')}
          className="min-h-8 max-w-44 rounded-lg border border-slate-800 bg-slate-950 px-2 text-xs text-slate-300 outline-none focus:border-sky-400"
          onChange={(event) => {
            setStatusFilters(
              event.target.value === 'all'
                ? []
                : event.target.value === 'open'
                  ? openStatusKeys
                  : [event.target.value],
            );
            setSavedFilterSelection('');
          }}
          value={statusFilterValue}
        >
          <option value="all">{t('tasks.allStatuses')}</option>
          <option value="open">{t('tasks.hideDone')}</option>
          {statusFilterValue === 'custom' && (
            <option value="custom">
              {t('tasks.selectedStatuses', { count: statusFilters.length })}
            </option>
          )}
          {workflow.statuses.map((status) => (
            <option key={status.key} value={status.key}>
              {defaultStatusLabel(status)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('tasks.filterLabel')}
          className="min-h-8 max-w-44 rounded-lg border border-slate-800 bg-slate-950 px-2 text-xs text-slate-300 outline-none focus:border-sky-400"
          onChange={(event) => {
            setLabelFilter(event.target.value);
            setSavedFilterSelection('');
          }}
          value={labelFilter}
        >
          <option value="all">{t('tasks.allLabels')}</option>
          {labelFilter !== 'all' && !taskLabels.some((label) => label.value === labelFilter) ? (
            <option value={labelFilter}>{labelFilter}</option>
          ) : null}
          {taskLabels.map((label) => (
            <option key={label.value} value={label.value}>
              {label.value} · {label.count}
            </option>
          ))}
        </select>
        {view === 'list' && (
          <>
            <select
              aria-label={t('tasks.groupBy')}
              className="min-h-8 max-w-40 rounded-lg border border-slate-800 bg-slate-950 px-2 text-xs text-slate-300 outline-none focus:border-sky-400"
              onChange={(event) => {
                setTaskGroup(event.target.value as TaskGroup);
                setCollapsedTaskGroups(new Set());
                setSavedFilterSelection('');
              }}
              title={t('tasks.groupBy')}
              value={taskGroup}
            >
              <option value="none">{t('tasks.groupNone')}</option>
              <option value="status">{t('tasks.groupStatus')}</option>
              <option value="priority">{t('tasks.groupPriority')}</option>
              <option value="assignee">{t('tasks.groupAssignee')}</option>
            </select>
            <div className="relative" ref={columnEditorRef}>
              <IconAction
                aria-controls="task-list-column-editor"
                aria-expanded={columnEditorOpen}
                aria-haspopup="dialog"
                icon="▤"
                label={t('tasks.configureColumns')}
                onClick={() => setColumnEditorOpen((current) => !current)}
                tone={columnEditorOpen ? 'accent' : 'default'}
                tooltipAlign="end"
              />
              {columnEditorOpen && (
                <div
                  aria-label={t('tasks.columnsHeading')}
                  className="absolute right-0 top-9 z-50 w-72 rounded-xl border border-slate-700 bg-slate-950 p-3 shadow-2xl"
                  id="task-list-column-editor"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setColumnEditorOpen(false);
                  }}
                  role="dialog"
                >
                  <p className="text-xs font-semibold text-slate-200">
                    {t('tasks.columnsHeading')}
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-slate-500">
                    {t('tasks.columnsHint')}
                  </p>
                  <div className="mt-2 divide-y divide-slate-800">
                    {defaultTaskListColumns.map((column) => {
                      const index = taskListColumns.indexOf(column);
                      const visible = index >= 0;
                      const label = taskListColumnLabel(column);
                      return (
                        <div className="flex min-h-9 items-center gap-2" key={column}>
                          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-slate-300">
                            <input
                              aria-label={
                                column === 'title'
                                  ? t('tasks.columnRequired', { column: label })
                                  : visible
                                    ? t('tasks.hideColumn', { column: label })
                                    : t('tasks.showColumn', { column: label })
                              }
                              checked={visible}
                              disabled={column === 'title'}
                              onChange={(event) =>
                                toggleTaskListColumn(column, event.target.checked)
                              }
                              type="checkbox"
                            />
                            <span className="truncate">{label}</span>
                            {column === 'title' && (
                              <span className="text-[9px] text-slate-600">
                                {t('common.required')}
                              </span>
                            )}
                          </label>
                          {visible && column !== 'title' && (
                            <div className="flex items-center gap-0.5">
                              <IconAction
                                disabled={index <= 1}
                                icon="←"
                                label={t('tasks.moveColumnLeft', { column: label })}
                                onClick={() => moveTaskListColumn(column, -1)}
                              />
                              <IconAction
                                disabled={index === taskListColumns.length - 1}
                                icon="→"
                                label={t('tasks.moveColumnRight', { column: label })}
                                onClick={() => moveTaskListColumn(column, 1)}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
        <div className="relative flex items-center gap-1" ref={savedFilterPickerRef}>
          <select
            aria-label={t('tasks.savedFilters')}
            className="min-h-8 max-w-44 rounded-lg border border-slate-800 bg-slate-950 px-2 text-xs text-slate-300 outline-none focus:border-sky-400"
            onChange={(event) => applySavedFilter(event.target.value)}
            value={selectedFilterId}
          >
            <option value="">{t('tasks.noSavedFilter')}</option>
            {savedFilters.map((filter) => (
              <option key={filter.id} value={filter.id}>
                {filter.favorite ? '★ ' : ''}
                {filter.name}
                {filter.visibility === 'project'
                  ? ` · ${t('tasks.sharedBy', { name: filter.owner_name })}`
                  : ''}
              </option>
            ))}
          </select>
          <IconAction
            aria-controls="saved-filter-picker"
            aria-expanded={savedFilterPickerOpen}
            aria-haspopup="dialog"
            icon="⌕"
            label={t('tasks.findSavedFilters')}
            onClick={() => setSavedFilterPickerOpen((current) => !current)}
            tone={savedFilterPickerOpen ? 'accent' : 'default'}
          />
          {savedFilterPickerOpen && (
            <div
              aria-label={t('tasks.findSavedFilters')}
              className="absolute right-0 top-9 z-50 w-80 rounded-xl border border-slate-700 bg-slate-950 p-3 shadow-2xl"
              id="saved-filter-picker"
              role="dialog"
            >
              <label className="relative block">
                <span aria-hidden="true" className="absolute left-3 top-2 text-slate-600">
                  ⌕
                </span>
                <span className="sr-only">{t('tasks.searchSavedFilters')}</span>
                <input
                  aria-label={t('tasks.searchSavedFilters')}
                  autoFocus
                  className="min-h-8 w-full rounded-lg border border-slate-800 bg-slate-900 py-1 pl-8 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-400"
                  onChange={(event) => setSavedFilterQuery(event.target.value)}
                  placeholder={t('tasks.savedFilterSearchPlaceholder')}
                  type="search"
                  value={savedFilterQuery}
                />
              </label>
              <p className="mt-2 text-[10px] text-slate-500">
                {t('tasks.savedFilterResultCount', {
                  shown: savedFilterResults.length,
                  total: savedFilterPageInfo.total,
                })}
              </p>
              {savedFilterLoadError && (
                <p className="mt-2 text-xs text-rose-300">{savedFilterLoadError}</p>
              )}
              <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                {savedFilterLoading === 'page' ? (
                  <p className="px-2 py-3 text-xs text-slate-500">{t('common.loading')}</p>
                ) : savedFilterResults.length ? (
                  savedFilterResults.map((filter) => (
                    <button
                      aria-pressed={filter.id === selectedFilterId}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition ${filter.id === selectedFilterId ? 'bg-sky-400/10 text-sky-200' : 'text-slate-300 hover:bg-slate-900'}`}
                      key={filter.id}
                      onClick={() => {
                        applySavedFilter(filter.id);
                        setSavedFilterPickerOpen(false);
                      }}
                      type="button"
                    >
                      <span aria-hidden="true" className="w-3 text-amber-300">
                        {filter.favorite ? '★' : ''}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{filter.name}</span>
                      <span className="shrink-0 text-[10px] text-slate-600">
                        {filter.visibility === 'project'
                          ? t('tasks.sharedBy', { name: filter.owner_name })
                          : t('tasks.personalFilter')}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="px-2 py-3 text-xs text-slate-500">
                    {t('tasks.noSavedFilterMatches')}
                  </p>
                )}
              </div>
              {savedFilterPageInfo.hasNext && savedFilterLoading !== 'page' && (
                <button
                  className="mt-2 min-h-8 w-full rounded-lg border border-slate-800 px-3 text-xs text-slate-300 hover:bg-slate-900 disabled:opacity-50"
                  disabled={savedFilterLoading === 'more'}
                  onClick={() => void loadMoreSavedFilters()}
                  type="button"
                >
                  {savedFilterLoading === 'more'
                    ? t('common.loading')
                    : t('tasks.loadMoreSavedFilters', {
                        shown: savedFilterResults.length,
                        total: savedFilterPageInfo.total,
                      })}
                </button>
              )}
            </div>
          )}
        </div>
        {selectedSavedFilter && (
          <IconAction
            aria-pressed={selectedSavedFilter.favorite}
            disabled={filterSaving}
            icon={selectedSavedFilter.favorite ? '★' : '☆'}
            label={
              selectedSavedFilter.favorite ? t('tasks.unfavoriteFilter') : t('tasks.favoriteFilter')
            }
            onClick={() => void toggleSelectedFilterFavorite()}
            tone={selectedSavedFilter.favorite ? 'accent' : 'default'}
          />
        )}
        {selectedSavedFilter?.is_owner && (
          <IconAction
            disabled={filterSaving}
            icon="↻"
            label={t('tasks.updateFilter')}
            onClick={() => void updateSelectedFilter()}
          />
        )}
        <IconAction
          icon="＋"
          label={t('tasks.saveFilter')}
          onClick={() => {
            setSavedFilterVisibility('personal');
            setFilterEditorOpen((current) => !current);
          }}
        />
        {selectedSavedFilter?.is_owner && (
          <IconAction
            disabled={filterSaving}
            icon="⌫"
            label={t('tasks.deleteFilter')}
            onClick={() => void deleteSelectedFilter()}
            tone="danger"
          />
        )}
        {view === 'list' && taskSort !== 'rank' && (
          <IconAction
            icon="↕"
            label={t('tasks.rankOrder')}
            onClick={() => {
              setTaskSort('rank');
              setTaskSortDirection('asc');
              setSavedFilterSelection('');
            }}
          />
        )}
        <span className="ml-auto text-[10px] text-slate-600">
          {t('tasks.filteredCount', {
            count: visibleTasks.filter((task) => !task.archived_at).length,
          })}
        </span>
        {filtersActive && (
          <IconAction
            icon="×"
            label={t('tasks.clearFilters')}
            onClick={() => {
              setTaskQuery('');
              setAssigneeFilter('all');
              setPriorityFilter('all');
              setStatusFilters([]);
              setLabelFilter('all');
              setSavedFilterSelection('');
            }}
          />
        )}
      </section>
      {filterEditorOpen && (
        <form
          aria-label={t('tasks.saveFilter')}
          className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-sky-400/25 bg-slate-900/70 p-3"
          onSubmit={(event) => void saveCurrentFilter(event)}
        >
          <label className="grid min-w-56 flex-1 gap-1 text-xs text-slate-400">
            <FormFieldLabel required>{t('tasks.filterName')}</FormFieldLabel>
            <input
              autoFocus
              className={inputClass}
              maxLength={80}
              onChange={(event) => setSavedFilterName(event.target.value)}
              placeholder={t('tasks.filterNamePlaceholder')}
              required
              value={savedFilterName}
            />
          </label>
          {allowed(user, 'project.update') && (
            <label className="grid gap-1 text-xs text-slate-400">
              <FormFieldLabel required>{t('tasks.filterVisibility')}</FormFieldLabel>
              <select
                className={inputClass}
                onChange={(event) =>
                  setSavedFilterVisibility(event.target.value as 'personal' | 'project')
                }
                value={savedFilterVisibility}
              >
                <option value="personal">{t('tasks.personalFilter')}</option>
                <option value="project">{t('tasks.projectFilter')}</option>
              </select>
            </label>
          )}
          <Button disabled={filterSaving || !savedFilterName.trim()} type="submit">
            {t('tasks.createFilter')}
          </Button>
          <IconAction
            icon="×"
            label={t('common.cancel')}
            onClick={() => setFilterEditorOpen(false)}
          />
        </form>
      )}
      {flowInsightsOpen && (
        <section
          aria-label={t('tasks.flowInsights')}
          className="mt-3 rounded-xl border border-sky-400/20 bg-slate-900/60 p-4 shadow-lg shadow-slate-950/10"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">{t('tasks.flowInsights')}</h2>
              <p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">
                {t('tasks.flowInsightsScope', {
                  staleDays: flowInsights?.stale_after_days ?? 7,
                })}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <label className="sr-only" htmlFor="flow-window-days">
                {t('tasks.flowWindow')}
              </label>
              <select
                className="min-h-8 rounded-lg border border-slate-800 bg-slate-950 px-2 text-xs text-slate-300 outline-none focus:border-sky-400"
                id="flow-window-days"
                onChange={(event) => setFlowWindowDays(Number(event.target.value))}
                value={flowWindowDays}
              >
                {[30, 60, 90].map((days) => (
                  <option key={days} value={days}>
                    {t('tasks.flowPastDays', { count: days })}
                  </option>
                ))}
              </select>
              <IconAction
                disabled={flowInsightsLoading}
                icon="↻"
                label={t('tasks.refreshFlowInsights')}
                onClick={() => void loadFlowInsights()}
              />
              <IconAction
                icon="×"
                label={t('tasks.closeFlowInsights')}
                onClick={() => setFlowInsightsOpen(false)}
              />
            </div>
          </div>
          {flowInsightsLoading && !flowInsights && (
            <p aria-live="polite" className="mt-4 text-xs text-slate-400" role="status">
              {t('common.loading')}
            </p>
          )}
          {flowInsightsError && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2">
              <p className="text-xs text-rose-200">{flowInsightsError}</p>
              <Button onClick={() => void loadFlowInsights()} type="button" variant="quiet">
                {t('common.retry')}
              </Button>
            </div>
          )}
          {flowInsights && (
            <>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                {[
                  {
                    label: t('tasks.flowActiveWork'),
                    value: String(flowInsights.summary.active_count),
                    note: t('tasks.flowStaleWork', {
                      count: flowInsights.summary.stale_count,
                    }),
                    alert: flowInsights.summary.stale_count > 0,
                  },
                  {
                    label: t('tasks.flowWip'),
                    value: String(flowInsights.summary.wip_count),
                    note: t('tasks.flowInProgressStatuses'),
                    alert: flowInsights.statuses.some(
                      (status) =>
                        status.wip_limit !== null && status.current_count > status.wip_limit,
                    ),
                  },
                  {
                    label: t('tasks.flowThroughput'),
                    value: String(flowInsights.summary.completed_count),
                    note: t('tasks.flowPastDays', { count: flowInsights.window_days }),
                    alert: false,
                  },
                  {
                    label: t('tasks.flowMedianCycle'),
                    value: flowDuration(flowInsights.summary.median_cycle_hours, locale, t),
                    note: t('tasks.flowWorkingTime'),
                    alert: false,
                  },
                  {
                    label: t('tasks.flowP85Cycle'),
                    value: flowDuration(flowInsights.summary.p85_cycle_hours, locale, t),
                    note: t('tasks.flowPredictability'),
                    alert: false,
                  },
                ].map((metric) => (
                  <article
                    className={`rounded-lg border px-3 py-2 ${metric.alert ? 'border-amber-400/30 bg-amber-400/5' : 'border-slate-800 bg-slate-950/55'}`}
                    key={metric.label}
                  >
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">
                      {metric.label}
                    </p>
                    <strong
                      className={`mt-1 block text-xl ${metric.alert ? 'text-amber-200' : 'text-slate-100'}`}
                    >
                      {metric.value}
                    </strong>
                    <p className="mt-0.5 text-[10px] text-slate-600">{metric.note}</p>
                  </article>
                ))}
              </div>
              <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
                <section
                  aria-label={t('tasks.cumulativeFlow')}
                  className="rounded-lg border border-slate-800 bg-slate-950/40 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-semibold text-slate-300">
                        {t('tasks.cumulativeFlow')}
                      </h3>
                      <p className="mt-1 text-[10px] leading-4 text-slate-500">
                        {t('tasks.cumulativeFlowHelp')}
                      </p>
                    </div>
                    {flowInsights.flow_series.length > 0 && (
                      <span className="text-[10px] text-slate-600">
                        {new Intl.DateTimeFormat(locale, {
                          day: 'numeric',
                          month: 'short',
                          timeZone: 'UTC',
                        }).format(new Date(`${flowInsights.flow_series[0]!.date}T00:00:00Z`))}
                        {' — '}
                        {new Intl.DateTimeFormat(locale, {
                          day: 'numeric',
                          month: 'short',
                          timeZone: 'UTC',
                        }).format(new Date(`${flowInsights.flow_series.at(-1)!.date}T00:00:00Z`))}
                      </span>
                    )}
                  </div>
                  {flowInsights.flow_series.length > 0 ? (
                    <>
                      <div className="mt-3 overflow-hidden rounded-md border border-slate-800/80 bg-slate-950">
                        <svg
                          aria-label={t('tasks.cumulativeFlowLabel', {
                            count: flowInsights.window_days,
                          })}
                          className="h-44 w-full"
                          preserveAspectRatio="none"
                          role="img"
                          viewBox="0 0 100 40"
                        >
                          {[10, 20, 30].map((position) => (
                            <line
                              key={position}
                              stroke="#1e293b"
                              strokeWidth="0.25"
                              vectorEffect="non-scaling-stroke"
                              x1="0"
                              x2="100"
                              y1={position}
                              y2={position}
                            />
                          ))}
                          {flowLayers.map((layer) => {
                            const statusDefinition = workflow.statuses.find(
                              (candidate) => candidate.key === layer.key,
                            );
                            return (
                              <path
                                d={layer.path}
                                fill={flowStatusFill[layer.color]}
                                fillOpacity={layer.archived ? 0.34 : 0.58}
                                key={layer.key}
                                stroke={flowStatusFill[layer.color]}
                                strokeWidth="0.35"
                                vectorEffect="non-scaling-stroke"
                              >
                                <title>
                                  {t('tasks.cumulativeFlowStatus', {
                                    count: layer.currentCount,
                                    status: statusDefinition
                                      ? defaultStatusLabel(statusDefinition)
                                      : layer.name,
                                  })}
                                </title>
                              </path>
                            );
                          })}
                        </svg>
                      </div>
                      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                        {flowLayers.map((layer) => {
                          const statusDefinition = workflow.statuses.find(
                            (candidate) => candidate.key === layer.key,
                          );
                          const statusName = statusDefinition
                            ? defaultStatusLabel(statusDefinition)
                            : layer.name;
                          return (
                            <li
                              aria-label={t('tasks.cumulativeFlowStatus', {
                                count: layer.currentCount,
                                status: statusName,
                              })}
                              className="flex items-center gap-1.5 text-[10px] text-slate-400"
                              key={layer.key}
                            >
                              <span
                                aria-hidden="true"
                                className="size-2 rounded-sm"
                                style={{ backgroundColor: flowStatusFill[layer.color] }}
                              />
                              <span>{statusName}</span>
                              <strong className="font-semibold text-slate-300">
                                {layer.currentCount}
                              </strong>
                              {layer.archived && (
                                <span className="rounded bg-slate-800 px-1 text-[9px] text-slate-500">
                                  {t('tasks.flowArchivedStatus')}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <p className="mt-3 rounded-md border border-dashed border-slate-800 px-3 py-6 text-center text-xs text-slate-600">
                      {t('tasks.cumulativeFlowEmpty')}
                    </p>
                  )}
                </section>
                <section
                  aria-label={t('tasks.createdVsCompleted')}
                  className="rounded-lg border border-slate-800 bg-slate-950/40 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-semibold text-slate-300">
                        {t('tasks.createdVsCompleted')}
                      </h3>
                      <p className="mt-1 text-[10px] leading-4 text-slate-500">
                        {t('tasks.createdVsCompletedHelp')}
                      </p>
                    </div>
                    {throughput && (
                      <strong
                        className={`shrink-0 text-sm ${throughput.net > 0 ? 'text-amber-300' : throughput.net < 0 ? 'text-emerald-300' : 'text-slate-300'}`}
                        title={t('tasks.netWorkChangeHelp')}
                      >
                        {t('tasks.netWorkChange', {
                          count: throughput.net > 0 ? `+${throughput.net}` : throughput.net,
                        })}
                      </strong>
                    )}
                  </div>
                  {flowInsights.throughput_series.length > 0 && throughput ? (
                    <>
                      <div className="mt-3 overflow-hidden rounded-md border border-slate-800/80 bg-slate-950">
                        <svg
                          aria-label={t('tasks.createdVsCompletedLabel', {
                            completed: throughput.completed,
                            count: flowInsights.window_days,
                            created: throughput.created,
                          })}
                          className="h-32 w-full"
                          preserveAspectRatio="none"
                          role="img"
                          viewBox="0 0 100 40"
                        >
                          {[12, 25, 38].map((position) => (
                            <line
                              key={position}
                              stroke="#1e293b"
                              strokeWidth="0.25"
                              vectorEffect="non-scaling-stroke"
                              x1="0"
                              x2="100"
                              y1={position}
                              y2={position}
                            />
                          ))}
                          <polyline
                            fill="none"
                            points={throughput.createdPoints}
                            stroke="#fbbf24"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.25"
                            vectorEffect="non-scaling-stroke"
                          />
                          <polyline
                            fill="none"
                            points={throughput.completedPoints}
                            stroke="#34d399"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.25"
                            vectorEffect="non-scaling-stroke"
                          />
                        </svg>
                      </div>
                      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
                        <li className="flex items-center gap-1.5 text-slate-400">
                          <span aria-hidden="true" className="h-0.5 w-3 bg-amber-400" />
                          {t('tasks.createdWork')}
                          <strong className="text-slate-300">{throughput.created}</strong>
                        </li>
                        <li className="flex items-center gap-1.5 text-slate-400">
                          <span aria-hidden="true" className="h-0.5 w-3 bg-emerald-400" />
                          {t('tasks.completedWork')}
                          <strong className="text-slate-300">{throughput.completed}</strong>
                        </li>
                      </ul>
                    </>
                  ) : (
                    <p className="mt-3 rounded-md border border-dashed border-slate-800 px-3 py-6 text-center text-xs text-slate-600">
                      {t('tasks.createdVsCompletedEmpty')}
                    </p>
                  )}
                </section>
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
                <section aria-label={t('tasks.flowStatusAging')}>
                  <h3 className="text-xs font-semibold text-slate-300">
                    {t('tasks.flowStatusAging')}
                  </h3>
                  <div className="mt-2 space-y-2">
                    {flowInsights.statuses.map((status) => {
                      const statusDefinition = workflow.statuses.find(
                        (candidate) => candidate.key === status.key,
                      );
                      const statusName = statusDefinition
                        ? defaultStatusLabel(statusDefinition)
                        : status.name;
                      const maximumAge = Math.max(
                        1,
                        ...flowInsights.statuses.map(
                          (candidate) => candidate.oldest_age_hours ?? 0,
                        ),
                      );
                      const overloaded =
                        status.wip_limit !== null && status.current_count > status.wip_limit;
                      return (
                        <div
                          aria-label={t('tasks.flowStatusLabel', {
                            status: statusName,
                            count: status.current_count,
                            age: flowDuration(status.average_age_hours, locale, t),
                          })}
                          className="grid grid-cols-[minmax(7rem,0.8fr)_minmax(8rem,1fr)_auto] items-center gap-3 rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-2"
                          key={status.key}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              aria-hidden="true"
                              className={`size-2 shrink-0 rounded-full ${statusDotStyle[status.color]}`}
                            />
                            <span className="truncate text-xs text-slate-300">{statusName}</span>
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[9px] ${overloaded ? 'bg-rose-400/15 text-rose-300' : 'bg-slate-800 text-slate-400'}`}
                              title={
                                status.wip_limit
                                  ? t('tasks.wipCount', {
                                      count: status.current_count,
                                      limit: status.wip_limit,
                                    })
                                  : undefined
                              }
                            >
                              {status.current_count}
                              {status.wip_limit ? ` / ${status.wip_limit}` : ''}
                            </span>
                          </div>
                          <div
                            aria-hidden="true"
                            className="h-1.5 overflow-hidden rounded-full bg-slate-800"
                          >
                            <div
                              className={`h-full rounded-full ${overloaded || status.stale_count ? 'bg-amber-400' : 'bg-sky-400/70'}`}
                              style={{
                                width: `${Math.max(0, ((status.average_age_hours ?? 0) / maximumAge) * 100)}%`,
                              }}
                            />
                          </div>
                          <div className="text-right text-[10px] text-slate-500">
                            <span>
                              {t('tasks.flowAverageAge', {
                                value: flowDuration(status.average_age_hours, locale, t),
                              })}
                            </span>
                            {status.stale_count > 0 && (
                              <span className="ml-2 text-amber-300">
                                {t('tasks.flowStaleCount', { count: status.stale_count })}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
                <section aria-label={t('tasks.flowOldestWork')}>
                  <h3 className="text-xs font-semibold text-slate-300">
                    {t('tasks.flowOldestWork')}
                  </h3>
                  <div className="mt-2 divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40">
                    {flowInsights.aging_tasks.length ? (
                      flowInsights.aging_tasks.map((task) => {
                        const statusDefinition = workflow.statuses.find(
                          (candidate) => candidate.key === task.status,
                        );
                        return (
                          <button
                            className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-900 focus-visible:bg-slate-900"
                            key={task.id}
                            onClick={() => selectTaskDetail(task.task_key)}
                            type="button"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[10px] font-semibold text-sky-400">
                                {task.task_key} ·{' '}
                                {statusDefinition
                                  ? defaultStatusLabel(statusDefinition)
                                  : task.status_name}
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-slate-300">
                                {task.title}
                              </span>
                            </span>
                            <strong
                              className={`shrink-0 text-xs ${task.age_hours >= flowInsights.stale_after_days * 24 ? 'text-amber-300' : 'text-slate-400'}`}
                            >
                              {flowDuration(task.age_hours, locale, t)}
                            </strong>
                          </button>
                        );
                      })
                    ) : (
                      <p className="px-3 py-5 text-center text-xs text-slate-600">
                        {t('tasks.flowNoActiveWork')}
                      </p>
                    )}
                  </div>
                </section>
              </div>
              <section aria-label={t('tasks.flowCycleDistribution')} className="mt-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold text-slate-300">
                    {t('tasks.flowCycleDistribution')}
                  </h3>
                  <span className="text-[10px] text-slate-600">
                    {t('tasks.flowCompletedSample', {
                      count: flowInsights.completed_tasks.length,
                    })}
                  </span>
                </div>
                {flowInsights.completed_tasks.length ? (
                  <div
                    className="mt-2 flex h-20 items-end gap-1 rounded-lg border border-slate-800 bg-slate-950/40 px-2 pt-2"
                    role="list"
                  >
                    {[...flowInsights.completed_tasks]
                      .slice(0, 30)
                      .reverse()
                      .map((task) => {
                        const maximumCycle = Math.max(
                          1,
                          ...flowInsights.completed_tasks.map(
                            (candidate) => candidate.cycle_time_hours,
                          ),
                        );
                        return (
                          <button
                            aria-label={t('tasks.flowCompletedTaskLabel', {
                              task: task.task_key,
                              duration: flowDuration(task.cycle_time_hours, locale, t),
                            })}
                            className="min-w-1 flex-1 rounded-t bg-sky-400/55 transition hover:bg-sky-300 focus-visible:bg-sky-300"
                            key={task.id}
                            onClick={() => selectTaskDetail(task.task_key)}
                            role="listitem"
                            style={{
                              height: `${Math.max(8, (task.cycle_time_hours / maximumCycle) * 100)}%`,
                            }}
                            title={`${task.task_key} · ${task.title} · ${flowDuration(task.cycle_time_hours, locale, t)}`}
                            type="button"
                          />
                        );
                      })}
                  </div>
                ) : (
                  <p className="mt-2 rounded-lg border border-dashed border-slate-800 px-3 py-5 text-center text-xs text-slate-600">
                    {t('tasks.flowNoCompletedWork')}
                  </p>
                )}
              </section>
            </>
          )}
        </section>
      )}
      {selectionMode && (
        <section
          aria-label={t('tasks.selectedCount', { count: selectedTaskIds.size })}
          className="sticky top-2 z-30 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-sky-400/30 bg-slate-950/95 p-2 shadow-xl shadow-slate-950/40 backdrop-blur"
        >
          <strong className="px-2 text-xs text-sky-200">
            {t('tasks.selectedCount', { count: selectedTaskIds.size })}
          </strong>
          <button
            aria-label={t('tasks.selectVisible')}
            className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-sky-300"
            onClick={() =>
              setSelectedTaskIds(
                new Set(visibleTasks.filter((task) => !task.archived_at).map((task) => task.id)),
              )
            }
            title={t('tasks.selectVisible')}
            type="button"
          >
            <span aria-hidden="true">☑</span>
          </button>
          <button
            aria-label={t('tasks.clearSelection')}
            className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            onClick={clearTaskSelection}
            title={t('tasks.clearSelection')}
            type="button"
          >
            ×
          </button>
          <select
            aria-label={t('tasks.bulkStatus')}
            className="min-h-8 rounded-lg border border-slate-700 bg-slate-900 px-2 text-xs"
            onChange={(event) => {
              setBulkStatus(event.target.value as 'unchanged' | Status);
              setBulkConfirming(false);
            }}
            value={bulkStatus}
          >
            <option value="unchanged">
              {t('tasks.bulkStatus')}: {t('tasks.keepUnchanged')}
            </option>
            {bulkStatusOptions.map((column) => (
              <option key={column.status} value={column.status}>
                {column.label}
              </option>
            ))}
          </select>
          <select
            aria-label={t('tasks.bulkPriority')}
            className="min-h-8 rounded-lg border border-slate-700 bg-slate-900 px-2 text-xs"
            onChange={(event) => {
              setBulkPriority(event.target.value as 'unchanged' | Task['priority']);
              setBulkConfirming(false);
            }}
            value={bulkPriority}
          >
            <option value="unchanged">
              {t('tasks.bulkPriority')}: {t('tasks.keepUnchanged')}
            </option>
            {(['low', 'medium', 'high', 'critical'] as const).map((priority) => (
              <option key={priority} value={priority}>
                {priorityLabel(priority)}
              </option>
            ))}
          </select>
          <AssigneePicker
            ariaLabel={t('tasks.bulkAssignee')}
            base={base}
            className="min-h-8 w-52 rounded-lg border border-slate-700 bg-slate-900 px-2 text-xs"
            initialOptions={availableAssignees}
            onChange={(nextValue) => {
              setBulkAssignee(nextValue);
              setBulkConfirming(false);
            }}
            specialOptions={[
              {
                value: 'unchanged',
                label: `${t('tasks.bulkAssignee')}: ${t('tasks.keepUnchanged')}`,
              },
              { value: '', label: t('tasks.unassigned') },
            ]}
            value={bulkAssignee}
          />
          <Button
            className={`ml-auto min-h-8 px-3 py-1.5 ${bulkConfirming ? 'border-rose-400/50 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25' : ''}`}
            disabled={!selectedTaskIds.size || bulkSaving}
            onClick={() => void applyBulkUpdate()}
            type="button"
            variant={bulkConfirming ? 'quiet' : 'primary'}
          >
            {bulkConfirming ? t('tasks.confirmBulk') : t('tasks.reviewBulk')}
          </Button>
        </section>
      )}
      <NoticeText tone={messageTone}>{message}</NoticeText>
      <p aria-live="polite" className="sr-only">
        {boardAnnouncement}
      </p>
      {loading && (
        <p aria-live="polite" className="mt-4 text-sm text-slate-400" role="status">
          {t('common.loading')}
        </p>
      )}
      {!loading && loadError && (
        <section className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-5 text-center">
          <p aria-live="polite" className="text-sm text-rose-200">
            {loadError}
          </p>
          <Button className="mt-3" onClick={() => void refresh()} type="button" variant="quiet">
            {t('common.retry')}
          </Button>
        </section>
      )}
      {!loading &&
        !loadError &&
        (view === 'board' ? (
          <div className="-mx-3 mt-6 overflow-x-auto px-3 pb-3" data-task-board>
            <div
              className="grid items-start gap-3"
              style={{
                gridTemplateColumns: `repeat(${columns.length}, minmax(16rem, 1fr))`,
                minWidth: `${Math.max(columns.length * 17, 34)}rem`,
              }}
            >
              {columns.map((column) => {
                const columnTasks = visibleTasks.filter(
                  (task) => !task.archived_at && task.status === column.status,
                );
                const columnPageInfo = boardPageInfo[column.status];
                const columnTotal = Math.max(columnPageInfo?.total ?? 0, columnTasks.length);
                const activeDropTarget = Boolean(
                  draggingTaskId && dragOverStatus === column.status,
                );
                const wipLimit = column.wipLimit ?? null;
                const wipExceeded = wipLimit !== null && columnTotal > wipLimit;
                return (
                  <section
                    aria-label={t('tasks.columnLabel', {
                      status: column.label,
                      count: columnTotal,
                    })}
                    className={`min-h-[30rem] rounded-xl border border-t-2 p-3 shadow-lg shadow-slate-950/10 transition-colors ${columnAccent[column.color]} ${activeDropTarget ? 'border-sky-400 bg-sky-400/10 ring-2 ring-sky-400/25' : wipExceeded ? 'border-rose-500/50 bg-rose-500/5' : 'border-slate-800 bg-slate-900/55'}`}
                    data-drop-active={activeDropTarget ? 'true' : undefined}
                    data-task-status={column.status}
                    key={column.status}
                    onDragEnter={(event) => dragOverColumn(event, column.status)}
                    onDragOver={(event) => dragOverColumn(event, column.status)}
                    onDrop={(event) => dropTask(event, column.status)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="font-semibold">{column.label}</h2>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${wipExceeded ? 'bg-rose-500/15 text-rose-300' : 'bg-slate-800 text-slate-400'}`}
                        title={
                          wipLimit
                            ? t('tasks.wipCount', {
                                count: columnTotal,
                                limit: wipLimit,
                              })
                            : undefined
                        }
                      >
                        {columnTotal}
                        {wipLimit ? ` / ${wipLimit}` : ''}
                      </span>
                    </div>
                    {wipExceeded && (
                      <p className="mt-2 text-[10px] font-medium text-rose-300" role="status">
                        {t('tasks.wipExceeded', { limit: wipLimit ?? 0 })}
                      </p>
                    )}
                    <div className="mt-3 min-h-40 space-y-2">
                      {activeDropTarget && !dragBeforeTaskId && (
                        <p className="rounded-lg border border-dashed border-sky-400/60 bg-sky-400/10 px-3 py-3 text-center text-xs font-medium text-sky-200">
                          {t('tasks.dropHere', { status: column.label })}
                        </p>
                      )}
                      {columnTasks.map((task) => {
                        const taskPending = pendingTaskIds.has(task.id);
                        const taskDragging = draggingTaskId === task.id;
                        return (
                          <article
                            aria-busy={taskPending || undefined}
                            aria-checked={selectionMode ? selectedTaskIds.has(task.id) : undefined}
                            aria-haspopup={selectionMode ? undefined : 'dialog'}
                            aria-keyshortcuts={
                              allowed(user, 'task.update')
                                ? 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight'
                                : undefined
                            }
                            aria-label={t('tasks.cardLabel', {
                              title: task.title,
                              status: column.label,
                            })}
                            className={`group rounded-lg border bg-slate-950/80 p-3 shadow-sm shadow-slate-950/20 transition ${taskDragging ? 'scale-[0.98] border-sky-400/60 opacity-45' : dragBeforeTaskId === task.id ? 'border-sky-400 ring-2 ring-sky-400/30' : selectedTaskIds.has(task.id) ? 'border-sky-400 bg-sky-400/10 ring-1 ring-sky-400/30' : 'border-slate-800 hover:border-slate-600 hover:shadow-md'} ${selectionMode ? 'cursor-pointer' : allowed(user, 'task.update') && !taskPending ? 'cursor-grab active:cursor-grabbing' : ''}`}
                            draggable={
                              !selectionMode && allowed(user, 'task.update') && !taskPending
                            }
                            data-sid={task.id}
                            key={task.id}
                            onContextMenu={(event) => openTaskMenu(event, task)}
                            onClick={(event) => {
                              if (selectionMode) toggleTaskSelection(task.id, event.shiftKey);
                              else openTaskDetail(task);
                            }}
                            onDragEnd={clearDragState}
                            onDragEnter={(event) => dragOverTask(event, task)}
                            onDragOver={(event) => dragOverTask(event, task)}
                            onDragStart={(event) => startTaskDrag(event, task)}
                            onDrop={(event) => dropTaskBefore(event, task)}
                            onKeyDown={(event) => handleTaskKeyDown(event, task)}
                            role={selectionMode ? 'checkbox' : 'button'}
                            tabIndex={0}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex min-w-0 items-start gap-1.5">
                                {selectionMode ? (
                                  <span
                                    aria-hidden="true"
                                    className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded border text-[10px] ${selectedTaskIds.has(task.id) ? 'border-sky-400 bg-sky-400 text-slate-950' : 'border-slate-600 text-transparent'}`}
                                  >
                                    ✓
                                  </span>
                                ) : allowed(user, 'task.update') ? (
                                  <span
                                    aria-hidden="true"
                                    className="mt-0.5 shrink-0 text-xs text-slate-600 group-hover:text-slate-400"
                                  >
                                    ⠿
                                  </span>
                                ) : null}
                                {task.task_key && (
                                  <span className="mt-0.5 shrink-0 font-mono text-[9px] font-semibold text-sky-400/80">
                                    {task.task_key}
                                  </span>
                                )}
                                <h3 className="line-clamp-2 text-sm font-medium leading-5">
                                  {task.title}
                                </h3>
                              </div>
                              <span
                                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${priorityStyle[task.priority]}`}
                              >
                                {priorityLabel(task.priority)}
                              </span>
                            </div>
                            {(task.parent_task_key || (task.child_count ?? 0) > 0) && (
                              <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-500">
                                {task.parent_task_key && (
                                  <span
                                    className="min-w-0 truncate"
                                    title={t('tasks.parentTaskValue', {
                                      key: task.parent_task_key,
                                      title: task.parent_task_title ?? '',
                                    })}
                                  >
                                    ↳ {task.parent_task_key}
                                  </span>
                                )}
                                {(task.child_count ?? 0) > 0 && (
                                  <span
                                    className="ml-auto shrink-0 rounded bg-emerald-400/10 px-1.5 py-0.5 text-emerald-300"
                                    title={t('tasks.childProgress', {
                                      done: task.child_done_count ?? 0,
                                      total: task.child_count ?? 0,
                                    })}
                                  >
                                    ✓ {task.child_done_count ?? 0}/{task.child_count ?? 0}
                                  </span>
                                )}
                              </div>
                            )}
                            {(task.labels?.length ?? 0) > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {task.labels!.slice(0, 3).map((label) => (
                                  <span
                                    className="rounded bg-violet-400/10 px-1.5 py-0.5 text-[9px] text-violet-300"
                                    key={label}
                                  >
                                    #{label}
                                  </span>
                                ))}
                                {task.labels!.length > 3 && (
                                  <span className="text-[9px] text-slate-600">
                                    +{task.labels!.length - 3}
                                  </span>
                                )}
                              </div>
                            )}
                            {(task.due_date ||
                              task.links.length > 0 ||
                              task.assignee_name ||
                              (task.open_blocker_count ?? 0) > 0) && (
                              <div className="mt-1.5 flex min-w-0 items-center gap-2">
                                <p className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
                                  {task.due_date &&
                                    t('tasks.due', {
                                      date: formatDate(`${task.due_date}T00:00:00`),
                                    })}
                                  {task.due_date && task.links.length > 0 && ' · '}
                                  {task.links.length > 0 &&
                                    t('tasks.linkCount', { count: task.links.length })}
                                </p>
                                {(task.open_blocker_count ?? 0) > 0 && (
                                  <span
                                    aria-label={t('tasks.openBlockers', {
                                      count: task.open_blocker_count ?? 0,
                                    })}
                                    className="shrink-0 rounded-full bg-rose-400/10 px-1.5 py-0.5 text-[9px] font-semibold text-rose-300"
                                    title={t('tasks.openBlockers', {
                                      count: task.open_blocker_count ?? 0,
                                    })}
                                  >
                                    ⛓ {task.open_blocker_count}
                                  </span>
                                )}
                                {task.assignee_name && (
                                  <AssigneeAvatar
                                    label={t('tasks.assignedTo', { name: task.assignee_name })}
                                    name={task.assignee_name}
                                  />
                                )}
                              </div>
                            )}
                          </article>
                        );
                      })}
                      {columnPageInfo?.hasNext && (
                        <Button
                          className="w-full"
                          disabled={Boolean(loadingMoreKey)}
                          onClick={() => void loadMoreTasks(column.status)}
                          type="button"
                          variant="quiet"
                        >
                          {loadingMoreKey === column.status
                            ? t('common.loading')
                            : t('tasks.loadMoreTasks', {
                                shown: columnTasks.length,
                                total: columnTotal,
                              })}
                        </Button>
                      )}
                      {!columnTasks.length && !activeDropTarget && (
                        <p className="rounded-xl border border-dashed border-slate-800 px-3 py-6 text-center text-sm text-slate-600">
                          {t('tasks.noTasks')}
                        </p>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        ) : view === 'list' ? (
          <section
            aria-label={t('tasks.list')}
            className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/45"
            data-task-list
          >
            <div className="overflow-x-auto">
              <div
                className="grid bg-slate-950/55 px-3 py-1 text-left text-[10px] uppercase tracking-wide text-slate-500"
                style={{
                  gridTemplateColumns: taskListColumns
                    .map((column) => taskListColumnWidths[column])
                    .join(' '),
                }}
              >
                {taskListColumns.map((field) => (
                  <button
                    aria-label={t('data.sortByColumn', {
                      column: taskListColumnLabel(field),
                    })}
                    className="flex min-h-6 items-center gap-1 text-left font-medium hover:text-sky-300"
                    key={field}
                    onClick={() => changeTaskSort(field)}
                    title={t('data.sortCycleHint')}
                    type="button"
                  >
                    {taskListColumnLabel(field)}
                    {taskSort === field && (
                      <span aria-hidden="true">{taskSortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </button>
                ))}
              </div>
              <div>
                {taskGroups.map((group) => {
                  const collapsed = collapsedTaskGroups.has(group.key);
                  const groupLabel = t('tasks.groupLabel', {
                    label: group.label,
                    count: group.tasks.length,
                  });
                  return (
                    <section key={group.key}>
                      {taskGroup !== 'none' && (
                        <button
                          aria-expanded={!collapsed}
                          aria-label={groupLabel}
                          className="flex min-h-8 w-full items-center gap-2 border-y border-slate-800 bg-slate-950/35 px-3 text-left text-[11px] font-semibold text-slate-300 first:border-t-0 hover:bg-slate-800/55 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-sky-400/60"
                          onClick={() =>
                            setCollapsedTaskGroups((current) => {
                              const next = new Set(current);
                              if (next.has(group.key)) next.delete(group.key);
                              else next.add(group.key);
                              return next;
                            })
                          }
                          title={groupLabel}
                          type="button"
                        >
                          <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
                          <span>{group.label}</span>
                          <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-400">
                            {group.tasks.length}
                          </span>
                        </button>
                      )}
                      {!collapsed && (
                        <div className="divide-y divide-slate-800/80">
                          {group.tasks.map((task) => {
                            const workflowStatus = workflow.statuses.find(
                              (status) => status.key === task.status,
                            );
                            const statusLabel = workflowStatus
                              ? defaultStatusLabel(workflowStatus)
                              : task.status;
                            return (
                              <button
                                aria-checked={
                                  selectionMode ? selectedTaskIds.has(task.id) : undefined
                                }
                                aria-haspopup={selectionMode ? undefined : 'dialog'}
                                aria-keyshortcuts={
                                  allowed(user, 'task.update') && taskSort === 'rank'
                                    ? 'Alt+ArrowUp Alt+ArrowDown'
                                    : undefined
                                }
                                aria-label={t('tasks.cardLabel', {
                                  title: task.title,
                                  status: statusLabel,
                                })}
                                className={`grid w-full items-center px-3 py-2 text-left text-xs outline-none transition hover:bg-slate-800/45 focus:bg-sky-400/10 focus:ring-2 focus:ring-inset focus:ring-sky-400/60 ${selectedTaskIds.has(task.id) ? 'bg-sky-400/10' : ''}`}
                                data-sid={task.id}
                                key={task.id}
                                onClick={(event) => {
                                  if (selectionMode) toggleTaskSelection(task.id, event.shiftKey);
                                  else openTaskDetail(task);
                                }}
                                onContextMenu={(event) => openTaskMenu(event, task)}
                                onKeyDown={(event) => handleListTaskKeyDown(event, task)}
                                role={selectionMode ? 'checkbox' : undefined}
                                style={{
                                  gridTemplateColumns: taskListColumns
                                    .map((column) => taskListColumnWidths[column])
                                    .join(' '),
                                }}
                                title={t('tasks.cardLabel', {
                                  title: task.title,
                                  status: statusLabel,
                                })}
                                type="button"
                              >
                                {taskListColumns.map((column) => {
                                  if (column === 'title')
                                    return (
                                      <span
                                        className={`flex min-w-0 items-center gap-2 ${task.parent_task_id ? 'pl-4' : ''}`}
                                        key={column}
                                      >
                                        {selectionMode && (
                                          <span
                                            aria-hidden="true"
                                            className={`grid size-4 shrink-0 place-items-center rounded border text-[10px] ${selectedTaskIds.has(task.id) ? 'border-sky-400 bg-sky-400 text-slate-950' : 'border-slate-600 text-transparent'}`}
                                          >
                                            ✓
                                          </span>
                                        )}
                                        {task.parent_task_id && <span aria-hidden="true">↳</span>}
                                        <span className="shrink-0 font-mono text-[10px] font-semibold text-sky-400/80">
                                          {task.task_key}
                                        </span>
                                        <span className="truncate font-medium text-slate-200">
                                          {task.title}
                                        </span>
                                        {(task.child_count ?? 0) > 0 && (
                                          <span
                                            className="ml-auto shrink-0 text-[9px] text-emerald-300"
                                            title={t('tasks.childProgress', {
                                              done: task.child_done_count ?? 0,
                                              total: task.child_count ?? 0,
                                            })}
                                          >
                                            ✓ {task.child_done_count ?? 0}/{task.child_count ?? 0}
                                          </span>
                                        )}
                                      </span>
                                    );
                                  if (column === 'status')
                                    return (
                                      <span
                                        className="flex items-center gap-1.5 truncate text-slate-300"
                                        key={column}
                                      >
                                        <span
                                          aria-hidden="true"
                                          className={`size-2 shrink-0 rounded-full ${statusDotStyle[workflowStatus?.color ?? 'slate']}`}
                                        />
                                        {statusLabel}
                                      </span>
                                    );
                                  if (column === 'priority')
                                    return (
                                      <span className={priorityStyle[task.priority]} key={column}>
                                        {priorityLabel(task.priority)}
                                      </span>
                                    );
                                  if (column === 'assignee')
                                    return (
                                      <span className="truncate text-slate-400" key={column}>
                                        {task.assignee_name ?? t('tasks.unassigned')}
                                      </span>
                                    );
                                  return (
                                    <span
                                      className="font-mono text-[11px] text-slate-400"
                                      key={column}
                                    >
                                      {task.due_date
                                        ? formatDate(`${task.due_date}T00:00:00`)
                                        : t('common.unset')}
                                    </span>
                                  );
                                })}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
            {!listTasks.length && (
              <p className="px-3 py-8 text-center text-sm text-slate-500">{t('tasks.noTasks')}</p>
            )}
            {taskPageInfo.hasNext && (
              <div className="border-t border-slate-800 p-3 text-center">
                <Button
                  disabled={Boolean(loadingMoreKey)}
                  onClick={() => void loadMoreTasks()}
                  type="button"
                  variant="quiet"
                >
                  {loadingMoreKey === 'list'
                    ? t('common.loading')
                    : t('tasks.loadMoreTasks', {
                        shown: listTasks.length,
                        total: taskPageInfo.total,
                      })}
                </Button>
              </div>
            )}
          </section>
        ) : (
          <section className="mt-6 rounded-xl border border-slate-800 p-4">
            <h2 className="text-xl font-semibold">{t('tasks.calendarHeading')}</h2>
            <div className="mt-4 divide-y divide-slate-800">
              {calendar.map((task) => (
                <article
                  aria-haspopup="dialog"
                  aria-label={t('tasks.cardLabel', {
                    title: task.title,
                    status:
                      columns.find((column) => column.status === task.status)?.label ?? task.status,
                  })}
                  className="grid gap-2 py-3 text-sm md:grid-cols-[9rem_1fr_auto]"
                  key={task.id}
                  onContextMenu={(event) => openTaskMenu(event, task)}
                  onKeyDown={(event) => openTaskMenuFromKeyboard(event, task)}
                  onClick={(event) => {
                    event.currentTarget.focus();
                    openTaskDetail(task);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <time className="font-mono text-sky-300" dateTime={task.due_date ?? undefined}>
                    {formatDate(`${task.due_date}T00:00:00`)}
                  </time>
                  <span>
                    {task.task_key && (
                      <span className="mr-2 font-mono text-[10px] text-sky-400">
                        {task.task_key}
                      </span>
                    )}
                    {task.title}
                  </span>
                  <span className="flex items-center justify-end gap-2 text-xs uppercase text-slate-400">
                    {task.assignee_name && (
                      <AssigneeAvatar
                        label={t('tasks.assignedTo', { name: task.assignee_name })}
                        name={task.assignee_name}
                      />
                    )}
                    {columns.find((column) => column.status === task.status)?.label}
                  </span>
                </article>
              ))}
              {!calendar.length && <p className="py-6 text-slate-500">{t('tasks.noCalendar')}</p>}
            </div>
            {taskPageInfo.hasNext && (
              <div className="mt-4 text-center">
                <Button
                  disabled={Boolean(loadingMoreKey)}
                  onClick={() => void loadMoreTasks()}
                  type="button"
                  variant="quiet"
                >
                  {loadingMoreKey === 'calendar'
                    ? t('common.loading')
                    : t('tasks.loadMoreTasks', {
                        shown: calendar.length,
                        total: taskPageInfo.total,
                      })}
                </Button>
              </div>
            )}
          </section>
        ))}
      {tasks.some((task) => task.archived_at) && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">{t('tasks.archivedHeading')}</h2>
          {archivedPageInfo.hasNext && (
            <p className="mt-2 text-xs text-amber-300">
              {t('tasks.archivedLimit', {
                shown: tasks.filter((task) => task.archived_at).length,
                total: archivedPageInfo.total,
              })}
            </p>
          )}
          {tasks
            .filter((task) => task.archived_at)
            .map((task) => (
              <div
                className="mt-2 flex items-center gap-3 text-sm text-slate-500"
                key={task.id}
                onContextMenu={(event) => openTaskMenu(event, task)}
                onKeyDown={(event) => openTaskMenuFromKeyboard(event, task)}
                tabIndex={0}
              >
                <span>
                  {task.task_key && (
                    <span className="mr-2 font-mono text-[10px] text-slate-600">
                      {task.task_key}
                    </span>
                  )}
                  {t('tasks.archivedNote', { title: task.title })}
                </span>
                {allowed(user, 'task.restore') && (
                  <button
                    className="text-sky-400"
                    onClick={() =>
                      void mutate(() =>
                        api(`${base}/tasks/${task.id}/restore`, {
                          method: 'POST',
                          body: JSON.stringify({ rowVersion: task.row_version }),
                        }),
                      )
                    }
                    type="button"
                  >
                    {t('common.restore')}
                  </button>
                )}
              </div>
            ))}
        </section>
      )}
      {selectedTaskId && (
        <div className="fixed inset-0 z-[80] flex justify-end" role="presentation">
          <button
            aria-label={t('tasks.closeDetail')}
            className="absolute inset-0 cursor-default bg-slate-950/65 backdrop-blur-sm"
            data-modal-backdrop
            disabled={taskDetailOperationPending}
            onClick={dismissTaskDetail}
            type="button"
          />
          <aside
            aria-labelledby="task-detail-title"
            aria-modal="true"
            className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-slate-700 bg-slate-950 shadow-2xl shadow-black/50"
            ref={taskDetailDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-950/90 px-5 py-4 backdrop-blur-xl sm:px-7">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-400">
                    {taskDetail?.task_key ?? t('tasks.detailEyebrow')}
                  </p>
                  {taskDetailHasDraft && (
                    <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[9px] font-semibold text-amber-300">
                      {t('tasks.unsavedChanges')}
                    </span>
                  )}
                </div>
                <h2 className="mt-1 truncate text-2xl font-semibold" id="task-detail-title">
                  {taskDetail?.title ?? t('common.loading')}
                </h2>
                {taskDetail?.created_at && taskDetail.updated_at && (
                  <p className="mt-1 text-[10px] text-slate-500">
                    {t('tasks.provenance', {
                      name: taskDetail.created_by_name ?? t('tasks.unknownAssignee'),
                      created: formatDate(taskDetail.created_at, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                      updated: formatDate(taskDetail.updated_at, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                {detailNeighbors.map((task, index) => (
                  <IconAction
                    aria-keyshortcuts={`Alt+Arrow${index ? 'Down' : 'Up'}`}
                    className="size-9 border border-slate-700"
                    disabled={!task || taskDetailOperationPending}
                    icon={index ? '↓' : '↑'}
                    key={index}
                    label={t(index ? 'common.next' : 'common.previous')}
                    onClick={() => navigateTaskDetail(task)}
                    tooltipAlign="end"
                  />
                ))}
                {taskDetail && canManageTaskVisibility && (
                  <IconAction
                    aria-expanded={visibilityEditorOpen}
                    className={`size-9 border ${taskDetail.visibility === 'restricted' ? 'border-amber-400/40 bg-amber-400/10 text-amber-300' : 'border-slate-700'}`}
                    icon={taskDetail.visibility === 'restricted' ? '🔒' : '◌'}
                    label={t('tasks.visibility')}
                    onClick={() => {
                      if (visibilityEditorOpen) setVisibilityEditorOpen(false);
                      else void openVisibilityEditor();
                    }}
                    tooltipAlign="end"
                  />
                )}
                {taskDetail?.visibility === 'restricted' && !canManageTaskVisibility && (
                  <span
                    aria-label={t('tasks.restrictedVisibility')}
                    className="grid size-9 place-items-center rounded-lg border border-amber-400/40 bg-amber-400/10 text-sm text-amber-300"
                    role="img"
                    title={t('tasks.restrictedVisibility')}
                  >
                    🔒
                  </span>
                )}
                {taskDetail && (
                  <button
                    aria-keyshortcuts="W"
                    aria-label={taskDetail.watching ? t('tasks.unwatchTask') : t('tasks.watchTask')}
                    aria-pressed={taskDetail.watching ?? false}
                    className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs ${taskDetail.watching ? 'border-sky-400/40 bg-sky-400/10 text-sky-300' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}
                    disabled={watchSaving}
                    onClick={() => void toggleWatching()}
                    title={taskDetail.watching ? t('tasks.unwatchTask') : t('tasks.watchTask')}
                    type="button"
                  >
                    <span aria-hidden="true">◉</span>
                    <span>{taskDetail.watcher_count ?? 0}</span>
                  </button>
                )}
                {taskDetail && !taskDetail.archived_at && allowed(user, 'task.create') && (
                  <IconAction
                    className="size-9 border border-slate-700"
                    icon="⧉"
                    label={t('tasks.cloneTask')}
                    onClick={() => openTaskClone(taskDetail)}
                    tooltipAlign="end"
                  />
                )}
                {taskDetail && (
                  <IconAction
                    className="size-9 border border-slate-700"
                    icon="⌁"
                    label={t('tasks.copyLink')}
                    onClick={() =>
                      void copyTaskValue(
                        t('tasks.taskLink'),
                        taskShareUrl(taskDetail.task_key ?? taskDetail.id),
                      )
                    }
                    tooltipAlign="end"
                  />
                )}
                <button
                  aria-label={t('tasks.closeDetail')}
                  className="grid size-9 place-items-center rounded-lg border border-slate-700 text-xl text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                  data-dialog-initial-focus
                  disabled={taskDetailOperationPending}
                  onClick={dismissTaskDetail}
                  title={t('tasks.closeDetail')}
                  type="button"
                >
                  ×
                </button>
              </div>
            </header>
            {visibilityEditorOpen && taskDetail && (
              <section
                aria-label={t('tasks.visibility')}
                className="border-b border-slate-800 bg-slate-900/70 px-5 py-4 sm:px-7"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">
                      {t('tasks.visibility')}
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      {t('tasks.visibilityDescription')}
                    </p>
                  </div>
                  <IconAction
                    icon="×"
                    label={t('common.close')}
                    onClick={() => setVisibilityEditorOpen(false)}
                    tooltipAlign="end"
                  />
                </div>
                {visibilityLoading ? (
                  <p className="mt-4 text-xs text-slate-500">{t('common.loading')}</p>
                ) : visibilityPolicy ? (
                  <div className="mt-4 grid gap-4">
                    <fieldset className="grid gap-2">
                      <legend className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {t('tasks.visibilityMode')} · {t('common.required')}
                      </legend>
                      {(['project', 'restricted'] as const).map((visibility) => (
                        <label
                          className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${visibilityPolicy.visibility === visibility ? 'border-sky-400/50 bg-sky-400/10' : 'border-slate-800 bg-slate-950/60'}`}
                          key={visibility}
                        >
                          <input
                            checked={visibilityPolicy.visibility === visibility}
                            name="taskVisibility"
                            onChange={() =>
                              setVisibilityPolicy((current) =>
                                current ? { ...current, visibility } : current,
                              )
                            }
                            type="radio"
                          />
                          <span>
                            <span className="block text-xs font-semibold text-slate-200">
                              {t(
                                visibility === 'project'
                                  ? 'tasks.projectVisibility'
                                  : 'tasks.restrictedVisibility',
                              )}
                            </span>
                            <span className="mt-0.5 block text-[10px] leading-4 text-slate-500">
                              {t(
                                visibility === 'project'
                                  ? 'tasks.projectVisibilityHint'
                                  : 'tasks.restrictedVisibilityHint',
                              )}
                            </span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    {visibilityPolicy.visibility === 'restricted' && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <fieldset className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                          <legend className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {t('tasks.allowedMembers')} · {t('common.optional')}
                          </legend>
                          <div className="mt-1 max-h-40 space-y-1 overflow-y-auto">
                            {assignees.map((member) => (
                              <label
                                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                                key={member.id}
                              >
                                <input
                                  checked={visibilityPolicy.members.some(
                                    (candidate) => candidate.id === member.id,
                                  )}
                                  onChange={() => toggleVisibilitySubject('members', member)}
                                  type="checkbox"
                                />
                                <span className="min-w-0 truncate">{member.displayName}</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        <fieldset className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                          <legend className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {t('tasks.allowedGroups')} · {t('common.optional')}
                          </legend>
                          <div className="mt-1 max-h-40 space-y-1 overflow-y-auto">
                            {visibilityGroups.map((group) => (
                              <label
                                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                                key={group.id}
                              >
                                <input
                                  checked={visibilityPolicy.groups.some(
                                    (candidate) => candidate.id === group.id,
                                  )}
                                  onChange={() => toggleVisibilitySubject('groups', group)}
                                  type="checkbox"
                                />
                                <span className="min-w-0 truncate">{group.name}</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        <p className="text-[10px] leading-4 text-slate-500 sm:col-span-2">
                          {t('tasks.visibilityImplicitAccess')}
                        </p>
                      </div>
                    )}
                    {visibilityError && <NoticeText tone="error">{visibilityError}</NoticeText>}
                    <div className="flex justify-end gap-2">
                      <Button
                        disabled={visibilitySaving}
                        onClick={() => setVisibilityEditorOpen(false)}
                        type="button"
                        variant="quiet"
                      >
                        {t('common.cancel')}
                      </Button>
                      <Button
                        disabled={visibilitySaving}
                        onClick={() => void saveTaskVisibility()}
                        type="button"
                      >
                        {visibilitySaving ? t('common.saving') : t('common.save')}
                      </Button>
                    </div>
                  </div>
                ) : visibilityError ? (
                  <NoticeText tone="error">{visibilityError}</NoticeText>
                ) : null}
              </section>
            )}
            {detailLoading || !taskDetail ? (
              <div aria-label={t('common.loading')} className="space-y-3 p-6 sm:p-7">
                <div className="h-10 animate-pulse rounded-lg bg-slate-800" />
                <div className="h-28 animate-pulse rounded-lg bg-slate-800/80" />
                <div className="h-10 animate-pulse rounded-lg bg-slate-800/60" />
              </div>
            ) : (
              <>
                {taskDetailConflict && (
                  <section
                    aria-live="assertive"
                    className="mx-5 mt-5 rounded-xl border border-amber-400/35 bg-amber-400/10 p-4 sm:mx-7"
                    role="alert"
                  >
                    <h3 className="text-sm font-semibold text-amber-200">
                      {t('tasks.detailConflictTitle')}
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-amber-100/80">
                      {t('tasks.detailConflictBody')}
                    </p>
                    <Button
                      className="mt-3"
                      onClick={() => {
                        void (async () => {
                          if (
                            taskDetailDirty &&
                            !(await confirmAction(t('tasks.discardDetailConfirm')))
                          )
                            return;
                          applyTaskDetail(taskDetailConflict);
                          setTaskDetailConflict(undefined);
                          setTaskDetailDirtyFields(new Set());
                          setMessageTone('info');
                          setMessage(t('tasks.versionConflict'));
                        })();
                      }}
                      type="button"
                      variant="quiet"
                    >
                      {t('tasks.loadLatest')}
                    </Button>
                  </section>
                )}
                <form
                  className="grid gap-5 p-5 sm:p-7"
                  onChangeCapture={(event) => {
                    const target = event.target;
                    if (!(
                      target instanceof HTMLInputElement ||
                      target instanceof HTMLSelectElement ||
                      target instanceof HTMLTextAreaElement
                    ))
                      return;
                    const { name } = target;
                    if (
                      [
                        'title',
                        'description',
                        'labels',
                        'status',
                        'priority',
                        'dueDate',
                        'originalEstimate',
                        'remainingEstimate',
                      ].includes(name)
                    )
                      markTaskDetailField(name, taskDetailFieldChanged(name, target.value));
                  }}
                  onSubmit={(event) => void saveTaskDetail(event)}
                >
                  <label className={taskFormLabelClass}>
                    <FormFieldLabel required>{t('tasks.title')}</FormFieldLabel>
                    <input
                      className={inputClass}
                      defaultValue={taskDetail.title}
                      disabled={!allowed(user, 'task.update')}
                      key={`title:${taskDetail.id}:${taskDetail.row_version}`}
                      name="title"
                      required
                    />
                  </label>
                  <label className={taskFormLabelClass}>
                    <FormFieldLabel>{t('tasks.descriptionLabel')}</FormFieldLabel>
                    <textarea
                      className={`${inputClass} min-h-32 resize-y`}
                      defaultValue={taskDetail.description}
                      disabled={!allowed(user, 'task.update')}
                      key={`description:${taskDetail.id}:${taskDetail.row_version}`}
                      name="description"
                    />
                  </label>
                  <label className={taskFormLabelClass}>
                    <FormFieldLabel>{t('tasks.labels')}</FormFieldLabel>
                    <input
                      className={inputClass}
                      defaultValue={(taskDetail.labels ?? []).join(', ')}
                      disabled={!allowed(user, 'task.update')}
                      key={`labels:${taskDetail.id}:${taskDetail.row_version}`}
                      name="labels"
                      placeholder={t('tasks.labelsPlaceholder')}
                    />
                    <span className="text-[10px] text-slate-600">{t('tasks.labelsHint')}</span>
                  </label>
                  <div className={taskFormLabelClass}>
                    <FormFieldLabel>{t('tasks.parentTask')}</FormFieldLabel>
                    <TaskCandidatePicker
                      base={base}
                      disabled={
                        !allowed(user, 'task.update') ||
                        Boolean(taskDetail.archived_at) ||
                        (taskDetail.child_count ?? 0) > 0
                      }
                      excludeId={taskDetail.id}
                      key={`parent:${taskDetail.id}:${taskDetail.row_version}`}
                      label={t('tasks.parentTask')}
                      name="parentTaskId"
                      onChange={(candidate) => {
                        setDetailParentCandidate(candidate);
                        markTaskDetailField(
                          'parentTaskId',
                          (candidate?.id ?? '') !== (taskDetail.parent_task_id ?? ''),
                        );
                      }}
                      topLevelOnly
                      value={detailParentCandidate}
                    />
                    <span className="text-[10px] text-slate-600">
                      {(taskDetail.child_count ?? 0) > 0
                        ? t('tasks.parentHasChildrenHint')
                        : t('tasks.parentHint')}
                    </span>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className={taskFormLabelClass}>
                      <FormFieldLabel required>{t('tasks.status')}</FormFieldLabel>
                      <select
                        className={inputClass}
                        defaultValue={taskDetail.status}
                        disabled={!allowed(user, 'task.update')}
                        key={`status:${taskDetail.id}:${taskDetail.row_version}`}
                        name="status"
                        required
                      >
                        {columns.map((column) => (
                          <option
                            disabled={!canTransition(taskDetail.status, column.status)}
                            key={column.status}
                            value={column.status}
                          >
                            {column.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={taskFormLabelClass}>
                      <FormFieldLabel required>{t('tasks.priority')}</FormFieldLabel>
                      <select
                        className={inputClass}
                        defaultValue={taskDetail.priority}
                        disabled={!allowed(user, 'task.update')}
                        key={`priority:${taskDetail.id}:${taskDetail.row_version}`}
                        name="priority"
                        required
                      >
                        {(['low', 'medium', 'high', 'critical'] as const).map((priority) => (
                          <option key={priority} value={priority}>
                            {priorityLabel(priority)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={taskFormLabelClass}>
                      <FormFieldLabel>{t('tasks.assignee')}</FormFieldLabel>
                      <AssigneePicker
                        ariaLabel={t('tasks.assignee')}
                        base={base}
                        className={inputClass}
                        defaultValue={taskDetail.assignee_id ?? ''}
                        disabled={!allowed(user, 'task.update') || assigneesLoading}
                        initialOptions={availableAssignees}
                        key={`assignee:${taskDetail.id}:${taskDetail.row_version}`}
                        name="assigneeId"
                        onChange={(value) =>
                          markTaskDetailField(
                            'assigneeId',
                            value !== (taskDetail.assignee_id ?? ''),
                          )
                        }
                        specialOptions={[{ value: '', label: t('tasks.unassigned') }]}
                      />
                    </label>
                    <label className={taskFormLabelClass}>
                      <FormFieldLabel>{t('tasks.dueDate')}</FormFieldLabel>
                      <input
                        className={inputClass}
                        defaultValue={taskDetail.due_date ?? ''}
                        disabled={!allowed(user, 'task.update')}
                        key={`due:${taskDetail.id}:${taskDetail.row_version}`}
                        name="dueDate"
                        type="date"
                      />
                    </label>
                    <label className={taskFormLabelClass}>
                      <FormFieldLabel>{t('tasks.originalEstimate')}</FormFieldLabel>
                      <input
                        className={inputClass}
                        defaultValue={
                          taskDetail.original_estimate_minutes === null ||
                          taskDetail.original_estimate_minutes === undefined
                            ? ''
                            : formatTaskDuration(taskDetail.original_estimate_minutes)
                        }
                        disabled={!allowed(user, 'task.update')}
                        key={`original-estimate:${taskDetail.id}:${taskDetail.row_version}`}
                        name="originalEstimate"
                        placeholder={t('tasks.durationPlaceholder')}
                      />
                    </label>
                    <label className={taskFormLabelClass}>
                      <FormFieldLabel>{t('tasks.remainingEstimate')}</FormFieldLabel>
                      <input
                        className={inputClass}
                        defaultValue={
                          taskDetail.remaining_estimate_minutes === null ||
                          taskDetail.remaining_estimate_minutes === undefined
                            ? ''
                            : formatTaskDuration(taskDetail.remaining_estimate_minutes)
                        }
                        disabled={!allowed(user, 'task.update')}
                        key={`remaining-estimate:${taskDetail.id}:${taskDetail.row_version}`}
                        name="remainingEstimate"
                        placeholder={t('tasks.durationPlaceholder')}
                      />
                    </label>
                  </div>
                  {assigneesLoadError && (
                    <p aria-live="polite" className="text-xs text-amber-300">
                      {assigneesLoadError}
                    </p>
                  )}
                  <section className="border-t border-slate-800 pt-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-200">
                          {t('tasks.timeTracking')}
                        </h3>
                        <p className="mt-1 text-[10px] leading-4 text-slate-600">
                          {t('tasks.timeTrackingHint')}
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[10px] text-sky-300">
                        {t('tasks.worklogCount', {
                          count:
                            taskDetail.worklog_page_info?.total ?? taskDetail.worklogs?.length ?? 0,
                        })}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      {[
                        [
                          t('tasks.originalEstimate'),
                          formatTaskDuration(taskDetail.original_estimate_minutes),
                        ],
                        [
                          t('tasks.remainingEstimate'),
                          formatTaskDuration(taskDetail.remaining_estimate_minutes),
                        ],
                        [
                          t('tasks.timeSpent'),
                          formatTaskDuration(taskDetail.time_spent_minutes ?? 0),
                        ],
                      ].map(([label, value]) => (
                        <div
                          className="rounded-lg border border-slate-800 bg-slate-900/45 px-3 py-2"
                          key={label}
                        >
                          <p className="text-[9px] uppercase tracking-wider text-slate-600">
                            {label}
                          </p>
                          <p className="mt-1 font-mono text-sm font-semibold text-slate-200">
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>
                    {taskDetail.remaining_estimate_minutes !== null &&
                      taskDetail.remaining_estimate_minutes !== undefined && (
                        <div className="mt-3">
                          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                            <div
                              aria-label={t('tasks.timeProgress', {
                                spent: formatTaskDuration(taskDetail.time_spent_minutes ?? 0),
                                remaining: formatTaskDuration(
                                  taskDetail.remaining_estimate_minutes,
                                ),
                              })}
                              className="h-full rounded-full bg-sky-400 transition-[width]"
                              role="progressbar"
                              aria-valuemax={100}
                              aria-valuemin={0}
                              aria-valuenow={Math.round(
                                Math.min(
                                  100,
                                  ((taskDetail.time_spent_minutes ?? 0) /
                                    Math.max(
                                      1,
                                      (taskDetail.time_spent_minutes ?? 0) +
                                        taskDetail.remaining_estimate_minutes,
                                    )) *
                                    100,
                                ),
                              )}
                              style={{
                                width: `${Math.min(
                                  100,
                                  ((taskDetail.time_spent_minutes ?? 0) /
                                    Math.max(
                                      1,
                                      (taskDetail.time_spent_minutes ?? 0) +
                                        taskDetail.remaining_estimate_minutes,
                                    )) *
                                    100,
                                )}%`,
                              }}
                            />
                          </div>
                        </div>
                      )}
                    {(taskDetail.worklogs?.length ?? 0) > 0 && (
                      <div className="mt-4 grid gap-2">
                        {(taskDetail.worklogs ?? []).map((worklog) => (
                          <article
                            className={`rounded-lg border px-3 py-2 ${editingWorklogId === worklog.id ? 'border-sky-400/60 bg-sky-400/5' : 'border-slate-800 bg-slate-900/35'}`}
                            key={worklog.id}
                          >
                            <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-slate-200">
                                  {formatTaskDuration(worklog.duration_minutes)} ·{' '}
                                  {worklog.author_name}
                                </p>
                                <time
                                  className="mt-0.5 block text-[10px] text-slate-500"
                                  dateTime={worklog.started_at}
                                >
                                  {new Intl.DateTimeFormat(locale, activityTimestampOptions).format(
                                    new Date(worklog.started_at),
                                  )}
                                </time>
                                {worklog.note && (
                                  <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-400">
                                    {worklog.note}
                                  </p>
                                )}
                              </div>
                              {allowed(user, 'task.worklog') &&
                                worklog.can_edit &&
                                !taskDetail.archived_at && (
                                  <div className="flex gap-1">
                                    <IconAction
                                      disabled={worklogSaving || taskDetailDirty}
                                      icon="✎"
                                      label={t('tasks.editWorklog', {
                                        duration: formatTaskDuration(worklog.duration_minutes),
                                      })}
                                      onClick={() => editWorklog(worklog)}
                                    />
                                    <IconAction
                                      disabled={worklogSaving || taskDetailDirty}
                                      icon="×"
                                      label={t('tasks.deleteWorklog', {
                                        duration: formatTaskDuration(worklog.duration_minutes),
                                      })}
                                      onClick={() => void deleteWorklog(worklog)}
                                      tone="danger"
                                    />
                                  </div>
                                )}
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                    {(taskDetail.worklogs?.length ?? 0) === 0 && (
                      <p className="mt-4 text-xs text-slate-500">{t('tasks.noWorklogs')}</p>
                    )}
                    {taskDetail.worklog_page_info?.hasNext && (
                      <Button
                        className="mt-3"
                        disabled={worklogLoading}
                        onClick={() => void loadMoreWorklogs()}
                        type="button"
                        variant="quiet"
                      >
                        {worklogLoading ? t('common.loading') : t('tasks.loadEarlierWorklogs')}
                      </Button>
                    )}
                    {allowed(user, 'task.worklog') && !taskDetail.archived_at && (
                      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/45 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold text-slate-300">
                            {editingWorklogId ? t('tasks.editWorklogTitle') : t('tasks.logWork')}
                          </p>
                          {editingWorklogId && (
                            <IconAction
                              disabled={worklogSaving}
                              icon="×"
                              label={t('common.cancel')}
                              onClick={resetWorklogDraft}
                            />
                          )}
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <label className={taskFormLabelClass}>
                            <FormFieldLabel required>{t('tasks.timeSpent')}</FormFieldLabel>
                            <input
                              className={inputClass}
                              disabled={worklogSaving || taskDetailDirty}
                              onChange={(event) => setWorklogDuration(event.target.value)}
                              placeholder={t('tasks.durationPlaceholder')}
                              value={worklogDuration}
                            />
                          </label>
                          <label className={taskFormLabelClass}>
                            <FormFieldLabel required>{t('tasks.workStarted')}</FormFieldLabel>
                            <input
                              className={inputClass}
                              disabled={worklogSaving || taskDetailDirty}
                              onChange={(event) => setWorklogStartedAt(event.target.value)}
                              type="datetime-local"
                              value={worklogStartedAt}
                            />
                          </label>
                          <label className={taskFormLabelClass}>
                            <FormFieldLabel required>
                              {t('tasks.remainingAdjustment')}
                            </FormFieldLabel>
                            <select
                              className={inputClass}
                              disabled={worklogSaving || taskDetailDirty}
                              onChange={(event) =>
                                setWorklogRemainingMode(
                                  event.target.value as 'auto' | 'set' | 'unchanged',
                                )
                              }
                              value={worklogRemainingMode}
                            >
                              <option value="auto">{t('tasks.remainingAuto')}</option>
                              <option value="unchanged">{t('tasks.remainingUnchanged')}</option>
                              <option value="set">{t('tasks.remainingSet')}</option>
                            </select>
                          </label>
                          {worklogRemainingMode === 'set' && (
                            <label className={taskFormLabelClass}>
                              <FormFieldLabel required>
                                {t('tasks.remainingEstimate')}
                              </FormFieldLabel>
                              <input
                                className={inputClass}
                                disabled={worklogSaving || taskDetailDirty}
                                onChange={(event) => setWorklogRemaining(event.target.value)}
                                placeholder={t('tasks.durationPlaceholder')}
                                value={worklogRemaining}
                              />
                            </label>
                          )}
                          <label className={`${taskFormLabelClass} sm:col-span-2`}>
                            <FormFieldLabel>{t('tasks.worklogNote')}</FormFieldLabel>
                            <textarea
                              className={`${inputClass} min-h-20 resize-y`}
                              disabled={worklogSaving || taskDetailDirty}
                              maxLength={2_000}
                              onChange={(event) => setWorklogNote(event.target.value)}
                              value={worklogNote}
                            />
                          </label>
                        </div>
                        {taskDetailDirty && (
                          <p className="mt-2 text-[10px] text-amber-300">
                            {t('tasks.saveTaskBeforeWorklog')}
                          </p>
                        )}
                        <div className="mt-3 flex justify-end">
                          <Button
                            disabled={worklogSaving || taskDetailDirty || !worklogDuration.trim()}
                            onClick={() => void saveWorklog()}
                            type="button"
                          >
                            {worklogSaving
                              ? t('common.working')
                              : editingWorklogId
                                ? t('tasks.updateWorklog')
                                : t('tasks.logWork')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </section>
                  <section className="border-t border-slate-800 pt-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-slate-200">
                        {t('tasks.keyDates')}
                      </h3>
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                        {taskDetail.linked_key_dates?.length ?? 0}
                      </span>
                    </div>
                    {(taskDetail.linked_key_dates?.length ?? 0) > 0 ? (
                      <div className="mt-3 grid gap-2">
                        {(taskDetail.linked_key_dates ?? []).map((keyDate) => (
                          <Link
                            aria-label={t('tasks.openKeyDate', { title: keyDate.title })}
                            className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/35 px-3 py-2 hover:border-slate-600 hover:bg-slate-900/70"
                            key={keyDate.id}
                            onClick={(event) => {
                              if (!taskDetailOperationPending && !taskDetailHasDraft) {
                                setTaskDetailDirtyFields(new Set());
                                return;
                              }
                              event.preventDefault();
                              void leaveTaskDetailForPath(
                                `${base}/milestones?milestone=${keyDate.id}`,
                              );
                            }}
                            to={`${base}/milestones?milestone=${keyDate.id}`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium text-slate-200">
                                {keyDate.title}
                              </span>
                              <time
                                className="mt-0.5 block font-mono text-[10px] text-slate-500"
                                dateTime={keyDate.target_date}
                              >
                                {formatDate(`${keyDate.target_date}T00:00:00`)}
                              </time>
                            </span>
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold ${
                                keyDate.archived_at
                                  ? 'border-slate-700 bg-slate-800 text-slate-500'
                                  : keyDate.status === 'completed'
                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                    : keyDate.status === 'at_risk'
                                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                                      : keyDate.status === 'active'
                                        ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                                        : 'border-slate-700 bg-slate-800/70 text-slate-300'
                              }`}
                            >
                              {keyDate.archived_at
                                ? t('common.archived')
                                : t(`milestones.status.${keyDate.status}`)}
                            </span>
                            <span aria-hidden="true" className="text-slate-500">
                              ↗
                            </span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-600">{t('tasks.noKeyDates')}</p>
                    )}
                  </section>
                  {(taskDetail.children?.length ?? 0) > 0 && (
                    <section className="border-t border-slate-800 pt-5">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-slate-200">
                          {t('tasks.subtasks')}
                        </h3>
                        <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                          {t('tasks.childProgress', {
                            done: taskDetail.child_done_count ?? 0,
                            total: taskDetail.child_count ?? 0,
                          })}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2">
                        {(taskDetail.children ?? []).map((child) => (
                          <button
                            className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/35 px-3 py-2 text-left hover:border-slate-600"
                            key={child.id}
                            onClick={() => selectTaskDetail(child.task_key)}
                            type="button"
                          >
                            <span className="shrink-0 font-mono text-[9px] font-semibold text-sky-400/80">
                              {child.task_key}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs text-slate-300">
                              {child.title}
                            </span>
                            <span
                              className={`size-2 shrink-0 rounded-full ${child.status_category === 'done' ? 'bg-emerald-400' : child.status_category === 'in_progress' ? 'bg-sky-400' : 'bg-slate-500'}`}
                              title={
                                columns.find((column) => column.status === child.status)?.label ??
                                child.status
                              }
                            />
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                  <section
                    className={`border-t pt-5 transition-colors ${attachmentDragging ? 'border-sky-400 bg-sky-400/5' : 'border-slate-800'}`}
                    onDragEnter={(event) => {
                      if (!allowed(user, 'file.upload') || !allowed(user, 'task.update')) return;
                      event.preventDefault();
                      setAttachmentDragging(true);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                        setAttachmentDragging(false);
                    }}
                    onDragOver={(event) => {
                      if (!allowed(user, 'file.upload') || !allowed(user, 'task.update')) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'copy';
                    }}
                    onDrop={(event) => {
                      if (!allowed(user, 'file.upload') || !allowed(user, 'task.update')) return;
                      event.preventDefault();
                      setAttachmentDragging(false);
                      const selected = event.dataTransfer.files.item(0);
                      if (selected) void attachTaskFile(selected);
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-slate-200">
                        {t('tasks.linkedEvidence')}
                      </h3>
                      <div className="flex items-center gap-1">
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                          {taskDetail.links.length}
                        </span>
                        {allowed(user, 'file.upload') &&
                          allowed(user, 'task.update') &&
                          !taskDetail.archived_at && (
                            <>
                              <input
                                aria-label={t('tasks.chooseAttachment')}
                                className="sr-only"
                                disabled={attachmentUploading}
                                onChange={(event) => {
                                  const selected = event.target.files?.[0];
                                  if (selected) void attachTaskFile(selected);
                                }}
                                ref={attachmentInputRef}
                                type="file"
                              />
                              <IconAction
                                disabled={attachmentUploading}
                                icon="↑"
                                label={
                                  attachmentUploading
                                    ? t('tasks.attachmentUploading')
                                    : t('tasks.addAttachment')
                                }
                                onClick={() => attachmentInputRef.current?.click()}
                                tone="accent"
                                tooltipAlign="end"
                              />
                            </>
                          )}
                      </div>
                    </div>
                    {attachmentUploading && (
                      <p aria-live="polite" className="mt-2 text-xs text-sky-300" role="status">
                        {t('tasks.attachmentUploading')}
                      </p>
                    )}
                    {taskDetail.links.length > 0 ? (
                      <div className="mt-3 grid gap-2">
                        {taskDetail.links.map((link) => (
                          <div
                            className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/45 px-3 py-2"
                            key={link.id}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-slate-200">
                                {link.object_type_public_id && link.title ? (
                                  <Link
                                    className="text-sky-300 hover:underline"
                                    onClick={(event) => {
                                      if (!taskDetailOperationPending && !taskDetailHasDraft) {
                                        setTaskDetailDirtyFields(new Set());
                                        return;
                                      }
                                      event.preventDefault();
                                      void leaveTaskDetailForPath(
                                        `${base}/data/${link.object_type_public_id}/records/${link.entity_id}`,
                                      );
                                    }}
                                    title={t('tasks.openExternalLink', { title: link.title })}
                                    to={`${base}/data/${link.object_type_public_id}/records/${link.entity_id}`}
                                  >
                                    {link.title}
                                  </Link>
                                ) : (
                                  (link.title ??
                                  t('tasks.evidenceFallback', {
                                    type: link.entity_type.replaceAll('_', ' '),
                                  }))
                                )}
                              </p>
                              <p className="mt-0.5 truncate font-mono text-[9px] text-slate-500">
                                {link.entity_type === 'file'
                                  ? [
                                      link.file_series_name,
                                      link.file_version_number
                                        ? `v${link.file_version_number}`
                                        : link.version,
                                      typeof link.size_bytes === 'number'
                                        ? formatFileSize(link.size_bytes, locale)
                                        : null,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')
                                  : link.provider
                                    ? `${link.provider}${link.version ? ` · ${link.version}` : ''}`
                                    : (link.detail ?? link.entity_type.replaceAll('_', ' '))}
                              </p>
                            </div>
                            {link.archived_at && (
                              <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[9px] text-amber-300">
                                {t('common.archived')}
                              </span>
                            )}
                            {link.url && (
                              <IconAction
                                icon="↗"
                                label={t('tasks.openExternalLink', {
                                  title: link.title ?? link.url,
                                })}
                                onClick={() =>
                                  window.open(link.url!, '_blank', 'noopener,noreferrer')
                                }
                                tone="accent"
                                tooltipAlign="end"
                              />
                            )}
                            {link.entity_type === 'file' && !link.archived_at && (
                              <IconAction
                                disabled={Boolean(attachmentDownloadingId)}
                                icon="↓"
                                label={t('tasks.downloadAttachment', {
                                  title: link.title ?? t('tasks.attachment'),
                                })}
                                onClick={() => void downloadTaskFile(link)}
                                tone="accent"
                                tooltipAlign="end"
                              />
                            )}
                            {allowed(user, 'task.update') && !taskDetail.archived_at && (
                              <IconAction
                                disabled={linkSaving}
                                icon="×"
                                label={t('tasks.removeEvidenceLink', {
                                  title:
                                    link.title ??
                                    t('tasks.evidenceFallback', {
                                      type: link.entity_type.replaceAll('_', ' '),
                                    }),
                                })}
                                onClick={() => void removeTaskLink(link.id)}
                                tone="danger"
                                tooltipAlign="end"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-600">{t('tasks.noLinkedEvidence')}</p>
                    )}
                    {allowed(user, 'file.upload') &&
                      allowed(user, 'task.update') &&
                      !taskDetail.archived_at && (
                        <p className="mt-2 text-[10px] text-slate-600">
                          {t('tasks.attachmentDropHint')}
                        </p>
                      )}
                    {allowed(user, 'task.update') && !taskDetail.archived_at && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_2.5rem]">
                        <label className="grid gap-1 text-xs text-slate-400">
                          <FormFieldLabel required>{t('tasks.externalLinkTitle')}</FormFieldLabel>
                          <input
                            className={inputClass}
                            maxLength={240}
                            onChange={(event) => setExternalLinkTitle(event.target.value)}
                            placeholder={t('tasks.externalLinkTitlePlaceholder')}
                            value={externalLinkTitle}
                          />
                        </label>
                        <label className="grid gap-1 text-xs text-slate-400">
                          <FormFieldLabel required>{t('tasks.externalLinkUrl')}</FormFieldLabel>
                          <input
                            className={inputClass}
                            maxLength={2048}
                            onChange={(event) => setExternalLinkUrl(event.target.value)}
                            placeholder="https://…"
                            type="url"
                            value={externalLinkUrl}
                          />
                        </label>
                        <IconAction
                          className="mt-auto size-10 rounded-lg bg-sky-400 text-lg font-semibold text-slate-950 hover:bg-sky-300 hover:text-slate-950"
                          disabled={
                            linkSaving || !externalLinkTitle.trim() || !externalLinkUrl.trim()
                          }
                          icon="+"
                          label={t('tasks.addExternalLink')}
                          onClick={() => void addExternalLink()}
                          tooltipAlign="end"
                        />
                      </div>
                    )}
                    <p className="mt-2 text-[10px] leading-relaxed text-slate-600">
                      {t('tasks.externalLinkTraceabilityNote')}
                    </p>
                  </section>
                  <section className="border-t border-slate-800 pt-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-slate-200">
                        {t('tasks.relationships')}
                      </h3>
                      {(taskDetail.open_blocker_count ?? 0) > 0 && (
                        <span className="rounded-full bg-rose-400/10 px-2 py-1 text-[10px] font-medium text-rose-300">
                          {t('tasks.openBlockers', { count: taskDetail.open_blocker_count ?? 0 })}
                        </span>
                      )}
                    </div>
                    {(taskDetail.relationships ?? []).length > 0 ? (
                      <div className="mt-3 grid gap-2">
                        {(taskDetail.relationships ?? []).map((relationship) => {
                          const label =
                            relationship.relation_type === 'relates_to'
                              ? t('tasks.relatesTo')
                              : relationship.direction === 'outward'
                                ? t('tasks.blocks')
                                : t('tasks.blockedBy');
                          const status =
                            columns.find(
                              (column) => column.status === relationship.related_task_status,
                            )?.label ?? relationship.related_task_status;
                          return (
                            <div
                              className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/35 p-2"
                              key={relationship.id}
                            >
                              <button
                                className="min-w-0 flex-1 text-left"
                                onClick={() =>
                                  selectTaskDetail(
                                    relationship.related_task_key ?? relationship.related_task_id,
                                  )
                                }
                                title={t('tasks.openRelatedTask', {
                                  title: relationship.related_task_title,
                                })}
                                type="button"
                              >
                                <span className="block text-[10px] font-medium uppercase tracking-wider text-sky-400">
                                  {label}
                                </span>
                                <span className="block truncate text-xs text-slate-300">
                                  {relationship.related_task_key && (
                                    <span className="mr-1.5 font-mono text-[9px] text-sky-400/80">
                                      {relationship.related_task_key}
                                    </span>
                                  )}
                                  {relationship.related_task_title} · {status}
                                </span>
                              </button>
                              {allowed(user, 'task.update') && !taskDetail.archived_at && (
                                <button
                                  aria-label={t('tasks.removeRelationship', {
                                    title: relationship.related_task_title,
                                  })}
                                  className="grid size-8 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-rose-400/10 hover:text-rose-300"
                                  disabled={relationshipSaving}
                                  onClick={() => void removeRelationship(relationship.id)}
                                  title={t('tasks.removeRelationship', {
                                    title: relationship.related_task_title,
                                  })}
                                  type="button"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-600">{t('tasks.noRelationships')}</p>
                    )}
                    {allowed(user, 'task.update') && !taskDetail.archived_at && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_2.5rem]">
                        <label className="grid gap-1 text-xs text-slate-400">
                          <FormFieldLabel required>{t('tasks.relationshipType')}</FormFieldLabel>
                          <select
                            className={inputClass}
                            onChange={(event) =>
                              setRelationshipType(
                                event.target.value as 'blocks' | 'blocked_by' | 'relates_to',
                              )
                            }
                            value={relationshipType}
                          >
                            <option value="blocked_by">{t('tasks.blockedBy')}</option>
                            <option value="blocks">{t('tasks.blocks')}</option>
                            <option value="relates_to">{t('tasks.relatesTo')}</option>
                          </select>
                        </label>
                        <div className="grid gap-1 text-xs text-slate-400">
                          <FormFieldLabel required>{t('tasks.relatedTask')}</FormFieldLabel>
                          <TaskCandidatePicker
                            base={base}
                            excludeId={taskDetail.id}
                            label={t('tasks.relatedTask')}
                            onChange={setRelatedTaskCandidate}
                            value={relatedTaskCandidate}
                          />
                        </div>
                        <button
                          aria-label={t('tasks.addRelationship')}
                          className="mt-auto grid size-10 place-items-center rounded-lg bg-sky-400 text-lg font-semibold text-slate-950 hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-45"
                          disabled={!relatedTaskCandidate || relationshipSaving}
                          onClick={() => void addRelationship()}
                          title={t('tasks.addRelationship')}
                          type="button"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </section>
                  {(taskActivity.length > 0 || (taskDetail.activity_page_info?.total ?? 0) > 0) && (
                    <section className="border-t border-slate-800 pt-5">
                      <header className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-slate-200">
                          {t('tasks.activity')}
                        </h3>
                        <div className="flex items-center gap-0.5">
                          <div
                            aria-label={t('tasks.activityFilter')}
                            className="flex items-center gap-0.5"
                            role="group"
                          >
                            <IconAction
                              aria-pressed={activityFilter === 'all'}
                              icon="≡"
                              label={t('tasks.activityAll')}
                              onClick={() => setActivityFilter('all')}
                              tone={activityFilter === 'all' ? 'accent' : 'default'}
                            />
                            <IconAction
                              aria-pressed={activityFilter === 'comments'}
                              icon="●"
                              label={t('tasks.activityComments')}
                              onClick={() => setActivityFilter('comments')}
                              tone={activityFilter === 'comments' ? 'accent' : 'default'}
                            />
                            <IconAction
                              aria-pressed={activityFilter === 'history'}
                              icon="◴"
                              label={t('tasks.activityHistory')}
                              onClick={() => setActivityFilter('history')}
                              tone={activityFilter === 'history' ? 'accent' : 'default'}
                            />
                          </div>
                          <IconAction
                            aria-pressed={activitySort === 'oldest'}
                            icon={activitySort === 'newest' ? '↓' : '↑'}
                            label={
                              activitySort === 'newest'
                                ? t('tasks.activityNewestFirst')
                                : t('tasks.activityOldestFirst')
                            }
                            onClick={() =>
                              setActivitySort((current) =>
                                current === 'newest' ? 'oldest' : 'newest',
                              )
                            }
                            tooltipAlign="end"
                          />
                        </div>
                      </header>
                      <div className="mt-3 space-y-3">
                        {taskDetail.activity_page_info?.hasNext && (
                          <button
                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-400 hover:border-slate-700 hover:bg-slate-900 disabled:opacity-50"
                            disabled={activityLoading}
                            onClick={() => void loadEarlierActivity()}
                            type="button"
                          >
                            <span aria-hidden="true">↑</span>
                            {activityLoading ? t('common.loading') : t('tasks.loadEarlierActivity')}
                          </button>
                        )}
                        {visibleTaskActivity.length === 0 && (
                          <p className="rounded-lg border border-dashed border-slate-800 px-3 py-4 text-center text-xs text-slate-600">
                            {t('tasks.noMatchingActivity')}
                          </p>
                        )}
                        {visibleTaskActivity.map((activity) => {
                          if (activity.kind === 'status') {
                            const item = activity.item;
                            return (
                              <div
                                className="flex items-center gap-3 text-xs"
                                key={`status:${item.id}`}
                              >
                                <span className="size-1.5 rounded-full bg-sky-400" />
                                <span className="text-slate-400">
                                  {t(
                                    item.from_status === null
                                      ? 'tasks.activityCreated'
                                      : 'tasks.activityStatusChanged',
                                    {
                                      actor: item.changed_by_name,
                                      status:
                                        columns.find((column) => column.status === item.to_status)
                                          ?.label ?? item.to_status,
                                    },
                                  )}
                                </span>
                                <time className="ml-auto text-slate-600" dateTime={item.changed_at}>
                                  {formatDate(item.changed_at, activityTimestampOptions)}
                                </time>
                              </div>
                            );
                          }
                          if (activity.kind === 'change') {
                            const change = activity.item;
                            return (
                              <article
                                className="rounded-xl border border-slate-800 bg-slate-900/25 p-3"
                                key={`change:${change.id}`}
                              >
                                <header className="flex items-center gap-2 text-xs">
                                  <span className="size-1.5 rounded-full bg-violet-400" />
                                  <strong className="text-slate-300">
                                    {change.changed_by_name}
                                  </strong>
                                  {change.automation_rule_name && (
                                    <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300">
                                      {t('tasks.activityAutomated', {
                                        rule: change.automation_rule_name,
                                      })}
                                    </span>
                                  )}
                                  <time
                                    className="ml-auto text-[10px] text-slate-600"
                                    dateTime={change.changed_at}
                                  >
                                    {formatDate(change.changed_at, activityTimestampOptions)}
                                  </time>
                                </header>
                                <ul className="mt-2 space-y-1 text-xs text-slate-400">
                                  {change.changes
                                    .filter((item) => item.changed)
                                    .map((item) => (
                                      <li key={item.field}>{taskChangeText(item)}</li>
                                    ))}
                                </ul>
                              </article>
                            );
                          }
                          if (activity.kind === 'link') {
                            const link = activity.item;
                            return (
                              <div
                                className="flex items-center gap-2 rounded-lg border border-emerald-500/10 bg-emerald-500/5 px-3 py-2 text-xs"
                                key={`link:${link.id}`}
                              >
                                <span aria-hidden="true" className="text-emerald-400">
                                  ↗
                                </span>
                                <span className="min-w-0 flex-1 truncate text-slate-400">
                                  {t(
                                    link.action === 'task.link_added'
                                      ? 'tasks.activityLinkAdded'
                                      : 'tasks.activityLinkRemoved',
                                    {
                                      actor: link.changed_by_name,
                                      title:
                                        link.title ??
                                        t('tasks.evidenceFallback', {
                                          type: link.entity_type.replaceAll('_', ' '),
                                        }),
                                    },
                                  )}
                                </span>
                                <time
                                  className="shrink-0 text-[10px] text-slate-600"
                                  dateTime={link.changed_at}
                                >
                                  {formatDate(link.changed_at, activityTimestampOptions)}
                                </time>
                              </div>
                            );
                          }
                          const comment = activity.item;
                          const editing = editingCommentId === comment.id;
                          const revisions = comment.revisions ?? [];
                          const editChanged = editing && commentEditChanged(comment);
                          return (
                            <article
                              className="rounded-xl border border-slate-800 bg-slate-900/35 p-3"
                              key={`comment:${comment.id}`}
                            >
                              <header className="flex items-center gap-2 text-xs">
                                <span className="grid size-6 place-items-center rounded-full bg-slate-800 text-[10px] font-semibold text-sky-300">
                                  {comment.author_name.slice(0, 1).toUpperCase()}
                                </span>
                                <strong className="text-slate-300">{comment.author_name}</strong>
                                {comment.edited_at && (
                                  <span
                                    aria-label={t('tasks.commentEdited')}
                                    className="text-[10px] text-slate-600"
                                    title={t('tasks.commentEdited')}
                                  >
                                    ✎
                                  </span>
                                )}
                                {editing ? (
                                  <span className="ml-auto flex items-center gap-0.5">
                                    <IconAction
                                      disabled={
                                        commentEditSaving ||
                                        !editingCommentText.trim() ||
                                        !editChanged
                                      }
                                      icon="✓"
                                      label={t('common.save')}
                                      onClick={() => void saveCommentEdit(comment)}
                                      tone="success"
                                    />
                                    <IconAction
                                      disabled={commentEditSaving}
                                      icon="×"
                                      label={t('common.cancel')}
                                      onClick={cancelCommentEdit}
                                    />
                                  </span>
                                ) : (
                                  <span className="ml-auto flex items-center gap-0.5">
                                    {(comment.revision_count ?? revisions.length) > 0 && (
                                      <IconAction
                                        aria-expanded={commentHistoryOpenId === comment.id}
                                        disabled={commentHistoryLoadingId === comment.id}
                                        icon="◴"
                                        label={t('tasks.commentHistory')}
                                        onClick={() => void toggleCommentHistory(comment)}
                                      />
                                    )}
                                    {allowed(user, 'task.comment') &&
                                      !taskDetail.archived_at &&
                                      comment.author_id === user.id && (
                                        <IconAction
                                          icon="✎"
                                          label={t('tasks.editComment')}
                                          onClick={() => beginCommentEdit(comment)}
                                        />
                                      )}
                                  </span>
                                )}
                                <time
                                  className="text-[10px] text-slate-600"
                                  dateTime={comment.edited_at ?? comment.created_at}
                                >
                                  {formatDate(
                                    comment.edited_at ?? comment.created_at,
                                    activityTimestampOptions,
                                  )}
                                </time>
                              </header>
                              {editing ? (
                                <div className="mt-3">
                                  <textarea
                                    aria-label={t('tasks.editComment')}
                                    autoFocus
                                    className={`${inputClass} min-h-24 resize-y`}
                                    maxLength={10_000}
                                    onChange={(event) => setEditingCommentText(event.target.value)}
                                    value={editingCommentText}
                                  />
                                  {availableAssignees.filter((assignee) => assignee.id !== user.id)
                                    .length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      <MentionButtons
                                        assignees={availableAssignees}
                                        currentUserId={user.id}
                                        onToggle={(id) =>
                                          setEditingCommentMentions((current) => {
                                            const next = new Set(current);
                                            if (next.has(id)) next.delete(id);
                                            else next.add(id);
                                            return next;
                                          })
                                        }
                                        selectedIds={editingCommentMentions}
                                        title={(name) => t('tasks.mention', { name })}
                                      />
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <>
                                  {(comment.mentions ?? []).length > 0 && (
                                    <p className="mt-2 text-[10px] text-sky-400">
                                      {(comment.mentions ?? [])
                                        .map((mention) => `@${mention.displayName}`)
                                        .join(' ')}
                                    </p>
                                  )}
                                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                                    {comment.body}
                                  </p>
                                </>
                              )}
                              {commentHistoryOpenId === comment.id && (
                                <section className="mt-3 border-t border-slate-800 pt-3">
                                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                    {t('tasks.commentHistory')}
                                  </h4>
                                  {commentHistoryLoadingId === comment.id &&
                                    revisions.length === 0 && (
                                      <p className="mt-2 text-xs text-slate-500">
                                        {t('common.loading')}
                                      </p>
                                    )}
                                  <ol className="mt-2 space-y-2">
                                    {[...revisions].reverse().map((revision) => (
                                      <li
                                        className="rounded-lg border border-slate-800 bg-slate-950/55 px-3 py-2"
                                        key={revision.revision}
                                      >
                                        <div className="flex items-center gap-2 text-[10px] text-slate-600">
                                          <span>v{revision.revision}</span>
                                          <span>· {revision.edited_by_name}</span>
                                          <time className="ml-auto" dateTime={revision.edited_at}>
                                            {formatDate(
                                              revision.edited_at,
                                              activityTimestampOptions,
                                            )}
                                          </time>
                                        </div>
                                        {revision.mentions.length > 0 && (
                                          <p className="mt-1 text-[10px] text-sky-500/80">
                                            {revision.mentions
                                              .map((mention) => `@${mention.displayName}`)
                                              .join(' ')}
                                          </p>
                                        )}
                                        <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-400">
                                          {revision.body}
                                        </p>
                                      </li>
                                    ))}
                                  </ol>
                                  {revisions.length <
                                    (comment.revision_count ?? revisions.length) && (
                                    <button
                                      className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-400 hover:bg-slate-900 disabled:opacity-50"
                                      disabled={commentHistoryLoadingId === comment.id}
                                      onClick={() => void loadCommentRevisions(comment)}
                                      type="button"
                                    >
                                      <span aria-hidden="true">↑</span>
                                      {commentHistoryLoadingId === comment.id
                                        ? t('common.loading')
                                        : t('tasks.loadEarlierRevisions')}
                                    </button>
                                  )}
                                </section>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  )}
                  {allowed(user, 'task.comment') &&
                    !taskDetail.archived_at &&
                    !editingCommentId && (
                      <section className="border-t border-slate-800 pt-5">
                        <h3 className="text-sm font-semibold text-slate-200">
                          {t('tasks.addComment')}
                        </h3>
                        <label className="mt-3 grid gap-1 text-xs text-slate-400">
                          <FormFieldLabel required>{t('tasks.comment')}</FormFieldLabel>
                          <textarea
                            aria-keyshortcuts="M"
                            aria-label={t('tasks.comment')}
                            data-task-comment-composer
                            className={`${inputClass} min-h-24 resize-y`}
                            maxLength={10_000}
                            onChange={(event) => setCommentText(event.target.value)}
                            placeholder={t('tasks.commentPlaceholder')}
                            value={commentText}
                          />
                        </label>
                        {availableAssignees.filter((assignee) => assignee.id !== user.id).length >
                          0 && (
                          <div className="mt-3">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-600">
                              {t('tasks.mentionPeople')}
                            </span>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <MentionButtons
                                assignees={availableAssignees}
                                currentUserId={user.id}
                                onToggle={(id) =>
                                  setMentionedUserIds((current) => {
                                    const next = new Set(current);
                                    if (next.has(id)) next.delete(id);
                                    else next.add(id);
                                    return next;
                                  })
                                }
                                selectedIds={mentionedUserIds}
                                title={(name) => t('tasks.mention', { name })}
                              />
                            </div>
                          </div>
                        )}
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <label className="flex items-center gap-2 text-xs text-slate-400">
                            <input
                              checked={commentWatch}
                              onChange={(event) => setCommentWatch(event.target.checked)}
                              type="checkbox"
                            />
                            {t('tasks.watchAfterComment')}
                          </label>
                          <Button
                            disabled={commentSaving || !commentText.trim()}
                            onClick={() => void addComment()}
                            type="button"
                          >
                            {commentSaving ? t('common.working') : t('tasks.postComment')}
                          </Button>
                        </div>
                      </section>
                    )}
                  {allowed(user, 'task.update') && (
                    <div className="flex justify-end border-t border-slate-800 pt-5">
                      <Button disabled={detailSaving || !taskDetailDirty} type="submit">
                        {detailSaving ? t('common.working') : t('tasks.saveChanges')}
                      </Button>
                    </div>
                  )}
                </form>
              </>
            )}
          </aside>
        </div>
      )}
      {creatorOpen && allowed(user, 'task.create') && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-6"
          role="presentation"
        >
          <button
            aria-label={locale === 'ko' ? '작업 만들기 닫기' : 'Close task creator'}
            className="absolute inset-0 cursor-default bg-slate-950/70 backdrop-blur-sm"
            data-modal-backdrop
            disabled={busy}
            onClick={dismissCreator}
            type="button"
          />
          <div
            aria-labelledby="task-creator-title"
            aria-modal="true"
            className="relative max-h-[min(780px,calc(100vh-2rem))] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl shadow-black/50"
            ref={creatorDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/90 px-5 py-4 backdrop-blur-xl sm:px-6">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-400">
                    {t('common.project')}
                  </p>
                  {creatorDirty && (
                    <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[9px] font-semibold text-amber-300">
                      {t('tasks.unsavedDraft')}
                    </span>
                  )}
                </div>
                <h2 className="mt-1 text-2xl font-semibold" id="task-creator-title">
                  {creatorSource ? t('tasks.cloneTask') : t('tasks.create')}
                </h2>
              </div>
              <button
                aria-label={locale === 'ko' ? '작업 만들기 닫기' : 'Close task creator'}
                className="grid size-9 place-items-center rounded-lg border border-slate-700 text-xl text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                disabled={busy}
                onClick={dismissCreator}
                title={locale === 'ko' ? '작업 만들기 닫기' : 'Close task creator'}
                type="button"
              >
                ×
              </button>
            </header>
            <form
              className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6"
              onChangeCapture={(event) =>
                setCreatorDirty(creatorFormHasDraft({}, event.currentTarget))
              }
              onSubmit={(event) => void create(event)}
              ref={creatorFormRef}
            >
              {creatorSource && (
                <div className="rounded-xl border border-sky-400/20 bg-sky-400/5 px-3 py-2 text-xs text-slate-400 sm:col-span-2">
                  <p className="font-medium text-sky-300">
                    {t('tasks.cloneSource', {
                      task: creatorSource.task_key
                        ? `${creatorSource.task_key} · ${creatorSource.title}`
                        : creatorSource.title,
                    })}
                  </p>
                  <p className="mt-1 leading-5">{t('tasks.cloneScope')}</p>
                </div>
              )}
              <label className={`${taskFormLabelClass} sm:col-span-2`}>
                <FormFieldLabel required>{t('tasks.title')}</FormFieldLabel>
                <input
                  className={inputClass}
                  data-dialog-initial-focus
                  defaultValue={
                    creatorSource
                      ? t('tasks.cloneTitle', { title: creatorSource.title })
                      : undefined
                  }
                  name="title"
                  required
                />
              </label>
              <label className={`${taskFormLabelClass} sm:col-span-2`}>
                <FormFieldLabel>{t('tasks.descriptionLabel')}</FormFieldLabel>
                <textarea
                  className={`${inputClass} min-h-24 resize-y py-2`}
                  defaultValue={creatorSource?.description}
                  name="description"
                />
              </label>
              <label className={`${taskFormLabelClass} sm:col-span-2`}>
                <FormFieldLabel>{t('tasks.labels')}</FormFieldLabel>
                <input
                  className={inputClass}
                  defaultValue={(creatorSource?.labels ?? []).join(', ')}
                  name="labels"
                  placeholder={t('tasks.labelsPlaceholder')}
                />
                <span className="text-[10px] text-slate-600">{t('tasks.labelsHint')}</span>
              </label>
              <label className={taskFormLabelClass}>
                <FormFieldLabel required>{t('tasks.priority')}</FormFieldLabel>
                <select
                  className={inputClass}
                  name="priority"
                  defaultValue={creatorSource?.priority ?? 'medium'}
                  required
                >
                  <option value="low">{t('tasks.low')}</option>
                  <option value="medium">{t('tasks.medium')}</option>
                  <option value="high">{t('tasks.high')}</option>
                  <option value="critical">{t('tasks.critical')}</option>
                </select>
              </label>
              {canManageTaskVisibility && (
                <label className={taskFormLabelClass}>
                  <FormFieldLabel required>{t('tasks.visibilityMode')}</FormFieldLabel>
                  <select className={inputClass} defaultValue="project" name="visibility" required>
                    <option value="project">{t('tasks.projectVisibility')}</option>
                    <option value="restricted">{t('tasks.restrictedVisibility')}</option>
                  </select>
                  <span className="text-[10px] text-slate-600">
                    {t('tasks.createVisibilityHint')}
                  </span>
                </label>
              )}
              <label className={taskFormLabelClass}>
                <FormFieldLabel>{t('tasks.assignee')}</FormFieldLabel>
                <AssigneePicker
                  ariaLabel={t('tasks.assignee')}
                  base={base}
                  className={inputClass}
                  defaultValue={creatorSource?.assignee_id ?? ''}
                  disabled={assigneesLoading}
                  initialOptions={availableAssignees}
                  key={`creator-assignee:${creatorSource?.id ?? 'new'}`}
                  name="assigneeId"
                  onChange={(value) => setCreatorDirty(creatorFormHasDraft({ assigneeId: value }))}
                  specialOptions={[{ value: '', label: t('tasks.unassigned') }]}
                />
              </label>
              <label className={taskFormLabelClass}>
                <FormFieldLabel>{t('tasks.dueDate')}</FormFieldLabel>
                <input
                  className={inputClass}
                  defaultValue={creatorSource?.due_date ?? ''}
                  name="dueDate"
                  type="date"
                />
              </label>
              <label className={taskFormLabelClass}>
                <FormFieldLabel>{t('tasks.originalEstimate')}</FormFieldLabel>
                <input
                  className={inputClass}
                  defaultValue={
                    creatorSource?.original_estimate_minutes === null ||
                    creatorSource?.original_estimate_minutes === undefined
                      ? ''
                      : formatTaskDuration(creatorSource.original_estimate_minutes)
                  }
                  name="originalEstimate"
                  placeholder={t('tasks.durationPlaceholder')}
                />
                <span className="text-[10px] text-slate-600">{t('tasks.durationHint')}</span>
              </label>
              <div className={taskFormLabelClass}>
                <FormFieldLabel>{t('tasks.parentTask')}</FormFieldLabel>
                <TaskCandidatePicker
                  base={base}
                  label={t('tasks.parentTask')}
                  name="parentTaskId"
                  onChange={(candidate) => {
                    setCreateParentCandidate(candidate);
                    setCreatorDirty(creatorFormHasDraft({ parentTaskId: candidate?.id ?? '' }));
                  }}
                  topLevelOnly
                  value={createParentCandidate}
                />
                <span className="text-[10px] text-slate-600">{t('tasks.parentHint')}</span>
              </div>
              {assigneesLoadError && (
                <p aria-live="polite" className="text-xs text-amber-300 sm:col-span-2">
                  {assigneesLoadError}
                </p>
              )}
              <div className="flex justify-end gap-2 border-t border-slate-800 pt-4 sm:col-span-2">
                <Button disabled={busy} onClick={dismissCreator} type="button" variant="quiet">
                  {locale === 'ko' ? '취소' : 'Cancel'}
                </Button>
                <Button disabled={busy} type="submit">
                  {busy
                    ? t('tasks.creating')
                    : creatorSource
                      ? t('tasks.createClone')
                      : t('tasks.create')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(undefined)} />
    </>
  );
}

function AssigneeAvatar({ label, name }: { label: string; name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return (
    <span
      aria-label={label}
      className="grid size-6 shrink-0 place-items-center rounded-full border border-slate-700 bg-slate-800 text-[9px] font-semibold text-sky-300"
      title={label}
    >
      {initials || '?'}
    </span>
  );
}
