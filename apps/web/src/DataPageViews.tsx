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
import { Link } from 'react-router';
import { allowed, api, ErrorText, HelpTip, inputClass, type User } from './App.js';
import { useActionDialog } from './ActionDialogProvider.js';
import type {
  DynamicRecord,
  FieldDefinition,
  LinkedTask,
  MeasurementResult,
  QueryResult,
  RecordHistoryItem,
  RecordReference,
  Specification,
} from './DataPageTypes.js';
import { FormField } from './FormFieldLabel.js';
import { IconAction } from './IconAction.js';
import { useI18n } from './i18n.js';

const panelClass = 'mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-6';
const emptyPageInfo = { total: 0, hasNext: false };
type PageInfo = typeof emptyPageInfo;

function localDateTimeInput(date = new Date()): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function LoadMoreHistory({
  shown,
  total,
  onClick,
}: {
  shown: number;
  total: number;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-4 text-center">
      <Button onClick={onClick} type="button" variant="quiet">
        {t('data.loadMoreHistory', { shown, total })}
      </Button>
    </div>
  );
}

function structuredDataSummary(field: FieldDefinition, value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (field.fieldType === 'spectral_data') {
    const spectral = value as { x?: unknown[]; series?: unknown[] };
    if (!Array.isArray(spectral.x) || !Array.isArray(spectral.series)) return undefined;
    return `${spectral.x.length.toLocaleString()} points · ${spectral.series.length} ${spectral.series.length === 1 ? 'series' : 'series'}`;
  }
  if (field.fieldType === 'tabular_data') {
    const table = value as { columns?: unknown[]; rows?: unknown[] };
    if (!Array.isArray(table.columns) || !Array.isArray(table.rows)) return undefined;
    return `${table.rows.length.toLocaleString()} rows × ${table.columns.length} columns`;
  }
  return undefined;
}

export function displayValue(value: unknown): string {
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

export function displayFieldValue(
  field: FieldDefinition,
  value: unknown,
  references?: RecordReference[],
): string {
  if (
    (field.fieldType === 'user' || field.fieldType === 'file' || field.fieldType === 'dataset') &&
    references?.length
  )
    return references.map((reference) => reference.displayName).join(', ');
  if (field.fieldType === 'single_select' && typeof value === 'string')
    return field.config.options?.find((option) => option.key === value)?.label ?? value;
  if (field.fieldType === 'multi_select' && Array.isArray(value)) {
    const labels = new Map(field.config.options?.map((option) => [option.key, option.label]));
    return value.map((item) => labels.get(String(item)) ?? String(item)).join(', ');
  }
  return structuredDataSummary(field, value) ?? displayValue(value);
}

export function GalleryRecordsView({
  fields,
  records,
  onOpen,
  onContextMenu,
  onContextMenuKeyDown,
}: {
  fields: FieldDefinition[];
  records: DynamicRecord[];
  onOpen: (record: DynamicRecord) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, record: DynamicRecord) => void;
  onContextMenuKeyDown: (event: ReactKeyboardEvent<HTMLElement>, record: DynamicRecord) => void;
}) {
  return (
    <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {records.map((record) => (
        <article
          className="group overflow-hidden rounded-lg border border-slate-800 bg-slate-900/55 hover:border-slate-700"
          key={record.id}
          onContextMenu={(event) => onContextMenu(event, record)}
          onKeyDown={(event) => onContextMenuKeyDown(event, record)}
          tabIndex={0}
        >
          <div className="h-16 border-b border-slate-800 bg-gradient-to-br from-sky-500/15 via-slate-900 to-cyan-500/10" />
          <div className="p-3">
            <button
              className="w-full truncate text-left text-sm font-semibold text-slate-100 group-hover:text-sky-300"
              onClick={() => onOpen(record)}
              type="button"
            >
              {record.displayName}
            </button>
            <dl className="mt-2 space-y-1.5">
              {fields.slice(0, 5).map((field) => (
                <div className="grid grid-cols-[5rem_1fr] gap-2 text-xs" key={field.id}>
                  <dt className="truncate text-slate-500">{field.name}</dt>
                  <dd className="truncate text-slate-300">
                    {displayFieldValue(
                      field,
                      recordGridValue(record, field),
                      record.referenceLabels?.[field.id],
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </article>
      ))}
    </div>
  );
}

export function KanbanRecordsView({
  field,
  records,
  groups,
  canUpdate,
  onMove,
  onOpen,
  onContextMenu,
  onContextMenuKeyDown,
}: {
  field: FieldDefinition;
  records: DynamicRecord[];
  groups: QueryResult['groups'];
  canUpdate: boolean;
  onMove: (record: DynamicRecord, value: string) => Promise<void>;
  onOpen: (record: DynamicRecord) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, record: DynamicRecord) => void;
  onContextMenuKeyDown: (event: ReactKeyboardEvent<HTMLElement>, record: DynamicRecord) => void;
}) {
  const { t } = useI18n();
  const lanes = [{ key: '', label: t('data.noValue') }, ...(field.config.options ?? [])];
  return (
    <div className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3 overflow-x-auto p-3">
      {lanes.map((lane) => {
        const items = records.filter(
          (record) => String(recordGridValue(record, field) ?? '') === lane.key,
        );
        const count =
          groups?.find((group) => (group.value ?? '') === lane.key)?.count ?? items.length;
        return (
          <section
            className="min-h-72 rounded-lg border border-slate-800 bg-slate-900/35"
            key={lane.key || 'unassigned'}
          >
            <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
              <h3 className="truncate text-xs font-semibold text-slate-300">{lane.label}</h3>
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
                {count}
              </span>
            </header>
            <div className="space-y-2 p-2">
              {items.map((record) => (
                <article
                  className="rounded-md border border-slate-800 bg-slate-950/75 p-2.5 shadow-sm"
                  key={record.id}
                  onContextMenu={(event) => onContextMenu(event, record)}
                  onKeyDown={(event) => onContextMenuKeyDown(event, record)}
                  tabIndex={0}
                >
                  <button
                    className="w-full truncate text-left text-xs font-medium text-slate-200 hover:text-sky-300"
                    onClick={() => onOpen(record)}
                    type="button"
                  >
                    {record.displayName}
                  </button>
                  {canUpdate && (
                    <select
                      aria-label={`Move ${record.displayName}`}
                      className="mt-2 w-full rounded border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-slate-400 outline-none focus:border-sky-500"
                      value={lane.key}
                      onChange={(event) => void onMove(record, event.target.value)}
                    >
                      {lanes.map((candidate) => (
                        <option key={candidate.key || 'unassigned'} value={candidate.key}>
                          {candidate.label}
                        </option>
                      ))}
                    </select>
                  )}
                </article>
              ))}
              {!items.length && (
                <p className="rounded border border-dashed border-slate-800 px-2 py-6 text-center text-xs text-slate-600">
                  {t('data.noRecords')}
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function CalendarRecordsView({
  field,
  month,
  records,
  onMonthChange,
  onOpen,
  onContextMenu,
  onContextMenuKeyDown,
}: {
  field: FieldDefinition;
  month: Date;
  records: DynamicRecord[];
  onMonthChange: (month: Date) => void;
  onOpen: (record: DynamicRecord) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, record: DynamicRecord) => void;
  onContextMenuKeyDown: (event: ReactKeyboardEvent<HTMLElement>, record: DynamicRecord) => void;
}) {
  const { t, formatDate } = useI18n();
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const leadingDays = new Date(year, monthIndex, 1).getDay();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(year, monthIndex, index - leadingDays + 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { date, key, current: date.getMonth() === monthIndex };
  });
  const byDate = new Map<string, DynamicRecord[]>();
  for (const record of records) {
    const value = recordGridValue(record, field);
    if (typeof value !== 'string' || value.length < 10) continue;
    const key = value.slice(0, 10);
    byDate.set(key, [...(byDate.get(key) ?? []), record]);
  }
  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          aria-label={t('data.previousMonth')}
          className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          onClick={() => onMonthChange(new Date(year, monthIndex - 1, 1))}
          type="button"
        >
          ‹
        </button>
        <h3 className="text-sm font-semibold">
          {formatDate(month, { month: 'long', year: 'numeric' })}
        </h3>
        <button
          aria-label={t('data.nextMonth')}
          className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          onClick={() => onMonthChange(new Date(year, monthIndex + 1, 1))}
          type="button"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 border-l border-t border-slate-800">
        {[
          t('data.weekdaySun'),
          t('data.weekdayMon'),
          t('data.weekdayTue'),
          t('data.weekdayWed'),
          t('data.weekdayThu'),
          t('data.weekdayFri'),
          t('data.weekdaySat'),
        ].map((day) => (
          <div
            className="border-b border-r border-slate-800 bg-slate-900/70 px-2 py-1.5 text-center text-[10px] uppercase text-slate-500"
            key={day}
          >
            {day}
          </div>
        ))}
        {cells.map((cell) => (
          <div
            className={`min-h-24 border-b border-r border-slate-800 p-1.5 ${cell.current ? 'bg-slate-950/25' : 'bg-slate-900/25 text-slate-600'}`}
            key={cell.key}
          >
            <span className="text-[10px]">{cell.date.getDate()}</span>
            <div className="mt-1 space-y-1">
              {(byDate.get(cell.key) ?? []).slice(0, 3).map((record) => (
                <button
                  className="block w-full truncate rounded bg-sky-500/10 px-1.5 py-1 text-left text-[10px] text-sky-300 hover:bg-sky-500/20"
                  key={record.id}
                  onClick={() => onOpen(record)}
                  onContextMenu={(event) => onContextMenu(event, record)}
                  onKeyDown={(event) => onContextMenuKeyDown(event, record)}
                  type="button"
                >
                  {record.displayName}
                </button>
              ))}
              {(byDate.get(cell.key)?.length ?? 0) > 3 && (
                <span className="text-[10px] text-slate-500">
                  {t('data.more', { count: (byDate.get(cell.key)?.length ?? 0) - 3 })}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SpecificationsPanel({
  base,
  fields,
  user,
}: {
  base: string;
  fields: FieldDefinition[];
  user: User;
}) {
  const { t } = useI18n();
  const measurementFields = fields.filter((field) => field.fieldType === 'measurement');
  const [specifications, setSpecifications] = useState<Specification[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo>(emptyPageInfo);
  const [error, setError] = useState('');
  const load = useCallback(
    async (offset = 0, append = false) => {
      if (!measurementFields.length) {
        setSpecifications([]);
        setPageInfo(emptyPageInfo);
        return;
      }
      try {
        const result = await api<{ items: Specification[]; pageInfo: PageInfo }>(
          `${base}/specifications?archiveState=all&limit=50&offset=${offset}`,
        );
        setSpecifications((current) => (append ? [...current, ...result.items] : result.items));
        setPageInfo(result.pageInfo);
        setError('');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('data.specificationsLoadFailed'));
      }
    },
    [base, measurementFields.length, t],
  );
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
      setError(cause instanceof Error ? cause.message : t('data.specificationCreateFailed'));
    }
  }
  return (
    <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <h3 className="text-lg font-semibold">{t('data.measurementSpecifications')}</h3>
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
      {pageInfo.hasNext && (
        <LoadMoreHistory
          shown={specifications.length}
          total={pageInfo.total}
          onClick={() => void load(specifications.length, true)}
        />
      )}
      {allowed(user, 'specification.manage') && (
        <form className="mt-5 grid gap-2 md:grid-cols-3" onSubmit={(event) => void create(event)}>
          <FormField label={t('data.specificationName')} required>
            <input className={inputClass} name="name" required />
          </FormField>
          <FormField label={t('data.measurementField')} required>
            <select className={inputClass} name="measurementFieldId" required>
              {measurementFields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('data.hardLower')}>
            <input className={inputClass} name="lowerLimit" />
          </FormField>
          <FormField label={t('data.warningLower')}>
            <input className={inputClass} name="warningLowerLimit" />
          </FormField>
          <FormField label={t('data.warningUpper')}>
            <input className={inputClass} name="warningUpperLimit" />
          </FormField>
          <FormField label={t('data.hardUpper')}>
            <input className={inputClass} name="upperLimit" />
          </FormField>
          <Button type="submit">{t('data.createSpecification')}</Button>
        </form>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

export function MeasurementsPanel({
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
  const { t, formatDate } = useI18n();
  const measurementFields = useMemo(
    () => fields.filter((field) => field.fieldType === 'measurement'),
    [fields],
  );
  const [results, setResults] = useState<MeasurementResult[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo>(emptyPageInfo);
  const [error, setError] = useState('');
  const [creatingEvaluationId, setCreatingEvaluationId] = useState('');
  const [followUpTasks, setFollowUpTasks] = useState<Record<string, LinkedTask>>({});
  const [measurementFieldId, setMeasurementFieldId] = useState(
    () => measurementFields[0]?.id ?? '',
  );
  const [measurementUnit, setMeasurementUnit] = useState(
    () => measurementFields[0]?.config.allowedUnits?.[0] ?? '',
  );
  const [measuredAt, setMeasuredAt] = useState(() => localDateTimeInput());
  const selectedMeasurementField =
    measurementFields.find((field) => field.id === measurementFieldId) ?? measurementFields[0];
  const measurementUnits = selectedMeasurementField?.config.allowedUnits ?? [];
  useEffect(() => {
    if (!selectedMeasurementField) return;
    if (measurementFieldId !== selectedMeasurementField.id)
      setMeasurementFieldId(selectedMeasurementField.id);
    if (!measurementUnits.includes(measurementUnit)) setMeasurementUnit(measurementUnits[0] ?? '');
  }, [measurementFieldId, measurementUnit, measurementUnits, selectedMeasurementField]);
  const load = useCallback(
    async (offset = 0, append = false) => {
      if (!measurementFields.length) return;
      try {
        const history = await api<{ items: MeasurementResult[]; pageInfo: PageInfo }>(
          `${base}/records/${recordId}/measurement-results?currentState=all&limit=50&offset=${offset}`,
        );
        setResults((loaded) => (append ? [...loaded, ...history.items] : history.items));
        setPageInfo(history.pageInfo);
        setError('');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('data.measurementsLoadFailed'));
      }
    },
    [base, recordId, measurementFields.length, t],
  );
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
      setMeasuredAt(localDateTimeInput());
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('data.measurementCreateFailed'));
    }
  }
  async function createTask(evaluationId: string) {
    setCreatingEvaluationId(evaluationId);
    try {
      const task = await api<LinkedTask>(`${base}/specification-evaluations/${evaluationId}/task`, {
        method: 'POST',
      });
      setFollowUpTasks((current) => ({ ...current, [evaluationId]: task }));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('data.followUpCreateFailed'));
    } finally {
      setCreatingEvaluationId('');
    }
  }
  return (
    <section className={panelClass}>
      <h2 className="text-xl font-semibold">{t('data.measurementHistory')}</h2>
      <div className="mt-4 grid gap-3">
        {results.map((result) => {
          const field = measurementFields.find((candidate) => candidate.id === result.field_id);
          const evaluation = result.evaluation;
          const followUpTask = evaluation ? followUpTasks[evaluation.id] : undefined;
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
                  {t('data.canonical')} {result.canonical_value} {result.canonical_unit} ·{' '}
                  {formatDate(result.measured_at, { dateStyle: 'short', timeStyle: 'short' })}
                  {result.supersedes_result_id ? ` · ${t('data.correction')}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs uppercase ${evaluation?.status === 'fail' ? 'bg-rose-500/20 text-rose-300' : evaluation?.status === 'warning' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}`}
                >
                  {evaluation?.status ?? t('data.pending')}
                  {result.current ? ` · ${t('data.current')}` : ''}
                </span>
                {evaluation?.status === 'fail' && allowed(user, 'task.create') && (
                  <div className="flex items-center gap-1">
                    {followUpTask ? (
                      <>
                        <span aria-live="polite" className="font-mono text-[10px] text-emerald-300">
                          {followUpTask.task_key}
                        </span>
                        <Link
                          aria-label={t('data.openFollowUpTask', { key: followUpTask.task_key })}
                          className="group/icon relative grid size-7 shrink-0 place-items-center rounded-md text-sm text-emerald-300 transition hover:bg-emerald-500/10 hover:text-emerald-200"
                          title={t('data.openFollowUpTask', { key: followUpTask.task_key })}
                          to={`${base}/tasks?task=${followUpTask.task_key}`}
                        >
                          <span aria-hidden="true">↗</span>
                          <span
                            className="pointer-events-none absolute bottom-[calc(100%+0.4rem)] right-0 z-[80] whitespace-nowrap rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-medium leading-none text-slate-200 opacity-0 shadow-xl transition-opacity group-hover/icon:opacity-100 group-focus-visible/icon:opacity-100"
                            role="tooltip"
                          >
                            {t('data.openFollowUpTask', { key: followUpTask.task_key })}
                          </span>
                        </Link>
                      </>
                    ) : (
                      <IconAction
                        disabled={Boolean(creatingEvaluationId)}
                        icon={creatingEvaluationId === evaluation.id ? '…' : '+'}
                        label={t('data.createFollowUpTask')}
                        onClick={() => void createTask(evaluation.id)}
                        tone="accent"
                        tooltipAlign="end"
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {results.length === 0 && (
          <p className="text-sm text-slate-400">{t('data.noObservations')}</p>
        )}
      </div>
      {pageInfo.hasNext && (
        <LoadMoreHistory
          shown={results.length}
          total={pageInfo.total}
          onClick={() => void load(results.length, true)}
        />
      )}
      {allowed(user, 'measurement.create') && (
        <form className="mt-5 grid gap-2 md:grid-cols-3" onSubmit={(event) => void create(event)}>
          <FormField label={t('data.measurementField')} required>
            <select
              className={inputClass}
              name="fieldId"
              onChange={(event) => {
                const field = measurementFields.find(
                  (candidate) => candidate.id === event.target.value,
                );
                setMeasurementFieldId(event.target.value);
                setMeasurementUnit(field?.config.allowedUnits?.[0] ?? '');
              }}
              required
              value={selectedMeasurementField?.id ?? ''}
            >
              {measurementFields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('data.decimalValue')} required>
            <input className={inputClass} name="value" required />
          </FormField>
          <FormField label={t('data.measurementUnit')} required>
            <select
              className={inputClass}
              name="unit"
              onChange={(event) => setMeasurementUnit(event.target.value)}
              required
              value={measurementUnits.includes(measurementUnit) ? measurementUnit : ''}
            >
              {measurementUnits.map((unit) => (
                <option key={unit}>{unit}</option>
              ))}
            </select>
          </FormField>
          <FormField label={t('data.measuredAt')} required>
            <input
              className={inputClass}
              name="measuredAt"
              onChange={(event) => setMeasuredAt(event.target.value)}
              type="datetime-local"
              required
              value={measuredAt}
            />
          </FormField>
          <FormField label={t('data.uncertaintyValue')}>
            <input className={inputClass} name="uncertaintyValue" />
          </FormField>
          <FormField label={t('data.uncertaintyUnit')}>
            <input className={inputClass} name="uncertaintyUnit" />
          </FormField>
          <FormField label={t('data.correctsObservation')}>
            <select className={inputClass} name="supersedesResultId" defaultValue="">
              <option value="">{t('data.newObservation')}</option>
              {results
                .filter((result) => result.current)
                .map((result) => (
                  <option key={result.id} value={result.id}>
                    {t('data.correctValue', {
                      value: result.original_value,
                      unit: result.original_unit,
                    })}
                  </option>
                ))}
            </select>
          </FormField>
          <FormField label={t('data.correctionReason')}>
            <input className={inputClass} name="correctionReason" />
          </FormField>
          <Button type="submit">{t('data.recordMeasurement')}</Button>
        </form>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

export function LinkedTasksPanel({ base, recordId }: { base: string; recordId: string }) {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<LinkedTask[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo>(emptyPageInfo);
  const [error, setError] = useState('');
  const load = useCallback(
    async (offset = 0, append = false) => {
      try {
        const result = await api<{ items: LinkedTask[]; pageInfo: PageInfo }>(
          `${base}/tasks?entityId=${recordId}&archiveState=all&limit=50&offset=${offset}`,
        );
        setTasks((current) => (append ? [...current, ...result.items] : result.items));
        setPageInfo(result.pageInfo);
        setError('');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('data.linkedTasksLoadFailed'));
      }
    },
    [base, recordId, t],
  );
  useEffect(() => void load(), [load]);
  return (
    <section className={panelClass}>
      <h2 className="text-xl font-semibold">{t('data.linkedTasks')}</h2>
      <div className="mt-4 space-y-2">
        {tasks.map((task) => (
          <div
            className="flex items-start justify-between gap-4 rounded-xl border border-slate-800 p-3"
            key={task.id}
          >
            <Link
              className="min-w-0 text-sm font-medium text-slate-100 hover:text-sky-300"
              to={`${base}/tasks?task=${task.task_key}`}
            >
              <span className="mr-2 font-mono text-xs text-sky-400">{task.task_key}</span>
              {task.title}
            </Link>
            <span className="shrink-0 text-xs uppercase text-slate-400">
              {task.status} · {task.priority}
              {task.archived_at ? ` · ${t('data.archived')}` : ''}
            </span>
          </div>
        ))}
        {!tasks.length && !error && (
          <p className="text-sm text-slate-500">{t('data.noLinkedTasks')}</p>
        )}
      </div>
      {pageInfo.hasNext && (
        <div className="mt-4 text-center">
          <Button onClick={() => void load(tasks.length, true)} type="button" variant="quiet">
            {t('tasks.loadMoreTasks', { shown: tasks.length, total: pageInfo.total })}
          </Button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

export function recordGridValue(record: DynamicRecord, field: FieldDefinition): unknown {
  if (field.fieldType === 'relation') return record.relations?.[field.id] ?? [];
  if (field.fieldType === 'file') return record.fileReferences?.[field.id] ?? [];
  if (field.fieldType === 'dataset') return record.datasetReferences?.[field.id] ?? [];
  return record.values[field.key];
}

export function RecordHistoryPanel({
  base,
  objectTypeId,
  record,
  user,
  onRestored,
}: {
  base: string;
  objectTypeId: string;
  record: DynamicRecord;
  user: User;
  onRestored: (record: DynamicRecord) => void;
}) {
  const { t, formatDate } = useI18n();
  const { confirmAction } = useActionDialog();
  const [items, setItems] = useState<RecordHistoryItem[]>([]);
  const [pageInfo, setPageInfo] = useState({
    limit: 50,
    offset: 0,
    total: 0,
    hasNext: false,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{
        items: RecordHistoryItem[];
        pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
      }>(`${base}/object-types/${objectTypeId}/records/${record.id}/history?limit=50&offset=0`);
      setItems(result.items);
      setPageInfo(result.pageInfo);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('data.historyLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [base, objectTypeId, record.id, record.rowVersion, t]);
  useEffect(() => void load(), [load]);
  async function loadMoreHistory() {
    if (loadingMore || !pageInfo.hasNext) return;
    setLoadingMore(true);
    try {
      const result = await api<{
        items: RecordHistoryItem[];
        pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
      }>(
        `${base}/object-types/${objectTypeId}/records/${record.id}/history?limit=${pageInfo.limit}&offset=${items.length}`,
      );
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...result.items.filter((item) => !known.has(item.id))];
      });
      setPageInfo(result.pageInfo);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('data.historyLoadFailed'));
    } finally {
      setLoadingMore(false);
    }
  }
  async function undo(item: RecordHistoryItem) {
    if (!(await confirmAction(t('data.restoreConfirm')))) return;
    setBusy(item.id);
    try {
      const restored = await api<DynamicRecord>(
        `${base}/object-types/${objectTypeId}/records/${record.id}/history/${item.id}/undo`,
        { method: 'POST', body: JSON.stringify({ rowVersion: record.rowVersion }) },
      );
      onRestored(restored);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('data.undoFailed'));
    } finally {
      setBusy('');
    }
  }
  return (
    <section className={panelClass}>
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-semibold">{t('data.changeHistory')}</h2>
        <HelpTip label={t('data.changeHistoryHelp')}>{t('data.changeHistoryBody')}</HelpTip>
      </div>
      <ol className="mt-4 divide-y divide-slate-800 rounded-xl border border-slate-800">
        {items.map((item) => (
          <li className="flex items-center justify-between gap-4 px-4 py-3" key={item.id}>
            <div className="min-w-0">
              <p className="text-sm text-slate-200">{item.action.replaceAll('.', ' · ')}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {item.actorName ?? t('data.system')} ·{' '}
                {formatDate(item.createdAt, { dateStyle: 'short', timeStyle: 'short' })}
                {item.rowVersion ? ` · ${t('data.version', { version: item.rowVersion })}` : ''}
              </p>
            </div>
            {item.undoable && allowed(user, 'record.update') && (
              <button
                className="shrink-0 rounded-md px-2 py-1 text-xs text-sky-300 hover:bg-sky-500/10 disabled:opacity-50"
                disabled={Boolean(busy)}
                onClick={() => void undo(item)}
                type="button"
              >
                {busy === item.id ? t('data.restoring') : t('data.undoHere')}
              </button>
            )}
          </li>
        ))}
        {!items.length && !error && !loading && (
          <li className="px-4 py-6 text-center text-sm text-slate-500">{t('data.noChanges')}</li>
        )}
        {loading && !items.length && (
          <li className="px-4 py-6 text-center text-sm text-slate-500">{t('common.loading')}</li>
        )}
      </ol>
      {pageInfo.hasNext && (
        <div className="mt-3 flex justify-center">
          <Button
            disabled={loadingMore}
            onClick={() => void loadMoreHistory()}
            type="button"
            variant="quiet"
          >
            {loadingMore
              ? t('common.loading')
              : t('data.loadMoreHistory', { shown: items.length, total: pageInfo.total })}
          </Button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
