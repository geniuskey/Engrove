import { Button } from '@engrove/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useI18n } from './i18n.js';

type Priority = 'low' | 'medium' | 'high' | 'critical';
type Urgency = 'all' | 'overdue' | 'today' | 'week' | 'blocked' | 'no_due';
type Sort = 'attention' | 'dueDate' | 'priority' | 'updated';

interface MyWorkItem {
  id: string;
  taskKey: string;
  title: string;
  status: { key: string; name: string; category: 'todo' | 'in_progress'; color: string };
  priority: Priority;
  dueDate: string | null;
  updatedAt: string;
  openBlockerCount: number;
  parentTaskKey: string | null;
  project: { id: string; publicId: string; name: string };
}

interface MyWorkResponse {
  summary: { total: number; overdue: number; dueSoon: number; blocked: number; noDueDate: number };
  items: MyWorkItem[];
  pageInfo: { limit: number; offset: number; total: number; hasMore: boolean };
}

const urgencyValues = new Set<Urgency>(['all', 'overdue', 'today', 'week', 'blocked', 'no_due']);
const priorityValues = new Set<Priority>(['low', 'medium', 'high', 'critical']);
const sortValues = new Set<Sort>(['attention', 'dueDate', 'priority', 'updated']);

export function MyWorkPage({
  request,
}: {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
}) {
  const { formatDate, formatNumber, t } = useI18n();
  const workspaceId = useParams().workspaceId!;
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('query') ?? '';
  const urgencyValue = searchParams.get('urgency') as Urgency | null;
  const priorityValue = searchParams.get('priority') as Priority | null;
  const sortValue = searchParams.get('sort') as Sort | null;
  const urgency = urgencyValue && urgencyValues.has(urgencyValue) ? urgencyValue : 'all';
  const priority = priorityValue && priorityValues.has(priorityValue) ? priorityValue : '';
  const sort = sortValue && sortValues.has(sortValue) ? sortValue : 'attention';
  const [draftQuery, setDraftQuery] = useState(query);
  const [result, setResult] = useState<MyWorkResponse>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setDraftQuery(query), [query]);

  const replaceParam = useCallback(
    (key: string, value: string, defaultValue = '') => {
      const next = new URLSearchParams(searchParams);
      if (!value || value === defaultValue) next.delete(key);
      else next.set(key, value);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (draftQuery !== query) replaceParam('query', draftQuery);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [draftQuery, query, replaceParam]);

  const requestPath = useCallback(
    (offset: number) => {
      const parameters = new URLSearchParams({
        today: localDate(),
        urgency,
        sort,
        limit: '50',
        offset: String(offset),
      });
      if (query) parameters.set('query', query);
      if (priority) parameters.set('priority', priority);
      return `/workspaces/${workspaceId}/my-work?${parameters}`;
    },
    [priority, query, sort, urgency, workspaceId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setResult(await request<MyWorkResponse>(requestPath(0)));
    } catch (cause) {
      setResult(undefined);
      setError(cause instanceof Error ? cause.message : t('myWork.loadError'));
    } finally {
      setLoading(false);
    }
  }, [request, requestPath, t]);

  useEffect(() => void load(), [load]);

  async function loadMore() {
    if (!result?.pageInfo.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await request<MyWorkResponse>(requestPath(result.items.length));
      setResult({ ...next, items: [...result.items, ...next.items] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('myWork.loadError'));
    } finally {
      setLoadingMore(false);
    }
  }

  const filtersActive = Boolean(query || priority || urgency !== 'all' || sort !== 'attention');
  const summaryCards = useMemo<Array<[Urgency, string, number, string]>>(
    () => [
      ['all' as const, t('myWork.open'), result?.summary.total ?? 0, 'bg-sky-400'],
      ['overdue' as const, t('myWork.overdue'), result?.summary.overdue ?? 0, 'bg-rose-400'],
      ['week' as const, t('myWork.dueSoon'), result?.summary.dueSoon ?? 0, 'bg-amber-400'],
      ['blocked' as const, t('myWork.blocked'), result?.summary.blocked ?? 0, 'bg-violet-400'],
    ],
    [result?.summary, t],
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-400">
            {t('myWork.eyebrow')}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('myWork.heading')}</h1>
          <p className="mt-1 text-xs text-slate-500">{t('myWork.description')}</p>
        </div>
      </header>

      <section aria-label={t('myWork.summary')} className="grid gap-2 sm:grid-cols-4">
        {summaryCards.map(([value, label, count, accent]) => (
          <button
            aria-pressed={urgency === value}
            className={`relative overflow-hidden rounded-xl border px-3 py-2.5 text-left ${urgency === value ? 'border-sky-400/50 bg-sky-400/10' : 'border-slate-800 bg-slate-900/45 hover:border-slate-700'}`}
            key={value}
            onClick={() => replaceParam('urgency', value, 'all')}
            type="button"
          >
            <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${accent}`} />
            <span className="block text-[10px] uppercase tracking-wider text-slate-500">
              {label}
            </span>
            <strong className="mt-0.5 block text-xl text-slate-100">
              {loading ? '—' : formatNumber(count)}
            </strong>
          </button>
        ))}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/45">
        <div className="flex flex-wrap gap-2 border-b border-slate-800 p-3">
          <input
            aria-label={t('myWork.search')}
            className="min-h-9 min-w-52 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs outline-none placeholder:text-slate-600 focus:border-sky-400"
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder={t('myWork.searchPlaceholder')}
            type="search"
            value={draftQuery}
          />
          <select
            aria-label={t('myWork.urgency')}
            className={selectClass}
            onChange={(event) => replaceParam('urgency', event.target.value, 'all')}
            value={urgency}
          >
            {(['all', 'overdue', 'today', 'week', 'blocked', 'no_due'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`myWork.urgency.${value}`)}
              </option>
            ))}
          </select>
          <select
            aria-label={t('tasks.filterPriority')}
            className={selectClass}
            onChange={(event) => replaceParam('priority', event.target.value)}
            value={priority}
          >
            <option value="">{t('tasks.allPriorities')}</option>
            {(['critical', 'high', 'medium', 'low'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`tasks.${value}`)}
              </option>
            ))}
          </select>
          <select
            aria-label={t('myWork.sort')}
            className={selectClass}
            onChange={(event) => replaceParam('sort', event.target.value, 'attention')}
            value={sort}
          >
            {(['attention', 'dueDate', 'priority', 'updated'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`myWork.sort.${value}`)}
              </option>
            ))}
          </select>
          {filtersActive && (
            <Button
              onClick={() => setSearchParams({}, { replace: true })}
              type="button"
              variant="quiet"
            >
              {t('myWork.clearFilters')}
            </Button>
          )}
        </div>

        {error && (
          <div className="p-6 text-center">
            <p aria-live="polite" className="text-sm text-rose-300">
              {error}
            </p>
            <Button className="mt-3" onClick={() => void load()} type="button" variant="quiet">
              {t('common.retry')}
            </Button>
          </div>
        )}
        {!error && !loading && result?.items.length === 0 && (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-300">{t('myWork.empty')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('myWork.emptyBody')}</p>
          </div>
        )}
        {!error && result && result.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse text-left text-xs">
              <thead className="bg-slate-950/45 text-[10px] uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('tasks.title')}</th>
                  <th className="px-3 py-2 font-medium">{t('common.project')}</th>
                  <th className="px-3 py-2 font-medium">{t('tasks.status')}</th>
                  <th className="px-3 py-2 font-medium">{t('tasks.priority')}</th>
                  <th className="px-3 py-2 font-medium">{t('tasks.dueDate')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {result.items.map((item) => (
                  <tr className="hover:bg-slate-800/35" key={item.id}>
                    <td className="max-w-lg px-3 py-2.5">
                      <Link
                        className="group block"
                        to={`/workspaces/${workspaceId}/projects/${item.project.publicId}/tasks?task=${item.taskKey}`}
                      >
                        <span className="font-mono text-[10px] text-sky-400 group-hover:underline">
                          {item.taskKey}
                        </span>
                        <strong className="ml-2 font-medium text-slate-200">{item.title}</strong>
                        {(item.parentTaskKey || item.openBlockerCount > 0) && (
                          <span className="mt-0.5 block text-[10px] text-slate-600">
                            {item.parentTaskKey
                              ? t('myWork.subtaskOf', { key: item.parentTaskKey })
                              : ''}
                            {item.parentTaskKey && item.openBlockerCount ? ' · ' : ''}
                            {item.openBlockerCount
                              ? t('myWork.blockerCount', {
                                  count: formatNumber(item.openBlockerCount),
                                })
                              : ''}
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-slate-400">{item.project.name}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-slate-400">
                        <span
                          className="size-1.5 rounded-full"
                          style={{ backgroundColor: item.status.color }}
                        />
                        {item.status.name}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-400">{t(`tasks.${item.priority}`)}</td>
                    <td
                      className={`px-3 py-2.5 ${item.dueDate && item.dueDate < localDate() ? 'text-rose-300' : 'text-slate-400'}`}
                    >
                      {item.dueDate
                        ? formatDate(`${item.dueDate}T00:00:00`, { month: 'short', day: 'numeric' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {loading && <p className="p-8 text-center text-xs text-slate-500">{t('common.loading')}</p>}
        {!loading && !error && result?.pageInfo.hasMore && (
          <div className="border-t border-slate-800 p-3 text-center">
            <Button
              disabled={loadingMore}
              onClick={() => void loadMore()}
              type="button"
              variant="quiet"
            >
              {loadingMore ? t('common.loading') : t('myWork.loadMore')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

const selectClass =
  'min-h-9 rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs text-slate-300 outline-none focus:border-sky-400';

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
