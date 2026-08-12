import { Button } from '@engrove/ui';
import { useState } from 'react';
import { api, inputClass } from './App.js';
import { FormField, FormFieldLabel } from './FormFieldLabel.js';
import { IconAction } from './IconAction.js';
import { useI18n } from './i18n.js';
import type { CsvImportPreview, CsvResult } from './DataPageTypes.js';

type DuplicateStrategy = 'allow' | 'skip' | 'update';

export function CsvImportPanel({
  base,
  objectTypeId,
  onClose,
  onImported,
}: {
  base: string;
  objectTypeId: string;
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<CsvImportPreview>();
  const [mappings, setMappings] = useState<Record<string, string | null>>({});
  const [strategy, setStrategy] = useState<DuplicateStrategy>('allow');
  const [uniqueFieldKey, setUniqueFieldKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CsvResult>();

  const mappedTargets = Object.values(mappings).filter((value): value is string => Boolean(value));
  const mappingConflict = new Set(mappedTargets).size !== mappedTargets.length;
  const hasRecordName = mappedTargets.includes('displayName');
  const uniqueTargets =
    preview?.targetFields.filter(
      (field) => field.unique && field.supported && mappedTargets.includes(field.key),
    ) ?? [];
  const canImport =
    Boolean(preview && csv && hasRecordName) &&
    !mappingConflict &&
    (strategy === 'allow' || Boolean(uniqueFieldKey));

  async function previewFile(file?: File) {
    if (!file?.size) return;
    setBusy(true);
    setError('');
    setResult(undefined);
    try {
      const source = await file.text();
      const next = await api<CsvImportPreview>(
        `${base}/object-types/${objectTypeId}/records/import-csv/preview`,
        { method: 'POST', body: JSON.stringify({ csv: source }) },
      );
      setCsv(source);
      setFileName(file.name);
      setPreview(next);
      setMappings(
        Object.fromEntries(
          next.suggestedMappings.map((mapping) => [mapping.sourceHeader, mapping.targetFieldKey]),
        ),
      );
      setStrategy('allow');
      setUniqueFieldKey('');
    } catch (cause) {
      setPreview(undefined);
      setCsv('');
      setError(cause instanceof Error ? cause.message : t('data.csvPreviewFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function importCsv() {
    if (!preview || !canImport) return;
    setBusy(true);
    setError('');
    try {
      const next = await api<CsvResult>(`${base}/object-types/${objectTypeId}/records/import-csv`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          csv,
          mappings: preview.headers.map((sourceHeader) => ({
            sourceHeader,
            targetFieldKey: mappings[sourceHeader] ?? null,
          })),
          duplicateStrategy: strategy,
          ...(strategy === 'allow' ? {} : { uniqueFieldKey }),
        }),
      });
      setResult(next);
      await onImported();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('data.csvImportFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="data-import-csv-title"
      className="mt-3 ml-auto w-full max-w-4xl rounded-xl border border-sky-800/40 bg-slate-900/65 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200" id="data-import-csv-title">
            {t('data.importReviewTitle')}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {t('data.importReviewHint')}
          </p>
        </div>
        <IconAction icon="×" label={t('common.close')} onClick={onClose} tooltipAlign="end" />
      </div>

      <FormField
        className="mt-3 grid gap-1 text-xs text-slate-400"
        label={t('data.csvFile')}
        required
      >
        <input
          accept=".csv,text/csv"
          className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-xs file:font-medium file:text-slate-200 hover:file:bg-slate-700"
          onChange={(event) => void previewFile(event.currentTarget.files?.[0])}
          type="file"
        />
      </FormField>
      {busy && !preview && <p className="mt-2 text-xs text-sky-300">{t('data.csvPreviewing')}</p>}
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}

      {preview && (
        <div className="mt-4 grid gap-4">
          <p className="text-xs text-slate-300">
            {t('data.csvPreviewSummary', {
              file: fileName,
              rows: preview.totalRows,
              columns: preview.headers.length,
            })}
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full min-w-max text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400">
                <tr>
                  {preview.headers.map((header) => (
                    <th className="px-3 py-2 font-medium" key={header}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {preview.sampleRows.map((row, index) => (
                  <tr key={index}>
                    {preview.headers.map((header) => (
                      <td className="max-w-52 truncate px-3 py-2" key={header}>
                        {row[header]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <FormFieldLabel required>{t('data.csvColumnMapping')}</FormFieldLabel>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {preview.headers.map((header) => (
                <label
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 text-xs"
                  key={header}
                >
                  <span className="truncate text-slate-300" title={header}>
                    {header}
                  </span>
                  <select
                    className={inputClass}
                    onChange={(event) =>
                      setMappings((current) => ({
                        ...current,
                        [header]: event.target.value || null,
                      }))
                    }
                    value={mappings[header] ?? ''}
                  >
                    <option value="">{t('data.csvIgnoreColumn')}</option>
                    {preview.targetFields.map((field) => (
                      <option disabled={!field.supported} key={field.key} value={field.key}>
                        {field.name}
                        {field.required ? ` · ${t('common.required')}` : ''}
                        {field.unique ? ` · ${t('data.unique')}` : ''}
                        {!field.supported ? ` · ${t('data.csvUnsupported')}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {!hasRecordName && (
              <p className="mt-2 text-xs text-amber-300">{t('data.csvRecordNameRequired')}</p>
            )}
            {mappingConflict && (
              <p className="mt-2 text-xs text-amber-300">{t('data.csvMappingConflict')}</p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t('data.csvDuplicateHandling')} required>
              <select
                className={inputClass}
                onChange={(event) => {
                  setStrategy(event.target.value as DuplicateStrategy);
                  setUniqueFieldKey('');
                }}
                value={strategy}
              >
                <option value="allow">{t('data.csvDuplicatesAllow')}</option>
                <option value="skip">{t('data.csvDuplicatesSkip')}</option>
                <option value="update">{t('data.csvDuplicatesUpdate')}</option>
              </select>
            </FormField>
            {strategy !== 'allow' && (
              <FormField label={t('data.csvUniqueMatchField')} required>
                <select
                  className={inputClass}
                  onChange={(event) => setUniqueFieldKey(event.target.value)}
                  value={uniqueFieldKey}
                >
                  <option value="">{t('data.csvChooseUniqueField')}</option>
                  {uniqueTargets.map((field) => (
                    <option key={field.key} value={field.key}>
                      {field.name}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
          </div>
          <p className="text-xs leading-relaxed text-slate-500">{t('data.csvReferenceHint')}</p>
          <div className="flex items-center gap-2">
            <Button disabled={!canImport || busy} onClick={() => void importCsv()} variant="quiet">
              {busy ? t('data.csvImporting') : t('data.csvConfirmImport')}
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3">
          <p className="text-xs text-emerald-200">
            {t('data.csvImportSummary', {
              created: result.created,
              updated: result.updated,
              skipped: result.skipped,
              failed: result.failed,
            })}
          </p>
          {result.errors.map((item) => (
            <p className="mt-1 text-xs text-rose-300" key={`${item.row}:${item.reason}`}>
              {t('data.csvRowError', { row: item.row, reason: item.reason })}
            </p>
          ))}
          {result.errorsTruncated && (
            <p className="mt-1 text-xs text-amber-300">{t('data.csvErrorsTruncated')}</p>
          )}
        </div>
      )}
    </section>
  );
}
