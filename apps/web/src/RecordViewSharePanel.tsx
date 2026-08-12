import { Button } from '@engrove/ui';
import { useEffect, useState } from 'react';
import { api, inputClass } from './App.js';
import { useActionDialog } from './ActionDialogProvider.js';
import { FormField } from './FormFieldLabel.js';
import { IconAction } from './IconAction.js';
import { useI18n } from './i18n.js';

interface ManagedShare {
  id: string;
  recordViewId: string;
  tokenPrefix: string;
  passwordProtected: boolean;
  allowDownload: boolean;
  expiresAt: string | null;
  rowVersion: number;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function localDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function expiresAt(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function RecordViewSharePanel({
  base,
  objectTypeId,
  onClose,
  viewId,
  viewName,
  viewType = 'grid',
}: {
  base: string;
  objectTypeId: string;
  onClose(): void;
  viewId: string;
  viewName: string;
  viewType?: 'grid' | 'form' | 'gallery' | 'kanban' | 'calendar';
}) {
  const { t } = useI18n();
  const { confirmAction } = useActionDialog();
  const endpoint = `${base}/object-types/${objectTypeId}/views/${viewId}/share`;
  const [share, setShare] = useState<ManagedShare | null>();
  const [issuedUrl, setIssuedUrl] = useState('');
  const [password, setPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);
  const [allowDownload, setAllowDownload] = useState(false);
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const isForm = viewType === 'form';

  useEffect(() => {
    const controller = new AbortController();
    void api<{ share: ManagedShare | null }>(endpoint, { signal: controller.signal })
      .then(({ share: next }) => {
        setShare(next);
        setAllowDownload(next?.allowDownload ?? false);
        setExpiry(localDateTime(next?.expiresAt ?? null));
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : t('data.shareLoadFailed'));
      });
    return () => controller.abort();
  }, [endpoint, t]);

  async function enableOrRotate() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const created = await api<ManagedShare & { url: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          ...(password.trim() ? { password: password.trim() } : {}),
          allowDownload: isForm ? false : allowDownload,
          expiresAt: expiresAt(expiry),
        }),
      });
      const { url, ...next } = created;
      setShare(next);
      setIssuedUrl(url);
      setPassword('');
      setRemovePassword(false);
      setMessage(t(share ? 'data.shareRotated' : 'data.shareEnabled'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('data.shareSaveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    if (!share) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next = await api<ManagedShare>(endpoint, {
        method: 'PATCH',
        body: JSON.stringify({
          rowVersion: share.rowVersion,
          ...(removePassword
            ? { password: null }
            : password.trim()
              ? { password: password.trim() }
              : {}),
          allowDownload: isForm ? false : allowDownload,
          expiresAt: expiresAt(expiry),
        }),
      });
      setShare(next);
      setPassword('');
      setRemovePassword(false);
      setMessage(t('data.shareSettingsSaved'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('data.shareSaveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!share || !(await confirmAction(t('data.shareRevokeConfirm'), { tone: 'danger' }))) return;
    setBusy(true);
    setError('');
    try {
      await api(endpoint + '/revoke', {
        method: 'POST',
        body: JSON.stringify({ rowVersion: share.rowVersion }),
      });
      setShare(null);
      setIssuedUrl('');
      setPassword('');
      setAllowDownload(false);
      setExpiry('');
      setMessage(t('data.shareRevoked'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('data.shareRevokeFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function copyIssuedUrl() {
    try {
      await navigator.clipboard.writeText(issuedUrl);
      setMessage(t('data.shareCopied'));
    } catch {
      setError(t('data.shareCopyFailed'));
    }
  }

  return (
    <section
      aria-label={t('data.shareViewTitle', { name: viewName })}
      className="mt-2 rounded-xl border border-sky-800/40 bg-slate-900/80 p-3 shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-100">{t('data.shareView')}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {t(isForm ? 'data.shareFormHint' : 'data.shareViewHint')}
          </p>
        </div>
        <IconAction icon="×" label={t('common.close')} onClick={onClose} tooltipAlign="end" />
      </div>

      {share === undefined ? (
        <p className="mt-3 text-xs text-slate-500">{t('common.loading')}</p>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="space-y-3">
            <FormField label={t('data.sharePassword')}>
              <input
                autoComplete="new-password"
                className={inputClass}
                disabled={removePassword}
                maxLength={200}
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={
                  share?.passwordProtected
                    ? t('data.sharePasswordKeep')
                    : t('data.sharePasswordOptional')
                }
                type="password"
                value={password}
              />
            </FormField>
            {share?.passwordProtected && (
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  checked={removePassword}
                  className="size-4 accent-sky-500"
                  onChange={(event) => setRemovePassword(event.target.checked)}
                  type="checkbox"
                />
                {t('data.shareRemovePassword')}
              </label>
            )}
          </div>

          <div className="space-y-3">
            <FormField label={t('data.shareExpiry')}>
              <input
                className={inputClass}
                min={localDateTime(new Date(Date.now() + 60_000).toISOString())}
                onChange={(event) => setExpiry(event.target.value)}
                type="datetime-local"
                value={expiry}
              />
            </FormField>
            {!isForm && (
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  checked={allowDownload}
                  className="size-4 accent-sky-500"
                  onChange={(event) => setAllowDownload(event.target.checked)}
                  type="checkbox"
                />
                {t('data.shareAllowDownload')}
              </label>
            )}
          </div>

          <div className="flex min-w-40 flex-col items-stretch gap-2">
            {share ? (
              <>
                <Button disabled={busy} onClick={() => void saveSettings()} variant="quiet">
                  {t('data.shareSaveSettings')}
                </Button>
                <Button disabled={busy} onClick={() => void enableOrRotate()} variant="quiet">
                  {t('data.shareRotate')}
                </Button>
                <Button
                  className="border-rose-900/60 text-rose-300 hover:bg-rose-500/10"
                  disabled={busy}
                  onClick={() => void revoke()}
                  variant="quiet"
                >
                  {t('data.shareRevoke')}
                </Button>
              </>
            ) : (
              <Button disabled={busy} onClick={() => void enableOrRotate()}>
                {t('data.shareEnable')}
              </Button>
            )}
          </div>
        </div>
      )}

      {share && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-800 pt-2 text-[10px] text-slate-500">
          <span>{t('data.shareTokenPrefix', { prefix: share.tokenPrefix })}</span>
          <span>
            {t(isForm ? 'data.shareFormAccessCount' : 'data.shareAccessCount', {
              count: share.accessCount,
            })}
          </span>
          <span>
            {share.lastAccessedAt
              ? t('data.shareLastAccessed', {
                  date: new Date(share.lastAccessedAt).toLocaleString(),
                })
              : t('data.shareNeverAccessed')}
          </span>
        </div>
      )}

      {issuedUrl && (
        <div className="mt-3 flex gap-2 rounded-lg border border-emerald-800/40 bg-emerald-500/5 p-2">
          <input
            aria-label={t('data.shareIssuedUrl')}
            className="min-w-0 flex-1 bg-transparent font-mono text-xs text-emerald-200 outline-none"
            readOnly
            value={issuedUrl}
          />
          <IconAction
            icon="⧉"
            label={t('data.shareCopyAction')}
            onClick={() => void copyIssuedUrl()}
          />
        </div>
      )}
      {share && !issuedUrl && (
        <p className="mt-2 text-[10px] text-amber-300/80">{t('data.shareOneTimeHint')}</p>
      )}
      {message && <p className="mt-2 text-xs text-emerald-300">{message}</p>}
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </section>
  );
}
