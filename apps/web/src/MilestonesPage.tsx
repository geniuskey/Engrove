import { Button } from '@engrove/ui';
import {
  type FormEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { allowed, api, inputClass, NoticeText, type User } from './App.js';
import { useActionDialog } from './ActionDialogProvider.js';
import { FormFieldLabel } from './FormFieldLabel.js';
import { IconAction } from './IconAction.js';
import { useI18n } from './i18n.js';
import { useModalDialog } from './useModalDialog.js';

type MilestoneStatus = 'planned' | 'active' | 'at_risk' | 'completed';

interface Milestone {
  id: string;
  title: string;
  description: string;
  status: MilestoneStatus;
  target_date: string;
  completed_at: string | null;
  row_version: number;
  archived_at: string | null;
  linked_tasks: LinkedTask[];
  task_count: number;
  completed_task_count: number;
}

interface LinkedTask {
  id: string;
  task_key: string;
  title: string;
  status: string;
  status_name: string;
  status_category: 'todo' | 'in_progress' | 'done';
  archived_at: string | null;
}

interface TaskCandidate {
  id: string;
  task_key: string;
  title: string;
}

interface MilestonePageInfo {
  limit: number;
  offset: number;
  total: number;
  hasNext: boolean;
}

interface MilestoneSummary {
  planned: number;
  active: number;
  atRisk: number;
  completed: number;
  archived: number;
}

interface MilestonePage {
  items: Milestone[];
  pageInfo: MilestonePageInfo;
  summary: MilestoneSummary;
  nextMilestoneId: string | null;
}

const emptyPageInfo: MilestonePageInfo = { limit: 50, offset: 0, total: 0, hasNext: false };
const emptySummary: MilestoneSummary = {
  planned: 0,
  active: 0,
  atRisk: 0,
  completed: 0,
  archived: 0,
};

function mergeMilestones(current: Milestone[], incoming: Milestone[]): Milestone[] {
  const merged = new Map(current.map((milestone) => [milestone.id, milestone]));
  incoming.forEach((milestone) => merged.set(milestone.id, milestone));
  return [...merged.values()];
}

const statusTone: Record<MilestoneStatus, string> = {
  planned: 'border-slate-700 bg-slate-800/70 text-slate-300',
  active: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  at_risk: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
};

export function MilestonesPage({ user }: { user: User }) {
  const { formatDate, t } = useI18n();
  const { confirmAction } = useActionDialog();
  const { workspaceId, projectId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [milestoneOptions, setMilestoneOptions] = useState<Milestone[]>([]);
  const [pageInfo, setPageInfo] = useState<MilestonePageInfo>(emptyPageInfo);
  const [summary, setSummary] = useState<MilestoneSummary>(emptySummary);
  const [nextMilestoneId, setNextMilestoneId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const [creatorOpen, setCreatorOpen] = useState(false);
  const createRequestRef = useRef<{ body: string; idempotencyKey: string } | undefined>(undefined);
  const selectedLookupRef = useRef('');
  const selectedId = searchParams.get('milestone') ?? '';
  const setSelectedId = useCallback(
    (milestoneId: string) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (milestoneId) next.set('milestone', milestoneId);
          else next.delete('milestone');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const selected = milestones.find((milestone) => milestone.id === selectedId);
  const creatorDialogRef = useModalDialog<HTMLElement>(creatorOpen, () => setCreatorOpen(false));
  const detailDialogRef = useModalDialog<HTMLElement>(Boolean(selected), () => setSelectedId(''));

  const statusLabel = (status: MilestoneStatus) => t(`milestones.status.${status}`);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const parameters = new URLSearchParams({ archiveState: 'all', limit: '50', offset: '0' });
      if (query) parameters.set('query', query);
      const result = await api<MilestonePage>(`${base}/milestones?${parameters.toString()}`);
      setMilestoneOptions(result.items);
      setMilestones((current) => mergeMilestones(current, result.items));
      setPageInfo(result.pageInfo);
      setSummary(result.summary);
      setNextMilestoneId(result.nextMilestoneId);
      setLoadError('');
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : t('milestones.loadError'));
    } finally {
      setLoading(false);
    }
  }, [base, query, t]);
  useEffect(() => void refresh(), [refresh]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    setMilestones([]);
    setMilestoneOptions([]);
    setPageInfo(emptyPageInfo);
    setSummary(emptySummary);
    setNextMilestoneId(null);
    setSearch('');
    setQuery('');
    selectedLookupRef.current = '';
  }, [base]);

  useEffect(() => {
    if (!selectedId) {
      selectedLookupRef.current = '';
      return;
    }
    if (
      milestones.some((milestone) => milestone.id === selectedId) ||
      selectedLookupRef.current === selectedId
    )
      return;
    selectedLookupRef.current = selectedId;
    void api<Milestone>(`${base}/milestones/${selectedId}`)
      .then((milestone) => setMilestones((current) => mergeMilestones(current, [milestone])))
      .catch((cause: unknown) => {
        setMessageTone('error');
        setMessage(cause instanceof Error ? cause.message : t('milestones.loadError'));
      });
  }, [base, milestones, selectedId, t]);

  async function loadMoreMilestones() {
    if (!pageInfo.hasNext || loadingMore) return;
    const parameters = new URLSearchParams({
      archiveState: 'all',
      limit: String(pageInfo.limit),
      offset: String(milestoneOptions.length),
    });
    if (query) parameters.set('query', query);
    setLoadingMore(true);
    try {
      const result = await api<MilestonePage>(`${base}/milestones?${parameters.toString()}`);
      setMilestoneOptions((current) => mergeMilestones(current, result.items));
      setMilestones((current) => mergeMilestones(current, result.items));
      setPageInfo(result.pageInfo);
      setSummary(result.summary);
      setNextMilestoneId(result.nextMilestoneId);
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('milestones.loadError'));
    } finally {
      setLoadingMore(false);
    }
  }

  const activeMilestones = useMemo(
    () =>
      milestoneOptions
        .filter((milestone) => !milestone.archived_at)
        .sort((left, right) => left.target_date.localeCompare(right.target_date)),
    [milestoneOptions],
  );
  const archivedMilestones = useMemo(
    () => milestoneOptions.filter((milestone) => milestone.archived_at),
    [milestoneOptions],
  );

  async function createMilestone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = JSON.stringify(milestonePayload(data));
    const request =
      createRequestRef.current?.body === body
        ? createRequestRef.current
        : { body, idempotencyKey: crypto.randomUUID() };
    createRequestRef.current = request;
    setBusy(true);
    try {
      await api(`${base}/milestones`, {
        method: 'POST',
        headers: { 'Idempotency-Key': request.idempotencyKey },
        body,
      });
      createRequestRef.current = undefined;
      form.reset();
      setCreatorOpen(false);
      await refresh();
      setMessageTone('success');
      setMessage(t('milestones.created'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('milestones.operationError'));
    } finally {
      setBusy(false);
    }
  }

  async function updateMilestone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const updated = await api<Milestone>(`${base}/milestones/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...milestonePayload(data), rowVersion: selected.row_version }),
      });
      setMilestones((current) =>
        current.map((milestone) => (milestone.id === updated.id ? updated : milestone)),
      );
      setMilestoneOptions((current) =>
        current.map((milestone) => (milestone.id === updated.id ? updated : milestone)),
      );
      await refresh();
      setMessageTone('success');
      setMessage(t('milestones.updated'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('milestones.operationError'));
    } finally {
      setBusy(false);
    }
  }

  async function archiveMilestone(milestone: Milestone) {
    if (!(await confirmAction(t('milestones.archiveConfirm'), { tone: 'danger' }))) return;
    setBusy(true);
    try {
      await api(`${base}/milestones/${milestone.id}/archive`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: 'Archived from milestone detail' }),
      });
      setSelectedId('');
      await refresh();
      setMessageTone('success');
      setMessage(t('milestones.archived'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('milestones.operationError'));
    } finally {
      setBusy(false);
    }
  }

  async function restoreMilestone(milestone: Milestone) {
    setBusy(true);
    try {
      await api(`${base}/milestones/${milestone.id}/restore`, { method: 'POST' });
      await refresh();
      setMessageTone('success');
      setMessage(t('milestones.restored'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('milestones.operationError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link className="text-sm text-slate-400 hover:text-sky-300" to={base}>
        ← {t('common.projectBack')}
      </Link>
      <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900/55 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-400">
              {t('milestones.eyebrow')}
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              {t('milestones.heading')}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">{t('milestones.description')}</p>
          </div>
          {allowed(user, 'project.update') && (
            <Button
              aria-label={t('milestones.create')}
              onClick={() => setCreatorOpen(true)}
              type="button"
            >
              + {t('milestones.create')}
            </Button>
          )}
        </div>
        <dl
          aria-label={t('milestones.summary')}
          className="mt-3 flex flex-wrap items-center gap-1.5"
        >
          {(['planned', 'active', 'at_risk', 'completed'] as const).map((status) => (
            <div
              className={`flex items-center gap-2 rounded-full border px-2.5 py-1 ${statusTone[status]}`}
              key={status}
            >
              <dt className="text-[10px] font-medium uppercase tracking-wider">
                {statusLabel(status)}
              </dt>
              <dd className="font-mono text-xs font-semibold">
                {status === 'at_risk' ? summary.atRisk : summary[status]}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <NoticeText tone={messageTone}>{message}</NoticeText>
      {loading ? (
        <div aria-label={t('common.loading')} className="mt-4 space-y-3">
          <div className="h-28 animate-pulse rounded-xl bg-slate-900/70" />
          <div className="h-28 animate-pulse rounded-xl bg-slate-900/55" />
        </div>
      ) : loadError ? (
        <section className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-5 text-center">
          <p aria-live="polite" className="text-sm text-rose-200">
            {loadError}
          </p>
          <Button className="mt-3" onClick={() => void refresh()} type="button" variant="quiet">
            {t('common.retry')}
          </Button>
        </section>
      ) : (
        <section
          aria-label={t('milestones.timeline')}
          className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/45 p-4 sm:p-5"
        >
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-slate-200">{t('milestones.timeline')}</h2>
            <div className="flex min-w-0 items-center gap-2">
              <label className="min-w-0">
                <span className="sr-only">{t('milestones.search')}</span>
                <input
                  aria-label={t('milestones.search')}
                  className={`${inputClass} h-8 w-48 py-1 text-xs`}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('milestones.searchPlaceholder')}
                  type="search"
                  value={search}
                />
              </label>
              <span className="hidden text-[10px] uppercase tracking-[0.16em] text-slate-500 sm:inline">
                {t('milestones.sequence')}
              </span>
            </div>
          </div>
          {activeMilestones.length > 0 ? (
            <div className="mt-4 snap-x snap-mandatory scroll-px-3 overflow-x-auto pb-2">
              <ol className="relative flex min-w-max px-3 pt-1 before:absolute before:left-8 before:right-8 before:top-11 before:h-px before:bg-slate-700">
                {activeMilestones.map((milestone) => {
                  const overdue =
                    milestone.status !== 'completed' && milestone.target_date < todayDate();
                  const next = milestone.id === nextMilestoneId;
                  return (
                    <li className="relative w-64 shrink-0 snap-start px-3" key={milestone.id}>
                      <time
                        className="block text-center font-mono text-xs font-semibold text-slate-300"
                        dateTime={milestone.target_date}
                      >
                        {formatDate(`${milestone.target_date}T00:00:00`)}
                      </time>
                      <span
                        aria-hidden="true"
                        className={`relative z-10 mx-auto mt-3 block size-4 rounded-full border-[3px] border-slate-950 ring-4 ring-slate-900 ${milestone.status === 'completed' ? 'bg-emerald-400' : overdue || milestone.status === 'at_risk' ? 'bg-rose-400' : 'bg-sky-400'}`}
                      />
                      <button
                        aria-label={t('milestones.open', { title: milestone.title })}
                        className="group mt-4 block w-full rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-left transition hover:-translate-y-0.5 hover:border-slate-600 hover:bg-slate-950 focus-visible:border-sky-400"
                        onClick={() => setSelectedId(milestone.id)}
                        type="button"
                      >
                        <span className="flex items-start justify-between gap-2">
                          <strong className="min-w-0 flex-1 truncate text-sm text-slate-100">
                            {milestone.title}
                          </strong>
                          <span className="flex shrink-0 items-center gap-1">
                            {next && (
                              <span className="rounded-full bg-sky-400 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-950">
                                {t('milestones.next')}
                              </span>
                            )}
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${statusTone[milestone.status]}`}
                            >
                              {overdue ? t('milestones.overdue') : statusLabel(milestone.status)}
                            </span>
                          </span>
                        </span>
                        <span className="mt-2 block line-clamp-2 min-h-10 text-xs leading-5 text-slate-500">
                          {milestone.description || t('milestones.noDescription')}
                        </span>
                        {milestone.task_count > 0 ? (
                          <span
                            className="mt-3 block"
                            aria-label={t('milestones.taskProgress', {
                              completed: milestone.completed_task_count,
                              total: milestone.task_count,
                            })}
                          >
                            <span className="flex items-center justify-between text-[10px] text-slate-400">
                              <span>{t('milestones.linkedTasks')}</span>
                              <span className="font-mono text-slate-300">
                                {milestone.completed_task_count}/{milestone.task_count}
                              </span>
                            </span>
                            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-800">
                              <span
                                className="block h-full rounded-full bg-emerald-400"
                                style={{
                                  width: `${(milestone.completed_task_count / milestone.task_count) * 100}%`,
                                }}
                              />
                            </span>
                          </span>
                        ) : (
                          <span className="mt-3 block text-[10px] text-slate-600">
                            {t('milestones.noLinkedTasks')}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-700 px-5 py-12 text-center">
              <h2 className="font-semibold text-slate-200">
                {query ? t('milestones.noMatches') : t('milestones.empty')}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {query ? t('milestones.noMatchesBody') : t('milestones.emptyBody')}
              </p>
            </div>
          )}
          {pageInfo.hasNext && (
            <div className="mt-4 flex justify-center border-t border-slate-800 pt-4">
              <Button
                disabled={loadingMore}
                onClick={() => void loadMoreMilestones()}
                type="button"
                variant="quiet"
              >
                {loadingMore
                  ? t('common.loading')
                  : t('milestones.loadMore', {
                      shown: milestoneOptions.length,
                      total: pageInfo.total,
                    })}
              </Button>
            </div>
          )}
        </section>
      )}

      {summary.archived > 0 && (
        <details className="mt-6 rounded-xl border border-slate-800 bg-slate-900/35 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-400">
            {t('milestones.archivedHeading', { count: summary.archived })}
          </summary>
          <div className="mt-3 space-y-2">
            {archivedMilestones.map((milestone) => (
              <div
                className="flex items-center gap-3 rounded-lg bg-slate-950/45 px-3 py-2"
                key={milestone.id}
              >
                <span className="min-w-0 flex-1 truncate text-sm text-slate-500">
                  {milestone.title}
                </span>
                {allowed(user, 'project.update') && (
                  <IconAction
                    disabled={busy}
                    icon="↺"
                    label={t('common.restore')}
                    onClick={() => void restoreMilestone(milestone)}
                    tone="accent"
                  />
                )}
              </div>
            ))}
            {archivedMilestones.length === 0 && (
              <p className="px-2 py-3 text-xs text-slate-500">
                {t('milestones.archivedOnLaterPage')}
              </p>
            )}
          </div>
        </details>
      )}

      {creatorOpen && (
        <MilestoneDialog
          busy={busy}
          dialogRef={creatorDialogRef}
          taskSearchBase={base}
          tasksBase={`${base}/tasks`}
          title={t('milestones.create')}
          onClose={() => setCreatorOpen(false)}
          onSubmit={createMilestone}
        />
      )}
      {selected && (
        <MilestoneDialog
          busy={busy}
          dialogRef={detailDialogRef}
          milestone={selected}
          taskSearchBase={base}
          tasksBase={`${base}/tasks`}
          readOnly={!allowed(user, 'project.update')}
          title={selected.title}
          onArchive={() => void archiveMilestone(selected)}
          onClose={() => setSelectedId('')}
          onSubmit={updateMilestone}
        />
      )}
    </>
  );
}

function MilestoneDialog({
  busy,
  dialogRef,
  milestone,
  taskSearchBase,
  tasksBase,
  readOnly = false,
  title,
  onArchive,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  milestone?: Milestone;
  taskSearchBase: string;
  tasksBase: string;
  readOnly?: boolean;
  title: string;
  onArchive?: (() => void) | undefined;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const labelClass = 'grid gap-1 text-xs text-slate-400';
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-6">
      <button
        aria-label={t('milestones.close')}
        className="absolute inset-0 cursor-default bg-slate-950/70 backdrop-blur-sm"
        data-modal-backdrop
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby="milestone-dialog-title"
        aria-modal="true"
        className="relative max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 shadow-2xl shadow-black/50"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-5 py-4 backdrop-blur-xl">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-400">
              {t('milestones.eyebrow')}
            </p>
            <h2 className="mt-1 truncate text-xl font-semibold" id="milestone-dialog-title">
              {title}
            </h2>
          </div>
          <button
            aria-label={t('milestones.close')}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-xl text-slate-500 hover:bg-slate-800 hover:text-slate-100"
            data-dialog-initial-focus
            onClick={onClose}
            title={t('milestones.close')}
            type="button"
          >
            ×
          </button>
        </header>
        <form
          className="grid gap-4 p-5"
          key={`${milestone?.id ?? 'new'}:${milestone?.row_version ?? 0}`}
          onSubmit={onSubmit}
        >
          <label className={labelClass}>
            <FormFieldLabel required>{t('milestones.title')}</FormFieldLabel>
            <input
              className={inputClass}
              defaultValue={milestone?.title}
              disabled={readOnly}
              name="title"
              required
            />
          </label>
          <label className={labelClass}>
            <FormFieldLabel>{t('milestones.descriptionLabel')}</FormFieldLabel>
            <textarea
              className={`${inputClass} min-h-24 resize-y`}
              defaultValue={milestone?.description}
              disabled={readOnly}
              name="description"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              <FormFieldLabel required>{t('milestones.targetDate')}</FormFieldLabel>
              <input
                className={inputClass}
                defaultValue={milestone?.target_date}
                disabled={readOnly}
                name="targetDate"
                required
                type="date"
              />
            </label>
            <label className={labelClass}>
              <FormFieldLabel required>{t('milestones.status')}</FormFieldLabel>
              <select
                className={inputClass}
                defaultValue={milestone?.status ?? 'planned'}
                disabled={readOnly}
                name="status"
                required
              >
                {(['planned', 'active', 'at_risk', 'completed'] as const).map((status) => (
                  <option key={status} value={status}>
                    {t(`milestones.status.${status}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <TaskPicker
            key={`${milestone?.id ?? 'new'}:${milestone?.row_version ?? 0}`}
            linkedTasks={milestone?.linked_tasks ?? []}
            readOnly={readOnly}
            searchBase={taskSearchBase}
            tasksBase={tasksBase}
          />
          {!readOnly && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-4">
              {milestone && onArchive ? (
                <IconAction
                  disabled={busy}
                  icon="⌫"
                  label={t('common.archive')}
                  onClick={onArchive}
                  tone="danger"
                />
              ) : (
                <span />
              )}
              <Button disabled={busy} type="submit">
                {busy
                  ? t('common.working')
                  : milestone
                    ? t('milestones.save')
                    : t('milestones.create')}
              </Button>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}

function milestonePayload(data: FormData) {
  return {
    title: data.get('title'),
    description: data.get('description'),
    status: data.get('status'),
    targetDate: data.get('targetDate'),
    taskIds: data.getAll('taskIds'),
  };
}

function TaskPicker({
  linkedTasks,
  readOnly,
  searchBase,
  tasksBase,
}: {
  linkedTasks: LinkedTask[];
  readOnly: boolean;
  searchBase: string;
  tasksBase: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set(linkedTasks.map((task) => task.id)));
  const [resolvedTasks, setResolvedTasks] = useState<Map<string, TaskCandidate | LinkedTask>>(
    () => new Map(linkedTasks.map((task) => [task.id, task])),
  );
  const [results, setResults] = useState<TaskCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const searchRequestId = useRef(0);

  useEffect(() => {
    if (readOnly) return;
    const search = query.trim();
    const requestId = ++searchRequestId.current;
    if (search.length < 2) {
      setResults([]);
      setLoading(false);
      setSearchError('');
      setHasMore(false);
      return;
    }
    const timeout = window.setTimeout(() => {
      const parameters = new URLSearchParams({ query: search, limit: '20' });
      setLoading(true);
      setSearchError('');
      void api<{ items: TaskCandidate[]; pageInfo: { hasNext: boolean } }>(
        `${searchBase}/task-candidates?${parameters.toString()}`,
      )
        .then((page) => {
          if (requestId !== searchRequestId.current) return;
          setResults(page.items);
          setHasMore(page.pageInfo.hasNext);
        })
        .catch(() => {
          if (requestId !== searchRequestId.current) return;
          setResults([]);
          setHasMore(false);
          setSearchError(t('milestones.taskSearchFailed'));
        })
        .finally(() => {
          if (requestId === searchRequestId.current) setLoading(false);
        });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query, readOnly, searchBase, t]);

  const options = useMemo(() => {
    const byId = new Map<string, TaskCandidate | LinkedTask>();
    for (const [id, task] of resolvedTasks) {
      if (selected.has(id)) byId.set(id, task);
    }
    if (!readOnly) {
      for (const candidate of results) {
        if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
      }
    }
    return [...byId.values()].sort((left, right) => {
      if (selected.has(left.id) !== selected.has(right.id)) return selected.has(left.id) ? -1 : 1;
      return left.task_key.localeCompare(right.task_key, undefined, { numeric: true });
    });
  }, [readOnly, resolvedTasks, results, selected]);

  return (
    <fieldset className="grid gap-2 rounded-lg border border-slate-800 bg-slate-900/45 p-3">
      <legend className="px-1 text-xs text-slate-400">
        <FormFieldLabel>{t('milestones.linkedTasks')}</FormFieldLabel>
      </legend>
      <p className="text-xs leading-5 text-slate-500">{t('milestones.linkedTasksHelp')}</p>
      {[...selected].map((taskId) => (
        <input key={taskId} name="taskIds" type="hidden" value={taskId} />
      ))}
      {!readOnly && (
        <input
          aria-label={t('milestones.searchTasks')}
          className={inputClass}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('milestones.searchTasksPlaceholder')}
          type="search"
          value={query}
        />
      )}
      {!readOnly && query.trim().length < 2 && (
        <p className="text-[10px] text-slate-600">{t('milestones.taskSearchHint')}</p>
      )}
      {searchError && <p className="text-[10px] text-rose-300">{searchError}</p>}
      <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
        {options.length > 0 ? (
          options.map((candidate) => {
            const linked = 'status_name' in candidate ? candidate : undefined;
            return (
              <div
                className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-slate-800/70"
                key={candidate.id}
              >
                {!readOnly && (
                  <input
                    aria-label={`${candidate.task_key} ${candidate.title}`}
                    checked={selected.has(candidate.id)}
                    className="size-4 accent-sky-400"
                    onChange={(event) => {
                      if (event.target.checked) {
                        setResolvedTasks((tasks) => new Map(tasks).set(candidate.id, candidate));
                      }
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(candidate.id);
                        else next.delete(candidate.id);
                        return next;
                      });
                    }}
                    type="checkbox"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-xs text-sky-300">{candidate.task_key}</span>
                  <span className="ml-2 text-slate-200">{candidate.title}</span>
                </span>
                {linked && (
                  <span className="shrink-0 text-[10px] text-slate-500">
                    {linked.archived_at ? t('common.archived') : linked.status_name}
                  </span>
                )}
                <Link
                  aria-label={t('milestones.openTask', { key: candidate.task_key })}
                  className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-sky-300"
                  title={t('milestones.openTask', { key: candidate.task_key })}
                  to={`${tasksBase}?task=${candidate.task_key}`}
                >
                  ↗
                </Link>
              </div>
            );
          })
        ) : !searchError ? (
          <p className="px-2 py-4 text-center text-xs text-slate-500">
            {readOnly || query.trim().length < 2
              ? t('milestones.noLinkedTasks')
              : loading
                ? t('common.loading')
                : t('milestones.noTaskMatches')}
          </p>
        ) : null}
      </div>
      {!readOnly && hasMore && (
        <p className="text-[10px] text-amber-300">{t('milestones.refineTaskSearch')}</p>
      )}
    </fieldset>
  );
}

function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
