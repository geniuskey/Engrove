import { Button } from '@engrove/ui';
import {
  type FocusEvent,
  type FormEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { allowed, api, ApiError, ErrorText, inputClass, NoticeText, type User } from './App.js';
import { useI18n } from './i18n.js';
import { useServiceSidebarPortal } from './ServiceSidebar.js';

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
  defaultValue?: unknown;
  projectionStatus: 'ready' | 'rebuilding' | 'failed';
}

interface DynamicRecord {
  id: string;
  objectTypeId: string;
  contextProjectId?: string | null;
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

export interface WorkspaceDataContext {
  workspaceId: string;
  backingProjectId: string;
  projects: Array<{
    id: string;
    name: string;
    key: string;
    archivedAt: string | null;
  }>;
  legacyProjects?: Array<{ id: string; name: string }>;
}

interface QueryResult {
  items: DynamicRecord[];
  page: number;
  pageSize: number;
  total: number;
  groups?: Array<{ value: string | null; count: number }>;
}

type RecordViewType = 'grid' | 'form' | 'gallery' | 'kanban' | 'calendar';

interface RecordViewConfig {
  visibleFieldIds: string[];
  fieldWidths: Record<string, number>;
  systemFieldWidths?: Partial<Record<SystemFieldWidthKey, number>>;
  filters: Array<{
    fieldId: string;
    operator: string;
    value?: unknown;
  }>;
  sorts: Array<{
    fieldId?: string;
    systemField?: 'displayName' | 'createdAt' | 'updatedAt';
    direction: 'asc' | 'desc';
  }>;
  rowDensity: 'compact' | 'comfortable';
  pageSize: 25 | 50 | 100;
  viewOptions?: {
    groupFieldId?: string;
    dateFieldId?: string;
    contextProjectId?: string | null;
  };
}

type SystemFieldWidthKey = 'displayName' | 'contextProject' | 'updatedAt';

const DEFAULT_FIELD_WIDTH = 176;
const DEFAULT_SYSTEM_FIELD_WIDTHS: Record<SystemFieldWidthKey, number> = {
  displayName: 208,
  contextProject: 192,
  updatedAt: 112,
};
const MIN_COLUMN_WIDTH = 100;
const MAX_COLUMN_WIDTH = 480;
const COLUMN_KEYBOARD_STEP = 8;

interface TableLayoutPreference {
  fieldOrderIds: string[];
  hiddenFieldIds: string[];
  fieldWidths: Record<string, number>;
  systemFieldWidths: Partial<Record<SystemFieldWidthKey, number>>;
}

function clampColumnWidth(width: number) {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

function readTableLayoutPreference(
  key: string,
  fields: FieldDefinition[],
): TableLayoutPreference | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<TableLayoutPreference>;
    const validIds = new Set(fields.map((field) => field.id));
    const preferredOrder = Array.isArray(parsed.fieldOrderIds)
      ? [
          ...new Set(
            parsed.fieldOrderIds.filter(
              (fieldId): fieldId is string => typeof fieldId === 'string' && validIds.has(fieldId),
            ),
          ),
        ]
      : [];
    const orderedSet = new Set(preferredOrder);
    const fieldOrderIds = [
      ...preferredOrder,
      ...fields.map((field) => field.id).filter((fieldId) => !orderedSet.has(fieldId)),
    ];
    const hiddenFieldIds = Array.isArray(parsed.hiddenFieldIds)
      ? parsed.hiddenFieldIds.filter(
          (fieldId): fieldId is string => typeof fieldId === 'string' && validIds.has(fieldId),
        )
      : [];
    const fieldWidths = Object.fromEntries(
      Object.entries(parsed.fieldWidths ?? {}).flatMap(([fieldId, width]) =>
        validIds.has(fieldId) && typeof width === 'number' && Number.isFinite(width)
          ? [[fieldId, clampColumnWidth(width)]]
          : [],
      ),
    );
    const systemFieldWidths = Object.fromEntries(
      (Object.keys(DEFAULT_SYSTEM_FIELD_WIDTHS) as SystemFieldWidthKey[]).flatMap((fieldId) => {
        const width = parsed.systemFieldWidths?.[fieldId];
        return typeof width === 'number' && Number.isFinite(width)
          ? [[fieldId, clampColumnWidth(width)]]
          : [];
      }),
    );
    return { fieldOrderIds, hiddenFieldIds, fieldWidths, systemFieldWidths };
  } catch {
    return undefined;
  }
}

function ColumnResizeHandle({
  columnName,
  resetWidth,
  width,
  onResize,
  onReset,
}: {
  columnName: string;
  resetWidth: number;
  width: number;
  onResize: (width: number) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const drag = useRef<
    { pointerId: number; startX: number; startWidth: number; lastWidth: number } | undefined
  >(undefined);
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (!dragging) return;
    const bodyCursor = document.body.style.cursor;
    const bodyUserSelect = document.body.style.userSelect;
    const rootCursor = document.documentElement.style.cursor;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.documentElement.style.cursor = 'col-resize';
    return () => {
      document.body.style.cursor = bodyCursor;
      document.body.style.userSelect = bodyUserSelect;
      document.documentElement.style.cursor = rootCursor;
    };
  }, [dragging]);

  function finishDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    const finalWidth = drag.current.lastWidth;
    drag.current = undefined;
    setDragging(false);
    setAnnouncement(t('data.widthChanged', { column: columnName, width: finalWidth }));
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <span
      aria-label={t('data.resizeColumn', { column: columnName })}
      aria-orientation="vertical"
      aria-valuemax={MAX_COLUMN_WIDTH}
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuenow={width}
      aria-valuetext={`${width} px`}
      className={`group absolute -right-1.5 inset-y-0 z-40 flex w-3 cursor-col-resize touch-none select-none items-center justify-center outline-none ${dragging ? 'bg-sky-500/10' : ''}`}
      role="separator"
      tabIndex={0}
      title={t('data.resizeColumnHint')}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onReset();
        setAnnouncement(t('data.widthChanged', { column: columnName, width: resetWidth }));
      }}
      onKeyDown={(event) => {
        let nextWidth: number | undefined;
        if (event.key === 'ArrowLeft') nextWidth = width - COLUMN_KEYBOARD_STEP;
        if (event.key === 'ArrowRight') nextWidth = width + COLUMN_KEYBOARD_STEP;
        if (event.key === 'Home') nextWidth = MIN_COLUMN_WIDTH;
        if (event.key === 'End') nextWidth = MAX_COLUMN_WIDTH;
        if (nextWidth === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        const clampedWidth = clampColumnWidth(nextWidth);
        onResize(clampedWidth);
        setAnnouncement(t('data.widthChanged', { column: columnName, width: clampedWidth }));
      }}
      onLostPointerCapture={() => {
        drag.current = undefined;
        setDragging(false);
      }}
      onPointerCancel={finishDrag}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: width,
          lastWidth: width,
        };
        setDragging(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        event.preventDefault();
        const nextWidth = clampColumnWidth(
          drag.current.startWidth + event.clientX - drag.current.startX,
        );
        drag.current.lastWidth = nextWidth;
        onResize(nextWidth);
      }}
      onPointerUp={finishDrag}
    >
      <span
        aria-hidden="true"
        className={`h-full w-px transition-colors ${dragging ? 'bg-sky-400' : 'bg-transparent group-hover:bg-sky-400 group-focus:bg-sky-400'}`}
      />
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </span>
  );
}

interface RecordView {
  id: string;
  objectTypeId: string;
  name: string;
  viewType: RecordViewType;
  config: RecordViewConfig;
  rowVersion: number;
  archivedAt: string | null;
  updatedAt: string;
}

const viewTypeMeta: Record<RecordViewType, { icon: string; label: string }> = {
  grid: { icon: '▦', label: 'Grid' },
  form: { icon: '▤', label: 'Form' },
  gallery: { icon: '▧', label: 'Gallery' },
  kanban: { icon: '▥', label: 'Kanban' },
  calendar: { icon: '□', label: 'Calendar' },
};

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
  'file',
  'dataset',
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

interface GridEditorDraft {
  primary: string;
  secondary: string;
  unit: string;
}

function gridEditorDraft(field: FieldDefinition | undefined, value: unknown): GridEditorDraft {
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

function gridValue(field: FieldDefinition | undefined, draft: GridEditorDraft): unknown {
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
  return primary || undefined;
}

function GridCell({
  comfortable = false,
  field,
  label,
  recordName,
  value,
  onSave,
}: {
  comfortable?: boolean;
  field?: FieldDefinition;
  label: string;
  recordName: string;
  value: unknown;
  onSave: (value: unknown) => Promise<void>;
}) {
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
    } else if (event.key === 'Enter') {
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
        aria-label={`Edit ${label} for ${recordName}`}
        className={`group flex w-full items-center justify-between gap-2 px-2.5 text-left text-xs outline-none hover:bg-sky-500/10 focus:bg-sky-500/10 focus:ring-1 focus:ring-inset focus:ring-sky-400 ${comfortable ? 'min-h-11 py-2' : 'min-h-8 py-1'}`}
        onDoubleClick={beginEditing}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'F2') {
            event.preventDefault();
            beginEditing();
          }
        }}
        title="Double-click or press Enter to edit"
        type="button"
      >
        <span className="block max-w-64 truncate text-slate-300">{displayValue(value)}</span>
        <span className="invisible text-xs text-sky-400 group-hover:visible group-focus:visible">
          Edit
        </span>
      </button>
    );
  }

  const common = {
    autoFocus: true,
    className:
      'min-h-9 w-full min-w-28 rounded border border-sky-500 bg-slate-950 px-2 py-1 text-sm text-slate-100 outline-none',
    disabled: saving,
  };
  return (
    <div className="min-w-44 p-1" onBlur={handleBlur} onKeyDown={handleKeyDown}>
      <div className="flex items-center gap-1">
        {field?.fieldType === 'boolean' ? (
          <select
            {...common}
            aria-label={`${label} value`}
            value={draft.primary}
            onChange={(event) => setDraft({ ...draft, primary: event.target.value })}
          >
            <option value="">Unset</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        ) : field?.fieldType === 'single_select' ? (
          <select
            {...common}
            aria-label={`${label} value`}
            value={draft.primary}
            onChange={(event) => setDraft({ ...draft, primary: event.target.value })}
          >
            <option value="">Unset</option>
            {(field.config.options ?? []).map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            {...common}
            aria-label={`${label} value`}
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
            aria-label={`${label} upper value`}
            placeholder="Upper"
            value={draft.secondary}
            onChange={(event) => setDraft({ ...draft, secondary: event.target.value })}
          />
        )}
        {(field?.fieldType === 'quantity' || field?.fieldType === 'range') && (
          <select
            {...common}
            aria-label={`${label} unit`}
            className={`${common.className} min-w-20`}
            value={draft.unit}
            onChange={(event) => setDraft({ ...draft, unit: event.target.value })}
          >
            {(field.config.allowedUnits ?? []).map((unit) => (
              <option key={unit}>{unit}</option>
            ))}
          </select>
        )}
        <button
          aria-label={`Save ${label}`}
          className="rounded px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10"
          disabled={saving}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void commit()}
          type="button"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          aria-label={`Cancel editing ${label}`}
          className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
          disabled={saving}
          onMouseDown={(event) => event.preventDefault()}
          onClick={cancelEditing}
          type="button"
        >
          Cancel
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
  if (field.fieldType === 'measurement') {
    return (
      <span
        className="block px-2.5 py-2 text-xs text-slate-600"
        title="Measurements are appended after the record exists"
      >
        Read-only
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
        <option value="">Unset</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
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
        <option value="">Select…</option>
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
          placeholder={field.fieldType === 'range' ? 'Lower' : 'Value'}
          value={draft.primary}
          onChange={(event) => onChange({ ...draft, primary: event.target.value })}
        />
        {field.fieldType === 'range' && (
          <input
            aria-label={`New record ${field.name} upper`}
            className={`${common} border-l border-slate-800`}
            disabled={saving}
            inputMode="decimal"
            placeholder="Upper"
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
            ? 'Required'
            : 'Enter value';
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

function InlineRecordRow({
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
      setError(cause instanceof Error ? cause.message : 'Record could not be created.');
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
            aria-label="New record name"
            autoFocus
            className="min-h-8 w-full border-0 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-slate-100 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-inset focus:ring-sky-400"
            disabled={saving}
            placeholder="Record name (required)"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </td>
        {projects && (
          <td className="border-b border-r border-sky-500/30">
            <select
              aria-label="New record project"
              className="min-h-8 w-full border-0 bg-sky-500/10 px-2 py-1 text-xs text-slate-200 outline-none focus:ring-1 focus:ring-inset focus:ring-sky-400"
              disabled={saving}
              value={contextProjectId}
              onChange={(event) => setContextProjectId(event.target.value)}
            >
              <option value="">No project</option>
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
        <td className="border-b border-r border-sky-500/30 px-3 text-xs text-sky-400">New</td>
        <td className="border-b border-sky-500/30 px-1">
          <div className="flex items-center justify-center gap-0.5">
            <button
              aria-label="Save inline record"
              className="rounded px-2 py-1 text-base text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
              disabled={saving}
              onClick={() => void save()}
              title="Save row (Enter)"
              type="button"
            >
              {saving ? '…' : '✓'}
            </button>
            <button
              aria-label="Cancel inline record"
              className="rounded px-2 py-1 text-base text-slate-500 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
              disabled={saving}
              onClick={onCancel}
              title="Cancel (Escape)"
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
                Open full form
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function inlineRecordPayload(
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
    if (field.fieldType === 'measurement') continue;
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
      {projects && (
        <label className="block text-sm text-slate-300 md:col-span-2">
          Project
          <select
            className={inputClass}
            defaultValue={record?.contextProjectId ?? ''}
            name="contextProjectId"
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
                {project.archivedAt ? ' (archived)' : ''}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            Optional context only; the row remains visible in this workspace table.
          </span>
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
            <FieldInput
              field={field}
              value={record ? record.values[field.key] : field.defaultValue}
            />
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

function GalleryRecordsView({
  fields,
  records,
  onOpen,
}: {
  fields: FieldDefinition[];
  records: DynamicRecord[];
  onOpen: (record: DynamicRecord) => void;
}) {
  return (
    <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {records.map((record) => (
        <article
          className="group overflow-hidden rounded-lg border border-slate-800 bg-slate-900/55 hover:border-slate-700"
          key={record.id}
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
                    {displayValue(recordGridValue(record, field))}
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

function KanbanRecordsView({
  field,
  records,
  groups,
  canUpdate,
  onMove,
  onOpen,
}: {
  field: FieldDefinition;
  records: DynamicRecord[];
  groups: QueryResult['groups'];
  canUpdate: boolean;
  onMove: (record: DynamicRecord, value: string) => Promise<void>;
  onOpen: (record: DynamicRecord) => void;
}) {
  const lanes = [{ key: '', label: 'No value' }, ...(field.config.options ?? [])];
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
                  No records
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CalendarRecordsView({
  field,
  month,
  records,
  onMonthChange,
  onOpen,
}: {
  field: FieldDefinition;
  month: Date;
  records: DynamicRecord[];
  onMonthChange: (month: Date) => void;
  onOpen: (record: DynamicRecord) => void;
}) {
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
          aria-label="Previous month"
          className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          onClick={() => onMonthChange(new Date(year, monthIndex - 1, 1))}
          type="button"
        >
          ‹
        </button>
        <h3 className="text-sm font-semibold">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h3>
        <button
          aria-label="Next month"
          className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          onClick={() => onMonthChange(new Date(year, monthIndex + 1, 1))}
          type="button"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 border-l border-t border-slate-800">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
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
                  type="button"
                >
                  {record.displayName}
                </button>
              ))}
              {(byDate.get(cell.key)?.length ?? 0) > 3 && (
                <span className="text-[10px] text-slate-500">
                  +{(byDate.get(cell.key)?.length ?? 0) - 3} more
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
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

function recordGridValue(record: DynamicRecord, field: FieldDefinition): unknown {
  if (field.fieldType === 'relation') return record.relations?.[field.id] ?? [];
  if (field.fieldType === 'file') return record.fileReferences?.[field.id] ?? [];
  if (field.fieldType === 'dataset') return record.datasetReferences?.[field.id] ?? [];
  return record.values[field.key];
}

function configuredSorts(
  sortField: string,
  sortDirection: 'asc' | 'desc',
): RecordViewConfig['sorts'] {
  if (!sortField) return [];
  if (['displayName', 'createdAt', 'updatedAt'].includes(sortField)) {
    return [
      {
        systemField: sortField as 'displayName' | 'createdAt' | 'updatedAt',
        direction: sortDirection,
      },
    ];
  }
  return [{ fieldId: sortField, direction: sortDirection }];
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fieldHasUsableDefault(field: FieldDefinition): boolean {
  const value = field.defaultValue;
  return (
    value !== undefined &&
    value !== null &&
    value !== '' &&
    (!Array.isArray(value) || value.length > 0)
  );
}

export function DataPage({
  user,
  workspaceData,
}: {
  user: User;
  workspaceData?: WorkspaceDataContext;
}) {
  const { t } = useI18n();
  const params = useParams();
  const workspaceId = workspaceData?.workspaceId ?? params.workspaceId ?? '';
  const projectId = workspaceData?.backingProjectId ?? params.projectId ?? '';
  const workspaceMode = Boolean(workspaceData);
  const [search, setSearch] = useSearchParams();
  const base = projectPath(workspaceId, projectId);
  const [objectTypes, setObjectTypes] = useState<ObjectType[]>([]);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [views, setViews] = useState<RecordView[]>([]);
  const [records, setRecords] = useState<QueryResult>({
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(25);
  const [sortField, setSortField] = useState('displayName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filterField, setFilterField] = useState('');
  const [filterOperator, setFilterOperator] = useState('eq');
  const [filterValue, setFilterValue] = useState('');
  const [debouncedFilterValue, setDebouncedFilterValue] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [debouncedSearchValue, setDebouncedSearchValue] = useState('');
  const [contextProjectFilter, setContextProjectFilter] = useState('all');
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [activeTool, setActiveTool] = useState<'fields' | 'filter' | 'sort' | null>(null);
  const [hiddenFieldIds, setHiddenFieldIds] = useState<Set<string>>(() => new Set());
  const [fieldOrderIds, setFieldOrderIds] = useState<string[]>([]);
  const [fieldWidths, setFieldWidths] = useState<Record<string, number>>({});
  const [systemFieldWidths, setSystemFieldWidths] = useState<
    Partial<Record<SystemFieldWidthKey, number>>
  >({});
  const [draggedFieldId, setDraggedFieldId] = useState('');
  const [dragTarget, setDragTarget] = useState<{
    fieldId: string;
    position: 'before' | 'after';
  }>();
  const [layoutAnnouncement, setLayoutAnnouncement] = useState('');
  const [rowDensity, setRowDensity] = useState<'compact' | 'comfortable'>('compact');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(() => new Set());
  const [selectedRecord, setSelectedRecord] = useState<DynamicRecord>();
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const [showNewRecord, setShowNewRecord] = useState(false);
  const [showInlineRecord, setShowInlineRecord] = useState(false);
  const [typesLoading, setTypesLoading] = useState(true);
  const [viewsLoading, setViewsLoading] = useState(false);
  const [contextObjectTypeId, setContextObjectTypeId] = useState('');
  const [viewBusy, setViewBusy] = useState(false);
  const [showCreateView, setShowCreateView] = useState(false);
  const [newViewType, setNewViewType] = useState<RecordViewType>('grid');
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const [csvResult, setCsvResult] = useState<CsvResult>();
  const appliedViewKey = useRef('');
  const pendingViewId = useRef('');
  const layoutPreferenceReadyKey = useRef('');
  const recordsRequestId = useRef(0);
  const sidebarPortal = useServiceSidebarPortal();
  const selectedId = search.get('type') ?? objectTypes[0]?.id ?? '';
  const selectedViewId = search.get('view') ?? 'all';
  const selected = objectTypes.find((objectType) => objectType.id === selectedId);
  const selectedView = views.find((view) => view.id === selectedViewId);
  const layoutPreferenceKey = `engrove:table-layout:${workspaceId}:${projectId}:${selectedId}`;
  const activeViewType = selectedView?.viewType ?? 'grid';
  const kanbanField = fields.find(
    (field) => field.id === selectedView?.config.viewOptions?.groupFieldId,
  );
  const calendarField = fields.find(
    (field) => field.id === selectedView?.config.viewOptions?.dateFieldId,
  );
  const availableFieldTypes = workspaceMode
    ? fieldTypes.filter((type) => !['measurement', 'file', 'dataset'].includes(type))
    : fieldTypes;
  const orderedFields = useMemo(() => {
    const position = new Map(fieldOrderIds.map((fieldId, index) => [fieldId, index]));
    return [...fields].sort((left, right) => {
      const leftPosition = position.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightPosition = position.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      return (
        leftPosition - rightPosition ||
        left.position - right.position ||
        left.id.localeCompare(right.id)
      );
    });
  }, [fieldOrderIds, fields]);
  const visibleFields = useMemo(
    () => orderedFields.filter((field) => !hiddenFieldIds.has(field.id)),
    [hiddenFieldIds, orderedFields],
  );
  const displayNameWidth = systemFieldWidths.displayName ?? DEFAULT_SYSTEM_FIELD_WIDTHS.displayName;
  const contextProjectWidth =
    systemFieldWidths.contextProject ?? DEFAULT_SYSTEM_FIELD_WIDTHS.contextProject;
  const updatedAtWidth = systemFieldWidths.updatedAt ?? DEFAULT_SYSTEM_FIELD_WIDTHS.updatedAt;
  const adjustedWidthCount =
    Object.keys(fieldWidths).length + Object.keys(systemFieldWidths).length;
  const gridTableWidth = Math.max(
    880,
    80 +
      displayNameWidth +
      (workspaceMode ? contextProjectWidth : 0) +
      visibleFields.reduce(
        (total, field) => total + (fieldWidths[field.id] ?? DEFAULT_FIELD_WIDTH),
        0,
      ) +
      updatedAtWidth +
      80,
  );
  const hiddenRequiredFields = useMemo(
    () =>
      orderedFields.filter(
        (field) =>
          hiddenFieldIds.has(field.id) &&
          field.required &&
          field.fieldType !== 'measurement' &&
          (!fieldHasUsableDefault(field) ||
            ['relation', 'file', 'dataset'].includes(field.fieldType)),
      ),
    [hiddenFieldIds, orderedFields],
  );
  const formFields = useMemo(
    () => [
      ...visibleFields,
      ...orderedFields.filter(
        (field) =>
          hiddenFieldIds.has(field.id) &&
          field.required &&
          field.fieldType !== 'measurement' &&
          (!fieldHasUsableDefault(field) ||
            ['relation', 'file', 'dataset'].includes(field.fieldType)),
      ),
    ],
    [hiddenFieldIds, orderedFields, visibleFields],
  );
  const currentViewConfig = useMemo<RecordViewConfig>(() => {
    const widths = Object.fromEntries(
      orderedFields.flatMap((field) =>
        fieldWidths[field.id] ? [[field.id, fieldWidths[field.id]!] as const] : [],
      ),
    );
    const preservedOptions = selectedView?.config.viewOptions ?? {};
    const viewOptions = {
      ...(preservedOptions.groupFieldId ? { groupFieldId: preservedOptions.groupFieldId } : {}),
      ...(preservedOptions.dateFieldId ? { dateFieldId: preservedOptions.dateFieldId } : {}),
      ...(workspaceMode && contextProjectFilter !== 'all'
        ? {
            contextProjectId: contextProjectFilter === 'none' ? null : contextProjectFilter,
          }
        : {}),
    };
    return {
      visibleFieldIds: visibleFields.map((field) => field.id),
      fieldWidths: widths,
      ...(Object.keys(systemFieldWidths).length ? { systemFieldWidths } : {}),
      filters:
        filterField && (filterOperator === 'is_null' || filterValue)
          ? [
              {
                fieldId: filterField,
                operator: filterOperator,
                ...(filterOperator === 'is_null' ? {} : { value: filterValue }),
              },
            ]
          : [],
      sorts: configuredSorts(sortField, sortDirection),
      rowDensity,
      pageSize,
      ...(Object.keys(viewOptions).length ? { viewOptions } : {}),
    };
  }, [
    fieldWidths,
    filterField,
    filterOperator,
    filterValue,
    orderedFields,
    pageSize,
    rowDensity,
    contextProjectFilter,
    selectedView?.config.viewOptions,
    sortDirection,
    sortField,
    systemFieldWidths,
    visibleFields,
    workspaceMode,
  ]);
  const viewDirty = Boolean(
    selectedView && JSON.stringify(currentViewConfig) !== JSON.stringify(selectedView.config),
  );

  function cycleSort(column: string) {
    if (sortField !== column) {
      setSortField(column);
      setSortDirection('asc');
    } else if (sortDirection === 'asc') {
      setSortDirection('desc');
    } else {
      setSortField('');
      setSortDirection('asc');
    }
    setPage(1);
  }

  const applyViewConfig = useCallback(
    (config?: RecordViewConfig) => {
      const validFieldIds = new Set(fields.map((field) => field.id));
      if (!config) {
        const preference = readTableLayoutPreference(layoutPreferenceKey, fields);
        setFieldOrderIds(preference?.fieldOrderIds ?? fields.map((field) => field.id));
        setHiddenFieldIds(new Set(preference?.hiddenFieldIds ?? []));
        setFieldWidths(preference?.fieldWidths ?? {});
        setSystemFieldWidths(preference?.systemFieldWidths ?? {});
        layoutPreferenceReadyKey.current = layoutPreferenceKey;
        setFilterField('');
        setFilterOperator('eq');
        setFilterValue('');
        setSortField('displayName');
        setSortDirection('asc');
        setRowDensity('compact');
        setPageSize(25);
        setContextProjectFilter('all');
        setPage(1);
        return;
      }
      const visibleIds = config.visibleFieldIds.filter((fieldId) => validFieldIds.has(fieldId));
      layoutPreferenceReadyKey.current = '';
      const visibleSet = new Set(visibleIds);
      setFieldOrderIds([
        ...visibleIds,
        ...fields.map((field) => field.id).filter((fieldId) => !visibleSet.has(fieldId)),
      ]);
      setHiddenFieldIds(
        new Set(fields.map((field) => field.id).filter((fieldId) => !visibleSet.has(fieldId))),
      );

      setFieldWidths(
        Object.fromEntries(
          Object.entries(config.fieldWidths).filter(([fieldId]) => validFieldIds.has(fieldId)),
        ),
      );
      setSystemFieldWidths(config.systemFieldWidths ?? {});
      const filter = config.filters[0];
      setFilterField(filter?.fieldId && validFieldIds.has(filter.fieldId) ? filter.fieldId : '');
      setFilterOperator(filter?.operator ?? 'eq');
      setFilterValue(filter?.value === undefined ? '' : String(filter.value));
      const sort = config.sorts[0];
      setSortField(
        sort?.systemField ?? (sort?.fieldId && validFieldIds.has(sort.fieldId) ? sort.fieldId : ''),
      );
      setSortDirection(sort?.direction ?? 'asc');
      setRowDensity(config.rowDensity);
      setPageSize(config.pageSize);
      setContextProjectFilter(
        config.viewOptions && 'contextProjectId' in config.viewOptions
          ? (config.viewOptions.contextProjectId ?? 'none')
          : 'all',
      );
      setPage(1);
    },
    [fields, layoutPreferenceKey],
  );

  useEffect(() => {
    if (
      !selectedId ||
      selectedViewId !== 'all' ||
      layoutPreferenceReadyKey.current !== layoutPreferenceKey
    )
      return;
    try {
      window.localStorage.setItem(
        layoutPreferenceKey,
        JSON.stringify({
          fieldOrderIds,
          hiddenFieldIds: [...hiddenFieldIds],
          fieldWidths,
          systemFieldWidths,
        } satisfies TableLayoutPreference),
      );
    } catch {
      // Local preferences are optional; table editing must continue if storage is unavailable.
    }
  }, [
    fieldOrderIds,
    fieldWidths,
    hiddenFieldIds,
    layoutPreferenceKey,
    selectedId,
    selectedViewId,
    systemFieldWidths,
  ]);

  const loadTypes = useCallback(async () => {
    setTypesLoading(true);
    try {
      const result = await api<{ items: ObjectType[] }>(`${base}/object-types`);
      setObjectTypes(result.items);
      if (!search.get('type') && result.items[0])
        setSearch({ type: result.items[0].id }, { replace: true });
      setMessage('');
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Object types could not be loaded.');
    } finally {
      setTypesLoading(false);
    }
  }, [base, search, setSearch]);

  useEffect(() => void loadTypes(), [loadTypes]);

  const loadDataContext = useCallback(async () => {
    if (!selectedId) {
      setFields([]);
      setViews([]);
      setContextObjectTypeId('');
      return;
    }
    setViewsLoading(true);
    try {
      const [fieldResult, viewResult] = await Promise.all([
        api<{ items: FieldDefinition[] }>(`${base}/object-types/${selectedId}/fields`),
        api<{ items: RecordView[] }>(`${base}/object-types/${selectedId}/views`),
      ]);
      setFields(fieldResult.items);
      setViews(viewResult.items);
      setContextObjectTypeId(selectedId);
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Table context could not be loaded.');
    } finally {
      setViewsLoading(false);
    }
  }, [base, selectedId]);

  useEffect(() => void loadDataContext(), [loadDataContext]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedFilterValue(filterValue), 250);
    return () => window.clearTimeout(timer);
  }, [filterValue]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearchValue(searchValue.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchValue]);

  useEffect(() => {
    setSelectedRows(new Set());
    setSelectedRecord(undefined);
    setActiveTool(null);
    setShowCreateView(false);
    setNewViewType('grid');
    setShowInlineRecord(false);
    setSearchValue('');
    setDebouncedSearchValue('');
    setContextProjectFilter('all');
    setContextObjectTypeId('');
    setDraggedFieldId('');
    setDragTarget(undefined);
    setLayoutAnnouncement('');
    appliedViewKey.current = '';
    pendingViewId.current = '';
  }, [selectedId]);

  useLayoutEffect(() => {
    if (!selectedId || contextObjectTypeId !== selectedId || viewsLoading) return;
    if (pendingViewId.current && pendingViewId.current !== selectedViewId) return;
    if (pendingViewId.current === selectedViewId) pendingViewId.current = '';
    if (selectedViewId === 'all') {
      const key = `${selectedId}:all:${fields.map((field) => field.id).join(',')}`;
      if (appliedViewKey.current === key) return;
      appliedViewKey.current = key;
      applyViewConfig();
      return;
    }
    const view = views.find((candidate) => candidate.id === selectedViewId);
    if (view) {
      const key = `${selectedId}:${view.id}:${view.rowVersion}:${fields.map((field) => field.id).join(',')}`;
      if (appliedViewKey.current === key) return;
      appliedViewKey.current = key;
      applyViewConfig(view.config);
      return;
    }
    setSearch({ type: selectedId }, { replace: true });
  }, [
    applyViewConfig,
    contextObjectTypeId,
    fields,
    selectedId,
    selectedViewId,
    setSearch,
    views,
    viewsLoading,
  ]);

  useEffect(() => {
    setSelectedRows(new Set());
    setSelectedRecord(undefined);
  }, [
    activeViewType,
    calendarField,
    calendarMonth,
    contextProjectFilter,
    debouncedFilterValue,
    debouncedSearchValue,
    filterField,
    page,
    pageSize,
    sortDirection,
    sortField,
  ]);

  useEffect(() => {
    if (!selectedRecord && !showNewRecord && !showInlineRecord) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedRecord(undefined);
        setShowNewRecord(false);
        setShowInlineRecord(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedRecord, showInlineRecord, showNewRecord]);

  const queryBody = useMemo(() => {
    const filters: Array<{ fieldId: string; operator: string; value?: unknown }> =
      filterField && (filterOperator === 'is_null' || debouncedFilterValue)
        ? [
            {
              fieldId: filterField,
              operator: filterOperator,
              ...(filterOperator === 'is_null' ? {} : { value: debouncedFilterValue }),
            },
          ]
        : [];
    if (activeViewType === 'calendar' && calendarField) {
      const nextMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
      const datetime = calendarField.fieldType === 'datetime';
      filters.push(
        {
          fieldId: calendarField.id,
          operator: 'gte',
          value: datetime
            ? `${localDateKey(calendarMonth)}T00:00:00.000Z`
            : localDateKey(calendarMonth),
        },
        {
          fieldId: calendarField.id,
          operator: 'lt',
          value: datetime ? `${localDateKey(nextMonth)}T00:00:00.000Z` : localDateKey(nextMonth),
        },
      );
    }
    const sorts = configuredSorts(sortField, sortDirection);
    return {
      filters,
      sorts,
      ...(debouncedSearchValue ? { search: debouncedSearchValue } : {}),
      ...(workspaceMode && contextProjectFilter !== 'all'
        ? {
            contextProjectId: contextProjectFilter === 'none' ? null : contextProjectFilter,
          }
        : {}),
      ...(activeViewType === 'kanban' && kanbanField ? { groupByFieldId: kanbanField.id } : {}),
      page,
      pageSize: ['kanban', 'calendar'].includes(activeViewType) ? 100 : pageSize,
    };
  }, [
    activeViewType,
    calendarField,
    calendarMonth,
    contextProjectFilter,
    debouncedFilterValue,
    debouncedSearchValue,
    filterField,
    filterOperator,
    kanbanField,
    page,
    pageSize,
    sortDirection,
    sortField,
    workspaceMode,
  ]);

  const loadRecords = useCallback(async () => {
    if (!selectedId) return;
    const requestId = ++recordsRequestId.current;
    setRecordsLoading(true);
    try {
      const recordResult = await api<QueryResult>(
        `${base}/object-types/${selectedId}/records/query`,
        {
          method: 'POST',
          body: JSON.stringify(queryBody),
        },
      );
      if (requestId === recordsRequestId.current) {
        setRecords(recordResult);
        setMessage('');
      }
    } catch (cause) {
      if (requestId === recordsRequestId.current) {
        setMessageTone('error');
        setMessage(cause instanceof Error ? cause.message : 'Records could not be loaded.');
      }
    } finally {
      if (requestId === recordsRequestId.current) setRecordsLoading(false);
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
      await loadTypes();
      setMessageTone('success');
      setMessage(result.changed ? 'Template installed.' : 'Template is already current.');
    } catch (cause) {
      setMessageTone('error');
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
      setMessageTone('error');
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
      await Promise.all([loadDataContext(), loadRecords()]);
    } catch (cause) {
      setMessageTone('error');
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
      setMessageTone('error');
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
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'CSV export failed.');
    }
  }

  async function saveGridCell(
    record: DynamicRecord,
    target: 'displayName' | FieldDefinition,
    value: unknown,
  ) {
    const values = { ...record.values };
    const relations = { ...(record.relations ?? {}) };
    const fileReferences = { ...(record.fileReferences ?? {}) };
    const datasetReferences = { ...(record.datasetReferences ?? {}) };
    let displayName = record.displayName;

    if (target === 'displayName') {
      displayName = String(value);
    } else if (target.fieldType === 'relation') {
      const targets = value as string[];
      if (targets.length) relations[target.id] = targets;
      else delete relations[target.id];
    } else if (target.fieldType === 'file' || target.fieldType === 'dataset') {
      const references = value as string[];
      const map = target.fieldType === 'file' ? fileReferences : datasetReferences;
      if (references.length) map[target.id] = references;
      else delete map[target.id];
    } else {
      if (value === undefined) delete values[target.key];
      else values[target.key] = value;
    }

    try {
      const updated = await api<DynamicRecord>(
        `${base}/object-types/${record.objectTypeId}/records/${record.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            displayName,
            contextProjectId: record.contextProjectId ?? null,
            values,
            relations,
            fileReferences,
            datasetReferences,
            rowVersion: record.rowVersion,
          }),
        },
      );
      setRecords((current) => ({
        ...current,
        items: current.items.map((item) => (item.id === updated.id ? updated : item)),
      }));
      setSelectedRecord((current) => (current?.id === updated.id ? updated : current));
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') await loadRecords();
      throw cause;
    }
  }

  async function saveProjectCell(record: DynamicRecord, contextProjectId: string | null) {
    try {
      const updated = await api<DynamicRecord>(
        `${base}/object-types/${record.objectTypeId}/records/${record.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            displayName: record.displayName,
            contextProjectId,
            values: record.values,
            relations: record.relations ?? {},
            fileReferences: record.fileReferences ?? {},
            datasetReferences: record.datasetReferences ?? {},
            rowVersion: record.rowVersion,
          }),
        },
      );
      setRecords((current) => ({
        ...current,
        items: current.items.map((item) => (item.id === updated.id ? updated : item)),
      }));
      setSelectedRecord((current) => (current?.id === updated.id ? updated : current));
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') await loadRecords();
      throw cause;
    }
  }

  async function saveRecordPanel(record: DynamicRecord, form: FormData) {
    const updated = await api<DynamicRecord>(
      `${base}/object-types/${record.objectTypeId}/records/${record.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          ...recordPayload(fields, form),
          ...(workspaceMode
            ? { contextProjectId: String(form.get('contextProjectId') ?? '') || null }
            : { contextProjectId: record.contextProjectId ?? null }),
          rowVersion: record.rowVersion,
        }),
      },
    );
    setRecords((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === updated.id ? updated : item)),
    }));
    setSelectedRecord(updated);
    setMessageTone('success');
    setMessage(`${updated.displayName} saved.`);
  }

  async function createInlineRecord(
    payload: ReturnType<typeof inlineRecordPayload> & { contextProjectId?: string | null },
  ) {
    const created = await api<DynamicRecord>(`${base}/object-types/${selectedId}/records`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await loadRecords();
    setMessageTone('success');
    setMessage(`${created.displayName} created. The next blank row is ready.`);
  }

  function chooseView(viewId: string) {
    setSelectedRows(new Set());
    setSelectedRecord(undefined);
    const view = views.find((candidate) => candidate.id === viewId);
    pendingViewId.current = viewId;
    appliedViewKey.current =
      viewId === 'all'
        ? `${selectedId}:all:${fields.map((field) => field.id).join(',')}`
        : `${selectedId}:${viewId}:${view?.rowVersion ?? 0}:${fields.map((field) => field.id).join(',')}`;
    applyViewConfig(view?.config);
    setSearch(viewId === 'all' ? { type: selectedId } : { type: selectedId, view: viewId });
  }

  function moveField(fieldId: string, direction: -1 | 1) {
    const currentIndex = orderedFields.findIndex((field) => field.id === fieldId);
    const targetField = orderedFields[currentIndex + direction];
    const movingField = orderedFields[currentIndex];
    if (!movingField || !targetField) return;
    setFieldOrderIds((current) => {
      const order = current.length ? [...current] : fields.map((field) => field.id);
      const index = order.indexOf(fieldId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= order.length) return order;
      [order[index], order[target]] = [order[target]!, order[index]!];
      return order;
    });
    setLayoutAnnouncement(
      t('data.columnMoved', { column: movingField.name, target: targetField.name }),
    );
  }

  function reorderField(
    sourceFieldId: string,
    targetFieldId: string,
    position: 'before' | 'after',
  ) {
    if (sourceFieldId === targetFieldId) return;
    const sourceField = fields.find((field) => field.id === sourceFieldId);
    const targetField = fields.find((field) => field.id === targetFieldId);
    if (!sourceField || !targetField) return;
    setFieldOrderIds((current) => {
      const order = current.length ? [...current] : fields.map((field) => field.id);
      const sourceIndex = order.indexOf(sourceFieldId);
      if (sourceIndex < 0) return order;
      order.splice(sourceIndex, 1);
      const targetIndex = order.indexOf(targetFieldId);
      if (targetIndex < 0) return order;
      order.splice(targetIndex + (position === 'after' ? 1 : 0), 0, sourceFieldId);
      return order;
    });
    setLayoutAnnouncement(
      t('data.columnMoved', { column: sourceField.name, target: targetField.name }),
    );
  }

  async function createView(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const viewType = String(data.get('viewType') ?? 'grid') as RecordViewType;
    if (!name) return;
    const groupFieldId = String(data.get('groupFieldId') ?? '');
    const dateFieldId = String(data.get('dateFieldId') ?? '');
    if (viewType === 'kanban' && !groupFieldId) {
      setMessageTone('error');
      setMessage('Choose a single-select grouping field for the Kanban view.');
      return;
    }
    if (viewType === 'calendar' && !dateFieldId) {
      setMessageTone('error');
      setMessage('Choose a date field for the Calendar view.');
      return;
    }
    const config: RecordViewConfig = {
      ...currentViewConfig,
      ...(viewType === 'kanban'
        ? { viewOptions: { ...currentViewConfig.viewOptions, groupFieldId } }
        : viewType === 'calendar'
          ? { viewOptions: { ...currentViewConfig.viewOptions, dateFieldId } }
          : {}),
    };
    setViewBusy(true);
    try {
      const created = await api<RecordView>(`${base}/object-types/${selectedId}/views`, {
        method: 'POST',
        body: JSON.stringify({ name, viewType, config }),
      });
      pendingViewId.current = created.id;
      appliedViewKey.current = `${selectedId}:${created.id}:${created.rowVersion}:${fields.map((field) => field.id).join(',')}`;
      setViews((current) =>
        [...current, created].sort((left, right) => left.name.localeCompare(right.name)),
      );
      setShowCreateView(false);
      setNewViewType('grid');
      form.reset();
      setSearch({ type: selectedId, view: created.id });
      setMessageTone('success');
      setMessage(`View “${created.name}” created and shared with this project.`);
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'View could not be created.');
    } finally {
      setViewBusy(false);
    }
  }

  async function saveView() {
    if (!selectedView) return;
    setViewBusy(true);
    try {
      const updated = await api<RecordView>(
        `${base}/object-types/${selectedId}/views/${selectedView.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: selectedView.name,
            viewType: selectedView.viewType,
            config: currentViewConfig,
            rowVersion: selectedView.rowVersion,
          }),
        },
      );
      setViews((current) => current.map((view) => (view.id === updated.id ? updated : view)));
      setMessageTone('success');
      setMessage(`View “${updated.name}” saved.`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') await loadDataContext();
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'View could not be saved.');
    } finally {
      setViewBusy(false);
    }
  }

  async function renameView(view: RecordView) {
    const name = window.prompt('Rename view', view.name)?.trim();
    if (!name || name === view.name) return;
    setViewBusy(true);
    try {
      const updated = await api<RecordView>(`${base}/object-types/${selectedId}/views/${view.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          viewType: view.viewType,
          config: view.config,
          rowVersion: view.rowVersion,
        }),
      });
      setViews((current) =>
        current
          .map((candidate) => (candidate.id === updated.id ? updated : candidate))
          .sort((left, right) => left.name.localeCompare(right.name)),
      );
      setMessageTone('success');
      setMessage(`View renamed to “${updated.name}”.`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') await loadDataContext();
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'View could not be renamed.');
    } finally {
      setViewBusy(false);
    }
  }

  async function duplicateView(view: RecordView) {
    const names = new Set(views.map((candidate) => candidate.name.toLocaleLowerCase()));
    let name = `${view.name} copy`;
    let copy = 2;
    while (names.has(name.toLocaleLowerCase())) name = `${view.name} copy ${copy++}`;
    setViewBusy(true);
    try {
      const created = await api<RecordView>(`${base}/object-types/${selectedId}/views`, {
        method: 'POST',
        body: JSON.stringify({ name, viewType: view.viewType, config: view.config }),
      });
      setViews((current) =>
        [...current, created].sort((left, right) => left.name.localeCompare(right.name)),
      );
      chooseView(created.id);
      setMessageTone('success');
      setMessage(`View “${created.name}” duplicated.`);
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'View could not be duplicated.');
    } finally {
      setViewBusy(false);
    }
  }

  async function archiveView(target = selectedView) {
    if (!target) return;
    if (!window.confirm(`Archive the shared view “${target.name}”?`)) return;
    setViewBusy(true);
    try {
      await api(`${base}/object-types/${selectedId}/views/${target.id}/archive`, {
        method: 'POST',
        body: JSON.stringify({
          rowVersion: target.rowVersion,
          reason: 'Archived from the data workspace',
        }),
      });
      setViews((current) => current.filter((view) => view.id !== target.id));
      if (selectedViewId === target.id) chooseView('all');
      setMessageTone('success');
      setMessage(`View “${target.name}” archived.`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') await loadDataContext();
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'View could not be archived.');
    } finally {
      setViewBusy(false);
    }
  }

  async function archiveSelectedRows() {
    if (!selectedRows.size) return;
    if (!window.confirm(`Archive ${selectedRows.size} selected record(s)? History is preserved.`))
      return;
    setBulkBusy(true);
    try {
      await Promise.all(
        [...selectedRows].map((recordId) => {
          const record = records.items.find((candidate) => candidate.id === recordId);
          if (!record) return Promise.resolve();
          return api(`${base}/object-types/${record.objectTypeId}/records/${record.id}/archive`, {
            method: 'POST',
            body: JSON.stringify({ reason: 'Archived from grid bulk action' }),
          });
        }),
      );
      setSelectedRows(new Set());
      setMessageTone('success');
      setMessage('Selected records archived.');
      await loadRecords();
    } catch (cause) {
      setMessageTone('error');
      setMessage(
        cause instanceof Error ? cause.message : 'Selected records could not be archived.',
      );
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <h1 className="sr-only">
          {workspaceMode ? t('data.workspaceData') : t('common.engineeringRecords')}
        </h1>
        {!workspaceMode && allowed(user, 'schema.manage') && (
          <Button variant="quiet" onClick={() => void installTemplate()}>
            {t('data.installTemplate')}
          </Button>
        )}
      </div>
      <NoticeText tone={messageTone}>{message}</NoticeText>
      {workspaceMode && Boolean(workspaceData?.legacyProjects?.length) && (
        <NoticeText tone="info">
          Existing project-owned engineering tables were preserved during the workspace-data
          upgrade. Open{' '}
          {workspaceData!.legacyProjects!.map((project, index) => (
            <span key={project.id}>
              {index > 0 ? ', ' : ''}
              <Link
                className="font-medium text-sky-300 hover:text-sky-200"
                to={`/workspaces/${workspaceId}/projects/${project.id}/data`}
              >
                {project.name}
              </Link>
            </span>
          ))}{' '}
          to continue using traceable records and their project-scoped resources.
        </NoticeText>
      )}

      {sidebarPortal &&
        createPortal(
          <nav aria-label="Data navigation" className="p-2">
            <div className="mb-1 px-2 py-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                {workspaceMode ? t('data.workspaceTables') : t('data.engineeringTables')}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-600">
                {t('data.tableCount', { count: objectTypes.length })}
              </p>
            </div>
            {typesLoading && (
              <div className="space-y-2 px-3 py-4" aria-label="Loading object types">
                <div className="h-8 animate-pulse rounded bg-slate-800" />
                <div className="h-8 animate-pulse rounded bg-slate-800" />
              </div>
            )}
            {!typesLoading && objectTypes.length === 0 && (
              <p className="px-3 py-4 text-sm text-slate-400">
                {workspaceMode
                  ? 'No tables yet. Create the first shared table below.'
                  : 'No schema yet. Install the template or create one below.'}
              </p>
            )}
            <div aria-label="Tables and views" className="space-y-0.5">
              {objectTypes.map((objectType) => {
                const activeTable = selectedId === objectType.id;
                return (
                  <div key={objectType.id}>
                    <button
                      aria-expanded={activeTable}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${activeTable ? 'bg-slate-800 font-medium text-slate-100' : 'text-slate-300 hover:bg-slate-800'}`}
                      onClick={() => {
                        setPage(1);
                        setSortField('displayName');
                        setSortDirection('asc');
                        setFilterField('');
                        setFilterValue('');
                        setSearch({ type: objectType.id });
                      }}
                      type="button"
                    >
                      <span className="w-3 text-[10px] text-slate-500">
                        {activeTable ? '▾' : '▸'}
                      </span>
                      <span className="text-slate-500">▦</span>
                      <span className="truncate">{objectType.pluralName}</span>
                    </button>
                    {activeTable && (
                      <div className="ml-3 border-l border-slate-700/80 py-1 pl-2">
                        <div className="flex items-center justify-between px-2 py-1">
                          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                            {t('data.views')}
                          </span>
                          {allowed(user, 'schema.manage') && (
                            <button
                              aria-label={t('data.createView')}
                              className="grid size-5 place-items-center rounded text-sm leading-none text-slate-500 hover:bg-slate-800 hover:text-sky-300"
                              onClick={() => setShowCreateView((value) => !value)}
                              type="button"
                            >
                              +
                            </button>
                          )}
                        </div>
                        <button
                          aria-label={t('data.allRecords')}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${selectedViewId === 'all' ? 'bg-sky-500/15 text-sky-200' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}
                          onClick={() => chooseView('all')}
                          type="button"
                        >
                          <span className="text-sky-400">▦</span>
                          <span className="truncate">{t('data.allRecords')}</span>
                        </button>
                        {viewsLoading && (
                          <div className="mx-2 my-1 h-7 animate-pulse rounded bg-slate-800" />
                        )}
                        {!viewsLoading &&
                          views.map((view) => (
                            <div className="group/view relative flex items-center" key={view.id}>
                              <button
                                aria-label={view.name}
                                className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-xs ${selectedViewId === view.id ? 'bg-sky-500/15 text-sky-200' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}
                                onClick={() => chooseView(view.id)}
                                type="button"
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <span className="text-sky-400">
                                    {viewTypeMeta[view.viewType].icon}
                                  </span>
                                  <span className="truncate">{view.name}</span>
                                </span>
                              </button>
                              {allowed(user, 'schema.manage') && (
                                <details className="relative -ml-6">
                                  <summary
                                    aria-label={`Actions for view ${view.name}`}
                                    className="grid size-6 list-none cursor-pointer place-items-center rounded text-slate-600 opacity-0 marker:content-none hover:bg-slate-700 hover:text-slate-200 group-hover/view:opacity-100 focus:opacity-100"
                                  >
                                    ⋯
                                  </summary>
                                  <div className="absolute right-0 top-7 z-40 grid min-w-32 gap-0.5 rounded-md border border-slate-700 bg-slate-950 p-1 shadow-xl">
                                    <button
                                      aria-label={`Rename view ${view.name}`}
                                      className="rounded px-2 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-800"
                                      disabled={viewBusy}
                                      onClick={() => void renameView(view)}
                                      type="button"
                                    >
                                      Rename
                                    </button>
                                    <button
                                      aria-label={`Duplicate view ${view.name}`}
                                      className="rounded px-2 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-800"
                                      disabled={viewBusy}
                                      onClick={() => void duplicateView(view)}
                                      type="button"
                                    >
                                      Duplicate
                                    </button>
                                    <button
                                      aria-label={`Archive view ${view.name}`}
                                      className="rounded px-2 py-1.5 text-left text-xs text-rose-300 hover:bg-rose-500/10"
                                      disabled={viewBusy}
                                      onClick={() => void archiveView(view)}
                                      type="button"
                                    >
                                      Archive
                                    </button>
                                  </div>
                                </details>
                              )}
                            </div>
                          ))}
                        {showCreateView && allowed(user, 'schema.manage') && (
                          <form
                            className="mt-1 space-y-1.5 px-1"
                            onSubmit={(event) => void createView(event)}
                          >
                            <input
                              aria-label="View name"
                              autoFocus
                              className={inputClass}
                              maxLength={120}
                              name="name"
                              placeholder="View name"
                              required
                            />
                            <select
                              aria-label="View type"
                              className={inputClass}
                              name="viewType"
                              value={newViewType}
                              onChange={(event) =>
                                setNewViewType(event.target.value as RecordViewType)
                              }
                            >
                              {(
                                Object.entries(viewTypeMeta) as Array<
                                  [RecordViewType, (typeof viewTypeMeta)[RecordViewType]]
                                >
                              ).map(([type, meta]) => (
                                <option key={type} value={type}>
                                  {meta.label}
                                </option>
                              ))}
                            </select>
                            {newViewType === 'kanban' && (
                              <select
                                aria-label="Kanban grouping field"
                                className={inputClass}
                                defaultValue=""
                                name="groupFieldId"
                                required
                              >
                                <option value="">Kanban group field…</option>
                                {fields
                                  .filter((field) => field.fieldType === 'single_select')
                                  .map((field) => (
                                    <option key={field.id} value={field.id}>
                                      {field.name}
                                    </option>
                                  ))}
                              </select>
                            )}
                            {newViewType === 'calendar' && (
                              <select
                                aria-label="Calendar date field"
                                className={inputClass}
                                defaultValue=""
                                name="dateFieldId"
                                required
                              >
                                <option value="">Calendar date field…</option>
                                {fields
                                  .filter((field) => ['date', 'datetime'].includes(field.fieldType))
                                  .map((field) => (
                                    <option key={field.id} value={field.id}>
                                      {field.name}
                                    </option>
                                  ))}
                              </select>
                            )}
                            <div className="flex gap-1">
                              <Button
                                aria-label="Save new view"
                                className="flex-1"
                                disabled={viewBusy}
                                variant="quiet"
                                type="submit"
                              >
                                {viewBusy ? 'Saving…' : 'Save view'}
                              </Button>
                              <button
                                className="rounded px-2 text-xs text-slate-500 hover:bg-slate-800"
                                onClick={() => setShowCreateView(false)}
                                type="button"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {allowed(user, 'schema.manage') && (
              <details className="group mt-2 border-t border-slate-800 px-1 pt-2">
                <summary className="cursor-pointer list-none rounded-md px-2 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-sky-300">
                  {t('data.createTable')}
                </summary>
                <form className="mt-2 space-y-2" onSubmit={(event) => void createObjectType(event)}>
                  <input
                    className={inputClass}
                    name="name"
                    placeholder={t('data.typeName')}
                    required
                  />
                  <input
                    aria-label={t('data.tableLabel')}
                    className={inputClass}
                    name="pluralName"
                    placeholder={t('data.tableLabel')}
                    required
                  />
                  <input
                    className={inputClass}
                    name="key"
                    placeholder={t('data.stableKey')}
                    required
                  />
                  <Button className="w-full" variant="quiet" type="submit">
                    {t('data.addTable')}
                  </Button>
                </form>
              </details>
            )}
          </nav>,
          sidebarPortal,
        )}

      <section className="min-w-0 bg-slate-950/20 p-2.5">
        {!selected ? (
          <div className="relative isolate overflow-hidden rounded-2xl border border-dashed border-slate-700 p-10 text-center">
            <div aria-hidden="true" className="product-grid absolute inset-0 -z-10 opacity-60" />
            <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-sky-400/20 bg-sky-400/10 text-xl text-sky-300">
              ▦
            </span>
            <h2 className="mt-5 text-xl font-semibold text-slate-200">{t('data.emptyTitle')}</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-500">
              {t('data.emptyBody')}
            </p>
            <div className="mx-auto mt-5 flex max-w-2xl flex-wrap justify-center gap-2 text-xs text-slate-400">
              {['Typed fields', 'Saved views', 'CSV import & export', 'Audit history'].map(
                (capability) => (
                  <span
                    className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1.5"
                    key={capability}
                  >
                    {capability}
                  </span>
                ),
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <h2 className="truncate text-xl font-semibold">{selected.pluralName}</h2>
                <p className="font-mono text-[10px] uppercase tracking-widest text-sky-400">
                  {selected.key}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {allowed(user, 'schema.manage') && (
                  <Button variant="quiet" onClick={() => setShowSchema((value) => !value)}>
                    {t('data.schema')}
                  </Button>
                )}
                {allowed(user, 'export.execute') && (
                  <Button variant="quiet" onClick={() => void exportCsv()}>
                    {t('data.exportCsv')}
                  </Button>
                )}
                {allowed(user, 'record.create') && (
                  <Button
                    onClick={() => {
                      setShowInlineRecord(false);
                      setShowNewRecord((value) => !value);
                    }}
                  >
                    {t('data.newRecord')}
                  </Button>
                )}
              </div>
            </div>

            {showSchema && allowed(user, 'schema.manage') && (
              <div className="mt-2 rounded-lg border border-slate-700 bg-slate-900 p-3">
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
                    {availableFieldTypes.map((type) => (
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

            <div className="mt-2 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/45 shadow-sm">
              <div className="flex min-h-9 flex-wrap items-center gap-0.5 p-1">
                <div className="mr-1 flex items-center gap-2 border-r border-slate-800 pr-3">
                  <span className="max-w-40 truncate px-2 text-sm font-medium text-slate-200">
                    {selectedView?.name ?? 'All records'}
                  </span>
                  {viewDirty && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-300">
                      Unsaved
                    </span>
                  )}
                </div>
                {(['fields', 'filter', 'sort'] as const).map((tool) => {
                  const active = activeTool === tool;
                  const label =
                    tool === 'fields'
                      ? t('data.columns')
                      : tool === 'filter'
                        ? t('data.filter')
                        : t('data.sort');
                  const count =
                    tool === 'fields'
                      ? `${visibleFields.length}/${fields.length}`
                      : tool === 'filter' && filterField
                        ? '1'
                        : tool === 'sort' && sortField
                          ? '1'
                          : '';
                  return (
                    <button
                      aria-expanded={active}
                      className={`rounded-md px-2 py-1.5 text-xs ${active ? 'bg-sky-500/15 text-sky-300' : 'text-slate-300 hover:bg-slate-800'}`}
                      key={tool}
                      onClick={() => setActiveTool(active ? null : tool)}
                      type="button"
                    >
                      {label}
                      {count && (
                        <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
                {selectedView && allowed(user, 'schema.manage') && (
                  <>
                    <button
                      className={`rounded-lg px-3 py-2 text-sm ${viewDirty ? 'bg-sky-500/15 font-medium text-sky-300 hover:bg-sky-500/20' : 'text-slate-600'}`}
                      disabled={!viewDirty || viewBusy}
                      onClick={() => void saveView()}
                      type="button"
                    >
                      {viewBusy ? t('data.saving') : t('data.saveView')}
                    </button>
                    <button
                      aria-label={`Archive view ${selectedView.name}`}
                      className="rounded-lg px-2 py-2 text-sm text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"
                      disabled={viewBusy}
                      onClick={() => void archiveView()}
                      title="Archive view"
                      type="button"
                    >
                      ⋯
                    </button>
                  </>
                )}
                <select
                  aria-label={t('data.rowDensity')}
                  className="rounded-lg border border-transparent bg-transparent px-3 py-2 text-sm text-slate-300 outline-none hover:bg-slate-800 focus:border-sky-500"
                  value={rowDensity}
                  onChange={(event) =>
                    setRowDensity(event.target.value as 'compact' | 'comfortable')
                  }
                >
                  <option value="compact">{t('data.compactRows')}</option>
                  <option value="comfortable">{t('data.comfortableRows')}</option>
                </select>
                {!['kanban', 'calendar'].includes(activeViewType) && (
                  <select
                    aria-label={t('data.rowsPerPage')}
                    className="rounded-lg border border-transparent bg-transparent px-3 py-2 text-sm text-slate-300 outline-none hover:bg-slate-800 focus:border-sky-500"
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value) as 25 | 50 | 100);
                      setPage(1);
                    }}
                  >
                    {[25, 50, 100].map((size) => (
                      <option key={size} value={size}>
                        {t('data.rows', { count: size })}
                      </option>
                    ))}
                  </select>
                )}
                {workspaceMode && (
                  <select
                    aria-label="Project filter"
                    className="max-w-48 rounded-lg border border-transparent bg-transparent px-3 py-2 text-sm text-slate-300 outline-none hover:bg-slate-800 focus:border-sky-500"
                    value={contextProjectFilter}
                    onChange={(event) => {
                      setContextProjectFilter(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="all">All projects</option>
                    <option value="none">No project</option>
                    {workspaceData?.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                        {project.archivedAt ? ' (archived)' : ''}
                      </option>
                    ))}
                  </select>
                )}
                <span className="min-w-3 flex-1" />
                <div className="flex h-8 min-w-40 items-center gap-1 rounded-md border border-slate-800 bg-slate-950/55 px-2 focus-within:border-sky-500">
                  <span aria-hidden="true" className="text-xs text-slate-500">
                    ⌕
                  </span>
                  <input
                    aria-label={t('data.quickSearch')}
                    className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-600"
                    maxLength={200}
                    onChange={(event) => {
                      setSearchValue(event.target.value);
                      setPage(1);
                    }}
                    placeholder={t('data.searchRecords')}
                    type="search"
                    value={searchValue}
                  />
                  {searchValue && (
                    <button
                      aria-label={t('data.clearSearch')}
                      className="grid size-5 place-items-center rounded text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                      onClick={() => {
                        setSearchValue('');
                        setPage(1);
                      }}
                      type="button"
                    >
                      ×
                    </button>
                  )}
                </div>
                {selectedRows.size > 0 && (
                  <div className="flex items-center gap-2 pl-2">
                    <span className="text-xs font-medium text-sky-300">
                      {t('data.selected', { count: selectedRows.size })}
                    </span>
                    {allowed(user, 'record.archive') && (
                      <button
                        className="rounded-lg px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10"
                        disabled={bulkBusy}
                        onClick={() => void archiveSelectedRows()}
                        type="button"
                      >
                        {bulkBusy ? 'Archiving…' : 'Archive'}
                      </button>
                    )}
                    <button
                      className="rounded-lg px-2 py-2 text-sm text-slate-400 hover:bg-slate-800"
                      onClick={() => setSelectedRows(new Set())}
                      type="button"
                    >
                      {t('data.clear')}
                    </button>
                  </div>
                )}
                <span className="px-2 text-xs text-slate-500">
                  {t('data.records', { count: records.total })}
                </span>
              </div>

              {activeTool === 'fields' && (
                <div className="border-t border-slate-800 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-500">
                      {t('data.shownHidden', {
                        shown: visibleFields.length,
                        hidden: hiddenFieldIds.size,
                      })}
                    </p>
                    <div className="flex items-center gap-1">
                      {adjustedWidthCount > 0 && (
                        <button
                          className="rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-sky-300"
                          onClick={() => {
                            setFieldWidths({});
                            setSystemFieldWidths({});
                          }}
                          type="button"
                        >
                          {t('data.resetWidths')}
                          <span className="ml-1 text-[10px] text-slate-600">
                            {adjustedWidthCount}
                          </span>
                        </button>
                      )}
                      {hiddenFieldIds.size > 0 && (
                        <button
                          className="rounded-md px-2 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/10"
                          onClick={() => setHiddenFieldIds(new Set())}
                          type="button"
                        >
                          {t('data.showAllColumns')}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-2 xl:grid-cols-2">
                    {orderedFields.map((field, index) => {
                      const visible = !hiddenFieldIds.has(field.id);
                      return (
                        <div
                          className={`flex min-w-0 items-center gap-2 rounded-lg border px-2 py-2 text-xs ${visible ? 'border-sky-500/30 bg-sky-500/10 text-sky-200' : 'border-slate-800 text-slate-500'}`}
                          key={field.id}
                        >
                          <label className="flex min-w-28 flex-1 cursor-pointer items-center gap-2">
                            <input
                              aria-label={field.name}
                              checked={visible}
                              type="checkbox"
                              onChange={() =>
                                setHiddenFieldIds((current) => {
                                  const next = new Set(current);
                                  if (next.has(field.id)) next.delete(field.id);
                                  else next.add(field.id);
                                  return next;
                                })
                              }
                            />
                            <span className="truncate">{field.name}</span>
                          </label>
                          {visible && (
                            <label className="flex items-center gap-1.5 text-[10px] text-slate-500">
                              <span>{t('data.width')}</span>
                              <input
                                aria-label={t('data.columnWidth', { column: field.name })}
                                className="w-20 accent-sky-500"
                                max={MAX_COLUMN_WIDTH}
                                min={MIN_COLUMN_WIDTH}
                                step={COLUMN_KEYBOARD_STEP}
                                type="range"
                                value={fieldWidths[field.id] ?? DEFAULT_FIELD_WIDTH}
                                onChange={(event) =>
                                  setFieldWidths((current) => ({
                                    ...current,
                                    [field.id]: Number(event.target.value),
                                  }))
                                }
                              />
                              <output className="w-9 text-right font-mono text-slate-400">
                                {fieldWidths[field.id] ?? DEFAULT_FIELD_WIDTH}px
                              </output>
                            </label>
                          )}
                          <div className="flex">
                            <button
                              aria-label={`Move ${field.name} left`}
                              className="rounded px-1.5 py-1 text-slate-500 hover:bg-slate-800 hover:text-sky-300 disabled:opacity-30"
                              disabled={index === 0}
                              onClick={() => moveField(field.id, -1)}
                              type="button"
                            >
                              ←
                            </button>
                            <button
                              aria-label={`Move ${field.name} right`}
                              className="rounded px-1.5 py-1 text-slate-500 hover:bg-slate-800 hover:text-sky-300 disabled:opacity-30"
                              disabled={index === orderedFields.length - 1}
                              onClick={() => moveField(field.id, 1)}
                              type="button"
                            >
                              →
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTool === 'filter' && (
                <div className="flex flex-wrap items-end gap-3 border-t border-slate-800 p-3">
                  <label className="min-w-44 text-xs text-slate-400">
                    {t('data.field')}
                    <select
                      className={inputClass}
                      value={filterField}
                      onChange={(event) => {
                        setFilterField(event.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="">{t('data.noFilter')}</option>
                      {fields
                        .filter(
                          (field) =>
                            field.fieldType !== 'measurement' && field.fieldType !== 'range',
                        )
                        .map((field) => (
                          <option key={field.id} value={field.id}>
                            {field.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="min-w-32 text-xs text-slate-400">
                    {t('data.operator')}
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
                    <label className="min-w-44 text-xs text-slate-400">
                      {t('data.value')}
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
                  {filterField && (
                    <button
                      className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800"
                      onClick={() => {
                        setFilterField('');
                        setFilterValue('');
                        setDebouncedFilterValue('');
                        setFilterOperator('eq');
                        setPage(1);
                      }}
                      type="button"
                    >
                      {t('data.clearFilter')}
                    </button>
                  )}
                </div>
              )}

              {activeTool === 'sort' && (
                <div className="flex flex-wrap items-end gap-3 border-t border-slate-800 p-3">
                  <label className="min-w-52 text-xs text-slate-400">
                    {t('data.sortRecordsBy')}
                    <select
                      className={inputClass}
                      value={sortField}
                      onChange={(event) => {
                        setSortField(event.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="">{t('data.noSorting')}</option>
                      <option value="displayName">{t('data.displayName')}</option>
                      <option value="updatedAt">{t('data.updated')}</option>
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
                  <label className="min-w-40 text-xs text-slate-400">
                    {t('data.direction')}
                    <select
                      className={inputClass}
                      disabled={!sortField}
                      value={sortDirection}
                      onChange={(event) => {
                        setSortDirection(event.target.value as 'asc' | 'desc');
                        setPage(1);
                      }}
                    >
                      <option value="asc">{t('data.ascending')}</option>
                      <option value="desc">{t('data.descending')}</option>
                    </select>
                  </label>
                </div>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <p>
                {viewTypeMeta[activeViewType].label} view
                {activeViewType === 'grid' &&
                  allowed(user, 'record.update') &&
                  ' · double-click a cell or focus it and press Enter. Save with Enter or by leaving the cell; cancel with Escape.'}
              </p>
              <p>Changes are shared across every view of this table.</p>
            </div>

            <div className="mt-1.5 max-w-full overflow-x-auto rounded-md border border-slate-800">
              <p aria-live="polite" className="sr-only">
                {layoutAnnouncement}
              </p>
              {recordsLoading && (
                <div className="space-y-3 p-5" aria-label="Loading records">
                  <div className="h-10 animate-pulse rounded bg-slate-900" />
                  <div className="h-10 animate-pulse rounded bg-slate-900" />
                  <div className="h-10 animate-pulse rounded bg-slate-900" />
                </div>
              )}
              {!recordsLoading && activeViewType === 'grid' && (
                <table
                  className="min-w-full table-fixed border-separate border-spacing-0 text-left text-sm"
                  style={{ width: gridTableWidth }}
                >
                  <caption className="sr-only">
                    Editable spreadsheet view for {selected.pluralName}
                  </caption>
                  <colgroup>
                    <col className="w-20" />
                    <col style={{ width: displayNameWidth }} />
                    {workspaceMode && <col style={{ width: contextProjectWidth }} />}
                    {visibleFields.map((field) => (
                      <col
                        data-column-id={field.id}
                        key={field.id}
                        style={{ width: fieldWidths[field.id] ?? DEFAULT_FIELD_WIDTH }}
                      />
                    ))}
                    <col style={{ width: updatedAtWidth }} />
                    <col className="w-20" />
                  </colgroup>
                  <thead className="sticky top-0 z-20 bg-slate-900 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="w-20 border-b border-r border-slate-800 px-2.5 py-2">
                        <span className="flex items-center gap-2">
                          <input
                            aria-label={t('data.selectAll')}
                            checked={
                              records.items.length > 0 &&
                              records.items.every((record) => selectedRows.has(record.id))
                            }
                            type="checkbox"
                            onChange={(event) =>
                              setSelectedRows((current) => {
                                const next = new Set(current);
                                for (const record of records.items) {
                                  if (event.target.checked) next.add(record.id);
                                  else next.delete(record.id);
                                }
                                return next;
                              })
                            }
                          />
                          #
                        </span>
                      </th>
                      <th
                        aria-label={t('data.name')}
                        className="sticky left-0 z-30 border-b border-r border-slate-800 bg-slate-900 px-1.5 py-1"
                        style={{ width: displayNameWidth }}
                      >
                        <button
                          aria-label={t('data.sortByColumn', { column: t('data.name') })}
                          className="flex w-full items-center rounded px-1 py-1 text-left hover:bg-slate-800"
                          onClick={() => cycleSort('displayName')}
                          title={t('data.sortCycleHint')}
                          type="button"
                        >
                          {t('data.name')}
                          {sortField === 'displayName' && (
                            <span aria-hidden="true" className="ml-1 text-sky-400">
                              {sortDirection === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </button>
                        <ColumnResizeHandle
                          columnName={t('data.name')}
                          resetWidth={DEFAULT_SYSTEM_FIELD_WIDTHS.displayName}
                          width={displayNameWidth}
                          onResize={(width) =>
                            setSystemFieldWidths((current) => ({
                              ...current,
                              displayName: width,
                            }))
                          }
                          onReset={() =>
                            setSystemFieldWidths((current) => {
                              const next = { ...current };
                              delete next.displayName;
                              return next;
                            })
                          }
                        />
                      </th>
                      {workspaceMode && (
                        <th
                          aria-label={t('data.project')}
                          className="relative border-b border-r border-slate-800 px-2.5 py-2"
                          style={{ width: contextProjectWidth }}
                        >
                          {t('data.project')}
                          <ColumnResizeHandle
                            columnName={t('data.project')}
                            resetWidth={DEFAULT_SYSTEM_FIELD_WIDTHS.contextProject}
                            width={contextProjectWidth}
                            onResize={(width) =>
                              setSystemFieldWidths((current) => ({
                                ...current,
                                contextProject: width,
                              }))
                            }
                            onReset={() =>
                              setSystemFieldWidths((current) => {
                                const next = { ...current };
                                delete next.contextProject;
                                return next;
                              })
                            }
                          />
                        </th>
                      )}
                      {visibleFields.map((field) => (
                        <th
                          aria-label={field.name}
                          className={`relative border-b border-r border-slate-800 px-1.5 py-1 ${dragTarget?.fieldId === field.id ? (dragTarget.position === 'before' ? 'border-l-2 border-l-sky-400' : 'border-r-2 border-r-sky-400') : ''}`}
                          key={field.id}
                          style={{ width: fieldWidths[field.id] ?? DEFAULT_FIELD_WIDTH }}
                          onDragOver={(event: ReactDragEvent<HTMLTableCellElement>) => {
                            if (!draggedFieldId || draggedFieldId === field.id) return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            const bounds = event.currentTarget.getBoundingClientRect();
                            setDragTarget({
                              fieldId: field.id,
                              position:
                                event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after',
                            });
                          }}
                          onDrop={(event: ReactDragEvent<HTMLTableCellElement>) => {
                            if (!draggedFieldId || draggedFieldId === field.id) return;
                            event.preventDefault();
                            const bounds = event.currentTarget.getBoundingClientRect();
                            reorderField(
                              draggedFieldId,
                              field.id,
                              event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after',
                            );
                            setDraggedFieldId('');
                            setDragTarget(undefined);
                          }}
                        >
                          <div className="flex min-w-0 items-center gap-1">
                            <span
                              aria-label={t('data.reorderColumn', { column: field.name })}
                              className="shrink-0 cursor-grab rounded px-0.5 py-1 text-sm leading-none text-slate-600 hover:bg-slate-800 hover:text-sky-300 active:cursor-grabbing"
                              draggable
                              role="button"
                              tabIndex={0}
                              title={t('data.reorderColumnHint')}
                              onDragEnd={() => {
                                setDraggedFieldId('');
                                setDragTarget(undefined);
                              }}
                              onDragStart={(event: ReactDragEvent<HTMLSpanElement>) => {
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', field.id);
                                setDraggedFieldId(field.id);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                                event.preventDefault();
                                event.stopPropagation();
                                moveField(field.id, event.key === 'ArrowLeft' ? -1 : 1);
                              }}
                            >
                              ⠿
                            </span>
                            <button
                              aria-label={t('data.sortByColumn', { column: field.name })}
                              className="flex min-w-0 flex-1 items-center rounded px-1 py-1 text-left hover:bg-slate-800"
                              disabled={[
                                'relation',
                                'multi_select',
                                'measurement',
                                'range',
                              ].includes(field.fieldType)}
                              onClick={() => cycleSort(field.id)}
                              title={t('data.sortCycleHint')}
                              type="button"
                            >
                              <span className="truncate">{field.name}</span>
                              {sortField === field.id && (
                                <span aria-hidden="true" className="ml-1 text-sky-400">
                                  {sortDirection === 'asc' ? '↑' : '↓'}
                                </span>
                              )}
                              <span className="ml-2 truncate font-normal normal-case text-slate-600">
                                {field.fieldType}
                              </span>
                            </button>
                            <details className="relative shrink-0 normal-case">
                              <summary
                                aria-label={t('data.columnOptions', { column: field.name })}
                                className="grid size-7 cursor-pointer list-none place-items-center rounded text-base tracking-normal text-slate-500 marker:content-none hover:bg-slate-800 hover:text-slate-200"
                                role="button"
                              >
                                ⋮
                              </summary>
                              <div className="absolute right-0 top-8 z-50 grid w-52 gap-0.5 rounded-md border border-slate-700 bg-slate-950 p-1 text-xs font-normal tracking-normal text-slate-300 shadow-xl">
                                {!['relation', 'multi_select', 'measurement', 'range'].includes(
                                  field.fieldType,
                                ) && (
                                  <>
                                    <button
                                      aria-label={`Sort ${field.name} ascending`}
                                      className="rounded px-2 py-1.5 text-left hover:bg-slate-800"
                                      onClick={() => {
                                        setSortField(field.id);
                                        setSortDirection('asc');
                                        setPage(1);
                                      }}
                                      type="button"
                                    >
                                      <span className="mr-2 text-sky-400">↑</span>{' '}
                                      {t('data.sortAscending')}
                                    </button>
                                    <button
                                      aria-label={`Sort ${field.name} descending`}
                                      className="rounded px-2 py-1.5 text-left hover:bg-slate-800"
                                      onClick={() => {
                                        setSortField(field.id);
                                        setSortDirection('desc');
                                        setPage(1);
                                      }}
                                      type="button"
                                    >
                                      <span className="mr-2 text-sky-400">↓</span>{' '}
                                      {t('data.sortDescending')}
                                    </button>
                                    {sortField === field.id && (
                                      <button
                                        aria-label={`Remove sorting from ${field.name}`}
                                        className="rounded px-2 py-1.5 text-left hover:bg-slate-800"
                                        onClick={() => {
                                          setSortField('');
                                          setSortDirection('asc');
                                          setPage(1);
                                        }}
                                        type="button"
                                      >
                                        <span className="mr-2 text-slate-500">×</span>{' '}
                                        {t('data.removeSorting')}
                                      </button>
                                    )}
                                  </>
                                )}
                                {!['measurement', 'range'].includes(field.fieldType) && (
                                  <button
                                    aria-label={`Filter ${field.name}`}
                                    className="rounded px-2 py-1.5 text-left hover:bg-slate-800"
                                    onClick={() => {
                                      setFilterField(field.id);
                                      setFilterOperator('eq');
                                      setFilterValue('');
                                      setDebouncedFilterValue('');
                                      setActiveTool('filter');
                                      setPage(1);
                                    }}
                                    type="button"
                                  >
                                    <span className="mr-2 text-sky-400">⌕</span>{' '}
                                    {t('data.filterColumn')}
                                  </button>
                                )}
                                <button
                                  aria-label={`Hide ${field.name} column`}
                                  className="rounded px-2 py-1.5 text-left hover:bg-slate-800"
                                  onClick={() =>
                                    setHiddenFieldIds((current) => new Set([...current, field.id]))
                                  }
                                  type="button"
                                >
                                  <span className="mr-2 text-slate-500">◫</span>{' '}
                                  {t('data.hideColumn')}
                                </button>
                                {hiddenFieldIds.size > 0 && (
                                  <button
                                    className="border-t border-slate-800 px-2 py-1.5 text-left text-sky-300 hover:bg-slate-800"
                                    onClick={() => setActiveTool('fields')}
                                    type="button"
                                  >
                                    {t('data.showHiddenColumns')}
                                  </button>
                                )}
                              </div>
                            </details>
                          </div>
                          <ColumnResizeHandle
                            columnName={field.name}
                            resetWidth={DEFAULT_FIELD_WIDTH}
                            width={fieldWidths[field.id] ?? DEFAULT_FIELD_WIDTH}
                            onResize={(width) =>
                              setFieldWidths((current) => ({ ...current, [field.id]: width }))
                            }
                            onReset={() =>
                              setFieldWidths((current) => {
                                const next = { ...current };
                                delete next[field.id];
                                return next;
                              })
                            }
                          />
                        </th>
                      ))}
                      <th
                        aria-label={t('data.updated')}
                        className="relative border-b border-r border-slate-800 px-1.5 py-1"
                        style={{ width: updatedAtWidth }}
                      >
                        <button
                          aria-label={t('data.sortByColumn', { column: t('data.updated') })}
                          className="flex w-full items-center rounded px-1 py-1 text-left hover:bg-slate-800"
                          onClick={() => cycleSort('updatedAt')}
                          title={t('data.sortCycleHint')}
                          type="button"
                        >
                          {t('data.updated')}
                          {sortField === 'updatedAt' && (
                            <span aria-hidden="true" className="ml-1 text-sky-400">
                              {sortDirection === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </button>
                        <ColumnResizeHandle
                          columnName={t('data.updated')}
                          resetWidth={DEFAULT_SYSTEM_FIELD_WIDTHS.updatedAt}
                          width={updatedAtWidth}
                          onResize={(width) =>
                            setSystemFieldWidths((current) => ({
                              ...current,
                              updatedAt: width,
                            }))
                          }
                          onReset={() =>
                            setSystemFieldWidths((current) => {
                              const next = { ...current };
                              delete next.updatedAt;
                              return next;
                            })
                          }
                        />
                      </th>
                      <th className="w-20 border-b border-slate-800 px-2.5 py-2">
                        {t('data.detail')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.items.map((record, index) => (
                      <tr
                        className={`${selectedRows.has(record.id) ? 'bg-sky-500/5' : 'bg-slate-950/30'} hover:bg-slate-900/40`}
                        key={record.id}
                      >
                        <td className="border-b border-r border-slate-800 px-3 text-xs text-slate-600">
                          <span className="flex items-center gap-2">
                            <input
                              aria-label={`Select ${record.displayName}`}
                              checked={selectedRows.has(record.id)}
                              type="checkbox"
                              onChange={(event) =>
                                setSelectedRows((current) => {
                                  const next = new Set(current);
                                  if (event.target.checked) next.add(record.id);
                                  else next.delete(record.id);
                                  return next;
                                })
                              }
                            />
                            <button
                              aria-label={`Quick view ${record.displayName}`}
                              className="rounded px-1 py-2 font-mono hover:bg-slate-800 hover:text-sky-300"
                              onClick={() => setSelectedRecord(record)}
                              title="Open quick view"
                              type="button"
                            >
                              {(records.page - 1) * records.pageSize + index + 1}
                            </button>
                          </span>
                        </td>
                        <td className="sticky left-0 z-10 border-b border-r border-slate-800 bg-slate-950">
                          {allowed(user, 'record.update') ? (
                            <GridCell
                              comfortable={rowDensity === 'comfortable'}
                              label="Name"
                              recordName={record.displayName}
                              value={record.displayName}
                              onSave={(value) => saveGridCell(record, 'displayName', value)}
                            />
                          ) : (
                            <span className="block px-2.5 py-2 text-xs font-medium text-slate-200">
                              {record.displayName}
                            </span>
                          )}
                        </td>
                        {workspaceMode && (
                          <td className="border-b border-r border-slate-800 px-1.5 py-1">
                            {allowed(user, 'record.update') ? (
                              <select
                                aria-label={`Project for ${record.displayName}`}
                                className="min-h-7 w-full rounded border border-transparent bg-transparent px-1.5 text-xs text-slate-300 outline-none hover:border-slate-700 focus:border-sky-400"
                                value={record.contextProjectId ?? ''}
                                onChange={(event) =>
                                  void saveProjectCell(record, event.target.value || null).catch(
                                    (cause: unknown) => {
                                      setMessageTone('error');
                                      setMessage(
                                        cause instanceof Error
                                          ? cause.message
                                          : 'Project link could not be saved.',
                                      );
                                    },
                                  )
                                }
                              >
                                <option value="">{t('data.noProject')}</option>
                                {workspaceData?.projects.map((project) => (
                                  <option key={project.id} value={project.id}>
                                    {project.name}
                                    {project.archivedAt ? ' (archived)' : ''}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="block truncate px-1.5 text-xs text-slate-400">
                                {workspaceData?.projects.find(
                                  (project) => project.id === record.contextProjectId,
                                )?.name ?? t('data.noProject')}
                              </span>
                            )}
                          </td>
                        )}
                        {visibleFields.map((field) => (
                          <td className="border-b border-r border-slate-800" key={field.id}>
                            {field.fieldType === 'measurement' ? (
                              <span className="block max-w-64 truncate px-2.5 py-2 text-xs text-slate-400">
                                {record.measurements?.[field.id]?.resultId
                                  ? `${record.measurements[field.id]?.value} ${record.measurements[field.id]?.unit} · ${record.measurements[field.id]?.status ?? 'pending'}`
                                  : (record.measurements?.[field.id]?.status ?? '—')}
                              </span>
                            ) : allowed(user, 'record.update') ? (
                              <GridCell
                                comfortable={rowDensity === 'comfortable'}
                                field={field}
                                label={field.name}
                                recordName={record.displayName}
                                value={recordGridValue(record, field)}
                                onSave={(value) => saveGridCell(record, field, value)}
                              />
                            ) : (
                              <span
                                className={`block max-w-64 truncate px-2.5 text-xs text-slate-300 ${rowDensity === 'comfortable' ? 'py-3' : 'py-1.5'}`}
                              >
                                {displayValue(recordGridValue(record, field))}
                              </span>
                            )}
                          </td>
                        ))}
                        <td
                          className={`border-b border-r border-slate-800 px-2.5 text-xs text-slate-500 ${rowDensity === 'comfortable' ? 'py-3' : 'py-1.5'}`}
                        >
                          {new Date(record.updatedAt).toLocaleDateString()}
                        </td>
                        <td className="border-b border-slate-800 px-3 py-2">
                          <button
                            aria-label={`Expand ${record.displayName}`}
                            className="rounded-lg px-2 py-1 text-sky-400 hover:bg-sky-500/10 hover:text-sky-300"
                            onClick={() => setSelectedRecord(record)}
                            title={`Quick view ${record.displayName}`}
                            type="button"
                          >
                            ↗
                          </button>
                        </td>
                      </tr>
                    ))}
                    {showInlineRecord && allowed(user, 'record.create') && (
                      <InlineRecordRow
                        fields={visibleFields}
                        projects={workspaceData?.projects}
                        key={`${selectedId}:${visibleFields.map((field) => field.id).join(',')}`}
                        onCancel={() => setShowInlineRecord(false)}
                        onCreate={createInlineRecord}
                        onOpenFullForm={() => {
                          setShowInlineRecord(false);
                          setShowNewRecord(true);
                        }}
                      />
                    )}
                    {!showInlineRecord && allowed(user, 'record.create') && (
                      <tr>
                        <td
                          className="border-r border-slate-800 p-1"
                          colSpan={visibleFields.length + 4 + (workspaceMode ? 1 : 0)}
                        >
                          <button
                            className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-900 hover:text-sky-300"
                            onClick={() => {
                              if (hiddenRequiredFields.length) setShowNewRecord(true);
                              else setShowInlineRecord(true);
                            }}
                            title={
                              hiddenRequiredFields.length
                                ? `Full form required for: ${hiddenRequiredFields.map((field) => field.name).join(', ')}`
                                : 'Add a record inline'
                            }
                            type="button"
                          >
                            + Add record
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
              {!recordsLoading && activeViewType === 'gallery' && (
                <GalleryRecordsView
                  fields={visibleFields}
                  records={records.items}
                  onOpen={setSelectedRecord}
                />
              )}
              {!recordsLoading && activeViewType === 'kanban' && (
                <>
                  {kanbanField ? (
                    <KanbanRecordsView
                      canUpdate={allowed(user, 'record.update')}
                      field={kanbanField}
                      groups={records.groups}
                      records={records.items}
                      onMove={(record, value) => saveGridCell(record, kanbanField, value)}
                      onOpen={setSelectedRecord}
                    />
                  ) : (
                    <p className="p-8 text-center text-sm text-rose-300">
                      This Kanban view needs a valid single-select field.
                    </p>
                  )}
                </>
              )}
              {!recordsLoading && activeViewType === 'calendar' && (
                <>
                  {calendarField ? (
                    <CalendarRecordsView
                      field={calendarField}
                      month={calendarMonth}
                      records={records.items}
                      onMonthChange={(month) => {
                        setCalendarMonth(month);
                        setPage(1);
                      }}
                      onOpen={setSelectedRecord}
                    />
                  ) : (
                    <p className="p-8 text-center text-sm text-rose-300">
                      This Calendar view needs a valid date field.
                    </p>
                  )}
                </>
              )}
              {!recordsLoading && activeViewType === 'form' && (
                <div className="mx-auto max-w-3xl p-5">
                  <div className="mb-4 border-b border-slate-800 pb-3">
                    <h3 className="text-lg font-semibold">Add {selected.name}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Submissions create records in {selected.pluralName} and appear in every view.
                    </p>
                  </div>
                  {allowed(user, 'record.create') ? (
                    <RecordForm
                      fields={formFields}
                      projects={workspaceData?.projects}
                      submitLabel="Submit record"
                      onSubmit={async (form) => {
                        const created = await api<DynamicRecord>(
                          `${base}/object-types/${selected.id}/records`,
                          {
                            method: 'POST',
                            body: JSON.stringify({
                              ...recordPayload(fields, form),
                              ...(workspaceMode
                                ? {
                                    contextProjectId:
                                      String(form.get('contextProjectId') ?? '') || null,
                                  }
                                : {}),
                            }),
                          },
                        );
                        setMessageTone('success');
                        setMessage(`${created.displayName} submitted.`);
                        await loadRecords();
                      }}
                    />
                  ) : (
                    <p className="rounded-md border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">
                      You have read-only access to this form.
                    </p>
                  )}
                </div>
              )}
              {!recordsLoading &&
                activeViewType !== 'form' &&
                records.items.length === 0 &&
                !showInlineRecord && (
                  <div className="p-10 text-center">
                    <span className="mx-auto grid size-10 place-items-center rounded-xl bg-sky-400/10 text-sky-300">
                      ＋
                    </span>
                    <h3 className="mt-4 font-semibold text-slate-200">
                      {t('data.emptyRecordsTitle')}
                    </h3>
                    <p className="mx-auto mt-1 max-w-xl text-sm text-slate-500">
                      {t('data.emptyRecordsBody')}
                    </p>
                  </div>
                )}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
              <span>
                {records.total} records · page {records.page} of{' '}
                {Math.max(1, Math.ceil(records.total / records.pageSize))}
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
              <details className="mt-6 rounded-xl border border-slate-800 bg-slate-900/25">
                <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-300 hover:text-sky-300">
                  Import records from CSV
                </summary>
                <form
                  className="border-t border-slate-800 p-4"
                  onSubmit={(event) => void importCsv(event)}
                >
                  <p className="text-xs text-slate-500">
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
              </details>
            )}
            <SpecificationsPanel base={base} fields={fields} user={user} />
          </>
        )}
      </section>
      {showNewRecord && selected && allowed(user, 'record.create') && (
        <div className="fixed inset-0 z-[70] flex justify-end" role="presentation">
          <button
            aria-label="Close new record panel"
            className="absolute inset-0 cursor-default bg-slate-950/65 backdrop-blur-sm"
            onClick={() => setShowNewRecord(false)}
            type="button"
          />
          <aside
            aria-labelledby="new-record-title"
            aria-modal="true"
            className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-slate-700 bg-slate-950 shadow-2xl shadow-black/50"
            role="dialog"
          >
            <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/90 px-5 py-4 backdrop-blur-xl sm:px-7">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-400">
                  {selected.name}
                </p>
                <h2 className="mt-1 text-2xl font-semibold" id="new-record-title">
                  New record
                </h2>
              </div>
              <button
                aria-label="Close new record panel"
                autoFocus
                className="grid size-9 place-items-center rounded-lg border border-slate-700 text-xl text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                onClick={() => setShowNewRecord(false)}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="p-5 sm:p-7">
              <RecordForm
                fields={fields}
                projects={workspaceData?.projects}
                submitLabel="Create record"
                onSubmit={async (form) => {
                  await api(`${base}/object-types/${selected.id}/records`, {
                    method: 'POST',
                    body: JSON.stringify({
                      ...recordPayload(fields, form),
                      ...(workspaceMode
                        ? {
                            contextProjectId: String(form.get('contextProjectId') ?? '') || null,
                          }
                        : {}),
                    }),
                  });
                  setShowNewRecord(false);
                  await loadRecords();
                }}
              />
            </div>
          </aside>
        </div>
      )}
      {selectedRecord && (
        <div className="fixed inset-0 z-[70] flex justify-end" role="presentation">
          <button
            aria-label="Close quick record view"
            className="absolute inset-0 cursor-default bg-slate-950/65 backdrop-blur-sm"
            onClick={() => setSelectedRecord(undefined)}
            type="button"
          />
          <aside
            aria-labelledby="quick-record-title"
            aria-modal="true"
            className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-slate-700 bg-slate-950 shadow-2xl shadow-black/50"
            role="dialog"
          >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-950/90 px-5 py-4 backdrop-blur-xl sm:px-7">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-400">
                  {selected?.name ?? 'Record'} · quick view
                </p>
                <h2 className="mt-1 truncate text-2xl font-semibold" id="quick-record-title">
                  {selectedRecord.displayName}
                </h2>
                <p className="mt-1 font-mono text-[10px] text-slate-600">
                  v{selectedRecord.rowVersion} · {selectedRecord.id}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!workspaceMode && (
                  <Link
                    className="rounded-lg px-3 py-2 text-sm text-sky-300 hover:bg-sky-500/10"
                    to={`${base}/data/${selectedRecord.objectTypeId}/records/${selectedRecord.id}`}
                  >
                    Full record
                  </Link>
                )}
                <button
                  aria-label="Close quick record view"
                  autoFocus
                  className="grid size-9 place-items-center rounded-lg border border-slate-700 text-xl text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                  onClick={() => setSelectedRecord(undefined)}
                  type="button"
                >
                  ×
                </button>
              </div>
            </header>
            <div className="p-5 sm:p-7">
              <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/45 px-4 py-3 text-xs text-slate-400">
                Mutable properties can be edited here without leaving the grid.
                {!workspaceMode &&
                  ' Measurements and evaluation history remain available in the full record view.'}
              </div>
              {allowed(user, 'record.update') ? (
                <RecordForm
                  fields={fields}
                  projects={workspaceData?.projects}
                  record={selectedRecord}
                  submitLabel="Save record"
                  onSubmit={(form) => saveRecordPanel(selectedRecord, form)}
                />
              ) : (
                <dl className="divide-y divide-slate-800 rounded-xl border border-slate-800">
                  {visibleFields.map((field) => (
                    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]" key={field.id}>
                      <dt className="text-sm text-slate-500">{field.name}</dt>
                      <dd className="text-sm text-slate-200">
                        {field.fieldType === 'measurement'
                          ? displayValue(selectedRecord.measurements?.[field.id]?.value)
                          : displayValue(recordGridValue(selectedRecord, field))}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </aside>
        </div>
      )}
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
