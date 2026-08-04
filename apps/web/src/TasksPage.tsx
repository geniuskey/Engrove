import { Button } from '@engrove/ui';
import {
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Link, useParams } from 'react-router';
import { allowed, api, inputClass, NoticeText, type User } from './App.js';
import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuModel,
  menuFromKeyboard,
  menuFromPointer,
} from './ContextMenu.js';
import { useI18n } from './i18n.js';
import { useModalDialog } from './useModalDialog.js';

type Status = 'todo' | 'in_progress' | 'blocked' | 'done';
interface TaskLink {
  id: string;
  entity_type: string;
  entity_id: string;
}
interface Task {
  id: string;
  title: string;
  description: string;
  status: Status;
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee_id: string | null;
  assignee_name: string | null;
  due_date: string | null;
  row_version: number;
  archived_at: string | null;
  links: TaskLink[];
}

const columnAccent: Record<Status, string> = {
  todo: 'border-t-slate-500',
  in_progress: 'border-t-sky-400',
  blocked: 'border-t-rose-400',
  done: 'border-t-emerald-400',
};

const priorityStyle: Record<Task['priority'], string> = {
  low: 'bg-slate-500/10 text-slate-300',
  medium: 'bg-sky-500/10 text-sky-300',
  high: 'bg-amber-500/10 text-amber-300',
  critical: 'bg-rose-500/10 text-rose-300',
};
const taskFormLabelClass = 'grid gap-1 text-xs text-slate-400';

export function TasksPage({ user }: { user: User }) {
  const { formatDate, locale, t } = useI18n();
  const { workspaceId, projectId } = useParams();
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<'board' | 'calendar'>('board');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuModel>();
  const [draggingTaskId, setDraggingTaskId] = useState('');
  const [dragOverStatus, setDragOverStatus] = useState<Status>();
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(() => new Set());
  const [boardAnnouncement, setBoardAnnouncement] = useState('');
  const creatorDialogRef = useModalDialog<HTMLDivElement>(creatorOpen, () => setCreatorOpen(false));
  const columns: Array<{ status: Status; label: string }> = [
    { status: 'todo', label: t('tasks.todo') },
    { status: 'in_progress', label: t('tasks.inProgress') },
    { status: 'blocked', label: t('tasks.blocked') },
    { status: 'done', label: t('tasks.done') },
  ];
  const priorityLabel = (priority: Task['priority']) =>
    t(
      priority === 'low'
        ? 'tasks.low'
        : priority === 'medium'
          ? 'tasks.medium'
          : priority === 'high'
            ? 'tasks.high'
            : 'tasks.critical',
    );
  const refresh = useCallback(async () => {
    try {
      const result = await api<{ items: Task[] }>(`${base}/tasks?includeArchived=true`);
      setTasks(result.items);
      setMessage('');
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.loadError'));
    } finally {
      setLoading(false);
    }
  }, [base, t]);
  useEffect(() => void refresh(), [refresh]);

  async function mutate(operation: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await operation();
      await refresh();
      setMessageTone('success');
      setMessage(t('common.changesSaved'));
      return true;
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('tasks.operationError'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const entityId = String(data.get('entityId') ?? '').trim();
    const created = await mutate(() =>
      api(`${base}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: data.get('title'),
          description: data.get('description'),
          status: 'todo',
          priority: data.get('priority'),
          dueDate: String(data.get('dueDate') ?? '') || undefined,
          links: entityId ? [{ entityType: data.get('entityType'), entityId }] : [],
        }),
      }),
    );
    if (created) {
      form.reset();
      setCreatorOpen(false);
    }
  }

  async function changeStatus(task: Task, status: Status) {
    if (task.status === status || pendingTaskIds.has(task.id)) return;
    const previousStatus = task.status;
    const destination = columns.find((column) => column.status === status)?.label ?? status;
    setPendingTaskIds((current) => new Set(current).add(task.id));
    setTasks((current) =>
      current.map((candidate) => (candidate.id === task.id ? { ...candidate, status } : candidate)),
    );
    setMessage('');
    setBoardAnnouncement(t('tasks.movingTo', { title: task.title, status: destination }));
    try {
      const updated = await api<Task>(`${base}/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: task.title,
          description: task.description,
          status,
          priority: task.priority,
          assigneeId: task.assignee_id ?? undefined,
          dueDate: task.due_date ?? undefined,
          rowVersion: task.row_version,
        }),
      });
      setTasks((current) =>
        current.map((candidate) => (candidate.id === task.id ? updated : candidate)),
      );
      setMessageTone('success');
      setMessage(t('tasks.movedTo', { title: task.title, status: destination }));
      setBoardAnnouncement(t('tasks.movedTo', { title: task.title, status: destination }));
    } catch (cause) {
      setTasks((current) =>
        current.map((candidate) =>
          candidate.id === task.id ? { ...candidate, status: previousStatus } : candidate,
        ),
      );
      await refresh();
      setMessageTone('error');
      const error = cause instanceof Error ? cause.message : t('tasks.operationError');
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

  function clearDragState() {
    setDraggingTaskId('');
    setDragOverStatus(undefined);
  }

  function startTaskDrag(event: ReactDragEvent<HTMLElement>, task: Task) {
    const target = event.target;
    if (
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
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dragOverStatus !== status) setDragOverStatus(status);
  }

  function dropTask(event: ReactDragEvent<HTMLElement>, status: Status) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain') || draggingTaskId;
    const task = tasks.find((candidate) => candidate.id === taskId);
    clearDragState();
    if (task) void changeStatus(task, status);
  }

  function handleTaskKeyDown(event: ReactKeyboardEvent<HTMLElement>, task: Task) {
    if (
      event.altKey &&
      allowed(user, 'task.update') &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      const currentIndex = columns.findIndex((column) => column.status === task.status);
      const nextIndex = currentIndex + (event.key === 'ArrowRight' ? 1 : -1);
      const next = columns[nextIndex];
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

  function taskContextItems(task: Task): ContextMenuItem[] {
    return [
      ...(!task.archived_at && allowed(user, 'task.update')
        ? columns.map((column, index) => ({
            label: t('tasks.moveTo', { status: column.label }),
            icon: task.status === column.status ? '✓' : '→',
            disabled: task.status === column.status,
            separatorBefore: index === 0,
            onSelect: () => void changeStatus(task, column.status),
          }))
        : []),
      {
        label: t('tasks.copyTitle'),
        icon: '⧉',
        separatorBefore: true,
        onSelect: () => void copyTaskValue(t('tasks.title'), task.title),
      },
      {
        label: t('tasks.copyId'),
        icon: '#',
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
                    ...(task.archived_at
                      ? {}
                      : { body: JSON.stringify({ reason: 'Archived from task context menu' }) }),
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

  function openTaskMenuFromButton(event: ReactMouseEvent<HTMLButtonElement>, task: Task) {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    setContextMenu({
      label: task.title,
      x: bounds.right,
      y: bounds.bottom,
      items: taskContextItems(task),
      returnFocus: event.currentTarget,
    });
  }

  function openTaskMenuFromKeyboard(event: ReactKeyboardEvent<HTMLElement>, task: Task) {
    const menu = menuFromKeyboard(event, task.title, taskContextItems(task));
    if (menu) setContextMenu(menu);
  }

  const calendar = useMemo(
    () =>
      tasks
        .filter((task) => !task.archived_at && task.due_date)
        .sort((left, right) => left.due_date!.localeCompare(right.due_date!)),
    [tasks],
  );

  return (
    <>
      <Link className="text-sm text-slate-400 hover:text-sky-300" to={base}>
        ← {t('common.projectBack')}
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            {t('tasks.heading')}
          </h1>
          <p className="mt-3 text-slate-400">{t('tasks.description')}</p>
          {allowed(user, 'task.update') && (
            <p className="mt-2 text-xs text-slate-500">{t('tasks.dragHint')}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {allowed(user, 'task.create') && (
            <Button
              aria-label={t('tasks.create')}
              onClick={() => setCreatorOpen(true)}
              type="button"
            >
              + {t('tasks.create')}
            </Button>
          )}
          <div
            className="flex gap-1 rounded-xl border border-slate-800 bg-slate-900/55 p-1"
            role="group"
            aria-label={t('tasks.view')}
          >
            <Button
              className="min-h-8 px-3 py-1.5"
              variant={view === 'board' ? 'primary' : 'quiet'}
              onClick={() => setView('board')}
            >
              {t('tasks.kanban')}
            </Button>
            <Button
              className="min-h-8 px-3 py-1.5"
              variant={view === 'calendar' ? 'primary' : 'quiet'}
              onClick={() => setView('calendar')}
            >
              {t('tasks.calendar')}
            </Button>
          </div>
        </div>
      </div>
      <NoticeText tone={messageTone}>{message}</NoticeText>
      <p aria-live="polite" className="sr-only">
        {boardAnnouncement}
      </p>
      {loading && (
        <p aria-live="polite" className="mt-4 text-sm text-slate-400" role="status">
          {t('common.loading')}
        </p>
      )}
      {view === 'board' ? (
        <div className="-mx-3 mt-6 overflow-x-auto px-3 pb-3" data-task-board>
          <div className="grid min-w-[68rem] grid-cols-4 items-start gap-3">
            {columns.map((column) => {
              const columnTasks = tasks.filter(
                (task) => !task.archived_at && task.status === column.status,
              );
              const activeDropTarget = Boolean(draggingTaskId && dragOverStatus === column.status);
              return (
                <section
                  aria-label={t('tasks.columnLabel', {
                    status: column.label,
                    count: columnTasks.length,
                  })}
                  className={`min-h-[30rem] rounded-xl border border-t-2 p-3 shadow-lg shadow-slate-950/10 transition-colors ${columnAccent[column.status]} ${activeDropTarget ? 'border-sky-400 bg-sky-400/10 ring-2 ring-sky-400/25' : 'border-slate-800 bg-slate-900/55'}`}
                  data-drop-active={activeDropTarget ? 'true' : undefined}
                  data-task-status={column.status}
                  key={column.status}
                  onDragEnter={(event) => dragOverColumn(event, column.status)}
                  onDragOver={(event) => dragOverColumn(event, column.status)}
                  onDrop={(event) => dropTask(event, column.status)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-semibold">{column.label}</h2>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                      {columnTasks.length}
                    </span>
                  </div>
                  <div className="mt-3 min-h-40 space-y-2">
                    {activeDropTarget && (
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
                          aria-label={t('tasks.cardLabel', {
                            title: task.title,
                            status: column.label,
                          })}
                          className={`group rounded-lg border bg-slate-950/80 p-3 shadow-sm shadow-slate-950/20 transition ${taskDragging ? 'scale-[0.98] border-sky-400/60 opacity-45' : 'border-slate-800 hover:border-slate-600 hover:shadow-md'} ${allowed(user, 'task.update') && !taskPending ? 'cursor-grab active:cursor-grabbing' : ''}`}
                          draggable={allowed(user, 'task.update') && !taskPending}
                          key={task.id}
                          onContextMenu={(event) => openTaskMenu(event, task)}
                          onDragEnd={clearDragState}
                          onDragStart={(event) => startTaskDrag(event, task)}
                          onKeyDown={(event) => handleTaskKeyDown(event, task)}
                          tabIndex={0}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-start gap-1.5">
                              {allowed(user, 'task.update') && (
                                <span
                                  aria-hidden="true"
                                  className="mt-0.5 shrink-0 text-xs text-slate-600 group-hover:text-slate-400"
                                >
                                  ⠿
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
                          {(task.due_date || task.links.length > 0) && (
                            <p className="mt-1.5 truncate text-[11px] text-slate-500">
                              {task.due_date &&
                                t('tasks.due', {
                                  date: formatDate(`${task.due_date}T00:00:00`),
                                })}
                              {task.due_date && task.links.length > 0 && ' · '}
                              {task.links.length > 0 &&
                                t('tasks.linkCount', { count: task.links.length })}
                            </p>
                          )}
                          <div className="mt-2 flex items-center gap-1.5">
                            {allowed(user, 'task.update') && (
                              <select
                                aria-label={t('tasks.statusFor', { title: task.title })}
                                className="h-8 min-w-0 flex-1 rounded-md border border-slate-800 bg-slate-900 px-2 text-xs text-slate-300 outline-none hover:border-slate-700 focus:border-sky-400"
                                disabled={taskPending}
                                value={task.status}
                                onChange={(event) =>
                                  void changeStatus(task, event.target.value as Status)
                                }
                              >
                                {columns.map((candidate) => (
                                  <option key={candidate.status} value={candidate.status}>
                                    {candidate.label}
                                  </option>
                                ))}
                              </select>
                            )}
                            <button
                              aria-label={`${locale === 'ko' ? '작업 메뉴' : 'Task actions'}: ${task.title}`}
                              className="grid size-8 shrink-0 place-items-center rounded-md border border-slate-800 text-sm text-slate-500 hover:border-slate-700 hover:bg-slate-900 hover:text-sky-300 disabled:opacity-50"
                              disabled={taskPending}
                              onClick={(event) => openTaskMenuFromButton(event, task)}
                              type="button"
                            >
                              •••
                            </button>
                          </div>
                        </article>
                      );
                    })}
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
      ) : (
        <section className="mt-6 rounded-xl border border-slate-800 p-4">
          <h2 className="text-xl font-semibold">{t('tasks.calendarHeading')}</h2>
          <div className="mt-4 divide-y divide-slate-800">
            {calendar.map((task) => (
              <article
                className="grid gap-2 py-3 text-sm md:grid-cols-[9rem_1fr_auto]"
                key={task.id}
                onContextMenu={(event) => openTaskMenu(event, task)}
                onKeyDown={(event) => openTaskMenuFromKeyboard(event, task)}
                tabIndex={0}
              >
                <time className="font-mono text-sky-300" dateTime={task.due_date ?? undefined}>
                  {formatDate(`${task.due_date}T00:00:00`)}
                </time>
                <span>{task.title}</span>
                <span className="text-xs uppercase text-slate-400">
                  {columns.find((column) => column.status === task.status)?.label}
                </span>
              </article>
            ))}
            {!calendar.length && <p className="py-6 text-slate-500">{t('tasks.noCalendar')}</p>}
          </div>
        </section>
      )}
      {tasks.some((task) => task.archived_at) && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">{t('tasks.archivedHeading')}</h2>
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
                <span>{t('tasks.archivedNote', { title: task.title })}</span>
                {allowed(user, 'task.restore') && (
                  <button
                    className="text-sky-400"
                    onClick={() =>
                      void mutate(() => api(`${base}/tasks/${task.id}/restore`, { method: 'POST' }))
                    }
                  >
                    {t('common.restore')}
                  </button>
                )}
              </div>
            ))}
        </section>
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
            onClick={() => setCreatorOpen(false)}
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
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-400">
                  {t('common.project')}
                </p>
                <h2 className="mt-1 text-2xl font-semibold" id="task-creator-title">
                  {t('tasks.create')}
                </h2>
              </div>
              <button
                aria-label={locale === 'ko' ? '작업 만들기 닫기' : 'Close task creator'}
                className="grid size-9 place-items-center rounded-lg border border-slate-700 text-xl text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                disabled={busy}
                onClick={() => setCreatorOpen(false)}
                type="button"
              >
                ×
              </button>
            </header>
            <form
              className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6"
              onSubmit={(event) => void create(event)}
            >
              <label className={`${taskFormLabelClass} sm:col-span-2`}>
                {t('tasks.title')}
                <input className={inputClass} data-dialog-initial-focus name="title" required />
              </label>
              <label className={`${taskFormLabelClass} sm:col-span-2`}>
                {t('tasks.descriptionLabel')}
                <textarea className={`${inputClass} min-h-24 resize-y py-2`} name="description" />
              </label>
              <label className={taskFormLabelClass}>
                {t('tasks.priority')}
                <select className={inputClass} name="priority" defaultValue="medium">
                  <option value="low">{t('tasks.low')}</option>
                  <option value="medium">{t('tasks.medium')}</option>
                  <option value="high">{t('tasks.high')}</option>
                  <option value="critical">{t('tasks.critical')}</option>
                </select>
              </label>
              <label className={taskFormLabelClass}>
                {t('tasks.dueDate')}
                <input className={inputClass} name="dueDate" type="date" />
              </label>
              <label className={taskFormLabelClass}>
                {t('tasks.linkType')}
                <select className={inputClass} name="entityType" defaultValue="record">
                  <option value="record">{t('tasks.entity.record')}</option>
                  <option value="sample">{t('tasks.entity.sample')}</option>
                  <option value="issue">{t('tasks.entity.issue')}</option>
                  <option value="test_run">{t('tasks.entity.testRun')}</option>
                  <option value="measurement_result">{t('tasks.entity.measurement')}</option>
                  <option value="specification_evaluation">{t('tasks.entity.evaluation')}</option>
                  <option value="dataset">{t('tasks.entity.dataset')}</option>
                </select>
              </label>
              <label className={taskFormLabelClass}>
                {t('tasks.linkId')}
                <input className={inputClass} name="entityId" />
              </label>
              <div className="flex justify-end gap-2 border-t border-slate-800 pt-4 sm:col-span-2">
                <Button
                  disabled={busy}
                  onClick={() => setCreatorOpen(false)}
                  type="button"
                  variant="quiet"
                >
                  {locale === 'ko' ? '취소' : 'Cancel'}
                </Button>
                <Button disabled={busy} type="submit">
                  {busy ? t('tasks.creating') : t('tasks.create')}
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
