import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n.js';

interface AuditEvent {
  id: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
}

interface AuditPageProps {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
}

interface AuditEventPage {
  items: AuditEvent[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
}

const AUDIT_PAGE_SIZE = 50;

const inputClass =
  'min-h-10 w-full rounded-lg border border-slate-700/80 bg-slate-900/85 px-3 py-2 text-sm text-slate-100 shadow-sm outline-none transition placeholder:text-slate-600 hover:border-slate-600 focus:border-sky-400 focus:ring-3 focus:ring-sky-400/15 disabled:cursor-not-allowed disabled:opacity-50';

export function AuditPage({ request }: AuditPageProps) {
  const { formatDate, formatTime, t } = useI18n();
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [pageInfo, setPageInfo] = useState<AuditEventPage['pageInfo']>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState<'page' | 'more' | ''>('page');
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const requestId = useRef(0);

  const load = useCallback(
    async (search: string, offset = 0, append = false) => {
      const currentRequestId = ++requestId.current;
      setLoading(append ? 'more' : 'page');
      if (!append) {
        setItems([]);
        setPageInfo(undefined);
      }
      try {
        const parameters = new URLSearchParams({
          query: search,
          limit: String(AUDIT_PAGE_SIZE),
          offset: String(offset),
        });
        const result = await request<AuditEventPage>(`/audit-events?${parameters}`);
        if (currentRequestId !== requestId.current) return;
        setItems((current) => (append ? [...current, ...result.items] : result.items));
        setPageInfo(result.pageInfo);
        setError('');
      } catch (cause) {
        if (currentRequestId !== requestId.current) return;
        setError(cause instanceof Error ? cause.message : 'Request failed.');
      } finally {
        if (currentRequestId === requestId.current) setLoading('');
      }
    },
    [request],
  );

  useEffect(() => {
    void load('');
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  function search(event: FormEvent) {
    event.preventDefault();
    const normalized = query.trim();
    setAppliedQuery(normalized);
    void load(normalized);
  }

  function clearSearch() {
    setQuery('');
    setAppliedQuery('');
    void load('');
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-sky-400">
            {t('settings.organization')}
          </p>
          <h1 className="mt-1 text-3xl font-semibold">{t('audit.heading')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('audit.description')}</p>
        </div>
        <button
          aria-label={t('audit.refresh')}
          className="grid size-9 place-items-center rounded-lg border border-slate-800 text-slate-500 hover:bg-slate-800 hover:text-sky-300"
          disabled={Boolean(loading)}
          onClick={() => void load(appliedQuery)}
          title={t('audit.refresh')}
          type="button"
        >
          <span aria-hidden="true">↻</span>
        </button>
      </div>
      <form className="mt-5 flex max-w-xl gap-2" onSubmit={search}>
        <input
          aria-label={t('audit.search')}
          className={`${inputClass} min-w-0 flex-1`}
          maxLength={200}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('audit.searchPlaceholder')}
          type="search"
          value={query}
        />
        {(query || appliedQuery) && (
          <button
            aria-label={t('audit.clearSearch')}
            className="grid size-10 place-items-center rounded-lg border border-slate-800 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
            onClick={clearSearch}
            title={t('audit.clearSearch')}
            type="button"
          >
            ×
          </button>
        )}
        <button
          aria-label={t('audit.search')}
          className="grid size-10 place-items-center rounded-lg bg-sky-400 font-semibold text-slate-950 disabled:opacity-45"
          disabled={loading === 'page'}
          title={t('audit.search')}
          type="submit"
        >
          ⌕
        </button>
      </form>
      {error && (
        <p aria-live="polite" className="mt-3 text-sm text-rose-300">
          {error}
        </p>
      )}
      {loading === 'page' && <p className="mt-6 text-sm text-slate-500">{t('common.loading')}</p>}
      {!loading && items.length === 0 && (
        <p className="mt-6 rounded-xl border border-slate-800 p-6 text-center text-sm text-slate-500">
          {appliedQuery ? t('audit.noMatch') : t('audit.empty')}
        </p>
      )}
      {pageInfo && (
        <p className="mt-4 text-xs text-slate-500">
          {t('audit.resultCount', { shown: items.length, total: pageInfo.total })}
        </p>
      )}
      <div className="mt-5 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/45">
        {items.map((event) => (
          <article className="grid gap-2 p-3 text-xs sm:grid-cols-4" key={event.id}>
            <time className="text-slate-500" dateTime={event.createdAt}>
              <span className="block">{formatDate(event.createdAt)}</span>
              <span className="block text-[10px]">{formatTime(event.createdAt)}</span>
            </time>
            <span className="min-w-0">
              <strong className="block truncate font-medium text-slate-300">
                {event.actorName || t('audit.system')}
              </strong>
              <span className="block truncate text-[10px] text-slate-600">
                {event.actorEmail || '—'}
              </span>
            </span>
            <code className="break-all text-sky-300">{event.action}</code>
            <span className="min-w-0 text-slate-500">
              <span className="block truncate">{event.targetType}</span>
              <span className="block truncate font-mono text-[10px]" title={event.targetId ?? ''}>
                {event.targetId || '—'}
              </span>
            </span>
          </article>
        ))}
      </div>
      {pageInfo?.hasNext && (
        <button
          className="mt-3 min-h-10 w-full rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-45"
          disabled={loading === 'more'}
          onClick={() => void load(appliedQuery, items.length, true)}
          type="button"
        >
          {loading === 'more'
            ? t('common.loading')
            : t('audit.loadMore', { shown: items.length, total: pageInfo.total })}
        </button>
      )}
    </section>
  );
}
