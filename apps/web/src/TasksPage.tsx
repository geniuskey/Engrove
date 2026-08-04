import { Button } from '@engrove/ui';
import {
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
  const { formatDate, t } = useI18n();
  const { workspaceId, projectId } = useParams();
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<'board' | 'calendar'>('board');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuModel>();
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
    if (created) form.reset();
  }

  async function changeStatus(task: Task, status: Status) {
    await mutate(() =>
      api(`${base}/tasks/${task.id}`, {
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
      }),
    );
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
        </div>
        <div className="flex gap-2" role="group" aria-label={t('tasks.view')}>
          <Button variant={view === 'board' ? 'primary' : 'quiet'} onClick={() => setView('board')}>
            {t('tasks.kanban')}
          </Button>
          <Button
            variant={view === 'calendar' ? 'primary' : 'quiet'}
            onClick={() => setView('calendar')}
          >
            {t('tasks.calendar')}
          </Button>
        </div>
      </div>
      <NoticeText tone={messageTone}>{message}</NoticeText>
      {loading && (
        <p aria-live="polite" className="mt-4 text-sm text-slate-400" role="status">
          {t('common.loading')}
        </p>
      )}
      {allowed(user, 'task.create') && (
        <form
          className="mt-8 grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/45 p-5 shadow-xl shadow-slate-950/10 lg:grid-cols-4"
          onSubmit={(event) => void create(event)}
        >
          <label className={taskFormLabelClass}>
            {t('tasks.title')}
            <input className={inputClass} name="title" required />
          </label>
          <label className={taskFormLabelClass}>
            {t('tasks.descriptionLabel')}
            <input className={inputClass} name="description" />
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
          <Button disabled={busy} type="submit">
            {busy ? t('tasks.creating') : t('tasks.create')}
          </Button>
        </form>
      )}
      {view === 'board' ? (
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {columns.map((column) => (
            <section
              className={`rounded-2xl border border-slate-800 border-t-2 bg-slate-900/55 p-4 shadow-lg shadow-slate-950/10 ${columnAccent[column.status]}`}
              key={column.status}
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">{column.label}</h2>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                  {
                    tasks.filter((task) => !task.archived_at && task.status === column.status)
                      .length
                  }
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {tasks
                  .filter((task) => !task.archived_at && task.status === column.status)
                  .map((task) => (
                    <article
                      className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 shadow-md shadow-slate-950/20 transition hover:border-slate-700"
                      key={task.id}
                      onContextMenu={(event) => openTaskMenu(event, task)}
                      onKeyDown={(event) => openTaskMenuFromKeyboard(event, task)}
                      tabIndex={0}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-medium">{task.title}</h3>
                        <span
                          className={`rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-wide ${priorityStyle[task.priority]}`}
                        >
                          {priorityLabel(task.priority)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {task.due_date
                          ? t('tasks.due', {
                              date: formatDate(`${task.due_date}T00:00:00`),
                            })
                          : t('tasks.noDueDate')}{' '}
                        · {t('tasks.linkCount', { count: task.links.length })}
                      </p>
                      {allowed(user, 'task.update') && (
                        <select
                          aria-label={t('tasks.statusFor', { title: task.title })}
                          className={`${inputClass} mt-3`}
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
                      {allowed(user, 'task.archive') && (
                        <button
                          className="mt-3 text-xs text-slate-500 hover:text-sky-300"
                          onClick={() =>
                            void mutate(() =>
                              api(`${base}/tasks/${task.id}/archive`, {
                                method: 'PATCH',
                                body: JSON.stringify({ reason: 'Archived from task board' }),
                              }),
                            )
                          }
                        >
                          {t('common.archive')}
                        </button>
                      )}
                    </article>
                  ))}
                {!tasks.some((task) => !task.archived_at && task.status === column.status) && (
                  <p className="rounded-xl border border-dashed border-slate-800 px-3 py-6 text-center text-sm text-slate-600">
                    {t('tasks.noTasks')}
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="mt-8 rounded-2xl border border-slate-800 p-5">
          <h2 className="text-xl font-semibold">{t('tasks.calendarHeading')}</h2>
          <div className="mt-4 divide-y divide-slate-800">
            {calendar.map((task) => (
              <article
                className="grid gap-2 py-4 md:grid-cols-[10rem_1fr_auto]"
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
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(undefined)} />
    </>
  );
}
