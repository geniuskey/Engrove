import { Button } from '@engrove/ui';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { allowed, api, ErrorText, inputClass, NoticeText, type User } from './App.js';
import { FormFieldLabel } from './FormFieldLabel.js';
import { IconAction } from './IconAction.js';
import { useI18n } from './i18n.js';
import type { RecordReviewThread } from './DataPageTypes.js';
import { ReviewMentionPicker, ReviewParticipantPicker } from './ReviewParticipantPicker.js';

const statusStyles: Record<RecordReviewThread['reviewStatus'], string> = {
  discussion: 'border-slate-700 bg-slate-800/70 text-slate-300',
  requested: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  changes_requested: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
};

interface ReviewPageInfo {
  limit: number;
  offset: number;
  total: number;
  hasNext: boolean;
}

export function RecordReviewsPanel({
  base,
  objectTypeId,
  recordId,
  user,
}: {
  base: string;
  objectTypeId: string;
  recordId: string;
  user: User;
}) {
  const { t, formatDate } = useI18n();
  const [threads, setThreads] = useState<RecordReviewThread[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [messageLoading, setMessageLoading] = useState('');
  const [pageInfo, setPageInfo] = useState<ReviewPageInfo>({
    limit: 20,
    offset: 0,
    total: 0,
    hasNext: false,
  });
  const [summary, setSummary] = useState({ open: 0, resolved: 0 });
  const loadRequestId = useRef(0);

  const endpoint = `${base}/object-types/${objectTypeId}/records/${recordId}/reviews`;
  const load = useCallback(
    async (offset = 0, append = false) => {
      const requestId = ++loadRequestId.current;
      if (append) setLoadingMore(true);
      try {
        const reviewResult = await api<{
          items: RecordReviewThread[];
          pageInfo: ReviewPageInfo;
          summary: { open: number; resolved: number };
        }>(`${endpoint}?includeResolved=${showResolved}&limit=20&offset=${offset}`);
        if (requestId !== loadRequestId.current) return;
        setThreads((current) =>
          append
            ? [
                ...current,
                ...reviewResult.items.filter(
                  (thread) => !current.some((loaded) => loaded.id === thread.id),
                ),
              ]
            : reviewResult.items,
        );
        setPageInfo(reviewResult.pageInfo);
        setSummary(reviewResult.summary);
        setError('');
      } catch (cause) {
        if (requestId !== loadRequestId.current) return;
        setError(cause instanceof Error ? cause.message : t('reviews.loadFailed'));
      } finally {
        if (append && requestId === loadRequestId.current) setLoadingMore(false);
      }
    },
    [endpoint, showResolved, t],
  );

  useEffect(() => {
    void load();
    return () => {
      loadRequestId.current += 1;
    };
  }, [load]);

  const elevatedReviewer = ['owner', 'admin', 'engineer'].includes(user.role);
  const canResolveThread = (thread: RecordReviewThread) =>
    allowed(user, 'review.resolve') &&
    (elevatedReviewer || thread.createdBy === user.id || thread.reviewerId === user.id);
  const canDecideThread = (thread: RecordReviewThread) =>
    allowed(user, 'review.resolve') && (elevatedReviewer || thread.reviewerId === user.id);

  async function createThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      setBusy(true);
      await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          subject: data.get('subject'),
          body: data.get('body'),
          reviewerId: data.get('reviewerId') || null,
          mentionedUserIds: data.getAll('mentionedUserIds').map(String),
        }),
      });
      form.reset();
      setNotice(t('reviews.created'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('reviews.operationFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function submitThreadAction(
    form: HTMLFormElement,
    thread: RecordReviewThread,
    action: 'reply' | 'approved' | 'changes_requested',
  ) {
    const data = new FormData(form);
    const body = String(data.get('body') ?? '').trim();
    if (!body) return;
    try {
      setBusy(true);
      await api(`${base}/reviews/${thread.id}/${action === 'reply' ? 'replies' : 'decision'}`, {
        method: 'POST',
        body: JSON.stringify(
          action === 'reply'
            ? {
                body,
                mentionedUserIds: data.getAll('mentionedUserIds').map(String),
              }
            : { body, decision: action },
        ),
      });
      setNotice(action === 'reply' ? t('reviews.replied') : t(`reviews.${action}`));
      form.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('reviews.operationFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function resolve(thread: RecordReviewThread) {
    try {
      setBusy(true);
      await api(`${base}/reviews/${thread.id}/resolve`, { method: 'PATCH' });
      setNotice(t('reviews.resolved'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('reviews.operationFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function loadOlderMessages(thread: RecordReviewThread) {
    if (messageLoading) return;
    setMessageLoading(thread.id);
    try {
      const result = await api<{
        items: RecordReviewThread['messages'];
        pageInfo: ReviewPageInfo;
      }>(`${base}/reviews/${thread.id}/messages?limit=20&offset=${thread.messages.length}`);
      setThreads((current) =>
        current.map((candidate) => {
          if (candidate.id !== thread.id) return candidate;
          const known = new Set(candidate.messages.map((message) => message.id));
          return {
            ...candidate,
            messages: [
              ...result.items.filter((message) => !known.has(message.id)),
              ...candidate.messages,
            ],
            messagePageInfo: result.pageInfo,
          };
        }),
      );
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('reviews.loadFailed'));
    } finally {
      setMessageLoading('');
    }
  }

  const statusLabel = (status: RecordReviewThread['reviewStatus']) => t(`reviews.status.${status}`);

  return (
    <section
      className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/35 p-5 sm:p-6"
      id="reviews"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-400">
            {t('reviews.eyebrow')}
          </p>
          <h2 className="mt-1 text-xl font-semibold">{t('reviews.heading')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('reviews.description')}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            checked={showResolved}
            onChange={(event) => {
              loadRequestId.current += 1;
              setThreads([]);
              setShowResolved(event.target.checked);
            }}
            type="checkbox"
          />
          {t('reviews.showResolved')}
        </label>
      </div>
      <div className="mt-4 flex gap-2 text-xs">
        <span className="rounded-full border border-sky-500/25 bg-sky-500/10 px-2.5 py-1 text-sky-200">
          {t('reviews.openCount', { count: summary.open })}
        </span>
        <span className="rounded-full border border-slate-700 px-2.5 py-1 text-slate-400">
          {t('reviews.resolvedCount', { count: summary.resolved })}
        </span>
      </div>
      <ErrorText>{error}</ErrorText>
      <NoticeText tone="success">{notice}</NoticeText>

      {allowed(user, 'review.create') && (
        <form
          className="mt-5 grid gap-3 rounded-xl border border-slate-800 bg-slate-900/35 p-4"
          onSubmit={(event) => void createThread(event)}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-300">
              <FormFieldLabel required>{t('reviews.subject')}</FormFieldLabel>
              <input
                aria-label={t('reviews.subject')}
                className={inputClass}
                maxLength={240}
                name="subject"
                required
              />
            </label>
            <div className="text-sm text-slate-300">
              <FormFieldLabel>{t('reviews.reviewer')}</FormFieldLabel>
              <ReviewParticipantPicker
                ariaLabel={t('reviews.reviewer')}
                base={base}
                className={inputClass}
                disabled={busy}
                name="reviewerId"
                reviewerOnly
                specialOptions={[{ value: '', label: t('reviews.discussionOnly') }]}
              />
            </div>
          </div>
          <label className="text-sm text-slate-300">
            <FormFieldLabel required>{t('reviews.message')}</FormFieldLabel>
            <textarea
              aria-label={t('reviews.message')}
              className={`${inputClass} min-h-24 resize-y`}
              name="body"
              required
            />
          </label>
          <div className="text-sm text-slate-300">
            <FormFieldLabel>{t('reviews.notify')}</FormFieldLabel>
            <ReviewMentionPicker base={base} disabled={busy} userId={user.id} />
            <span className="mt-1 block text-xs text-slate-600">{t('reviews.notifyHint')}</span>
          </div>
          <div className="flex justify-end">
            <Button disabled={busy} type="submit">
              {t('reviews.start')}
            </Button>
          </div>
        </form>
      )}

      <div className="mt-5 space-y-4">
        {threads.map((thread) => (
          <article className="overflow-hidden rounded-xl border border-slate-800" key={thread.id}>
            <header className="flex items-start justify-between gap-3 bg-slate-900/55 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-slate-100">{thread.subject}</h3>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusStyles[thread.reviewStatus]}`}
                  >
                    {statusLabel(thread.reviewStatus)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {thread.creatorName}
                  {thread.reviewerName
                    ? ` · ${t('reviews.assignedTo', { name: thread.reviewerName })}`
                    : ''}
                </p>
              </div>
              {thread.status === 'open' && canResolveThread(thread) && (
                <IconAction
                  disabled={busy}
                  icon="✓"
                  label={t('reviews.resolve')}
                  onClick={() => void resolve(thread)}
                  tone="success"
                />
              )}
            </header>
            {thread.messagePageInfo?.hasNext && (
              <div className="border-t border-slate-800 bg-slate-950/25 px-4 py-2 text-center">
                <Button
                  disabled={messageLoading === thread.id}
                  onClick={() => void loadOlderMessages(thread)}
                  type="button"
                  variant="quiet"
                >
                  {messageLoading === thread.id
                    ? t('common.loading')
                    : t('reviews.loadOlderMessages', {
                        shown: thread.messages.length,
                        total: thread.messagePageInfo.total,
                      })}
                </Button>
              </div>
            )}
            <ol className="divide-y divide-slate-800">
              {thread.messages.map((messageItem) => (
                <li className="px-4 py-3" key={messageItem.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <strong className="text-xs font-medium text-slate-300">
                      {messageItem.authorName}
                    </strong>
                    <time className="text-[10px] text-slate-600">
                      {formatDate(messageItem.createdAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </time>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                    {messageItem.body}
                  </p>
                  {messageItem.mentionedUserIds.length > 0 && (
                    <p className="mt-2 text-[10px] text-sky-400">
                      {(messageItem.mentionedUsers?.length
                        ? messageItem.mentionedUsers.map((participant) => participant.displayName)
                        : messageItem.mentionedUserIds
                      )
                        .map((name) => `@${name}`)
                        .join(' ')}
                    </p>
                  )}
                </li>
              ))}
            </ol>
            {thread.status === 'open' && allowed(user, 'review.create') && (
              <form
                className="border-t border-slate-800 bg-slate-900/25 p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitThreadAction(event.currentTarget, thread, 'reply');
                }}
              >
                <textarea
                  aria-label={t('reviews.replyOrDecision')}
                  className={`${inputClass} min-h-20 resize-y`}
                  name="body"
                  placeholder={t('reviews.replyPlaceholder')}
                  required
                />
                <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
                  <div className="min-w-52 flex-1 text-xs text-slate-500">
                    {t('reviews.notify')}
                    <div className="mt-1">
                      <ReviewMentionPicker base={base} disabled={busy} userId={user.id} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {thread.reviewStatus === 'requested' && canDecideThread(thread) && (
                      <>
                        <Button
                          disabled={busy}
                          onClick={(event) => {
                            const form = event.currentTarget.form;
                            if (form?.reportValidity())
                              void submitThreadAction(form, thread, 'changes_requested');
                          }}
                          type="button"
                          variant="quiet"
                        >
                          {t('reviews.requestChanges')}
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={(event) => {
                            const form = event.currentTarget.form;
                            if (form?.reportValidity())
                              void submitThreadAction(form, thread, 'approved');
                          }}
                          type="button"
                        >
                          {t('reviews.approve')}
                        </Button>
                      </>
                    )}
                    <Button disabled={busy} type="submit" variant="quiet">
                      {t('reviews.reply')}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </article>
        ))}
        {!threads.length && (
          <div className="rounded-xl border border-dashed border-slate-800 px-4 py-8 text-center">
            <p className="text-sm text-slate-400">{t('reviews.empty')}</p>
            <p className="mt-1 text-xs text-slate-600">{t('reviews.emptyBody')}</p>
          </div>
        )}
        {pageInfo.hasNext && (
          <div className="text-center">
            <Button
              disabled={loadingMore}
              onClick={() => void load(threads.length, true)}
              type="button"
              variant="quiet"
            >
              {loadingMore
                ? t('common.loading')
                : t('reviews.loadMoreThreads', {
                    shown: threads.length,
                    total: pageInfo.total,
                  })}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
