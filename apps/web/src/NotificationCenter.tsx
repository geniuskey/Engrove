import { useCallback, useEffect, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router';
import { useI18n } from './i18n.js';

interface NotificationItem {
  id: string;
  type:
    | 'task.assigned'
    | 'task.updated'
    | 'task.status_changed'
    | 'task.commented'
    | 'task.mentioned'
    | 'task.archived'
    | 'task.restored'
    | 'task.due_soon'
    | 'task.overdue'
    | 'record.mentioned';
  actorName: string;
  workspaceId: string;
  projectId: string;
  taskId: string | null;
  taskKey: string | null;
  taskTitle: string | null;
  objectTypeId: string | null;
  recordId: string | null;
  recordTitle: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

interface NotificationPageInfo {
  limit: number;
  offset: number;
  total: number;
  hasNext: boolean;
}

function mergeNotifications(
  incoming: NotificationItem[],
  current: NotificationItem[],
): NotificationItem[] {
  const merged = new Map(incoming.map((item) => [item.id, item]));
  current.forEach((item) => {
    if (!merged.has(item.id)) merged.set(item.id, item);
  });
  return [...merged.values()];
}

type RequestApi = <T>(path: string, init?: RequestInit) => Promise<T>;

function BellIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}

export function NotificationCenter({
  expanded,
  navigate,
  onOpen,
  request,
}: {
  expanded: boolean;
  navigate: NavigateFunction;
  onOpen?: () => void;
  request: RequestApi;
}) {
  const { formatDate, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pageInfo, setPageInfo] = useState<NotificationPageInfo>({
    limit: 30,
    offset: 0,
    total: 0,
    hasNext: false,
  });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (showLoading = false, preserveLoaded = false) => {
      if (showLoading) setLoading(true);
      try {
        const result = await request<{
          items: NotificationItem[];
          unreadCount: number;
          pageInfo: NotificationPageInfo;
        }>('/notifications?limit=30&offset=0');
        setItems((current) =>
          preserveLoaded ? mergeNotifications(result.items, current) : result.items,
        );
        setUnreadCount(result.unreadCount);
        setPageInfo(result.pageInfo);
        setError('');
      } catch {
        if (showLoading) setError(t('notifications.loadFailed'));
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [request, t],
  );

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(false, true);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeEscape);
    };
  }, [open]);

  async function openNotification(item: NotificationItem) {
    if (!item.readAt) {
      try {
        await request(`/notifications/${item.id}/read`, { method: 'POST' });
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, readAt: new Date().toISOString() }
              : candidate,
          ),
        );
        setUnreadCount((current) => Math.max(0, current - 1));
      } catch {
        setError(t('notifications.loadFailed'));
      }
    }
    setOpen(false);
    if (item.type === 'record.mentioned' && item.objectTypeId && item.recordId) {
      const commentId =
        typeof item.payload.commentId === 'string'
          ? `?comment=${encodeURIComponent(item.payload.commentId)}`
          : '';
      navigate(
        `/workspaces/${item.workspaceId}/projects/${item.projectId}/data/${item.objectTypeId}/records/${item.recordId}${commentId}`,
      );
      return;
    }
    if (item.taskId)
      navigate(
        `/workspaces/${item.workspaceId}/projects/${item.projectId}/tasks?task=${item.taskKey ?? item.taskId}`,
      );
  }

  async function markAllRead() {
    try {
      await request('/notifications/read-all', { method: 'POST' });
      const now = new Date().toISOString();
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })));
      setUnreadCount(0);
      setError('');
    } catch {
      setError(t('notifications.loadFailed'));
    }
  }

  async function loadMore() {
    if (loadingMore || items.length >= pageInfo.total) return;
    setLoadingMore(true);
    try {
      const result = await request<{
        items: NotificationItem[];
        unreadCount: number;
        pageInfo: NotificationPageInfo;
      }>(`/notifications?limit=${pageInfo.limit}&offset=${items.length}`);
      setItems((current) => mergeNotifications(current, result.items));
      setUnreadCount(result.unreadCount);
      setPageInfo(result.pageInfo);
      setError('');
    } catch {
      setError(t('notifications.loadFailed'));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-controls="notification-center-popover"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('notifications.headingWithCount', { count: unreadCount })}
        className={
          expanded
            ? 'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            : 'relative grid size-9 w-full place-items-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-sky-300'
        }
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) {
            onOpen?.();
            void load(true, true);
          }
        }}
        title={t('notifications.headingWithCount', { count: unreadCount })}
        type="button"
      >
        <BellIcon />
        {expanded && <span>{t('notifications.heading')}</span>}
        {unreadCount > 0 && (
          <span
            className={`${expanded ? 'ml-auto' : 'absolute right-0 top-0'} min-w-4 rounded-full bg-rose-500 px-1 text-center text-[9px] font-semibold leading-4 text-white`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <section
          aria-labelledby="notification-center-title"
          className={`absolute bottom-0 z-[110] w-80 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl shadow-black/40 ${expanded ? 'left-0' : 'left-full ml-2'}`}
          id="notification-center-popover"
          role="dialog"
        >
          <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2.5">
            <h2 className="text-sm font-semibold" id="notification-center-title">
              {t('notifications.heading')}
            </h2>
            {unreadCount > 0 && (
              <button
                className="rounded px-2 py-1 text-[10px] text-sky-400 hover:bg-slate-800"
                onClick={() => void markAllRead()}
                type="button"
              >
                {t('notifications.markAllRead')}
              </button>
            )}
          </header>
          <div className="max-h-[min(32rem,calc(100vh-6rem))] overflow-y-auto p-2">
            {loading && items.length === 0 && (
              <p className="p-3 text-xs text-slate-500">{t('common.loading')}</p>
            )}
            {error && <p className="p-3 text-xs text-amber-300">{error}</p>}
            {!loading && !error && items.length === 0 && (
              <p className="p-4 text-center text-xs text-slate-500">{t('notifications.empty')}</p>
            )}
            {items.map((item) => (
              <button
                className={`mb-1 flex w-full gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-slate-900 ${item.readAt ? 'text-slate-500' : 'bg-sky-400/5 text-slate-200'}`}
                key={item.id}
                onClick={() => void openNotification(item)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={`mt-1.5 size-1.5 shrink-0 rounded-full ${item.readAt ? 'bg-slate-700' : 'bg-sky-400'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs leading-5">
                    {t(`notifications.${item.type}`, { actor: item.actorName })}
                  </span>
                  <strong className="block truncate text-xs font-medium text-slate-300">
                    {item.recordTitle ?? item.taskTitle ?? t('notifications.unknownTarget')}
                  </strong>
                  <time
                    className="mt-0.5 block text-[10px] text-slate-600"
                    dateTime={item.createdAt}
                  >
                    {formatDate(item.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
                  </time>
                </span>
              </button>
            ))}
            {items.length < pageInfo.total && (
              <button
                className="mt-1 w-full rounded-lg border border-slate-800 px-3 py-2 text-xs font-medium text-sky-400 hover:border-slate-700 hover:bg-slate-900 disabled:cursor-wait disabled:text-slate-600"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                type="button"
              >
                {loadingMore
                  ? t('common.loading')
                  : t('notifications.loadMore', {
                      shown: items.length,
                      total: pageInfo.total,
                    })}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
