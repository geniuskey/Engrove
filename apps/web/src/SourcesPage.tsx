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
import { Link, useParams } from 'react-router';
import { allowed, api, inputClass, NoticeText, type User } from './App.js';
import { useActionDialog } from './ActionDialogProvider.js';
import { FormFieldLabel } from './FormFieldLabel.js';
import { IconAction } from './IconAction.js';
import { useI18n } from './i18n.js';
import { useModalDialog } from './useModalDialog.js';

interface ExternalSource {
  id: string;
  title: string;
  provider: string;
  url: string;
  external_id: string;
  version: string;
  observed_on: string;
  notes: string;
  row_version: number;
  archived_at: string | null;
}

interface SourceListPage {
  items: ExternalSource[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
  summary: { providerCount: number };
}

const SOURCE_PAGE_SIZE = 50;

export function SourcesPage({ user }: { user: User }) {
  const { formatDate, t } = useI18n();
  const { confirmAction } = useActionDialog();
  const { workspaceId, projectId } = useParams();
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [sources, setSources] = useState<ExternalSource[]>([]);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activePage, setActivePage] = useState<SourceListPage['pageInfo']>();
  const [archivedPage, setArchivedPage] = useState<SourceListPage['pageInfo']>();
  const [providerCount, setProviderCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState<'active' | 'archived' | ''>('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const requestId = useRef(0);
  const creatorDialogRef = useModalDialog<HTMLElement>(creatorOpen, () => setCreatorOpen(false));
  const detailDialogRef = useModalDialog<HTMLElement>(Boolean(selectedId), () => setSelectedId(''));
  const selected = sources.find((source) => source.id === selectedId);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const refresh = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    setLoading(true);
    try {
      const search = debouncedQuery ? `&query=${encodeURIComponent(debouncedQuery)}` : '';
      const [active, archived] = await Promise.all([
        api<SourceListPage>(
          `${base}/sources?archiveState=active&limit=${SOURCE_PAGE_SIZE}&offset=0${search}`,
        ),
        api<SourceListPage>(
          `${base}/sources?archiveState=archived&limit=${SOURCE_PAGE_SIZE}&offset=0${search}`,
        ),
      ]);
      if (currentRequestId !== requestId.current) return;
      setSources([...active.items, ...archived.items]);
      setActivePage(active.pageInfo);
      setArchivedPage(archived.pageInfo);
      setProviderCount(active.summary.providerCount);
      setLoadError('');
    } catch (cause) {
      if (currentRequestId !== requestId.current) return;
      setLoadError(cause instanceof Error ? cause.message : t('sources.loadError'));
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  }, [base, debouncedQuery, t]);
  useEffect(() => {
    void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh]);

  const activeSources = useMemo(() => sources.filter((source) => !source.archived_at), [sources]);
  const archivedSources = useMemo(() => sources.filter((source) => source.archived_at), [sources]);
  async function loadMore(archiveState: 'active' | 'archived') {
    if (loadingMore) return;
    const page = archiveState === 'active' ? activePage : archivedPage;
    if (!page?.hasNext) return;
    setLoadingMore(archiveState);
    try {
      const search = debouncedQuery ? `&query=${encodeURIComponent(debouncedQuery)}` : '';
      const result = await api<SourceListPage>(
        `${base}/sources?archiveState=${archiveState}&limit=${SOURCE_PAGE_SIZE}&offset=${page.offset + page.limit}${search}`,
      );
      setSources((current) => {
        const ids = new Set(current.map((source) => source.id));
        return [...current, ...result.items.filter((source) => !ids.has(source.id))];
      });
      if (archiveState === 'active') {
        setActivePage(result.pageInfo);
        setProviderCount(result.summary.providerCount);
      } else setArchivedPage(result.pageInfo);
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('sources.loadError'));
    } finally {
      setLoadingMore('');
    }
  }

  async function createSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true);
    try {
      await api(`${base}/sources`, {
        method: 'POST',
        body: JSON.stringify(sourcePayload(new FormData(form))),
      });
      form.reset();
      setCreatorOpen(false);
      await refresh();
      setMessageTone('success');
      setMessage(t('sources.created'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('sources.operationError'));
    } finally {
      setBusy(false);
    }
  }

  async function updateSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    try {
      const updated = await api<ExternalSource>(`${base}/sources/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...sourcePayload(new FormData(event.currentTarget)),
          rowVersion: selected.row_version,
        }),
      });
      setSources((current) =>
        current.map((source) => (source.id === updated.id ? updated : source)),
      );
      await refresh();
      setMessageTone('success');
      setMessage(t('sources.updated'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('sources.operationError'));
    } finally {
      setBusy(false);
    }
  }

  async function archiveSource(source: ExternalSource) {
    if (!(await confirmAction(t('sources.archiveConfirm'), { tone: 'danger' }))) return;
    setBusy(true);
    try {
      await api(`${base}/sources/${source.id}/archive`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: 'Archived from data source detail' }),
      });
      setSelectedId('');
      await refresh();
      setMessageTone('success');
      setMessage(t('sources.archived'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('sources.operationError'));
    } finally {
      setBusy(false);
    }
  }

  async function restoreSource(source: ExternalSource) {
    setBusy(true);
    try {
      await api(`${base}/sources/${source.id}/restore`, { method: 'POST' });
      await refresh();
      setMessageTone('success');
      setMessage(t('sources.restored'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('sources.operationError'));
    } finally {
      setBusy(false);
    }
  }

  async function copySourceValue(label: string, value: string) {
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

  return (
    <>
      <Link className="text-sm text-slate-400 hover:text-sky-300" to={base}>
        ← {t('common.projectBack')}
      </Link>
      <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900/55 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-400">
              {t('sources.eyebrow')}
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{t('sources.heading')}</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">{t('sources.description')}</p>
          </div>
          {allowed(user, 'project.update') && (
            <Button
              aria-label={t('sources.add')}
              onClick={() => setCreatorOpen(true)}
              type="button"
            >
              + {t('sources.add')}
            </Button>
          )}
        </div>
        <dl className="mt-3 flex flex-wrap gap-1.5" aria-label={t('sources.summary')}>
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
            <dt className="text-[10px] uppercase tracking-wider">{t('sources.active')}</dt>
            <dd className="font-mono text-xs font-semibold">
              {activePage?.total ?? activeSources.length}
            </dd>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-slate-300">
            <dt className="text-[10px] uppercase tracking-wider">{t('sources.providers')}</dt>
            <dd className="font-mono text-xs font-semibold">{providerCount}</dd>
          </div>
        </dl>
        <label className="mt-3 flex max-w-xl items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/55 px-3 focus-within:border-sky-500/60">
          <span aria-hidden="true" className="text-slate-500">
            ⌕
          </span>
          <span className="sr-only">{t('sources.search')}</span>
          <input
            aria-label={t('sources.search')}
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('sources.searchPlaceholder')}
            type="search"
            value={query}
          />
          {query && (
            <button
              aria-label={t('sources.clearSearch')}
              className="grid size-7 place-items-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-slate-100"
              onClick={() => setQuery('')}
              title={t('sources.clearSearch')}
              type="button"
            >
              ×
            </button>
          )}
        </label>
      </section>

      <NoticeText tone={messageTone}>{message}</NoticeText>
      {loading ? (
        <div aria-label={t('common.loading')} className="mt-4 space-y-2">
          <div className="h-16 animate-pulse rounded-xl bg-slate-900/70" />
          <div className="h-16 animate-pulse rounded-xl bg-slate-900/55" />
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
      ) : activeSources.length ? (
        <section
          aria-label={t('sources.list')}
          className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/35"
        >
          {activeSources.map((source) => (
            <article
              className="grid gap-3 border-t border-slate-800 px-4 py-3 first:border-t-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
              key={source.id}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                    {source.provider}
                  </span>
                  <h2 className="truncate text-sm font-semibold text-slate-100">{source.title}</h2>
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {sourceHost(source.url)}
                  {source.external_id ? ` · ${source.external_id}` : ''}
                  {source.version ? ` · ${source.version}` : ''}
                  {' · '}
                  {formatDate(`${source.observed_on}T00:00:00`)}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <IconAction
                  icon="↗"
                  label={t('sources.open')}
                  onClick={() => window.open(source.url, '_blank', 'noopener,noreferrer')}
                  tone="accent"
                />
                <IconAction
                  icon="⧉"
                  label={t('sources.copyUrl')}
                  onClick={() => void copySourceValue(t('sources.url'), source.url)}
                />
                <IconAction
                  icon="#"
                  label={t('sources.copyId')}
                  onClick={() => void copySourceValue('ID', source.id)}
                />
                <IconAction
                  icon={allowed(user, 'project.update') ? '✎' : '⌕'}
                  label={allowed(user, 'project.update') ? t('sources.edit') : t('sources.view')}
                  onClick={() => setSelectedId(source.id)}
                />
              </div>
            </article>
          ))}
          {activePage?.hasNext && (
            <div className="border-t border-slate-800 p-3 text-center">
              <Button
                disabled={Boolean(loadingMore)}
                onClick={() => void loadMore('active')}
                type="button"
                variant="quiet"
              >
                {loadingMore === 'active'
                  ? t('common.loading')
                  : t('sources.loadMore', {
                      shown: activeSources.length,
                      total: activePage.total,
                    })}
              </Button>
            </div>
          )}
        </section>
      ) : (
        <section className="mt-4 rounded-xl border border-dashed border-slate-700 px-5 py-10 text-center">
          <h2 className="font-semibold text-slate-200">
            {debouncedQuery ? t('sources.noResults') : t('sources.empty')}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {debouncedQuery ? t('sources.noResultsBody') : t('sources.emptyBody')}
          </p>
        </section>
      )}

      {archivedSources.length > 0 && (
        <details className="mt-5 rounded-xl border border-slate-800 bg-slate-900/35 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-400">
            {t('sources.archivedHeading', {
              count: archivedPage?.total ?? archivedSources.length,
            })}
          </summary>
          <div className="mt-3 space-y-2">
            {archivedSources.map((source) => (
              <div
                className="flex items-center gap-3 rounded-lg bg-slate-950/45 px-3 py-2"
                key={source.id}
              >
                <span className="min-w-0 flex-1 truncate text-sm text-slate-500">
                  {source.provider} · {source.title}
                </span>
                {allowed(user, 'project.update') && (
                  <IconAction
                    disabled={busy}
                    icon="↺"
                    label={t('common.restore')}
                    onClick={() => void restoreSource(source)}
                    tone="accent"
                  />
                )}
              </div>
            ))}
            {archivedPage?.hasNext && (
              <div className="pt-1 text-center">
                <Button
                  disabled={Boolean(loadingMore)}
                  onClick={() => void loadMore('archived')}
                  type="button"
                  variant="quiet"
                >
                  {loadingMore === 'archived'
                    ? t('common.loading')
                    : t('sources.loadMore', {
                        shown: archivedSources.length,
                        total: archivedPage.total,
                      })}
                </Button>
              </div>
            )}
          </div>
        </details>
      )}

      <details className="mt-5 text-xs text-slate-500">
        <summary className="cursor-pointer hover:text-slate-300">
          {t('sources.snapshotHelp')}
        </summary>
        <p className="mt-2">{t('sources.snapshotBody')}</p>
        <Link className="mt-2 inline-flex text-sky-300 hover:text-sky-200" to={`${base}/data`}>
          {t('sources.openImports')} →
        </Link>
      </details>

      {creatorOpen && (
        <SourceDialog
          busy={busy}
          dialogRef={creatorDialogRef}
          title={t('sources.add')}
          onClose={() => setCreatorOpen(false)}
          onSubmit={createSource}
        />
      )}
      {selected && (
        <SourceDialog
          busy={busy}
          dialogRef={detailDialogRef}
          readOnly={!allowed(user, 'project.update')}
          source={selected}
          title={selected.title}
          onArchive={() => void archiveSource(selected)}
          onClose={() => setSelectedId('')}
          onSubmit={updateSource}
        />
      )}
    </>
  );
}

function SourceDialog({
  busy,
  dialogRef,
  readOnly = false,
  source,
  title,
  onArchive,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  readOnly?: boolean;
  source?: ExternalSource;
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
        aria-label={t('sources.close')}
        className="absolute inset-0 cursor-default bg-slate-950/70 backdrop-blur-sm"
        data-modal-backdrop
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby="source-dialog-title"
        aria-modal="true"
        className="relative max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 shadow-2xl shadow-black/50"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-5 py-4 backdrop-blur-xl">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-400">
              {t('sources.eyebrow')}
            </p>
            <h2 className="mt-1 truncate text-xl font-semibold" id="source-dialog-title">
              {title}
            </h2>
          </div>
          <button
            aria-label={t('sources.close')}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-xl text-slate-500 hover:bg-slate-800 hover:text-slate-100"
            data-dialog-initial-focus
            onClick={onClose}
            title={t('sources.close')}
            type="button"
          >
            ×
          </button>
        </header>
        <form
          className="grid gap-4 p-5 sm:grid-cols-2"
          key={`${source?.id ?? 'new'}:${source?.row_version ?? 0}`}
          onSubmit={onSubmit}
        >
          <label className={`${labelClass} sm:col-span-2`}>
            <FormFieldLabel required>{t('sources.title')}</FormFieldLabel>
            <input
              className={inputClass}
              defaultValue={source?.title}
              disabled={readOnly}
              name="title"
              required
            />
          </label>
          <label className={labelClass}>
            <FormFieldLabel required>{t('sources.provider')}</FormFieldLabel>
            <input
              className={inputClass}
              defaultValue={source?.provider}
              disabled={readOnly}
              name="provider"
              placeholder={t('sources.providerExample')}
              required
            />
          </label>
          <label className={labelClass}>
            <FormFieldLabel required>{t('sources.observedOn')}</FormFieldLabel>
            <input
              className={inputClass}
              defaultValue={source?.observed_on ?? todayDate()}
              disabled={readOnly}
              name="observedOn"
              required
              type="date"
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            <FormFieldLabel required>{t('sources.url')}</FormFieldLabel>
            <input
              className={inputClass}
              defaultValue={source?.url}
              disabled={readOnly}
              name="url"
              placeholder="https://…"
              required
              type="url"
            />
          </label>
          <label className={labelClass}>
            <FormFieldLabel>{t('sources.externalId')}</FormFieldLabel>
            <input
              className={inputClass}
              defaultValue={source?.external_id}
              disabled={readOnly}
              name="externalId"
            />
          </label>
          <label className={labelClass}>
            <FormFieldLabel>{t('sources.version')}</FormFieldLabel>
            <input
              className={inputClass}
              defaultValue={source?.version}
              disabled={readOnly}
              name="version"
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            <FormFieldLabel>{t('sources.notes')}</FormFieldLabel>
            <textarea
              className={`${inputClass} min-h-20 resize-y`}
              defaultValue={source?.notes}
              disabled={readOnly}
              name="notes"
            />
          </label>
          {!readOnly && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-4 sm:col-span-2">
              {source && onArchive ? (
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
                {busy ? t('common.working') : source ? t('sources.save') : t('sources.add')}
              </Button>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}

function sourcePayload(data: FormData) {
  return {
    title: data.get('title'),
    provider: data.get('provider'),
    url: data.get('url'),
    externalId: data.get('externalId'),
    version: data.get('version'),
    observedOn: data.get('observedOn'),
    notes: data.get('notes'),
  };
}

function sourceHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
