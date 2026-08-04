import { type ChangeEvent, useEffect, useId, useRef, useState } from 'react';
import { api } from './App.js';
import { useI18n } from './i18n.js';

const IMAGE_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

interface StoredImage {
  id: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
}

interface ImagePreview {
  url: string;
  expiresIn: number;
  file: StoredImage;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export function isImageField(config: { mediaKind?: 'image' }): boolean {
  return config.mediaKind === 'image';
}

export async function uploadCellImage(
  base: string,
  file: File,
  seriesName: string,
  messages = {
    typesOnly: 'Only PNG, JPEG, WebP, GIF, or AVIF images can be attached.',
    sizeLimit: 'Images must be 25 MB or smaller.',
    uploadRejected: 'The image store rejected the upload.',
  },
): Promise<StoredImage> {
  if (!IMAGE_TYPES.has(file.type)) {
    throw new Error(messages.typesOnly);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(messages.sizeLimit);
  }
  const contents = await file.arrayBuffer();
  const issued = await api<{
    uploadId: string;
    uploadUrl: string;
    headers: Record<string, string>;
  }>(`${base}/file-upload-sessions`, {
    method: 'POST',
    body: JSON.stringify({
      seriesName,
      originalName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      checksum: await sha256(contents),
    }),
  });
  const stored = await fetch(issued.uploadUrl, {
    method: 'PUT',
    headers: issued.headers,
    body: contents,
  });
  if (!stored.ok) throw new Error(messages.uploadRejected);
  const completed = await api<{
    id: string;
    original_name: string;
    content_type: string;
    size_bytes: number;
  }>(`${base}/file-upload-sessions/${issued.uploadId}/complete`, { method: 'POST' });
  return {
    id: completed.id,
    originalName: completed.original_name,
    contentType: completed.content_type,
    sizeBytes: completed.size_bytes,
  };
}

export function ImageGridCell({
  base,
  comfortable = false,
  editable,
  label,
  recordName,
  value,
  onSave,
}: {
  base: string;
  comfortable?: boolean;
  editable: boolean;
  label: string;
  recordName: string;
  value: unknown;
  onSave?: (value: string[]) => Promise<void>;
}) {
  const { t } = useI18n();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const fileId = Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '';
  const [preview, setPreview] = useState<ImagePreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setPreview(undefined);
    setError('');
    if (!fileId) return () => undefined;
    void api<ImagePreview>(`${base}/files/${fileId}/preview`)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : t('data.imagePreviewFailed'));
      });
    return () => {
      active = false;
    };
  }, [base, fileId, t]);

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !onSave) return;
    setBusy(true);
    setError('');
    try {
      const uploaded = await uploadCellImage(base, file, `${label}: ${recordName}`, {
        typesOnly: t('data.imageTypesOnly'),
        sizeLimit: t('data.imageSizeLimit'),
        uploadRejected: t('data.imageUploadRejected'),
      });
      await onSave([uploaded.id]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('data.imageAttachFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function removeImage() {
    if (!onSave) return;
    setBusy(true);
    setError('');
    try {
      await onSave([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('data.imageRemoveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`group/image flex min-w-0 items-center gap-2 px-2 ${comfortable ? 'min-h-14 py-1.5' : 'min-h-10 py-1'}`}
    >
      {fileId ? (
        preview ? (
          <a
            aria-label={t('data.openImage', { record: recordName, label })}
            className="shrink-0 overflow-hidden rounded-md border border-slate-700 bg-slate-900 outline-none focus:ring-2 focus:ring-sky-400"
            href={preview.url}
            rel="noreferrer"
            target="_blank"
            title={preview.file.originalName}
          >
            <img
              alt={`${recordName} — ${label}`}
              className={`${comfortable ? 'size-11' : 'size-8'} object-cover`}
              loading="lazy"
              src={preview.url}
            />
          </a>
        ) : (
          <span
            aria-label={t('data.imageLoading')}
            className={`${comfortable ? 'size-11' : 'size-8'} shrink-0 animate-pulse rounded-md bg-slate-800`}
          />
        )
      ) : (
        <span
          aria-hidden="true"
          className={`${comfortable ? 'size-11' : 'size-8'} grid shrink-0 place-items-center rounded-md border border-dashed border-slate-700 bg-slate-900 text-base text-slate-500`}
        >
          ◫
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[11px] ${error ? 'text-rose-300' : 'text-slate-400'}`}>
          {error ||
            (busy
              ? t('data.uploading')
              : (preview?.file.originalName ??
                (fileId ? `${t('data.imageLoading')}…` : t('data.noImage'))))}
        </p>
        {editable && (
          <div className="mt-0.5 flex items-center gap-2">
            <button
              aria-label={`${recordName} ${label} ${fileId ? t('data.replaceImage') : t('data.attachImage')}`}
              className="text-[10px] font-medium text-sky-400 hover:text-sky-300 disabled:opacity-50"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              type="button"
            >
              {fileId ? t('data.replaceImage') : t('data.attachImage')}
            </button>
            {fileId && (
              <button
                aria-label={`${recordName} ${label} ${t('data.removeImage')}`}
                className="text-[10px] text-slate-500 hover:text-rose-300 disabled:opacity-50"
                disabled={busy}
                onClick={() => void removeImage()}
                type="button"
              >
                {t('data.removeImage')}
              </button>
            )}
          </div>
        )}
      </div>
      {editable && (
        <input
          ref={inputRef}
          accept="image/avif,image/gif,image/jpeg,image/png,image/webp"
          aria-label={t('data.chooseImage', { record: recordName, label })}
          className="sr-only"
          disabled={busy}
          id={inputId}
          type="file"
          onChange={(event) => void chooseImage(event)}
        />
      )}
      {error && (
        <span aria-live="polite" className="sr-only">
          {error}
        </span>
      )}
    </div>
  );
}
