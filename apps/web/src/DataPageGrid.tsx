import { Button } from '@engrove/ui';
import {
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ErrorText, inputClass } from './App.js';
import { CellValuePreview } from './DataPageCharts.js';
import { isImageField } from './DataPageImages.js';
import type {
  DynamicRecord,
  FieldDefinition,
  FieldType,
  GridColumn,
  GridSelection,
  GridSelectionBounds,
  WorkspaceDataContext,
  RecordViewConfig,
} from './DataPageTypes.js';
import { displayFieldValue, displayValue } from './DataPageViews.js';
import { useI18n } from './i18n.js';

const calculatedFieldTypeSet = new Set<FieldType>(['formula', 'lookup', 'rollup']);

export function projectPath(workspaceId: string, projectId: string): string {
  return `/workspaces/${workspaceId}/projects/${projectId}`;
}

export function canonicalTableIdentifier(identifier: string): string {
  return /^m[0-9a-z]{14}$/.test(identifier) ? `t${identifier.slice(1)}` : identifier;
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableJsonValue(item)]),
    );
  }
  return value;
}

export function viewConfigsEqual(left: RecordViewConfig, right: RecordViewConfig): boolean {
  return JSON.stringify(stableJsonValue(left)) === JSON.stringify(stableJsonValue(right));
}

export function isStructuredFieldType(type: FieldType): boolean {
  return type === 'spectral_data' || type === 'tabular_data';
}

function delimitedRows(source: string): string[][] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines.at(-1)?.trim()) lines.pop();
  const delimiter = source.includes('\t') ? '\t' : ',';
  return lines
    .map((line) => line.split(delimiter).map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
}

function uniqueLabels(labels: string[], fallback: string): string[] {
  const counts = new Map<string, number>();
  return labels.map((label, index) => {
    const base = label.trim() || `${fallback} ${index + 1}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function scalarTableValue(value: string): string | number | boolean | null {
  if (!value) return null;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return value;
}

function parseStructuredData(field: FieldDefinition, source: string): unknown {
  const rows = delimitedRows(source);
  if (!rows.length) return undefined;
  const width = Math.max(...rows.map((row) => row.length));
  if (rows.some((row) => row.length !== width)) {
    throw new Error('Every pasted row must contain the same number of columns.');
  }
  if (field.fieldType === 'spectral_data') {
    if (width < 2)
      throw new Error('Spectral data needs an X column and at least one signal column.');
    const firstRowIsData = rows[0]!.every((cell) => cell !== '' && Number.isFinite(Number(cell)));
    const headers = firstRowIsData
      ? [
          field.config.xLabel || 'X',
          ...Array.from({ length: width - 1 }, (_, index) =>
            width === 2 ? field.config.yLabel || 'Signal' : `Signal ${index + 1}`,
          ),
        ]
      : uniqueLabels(rows[0]!, 'Series');
    const dataRows = firstRowIsData ? rows : rows.slice(1);
    if (!dataRows.length) throw new Error('Spectral data needs at least one numeric row.');
    const numericRows = dataRows.map((row, rowIndex) =>
      row.map((cell, columnIndex) => {
        const value = Number(cell);
        if (!cell || !Number.isFinite(value)) {
          throw new Error(`Row ${rowIndex + 1}, column ${columnIndex + 1} must be numeric.`);
        }
        return value;
      }),
    );
    return {
      x: numericRows.map((row) => row[0]!),
      series: headers.slice(1).map((name, seriesIndex) => ({
        name,
        values: numericRows.map((row) => row[seriesIndex + 1]!),
      })),
    };
  }
  const firstRowHeader = field.config.firstRowHeader !== false;
  const columns = firstRowHeader
    ? uniqueLabels(rows[0]!, 'Column')
    : Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
  const dataRows = firstRowHeader ? rows.slice(1) : rows;
  return { columns, rows: dataRows.map((row) => row.map(scalarTableValue)) };
}

export function structuredDataText(field: FieldDefinition, value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  if (field.fieldType === 'spectral_data') {
    const spectral = value as {
      x?: number[];
      series?: Array<{ name?: string; values?: number[] }>;
    };
    if (!Array.isArray(spectral.x) || !Array.isArray(spectral.series)) return '';
    const header = [
      field.config.xLabel || 'X',
      ...spectral.series.map((series, index) => series.name || `Signal ${index + 1}`),
    ];
    return [
      header,
      ...spectral.x.map((x, rowIndex) => [
        x,
        ...spectral.series!.map((series) => series.values?.[rowIndex] ?? ''),
      ]),
    ]
      .map((row) => row.join('\t'))
      .join('\n');
  }
  const table = value as { columns?: string[]; rows?: unknown[][] };
  if (!Array.isArray(table.columns) || !Array.isArray(table.rows)) return '';
  return [...(field.config.firstRowHeader === false ? [] : [table.columns]), ...table.rows]
    .map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : cell)).join('\t'))
    .join('\n');
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
  if (isStructuredFieldType(field.fieldType)) return parseStructuredData(field, raw);
  return raw;
}

interface GridEditorDraft {
  primary: string;
  secondary: string;
  unit: string;
}

export function gridEditorDraft(
  field: FieldDefinition | undefined,
  value: unknown,
): GridEditorDraft {
  if (!field) return { primary: value === undefined ? '' : String(value), secondary: '', unit: '' };
  if (field.fieldType === 'quantity' || field.fieldType === 'range') {
    const engineering = (value ?? {}) as {
      value?: string;
      unit?: string;
      lower?: { value: string; unit: string };
      upper?: { value: string; unit: string };
    };
    return {
      primary:
        field.fieldType === 'quantity'
          ? (engineering.value ?? '')
          : (engineering.lower?.value ?? ''),
      secondary: field.fieldType === 'range' ? (engineering.upper?.value ?? '') : '',
      unit:
        engineering.unit ??
        engineering.lower?.unit ??
        engineering.upper?.unit ??
        field.config.allowedUnits?.[0] ??
        '',
    };
  }
  if (isStructuredFieldType(field.fieldType)) {
    return { primary: structuredDataText(field, value), secondary: '', unit: '' };
  }
  return {
    primary: Array.isArray(value)
      ? value.join(field.fieldType === 'relation' ? '; ' : ', ')
      : value === undefined || value === null
        ? ''
        : field.fieldType === 'datetime'
          ? String(value).slice(0, 16)
          : String(value),
    secondary: '',
    unit: '',
  };
}

export function gridValue(field: FieldDefinition | undefined, draft: GridEditorDraft): unknown {
  const primary = draft.primary.trim();
  if (!field) {
    if (!primary) throw new Error('Display name is required.');
    return primary;
  }
  if (!primary && !draft.secondary.trim()) {
    if (field.required) throw new Error(`${field.name} is required.`);
    return undefined;
  }
  if (field.fieldType === 'quantity') return { value: primary, unit: draft.unit };
  if (field.fieldType === 'range') {
    const secondary = draft.secondary.trim();
    return {
      ...(primary ? { lower: { value: primary, unit: draft.unit } } : {}),
      ...(secondary ? { upper: { value: secondary, unit: draft.unit } } : {}),
    };
  }
  if (field.fieldType === 'boolean') return primary ? primary === 'true' : undefined;
  if (field.fieldType === 'multi_select')
    return primary
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  if (field.fieldType === 'relation')
    return primary
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean);
  if (field.fieldType === 'file' || field.fieldType === 'dataset') return primary ? [primary] : [];
  if (isStructuredFieldType(field.fieldType)) return parseStructuredData(field, draft.primary);
  return primary || undefined;
}

export function parseClipboardGrid(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  return normalized.split('\n').map((row) => row.split('\t'));
}

export function clipboardSafeValue(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ');
}

export function selectionBounds(
  selection: GridSelection | undefined,
  records: DynamicRecord[],
  columns: GridColumn[],
): GridSelectionBounds | undefined {
  if (!selection) return undefined;
  const anchorRow = records.findIndex((record) => record.id === selection.anchor.rowId);
  const focusRow = records.findIndex((record) => record.id === selection.focus.rowId);
  const anchorColumn = columns.findIndex((column) => column.key === selection.anchor.columnKey);
  const focusColumn = columns.findIndex((column) => column.key === selection.focus.columnKey);
  if ([anchorRow, focusRow, anchorColumn, focusColumn].some((index) => index < 0)) return undefined;
  return {
    rowStart: Math.min(anchorRow, focusRow),
    rowEnd: Math.max(anchorRow, focusRow),
    columnStart: Math.min(anchorColumn, focusColumn),
    columnEnd: Math.max(anchorColumn, focusColumn),
  };
}

export function GridCell({
  base,
  comfortable = false,
  field,
  label,
  recordName,
  value,
  onSave,
}: {
  base?: string;
  comfortable?: boolean;
  field?: FieldDefinition;
  label: string;
  recordName: string;
  value: unknown;
  onSave: (value: unknown) => Promise<void>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => gridEditorDraft(field, value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const committing = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(gridEditorDraft(field, value));
  }, [editing, field, value]);

  function beginEditing() {
    setDraft(gridEditorDraft(field, value));
    setError('');
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(gridEditorDraft(field, value));
    setError('');
    setEditing(false);
  }

  async function commit() {
    if (committing.current) return;
    committing.current = true;
    setSaving(true);
    try {
      await onSave(gridValue(field, draft));
      setError('');
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cell could not be saved.');
    } finally {
      committing.current = false;
      setSaving(false);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
    } else if (
      event.key === 'Enter' &&
      (!field || !isStructuredFieldType(field.fieldType) || event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      void commit();
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) void commit();
  }

  if (!editing) {
    return (
      <button
        aria-label={t('data.editCell', { label, record: recordName })}
        className={`group flex w-full items-center justify-between gap-2 px-2.5 text-left text-xs outline-none hover:bg-sky-500/10 focus:bg-sky-500/10 focus:ring-1 focus:ring-inset focus:ring-sky-400 ${comfortable ? 'min-h-11 py-2' : 'min-h-8 py-1'}`}
        onDoubleClick={beginEditing}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'F2') {
            event.preventDefault();
            beginEditing();
          }
        }}
        title={t('data.doubleClickEdit')}
        type="button"
      >
        {field ? (
          <CellValuePreview base={base} field={field} label={label} value={value} />
        ) : (
          <span className="block max-w-64 truncate text-slate-300">{displayValue(value)}</span>
        )}
        <span className="invisible text-xs text-sky-400 group-hover:visible group-focus:visible">
          {t('data.edit')}
        </span>
      </button>
    );
  }

  const common = {
    autoFocus: true,
    className:
      'min-h-9 w-full min-w-0 rounded border border-sky-500 bg-slate-950 px-2 py-1 text-sm text-slate-100 outline-none',
    disabled: saving,
  };
  return (
    <div
      className="w-full min-w-0 max-w-full select-text overflow-hidden p-1"
      data-grid-cell-editor=""
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <div className="grid min-w-0 gap-1">
        {field?.fieldType === 'boolean' ? (
          <select
            {...common}
            aria-label={t('data.valueLabel', { label })}
            value={draft.primary}
            onChange={(event) => setDraft({ ...draft, primary: event.target.value })}
          >
            <option value="">{t('common.unset')}</option>
            <option value="true">{t('common.yes')}</option>
            <option value="false">{t('common.no')}</option>
          </select>
        ) : field?.fieldType === 'single_select' ? (
          <select
            {...common}
            aria-label={t('data.valueLabel', { label })}
            value={draft.primary}
            onChange={(event) => setDraft({ ...draft, primary: event.target.value })}
          >
            <option value="">{t('common.unset')}</option>
            {(field.config.options ?? []).map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        ) : field && isStructuredFieldType(field.fieldType) ? (
          <textarea
            {...common}
            aria-label={t('data.valueLabel', { label })}
            className={`${common.className} resize-y font-mono text-xs`}
            placeholder={
              field.fieldType === 'spectral_data'
                ? 'Wavelength\tSignal 1\n400\t0.12\n401\t0.18'
                : 'Column A\tColumn B\nValue 1\tValue 2'
            }
            value={draft.primary}
            style={{ minHeight: '10rem', whiteSpace: 'pre' }}
            onChange={(event) => setDraft({ ...draft, primary: event.target.value })}
          />
        ) : (
          <input
            {...common}
            aria-label={t('data.valueLabel', { label })}
            inputMode={
              field?.fieldType === 'integer' || field?.fieldType === 'decimal'
                ? 'decimal'
                : undefined
            }
            type={
              field?.fieldType === 'date'
                ? 'date'
                : field?.fieldType === 'datetime'
                  ? 'datetime-local'
                  : 'text'
            }
            value={draft.primary}
            onChange={(event) => setDraft({ ...draft, primary: event.target.value })}
          />
        )}
        {field?.fieldType === 'range' && (
          <input
            {...common}
            aria-label={t('data.upperValueLabel', { label })}
            placeholder={t('data.upper')}
            value={draft.secondary}
            onChange={(event) => setDraft({ ...draft, secondary: event.target.value })}
          />
        )}
        {(field?.fieldType === 'quantity' || field?.fieldType === 'range') && (
          <select
            {...common}
            aria-label={t('data.unitLabel', { label })}
            className={`${common.className} min-w-20`}
            value={draft.unit}
            onChange={(event) => setDraft({ ...draft, unit: event.target.value })}
          >
            {(field.config.allowedUnits ?? []).map((unit) => (
              <option key={unit}>{unit}</option>
            ))}
          </select>
        )}
      </div>
      <div className="mt-1 flex max-w-full flex-wrap items-center justify-end gap-1">
        {field && isStructuredFieldType(field.fieldType) && (
          <span className="mr-auto px-1 text-[10px] text-slate-500">
            {t('data.pasteStructured')}
          </span>
        )}
        <button
          aria-label={t('data.saveField', { label })}
          className="rounded px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10"
          disabled={saving}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void commit()}
          type="button"
        >
          {saving ? t('data.saving') : t('common.save')}
        </button>
        <button
          aria-label={t('data.cancelField', { label })}
          className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
          disabled={saving}
          onMouseDown={(event) => event.preventDefault()}
          onClick={cancelEditing}
          type="button"
        >
          {t('common.cancel')}
        </button>
      </div>
      {error && (
        <p aria-live="polite" className="px-1 pt-1 text-xs text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}

function InlineDraftInput({
  draft,
  field,
  onChange,
  saving,
}: {
  draft: GridEditorDraft;
  field: FieldDefinition;
  onChange: (draft: GridEditorDraft) => void;
  saving: boolean;
}) {
  const { t } = useI18n();
  if (field.fieldType === 'file' && isImageField(field.config)) {
    return (
      <span className="block px-2.5 py-2 text-xs text-slate-500" title={t('data.saveFirst')}>
        저장 후 이미지 첨부
      </span>
    );
  }
  if (field.fieldType === 'measurement') {
    return (
      <span
        className="block px-2.5 py-2 text-xs text-slate-600"
        title={t('data.measurementsAfterSave')}
      >
        {t('data.readOnly')}
      </span>
    );
  }
  if (isStructuredFieldType(field.fieldType)) {
    return (
      <span
        className="block px-2.5 py-2 text-xs text-slate-600"
        title={t('data.openStructuredEditor')}
      >
        {t('data.useFullForm')}
      </span>
    );
  }

  const common =
    'min-h-8 w-full border-0 bg-transparent px-2.5 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:bg-sky-500/10 focus:ring-1 focus:ring-inset focus:ring-sky-400 disabled:opacity-50';
  if (field.fieldType === 'boolean') {
    return (
      <select
        aria-label={`New record ${field.name}`}
        className={common}
        disabled={saving}
        value={draft.primary}
        onChange={(event) => onChange({ ...draft, primary: event.target.value })}
      >
        <option value="">{t('common.unset')}</option>
        <option value="true">{t('common.yes')}</option>
        <option value="false">{t('common.no')}</option>
      </select>
    );
  }
  if (field.fieldType === 'single_select') {
    return (
      <select
        aria-label={`New record ${field.name}`}
        className={common}
        disabled={saving}
        value={draft.primary}
        onChange={(event) => onChange({ ...draft, primary: event.target.value })}
      >
        <option value="">{t('common.select')}</option>
        {(field.config.options ?? []).map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.fieldType === 'quantity' || field.fieldType === 'range') {
    return (
      <div className="flex min-w-0 items-center">
        <input
          aria-label={`New record ${field.name}`}
          className={common}
          disabled={saving}
          inputMode="decimal"
          placeholder={field.fieldType === 'range' ? t('data.lower') : t('data.valuePlaceholder')}
          value={draft.primary}
          onChange={(event) => onChange({ ...draft, primary: event.target.value })}
        />
        {field.fieldType === 'range' && (
          <input
            aria-label={`New record ${field.name} upper`}
            className={`${common} border-l border-slate-800`}
            disabled={saving}
            inputMode="decimal"
            placeholder={t('data.upper')}
            value={draft.secondary}
            onChange={(event) => onChange({ ...draft, secondary: event.target.value })}
          />
        )}
        <select
          aria-label={`New record ${field.name} unit`}
          className={`${common} w-auto min-w-20 border-l border-slate-800 px-2`}
          disabled={saving}
          value={draft.unit}
          onChange={(event) => onChange({ ...draft, unit: event.target.value })}
        >
          {(field.config.allowedUnits ?? []).map((unit) => (
            <option key={unit}>{unit}</option>
          ))}
        </select>
      </div>
    );
  }

  const placeholder =
    field.fieldType === 'relation'
      ? 'Record UUID; …'
      : field.fieldType === 'file' || field.fieldType === 'dataset'
        ? `${field.fieldType} UUID`
        : field.fieldType === 'multi_select'
          ? 'Value, value'
          : field.required
            ? t('data.requiredPlaceholder')
            : t('data.enterValue');
  return (
    <input
      aria-label={`New record ${field.name}`}
      className={common}
      disabled={saving}
      inputMode={
        field.fieldType === 'integer' || field.fieldType === 'decimal' ? 'decimal' : undefined
      }
      placeholder={placeholder}
      type={
        field.fieldType === 'date'
          ? 'date'
          : field.fieldType === 'datetime'
            ? 'datetime-local'
            : 'text'
      }
      value={draft.primary}
      onChange={(event) => onChange({ ...draft, primary: event.target.value })}
    />
  );
}

export function InlineRecordRow({
  fields,
  projects,
  onCancel,
  onCreate,
  onOpenFullForm,
}: {
  fields: FieldDefinition[];
  projects?: WorkspaceDataContext['projects'] | undefined;
  onCancel: () => void;
  onCreate: (
    payload: ReturnType<typeof inlineRecordPayload> & { contextProjectId?: string | null },
  ) => Promise<void>;
  onOpenFullForm: () => void;
}) {
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState('');
  const [contextProjectId, setContextProjectId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, GridEditorDraft>>(() =>
    Object.fromEntries(
      fields.map((field) => [field.id, gridEditorDraft(field, field.defaultValue)]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await onCreate({
        ...inlineRecordPayload(displayName, fields, drafts),
        ...(projects ? { contextProjectId: contextProjectId || null } : {}),
      });
      setDisplayName('');
      setContextProjectId('');
      setDrafts(
        Object.fromEntries(
          fields.map((field) => [field.id, gridEditorDraft(field, field.defaultValue)]),
        ),
      );
      setError('');
      window.requestAnimationFrame(() => nameInput.current?.focus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('data.recordCreateFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <tr
        className="bg-sky-500/[0.04]"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          } else if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !(event.target instanceof HTMLButtonElement) &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            void save();
          }
        }}
      >
        <td className="border-b border-r border-sky-500/30 px-3 text-center font-mono text-sky-400">
          +
        </td>
        <td className="sticky left-0 z-10 border-b border-r border-sky-500/30 bg-slate-950">
          <input
            ref={nameInput}
            aria-label={t('data.newRecordName')}
            autoFocus
            className="min-h-8 w-full border-0 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-slate-100 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-inset focus:ring-sky-400"
            disabled={saving}
            placeholder={t('data.recordNameRequired')}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </td>
        {projects && (
          <td className="border-b border-r border-sky-500/30">
            <select
              aria-label={t('data.newRecordProject')}
              className="min-h-8 w-full border-0 bg-sky-500/10 px-2 py-1 text-xs text-slate-200 outline-none focus:ring-1 focus:ring-inset focus:ring-sky-400"
              disabled={saving}
              value={contextProjectId}
              onChange={(event) => setContextProjectId(event.target.value)}
            >
              <option value="">{t('data.noProject')}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                  {project.archivedAt ? ' (archived)' : ''}
                </option>
              ))}
            </select>
          </td>
        )}
        {fields.map((field) => (
          <td className="border-b border-r border-sky-500/30" key={field.id}>
            <InlineDraftInput
              draft={drafts[field.id] ?? gridEditorDraft(field, field.defaultValue)}
              field={field}
              saving={saving}
              onChange={(draft) =>
                setDrafts((current) => ({
                  ...current,
                  [field.id]: draft,
                }))
              }
            />
          </td>
        ))}
        <td className="border-b border-r border-sky-500/30 px-3 text-xs text-sky-400">
          {t('common.new')}
        </td>
        <td className="border-b border-sky-500/30 px-1">
          <div className="flex items-center justify-center gap-0.5">
            <button
              aria-label={t('data.saveInlineRecord')}
              className="rounded px-2 py-1 text-base text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
              disabled={saving}
              onClick={() => void save()}
              title={t('data.saveRow')}
              type="button"
            >
              {saving ? '…' : '✓'}
            </button>
            <button
              aria-label={t('data.cancelInlineRecord')}
              className="rounded px-2 py-1 text-base text-slate-500 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
              disabled={saving}
              onClick={onCancel}
              title={t('data.cancelEscape')}
              type="button"
            >
              ×
            </button>
          </div>
        </td>
      </tr>
      {error && (
        <tr className="bg-rose-500/[0.04]">
          <td
            className="border-b border-rose-500/20 px-3 py-2"
            colSpan={fields.length + 4 + (projects ? 1 : 0)}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p aria-live="polite" className="text-xs text-rose-300">
                {error}
              </p>
              <button
                className="text-xs text-sky-300 hover:text-sky-200"
                onClick={onOpenFullForm}
                type="button"
              >
                {t('data.openFullForm')}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function inlineRecordPayload(
  displayName: string,
  fields: FieldDefinition[],
  drafts: Record<string, GridEditorDraft>,
) {
  const values: Record<string, unknown> = {};
  const relations: Record<string, string[]> = {};
  const fileReferences: Record<string, string[]> = {};
  const datasetReferences: Record<string, string[]> = {};
  const name = gridValue(undefined, { primary: displayName, secondary: '', unit: '' }) as string;
  for (const field of fields) {
    if (field.fieldType === 'measurement' || calculatedFieldTypeSet.has(field.fieldType)) continue;
    const value = gridValue(field, drafts[field.id] ?? gridEditorDraft(field, field.defaultValue));
    if (field.fieldType === 'relation') {
      const targets = Array.isArray(value) ? (value as string[]) : [];
      if (targets.length) relations[field.id] = targets;
    } else if (field.fieldType === 'file' || field.fieldType === 'dataset') {
      const references = Array.isArray(value) ? (value as string[]) : [];
      if (references.length)
        (field.fieldType === 'file' ? fileReferences : datasetReferences)[field.id] = references;
    } else if (value !== undefined) {
      values[field.key] = value;
    }
  }
  return { displayName: name, values, relations, fileReferences, datasetReferences };
}

export function recordPayload(fields: FieldDefinition[], form: FormData) {
  const values: Record<string, unknown> = {};
  const relations: Record<string, string[]> = {};
  const fileReferences: Record<string, string[]> = {};
  const datasetReferences: Record<string, string[]> = {};
  for (const field of fields) {
    if (field.fieldType === 'measurement' || calculatedFieldTypeSet.has(field.fieldType)) continue;
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
  const { t } = useI18n();
  if (calculatedFieldTypeSet.has(field.fieldType))
    return (
      <p className="mt-1.5 min-h-9 rounded-lg border border-sky-400/15 bg-sky-400/5 px-3 py-2 text-xs text-sky-200">
        {displayFieldValue(field, value)}
        <span className="ml-2 text-[10px] text-slate-500">{t('data.calculatedAutomatically')}</span>
      </p>
    );
  if (field.fieldType === 'measurement')
    return <p className="mt-2 text-xs text-slate-500">{t('data.observationsHint')}</p>;
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
          placeholder={field.fieldType === 'range' ? t('data.lowerBound') : t('data.decimalValue')}
          required={field.required}
        />
        {field.fieldType === 'range' && (
          <input
            className={inputClass}
            defaultValue={quantity.upper?.value}
            name={`upper:${field.key}`}
            placeholder={t('data.upperBound')}
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
  if (isStructuredFieldType(field.fieldType)) {
    return (
      <div>
        <textarea
          aria-label={t('data.tableData', { field: field.name })}
          className={`${inputClass} resize-y font-mono text-xs`}
          defaultValue={structuredDataText(field, value)}
          name={`value:${field.key}`}
          placeholder={
            field.fieldType === 'spectral_data'
              ? 'Wavelength\tSignal 1\n400\t0.12\n401\t0.18'
              : 'Column A\tColumn B\nValue 1\tValue 2'
          }
          required={field.required}
          spellCheck={false}
          style={{ minHeight: '12rem', whiteSpace: 'pre' }}
        />
        <p className="mt-1 text-[10px] text-slate-500">{t('data.excelPasteHint')}</p>
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
        <option value="">{t('common.select')}</option>
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
        <option value="">{t('common.unset')}</option>
        <option value="true">{t('common.yes')}</option>
        <option value="false">{t('common.no')}</option>
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

export function RecordForm({
  fields,
  record,
  projects,
  onSubmit,
  submitLabel,
}: {
  fields: FieldDefinition[];
  record?: DynamicRecord;
  projects?: WorkspaceDataContext['projects'] | undefined;
  onSubmit: (form: FormData) => Promise<void>;
  submitLabel: string;
}) {
  const { t } = useI18n();
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
      setError(cause instanceof Error ? cause.message : t('data.recordSaveFailed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void submit(event)}>
      <label className="block text-sm text-slate-300 md:col-span-2">
        {t('data.displayName')}
        <input
          className={inputClass}
          defaultValue={record?.displayName ?? ''}
          name="displayName"
          required
        />
      </label>
      {projects && (
        <label className="block text-sm text-slate-300 md:col-span-2">
          {t('data.project')}
          <select
            className={inputClass}
            defaultValue={record?.contextProjectId ?? ''}
            name="contextProjectId"
          >
            <option value="">{t('data.noProject')}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
                {project.archivedAt ? ' (archived)' : ''}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-slate-500">{t('data.projectContextHint')}</span>
        </label>
      )}
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
              placeholder={t('data.recordUuids')}
              required={field.required}
            />
          ) : field.fieldType === 'file' && isImageField(field.config) ? (
            <>
              <input
                name={`reference:${field.id}`}
                type="hidden"
                value={record?.fileReferences[field.id]?.[0] ?? ''}
              />
              <span className="mt-1.5 block min-h-9 rounded-lg border border-slate-800 bg-slate-900/55 px-3 py-2 text-xs text-slate-400">
                {record?.fileReferences[field.id]?.length
                  ? '이미지는 그리드 셀에서 미리보기·교체·제거할 수 있습니다.'
                  : '레코드를 저장한 뒤 그리드 셀에서 이미지를 첨부하세요.'}
              </span>
            </>
          ) : field.fieldType === 'file' || field.fieldType === 'dataset' ? (
            <input
              className={inputClass}
              defaultValue={
                (field.fieldType === 'file'
                  ? record?.fileReferences[field.id]
                  : record?.datasetReferences[field.id])?.[0] ?? ''
              }
              name={`reference:${field.id}`}
              placeholder={t('data.exactReference', { type: field.fieldType })}
              required={field.required}
            />
          ) : (
            <FieldInput
              field={field}
              value={record ? record.values[field.key] : field.defaultValue}
            />
          )}
        </label>
      ))}
      <div className="md:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? t('data.saving') : submitLabel}
        </Button>
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  );
}
