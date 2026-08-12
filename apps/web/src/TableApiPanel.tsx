import { useMemo, useState } from 'react';
import { IconAction } from './IconAction.js';
import { useI18n } from './i18n.js';
import type { FieldDefinition, ObjectType } from './DataPageTypes.js';

type ApiExample = 'schema' | 'query' | 'create' | 'bulkCreate' | 'bulkUpdate' | 'export';
type ApiLanguage = 'curl' | 'javascript' | 'sdk';

const apiOrigin = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export function TableApiPanel({
  fields,
  onClose,
  projectId,
  table,
  workspaceId,
}: {
  fields: FieldDefinition[];
  onClose: () => void;
  projectId: string;
  table: ObjectType;
  workspaceId: string;
}) {
  const { t } = useI18n();
  const [example, setExample] = useState<ApiExample>('query');
  const [language, setLanguage] = useState<ApiLanguage>('curl');
  const [copied, setCopied] = useState('');
  const tableIdentifier = table.publicId ?? table.id;
  const resourcePath = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/object-types/${encodeURIComponent(tableIdentifier)}`;
  const snippet = useMemo(
    () =>
      apiSnippet(example, language, resourcePath, table, fields, {
        workspaceId,
        projectId,
        tableId: tableIdentifier,
      }),
    [example, fields, language, projectId, resourcePath, table, tableIdentifier, workspaceId],
  );
  const requiredFields = fields.filter(
    (field) => field.required && field.defaultValue === undefined && !isReadOnlyField(field),
  );

  async function copy(label: string, value: string) {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard is unavailable.');
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied('error');
    }
  }

  return (
    <section
      aria-labelledby="table-api-title"
      className="mt-3 rounded-xl border border-sky-800/40 bg-slate-900/65 p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-100" id="table-api-title">
              {t('data.apiPanel')}
            </h3>
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
              REST v1
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            {t('data.apiPanelHelp')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <a
            className="rounded-md px-2 py-1 text-xs font-medium text-sky-400 hover:bg-sky-500/10 hover:text-sky-300"
            href={`${apiOrigin}/api/docs#/Programmable%20data`}
            rel="noreferrer"
            target="_blank"
          >
            {t('data.openApiDocs')} ↗
          </a>
          <IconAction icon="×" label={t('data.closeApiPanel')} onClick={onClose} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
        <div className="rounded-lg border border-slate-800 bg-slate-950/55 p-3">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {t('data.apiIdentifiers')}
          </h4>
          <div className="mt-2 grid gap-1.5">
            <IdentifierRow
              label={t('data.workspaceId')}
              onCopy={(value) => void copy(t('data.workspaceId'), value)}
              value={workspaceId}
            />
            <IdentifierRow
              label={t('data.projectId')}
              onCopy={(value) => void copy(t('data.projectId'), value)}
              value={projectId}
            />
            <IdentifierRow
              label={t('data.tableId')}
              onCopy={(value) => void copy(t('data.tableId'), value)}
              value={tableIdentifier}
            />
            <IdentifierRow
              label={t('data.tableKey')}
              onCopy={(value) => void copy(t('data.tableKey'), value)}
              value={table.key}
            />
          </div>
          <div className="mt-3 border-t border-slate-800 pt-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {t('data.apiFields')}
            </h4>
            {fields.length ? (
              <div className="mt-2 flex max-h-28 flex-wrap content-start gap-1 overflow-y-auto">
                {fields.map((field) => (
                  <span
                    className="rounded border border-slate-800 bg-slate-900 px-1.5 py-1 font-mono text-[9px] text-slate-400"
                    key={field.id}
                    title={`${field.name} · ${field.fieldType}`}
                  >
                    {field.key}
                    {field.required ? <span className="ml-0.5 text-rose-300">*</span> : null}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[10px] text-slate-600">{t('data.noApiFields')}</p>
            )}
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/55 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label={t('data.apiExample')}>
              {(['schema', 'query', 'create', 'bulkCreate', 'bulkUpdate', 'export'] as const).map(
                (value) => (
                  <button
                    aria-pressed={example === value}
                    className={`rounded-md px-2 py-1 text-[10px] font-medium ${example === value ? 'bg-sky-500/15 text-sky-300' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-200'}`}
                    key={value}
                    onClick={() => setExample(value)}
                    type="button"
                  >
                    {t(`data.apiExample.${value}`)}
                  </button>
                ),
              )}
            </div>
            <div className="flex gap-1" role="group" aria-label={t('data.apiLanguage')}>
              {(['curl', 'javascript', 'sdk'] as const).map((value) => (
                <button
                  aria-pressed={language === value}
                  className={`rounded-md px-2 py-1 font-mono text-[10px] ${language === value ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-200'}`}
                  key={value}
                  onClick={() => setLanguage(value)}
                  type="button"
                >
                  {value === 'curl' ? 'cURL' : value === 'javascript' ? 'JavaScript' : 'SDK'}
                </button>
              ))}
            </div>
          </div>
          <div className="relative mt-2">
            <pre className="max-h-72 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 pr-10 text-[10px] leading-5 text-slate-300">
              <code>{snippet}</code>
            </pre>
            <div className="absolute right-2 top-2">
              <IconAction
                className="bg-slate-900/90"
                icon="⧉"
                label={t('data.copyApiExample')}
                onClick={() => void copy(t('data.apiExample'), snippet)}
                tooltipAlign="end"
              />
            </div>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            {example === 'create' || example === 'bulkCreate'
              ? t('data.apiCreateHint', { count: requiredFields.length })
              : t('data.apiEnvironmentHint')}
          </p>
          {language === 'sdk' ? (
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
              {t('data.apiSdkHint')}
            </p>
          ) : null}
          <p aria-live="polite" className="mt-1 min-h-4 text-[10px] text-emerald-300">
            {copied === 'error'
              ? t('common.copyDenied')
              : copied
                ? t('common.copied', { label: copied })
                : ''}
          </p>
        </div>
      </div>
    </section>
  );
}

function IdentifierRow({
  label,
  onCopy,
  value,
}: {
  label: string;
  onCopy: (value: string) => void;
  value: string;
}) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2">
      <span className="text-[10px] text-slate-500">{label}</span>
      <code className="truncate text-[10px] text-slate-300" title={value}>
        {value}
      </code>
      <IconAction
        icon="⧉"
        label={t('data.copyIdentifier', { label })}
        onClick={() => onCopy(value)}
      />
    </div>
  );
}

function isReadOnlyField(field: FieldDefinition): boolean {
  return ['formula', 'lookup', 'rollup', 'measurement'].includes(field.fieldType);
}

function createTemplate(table: ObjectType, fields: FieldDefinition[]) {
  const values = Object.fromEntries(
    fields.flatMap((field) => {
      if (isReadOnlyField(field)) return [];
      if (field.defaultValue !== undefined) return [[field.key, field.defaultValue]];
      if (!field.required) return [];
      if (['text', 'long_text'].includes(field.fieldType))
        return [[field.key, `Example ${field.name}`]];
      if (field.fieldType === 'integer') return [[field.key, 1]];
      if (field.fieldType === 'decimal') return [[field.key, '1']];
      if (field.fieldType === 'boolean') return [[field.key, true]];
      if (field.fieldType === 'date') return [[field.key, '2026-08-08']];
      if (field.fieldType === 'datetime') return [[field.key, '2026-08-08T12:00:00Z']];
      if (field.fieldType === 'single_select' && field.config.options?.[0])
        return [[field.key, field.config.options[0].key]];
      if (field.fieldType === 'multi_select') return [[field.key, []]];
      return [];
    }),
  );
  return { displayName: `New ${table.name}`, values };
}

function bulkUpdateTemplate(fields: FieldDefinition[]) {
  const field = fields.find(
    (candidate) =>
      !isReadOnlyField(candidate) &&
      !['relation', 'file', 'dataset', 'spectral_data', 'tabular_data'].includes(
        candidate.fieldType,
      ),
  );
  const value =
    field?.defaultValue ??
    (field?.fieldType === 'boolean'
      ? true
      : field?.fieldType === 'single_select'
        ? field.config.options?.[0]?.key
        : field?.fieldType === 'multi_select'
          ? []
          : field?.fieldType === 'integer'
            ? 1
            : field?.fieldType === 'decimal'
              ? '1'
              : field?.fieldType === 'date'
                ? '2026-08-08'
                : field?.fieldType === 'datetime'
                  ? '2026-08-08T12:00:00Z'
                  : 'Updated value');
  return {
    records: [{ id: '019fbcf9-e020-71da-935a-6a6a728b3795', rowVersion: 1 }],
    changes: [{ fieldKey: field?.key ?? 'status', operation: 'set', value }],
  };
}

function apiSnippet(
  example: ApiExample,
  language: ApiLanguage,
  resourcePath: string,
  table: ObjectType,
  fields: FieldDefinition[],
  reference: { workspaceId: string; projectId: string; tableId: string },
): string {
  const operation =
    example === 'schema'
      ? { method: 'GET', path: `${resourcePath}/fields` }
      : example === 'query'
        ? {
            method: 'POST',
            path: `${resourcePath}/records/query`,
            body: { fields: fields.slice(0, 5).map((field) => field.key), page: 1, pageSize: 50 },
          }
        : example === 'create'
          ? {
              method: 'POST',
              path: `${resourcePath}/records`,
              body: createTemplate(table, fields),
            }
          : example === 'bulkCreate'
            ? {
                method: 'POST',
                path: `${resourcePath}/records/bulk`,
                body: { items: [createTemplate(table, fields)] },
                idempotent: true,
              }
            : example === 'bulkUpdate'
              ? {
                  method: 'PATCH',
                  path: `${resourcePath}/records/bulk/fields`,
                  body: bulkUpdateTemplate(fields),
                }
              : { method: 'GET', path: `${resourcePath}/export.csv` };
  if (language === 'sdk') {
    const setup = `import { EngroveClient } from '@engrove/sdk';

const engrove = new EngroveClient({
  baseUrl: process.env.ENGROVE_API_URL!,
  token: process.env.ENGROVE_API_TOKEN!,
});
const table = engrove.table(${JSON.stringify(reference, null, 2)});`;
    const sdkOperation =
      example === 'schema'
        ? 'const { data: schema } = await table.fields();'
        : example === 'query'
          ? `const { data: page } = await table.query(${JSON.stringify({ fields: fields.slice(0, 5).map((field) => field.key), page: 1, pageSize: 50 }, null, 2)});`
          : example === 'create'
            ? `const { data: record } = await table.create(${JSON.stringify(createTemplate(table, fields), null, 2)});`
            : example === 'bulkCreate'
              ? `const { data: result } = await table.bulkCreate(${JSON.stringify([createTemplate(table, fields)], null, 2)});`
              : example === 'bulkUpdate'
                ? `const { data: records } = await table.bulkUpdateFields(${JSON.stringify(bulkUpdateTemplate(fields), null, 2)});`
                : 'const { data: csv } = await table.exportCsv();';
    return `${setup}\n\n${sdkOperation}`;
  }
  if (language === 'curl') {
    const lines = [
      'curl --fail-with-body \\',
      `  --request ${operation.method} \\`,
      '  --header "Authorization: Bearer $ENGROVE_API_TOKEN" \\',
    ];
    if ('idempotent' in operation) {
      lines.push('  --header "Idempotency-Key: replace-with-a-unique-key" \\');
    }
    if ('body' in operation) {
      lines.push('  --header "Content-Type: application/json" \\');
      lines.push(`  --data '${JSON.stringify(operation.body)}' \\`);
    }
    lines.push(`  "$ENGROVE_API_URL${operation.path}"`);
    return lines.join('\n');
  }
  const init = [
    `  method: '${operation.method}',`,
    `  headers: { Authorization: \`Bearer \${process.env.ENGROVE_API_TOKEN}\`${
      'body' in operation ? ", 'Content-Type': 'application/json'" : ''
    }${'idempotent' in operation ? ", 'Idempotency-Key': crypto.randomUUID()" : ''} },`,
    ...('body' in operation
      ? [`  body: JSON.stringify(${JSON.stringify(operation.body, null, 2)}),`]
      : []),
  ].join('\n');
  return `const response = await fetch(\n  \`\${process.env.ENGROVE_API_URL}${operation.path}\`,\n  {\n${init}\n  },\n);\nif (!response.ok) throw new Error(await response.text());\n${example === 'export' ? 'const csv = await response.text();' : 'const result = await response.json();'}`;
}
