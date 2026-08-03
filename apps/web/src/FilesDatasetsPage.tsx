import { Button } from '@engrove/ui';
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Link, useParams } from 'react-router';
import { allowed, api, ErrorText, inputClass, type User } from './App.js';
import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuModel,
  menuFromKeyboard,
  menuFromPointer,
} from './ContextMenu.js';

interface FileObject {
  id: string;
  file_series_id: string;
  series_name: string;
  version_number: number;
  original_name: string;
  content_type: string;
  size_bytes: number;
  checksum: string;
  status: string;
  archived_at: string | null;
}

interface Dataset {
  id: string;
  name: string;
  dataset_type: 'tabular' | 'xy';
  status: 'pending' | 'processing' | 'ready' | 'failed';
  source_file_id: string | null;
  source_dataset_id: string | null;
  row_count: number | null;
  failure_code: string | null;
  archived_at: string | null;
  schema: { columns?: Array<{ id: string; name: string; dataType: string; unit?: string }> };
}

async function sha256(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export function FilesDatasetsPage({ user }: { user: User }) {
  const { workspaceId, projectId } = useParams();
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [files, setFiles] = useState<FileObject[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [sourceDatasetId, setSourceDatasetId] = useState('');
  const [preview, setPreview] = useState<unknown>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuModel>();
  const refresh = useCallback(async () => {
    try {
      const [fileResult, datasetResult] = await Promise.all([
        api<{ items: FileObject[] }>(`${base}/files?includeArchived=true`),
        api<{ items: Dataset[] }>(`${base}/datasets?includeArchived=true`),
      ]);
      setFiles(fileResult.items);
      setDatasets(datasetResult.items);
      setMessage('');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Resources could not be loaded.');
    }
  }, [base]);
  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    const interval = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const tabular = useMemo(
    () =>
      datasets.filter(
        (dataset) => dataset.dataset_type === 'tabular' && dataset.status === 'ready',
      ),
    [datasets],
  );
  const source = tabular.find((dataset) => dataset.id === sourceDatasetId) ?? tabular[0];

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selected = form.get('file');
    if (!(selected instanceof File) || selected.size === 0) return;
    setBusy(true);
    try {
      const contents = await selected.arrayBuffer();
      const issued = await api<{
        uploadId: string;
        uploadUrl: string;
        headers: Record<string, string>;
      }>(`${base}/file-upload-sessions`, {
        method: 'POST',
        body: JSON.stringify({
          seriesId: String(form.get('seriesId') ?? '') || undefined,
          seriesName: String(form.get('seriesName') ?? selected.name),
          originalName: selected.name,
          contentType: selected.type || 'application/octet-stream',
          sizeBytes: selected.size,
          checksum: await sha256(contents),
        }),
      });
      const stored = await fetch(issued.uploadUrl, {
        method: 'PUT',
        headers: issued.headers,
        body: contents,
      });
      if (!stored.ok) throw new Error('Object storage rejected the upload.');
      await api(`${base}/file-upload-sessions/${issued.uploadId}/complete`, { method: 'POST' });
      event.currentTarget.reset();
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function createTabular(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate(() =>
      api(`${base}/datasets`, {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          sourceFileId: form.get('fileId'),
          datasetType: 'tabular',
          parameters: { delimiter: form.get('delimiter') },
        }),
      }),
    );
  }

  async function createXy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate(() =>
      api(`${base}/datasets`, {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          sourceDatasetId: source?.id,
          datasetType: 'xy',
          parameters: {
            xColumnId: form.get('xColumnId'),
            yColumnId: form.get('yColumnId'),
            xDimension: form.get('xDimension'),
            xUnit: form.get('xUnit'),
            yDimension: form.get('yDimension'),
            yUnit: form.get('yUnit'),
          },
        }),
      }),
    );
  }

  async function mutate(operation: () => Promise<unknown>) {
    setBusy(true);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Operation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function copyResourceValue(label: string, value: string) {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard is unavailable.');
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied.`);
    } catch {
      setMessage('Clipboard access was denied by the browser.');
    }
  }

  function downloadFile(file: FileObject) {
    return mutate(async () => {
      const result = await api<{ url: string }>(`${base}/files/${file.id}/download`);
      window.location.assign(result.url);
    });
  }

  function changeFileLifecycle(file: FileObject) {
    return mutate(() =>
      api(`${base}/files/${file.id}/${file.archived_at ? 'restore' : 'archive'}`, {
        method: file.archived_at ? 'POST' : 'PATCH',
        ...(file.archived_at
          ? {}
          : { body: JSON.stringify({ reason: 'Archived from file library' }) }),
      }),
    );
  }

  function changeDatasetLifecycle(dataset: Dataset) {
    return mutate(() =>
      api(`${base}/datasets/${dataset.id}/${dataset.archived_at ? 'restore' : 'archive'}`, {
        method: dataset.archived_at ? 'POST' : 'PATCH',
        ...(dataset.archived_at
          ? {}
          : { body: JSON.stringify({ reason: 'Archived from dataset library' }) }),
      }),
    );
  }

  function fileContextItems(file: FileObject): ContextMenuItem[] {
    return [
      { label: 'Download file', icon: '↓', onSelect: () => void downloadFile(file) },
      {
        label: 'Copy file name',
        icon: '⧉',
        separatorBefore: true,
        onSelect: () => void copyResourceValue('File name', file.original_name),
      },
      {
        label: 'Copy file ID',
        icon: '#',
        onSelect: () => void copyResourceValue('File ID', file.id),
      },
      {
        label: 'Copy SHA-256',
        icon: '◇',
        onSelect: () => void copyResourceValue('SHA-256', file.checksum),
      },
      ...(allowed(user, file.archived_at ? 'file.restore' : 'file.archive')
        ? [
            {
              label: file.archived_at ? 'Restore file' : 'Archive file',
              icon: file.archived_at ? '↺' : '×',
              tone: file.archived_at ? ('default' as const) : ('danger' as const),
              separatorBefore: true,
              onSelect: () => void changeFileLifecycle(file),
            },
          ]
        : []),
    ];
  }

  function datasetContextItems(dataset: Dataset): ContextMenuItem[] {
    return [
      ...(dataset.status === 'ready'
        ? [
            {
              label: 'Preview dataset',
              icon: '↗',
              onSelect: () =>
                void mutate(async () =>
                  setPreview(await api(`${base}/datasets/${dataset.id}/preview`)),
                ),
            } satisfies ContextMenuItem,
          ]
        : []),
      ...(dataset.status === 'failed' && allowed(user, 'job.retry')
        ? [
            {
              label: 'Retry processing',
              icon: '↺',
              onSelect: () =>
                void mutate(() => api(`${base}/datasets/${dataset.id}/retry`, { method: 'POST' })),
            } satisfies ContextMenuItem,
          ]
        : []),
      {
        label: 'Copy dataset name',
        icon: '⧉',
        separatorBefore: true,
        onSelect: () => void copyResourceValue('Dataset name', dataset.name),
      },
      {
        label: 'Copy dataset ID',
        icon: '#',
        onSelect: () => void copyResourceValue('Dataset ID', dataset.id),
      },
      ...(allowed(user, dataset.archived_at ? 'dataset.restore' : 'dataset.archive')
        ? [
            {
              label: dataset.archived_at ? 'Restore dataset' : 'Archive dataset',
              icon: dataset.archived_at ? '↺' : '×',
              tone: dataset.archived_at ? ('default' as const) : ('danger' as const),
              separatorBefore: true,
              onSelect: () => void changeDatasetLifecycle(dataset),
            },
          ]
        : []),
    ];
  }

  function openResourceMenu(
    event: ReactMouseEvent<HTMLElement>,
    label: string,
    items: ContextMenuItem[],
  ) {
    setContextMenu(menuFromPointer(event, label, items));
  }

  function openResourceMenuFromKeyboard(
    event: ReactKeyboardEvent<HTMLElement>,
    label: string,
    items: ContextMenuItem[],
  ) {
    const menu = menuFromKeyboard(event, label, items);
    if (menu) setContextMenu(menu);
  }

  return (
    <>
      <Link className="text-sm text-slate-400 hover:text-sky-300" to={base}>
        ← Project
      </Link>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
        Files &amp; datasets
      </h1>
      <p className="mt-3 text-slate-400">
        Immutable file versions, processing lineage, and previews. Right-click a resource for quick
        actions.
      </p>
      <ErrorText>{message}</ErrorText>

      {allowed(user, 'file.upload') && (
        <form
          className="mt-8 grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/45 p-5 shadow-xl shadow-slate-950/10 md:grid-cols-4"
          onSubmit={(event) => void upload(event)}
        >
          <input className={inputClass} name="file" type="file" required />
          <input className={inputClass} name="seriesName" placeholder="New series name" />
          <select className={inputClass} name="seriesId" defaultValue="">
            <option value="">Create a new series</option>
            {[...new Map(files.map((file) => [file.file_series_id, file])).values()].map((file) => (
              <option key={file.file_series_id} value={file.file_series_id}>
                {file.series_name}
              </option>
            ))}
          </select>
          <Button disabled={busy} type="submit">
            {busy ? 'Working…' : 'Upload file'}
          </Button>
        </form>
      )}

      <section className="mt-10">
        <h2 className="text-2xl font-semibold">Exact file versions</h2>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/35 shadow-xl shadow-slate-950/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="p-3">Series / file</th>
                <th>Version</th>
                <th>Status</th>
                <th>SHA-256</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr
                  className="border-t border-slate-800"
                  key={file.id}
                  onContextMenu={(event) =>
                    openResourceMenu(event, file.original_name, fileContextItems(file))
                  }
                  onKeyDown={(event) =>
                    openResourceMenuFromKeyboard(event, file.original_name, fileContextItems(file))
                  }
                  tabIndex={0}
                >
                  <td className="p-3">
                    <strong>{file.series_name}</strong>
                    <div className="text-slate-500">
                      {file.original_name} · {file.id}
                    </div>
                  </td>
                  <td>v{file.version_number}</td>
                  <td>{file.archived_at ? 'archived' : file.status}</td>
                  <td className="font-mono text-xs">{file.checksum.slice(0, 12)}…</td>
                  <td className="space-x-2">
                    <button className="text-sky-400" onClick={() => void downloadFile(file)}>
                      Download
                    </button>
                    {allowed(user, file.archived_at ? 'file.restore' : 'file.archive') && (
                      <button
                        className="text-sky-400"
                        onClick={() => void changeFileLifecycle(file)}
                      >
                        {file.archived_at ? 'Restore' : 'Archive'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {allowed(user, 'dataset.upload') && (
        <section className="mt-10 grid gap-6 lg:grid-cols-2">
          <form
            className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-5 shadow-lg shadow-slate-950/10"
            onSubmit={(event) => void createTabular(event)}
          >
            <h2 className="text-xl font-semibold">Parse CSV</h2>
            <input className={inputClass} name="name" placeholder="Dataset name" required />
            <select className={inputClass} name="fileId" required>
              <option value="">Select available file…</option>
              {files
                .filter((file) => file.status === 'available' && !file.archived_at)
                .map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.series_name} v{file.version_number} · {file.original_name}
                  </option>
                ))}
            </select>
            <input
              className={inputClass}
              name="delimiter"
              defaultValue=","
              maxLength={1}
              required
            />
            <Button disabled={busy} type="submit">
              Create tabular dataset
            </Button>
          </form>
          <form
            className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-5 shadow-lg shadow-slate-950/10"
            onSubmit={(event) => void createXy(event)}
          >
            <h2 className="text-xl font-semibold">Derive XY</h2>
            <input className={inputClass} name="name" placeholder="XY dataset name" required />
            <select
              className={inputClass}
              value={source?.id ?? ''}
              onChange={(event) => setSourceDatasetId(event.target.value)}
              required
            >
              <option value="">Select tabular dataset…</option>
              {tabular.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select className={inputClass} name="xColumnId" required>
                {source?.schema.columns?.map((column) => (
                  <option key={column.id} value={column.id}>
                    X · {column.name}
                  </option>
                ))}
              </select>
              <select className={inputClass} name="yColumnId" required>
                {source?.schema.columns?.map((column) => (
                  <option key={column.id} value={column.id}>
                    Y · {column.name}
                  </option>
                ))}
              </select>
              <input
                className={inputClass}
                name="xDimension"
                placeholder="X dimension (e.g. time)"
                required
              />
              <input className={inputClass} name="xUnit" placeholder="X unit (e.g. s)" required />
              <input
                className={inputClass}
                name="yDimension"
                placeholder="Y dimension (e.g. force)"
                required
              />
              <input className={inputClass} name="yUnit" placeholder="Y unit (e.g. N)" required />
            </div>
            <Button disabled={busy || !source} type="submit">
              Create XY dataset
            </Button>
          </form>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-2xl font-semibold">Datasets</h2>
        <div className="mt-4 grid gap-3">
          {datasets.map((dataset) => (
            <article
              className="rounded-2xl border border-slate-800 bg-slate-900/55 p-5 shadow-lg shadow-slate-950/10 transition hover:border-slate-700"
              key={dataset.id}
              onContextMenu={(event) =>
                openResourceMenu(event, dataset.name, datasetContextItems(dataset))
              }
              onKeyDown={(event) =>
                openResourceMenuFromKeyboard(event, dataset.name, datasetContextItems(dataset))
              }
              tabIndex={0}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <strong>{dataset.name}</strong>
                  <p className="text-sm text-slate-500">
                    {dataset.dataset_type} · {dataset.id}
                  </p>
                  <p className="text-sm text-slate-400">
                    {dataset.status}
                    {dataset.row_count !== null ? ` · ${dataset.row_count} rows` : ''}
                    {dataset.failure_code ? ` · ${dataset.failure_code}` : ''}
                  </p>
                </div>
                <div className="space-x-3">
                  {dataset.status === 'ready' && (
                    <button
                      className="text-sky-400"
                      onClick={() =>
                        void mutate(async () =>
                          setPreview(await api(`${base}/datasets/${dataset.id}/preview`)),
                        )
                      }
                    >
                      Preview
                    </button>
                  )}
                  {dataset.status === 'failed' && allowed(user, 'job.retry') && (
                    <button
                      className="text-sky-400"
                      onClick={() =>
                        void mutate(() =>
                          api(`${base}/datasets/${dataset.id}/retry`, { method: 'POST' }),
                        )
                      }
                    >
                      Retry
                    </button>
                  )}
                  {allowed(user, dataset.archived_at ? 'dataset.restore' : 'dataset.archive') && (
                    <button
                      className="text-sky-400"
                      onClick={() => void changeDatasetLifecycle(dataset)}
                    >
                      {dataset.archived_at ? 'Restore' : 'Archive'}
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Lineage:{' '}
                {dataset.source_dataset_id
                  ? `dataset ${dataset.source_dataset_id}`
                  : `file ${dataset.source_file_id}`}
              </p>
            </article>
          ))}
        </div>
      </section>
      {preview !== undefined && (
        <pre className="mt-6 max-h-96 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-300">
          {JSON.stringify(preview, null, 2)}
        </pre>
      )}
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(undefined)} />
    </>
  );
}
