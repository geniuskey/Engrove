import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from './App.js';
import { useActionDialog } from './ActionDialogProvider.js';
import { FormFieldLabel } from './FormFieldLabel.js';
import { useI18n } from './i18n.js';

type Status = string;
type Priority = 'low' | 'medium' | 'high' | 'critical';
type TriggerType =
  'task.created' | 'task.status_changed' | 'task.priority_changed' | 'task.assignee_changed';

interface Assignee {
  id: string;
  displayName: string;
}

interface WorkflowStatus {
  key: Status;
  name: string;
}

interface AutomationRule {
  id: string;
  name: string;
  description: string;
  triggerType: TriggerType;
  triggerConfig: Record<string, string>;
  conditionConfig: { status?: Status; priority?: Priority; assignee?: 'assigned' | 'unassigned' };
  actionConfig: { status?: Status; priority?: Priority; assigneeId?: string | null };
  active: boolean;
  executionCount: number;
  failedCount: number;
  lastOutcome: AutomationOutcome | null;
  lastErrorCode: string | null;
  lastExecutedAt: string | null;
}

interface AutomationExecution {
  id: string;
  ruleName: string;
  triggerType: TriggerType;
  triggerEvent: Record<string, unknown>;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  traceId: string;
  depth: number;
  outcome: 'succeeded' | 'no_change' | 'failed';
  changes: Record<string, unknown>;
  errorCode: string | null;
  durationMs: number;
  createdAt: string;
}

type AutomationOutcome = AutomationExecution['outcome'];
type ExecutionFilter = AutomationOutcome | 'all';
interface ExecutionPage {
  items: AutomationExecution[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
  summary: Record<AutomationOutcome, number>;
}
interface AutomationRulePage {
  items: AutomationRule[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
}

interface Draft {
  name: string;
  description: string;
  triggerType: TriggerType;
  fromStatus: 'any' | Status;
  toStatus: 'any' | Status;
  fromPriority: 'any' | Priority;
  toPriority: 'any' | Priority;
  assignment: 'any' | 'assigned' | 'unassigned' | 'changed';
  conditionStatus: '' | Status;
  conditionPriority: '' | Priority;
  conditionAssignee: '' | 'assigned' | 'unassigned';
  actionStatus: '' | Status;
  actionPriority: '' | Priority;
  actionAssignee: 'unchanged' | 'unassigned' | string;
  active: boolean;
}

const priorities: Priority[] = ['low', 'medium', 'high', 'critical'];
const outcomes: AutomationOutcome[] = ['succeeded', 'no_change', 'failed'];
const EXECUTION_PAGE_SIZE = 25;
const RULE_PAGE_SIZE = 50;
const defaultWorkflowStatuses: WorkflowStatus[] = [
  { key: 'todo', name: 'To do' },
  { key: 'in_progress', name: 'In progress' },
  { key: 'blocked', name: 'Blocked' },
  { key: 'done', name: 'Done' },
];
const fieldClass =
  'min-h-9 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-200 outline-none focus:border-sky-400';
const blankDraft: Draft = {
  name: '',
  description: '',
  triggerType: 'task.status_changed',
  fromStatus: 'any',
  toStatus: 'blocked',
  fromPriority: 'any',
  toPriority: 'critical',
  assignment: 'any',
  conditionStatus: '',
  conditionPriority: '',
  conditionAssignee: '',
  actionStatus: '',
  actionPriority: 'high',
  actionAssignee: 'unchanged',
  active: true,
};

export function TaskAutomationSettings({
  workspaceId,
  projectId,
}: {
  workspaceId: string;
  projectId: string;
}) {
  const { formatDate, t } = useI18n();
  const { confirmAction } = useActionDialog();
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [rulePage, setRulePage] = useState<AutomationRulePage>();
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [statuses, setStatuses] = useState<WorkflowStatus[]>(defaultWorkflowStatuses);
  const [executions, setExecutions] = useState<AutomationExecution[]>([]);
  const [executionPage, setExecutionPage] = useState<ExecutionPage>();
  const [executionFilter, setExecutionFilter] = useState<ExecutionFilter>('all');
  const [executionRuleId, setExecutionRuleId] = useState('all');
  const [executionLoading, setExecutionLoading] = useState<'page' | 'more' | ''>('');
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [editingId, setEditingId] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rulesLoadingMore, setRulesLoadingMore] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ruleResult, assigneeResult, workflowResult] = await Promise.all([
        api<AutomationRulePage>(`${base}/task-automations`),
        api<{ items: Assignee[] }>(`${base}/task-assignees`),
        api<{ statuses: WorkflowStatus[] }>(`${base}/task-workflow`),
      ]);
      setRules(ruleResult.items);
      setRulePage({
        ...ruleResult,
        pageInfo: ruleResult.pageInfo ?? {
          limit: RULE_PAGE_SIZE,
          offset: 0,
          total: ruleResult.items.length,
          hasNext: false,
        },
      });
      setAssignees(assigneeResult.items);
      if (Array.isArray(workflowResult.statuses) && workflowResult.statuses.length)
        setStatuses(workflowResult.statuses);
      setMessage('');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('automations.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [base, t]);
  useEffect(() => void load(), [load]);

  async function loadMoreRules() {
    if (!rulePage?.pageInfo.hasNext || rulesLoadingMore) return;
    setRulesLoadingMore(true);
    try {
      const result = await api<AutomationRulePage>(
        `${base}/task-automations?limit=${RULE_PAGE_SIZE}&offset=${rules.length}`,
      );
      setRules((current) => [
        ...current,
        ...result.items.filter((item) => !current.some((candidate) => candidate.id === item.id)),
      ]);
      setRulePage(result);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('automations.loadFailed'));
    } finally {
      setRulesLoadingMore(false);
    }
  }

  const statusLabel = (status: Status) => {
    const name = statuses.find((item) => item.key === status)?.name ?? status;
    if (status === 'todo' && name === 'To do') return t('tasks.todo');
    if (status === 'in_progress' && name === 'In progress') return t('tasks.inProgress');
    if (status === 'blocked' && name === 'Blocked') return t('tasks.blocked');
    if (status === 'done' && name === 'Done') return t('tasks.done');
    return name;
  };
  const priorityLabel = (priority: Priority) => t(`tasks.${priority}`);
  const triggerLabel = (trigger: TriggerType) => t(`automations.trigger.${trigger}`);

  function bodyFromDraft(value: Draft) {
    const triggerConfig =
      value.triggerType === 'task.status_changed'
        ? { fromStatus: value.fromStatus, toStatus: value.toStatus }
        : value.triggerType === 'task.priority_changed'
          ? { fromPriority: value.fromPriority, toPriority: value.toPriority }
          : value.triggerType === 'task.assignee_changed'
            ? { assignment: value.assignment }
            : {};
    return {
      name: value.name,
      description: value.description,
      triggerType: value.triggerType,
      triggerConfig,
      conditionConfig: {
        ...(value.conditionStatus ? { status: value.conditionStatus } : {}),
        ...(value.conditionPriority ? { priority: value.conditionPriority } : {}),
        ...(value.conditionAssignee ? { assignee: value.conditionAssignee } : {}),
      },
      actionConfig: {
        ...(value.actionStatus ? { status: value.actionStatus } : {}),
        ...(value.actionPriority ? { priority: value.actionPriority } : {}),
        ...(value.actionAssignee !== 'unchanged'
          ? { assigneeId: value.actionAssignee === 'unassigned' ? null : value.actionAssignee }
          : {}),
      },
      active: value.active,
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = bodyFromDraft(draft);
    if (!Object.keys(body.actionConfig).length) {
      setMessage(t('automations.actionRequired'));
      return;
    }
    setBusy('save');
    try {
      const saved = await api<AutomationRule>(
        `${base}/task-automations${editingId ? `/${editingId}` : ''}`,
        { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      );
      setRules((current) =>
        editingId
          ? current.map((rule) => (rule.id === saved.id ? saved : rule))
          : [saved, ...current],
      );
      if (!editingId)
        setRulePage((current) =>
          current
            ? {
                ...current,
                pageInfo: { ...current.pageInfo, total: current.pageInfo.total + 1 },
              }
            : current,
        );
      setMessage(t(editingId ? 'automations.updated' : 'automations.created'));
      setEditingId('');
      setDraft(blankDraft);
      setEditorOpen(false);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('automations.saveFailed'));
    } finally {
      setBusy('');
    }
  }

  function edit(rule: AutomationRule) {
    setEditingId(rule.id);
    setEditorOpen(true);
    setDraft({
      ...blankDraft,
      name: rule.name,
      description: rule.description,
      triggerType: rule.triggerType,
      fromStatus: (rule.triggerConfig.fromStatus as Draft['fromStatus']) ?? 'any',
      toStatus: (rule.triggerConfig.toStatus as Draft['toStatus']) ?? 'any',
      fromPriority: (rule.triggerConfig.fromPriority as Draft['fromPriority']) ?? 'any',
      toPriority: (rule.triggerConfig.toPriority as Draft['toPriority']) ?? 'any',
      assignment: (rule.triggerConfig.assignment as Draft['assignment']) ?? 'any',
      conditionStatus: rule.conditionConfig.status ?? '',
      conditionPriority: rule.conditionConfig.priority ?? '',
      conditionAssignee: rule.conditionConfig.assignee ?? '',
      actionStatus: rule.actionConfig.status ?? '',
      actionPriority: rule.actionConfig.priority ?? '',
      actionAssignee: Object.prototype.hasOwnProperty.call(rule.actionConfig, 'assigneeId')
        ? (rule.actionConfig.assigneeId ?? 'unassigned')
        : 'unchanged',
      active: rule.active,
    });
  }

  async function toggle(rule: AutomationRule) {
    setBusy(rule.id);
    try {
      const currentDraft = { ...blankDraft };
      const draftForRule: Draft = {
        ...currentDraft,
        name: rule.name,
        description: rule.description,
        triggerType: rule.triggerType,
        fromStatus: (rule.triggerConfig.fromStatus as Draft['fromStatus']) ?? 'any',
        toStatus: (rule.triggerConfig.toStatus as Draft['toStatus']) ?? 'any',
        fromPriority: (rule.triggerConfig.fromPriority as Draft['fromPriority']) ?? 'any',
        toPriority: (rule.triggerConfig.toPriority as Draft['toPriority']) ?? 'any',
        assignment: (rule.triggerConfig.assignment as Draft['assignment']) ?? 'any',
        conditionStatus: rule.conditionConfig.status ?? '',
        conditionPriority: rule.conditionConfig.priority ?? '',
        conditionAssignee: rule.conditionConfig.assignee ?? '',
        actionStatus: rule.actionConfig.status ?? '',
        actionPriority: rule.actionConfig.priority ?? '',
        actionAssignee: Object.prototype.hasOwnProperty.call(rule.actionConfig, 'assigneeId')
          ? (rule.actionConfig.assigneeId ?? 'unassigned')
          : 'unchanged',
        active: !rule.active,
      };
      const updated = await api<AutomationRule>(`${base}/task-automations/${rule.id}`, {
        method: 'PATCH',
        body: JSON.stringify(bodyFromDraft(draftForRule)),
      });
      setRules((current) => current.map((item) => (item.id === rule.id ? updated : item)));
      setEditingId('');
      setDraft(blankDraft);
      setEditorOpen(false);
      setMessage(t(updated.active ? 'automations.resumed' : 'automations.paused'));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('automations.saveFailed'));
    } finally {
      setBusy('');
    }
  }

  async function loadExecutions(
    filter: ExecutionFilter,
    ruleId = executionRuleId,
    offset = 0,
    append = false,
  ) {
    setExecutionLoading(append ? 'more' : 'page');
    try {
      const parameters = new URLSearchParams({
        outcome: filter,
        limit: String(EXECUTION_PAGE_SIZE),
        offset: String(offset),
      });
      if (ruleId !== 'all') parameters.set('ruleId', ruleId);
      const result = await api<ExecutionPage>(
        `${base}/task-automations/executions?${parameters.toString()}`,
      );
      setExecutions((current) => (append ? [...current, ...result.items] : result.items));
      setExecutionPage(result);
      setMessage('');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('automations.loadFailed'));
    } finally {
      setExecutionLoading('');
    }
  }

  async function toggleHistory() {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    if (!executionPage) await loadExecutions(executionFilter, executionRuleId);
  }

  function filterExecutions(filter: ExecutionFilter) {
    setExecutionFilter(filter);
    void loadExecutions(filter, executionRuleId);
  }

  function filterExecutionRule(ruleId: string) {
    setExecutionRuleId(ruleId);
    void loadExecutions(executionFilter, ruleId);
  }

  function loadMoreExecutions() {
    if (!executionPage?.pageInfo.hasNext || executionLoading) return;
    void loadExecutions(executionFilter, executionRuleId, executions.length, true);
  }

  function viewRuleHistory(ruleId: string) {
    setHistoryOpen(true);
    setExecutionRuleId(ruleId);
    void loadExecutions(executionFilter, ruleId);
  }

  async function archive(rule: AutomationRule) {
    if (
      !(await confirmAction(t('automations.archiveConfirm', { name: rule.name }), {
        tone: 'danger',
      }))
    )
      return;
    setBusy(rule.id);
    try {
      await api(`${base}/task-automations/${rule.id}/archive`, { method: 'POST' });
      setRules((current) => current.filter((item) => item.id !== rule.id));
      setRulePage((current) =>
        current
          ? {
              ...current,
              pageInfo: {
                ...current.pageInfo,
                total: Math.max(0, current.pageInfo.total - 1),
                hasNext: rules.length - 1 < current.pageInfo.total - 1,
              },
            }
          : current,
      );
      if (editingId === rule.id) {
        setEditingId('');
        setDraft(blankDraft);
        setEditorOpen(false);
      }
      setMessage(t('automations.archived'));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('automations.saveFailed'));
    } finally {
      setBusy('');
    }
  }

  return (
    <details className="group mt-6 border-t border-slate-800 pt-5">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
        <span>
          <h2 className="text-sm font-semibold text-slate-200">{t('automations.heading')}</h2>
          <p className="mt-1 text-xs text-slate-500">{t('automations.help')}</p>
        </span>
        <span aria-hidden="true" className="text-slate-500 group-open:rotate-180">
          ⌄
        </span>
      </summary>
      <div className="mt-3 flex justify-end">
        <span className="flex gap-1">
          <button
            aria-expanded={editorOpen}
            aria-label={t('automations.new')}
            className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-sky-300"
            onClick={() => {
              setEditingId('');
              setDraft(blankDraft);
              setEditorOpen((current) => !current);
            }}
            title={t('automations.new')}
            type="button"
          >
            +
          </button>
          <button
            aria-expanded={historyOpen}
            aria-label={t('automations.executionHistory')}
            className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-sky-300"
            onClick={() => void toggleHistory()}
            title={t('automations.executionHistory')}
            type="button"
          >
            ⌁
          </button>
        </span>
      </div>
      {editorOpen && (
        <form
          className="mt-4 grid gap-3 rounded-xl border border-slate-800 p-3"
          onSubmit={(event) => void submit(event)}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-slate-400">
              <FormFieldLabel required>{t('automations.name')}</FormFieldLabel>
              <input
                className={fieldClass}
                maxLength={80}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                required
                value={draft.name}
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              <FormFieldLabel required>{t('automations.trigger')}</FormFieldLabel>
              <select
                className={fieldClass}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    triggerType: event.target.value as TriggerType,
                  }))
                }
                value={draft.triggerType}
              >
                {(
                  [
                    'task.created',
                    'task.status_changed',
                    'task.priority_changed',
                    'task.assignee_changed',
                  ] as TriggerType[]
                ).map((trigger) => (
                  <option key={trigger} value={trigger}>
                    {triggerLabel(trigger)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="grid gap-1 text-xs text-slate-400">
            <FormFieldLabel>{t('automations.description')}</FormFieldLabel>
            <input
              className={fieldClass}
              maxLength={2000}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
              value={draft.description}
            />
          </label>
          {draft.triggerType === 'task.status_changed' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <RuleSelect
                label={t('automations.fromStatus')}
                value={draft.fromStatus}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, fromStatus: value as Draft['fromStatus'] }))
                }
                options={[
                  ['any', t('automations.any')],
                  ...statuses.map(
                    (value) => [value.key, statusLabel(value.key)] as [string, string],
                  ),
                ]}
              />
              <RuleSelect
                label={t('automations.toStatus')}
                value={draft.toStatus}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, toStatus: value as Draft['toStatus'] }))
                }
                options={[
                  ['any', t('automations.any')],
                  ...statuses.map(
                    (value) => [value.key, statusLabel(value.key)] as [string, string],
                  ),
                ]}
              />
            </div>
          )}
          {draft.triggerType === 'task.priority_changed' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <RuleSelect
                label={t('automations.fromPriority')}
                value={draft.fromPriority}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    fromPriority: value as Draft['fromPriority'],
                  }))
                }
                options={[
                  ['any', t('automations.any')],
                  ...priorities.map((value) => [value, priorityLabel(value)] as [string, string]),
                ]}
              />
              <RuleSelect
                label={t('automations.toPriority')}
                value={draft.toPriority}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, toPriority: value as Draft['toPriority'] }))
                }
                options={[
                  ['any', t('automations.any')],
                  ...priorities.map((value) => [value, priorityLabel(value)] as [string, string]),
                ]}
              />
            </div>
          )}
          {draft.triggerType === 'task.assignee_changed' && (
            <RuleSelect
              label={t('automations.assignment')}
              value={draft.assignment}
              onChange={(value) =>
                setDraft((current) => ({ ...current, assignment: value as Draft['assignment'] }))
              }
              options={[
                ['any', t('automations.assignment.any')],
                ['assigned', t('automations.assignment.assigned')],
                ['unassigned', t('automations.assignment.unassigned')],
                ['changed', t('automations.assignment.changed')],
              ]}
            />
          )}
          <fieldset className="grid gap-2 rounded-lg border border-slate-800/80 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-300">
              {t('automations.conditions')}
            </legend>
            <div className="grid gap-2 sm:grid-cols-3">
              <RuleSelect
                label={t('automations.conditionStatus')}
                optional
                value={draft.conditionStatus}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    conditionStatus: value as Draft['conditionStatus'],
                  }))
                }
                options={[
                  ['', t('automations.any')],
                  ...statuses.map(
                    (value) => [value.key, statusLabel(value.key)] as [string, string],
                  ),
                ]}
              />
              <RuleSelect
                label={t('automations.conditionPriority')}
                optional
                value={draft.conditionPriority}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    conditionPriority: value as Draft['conditionPriority'],
                  }))
                }
                options={[
                  ['', t('automations.any')],
                  ...priorities.map((value) => [value, priorityLabel(value)] as [string, string]),
                ]}
              />
              <RuleSelect
                label={t('automations.conditionAssignee')}
                optional
                value={draft.conditionAssignee}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    conditionAssignee: value as Draft['conditionAssignee'],
                  }))
                }
                options={[
                  ['', t('automations.any')],
                  ['assigned', t('automations.assignment.assigned')],
                  ['unassigned', t('automations.assignment.unassigned')],
                ]}
              />
            </div>
          </fieldset>
          <fieldset className="grid gap-2 rounded-lg border border-sky-400/20 p-3">
            <legend className="px-1 text-xs font-semibold text-sky-300">
              {t('automations.actions')}
            </legend>
            <div className="grid gap-2 sm:grid-cols-3">
              <RuleSelect
                label={t('automations.setStatus')}
                optional
                value={draft.actionStatus}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    actionStatus: value as Draft['actionStatus'],
                  }))
                }
                options={[
                  ['', t('automations.unchanged')],
                  ...statuses.map(
                    (value) => [value.key, statusLabel(value.key)] as [string, string],
                  ),
                ]}
              />
              <RuleSelect
                label={t('automations.setPriority')}
                optional
                value={draft.actionPriority}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    actionPriority: value as Draft['actionPriority'],
                  }))
                }
                options={[
                  ['', t('automations.unchanged')],
                  ...priorities.map((value) => [value, priorityLabel(value)] as [string, string]),
                ]}
              />
              <RuleSelect
                label={t('automations.setAssignee')}
                optional
                value={draft.actionAssignee}
                onChange={(value) => setDraft((current) => ({ ...current, actionAssignee: value }))}
                options={[
                  ['unchanged', t('automations.unchanged')],
                  ['unassigned', t('tasks.unassigned')],
                  ...assignees.map(
                    (assignee) => [assignee.id, assignee.displayName] as [string, string],
                  ),
                ]}
              />
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                checked={draft.active}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, active: event.target.checked }))
                }
                type="checkbox"
              />
              {t('automations.active')}
            </label>
            <button
              className="ml-auto min-h-9 rounded-lg bg-sky-400 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50"
              disabled={busy === 'save'}
              type="submit"
            >
              {busy === 'save'
                ? t('common.working')
                : t(editingId ? 'automations.save' : 'automations.create')}
            </button>
            {editingId && (
              <button
                className="min-h-9 rounded-lg px-3 text-xs text-slate-400 hover:bg-slate-800"
                onClick={() => {
                  setEditingId('');
                  setDraft(blankDraft);
                  setEditorOpen(false);
                }}
                type="button"
              >
                {t('common.cancel')}
              </button>
            )}
          </div>
        </form>
      )}
      {message && <p className="mt-3 text-xs text-slate-400">{message}</p>}
      {loading && <p className="mt-3 text-xs text-slate-500">{t('common.loading')}</p>}
      {!loading && !rules.length && (
        <p className="mt-3 text-xs text-slate-500">{t('automations.empty')}</p>
      )}
      <div className="mt-3 grid gap-2">
        {rules.map((rule) => (
          <article
            className={`rounded-xl border p-3 ${rule.active ? 'border-slate-800' : 'border-slate-800 opacity-60'}`}
            key={rule.id}
          >
            <div className="flex items-start gap-3">
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm text-slate-200">{rule.name}</strong>
                <span
                  className="mt-0.5 block text-[10px] text-slate-500"
                  title={rule.lastErrorCode ?? undefined}
                >
                  {triggerLabel(rule.triggerType)} ·{' '}
                  {t('automations.runCount', { count: rule.executionCount })}
                  {rule.lastExecutedAt
                    ? ` · ${formatDate(rule.lastExecutedAt, { dateStyle: 'short', timeStyle: 'short' })}`
                    : ''}
                  {rule.lastOutcome
                    ? ` · ${t(`automations.outcome.${rule.lastOutcome}`)}${rule.failedCount ? ` · ⚠ ${rule.failedCount}` : ''}`
                    : ''}
                </span>
              </span>
              <span className="flex gap-1">
                <IconButton
                  icon="⌁"
                  label={`${t('automations.executionHistory')}: ${rule.name}`}
                  onClick={() => viewRuleHistory(rule.id)}
                />
                <IconButton
                  icon="✎"
                  label={t('automations.edit', { name: rule.name })}
                  onClick={() => edit(rule)}
                />
                <IconButton
                  disabled={busy === rule.id}
                  icon={rule.active ? 'Ⅱ' : '▶'}
                  label={t(rule.active ? 'automations.pause' : 'automations.resume', {
                    name: rule.name,
                  })}
                  onClick={() => void toggle(rule)}
                />
                <IconButton
                  disabled={busy === rule.id}
                  icon="⌫"
                  label={t('automations.archive', { name: rule.name })}
                  onClick={() => void archive(rule)}
                />
              </span>
            </div>
          </article>
        ))}
      </div>
      {rulePage?.pageInfo.hasNext && (
        <button
          className="mt-3 min-h-9 w-full rounded-lg text-xs text-slate-400 hover:bg-slate-800 disabled:opacity-50"
          disabled={rulesLoadingMore}
          onClick={() => void loadMoreRules()}
          type="button"
        >
          {rulesLoadingMore
            ? t('common.loading')
            : t('automations.loadMoreRules', {
                shown: rules.length,
                total: rulePage.pageInfo.total,
              })}
        </button>
      )}
      {historyOpen && (
        <section
          className="mt-4 rounded-xl border border-slate-800 p-3"
          aria-label={t('automations.executionHistory')}
        >
          <h3 className="text-xs font-semibold text-slate-300">
            {t('automations.executionHistory')}
          </h3>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap gap-2">
              <select
                aria-label={t('automations.ruleFilter')}
                className={fieldClass}
                disabled={Boolean(executionLoading)}
                onChange={(event) => filterExecutionRule(event.target.value)}
                value={executionRuleId}
              >
                <option value="all">{t('automations.any')}</option>
                {rules.map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    {rule.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('automations.executionFilter')}
                className={fieldClass}
                disabled={Boolean(executionLoading)}
                onChange={(event) => filterExecutions(event.target.value as ExecutionFilter)}
                value={executionFilter}
              >
                <option value="all">{t('automations.outcome.all')}</option>
                {outcomes.map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {t(`automations.outcome.${outcome}`)}
                  </option>
                ))}
              </select>
            </span>
            {executionPage && (
              <dl aria-label={t('automations.executionSummary')} className="flex gap-1">
                {outcomes.map((outcome) => (
                  <div className="rounded-md bg-slate-900 px-1.5 py-1 text-[10px]" key={outcome}>
                    <dt className="inline text-slate-500">
                      {t(`automations.outcome.${outcome}`)}{' '}
                    </dt>
                    <dd className="inline font-mono text-slate-300">
                      {executionPage.summary[outcome]}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          {executionLoading === 'page' && !executions.length ? (
            <p className="mt-2 text-xs text-slate-500">{t('common.loading')}</p>
          ) : !executions.length ? (
            <p className="mt-2 text-xs text-slate-500">
              {executionFilter === 'all'
                ? t('automations.noExecutions')
                : t('automations.noMatchingExecutions')}
            </p>
          ) : (
            <div className="mt-2 divide-y divide-slate-800">
              {executions.map((execution) => (
                <details className="group py-2 text-[10px] text-slate-500" key={execution.id}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                    <span className="min-w-0 truncate">
                      <strong className="text-slate-300">{execution.ruleName}</strong> ·{' '}
                      {execution.taskKey} · {execution.taskTitle}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={execution.outcome === 'failed' ? 'text-rose-300' : ''}>
                        {t(`automations.outcome.${execution.outcome}`)}
                        {execution.errorCode ? ` · ${execution.errorCode}` : ''}
                      </span>{' '}
                      · {formatDuration(execution.durationMs)} ·{' '}
                      {formatDate(execution.createdAt, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                      <span aria-hidden="true" className="ml-1 inline-block group-open:rotate-180">
                        ⌄
                      </span>
                    </span>
                  </summary>
                  <div className="mt-2 grid gap-2 rounded-lg bg-slate-900/60 p-2 sm:grid-cols-2">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                      <dt>{t('automations.trigger')}</dt>
                      <dd className="break-all text-slate-300">
                        {triggerLabel(execution.triggerType)} ·{' '}
                        {JSON.stringify(execution.triggerEvent)}
                      </dd>
                      <dt>{t('automations.trace')}</dt>
                      <dd className="break-all font-mono text-slate-400">
                        {execution.traceId} · #{execution.depth}
                      </dd>
                    </dl>
                    <div>
                      <strong className="font-medium text-slate-400">
                        {t('automations.changes')}
                      </strong>
                      {Object.keys(execution.changes).length ? (
                        <ul className="mt-1 grid gap-1">
                          {Object.entries(execution.changes).map(([field, change]) => (
                            <li className="text-slate-300" key={field}>
                              {field}: {changeSummary(change)}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-slate-500">—</p>
                      )}
                    </div>
                    <a
                      className="text-sky-300 hover:text-sky-200 sm:col-span-2"
                      href={`${base}/tasks?task=${execution.taskKey}`}
                    >
                      {execution.taskKey} →
                    </a>
                  </div>
                </details>
              ))}
            </div>
          )}
          {executionPage?.pageInfo.hasNext && (
            <button
              className="mt-2 min-h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-45"
              disabled={executionLoading === 'more'}
              onClick={loadMoreExecutions}
              type="button"
            >
              {executionLoading === 'more'
                ? t('common.loading')
                : t('automations.loadMoreExecutions', {
                    shown: executions.length,
                    total: executionPage.pageInfo.total,
                  })}
            </button>
          )}
        </section>
      )}
    </details>
  );
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${durationMs} ms` : `${(durationMs / 1_000).toFixed(1)} s`;
}

function changeSummary(change: unknown): string {
  if (!change || typeof change !== 'object') return String(change ?? '—');
  const value = change as { from?: unknown; to?: unknown };
  return `${String(value.from ?? '—')} → ${String(value.to ?? '—')}`;
}

function RuleSelect({
  label,
  optional = false,
  value,
  onChange,
  options,
}: {
  label: string;
  optional?: boolean;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="grid gap-1 text-xs text-slate-400">
      <FormFieldLabel required={!optional}>{label}</FormFieldLabel>
      <select
        aria-label={label}
        className={fieldClass}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue || 'empty'} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function IconButton({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      aria-label={label}
      className="grid size-8 place-items-center rounded-lg text-xs text-slate-500 hover:bg-slate-800 hover:text-sky-300 disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {icon}
    </button>
  );
}
