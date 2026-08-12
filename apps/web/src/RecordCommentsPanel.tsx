import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { allowed, api, ErrorText, inputClass, type User } from './App.js';
import { IconAction } from './IconAction.js';
import { useI18n } from './i18n.js';
import { ReviewMentionPicker } from './ReviewParticipantPicker.js';

interface RecordComment {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  mentionedUserIds: string[];
  mentionedUsers: Array<{ id: string; displayName: string }>;
  rowVersion: number;
  editedAt: string | null;
  createdAt: string;
}

interface CommentPage {
  items: RecordComment[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
}

export function RecordCommentsPanel({
  base,
  objectTypeId,
  recordId,
  user,
  archived = false,
  compact = false,
}: {
  base: string;
  objectTypeId: string;
  recordId: string;
  user: User;
  archived?: boolean;
  compact?: boolean;
}) {
  const { formatDate, t } = useI18n();
  const endpoint = `${base}/object-types/${objectTypeId}/records/${recordId}/comments`;
  const [comments, setComments] = useState<RecordComment[]>([]);
  const [pageInfo, setPageInfo] = useState<CommentPage['pageInfo']>({
    limit: 50,
    offset: 0,
    total: 0,
    hasNext: false,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingBody, setEditingBody] = useState('');
  const [editingMentions, setEditingMentions] = useState<
    Array<{ id: string; displayName: string }>
  >([]);
  const highlightedCommentId = new URLSearchParams(window.location.search).get('comment');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<CommentPage>(`${endpoint}?limit=50&offset=0`);
      setComments(result.items);
      setPageInfo(result.pageInfo);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('data.commentsLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [endpoint, t]);

  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (!highlightedCommentId || !comments.some((comment) => comment.id === highlightedCommentId))
      return;
    const element = document.getElementById(`record-comment-${highlightedCommentId}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [comments, highlightedCommentId]);

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get('body') ?? '').trim();
    const mentionedUserIds = new FormData(form).getAll('mentionedUserIds').map(String);
    if (!body) return;
    setBusy('new');
    try {
      const created = await api<RecordComment>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ body, mentionedUserIds }),
      });
      setComments((current) => [created, ...current]);
      setPageInfo((current) => ({ ...current, total: current.total + 1 }));
      form.reset();
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('data.commentSaveFailed'));
    } finally {
      setBusy('');
    }
  }

  async function saveComment(comment: RecordComment) {
    const body = editingBody.trim();
    const mentionedUserIds = editingMentions.map((mention) => mention.id);
    const mentionsChanged =
      mentionedUserIds.length !== comment.mentionedUserIds.length ||
      mentionedUserIds.some((id) => !comment.mentionedUserIds.includes(id));
    if (!body || (body === comment.body && !mentionsChanged)) return;
    setBusy(comment.id);
    try {
      const updated = await api<RecordComment>(`${endpoint}/${comment.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ body, mentionedUserIds, rowVersion: comment.rowVersion }),
      });
      setComments((current) =>
        current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      setEditingId('');
      setEditingBody('');
      setEditingMentions([]);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('data.commentSaveFailed'));
    } finally {
      setBusy('');
    }
  }

  async function loadMore() {
    if (!pageInfo.hasNext || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await api<CommentPage>(`${endpoint}?limit=50&offset=${comments.length}`);
      setComments((current) => {
        const known = new Set(current.map((comment) => comment.id));
        return [...current, ...result.items.filter((comment) => !known.has(comment.id))];
      });
      setPageInfo(result.pageInfo);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('data.commentsLoadFailed'));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section
      aria-label={t('data.comments')}
      className={
        compact ? '' : 'mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6'
      }
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className={compact ? 'text-sm font-semibold' : 'text-xl font-semibold'}>
          {t('data.comments')}
        </h2>
        <span className="text-xs text-slate-500">
          {t('data.commentCount', { count: pageInfo.total })}
        </span>
      </div>

      {!archived && allowed(user, 'record.comment') && (
        <form className="mt-3 space-y-2" onSubmit={(event) => void addComment(event)}>
          <div className="flex items-end gap-2">
            <textarea
              aria-label={t('data.commentBody')}
              className={`${inputClass} min-h-20 flex-1 resize-y`}
              maxLength={10_000}
              name="body"
              placeholder={t('data.commentPlaceholder')}
              required
            />
            <IconAction
              className="mb-1 size-9"
              disabled={busy === 'new'}
              icon={busy === 'new' ? '…' : '↑'}
              label={t('data.postComment')}
              tone="accent"
              type="submit"
            />
          </div>
          <ReviewMentionPicker base={base} disabled={busy === 'new'} userId={user.id} />
        </form>
      )}
      {archived && (
        <p className="mt-3 text-xs text-slate-500">{t('data.archivedCommentsReadOnly')}</p>
      )}

      <ol className="mt-4 divide-y divide-slate-800 border-y border-slate-800">
        {comments.map((comment) => (
          <li
            className={`rounded-lg py-3 transition ${comment.id === highlightedCommentId ? 'bg-sky-400/10 px-3 ring-1 ring-inset ring-sky-400/40' : ''}`}
            id={`record-comment-${comment.id}`}
            key={comment.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <strong className="text-xs font-medium text-slate-300">{comment.authorName}</strong>
                <time className="ml-2 text-[10px] text-slate-600">
                  {formatDate(comment.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
                  {comment.editedAt ? ` · ${t('data.commentEdited')}` : ''}
                </time>
              </div>
              {!archived && comment.authorId === user.id && editingId !== comment.id && (
                <IconAction
                  icon="✎"
                  label={t('data.editComment')}
                  onClick={() => {
                    setEditingId(comment.id);
                    setEditingBody(comment.body);
                    setEditingMentions(comment.mentionedUsers);
                  }}
                />
              )}
            </div>
            {editingId === comment.id ? (
              <div className="mt-2">
                <textarea
                  aria-label={t('data.editComment')}
                  className={`${inputClass} min-h-20 resize-y`}
                  maxLength={10_000}
                  onChange={(event) => setEditingBody(event.target.value)}
                  value={editingBody}
                />
                <div className="mt-2">
                  <ReviewMentionPicker
                    base={base}
                    disabled={busy === comment.id}
                    initialParticipants={comment.mentionedUsers}
                    key={comment.id}
                    onSelectionChange={setEditingMentions}
                    userId={user.id}
                  />
                </div>
                <div className="mt-2 flex justify-end gap-1">
                  <IconAction
                    icon="×"
                    label={t('common.cancel')}
                    onClick={() => {
                      setEditingId('');
                      setEditingBody('');
                      setEditingMentions([]);
                    }}
                  />
                  <IconAction
                    disabled={busy === comment.id || !editingBody.trim()}
                    icon={busy === comment.id ? '…' : '✓'}
                    label={t('common.save')}
                    onClick={() => void saveComment(comment)}
                    tone="success"
                  />
                </div>
              </div>
            ) : (
              <>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                  {comment.body}
                </p>
                {comment.mentionedUsers.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1" aria-label={t('data.commentMentions')}>
                    {comment.mentionedUsers.map((mention) => (
                      <span
                        className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-300"
                        key={mention.id}
                      >
                        @{mention.displayName}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </li>
        ))}
        {!comments.length && !loading && !error && (
          <li className="py-6 text-center text-sm text-slate-500">{t('data.noComments')}</li>
        )}
        {loading && !comments.length && (
          <li className="py-6 text-center text-sm text-slate-500">{t('common.loading')}</li>
        )}
      </ol>
      {pageInfo.hasNext && (
        <button
          className="mt-2 min-h-8 w-full rounded-md text-xs text-slate-400 hover:bg-slate-800"
          disabled={loadingMore}
          onClick={() => void loadMore()}
          type="button"
        >
          {loadingMore
            ? t('common.loading')
            : t('data.loadMoreComments', { shown: comments.length, total: pageInfo.total })}
        </button>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
