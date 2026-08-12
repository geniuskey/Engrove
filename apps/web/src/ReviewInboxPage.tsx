import { Button } from '@engrove/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ErrorText } from './App.js';
import { useI18n } from './i18n.js';

interface InboxItem {
  id: string;
  subject: string;
  status: 'open' | 'resolved';
  reviewStatus: 'discussion' | 'requested' | 'approved' | 'changes_requested';
  reviewerId: string | null;
  reviewerName: string | null;
  recordId: string;
  recordName: string;
  objectTypePublicId: string;
  objectTypeName: string;
  latestMessage: string;
  messageCount: number;
  updatedAt: string;
}

const statusStyle: Record<InboxItem['reviewStatus'], string> = {
  discussion: 'border-slate-700 bg-slate-800/70 text-slate-300',
  requested: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  changes_requested: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
};

interface InboxPage {
  items: InboxItem[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
  summary: { waitingForMe: number; openInvolved: number };
}

const REVIEW_PAGE_SIZE = 50;

export function ReviewInboxPage() {
  const { t, formatDate } = useI18n();
  const { workspaceId = '', projectId = '' } = useParams();
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [items, setItems] = useState<InboxItem[]>([]);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [pageInfo, setPageInfo] = useState<InboxPage['pageInfo']>({
    limit: REVIEW_PAGE_SIZE,
    offset: 0,
    total: 0,
    hasNext: false,
  });
  const [summary, setSummary] = useState<InboxPage['summary']>({
    waitingForMe: 0,
    openInvolved: 0,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestId = useRef(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  const load = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    try {
      setLoading(true);
      const parameters = new URLSearchParams({
        includeResolved: String(includeResolved),
        limit: String(REVIEW_PAGE_SIZE),
        offset: '0',
      });
      if (debouncedQuery) parameters.set('query', debouncedQuery);
      const result = await api<InboxPage>(`${base}/reviews/inbox?${parameters.toString()}`);
      if (currentRequestId !== requestId.current) return;
      setItems(result.items);
      setPageInfo(result.pageInfo);
      setSummary(result.summary);
      setError('');
    } catch (cause) {
      if (currentRequestId !== requestId.current) return;
      setError(cause instanceof Error ? cause.message : t('reviewInbox.loadFailed'));
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  }, [base, debouncedQuery, includeResolved, t]);
  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  async function loadMore() {
    if (loadingMore || !pageInfo.hasNext) return;
    setLoadingMore(true);
    try {
      const parameters = new URLSearchParams({
        includeResolved: String(includeResolved),
        limit: String(pageInfo.limit),
        offset: String(items.length),
      });
      if (debouncedQuery) parameters.set('query', debouncedQuery);
      const result = await api<InboxPage>(`${base}/reviews/inbox?${parameters.toString()}`);
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...result.items.filter((item) => !known.has(item.id))];
      });
      setPageInfo(result.pageInfo);
      setSummary(result.summary);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('reviewInbox.loadFailed'));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-sky-400">
            {t('reviewInbox.eyebrow')}
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">{t('reviewInbox.heading')}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">
            {t('reviewInbox.description')}
          </p>
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-400">
          <input
            checked={includeResolved}
            onChange={(event) => setIncludeResolved(event.target.checked)}
            type="checkbox"
          />
          {t('reviews.showResolved')}
        </label>
      </div>
      <label className="mt-4 flex max-w-xl items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/55 px-3 focus-within:border-sky-500/60">
        <span aria-hidden="true" className="text-slate-500">
          ⌕
        </span>
        <span className="sr-only">{t('reviewInbox.search')}</span>
        <input
          aria-label={t('reviewInbox.search')}
          className="min-w-0 flex-1 bg-transparent py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('reviewInbox.searchPlaceholder')}
          type="search"
          value={query}
        />
        {query && (
          <button
            aria-label={t('reviewInbox.clearSearch')}
            className="grid size-7 place-items-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-slate-100"
            onClick={() => setQuery('')}
            title={t('reviewInbox.clearSearch')}
            type="button"
          >
            ×
          </button>
        )}
      </label>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <article className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
          <p className="text-xs text-sky-300">{t('reviewInbox.waitingForMe')}</p>
          <strong className="mt-1 block text-2xl text-slate-100">{summary.waitingForMe}</strong>
        </article>
        <article className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-xs text-slate-400">{t('reviewInbox.openInvolved')}</p>
          <strong className="mt-1 block text-2xl text-slate-100">{summary.openInvolved}</strong>
        </article>
      </div>
      <ErrorText>{error}</ErrorText>
      <section className="mt-6 space-y-3" aria-label={t('reviewInbox.list')}>
        {items.map((item) => (
          <Link
            className="group block rounded-xl border border-slate-800 bg-slate-900/35 p-4 transition hover:border-sky-500/30 hover:bg-slate-900/60"
            key={item.id}
            to={`${base}/data/${item.objectTypePublicId}/records/${item.recordId}#reviews`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium text-slate-100 group-hover:text-sky-200">
                    {item.subject}
                  </h2>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${statusStyle[item.reviewStatus]}`}
                  >
                    {t(`reviews.status.${item.reviewStatus}`)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {item.objectTypeName} · {item.recordName}
                  {item.reviewerName
                    ? ` · ${t('reviews.assignedTo', { name: item.reviewerName })}`
                    : ''}
                </p>
              </div>
              <span aria-hidden="true" className="text-slate-600 group-hover:text-sky-300">
                →
              </span>
            </div>
            <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-400">
              {item.latestMessage}
            </p>
            <p className="mt-3 text-[10px] text-slate-600">
              {t('reviewInbox.messageCount', { count: item.messageCount })} ·{' '}
              {formatDate(item.updatedAt, { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          </Link>
        ))}
        {!loading && !items.length && (
          <div className="rounded-xl border border-dashed border-slate-800 px-5 py-12 text-center">
            <p className="text-sm text-slate-400">
              {debouncedQuery ? t('reviewInbox.noResults') : t('reviewInbox.empty')}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              {debouncedQuery ? t('reviewInbox.noResultsBody') : t('reviewInbox.emptyBody')}
            </p>
          </div>
        )}
        {loading && !items.length && (
          <p className="text-sm text-slate-500">{t('common.loading')}</p>
        )}
        {pageInfo.hasNext && (
          <div className="pt-2 text-center">
            <Button
              disabled={loadingMore}
              onClick={() => void loadMore()}
              type="button"
              variant="quiet"
            >
              {loadingMore
                ? t('common.loading')
                : t('reviewInbox.loadMore', { shown: items.length, total: pageInfo.total })}
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
