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
import { allowed, api, ErrorText, inputClass, type User } from './App.js';
import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuModel,
  menuFromKeyboard,
  menuFromPointer,
} from './ContextMenu.js';

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

const columns: Array<{ status: Status; label: string }> = [
  { status: 'todo', label: 'To do' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'blocked', label: 'Blocked' },
  { status: 'done', label: 'Done' },
];

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

export function TasksPage({ user }: { user: User }) {
  const { workspaceId, projectId } = useParams();
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<'board' | 'calendar'>('board');
  const [message, setMessage] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuModel>();
  const refresh = useCallback(async () => {
    try {
      const result = await api<{ items: Task[] }>(`${base}/tasks?includeArchived=true`);
      setTasks(result.items);
      setMessage('');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Tasks could not be loaded.');
    }
  }, [base]);
  useEffect(() => void refresh(), [refresh]);

  async function mutate(operation: () => Promise<unknown>) {
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Task operation failed.');
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const entityId = String(data.get('entityId') ?? '').trim();
    await mutate(() =>
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
    form.reset();
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
      setMessage(`${label} copied.`);
    } catch {
      setMessage('Clipboard access was denied by the browser.');
    }
  }

  function taskContextItems(task: Task): ContextMenuItem[] {
    return [
      ...(!task.archived_at && allowed(user, 'task.update')
        ? columns.map((column, index) => ({
            label: `Move to ${column.label}`,
            icon: task.status === column.status ? '✓' : '→',
            disabled: task.status === column.status,
            separatorBefore: index === 0,
            onSelect: () => void changeStatus(task, column.status),
          }))
        : []),
      {
        label: 'Copy task title',
        icon: '⧉',
        separatorBefore: true,
        onSelect: () => void copyTaskValue('Task title', task.title),
      },
      {
        label: 'Copy task ID',
        icon: '#',
        onSelect: () => void copyTaskValue('Task ID', task.id),
      },
      ...(allowed(user, task.archived_at ? 'task.restore' : 'task.archive')
        ? [
            {
              label: task.archived_at ? 'Restore task' : 'Archive task',
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
        ← Project
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Engineering tasks</h1>
          <p className="mt-3 text-slate-400">
            Follow-up work stays linked to the exact engineering evidence that created it.
            Right-click any task to move, copy, or archive it.
          </p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Task view">
          <Button variant={view === 'board' ? 'primary' : 'quiet'} onClick={() => setView('board')}>
            Kanban
          </Button>
          <Button
            variant={view === 'calendar' ? 'primary' : 'quiet'}
            onClick={() => setView('calendar')}
          >
            Calendar
          </Button>
        </div>
      </div>
      <ErrorText>{message}</ErrorText>
      {allowed(user, 'task.create') && (
        <form
          className="mt-8 grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/45 p-5 shadow-xl shadow-slate-950/10 lg:grid-cols-4"
          onSubmit={(event) => void create(event)}
        >
          <input className={inputClass} name="title" placeholder="Task title" required />
          <input className={inputClass} name="description" placeholder="Description" />
          <select className={inputClass} name="priority" defaultValue="medium">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <input className={inputClass} name="dueDate" type="date" />
          <select className={inputClass} name="entityType" defaultValue="record">
            <option value="record">Record</option>
            <option value="sample">Sample</option>
            <option value="issue">Issue</option>
            <option value="test_run">Test run</option>
            <option value="measurement_result">Measurement result</option>
            <option value="specification_evaluation">Specification evaluation</option>
            <option value="dataset">Dataset</option>
          </select>
          <input className={inputClass} name="entityId" placeholder="Optional linked entity UUID" />
          <Button type="submit">Create task</Button>
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
                          {task.priority}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {task.due_date ? `Due ${task.due_date}` : 'No due date'} ·{' '}
                        {task.links.length} link(s)
                      </p>
                      {allowed(user, 'task.update') && (
                        <select
                          aria-label={`Status for ${task.title}`}
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
                          Archive
                        </button>
                      )}
                    </article>
                  ))}
                {!tasks.some((task) => !task.archived_at && task.status === column.status) && (
                  <p className="rounded-xl border border-dashed border-slate-800 px-3 py-6 text-center text-sm text-slate-600">
                    No tasks
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="mt-8 rounded-2xl border border-slate-800 p-5">
          <h2 className="text-xl font-semibold">Due-date calendar</h2>
          <div className="mt-4 divide-y divide-slate-800">
            {calendar.map((task) => (
              <article
                className="grid gap-2 py-4 md:grid-cols-[10rem_1fr_auto]"
                key={task.id}
                onContextMenu={(event) => openTaskMenu(event, task)}
                onKeyDown={(event) => openTaskMenuFromKeyboard(event, task)}
                tabIndex={0}
              >
                <time className="font-mono text-sky-300">{task.due_date}</time>
                <span>{task.title}</span>
                <span className="text-xs uppercase text-slate-400">{task.status}</span>
              </article>
            ))}
            {!calendar.length && <p className="py-6 text-slate-500">No tasks have due dates.</p>}
          </div>
        </section>
      )}
      {tasks.some((task) => task.archived_at) && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Archived tasks</h2>
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
                <span>{task.title} · links and status history preserved</span>
                {allowed(user, 'task.restore') && (
                  <button
                    className="text-sky-400"
                    onClick={() =>
                      void mutate(() => api(`${base}/tasks/${task.id}/restore`, { method: 'POST' }))
                    }
                  >
                    Restore
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
