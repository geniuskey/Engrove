import { Button } from '@engrove/ui';
import { type FormEvent, type RefObject, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { allowed, api, inputClass, NoticeText, type User } from './App.js';
import { useI18n } from './i18n.js';
import { useModalDialog } from './useModalDialog.js';

type MilestoneStatus = 'planned' | 'active' | 'at_risk' | 'completed';

interface Milestone {
  id: string;
  title: string;
  description: string;
  status: MilestoneStatus;
  start_date: string | null;
  target_date: string;
  progress: number;
  completed_at: string | null;
  row_version: number;
  archived_at: string | null;
}

const statusTone: Record<MilestoneStatus, string> = {
  planned: 'border-slate-700 bg-slate-800/70 text-slate-300',
  active: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  at_risk: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
};

export function MilestonesPage({ user }: { user: User }) {
  const { formatDate, t } = useI18n();
  const { workspaceId, projectId } = useParams();
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const creatorDialogRef = useModalDialog<HTMLElement>(creatorOpen, () => setCreatorOpen(false));
  const detailDialogRef = useModalDialog<HTMLElement>(Boolean(selectedId), () => setSelectedId(''));
  const selected = milestones.find((milestone) => milestone.id === selectedId);

  const statusLabel = (status: MilestoneStatus) => t(`milestones.status.${status}`);
  const refresh = useCallback(async () => {
    try {
      const result = await api<{ items: Milestone[] }>(`${base}/milestones?includeArchived=true`);
      setMilestones(result.items);
      setMessage('');
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('milestones.loadError'));
    } finally {
      setLoading(false);
    }
  }, [base, t]);
  useEffect(() => void refresh(), [refresh]);

  const activeMilestones = useMemo(
    () => milestones.filter((milestone) => !milestone.archived_at),
    [milestones],
  );
  const archivedMilestones = useMemo(
    () => milestones.filter((milestone) => milestone.archived_at),
    [milestones],
  );

  async function createMilestone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    try {
      await api(`${base}/milestones`, {
        method: 'POST',
        body: JSON.stringify(milestonePayload(data)),
      });
      form.reset();
      setCreatorOpen(false);
      setMessageTone('success');
      setMessage(t('milestones.created'));
      await refresh();
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
    if (!window.confirm(t('milestones.archiveConfirm'))) return;
    setBusy(true);
    try {
      await api(`${base}/milestones/${milestone.id}/archive`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: 'Archived from milestone detail' }),
      });
      setSelectedId('');
      setMessageTone('success');
      setMessage(t('milestones.archived'));
      await refresh();
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
      setMessageTone('success');
      setMessage(t('milestones.restored'));
      await refresh();
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
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['planned', 'active', 'at_risk', 'completed'] as const).map((status) => (
            <div
              className="rounded-lg border border-slate-800 bg-slate-950/45 px-3 py-2"
              key={status}
            >
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                {statusLabel(status)}
              </span>
              <strong className="mt-0.5 block text-lg text-slate-200">
                {activeMilestones.filter((milestone) => milestone.status === status).length}
              </strong>
            </div>
          ))}
        </div>
      </section>

      <NoticeText tone={messageTone}>{message}</NoticeText>
      {loading ? (
        <div aria-label={t('common.loading')} className="mt-4 space-y-3">
          <div className="h-28 animate-pulse rounded-xl bg-slate-900/70" />
          <div className="h-28 animate-pulse rounded-xl bg-slate-900/55" />
        </div>
      ) : (
        <section className="mt-4" aria-label={t('milestones.timeline')}>
          <div className="relative space-y-3 before:absolute before:bottom-5 before:left-[0.95rem] before:top-5 before:w-px before:bg-slate-800">
            {activeMilestones.map((milestone) => {
              const overdue =
                milestone.status !== 'completed' && milestone.target_date < todayDate();
              return (
                <button
                  aria-label={t('milestones.open', { title: milestone.title })}
                  className="group relative grid w-full grid-cols-[2rem_minmax(0,1fr)] gap-3 text-left"
                  key={milestone.id}
                  onClick={() => setSelectedId(milestone.id)}
                  type="button"
                >
                  <span
                    className={`relative z-10 mt-5 size-8 rounded-full border-4 border-slate-950 ${milestone.status === 'completed' ? 'bg-emerald-400' : overdue || milestone.status === 'at_risk' ? 'bg-rose-400' : 'bg-sky-400'}`}
                  />
                  <span className="rounded-xl border border-slate-800 bg-slate-900/65 p-4 transition group-hover:border-slate-600 group-hover:bg-slate-900">
                    <span className="flex flex-wrap items-start justify-between gap-3">
                      <span className="min-w-0">
                        <strong className="block truncate text-base text-slate-100">
                          {milestone.title}
                        </strong>
                        <span className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-500">
                          {milestone.description || t('milestones.noDescription')}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${statusTone[milestone.status]}`}
                      >
                        {overdue ? t('milestones.overdue') : statusLabel(milestone.status)}
                      </span>
                    </span>
                    <span className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <span className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                        <span
                          className="block h-full rounded-full bg-sky-400"
                          style={{ width: `${milestone.progress}%` }}
                        />
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {milestone.progress}% · {formatDate(`${milestone.target_date}T00:00:00`)}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {!activeMilestones.length && (
            <div className="rounded-xl border border-dashed border-slate-700 px-5 py-12 text-center">
              <h2 className="font-semibold text-slate-200">{t('milestones.empty')}</h2>
              <p className="mt-1 text-sm text-slate-500">{t('milestones.emptyBody')}</p>
            </div>
          )}
        </section>
      )}

      {archivedMilestones.length > 0 && (
        <details className="mt-6 rounded-xl border border-slate-800 bg-slate-900/35 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-400">
            {t('milestones.archivedHeading', { count: archivedMilestones.length })}
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
                  <button
                    className="rounded-md px-2 py-1 text-xs text-sky-300 hover:bg-sky-500/10"
                    disabled={busy}
                    onClick={() => void restoreMilestone(milestone)}
                    type="button"
                  >
                    {t('common.restore')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {creatorOpen && (
        <MilestoneDialog
          busy={busy}
          dialogRef={creatorDialogRef}
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
  readOnly = false,
  title,
  onArchive,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  milestone?: Milestone;
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
            {t('milestones.title')}
            <input
              className={inputClass}
              defaultValue={milestone?.title}
              disabled={readOnly}
              name="title"
              required
            />
          </label>
          <label className={labelClass}>
            {t('milestones.descriptionLabel')}
            <textarea
              className={`${inputClass} min-h-24 resize-y`}
              defaultValue={milestone?.description}
              disabled={readOnly}
              name="description"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              {t('milestones.startDate')}
              <input
                className={inputClass}
                defaultValue={milestone?.start_date ?? ''}
                disabled={readOnly}
                name="startDate"
                type="date"
              />
            </label>
            <label className={labelClass}>
              {t('milestones.targetDate')}
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
              {t('milestones.status')}
              <select
                className={inputClass}
                defaultValue={milestone?.status ?? 'planned'}
                disabled={readOnly}
                name="status"
              >
                {(['planned', 'active', 'at_risk', 'completed'] as const).map((status) => (
                  <option key={status} value={status}>
                    {t(`milestones.status.${status}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              {t('milestones.progress')}
              <input
                className={inputClass}
                defaultValue={milestone?.progress ?? 0}
                disabled={readOnly}
                max={100}
                min={0}
                name="progress"
                required
                type="number"
              />
            </label>
          </div>
          {!readOnly && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-4">
              {milestone && onArchive ? (
                <button
                  className="rounded-lg px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10"
                  disabled={busy}
                  onClick={onArchive}
                  type="button"
                >
                  {t('common.archive')}
                </button>
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
    startDate: String(data.get('startDate') ?? '') || undefined,
    targetDate: data.get('targetDate'),
    progress: Number(data.get('progress') ?? 0),
  };
}

function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
