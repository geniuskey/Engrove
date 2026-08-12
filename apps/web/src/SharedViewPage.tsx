import { Button } from '@engrove/ui';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { api, ApiError, inputClass } from './App.js';
import { BrandMark } from './BrandMark.js';
import { FormField } from './FormFieldLabel.js';
import { IconAction } from './IconAction.js';
import { useI18n } from './i18n.js';

type FieldType =
  | 'text'
  | 'long_text'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'single_select'
  | 'multi_select'
  | 'user'
  | 'relation'
  | 'quantity'
  | 'measurement'
  | 'range'
  | 'spectral_data'
  | 'tabular_data'
  | 'formula'
  | 'lookup'
  | 'rollup'
  | 'file'
  | 'dataset';

interface SharedField {
  id: string;
  name: string;
  description: string;
  key: string;
  fieldType: FieldType;
  required: boolean;
  defaultValue?: unknown;
  config: {
    options?: Array<{ key: string; label: string }>;
    allowedUnits?: string[];
  };
}

interface SharedView {
  name: string;
  tableName: string;
  viewType: 'grid' | 'form' | 'gallery' | 'kanban' | 'calendar';
  rowDensity: 'compact' | 'comfortable';
  fields: SharedField[];
  fieldWidths: Record<string, number>;
  groupFieldId: string | null;
  dateFieldId: string | null;
  allowDownload: boolean;
  expiresAt: string | null;
}

interface Metadata {
  requiresPassword: boolean;
  view?: SharedView;
}

interface SharedRecord {
  id: string;
  displayName: string;
  values: Record<string, unknown>;
  updatedAt: string;
}

interface SharedPage {
  items: SharedRecord[];
  page: number;
  pageSize: number;
  total: number;
}

interface TransientFilter {
  id: string;
  fieldId: string;
  operator: string;
  value?: unknown;
}

const operatorTranslation = {
  contains: 'sharedView.operator.contains',
  eq: 'sharedView.operator.eq',
  ne: 'sharedView.operator.ne',
  gt: 'sharedView.operator.gt',
  gte: 'sharedView.operator.gte',
  lt: 'sharedView.operator.lt',
  lte: 'sharedView.operator.lte',
} as const;

function operatorKey(operator: string) {
  return (
    operatorTranslation[operator as keyof typeof operatorTranslation] ?? operatorTranslation.eq
  );
}

const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? '✓' : '—';
  if (Array.isArray(value)) return value.map(displayValue).join(', ') || '—';
  if (typeof value === 'object') {
    const candidate = value as { value?: unknown; unit?: unknown; status?: unknown };
    if (candidate.value !== undefined)
      return [candidate.value, candidate.unit, candidate.status ? `· ${candidate.status}` : '']
        .filter(Boolean)
        .join(' ');
    return JSON.stringify(value);
  }
  return String(value);
}

function filterOperators(field: SharedField | undefined) {
  if (!field) return ['eq'];
  if (['text', 'long_text', 'formula', 'lookup', 'rollup'].includes(field.fieldType))
    return ['contains', 'eq', 'ne'];
  if (['integer', 'decimal', 'date', 'datetime', 'quantity'].includes(field.fieldType))
    return ['eq', 'gte', 'lte', 'gt', 'lt'];
  return ['eq', 'ne'];
}

function filterable(field: SharedField): boolean {
  return [
    'text',
    'long_text',
    'integer',
    'decimal',
    'boolean',
    'date',
    'datetime',
    'single_select',
    'multi_select',
    'quantity',
  ].includes(field.fieldType);
}

function sortable(field: SharedField): boolean {
  return [
    'text',
    'long_text',
    'integer',
    'decimal',
    'boolean',
    'date',
    'datetime',
    'single_select',
    'user',
    'quantity',
  ].includes(field.fieldType);
}

function canonicalFilterValue(field: SharedField, value: string): unknown {
  if (field.fieldType === 'boolean') return value === 'true';
  return value;
}

function FieldValue({ field, record }: { field: SharedField; record: SharedRecord }) {
  const value = record.values[field.key];
  return (
    <span className="block max-w-80 truncate" title={displayValue(value)}>
      {displayValue(value)}
    </span>
  );
}

function formValues(fields: SharedField[], form: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.fieldType === 'multi_select') {
      const selected = form.getAll(`value:${field.key}`).map(String).filter(Boolean);
      if (selected.length) values[field.key] = selected;
      continue;
    }
    if (field.fieldType === 'quantity') {
      const value = String(form.get(`value:${field.key}`) ?? '').trim();
      const unit = String(form.get(`unit:${field.key}`) ?? '').trim();
      if (value) values[field.key] = { value, unit };
      continue;
    }
    if (field.fieldType === 'range') {
      const lower = String(form.get(`lower:${field.key}`) ?? '').trim();
      const upper = String(form.get(`upper:${field.key}`) ?? '').trim();
      const unit = String(form.get(`unit:${field.key}`) ?? '').trim();
      if (lower || upper)
        values[field.key] = { lower: { value: lower, unit }, upper: { value: upper, unit } };
      continue;
    }
    const raw = String(form.get(`value:${field.key}`) ?? '').trim();
    if (!raw) continue;
    values[field.key] = field.fieldType === 'boolean' ? raw === 'true' : raw;
  }
  return values;
}

function PublicForm({
  endpoint,
  fields,
  headers,
  name,
  tableName,
}: {
  endpoint: string;
  fields: SharedField[];
  headers: Record<string, string>;
  name: string;
  tableName: string;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const form = new FormData(event.currentTarget);
      await api(endpoint + '/submit', {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': idempotencyKey },
        body: JSON.stringify({
          displayName: String(form.get('displayName') ?? '').trim(),
          values: formValues(fields, form),
          website: String(form.get('website') ?? ''),
        }),
      });
      setSubmitted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('sharedView.submitFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (submitted)
    return (
      <main className="product-grid grid min-h-screen place-items-center bg-slate-950 p-4 text-slate-200">
        <section className="w-full max-w-lg rounded-2xl border border-emerald-800/40 bg-slate-900/90 p-6 shadow-2xl">
          <BrandMark className="size-10" />
          <p className="mt-5 text-[10px] font-medium uppercase tracking-widest text-emerald-400">
            {tableName}
          </p>
          <h1 className="mt-1 text-xl font-semibold">{t('sharedView.submitted')}</h1>
          <p className="mt-2 text-sm text-slate-400">{t('sharedView.submittedHint')}</p>
          <Button
            className="mt-5"
            onClick={() => {
              setSubmitted(false);
              setIdempotencyKey(crypto.randomUUID());
            }}
          >
            {t('sharedView.submitAnother')}
          </Button>
        </section>
      </main>
    );

  return (
    <main className="product-grid min-h-screen bg-slate-950 px-4 py-6 text-slate-200 sm:px-6">
      <form
        className="mx-auto w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-2xl sm:p-7"
        onSubmit={(event) => void submit(event)}
      >
        <header className="flex items-start gap-3 border-b border-slate-800 pb-4">
          <BrandMark className="mt-0.5 size-9 shrink-0" />
          <div>
            <p className="text-[10px] font-medium uppercase tracking-widest text-sky-400">
              {tableName} · {t('sharedView.form')}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{name}</h1>
            <p className="mt-1 text-xs text-slate-500">{t('sharedView.formHint')}</p>
          </div>
        </header>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-slate-300 sm:col-span-2">
            <span className="flex items-center justify-between gap-2">
              <span>{t('sharedView.recordName')}</span>
              <span className="text-[10px] uppercase text-sky-400">{t('common.required')}</span>
            </span>
            <input className={inputClass} maxLength={500} name="displayName" required />
          </label>
          {fields.map((field) => (
            <label
              className={`block text-sm text-slate-300 ${field.fieldType === 'long_text' ? 'sm:col-span-2' : ''}`}
              key={field.id}
            >
              <span className="flex items-center justify-between gap-2">
                <span>{field.name}</span>
                <span className="text-[10px] uppercase text-slate-500">
                  {t(field.required ? 'common.required' : 'common.optional')}
                </span>
              </span>
              {field.fieldType === 'long_text' ? (
                <textarea
                  className={inputClass}
                  defaultValue={String(field.defaultValue ?? '')}
                  name={`value:${field.key}`}
                  required={field.required}
                  rows={4}
                />
              ) : field.fieldType === 'single_select' ? (
                <select
                  className={inputClass}
                  defaultValue={String(field.defaultValue ?? '')}
                  name={`value:${field.key}`}
                  required={field.required}
                >
                  <option value="">—</option>
                  {(field.config.options ?? []).map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : field.fieldType === 'multi_select' ? (
                <select
                  className={`${inputClass} min-h-24`}
                  defaultValue={
                    Array.isArray(field.defaultValue) ? field.defaultValue.map(String) : []
                  }
                  multiple
                  name={`value:${field.key}`}
                  required={field.required}
                >
                  {(field.config.options ?? []).map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : field.fieldType === 'boolean' ? (
                <select
                  className={inputClass}
                  defaultValue={field.defaultValue === undefined ? '' : String(field.defaultValue)}
                  name={`value:${field.key}`}
                  required={field.required}
                >
                  <option value="">—</option>
                  <option value="true">{t('common.yes')}</option>
                  <option value="false">{t('common.no')}</option>
                </select>
              ) : field.fieldType === 'quantity' || field.fieldType === 'range' ? (
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <input
                    className={inputClass}
                    name={`${field.fieldType === 'range' ? 'lower' : 'value'}:${field.key}`}
                    placeholder={
                      field.fieldType === 'range' ? t('data.lowerBound') : t('data.decimalValue')
                    }
                    required={field.required}
                  />
                  {field.fieldType === 'range' && (
                    <input
                      className={inputClass}
                      name={`upper:${field.key}`}
                      placeholder={t('data.upperBound')}
                      required={field.required}
                    />
                  )}
                  <select className={inputClass} name={`unit:${field.key}`}>
                    {(field.config.allowedUnits ?? []).map((unit) => (
                      <option key={unit}>{unit}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <input
                  className={inputClass}
                  defaultValue={String(field.defaultValue ?? '')}
                  inputMode={
                    field.fieldType === 'integer' || field.fieldType === 'decimal'
                      ? 'decimal'
                      : undefined
                  }
                  name={`value:${field.key}`}
                  required={field.required}
                  type={
                    field.fieldType === 'date'
                      ? 'date'
                      : field.fieldType === 'datetime'
                        ? 'datetime-local'
                        : 'text'
                  }
                />
              )}
              {field.description && (
                <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                  {field.description}
                </span>
              )}
            </label>
          ))}
          <input
            aria-hidden="true"
            autoComplete="off"
            className="hidden"
            name="website"
            tabIndex={-1}
          />
        </div>
        {error && <p className="mt-4 text-xs text-rose-300">{error}</p>}
        <Button className="mt-5" disabled={busy} type="submit">
          {busy ? t('sharedView.submitting') : t('sharedView.submit')}
        </Button>
        <p className="mt-3 text-[10px] text-slate-500">{t('sharedView.formPrivacy')}</p>
      </form>
    </main>
  );
}

export function SharedViewPage() {
  const { t } = useI18n();
  const { shareToken = '' } = useParams();
  const endpoint = `/shared-views/${encodeURIComponent(shareToken)}`;
  const [metadata, setMetadata] = useState<Metadata>();
  const [accessToken, setAccessToken] = useState('');
  const [password, setPassword] = useState('');
  const [page, setPage] = useState<SharedPage>();
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(50);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<TransientFilter[]>([]);
  const [sort, setSort] = useState<{ fieldId: string; direction: 'asc' | 'desc' }>();
  const [filterFieldId, setFilterFieldId] = useState('');
  const [filterOperator, setFilterOperator] = useState('contains');
  const [filterValue, setFilterValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState('');

  const headers = useMemo(
    () => (accessToken ? { 'x-engrove-share-access': accessToken } : {}),
    [accessToken],
  );

  const loadMetadata = useCallback(
    async (nextAccessToken = accessToken) => {
      const result = await api<Metadata>(endpoint, {
        headers: nextAccessToken ? { 'x-engrove-share-access': nextAccessToken } : {},
      });
      setMetadata(result);
      setFilterFieldId((current) => current || result.view?.fields.find(filterable)?.id || '');
      return result;
    },
    [accessToken, endpoint],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadMetadata()
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : t('sharedView.loadFailed'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadMetadata, t]);

  useEffect(() => {
    if (!metadata?.view || metadata.view.viewType === 'form') return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      void api<SharedPage>(endpoint + '/query', {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(filters.length
            ? {
                filters: filters.map((filter) => ({
                  fieldId: filter.fieldId,
                  operator: filter.operator,
                  ...(filter.value !== undefined ? { value: filter.value } : {}),
                })),
              }
            : {}),
          ...(sort ? { sorts: [sort] } : {}),
          page: pageNumber,
          pageSize,
        }),
      })
        .then(setPage)
        .catch((cause) => {
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          setError(cause instanceof Error ? cause.message : t('sharedView.queryFailed'));
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [endpoint, filters, headers, metadata?.view, pageNumber, pageSize, search, sort, t]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUnlocking(true);
    setError('');
    try {
      const result = await api<{ accessToken: string }>(endpoint + '/unlock', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      setAccessToken(result.accessToken);
      setPassword('');
      await loadMetadata(result.accessToken);
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === 'SHARED_VIEW_PASSWORD_INVALID'
          ? t('sharedView.passwordInvalid')
          : cause instanceof Error
            ? cause.message
            : t('sharedView.unlockFailed'),
      );
    } finally {
      setUnlocking(false);
    }
  }

  function addFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const field = metadata?.view?.fields.find((candidate) => candidate.id === filterFieldId);
    if (!field || !filterValue.trim()) return;
    setFilters((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        fieldId: field.id,
        operator: filterOperator,
        value: canonicalFilterValue(field, filterValue.trim()),
      },
    ]);
    setFilterValue('');
    setPageNumber(1);
  }

  function toggleSort(field: SharedField) {
    setSort((current) =>
      current?.fieldId === field.id
        ? current.direction === 'asc'
          ? { fieldId: field.id, direction: 'desc' }
          : undefined
        : { fieldId: field.id, direction: 'asc' },
    );
    setPageNumber(1);
  }

  async function downloadCsv() {
    setError('');
    try {
      const response = await fetch(`${apiBase}/api/v1${endpoint}/export.csv`, {
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(t('sharedView.downloadFailed'));
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'engrove-shared-view.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('sharedView.downloadFailed'));
    }
  }

  if (loading && !metadata)
    return (
      <main className="product-grid grid min-h-screen place-items-center bg-slate-950 text-slate-300">
        <p>{t('common.loading')}</p>
      </main>
    );

  if (error && !metadata)
    return (
      <main className="product-grid grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-200">
        <div className="max-w-md rounded-2xl border border-rose-900/50 bg-slate-900 p-6 text-center">
          <BrandMark className="mx-auto size-10" />
          <h1 className="mt-4 text-lg font-semibold">{t('sharedView.unavailable')}</h1>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
        </div>
      </main>
    );

  if (metadata?.requiresPassword && !metadata.view)
    return (
      <main className="product-grid grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-200">
        <form
          className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl"
          onSubmit={(event) => void unlock(event)}
        >
          <BrandMark className="size-10" />
          <h1 className="mt-4 text-xl font-semibold">{t('sharedView.passwordTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('sharedView.passwordHint')}</p>
          <label className="mt-5 block text-xs font-medium text-slate-400">
            {t('data.sharePassword')}
            <input
              autoComplete="current-password"
              autoFocus
              className={`${inputClass} mt-1`}
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <Button className="mt-4 w-full" disabled={unlocking} type="submit">
            {unlocking ? t('sharedView.unlocking') : t('sharedView.unlock')}
          </Button>
          {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
        </form>
      </main>
    );

  const view = metadata?.view;
  if (!view) return null;
  if (view.viewType === 'form')
    return (
      <PublicForm
        endpoint={endpoint}
        fields={view.fields}
        headers={headers}
        name={view.name}
        tableName={view.tableName}
      />
    );
  const filterFields = view.fields.filter(filterable);
  const filterField = filterFields.find((field) => field.id === filterFieldId);
  const selectedOption = filterField?.config.options;
  const totalPages = Math.max(1, Math.ceil((page?.total ?? 0) / pageSize));
  const groupField = view.fields.find((field) => field.id === view.groupFieldId);
  const dateField = view.fields.find((field) => field.id === view.dateFieldId);

  return (
    <main className="product-grid min-h-screen bg-slate-950 px-4 py-6 text-slate-200 sm:px-6">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex min-w-0 items-start gap-3">
            <BrandMark className="mt-0.5 size-9 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-widest text-sky-400">
                {view.tableName} · {t('sharedView.readOnly')}
              </p>
              <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">{view.name}</h1>
              <p className="mt-1 text-xs text-slate-500">{t('sharedView.liveHint')}</p>
            </div>
          </div>
          {view.allowDownload && (
            <IconAction
              className="size-9 border border-slate-800 bg-slate-900"
              icon="↓"
              label={t('sharedView.download')}
              onClick={() => void downloadCsv()}
              tooltipAlign="end"
            />
          )}
        </header>

        <section
          aria-label={t('sharedView.explore')}
          className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 p-2"
        >
          <div className="flex flex-wrap items-end gap-2">
            <FormField className="min-w-56 flex-1" label={t('sharedView.search')}>
              <input
                className={inputClass}
                maxLength={120}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPageNumber(1);
                }}
                type="search"
                value={search}
              />
            </FormField>
            {filterFields.length > 0 && (
              <form className="flex flex-wrap items-end gap-2" onSubmit={addFilter}>
                <FormField label={t('sharedView.filterField')}>
                  <select
                    className={inputClass}
                    onChange={(event) => {
                      const next = view.fields.find((field) => field.id === event.target.value);
                      setFilterFieldId(event.target.value);
                      setFilterOperator(filterOperators(next)[0]!);
                    }}
                    value={filterFieldId}
                  >
                    {filterFields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label={t('sharedView.filterOperator')}>
                  <select
                    className={inputClass}
                    onChange={(event) => setFilterOperator(event.target.value)}
                    value={filterOperator}
                  >
                    {filterOperators(filterField).map((operator) => (
                      <option key={operator} value={operator}>
                        {t(operatorKey(operator))}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label={t('sharedView.filterValue')}>
                  {selectedOption ? (
                    <select
                      className={inputClass}
                      onChange={(event) => setFilterValue(event.target.value)}
                      value={filterValue}
                    >
                      <option value="">—</option>
                      {selectedOption.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : filterField?.fieldType === 'boolean' ? (
                    <select
                      className={inputClass}
                      onChange={(event) => setFilterValue(event.target.value)}
                      value={filterValue}
                    >
                      <option value="">—</option>
                      <option value="true">{t('common.yes')}</option>
                      <option value="false">{t('common.no')}</option>
                    </select>
                  ) : (
                    <input
                      className={inputClass}
                      onChange={(event) => setFilterValue(event.target.value)}
                      value={filterValue}
                    />
                  )}
                </FormField>
                <IconAction icon="+" label={t('sharedView.addFilter')} type="submit" />
              </form>
            )}
            <select
              aria-label={t('data.rowsPerPage')}
              className={inputClass}
              onChange={(event) => {
                setPageSize(Number(event.target.value) as 25 | 50 | 100);
                setPageNumber(1);
              }}
              value={pageSize}
            >
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {t('data.rows', { count: size })}
                </option>
              ))}
            </select>
          </div>
          {filters.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {filters.map((filter) => {
                const field = view.fields.find((candidate) => candidate.id === filter.fieldId);
                return (
                  <button
                    className="rounded-full bg-sky-500/10 px-2 py-1 text-[10px] text-sky-300 hover:bg-rose-500/10 hover:text-rose-300"
                    key={filter.id}
                    onClick={() => {
                      setFilters((current) => current.filter((item) => item.id !== filter.id));
                      setPageNumber(1);
                    }}
                    title={t('sharedView.removeFilter')}
                    type="button"
                  >
                    {field?.name} · {t(operatorKey(filter.operator))} · {displayValue(filter.value)}{' '}
                    ×
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
        {loading && <p className="mt-3 text-xs text-slate-500">{t('common.loading')}</p>}

        {view.viewType === 'grid' && (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70">
            <table className="min-w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-slate-900 text-slate-400">
                <tr>
                  <th className="border-b border-r border-slate-800 px-3 py-2 font-medium">
                    {t('sharedView.recordName')}
                  </th>
                  {view.fields.map((field) => (
                    <th
                      className="border-b border-r border-slate-800 px-3 py-2 font-medium"
                      key={field.id}
                      style={{ minWidth: view.fieldWidths[field.id] ?? 140 }}
                    >
                      <button
                        className="flex w-full items-center justify-between gap-2 hover:text-sky-300"
                        disabled={!sortable(field)}
                        onClick={() => toggleSort(field)}
                        title={sortable(field) ? t('sharedView.sortField') : undefined}
                        type="button"
                      >
                        <span>{field.name}</span>
                        <span className="text-[10px] text-slate-600">
                          {sort?.fieldId === field.id
                            ? sort.direction === 'asc'
                              ? '↑'
                              : '↓'
                            : '↕'}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page?.items.map((record) => (
                  <tr className="hover:bg-slate-900/70" key={record.id}>
                    <th className="border-b border-r border-slate-800 px-3 py-2 font-medium text-slate-200">
                      {record.displayName}
                    </th>
                    {view.fields.map((field) => (
                      <td
                        className="border-b border-r border-slate-800 px-3 py-2 text-slate-400"
                        key={field.id}
                      >
                        <FieldValue field={field} record={record} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {view.viewType === 'gallery' && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {page?.items.map((record) => (
              <article
                className="rounded-xl border border-slate-800 bg-slate-900/65 p-3"
                key={record.id}
              >
                <h2 className="font-medium text-slate-100">{record.displayName}</h2>
                <dl className="mt-3 space-y-2 text-xs">
                  {view.fields.map((field) => (
                    <div key={field.id}>
                      <dt className="text-[10px] uppercase tracking-wide text-slate-600">
                        {field.name}
                      </dt>
                      <dd className="mt-0.5 text-slate-300">
                        <FieldValue field={field} record={record} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        )}

        {view.viewType === 'kanban' && groupField && (
          <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
            {(groupField.config.options ?? []).map((option) => {
              const records = page?.items.filter(
                (record) => record.values[groupField.key] === option.key,
              );
              return (
                <section
                  className="w-72 shrink-0 rounded-xl border border-slate-800 bg-slate-900/55 p-2"
                  key={option.key}
                >
                  <h2 className="px-1 py-1 text-xs font-medium text-slate-300">
                    {option.label} · {records?.length ?? 0}
                  </h2>
                  <div className="mt-1 space-y-2">
                    {records?.map((record) => (
                      <article
                        className="rounded-lg border border-slate-800 bg-slate-950/80 p-3"
                        key={record.id}
                      >
                        <h3 className="text-xs font-medium text-slate-100">{record.displayName}</h3>
                        {view.fields
                          .filter((field) => field.id !== groupField.id)
                          .slice(0, 3)
                          .map((field) => (
                            <div className="mt-1 text-[10px] text-slate-500" key={field.id}>
                              {field.name}: <FieldValue field={field} record={record} />
                            </div>
                          ))}
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {view.viewType === 'calendar' && dateField && (
          <div className="mt-3 space-y-2">
            {[...(page?.items ?? [])]
              .sort((left, right) =>
                String(left.values[dateField.key] ?? '').localeCompare(
                  String(right.values[dateField.key] ?? ''),
                ),
              )
              .map((record) => (
                <article
                  className="flex items-start gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-3"
                  key={record.id}
                >
                  <time className="w-32 shrink-0 font-mono text-xs text-sky-300">
                    {displayValue(record.values[dateField.key])}
                  </time>
                  <div>
                    <h2 className="text-sm font-medium text-slate-100">{record.displayName}</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {view.fields
                        .filter((field) => field.id !== dateField.id)
                        .slice(0, 3)
                        .map((field) => `${field.name}: ${displayValue(record.values[field.key])}`)
                        .join(' · ')}
                    </p>
                  </div>
                </article>
              ))}
          </div>
        )}

        {!loading && page?.items.length === 0 && (
          <p className="mt-8 text-center text-sm text-slate-500">{t('sharedView.noRecords')}</p>
        )}

        <footer className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3 text-xs text-slate-500">
          <span>{t('sharedView.resultCount', { count: page?.total ?? 0 })}</span>
          <div className="flex items-center gap-2">
            <IconAction
              disabled={pageNumber <= 1}
              icon="←"
              label={t('common.previous')}
              onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            />
            <span>
              {pageNumber} / {totalPages}
            </span>
            <IconAction
              disabled={pageNumber >= totalPages}
              icon="→"
              label={t('common.next')}
              onClick={() => setPageNumber((current) => Math.min(totalPages, current + 1))}
            />
          </div>
        </footer>
      </div>
    </main>
  );
}
