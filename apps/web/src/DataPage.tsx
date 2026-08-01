import { Button } from '@engrove/ui';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { allowed, api, ErrorText, inputClass, type User } from './App.js';

interface ObjectType {
  id: string;
  projectId: string;
  name: string;
  pluralName: string;
  key: string;
  icon: string;
  description: string;
  system: boolean;
}

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
  | 'file'
  | 'dataset';

interface FieldDefinition {
  id: string;
  objectTypeId: string;
  name: string;
  key: string;
  description: string;
  fieldType: FieldType;
  required: boolean;
  unique: boolean;
  position: number;
  config: {
    options?: Array<{ key: string; label: string }>;
    targetObjectTypeId?: string;
    multiple?: boolean;
    dimension?: string;
    canonicalUnit?: string;
    allowedUnits?: string[];
    displayPrecision?: number;
  };
  projectionStatus: 'ready' | 'rebuilding' | 'failed';
}

interface DynamicRecord {
  id: string;
  objectTypeId: string;
  displayName: string;
  values: Record<string, unknown>;
  relations: Record<string, string[]>;
  fileReferences: Record<string, string[]>;
  datasetReferences: Record<string, string[]>;
  measurements?: Record<
    string,
    { resultId: string | null; value: string | null; unit: string | null; status: string | null }
  >;
  rowVersion: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface QueryResult {
  items: DynamicRecord[];
  page: number;
  pageSize: number;
  total: number;
}

interface CsvResult {
  imported: number;
  failed: number;
  errors: Array<{ row: number; field?: string; reason: string }>;
  idempotentReplay: boolean;
}

interface MeasurementResult {
  id: string;
  field_id: string;
  canonical_value: string;
  canonical_unit: string;
  original_value: string;
  original_unit: string;
  measured_at: string;
  supersedes_result_id: string | null;
  current: boolean;
}

interface Specification {
  id: string;
  name: string;
  measurement_field_id: string;
  status: 'active' | 'archived';
  revisions: Array<{
    id: string;
    revision_number: number;
    lower_limit: string | null;
    upper_limit: string | null;
    warning_lower_limit: string | null;
    warning_upper_limit: string | null;
    canonical_unit: string;
  }>;
}

interface SpecificationEvaluation {
  id: string;
  measurement_field_id: string;
  measurement_result_id: string | null;
  status: 'pass' | 'warning' | 'fail' | 'missing';
  reason_code: string;
  evaluated_at: string;
}

interface LinkedTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  archived_at: string | null;
}

const fieldTypes: FieldType[] = [
  'text',
  'long_text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'single_select',
  'multi_select',
  'user',
  'relation',
  'quantity',
  'measurement',
  'range',
];

function projectPath(workspaceId: string, projectId: string): string {
  return `/workspaces/${workspaceId}/projects/${projectId}`;
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    const engineering = value as {
      value?: string;
      unit?: string;
      lower?: { value: string; unit: string };
      upper?: { value: string; unit: string };
    };
    if (engineering.value && engineering.unit) return `${engineering.value} ${engineering.unit}`;
    if (engineering.lower || engineering.upper)
      return `${engineering.lower ? `${engineering.lower.value} ${engineering.lower.unit}` : '−∞'} … ${engineering.upper ? `${engineering.upper.value} ${engineering.upper.unit}` : '+∞'}`;
    return JSON.stringify(value);
  }
  return String(value);
}

function fieldValue(field: FieldDefinition, form: FormData): unknown {
  const raw = String(form.get(`value:${field.key}`) ?? '').trim();
  if (!raw) return undefined;
  if (field.fieldType === 'quantity')
    return { value: raw, unit: String(form.get(`unit:${field.key}`) ?? '') };
  if (field.fieldType === 'range') {
    const upper = String(form.get(`upper:${field.key}`) ?? '').trim();
    const unit = String(form.get(`unit:${field.key}`) ?? '');
    return {
      lower: raw ? { value: raw, unit } : undefined,
      upper: upper ? { value: upper, unit } : undefined,
    };
  }
  if (field.fieldType === 'boolean') return raw === 'true';
  if (field.fieldType === 'multi_select')
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  return raw;
}

function recordPayload(fields: FieldDefinition[], form: FormData) {
  const values: Record<string, unknown> = {};
  const relations: Record<string, string[]> = {};
  const fileReferences: Record<string, string[]> = {};
  const datasetReferences: Record<string, string[]> = {};
  for (const field of fields) {
    if (field.fieldType === 'measurement') continue;
    if (field.fieldType === 'relation') {
      const targets = String(form.get(`relation:${field.id}`) ?? '')
        .split(';')
        .map((value) => value.trim())
        .filter(Boolean);
      if (targets.length) relations[field.id] = targets;
      continue;
    }
    if (field.fieldType === 'file' || field.fieldType === 'dataset') {
      const reference = String(form.get(`reference:${field.id}`) ?? '').trim();
      if (reference)
        (field.fieldType === 'file' ? fileReferences : datasetReferences)[field.id] = [reference];
      continue;
    }
    const value = fieldValue(field, form);
    if (value !== undefined) values[field.key] = value;
  }
  return {
    displayName: String(form.get('displayName') ?? '').trim(),
    values,
    relations,
    fileReferences,
    datasetReferences,
  };
}

function FieldInput({ field, value }: { field: FieldDefinition; value?: unknown }) {
  if (field.fieldType === 'measurement')
    return (
      <p className="mt-2 text-xs text-slate-500">Observations are appended from record detail.</p>
    );
  if (field.fieldType === 'quantity' || field.fieldType === 'range') {
    const quantity = (value ?? {}) as {
      value?: string;
      unit?: string;
      lower?: { value: string; unit: string };
      upper?: { value: string; unit: string };
    };
    const unit =
      quantity.unit ??
      quantity.lower?.unit ??
      quantity.upper?.unit ??
      field.config.allowedUnits?.[0] ??
      '';
    return (
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          className={inputClass}
          defaultValue={field.fieldType === 'quantity' ? quantity.value : quantity.lower?.value}
          name={`value:${field.key}`}
          placeholder={field.fieldType === 'range' ? 'Lower bound' : 'Decimal value'}
          required={field.required}
        />
        {field.fieldType === 'range' && (
          <input
            className={inputClass}
            defaultValue={quantity.upper?.value}
            name={`upper:${field.key}`}
            placeholder="Upper bound"
          />
        )}
        <select className={inputClass} defaultValue={unit} name={`unit:${field.key}`}>
          {(field.config.allowedUnits ?? []).map((candidate) => (
            <option key={candidate}>{candidate}</option>
          ))}
        </select>
      </div>
    );
  }
  if (field.fieldType === 'single_select') {
    return (
      <select
        className={inputClass}
        defaultValue={value === undefined ? '' : String(value)}
        name={`value:${field.key}`}
        required={field.required}
      >
        <option value="">Select…</option>
        {(field.config.options ?? []).map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.fieldType === 'boolean') {
    return (
      <select
        className={inputClass}
        defaultValue={value === undefined ? '' : String(value)}
        name={`value:${field.key}`}
        required={field.required}
      >
        <option value="">Unset</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (field.fieldType === 'long_text') {
    return (
      <textarea
        className={inputClass}
        defaultValue={value === undefined ? '' : String(value)}
        name={`value:${field.key}`}
        required={field.required}
        rows={3}
      />
    );
  }
  if (field.fieldType === 'relation') return null;
  const type =
    field.fieldType === 'date'
      ? 'date'
      : field.fieldType === 'datetime'
        ? 'datetime-local'
        : 'text';
  const formatted =
    field.fieldType === 'datetime' && typeof value === 'string'
      ? value.slice(0, 16)
      : displayValue(value) === '—'
        ? ''
        : displayValue(value);
  return (
    <input
      className={inputClass}
      defaultValue={formatted}
      name={`value:${field.key}`}
      required={field.required}
      type={type}
      inputMode={
        field.fieldType === 'integer' || field.fieldType === 'decimal' ? 'decimal' : undefined
      }
    />
  );
}

function RecordForm({
  fields,
  record,
  onSubmit,
  submitLabel,
}: {
  fields: FieldDefinition[];
  record?: DynamicRecord;
  onSubmit: (form: FormData) => Promise<void>;
  submitLabel: string;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSubmit(new FormData(event.currentTarget));
      setError('');
      if (!record) event.currentTarget.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Record could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void submit(event)}>
      <label className="block text-sm text-slate-300 md:col-span-2">
        Display name
        <input
          className={inputClass}
          defaultValue={record?.displayName ?? ''}
          name="displayName"
          required
        />
      </label>
      {fields.map((field) => (
        <label className="block text-sm text-slate-300" key={field.id}>
          <span className="flex items-center justify-between gap-2">
            <span>
              {field.name} {field.required && <span className="text-rose-300">*</span>}
            </span>
            <span className="font-mono text-[10px] uppercase text-slate-500">
              {field.fieldType}
            </span>
          </span>
          {field.fieldType === 'relation' ? (
            <input
              className={inputClass}
              defaultValue={(record?.relations[field.id] ?? []).join(';')}
              name={`relation:${field.id}`}
              placeholder="Record UUID; another UUID"
              required={field.required}
            />
          ) : field.fieldType === 'file' || field.fieldType === 'dataset' ? (
            <input
              className={inputClass}
              defaultValue={
                (field.fieldType === 'file'
                  ? record?.fileReferences[field.id]
                  : record?.datasetReferences[field.id])?.[0] ?? ''
              }
              name={`reference:${field.id}`}
              placeholder={`Exact ${field.fieldType} UUID`}
              required={field.required}
            />
          ) : (
            <FieldInput field={field} value={record?.values[field.key]} />
          )}
        </label>
      ))}
      <div className="md:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  );
}

function SpecificationsPanel({
  base,
  fields,
  user,
}: {
  base: string;
  fields: FieldDefinition[];
  user: User;
}) {
  const measurementFields = fields.filter((field) => field.fieldType === 'measurement');
  const [specifications, setSpecifications] = useState<Specification[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!measurementFields.length) {
      setSpecifications([]);
      return;
    }
    try {
      const result = await api<{ items: Specification[] }>(
        `${base}/specifications?includeArchived=true`,
      );
      setSpecifications(result.items);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Specifications could not be loaded.');
    }
  }, [base, measurementFields.length]);
  useEffect(() => void load(), [load]);
  if (!measurementFields.length) return null;
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api(`${base}/specifications`, {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          measurementFieldId: data.get('measurementFieldId'),
          limits: {
            lowerLimit: String(data.get('lowerLimit') || '') || null,
            upperLimit: String(data.get('upperLimit') || '') || null,
            warningLowerLimit: String(data.get('warningLowerLimit') || '') || null,
            warningUpperLimit: String(data.get('warningUpperLimit') || '') || null,
          },
          changeNote: 'Created from project data',
        }),
      });
      form.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Specification could not be created.');
    }
  }
  return (
    <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <h3 className="text-lg font-semibold">Measurement specifications</h3>
      <div className="mt-4 grid gap-3">
        {specifications.map((spec) => {
          const revision = spec.revisions[0];
          return (
            <div className="rounded-xl border border-slate-800 p-4" key={spec.id}>
              <div className="flex justify-between">
                <span>{spec.name}</span>
                <span className="text-xs uppercase text-slate-500">
                  {spec.status} · r{revision?.revision_number}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {revision?.lower_limit ?? '−∞'} … {revision?.upper_limit ?? '+∞'}{' '}
                {revision?.canonical_unit}
              </p>
            </div>
          );
        })}
      </div>
      {allowed(user, 'specification.manage') && (
        <form className="mt-5 grid gap-2 md:grid-cols-3" onSubmit={(event) => void create(event)}>
          <input className={inputClass} name="name" placeholder="Specification name" required />
          <select className={inputClass} name="measurementFieldId">
            {measurementFields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.name}
              </option>
            ))}
          </select>
          <input className={inputClass} name="lowerLimit" placeholder="Hard lower" />
          <input className={inputClass} name="warningLowerLimit" placeholder="Warning lower" />
          <input className={inputClass} name="warningUpperLimit" placeholder="Warning upper" />
          <input className={inputClass} name="upperLimit" placeholder="Hard upper" />
          <Button type="submit">Create specification</Button>
        </form>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

function MeasurementsPanel({
  base,
  recordId,
  fields,
  user,
}: {
  base: string;
  recordId: string;
  fields: FieldDefinition[];
  user: User;
}) {
  const measurementFields = fields.filter((field) => field.fieldType === 'measurement');
  const [results, setResults] = useState<MeasurementResult[]>([]);
  const [evaluations, setEvaluations] = useState<SpecificationEvaluation[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!measurementFields.length) return;
    try {
      const [histories, evaluationResult] = await Promise.all([
        Promise.all(
          measurementFields.map((field) =>
            api<{ items: MeasurementResult[] }>(
              `${base}/records/${recordId}/measurement-results?fieldId=${field.id}`,
            ),
          ),
        ),
        api<{ items: SpecificationEvaluation[] }>(
          `${base}/specification-evaluations?recordId=${recordId}`,
        ),
      ]);
      setResults(histories.flatMap((history) => history.items));
      setEvaluations(evaluationResult.items);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Measurements could not be loaded.');
    }
  }, [base, recordId, measurementFields.length]);
  useEffect(() => void load(), [load]);
  if (!measurementFields.length) return null;
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api(`${base}/measurement-results`, {
        method: 'POST',
        body: JSON.stringify({
          recordId,
          fieldId: data.get('fieldId'),
          value: data.get('value'),
          unit: data.get('unit'),
          measuredAt: new Date(String(data.get('measuredAt'))).toISOString(),
          uncertaintyValue: String(data.get('uncertaintyValue') || '') || undefined,
          uncertaintyUnit: String(data.get('uncertaintyUnit') || '') || undefined,
          supersedesResultId: String(data.get('supersedesResultId') || '') || undefined,
          correctionReason: String(data.get('correctionReason') || '') || undefined,
        }),
      });
      form.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Measurement could not be recorded.');
    }
  }
  async function createTask(evaluationId: string) {
    try {
      await api(`${base}/specification-evaluations/${evaluationId}/task`, { method: 'POST' });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Follow-up task could not be created.');
    }
  }
  return (
    <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <h2 className="text-xl font-semibold">Measurement history</h2>
      <div className="mt-4 grid gap-3">
        {results.map((result) => {
          const field = measurementFields.find((candidate) => candidate.id === result.field_id);
          const evaluation = evaluations.find(
            (candidate) => candidate.measurement_result_id === result.id,
          );
          return (
            <div
              className="flex flex-wrap items-center justify-between rounded-xl border border-slate-800 p-4"
              key={result.id}
            >
              <div>
                <p>
                  {field?.name}: {result.original_value} {result.original_unit}
                </p>
                <p className="text-xs text-slate-500">
                  canonical {result.canonical_value} {result.canonical_unit} ·{' '}
                  {new Date(result.measured_at).toLocaleString()}
                  {result.supersedes_result_id ? ' · correction' : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs uppercase ${evaluation?.status === 'fail' ? 'bg-rose-500/20 text-rose-300' : evaluation?.status === 'warning' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}`}
                >
                  {evaluation?.status ?? 'pending'}
                  {result.current ? ' · current' : ''}
                </span>
                {evaluation?.status === 'fail' && allowed(user, 'task.create') && (
                  <button
                    className="text-xs text-sky-400"
                    onClick={() => void createTask(evaluation.id)}
                  >
                    Create task
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {results.length === 0 && <p className="text-sm text-slate-400">No observations yet.</p>}
      </div>
      {allowed(user, 'measurement.create') && (
        <form className="mt-5 grid gap-2 md:grid-cols-3" onSubmit={(event) => void create(event)}>
          <select
            className={inputClass}
            name="fieldId"
            onChange={(event) => {
              const field = measurementFields.find(
                (candidate) => candidate.id === event.target.value,
              );
              const unit = event.currentTarget.form?.elements.namedItem(
                'unit',
              ) as HTMLSelectElement | null;
              if (unit && field)
                unit.innerHTML = (field.config.allowedUnits ?? [])
                  .map((value) => `<option>${value}</option>`)
                  .join('');
            }}
          >
            {measurementFields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.name}
              </option>
            ))}
          </select>
          <input className={inputClass} name="value" placeholder="Decimal value" required />
          <select className={inputClass} name="unit">
            {(measurementFields[0]?.config.allowedUnits ?? []).map((unit) => (
              <option key={unit}>{unit}</option>
            ))}
          </select>
          <input className={inputClass} name="measuredAt" type="datetime-local" required />
          <input
            className={inputClass}
            name="uncertaintyValue"
            placeholder="Uncertainty (optional)"
          />
          <input className={inputClass} name="uncertaintyUnit" placeholder="Uncertainty unit" />
          <select className={inputClass} name="supersedesResultId" defaultValue="">
            <option value="">New observation</option>
            {results
              .filter((result) => result.current)
              .map((result) => (
                <option key={result.id} value={result.id}>
                  Correct {result.original_value} {result.original_unit}
                </option>
              ))}
          </select>
          <input className={inputClass} name="correctionReason" placeholder="Correction reason" />
          <Button type="submit">Record measurement</Button>
        </form>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

function LinkedTasksPanel({ base, recordId }: { base: string; recordId: string }) {
  const [tasks, setTasks] = useState<LinkedTask[]>([]);
  const [error, setError] = useState('');
  useEffect(
    () =>
      void api<{ items: LinkedTask[] }>(`${base}/tasks?entityId=${recordId}&includeArchived=true`)
        .then((result) => {
          setTasks(result.items);
          setError('');
        })
        .catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : 'Linked tasks could not be loaded.'),
        ),
    [base, recordId],
  );
  return (
    <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <h2 className="text-xl font-semibold">Linked tasks</h2>
      <div className="mt-4 space-y-2">
        {tasks.map((task) => (
          <div
            className="flex justify-between rounded-xl border border-slate-800 p-3"
            key={task.id}
          >
            <span>{task.title}</span>
            <span className="text-xs uppercase text-slate-400">
              {task.status} · {task.priority}
              {task.archived_at ? ' · archived' : ''}
            </span>
          </div>
        ))}
        {!tasks.length && !error && (
          <p className="text-sm text-slate-500">No follow-up task is linked to this record.</p>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

export function DataPage({ user }: { user: User }) {
  const { workspaceId = '', projectId = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const base = projectPath(workspaceId, projectId);
  const [objectTypes, setObjectTypes] = useState<ObjectType[]>([]);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [records, setRecords] = useState<QueryResult>({
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  });
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState('displayName');
  const [filterField, setFilterField] = useState('');
  const [filterOperator, setFilterOperator] = useState('eq');
  const [filterValue, setFilterValue] = useState('');
  const [showSchema, setShowSchema] = useState(false);
  const [showNewRecord, setShowNewRecord] = useState(false);
  const [typesLoading, setTypesLoading] = useState(true);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [csvResult, setCsvResult] = useState<CsvResult>();
  const selectedId = search.get('type') ?? objectTypes[0]?.id ?? '';
  const selected = objectTypes.find((objectType) => objectType.id === selectedId);

  const loadTypes = useCallback(async () => {
    setTypesLoading(true);
    try {
      const result = await api<{ items: ObjectType[] }>(`${base}/object-types`);
      setObjectTypes(result.items);
      if (!search.get('type') && result.items[0])
        setSearch({ type: result.items[0].id }, { replace: true });
      setMessage('');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Object types could not be loaded.');
    } finally {
      setTypesLoading(false);
    }
  }, [base, search, setSearch]);

  useEffect(() => void loadTypes(), [loadTypes]);

  const queryBody = useMemo(() => {
    const filters =
      filterField && (filterOperator === 'is_null' || filterValue)
        ? [
            {
              fieldId: filterField,
              operator: filterOperator,
              ...(filterOperator === 'is_null' ? {} : { value: filterValue }),
            },
          ]
        : [];
    const sorts =
      sortField === 'displayName'
        ? [{ systemField: 'displayName', direction: 'asc' }]
        : [{ fieldId: sortField, direction: 'asc' }];
    return { filters, sorts, page, pageSize: 25 };
  }, [filterField, filterOperator, filterValue, page, sortField]);

  const loadRecords = useCallback(async () => {
    if (!selectedId) return;
    setRecordsLoading(true);
    try {
      const [fieldResult, recordResult] = await Promise.all([
        api<{ items: FieldDefinition[] }>(`${base}/object-types/${selectedId}/fields`),
        api<QueryResult>(`${base}/object-types/${selectedId}/records/query`, {
          method: 'POST',
          body: JSON.stringify(queryBody),
        }),
      ]);
      setFields(fieldResult.items);
      setRecords(recordResult);
      setMessage('');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Records could not be loaded.');
    } finally {
      setRecordsLoading(false);
    }
  }, [base, queryBody, selectedId]);

  useEffect(() => void loadRecords(), [loadRecords]);

  async function installTemplate() {
    try {
      const result = await api<{ changed: boolean }>(
        `${base}/templates/test-characterization/install`,
        {
          method: 'POST',
          body: '{}',
        },
      );
      setMessage(result.changed ? 'Template installed.' : 'Template is already current.');
      await loadTypes();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Template installation failed.');
    }
  }

  async function createObjectType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const created = await api<ObjectType>(`${base}/object-types`, {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          pluralName: data.get('pluralName'),
          key: data.get('key'),
          icon: 'table',
        }),
      });
      form.reset();
      await loadTypes();
      setSearch({ type: created.id });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Object type creation failed.');
    }
  }

  async function createField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const type = String(data.get('fieldType')) as FieldType;
    const config: Record<string, unknown> = {};
    if (type === 'single_select' || type === 'multi_select') {
      config.options = String(data.get('options') ?? '')
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean)
        .map((label) => ({ key: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label }));
    }
    if (type === 'relation') {
      config.targetObjectTypeId = data.get('targetObjectTypeId');
      config.multiple = data.get('multiple') === 'on';
    }
    if (['quantity', 'measurement', 'range'].includes(type)) {
      config.dimension = data.get('dimension');
      config.canonicalUnit = data.get('canonicalUnit');
      config.allowedUnits = String(data.get('allowedUnits') ?? '')
        .split(',')
        .map((unit) => unit.trim())
        .filter(Boolean);
      config.displayPrecision = Number(data.get('displayPrecision') ?? 3);
    }
    try {
      await api(`${base}/object-types/${selectedId}/fields`, {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          key: data.get('key'),
          fieldType: type,
          required: data.get('required') === 'on',
          unique: data.get('unique') === 'on',
          position: fields.length,
          config,
        }),
      });
      form.reset();
      await loadRecords();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Field creation failed.');
    }
  }

  async function importCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = (new FormData(event.currentTarget).get('csv') as File | null) ?? undefined;
    if (!file?.size) return;
    try {
      const result = await api<CsvResult>(`${base}/object-types/${selectedId}/records/import-csv`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ csv: await file.text() }),
      });
      setCsvResult(result);
      await loadRecords();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'CSV import failed.');
    }
  }

  async function exportCsv() {
    try {
      const response = await fetch(
        `${apiBaseForDownload()}${base}/object-types/${selectedId}/export.csv`,
        {
          credentials: 'include',
        },
      );
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? 'Export failed.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `${selected?.key ?? 'records'}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'CSV export failed.');
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link className="text-sm text-sky-400" to={base}>
            ← Project overview
          </Link>
          <h1 className="mt-3 text-4xl font-semibold">Project data</h1>
          <p className="mt-2 text-slate-400">Typed, configurable engineering records.</p>
        </div>
        {allowed(user, 'schema.manage') && (
          <Button variant="quiet" onClick={() => void installTemplate()}>
            Install Test &amp; Characterization
          </Button>
        )}
      </div>
      <ErrorText>{message}</ErrorText>

      <div className="mt-8 grid min-w-0 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
          <p className="px-3 py-2 font-mono text-xs uppercase tracking-widest text-slate-500">
            Object types
          </p>
          {typesLoading && (
            <div className="space-y-2 px-3 py-4" aria-label="Loading object types">
              <div className="h-8 animate-pulse rounded bg-slate-800" />
              <div className="h-8 animate-pulse rounded bg-slate-800" />
            </div>
          )}
          {!typesLoading && objectTypes.length === 0 && (
            <p className="px-3 py-4 text-sm text-slate-400">
              No schema yet. Install the template or create one below.
            </p>
          )}
          {objectTypes.map((objectType) => (
            <button
              className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm ${selectedId === objectType.id ? 'bg-sky-500/15 text-sky-300' : 'text-slate-300 hover:bg-slate-800'}`}
              key={objectType.id}
              onClick={() => {
                setPage(1);
                setSortField('displayName');
                setFilterField('');
                setFilterValue('');
                setSearch({ type: objectType.id });
              }}
            >
              {objectType.pluralName}
            </button>
          ))}
          {allowed(user, 'schema.manage') && (
            <form
              className="mt-5 space-y-2 border-t border-slate-800 px-2 pt-4"
              onSubmit={(event) => void createObjectType(event)}
            >
              <input className={inputClass} name="name" placeholder="Type name" required />
              <input className={inputClass} name="pluralName" placeholder="Plural name" required />
              <input className={inputClass} name="key" placeholder="stable-key" required />
              <Button className="w-full" variant="quiet" type="submit">
                Add object type
              </Button>
            </form>
          )}
        </aside>

        <section className="min-w-0">
          {!selected ? (
            <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center text-slate-400">
              Choose or create an object type.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="font-mono text-xs uppercase tracking-widest text-sky-400">
                    {selected.key}
                  </p>
                  <h2 className="mt-1 text-3xl font-semibold">{selected.pluralName}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {allowed(user, 'schema.manage') && (
                    <Button variant="quiet" onClick={() => setShowSchema((value) => !value)}>
                      Schema
                    </Button>
                  )}
                  {allowed(user, 'export.execute') && (
                    <Button variant="quiet" onClick={() => void exportCsv()}>
                      Export CSV
                    </Button>
                  )}
                  {allowed(user, 'record.create') && (
                    <Button onClick={() => setShowNewRecord((value) => !value)}>New record</Button>
                  )}
                </div>
              </div>

              {showSchema && allowed(user, 'schema.manage') && (
                <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-900 p-5">
                  <h3 className="text-lg font-semibold">Schema editor</h3>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {fields.map((field) => (
                      <span
                        className="rounded-full border border-slate-700 px-3 py-1 text-xs"
                        key={field.id}
                      >
                        {field.name} · {field.fieldType}
                        {field.unique ? ' · unique' : ''}
                      </span>
                    ))}
                  </div>
                  <form
                    className="mt-5 grid gap-3 md:grid-cols-3"
                    onSubmit={(event) => void createField(event)}
                  >
                    <input className={inputClass} name="name" placeholder="Field name" required />
                    <input className={inputClass} name="key" placeholder="field-key" required />
                    <select className={inputClass} name="fieldType">
                      {fieldTypes.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                    <input
                      className={inputClass}
                      name="options"
                      placeholder="Select options, comma separated"
                    />
                    <select className={inputClass} name="targetObjectTypeId" defaultValue="">
                      <option value="">Relation target…</option>
                      {objectTypes.map((objectType) => (
                        <option key={objectType.id} value={objectType.id}>
                          {objectType.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className={inputClass}
                      name="dimension"
                      placeholder="Dimension (for example length)"
                    />
                    <input
                      className={inputClass}
                      name="canonicalUnit"
                      placeholder="Canonical unit (m)"
                    />
                    <input
                      className={inputClass}
                      name="allowedUnits"
                      placeholder="Allowed units: m, mm, um"
                    />
                    <input
                      className={inputClass}
                      name="displayPrecision"
                      type="number"
                      min="0"
                      max="34"
                      defaultValue="3"
                    />
                    <div className="flex items-center gap-4 px-2 text-sm text-slate-300">
                      <label>
                        <input name="required" type="checkbox" /> Required
                      </label>
                      <label>
                        <input name="unique" type="checkbox" /> Unique
                      </label>
                      <label>
                        <input name="multiple" type="checkbox" /> Multiple
                      </label>
                    </div>
                    <Button type="submit">Add field</Button>
                  </form>
                </div>
              )}

              {showNewRecord && allowed(user, 'record.create') && (
                <div className="mt-6 rounded-2xl border border-sky-900/80 bg-sky-950/20 p-5">
                  <h3 className="mb-5 text-lg font-semibold">New {selected.name}</h3>
                  <RecordForm
                    fields={fields}
                    submitLabel="Create record"
                    onSubmit={async (form) => {
                      await api(`${base}/object-types/${selected.id}/records`, {
                        method: 'POST',
                        body: JSON.stringify(recordPayload(fields, form)),
                      });
                      setShowNewRecord(false);
                      await loadRecords();
                    }}
                  />
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                <label className="text-xs text-slate-400">
                  Sort
                  <select
                    className={inputClass}
                    value={sortField}
                    onChange={(event) => {
                      setSortField(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="displayName">Display name</option>
                    {fields
                      .filter(
                        (field) =>
                          !['relation', 'multi_select', 'measurement', 'range'].includes(
                            field.fieldType,
                          ),
                      )
                      .map((field) => (
                        <option key={field.id} value={field.id}>
                          {field.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Filter field
                  <select
                    className={inputClass}
                    value={filterField}
                    onChange={(event) => {
                      setFilterField(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">No filter</option>
                    {fields
                      .filter(
                        (field) => field.fieldType !== 'measurement' && field.fieldType !== 'range',
                      )
                      .map((field) => (
                        <option key={field.id} value={field.id}>
                          {field.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Operator
                  <select
                    className={inputClass}
                    value={filterOperator}
                    onChange={(event) => setFilterOperator(event.target.value)}
                  >
                    {['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_null'].map(
                      (operator) => (
                        <option key={operator}>{operator}</option>
                      ),
                    )}
                  </select>
                </label>
                {filterOperator !== 'is_null' && (
                  <label className="text-xs text-slate-400">
                    Value
                    <input
                      className={inputClass}
                      value={filterValue}
                      onChange={(event) => {
                        setFilterValue(event.target.value);
                        setPage(1);
                      }}
                    />
                  </label>
                )}
              </div>

              <div className="mt-4 max-w-full overflow-x-auto rounded-2xl border border-slate-800">
                {recordsLoading && (
                  <div className="space-y-3 p-5" aria-label="Loading records">
                    <div className="h-10 animate-pulse rounded bg-slate-900" />
                    <div className="h-10 animate-pulse rounded bg-slate-900" />
                    <div className="h-10 animate-pulse rounded bg-slate-900" />
                  </div>
                )}
                {!recordsLoading && (
                  <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                    <thead className="bg-slate-900 text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="p-4">Name</th>
                        {fields.slice(0, 6).map((field) => (
                          <th className="p-4" key={field.id}>
                            {field.name}
                          </th>
                        ))}
                        <th className="p-4">Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {records.items.map((record) => (
                        <tr className="bg-slate-950/30 hover:bg-slate-900/70" key={record.id}>
                          <td className="p-4">
                            <Link
                              className="font-medium text-sky-300"
                              to={`${base}/data/${record.objectTypeId}/records/${record.id}`}
                            >
                              {record.displayName}
                            </Link>
                          </td>
                          {fields.slice(0, 6).map((field) => (
                            <td className="max-w-56 truncate p-4 text-slate-300" key={field.id}>
                              {field.fieldType === 'relation'
                                ? displayValue(record.relations[field.id])
                                : field.fieldType === 'measurement'
                                  ? record.measurements?.[field.id]?.resultId
                                    ? `${record.measurements[field.id]?.value} ${record.measurements[field.id]?.unit} · ${record.measurements[field.id]?.status ?? 'pending'}`
                                    : (record.measurements?.[field.id]?.status ?? '—')
                                  : displayValue(record.values[field.key])}
                            </td>
                          ))}
                          <td className="p-4 text-slate-500">
                            {new Date(record.updatedAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {!recordsLoading && records.items.length === 0 && (
                  <p className="p-10 text-center text-slate-400">
                    No matching records. Create the first one or adjust the filter.
                  </p>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
                <span>
                  {records.total} records · page {records.page}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="quiet"
                    disabled={page <= 1}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="quiet"
                    disabled={page * records.pageSize >= records.total}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>

              {allowed(user, 'record.create') && (
                <form
                  className="mt-8 rounded-xl border border-dashed border-slate-700 p-4"
                  onSubmit={(event) => void importCsv(event)}
                >
                  <p className="font-medium">Import CSV</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Use displayName and stable field keys as headers. Relations use
                    semicolon-separated record UUIDs.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <input accept=".csv,text/csv" name="csv" required type="file" />
                    <Button variant="quiet" type="submit">
                      Import
                    </Button>
                  </div>
                  {csvResult && (
                    <p className="mt-3 text-sm text-slate-300">
                      Imported {csvResult.imported}; {csvResult.failed} failed.
                    </p>
                  )}
                  {csvResult?.errors.map((error) => (
                    <p className="mt-1 text-xs text-rose-300" key={`${error.row}:${error.reason}`}>
                      Row {error.row}: {error.reason}
                    </p>
                  ))}
                </form>
              )}
              <SpecificationsPanel base={base} fields={fields} user={user} />
            </>
          )}
        </section>
      </div>
    </>
  );
}

function apiBaseForDownload(): string {
  return `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'}/api/v1`;
}

export function RecordDetailPage({ user }: { user: User }) {
  const { workspaceId = '', projectId = '', objectTypeId = '', recordId = '' } = useParams();
  const navigate = useNavigate();
  const base = projectPath(workspaceId, projectId);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [record, setRecord] = useState<DynamicRecord>();
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const [fieldResult, recordResult] = await Promise.all([
        api<{ items: FieldDefinition[] }>(`${base}/object-types/${objectTypeId}/fields`),
        api<DynamicRecord>(`${base}/object-types/${objectTypeId}/records/${recordId}`),
      ]);
      setFields(fieldResult.items);
      setRecord(recordResult);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Record could not be loaded.');
    }
  }, [base, objectTypeId, recordId]);
  useEffect(() => void load(), [load]);

  async function archive(archived: boolean) {
    if (
      archived &&
      !window.confirm('Archive this record? Relations and history will be preserved.')
    )
      return;
    try {
      await api(
        `${base}/object-types/${objectTypeId}/records/${recordId}/${archived ? 'archive' : 'restore'}`,
        {
          method: 'POST',
          body: JSON.stringify(archived ? { reason: 'Archived from record detail' } : {}),
        },
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Lifecycle action failed.');
    }
  }

  if (!record && !error) return <p className="text-slate-400">Loading record…</p>;
  if (!record) return <ErrorText>{error}</ErrorText>;
  return (
    <>
      <Link className="text-sm text-sky-400" to={`${base}/data?type=${objectTypeId}`}>
        ← Data grid
      </Link>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-sky-400">Record detail</p>
          <h1 className="mt-2 text-4xl font-semibold">{record.displayName}</h1>
          <p className="mt-2 text-sm text-slate-500">
            Version {record.rowVersion} · stable ID {record.id}
          </p>
        </div>
        <div className="flex gap-2">
          {record.archivedAt
            ? allowed(user, 'record.restore') && (
                <Button onClick={() => void archive(false)}>Restore</Button>
              )
            : allowed(user, 'record.archive') && (
                <Button variant="quiet" onClick={() => void archive(true)}>
                  Archive
                </Button>
              )}
        </div>
      </div>
      <ErrorText>{error}</ErrorText>
      <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="mb-5 text-xl font-semibold">Properties and relations</h2>
        {allowed(user, 'record.update') ? (
          <RecordForm
            key={record.rowVersion}
            fields={fields}
            record={record}
            submitLabel="Save changes"
            onSubmit={async (form) => {
              const updated = await api<DynamicRecord>(
                `${base}/object-types/${objectTypeId}/records/${recordId}`,
                {
                  method: 'PATCH',
                  body: JSON.stringify({
                    ...recordPayload(fields, form),
                    rowVersion: record.rowVersion,
                  }),
                },
              );
              setRecord(updated);
            }}
          />
        ) : (
          <dl className="grid gap-4 md:grid-cols-2">
            {fields.map((field) => (
              <div key={field.id}>
                <dt className="text-xs uppercase tracking-wide text-slate-500">{field.name}</dt>
                <dd className="mt-1 text-slate-200">
                  {field.fieldType === 'relation'
                    ? displayValue(record.relations[field.id])
                    : field.fieldType === 'measurement'
                      ? record.measurements?.[field.id]?.resultId
                        ? `${record.measurements[field.id]?.value} ${record.measurements[field.id]?.unit} · ${record.measurements[field.id]?.status ?? 'pending'}`
                        : (record.measurements?.[field.id]?.status ?? '—')
                      : displayValue(record.values[field.key])}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <MeasurementsPanel base={base} fields={fields} recordId={record.id} user={user} />
      <LinkedTasksPanel base={base} recordId={record.id} />
      <button
        className="mt-8 text-sm text-slate-500 hover:text-rose-300"
        onClick={() => navigate(`${base}/data?type=${objectTypeId}`)}
      >
        Close detail
      </button>
    </>
  );
}
