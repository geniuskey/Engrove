import { Button } from '@engrove/ui';
import { useActionDialog } from './ActionDialogProvider.js';
import {
  Fragment,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
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
import {
  allowed,
  api,
  ApiError,
  ErrorText,
  HelpTip,
  inputClass,
  NoticeText,
  type User,
} from './App.js';
import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuModel,
  menuFromKeyboard,
  menuFromPointer,
} from './ContextMenu.js';
import { CellValuePreview } from './DataPageCharts.js';
import { CsvImportPanel } from './CsvImportPanel.js';
import { FormField, FormFieldLabel } from './FormFieldLabel.js';
import { IconAction } from './IconAction.js';
import { RecordReviewsPanel } from './RecordReviewsPanel.js';
import { RecordCommentsPanel } from './RecordCommentsPanel.js';
import { RecordViewSharePanel } from './RecordViewSharePanel.js';
import { TableApiPanel } from './TableApiPanel.js';
import { TablePermissionsPanel } from './TablePermissionsPanel.js';
import { useI18n } from './i18n.js';
import type { TranslationKey } from './i18n-types.js';
import { useServiceSidebarPortal } from './ServiceSidebar.js';
import { useModalDialog } from './useModalDialog.js';
import type {
  BulkRecordFieldChange,
  DynamicRecord,
  FieldDefinition,
  FieldType,
  GridCellAddress,
  GridColumn,
  GridSelection,
  ObjectType,
  ProjectReference,
  QueryResult,
  RecordExportJob,
  RecordGrouping,
  RecordSummaryOperation,
  RecordView,
  RecordViewConfig,
  RecordViewPermissionType,
  RecordViewType,
  SystemFieldWidthKey,
  WorkspaceDataContext,
} from './DataPageTypes.js';
export type { WorkspaceDataContext } from './DataPageTypes.js';
import {
  canonicalTableIdentifier,
  BulkRecordEditPanel,
  clipboardSafeValue,
  GridCell,
  gridEditorDraft,
  gridValue,
  InlineRecordRow,
  type inlineRecordPayload,
  isStructuredFieldType,
  parseClipboardGrid,
  projectPath,
  RecordForm,
  recordPayload,
  selectionBounds,
  structuredDataText,
  viewConfigsEqual,
} from './DataPageGrid.js';

const MAX_BULK_RECORDS = 100;
import { ImageGridCell, isImageField } from './DataPageImages.js';
import { ProjectReferencePicker } from './ProjectReferencePicker.js';
import { RelationValue } from './RecordRelationPicker.js';
import {
  CalendarRecordsView,
  displayFieldValue,
  displayValue,
  GalleryRecordsView,
  KanbanRecordsView,
  LinkedTasksPanel,
  MeasurementsPanel,
  recordGridValue,
  RecordHistoryPanel,
  SpecificationsPanel,
} from './DataPageViews.js';
import {
  CalculatedFieldSettings,
  calculatedFieldTypeSet,
  checkboxClass,
  checkboxLabelClass,
  emptyPanelClass,
  fieldSupportsUnique,
  fieldHintClass,
  fieldLabelClass,
  fieldTypeMeta,
  fieldTypeTranslationKeys,
  fieldTypes,
  schemaFieldConfig,
  schemaFieldKey,
  skeletonLineClass,
  wideFieldLabelClass,
} from './DataPageSchema.js';

const DEFAULT_FIELD_WIDTH = 176;
const DEFAULT_SYSTEM_FIELD_WIDTHS: Record<SystemFieldWidthKey, number> = {
  displayName: 208,
  contextProject: 192,
  updatedAt: 112,
};
const MIN_COLUMN_WIDTH = 100;
const MAX_COLUMN_WIDTH = 480;
const COLUMN_KEYBOARD_STEP = 8;
const TABLE_CATALOG_PAGE_SIZE = 50;
const VIEW_PAGE_SIZE = 50;

interface TableCatalogPageInfo {
  limit: number;
  offset: number;
  total: number;
  hasNext: boolean;
}

function mergeObjectTypes(current: ObjectType[], additions: ObjectType[]): ObjectType[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  additions.forEach((item) => merged.set(item.id, item));
  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
}

type SchemaFieldType = FieldType | 'image';
const schemaFieldTypeTranslationKeys: Record<SchemaFieldType, TranslationKey> = {
  ...fieldTypeTranslationKeys,
  image: 'data.fieldTypeImage',
};
const fieldGroupTranslationKeys = {
  Basic: 'data.fieldGroupBasic',
  Choice: 'data.fieldGroupChoice',
  Linked: 'data.fieldGroupLinked',
  Engineering: 'data.fieldGroupEngineering',
  Structured: 'data.fieldGroupStructured',
  Calculated: 'data.fieldGroupCalculated',
} as const satisfies Record<string, TranslationKey>;
const imageFieldMeta = {
  icon: '▧',
  group: 'Linked' as const,
};
const schemaFieldTypeMeta = { ...fieldTypeMeta, image: imageFieldMeta };

function fieldMeta(field: FieldDefinition) {
  return field.fieldType === 'file' && isImageField(field.config)
    ? imageFieldMeta
    : fieldTypeMeta[field.fieldType];
}

function schemaTypeForField(field: FieldDefinition): SchemaFieldType {
  return field.fieldType === 'file' && isImageField(field.config) ? 'image' : field.fieldType;
}

interface TableLayoutPreference {
  fieldOrderIds: string[];
  hiddenFieldIds: string[];
  fieldWidths: Record<string, number>;
  systemFieldWidths: Partial<Record<SystemFieldWidthKey, number>>;
  groupings: RecordGrouping[];
  fieldSummaries: Record<string, RecordSummaryOperation>;
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
    const fieldSummaries = Object.fromEntries(
      Object.entries(parsed.fieldSummaries ?? {}).flatMap(([fieldId, operation]) => {
        const field = fields.find((candidate) => candidate.id === fieldId);
        return field &&
          typeof operation === 'string' &&
          summaryOperationsForField(field).includes(operation as RecordSummaryOperation)
          ? [[fieldId, operation as RecordSummaryOperation]]
          : [];
      }),
    );
    const groupingIds = new Set<string>();
    const groupings = (Array.isArray(parsed.groupings) ? parsed.groupings : [])
      .flatMap((grouping) => {
        const field = fields.find((candidate) => candidate.id === grouping?.fieldId);
        if (
          !field ||
          groupingIds.has(field.id) ||
          !fieldCanGroup(field) ||
          !['asc', 'desc'].includes(grouping.direction)
        ) {
          return [];
        }
        groupingIds.add(field.id);
        return [
          {
            fieldId: field.id,
            direction: grouping.direction,
            enabled: grouping.enabled !== false,
          } satisfies RecordGrouping,
        ];
      })
      .slice(0, 3);
    return {
      fieldOrderIds,
      hiddenFieldIds,
      fieldWidths,
      systemFieldWidths,
      groupings,
      fieldSummaries,
    };
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

const viewTypeMeta: Record<RecordViewType, { icon: string; label: string }> = {
  grid: { icon: '▦', label: 'Grid' },
  form: { icon: '▤', label: 'Form' },
  gallery: { icon: '▧', label: 'Gallery' },
  kanban: { icon: '▥', label: 'Kanban' },
  calendar: { icon: '□', label: 'Calendar' },
};
const viewTypeTranslationKeys: Record<RecordViewType, TranslationKey> = {
  grid: 'data.viewGrid',
  form: 'data.viewForm',
  gallery: 'data.viewGallery',
  kanban: 'data.viewKanban',
  calendar: 'data.viewCalendar',
};

const summaryTranslationKeys: Record<RecordSummaryOperation, TranslationKey> = {
  count: 'data.count',
  sum: 'data.sum',
  average: 'data.average',
  min: 'data.minimum',
  max: 'data.maximum',
};

function summaryOperationsForField(field: FieldDefinition): RecordSummaryOperation[] {
  if (['integer', 'decimal', 'quantity', 'measurement'].includes(field.fieldType)) {
    return ['count', 'sum', 'average', 'min', 'max'];
  }
  if (['date', 'datetime'].includes(field.fieldType)) return ['count', 'min', 'max'];
  if (
    ['text', 'long_text', 'boolean', 'single_select', 'multi_select', 'user', 'relation'].includes(
      field.fieldType,
    )
  ) {
    return ['count'];
  }
  return [];
}

function fieldCanGroup(field: FieldDefinition): boolean {
  return ['text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'single_select'].includes(
    field.fieldType,
  );
}

function recordGroupValue(record: DynamicRecord, field: FieldDefinition): string | null {
  const value = recordGridValue(record, field);
  return value === undefined || value === null || value === '' ? null : String(value);
}

function groupPathKey(values: Array<string | null>): string {
  return JSON.stringify(values);
}

function recordViewPermission(view: RecordView): RecordViewPermissionType {
  return view.permissionType ?? 'collaborative';
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

function reorderIds(ids: string[], sourceId: string, targetId: string, after: boolean): string[] {
  const order = ids.filter((id) => id !== sourceId);
  const target = order.indexOf(targetId);
  if (target < 0 || order.length === ids.length) return ids;
  order.splice(target + Number(after), 0, sourceId);
  return order;
}

function useDismissiblePopoverMenus() {
  useEffect(() => {
    const selector = 'details[data-popover-menu][open]';
    const closeMenu = (menu: HTMLDetailsElement) => {
      menu.open = false;
    };
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      document.querySelectorAll<HTMLDetailsElement>(selector).forEach((menu) => {
        if (!menu.contains(event.target as Node)) closeMenu(menu);
      });
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const activeMenu =
        document.activeElement instanceof Element
          ? document.activeElement.closest<HTMLDetailsElement>(selector)
          : null;
      const openMenus = document.querySelectorAll<HTMLDetailsElement>(selector);
      if (openMenus.length === 0) return;
      event.preventDefault();
      openMenus.forEach(closeMenu);
      activeMenu?.querySelector<HTMLElement>('summary')?.focus();
    };
    const closeAfterAction = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.target.closest('summary')) return;
      const action = event.target.closest('button');
      const menu = action?.closest<HTMLDetailsElement>(selector);
      if (menu) closeMenu(menu);
    };
    const keepOnlyNewestMenu = (event: Event) => {
      if (
        !(event.target instanceof HTMLDetailsElement) ||
        !event.target.matches('details[data-popover-menu]') ||
        !event.target.open
      )
        return;
      document.querySelectorAll<HTMLDetailsElement>(selector).forEach((menu) => {
        if (menu !== event.target) closeMenu(menu);
      });
    };

    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('click', closeAfterAction);
    document.addEventListener('toggle', keepOnlyNewestMenu, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true);
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('click', closeAfterAction);
      document.removeEventListener('toggle', keepOnlyNewestMenu, true);
    };
  }, []);
}

export function DataPage({
  user,
  workspaceData,
}: {
  user: User;
  workspaceData?: WorkspaceDataContext;
}) {
  useDismissiblePopoverMenus();
  const { locale, t } = useI18n();
  const { confirmAction, promptText } = useActionDialog();
  const params = useParams();
  const workspaceId = workspaceData?.workspaceId ?? params.workspaceId ?? '';
  const projectId = workspaceData?.backingProjectId ?? params.projectId ?? '';
  const workspaceMode = Boolean(workspaceData);
  const routeObjectTypeId = workspaceMode ? params.objectTypeId : undefined;
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const base = projectPath(workspaceId, projectId);
  const [objectTypes, setObjectTypes] = useState<ObjectType[]>([]);
  const [visibleObjectTypes, setVisibleObjectTypes] = useState<ObjectType[]>([]);
  const [tableSearch, setTableSearch] = useState('');
  const [tableQuery, setTableQuery] = useState('');
  const [tablePage, setTablePage] = useState<TableCatalogPageInfo>({
    limit: TABLE_CATALOG_PAGE_SIZE,
    offset: 0,
    total: 0,
    hasNext: false,
  });
  const [tablesLoadingMore, setTablesLoadingMore] = useState(false);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [views, setViews] = useState<RecordView[]>([]);
  const [viewPage, setViewPage] = useState<TableCatalogPageInfo>({
    limit: VIEW_PAGE_SIZE,
    offset: 0,
    total: 0,
    hasNext: false,
  });
  const [viewsLoadingMore, setViewsLoadingMore] = useState(false);
  const [records, setRecords] = useState<QueryResult>({
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  });
  const [recordsObjectTypeId, setRecordsObjectTypeId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<25 | 50 | 100 | 250 | 500>(25);
  const [gridScrollTop, setGridScrollTop] = useState(0);
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
  const [activeTool, setActiveTool] = useState<'fields' | 'filter' | 'sort' | 'group' | null>(null);
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
  const [groupings, setGroupings] = useState<RecordGrouping[]>([]);
  const [collapsedGroupPaths, setCollapsedGroupPaths] = useState<Set<string>>(() => new Set());
  const [fieldSummaries, setFieldSummaries] = useState<Record<string, RecordSummaryOperation>>({});
  const [gridSelection, setGridSelection] = useState<GridSelection>();
  const [dragSelectingCells, setDragSelectingCells] = useState(false);
  const [clipboardBusy, setClipboardBusy] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(() => new Set());
  const [archiveState, setArchiveState] = useState<'active' | 'archived'>('active');
  const [selectedRecord, setSelectedRecord] = useState<DynamicRecord>();
  const [quickRecordTab, setQuickRecordTab] = useState<'fields' | 'comments' | 'history'>('fields');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const [showTableSettings, setShowTableSettings] = useState(false);
  const [showTablePermissions, setShowTablePermissions] = useState(false);
  const [showApiPanel, setShowApiPanel] = useState(false);
  const [showImportCsv, setShowImportCsv] = useState(false);
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [createTableBusy, setCreateTableBusy] = useState(false);
  const [createTableError, setCreateTableError] = useState('');
  const [schemaSearch, setSchemaSearch] = useState('');
  const [schemaSelection, setSchemaSelection] = useState<'new' | string>('new');
  const [schemaFieldType, setSchemaFieldType] = useState<SchemaFieldType>('text');
  const [schemaFieldName, setSchemaFieldName] = useState('');
  const [schemaFieldKeyValue, setSchemaFieldKeyValue] = useState('');
  const [schemaKeyEdited, setSchemaKeyEdited] = useState(false);
  const [schemaBusy, setSchemaBusy] = useState(false);
  const [schemaDraggedFieldId, setSchemaDraggedFieldId] = useState('');
  const [schemaDragTargetId, setSchemaDragTargetId] = useState('');
  const [showNewRecord, setShowNewRecord] = useState(false);
  const [showInlineRecord, setShowInlineRecord] = useState(false);
  const [typesLoading, setTypesLoading] = useState(true);
  const [viewsLoading, setViewsLoading] = useState(false);
  const [contextObjectTypeId, setContextObjectTypeId] = useState('');
  const [viewBusy, setViewBusy] = useState(false);
  const [showCreateView, setShowCreateView] = useState(false);
  const [showShareView, setShowShareView] = useState(false);
  const [newViewType, setNewViewType] = useState<RecordViewType>('grid');
  const [newViewPermission, setNewViewPermission] =
    useState<RecordViewPermissionType>('collaborative');
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const [projectReferences, setProjectReferences] = useState<ProjectReference[]>(
    () => workspaceData?.projects ?? [],
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuModel>();
  const [recordExport, setRecordExport] = useState<RecordExportJob>();
  const createTableTriggerRef = useRef<HTMLButtonElement>(null);
  const projectReferencesRequestId = useRef(0);
  const newRecordDialogRef = useModalDialog<HTMLElement>(showNewRecord, () =>
    setShowNewRecord(false),
  );
  const quickRecordDialogRef = useModalDialog<HTMLElement>(Boolean(selectedRecord), () =>
    setSelectedRecord(undefined),
  );
  const createTableDialogRef = useModalDialog<HTMLElement>(
    showCreateTable,
    () => setShowCreateTable(false),
    createTableTriggerRef,
  );
  const appliedViewKey = useRef('');
  const pendingViewId = useRef('');
  const layoutPreferenceReadyKey = useRef('');
  const mergeProjectReferences = useCallback((next: ProjectReference | ProjectReference[]) => {
    const additions = Array.isArray(next) ? next : [next];
    setProjectReferences((current) => {
      const merged = new Map(current.map((project) => [project.id, project]));
      additions.forEach((project) => merged.set(project.id, project));
      return [...merged.values()];
    });
  }, []);
  const projectById = useMemo(
    () => new Map(projectReferences.map((project) => [project.id, project])),
    [projectReferences],
  );
  const dataContextRequestId = useRef(0);
  const recordsRequestId = useRef(0);
  const tableCatalogRequestId = useRef(0);
  const sidebarPortal = useServiceSidebarPortal();
  const searchObjectTypeId = search.get('type');
  const selectedIdentifier = canonicalTableIdentifier(
    routeObjectTypeId ?? searchObjectTypeId ?? objectTypes[0]?.publicId ?? objectTypes[0]?.id ?? '',
  );
  const requestedViewId = search.get('view') ?? 'all';
  const selected = objectTypes.find(
    (objectType) =>
      (objectType.publicId ?? objectType.id) === selectedIdentifier ||
      objectType.id === selectedIdentifier,
  );
  const canCreateRecords =
    allowed(user, 'record.create') && (selected?.recordPermissions?.canCreate ?? true);
  const canUpdateRecords =
    allowed(user, 'record.update') && (selected?.recordPermissions?.canUpdate ?? true);
  const canArchiveRecords =
    allowed(user, 'record.archive') && (selected?.recordPermissions?.canArchive ?? true);
  const selectedId = selected?.id ?? '';
  const selectedPublicId = selected?.publicId ?? selectedIdentifier;
  const selectedView = views.find(
    (view) => view.id === requestedViewId || view.publicId === requestedViewId,
  );
  const canManageViews = allowed(user, 'view.manage');
  const canAdministerViews = allowed(user, 'schema.manage');
  const viewWritable = (view: RecordView) => {
    const permission = recordViewPermission(view);
    return (
      canManageViews &&
      permission !== 'locked' &&
      (permission === 'collaborative' || view.ownerId === user.id || canAdministerViews)
    );
  };
  const viewArchivable = (view: RecordView) =>
    canManageViews &&
    (recordViewPermission(view) === 'collaborative' ||
      view.ownerId === user.id ||
      canAdministerViews);
  const selectedViewWritable = Boolean(selectedView && viewWritable(selectedView));
  const selectedViewId = selectedView?.publicId ?? requestedViewId;
  const layoutPreferenceKey = `engrove:table-layout:${workspaceId}:${projectId}:${selectedId}`;
  const activeViewType = selectedView?.viewType ?? 'grid';
  const kanbanField = fields.find(
    (field) => field.id === selectedView?.config.viewOptions?.groupFieldId,
  );
  const calendarField = fields.find(
    (field) => field.id === selectedView?.config.viewOptions?.dateFieldId,
  );
  const availableFieldTypes: SchemaFieldType[] = workspaceMode
    ? [...fieldTypes.filter((type) => !['measurement', 'file', 'dataset'].includes(type)), 'image']
    : [...fieldTypes, 'image'];
  const emptyCapabilities =
    locale === 'ko'
      ? ['형식화된 필드', '저장된 뷰', 'CSV 가져오기·내보내기', '감사 이력']
      : ['Typed fields', 'Saved views', 'CSV import & export', 'Audit history'];
  const gridGuideLabel = locale === 'ko' ? '그리드 사용 안내' : 'Grid guide';
  const gridGuide =
    locale === 'ko'
      ? '셀을 더블 클릭하거나 Enter를 눌러 편집하세요. 우클릭으로 추가 작업을 열고, 셀 범위를 드래그해 복사하거나 붙여넣을 수 있습니다.'
      : 'Double-click a cell or press Enter to edit. Right-click for more actions, or drag across cells to copy and paste a range.';
  const sharedChangesLabel =
    locale === 'ko'
      ? '변경 사항은 이 테이블의 모든 뷰에 공유됩니다.'
      : 'Changes are shared across every view of this table.';
  const openCreateTable = (event: ReactMouseEvent<HTMLButtonElement>) => {
    createTableTriggerRef.current = event.currentTarget;
    setCreateTableError('');
    setShowCreateTable(true);
  };
  const selectDataLocation = useCallback(
    (objectTypeIdentifier: string, viewId = 'all', replace = false) => {
      const canonicalIdentifier = canonicalTableIdentifier(objectTypeIdentifier);
      if (workspaceMode) {
        const nextSearch = new URLSearchParams();
        if (viewId !== 'all') nextSearch.set('view', viewId);
        void navigate(
          {
            pathname: `/workspaces/${workspaceId}/${canonicalIdentifier}`,
            search: nextSearch.toString(),
          },
          { replace },
        );
        return;
      }
      setSearch(
        viewId === 'all'
          ? { type: canonicalIdentifier }
          : { type: canonicalIdentifier, view: viewId },
        { replace },
      );
    },
    [navigate, setSearch, workspaceId, workspaceMode],
  );
  useEffect(() => {
    if (!selected?.publicId) return;
    if (workspaceMode) {
      if (routeObjectTypeId === selected.publicId && !search.has('type')) return;
      const canonical = new URLSearchParams(search);
      canonical.delete('type');
      void navigate(
        {
          pathname: `/workspaces/${workspaceId}/${selected.publicId}`,
          search: canonical.toString(),
        },
        { replace: true },
      );
      return;
    }
    if (search.get('type') === selected.publicId) return;
    setSearch(
      (current) => {
        const canonical = new URLSearchParams(current);
        canonical.set('type', selected.publicId!);
        return canonical;
      },
      { replace: true },
    );
  }, [navigate, routeObjectTypeId, search, selected, setSearch, workspaceId, workspaceMode]);
  useEffect(() => {
    if (
      requestedViewId === 'all' ||
      !selectedView?.publicId ||
      requestedViewId === selectedView.publicId
    )
      return;
    selectDataLocation(selectedPublicId, selectedView.publicId, true);
  }, [requestedViewId, selectDataLocation, selectedPublicId, selectedView]);
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
  const schemaFields = useMemo(
    () => [...fields].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
    [fields],
  );
  const filteredSchemaFields = useMemo(() => {
    const query = schemaSearch.trim().toLowerCase();
    if (!query) return schemaFields;
    return schemaFields.filter(
      (field) =>
        field.name.toLowerCase().includes(query) ||
        field.key.toLowerCase().includes(query) ||
        t(schemaFieldTypeTranslationKeys[schemaTypeForField(field)]).toLowerCase().includes(query),
    );
  }, [schemaFields, schemaSearch, t]);
  const selectedSchemaField = fields.find((field) => field.id === schemaSelection);
  const visibleFields = useMemo(
    () => orderedFields.filter((field) => !hiddenFieldIds.has(field.id)),
    [hiddenFieldIds, orderedFields],
  );
  const groupableFields = useMemo(() => fields.filter(fieldCanGroup), [fields]);
  const activeGroupings = useMemo(
    () =>
      groupings.flatMap((grouping) =>
        grouping.enabled && groupableFields.some((field) => field.id === grouping.fieldId)
          ? [grouping]
          : [],
      ),
    [groupableFields, groupings],
  );
  const groupingFields = useMemo(
    () =>
      activeGroupings.flatMap((grouping) => {
        const field = fields.find((candidate) => candidate.id === grouping.fieldId);
        return field ? [field] : [];
      }),
    [activeGroupings, fields],
  );
  const groupResultByPath = useMemo(
    () =>
      new Map(
        (records.groupHierarchy ?? []).map((group) => [
          groupPathKey(group.path.map((part) => part.value)),
          group,
        ]),
      ),
    [records.groupHierarchy],
  );
  const requestedSummaries = useMemo(
    () =>
      visibleFields.flatMap((field) =>
        fieldSummaries[field.id]
          ? [{ fieldId: field.id, operation: fieldSummaries[field.id]! }]
          : [],
      ),
    [fieldSummaries, visibleFields],
  );
  const gridColumns = useMemo<GridColumn[]>(
    () => [
      {
        key: 'displayName',
        label: t('data.name'),
        kind: 'displayName',
        editable: archiveState === 'active',
      },
      ...(workspaceMode
        ? ([
            {
              key: 'contextProject',
              label: t('data.project'),
              kind: 'contextProject',
              editable: archiveState === 'active',
            },
          ] satisfies GridColumn[])
        : []),
      ...visibleFields.map((field): GridColumn => ({
        key: `field:${field.id}`,
        label: field.name,
        kind: 'field',
        editable:
          archiveState === 'active' &&
          field.fieldType !== 'measurement' &&
          !calculatedFieldTypeSet.has(field.fieldType),
        field,
      })),
    ],
    [archiveState, t, visibleFields, workspaceMode],
  );
  const gridSelectionBounds = useMemo(
    () => selectionBounds(gridSelection, records.items, gridColumns),
    [gridColumns, gridSelection, records.items],
  );
  const selectedGridCellCount = gridSelectionBounds
    ? (gridSelectionBounds.rowEnd - gridSelectionBounds.rowStart + 1) *
      (gridSelectionBounds.columnEnd - gridSelectionBounds.columnStart + 1)
    : 0;
  const virtualRowHeight = rowDensity === 'comfortable' ? 45 : 33;
  const virtualizeGrid =
    activeViewType === 'grid' && activeGroupings.length === 0 && records.items.length > 80;
  const virtualStart = virtualizeGrid
    ? Math.max(0, Math.floor(gridScrollTop / virtualRowHeight) - 10)
    : 0;
  const virtualEnd = virtualizeGrid
    ? Math.min(records.items.length, virtualStart + Math.ceil(720 / virtualRowHeight) + 20)
    : records.items.length;
  const virtualRecords = records.items.slice(virtualStart, virtualEnd);
  const groupingStateKey = groupings
    .map((grouping) => `${grouping.fieldId}:${grouping.direction}:${grouping.enabled}`)
    .join('|');

  useEffect(() => setCollapsedGroupPaths(new Set()), [groupingStateKey, selectedId]);
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
      ...(activeViewType === 'grid' && groupings.length ? { groupings } : {}),
      ...(activeViewType === 'grid' && requestedSummaries.length
        ? { summaries: requestedSummaries }
        : {}),
      ...(Object.keys(viewOptions).length ? { viewOptions } : {}),
    };
  }, [
    activeViewType,
    fieldWidths,
    filterField,
    filterOperator,
    filterValue,
    groupings,
    orderedFields,
    pageSize,
    rowDensity,
    requestedSummaries,
    contextProjectFilter,
    selectedView?.config.viewOptions,
    sortDirection,
    sortField,
    systemFieldWidths,
    visibleFields,
    workspaceMode,
  ]);
  const viewDirty = Boolean(
    selectedView && !viewConfigsEqual(currentViewConfig, selectedView.config),
  );

  useEffect(() => {
    const stopSelecting = () => setDragSelectingCells(false);
    window.addEventListener('pointerup', stopSelecting);
    window.addEventListener('pointercancel', stopSelecting);
    return () => {
      window.removeEventListener('pointerup', stopSelecting);
      window.removeEventListener('pointercancel', stopSelecting);
    };
  }, []);

  useEffect(() => {
    setGridSelection(undefined);
    setDragSelectingCells(false);
  }, [activeViewType, page, selectedId, selectedViewId]);

  useEffect(() => {
    if (!viewDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [viewDirty]);

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
        setGroupings(preference?.groupings ?? []);
        setFieldSummaries(preference?.fieldSummaries ?? {});
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
      const configuredGroupingIds = new Set<string>();
      setGroupings(
        (config.groupings ?? []).flatMap((grouping) => {
          const field = fields.find((candidate) => candidate.id === grouping.fieldId);
          if (!field || configuredGroupingIds.has(field.id) || !fieldCanGroup(field)) return [];
          configuredGroupingIds.add(field.id);
          return [grouping];
        }),
      );
      setFieldSummaries(
        Object.fromEntries(
          (config.summaries ?? []).flatMap((summary) => {
            const field = fields.find((candidate) => candidate.id === summary.fieldId);
            return field && summaryOperationsForField(field).includes(summary.operation)
              ? [[summary.fieldId, summary.operation]]
              : [];
          }),
        ),
      );
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
          groupings,
          fieldSummaries,
        } satisfies TableLayoutPreference),
      );
    } catch {
      // Local preferences are optional; table editing must continue if storage is unavailable.
    }
  }, [
    fieldOrderIds,
    fieldWidths,
    fieldSummaries,
    groupings,
    hiddenFieldIds,
    layoutPreferenceKey,
    selectedId,
    selectedViewId,
    systemFieldWidths,
  ]);

  const loadTypes = useCallback(
    async (query = tableQuery, offset = 0, append = false) => {
      const requestId = ++tableCatalogRequestId.current;
      if (append) setTablesLoadingMore(true);
      else setTypesLoading(true);
      try {
        const parameters = new URLSearchParams({
          limit: String(TABLE_CATALOG_PAGE_SIZE),
          offset: String(offset),
        });
        if (query.trim()) parameters.set('query', query.trim());
        const catalogPath =
          !query.trim() && offset === 0
            ? `${base}/object-types`
            : `${base}/object-types?${parameters.toString()}`;
        const result = await api<{
          items: ObjectType[];
          pageInfo?: TableCatalogPageInfo;
        }>(catalogPath);
        const nextPage = result.pageInfo ?? {
          limit: TABLE_CATALOG_PAGE_SIZE,
          offset,
          total: result.items.length,
          hasNext: false,
        };
        if (requestId !== tableCatalogRequestId.current) return;
        setVisibleObjectTypes((current) =>
          append ? mergeObjectTypes(current, result.items) : result.items,
        );
        setObjectTypes((current) => mergeObjectTypes(current, result.items));
        setTablePage(nextPage);
        setMessage('');
      } catch (cause) {
        if (requestId !== tableCatalogRequestId.current) return;
        setMessageTone('error');
        setMessage(cause instanceof Error ? cause.message : t('data.objectTypesLoadFailed'));
      } finally {
        if (requestId === tableCatalogRequestId.current) {
          if (append) setTablesLoadingMore(false);
          else setTypesLoading(false);
        }
      }
    },
    [base, tableQuery, t],
  );

  useEffect(() => void loadTypes(), [loadTypes]);

  useEffect(() => {
    if (routeObjectTypeId || searchObjectTypeId || tableQuery.trim() || !visibleObjectTypes[0])
      return;
    selectDataLocation(visibleObjectTypes[0].publicId ?? visibleObjectTypes[0].id, 'all', true);
  }, [routeObjectTypeId, searchObjectTypeId, selectDataLocation, tableQuery, visibleObjectTypes]);

  useEffect(() => {
    const requestedIdentifier = routeObjectTypeId ?? searchObjectTypeId;
    if (
      !requestedIdentifier ||
      objectTypes.some(
        (item) => item.id === requestedIdentifier || item.publicId === requestedIdentifier,
      )
    )
      return;
    let active = true;
    void api<ObjectType>(`${base}/object-types/${requestedIdentifier}`)
      .then((exact) => {
        if (active) setObjectTypes((current) => mergeObjectTypes(current, [exact]));
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setMessageTone('error');
        setMessage(cause instanceof Error ? cause.message : t('data.objectTypesLoadFailed'));
      });
    return () => {
      active = false;
    };
  }, [base, objectTypes, routeObjectTypeId, searchObjectTypeId, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => setTableQuery(tableSearch), 250);
    return () => window.clearTimeout(timer);
  }, [tableSearch]);

  const loadDataContext = useCallback(async () => {
    const requestId = ++dataContextRequestId.current;
    if (!selectedId) {
      setFields([]);
      setViews([]);
      setViewPage({ limit: VIEW_PAGE_SIZE, offset: 0, total: 0, hasNext: false });
      setContextObjectTypeId('');
      setViewsLoading(false);
      return;
    }
    setViewsLoading(true);
    try {
      const [fieldResult, viewResult] = await Promise.all([
        api<{ items: FieldDefinition[] }>(`${base}/object-types/${selectedId}/fields`),
        api<{ items: RecordView[]; pageInfo?: TableCatalogPageInfo }>(
          `${base}/object-types/${selectedId}/views?limit=${VIEW_PAGE_SIZE}&offset=0`,
        ),
      ]);
      if (requestId === dataContextRequestId.current) {
        setFields(fieldResult.items);
        setViews(viewResult.items);
        setViewPage(
          viewResult.pageInfo ?? {
            limit: VIEW_PAGE_SIZE,
            offset: 0,
            total: viewResult.items.length,
            hasNext: false,
          },
        );
        setContextObjectTypeId(selectedId);
      }
    } catch (cause) {
      if (requestId === dataContextRequestId.current) {
        setMessageTone('error');
        setMessage(cause instanceof Error ? cause.message : t('data.tableContextLoadFailed'));
      }
    } finally {
      if (requestId === dataContextRequestId.current) setViewsLoading(false);
    }
  }, [base, selectedId]);

  useEffect(() => void loadDataContext(), [loadDataContext]);

  useEffect(() => {
    if (
      requestedViewId === 'all' ||
      !selectedId ||
      contextObjectTypeId !== selectedId ||
      viewsLoading ||
      views.some((view) => view.id === requestedViewId || view.publicId === requestedViewId)
    )
      return;
    let active = true;
    void api<RecordView>(`${base}/object-types/${selectedId}/views/${requestedViewId}`)
      .then((exact) => {
        if (!active) return;
        setViews((current) =>
          current.some((view) => view.id === exact.id)
            ? current
            : [...current, exact].sort((left, right) => left.name.localeCompare(right.name)),
        );
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.code === 'RECORD_VIEW_NOT_FOUND') {
          selectDataLocation(selectedPublicId, 'all', true);
          return;
        }
        setMessageTone('error');
        setMessage(cause instanceof Error ? cause.message : t('data.tableContextLoadFailed'));
      });
    return () => {
      active = false;
    };
  }, [
    base,
    contextObjectTypeId,
    requestedViewId,
    selectDataLocation,
    selectedId,
    selectedPublicId,
    t,
    views,
    viewsLoading,
  ]);

  async function loadMoreViews() {
    if (!selectedId || !viewPage.hasNext || viewsLoadingMore) return;
    setViewsLoadingMore(true);
    try {
      const result = await api<{ items: RecordView[]; pageInfo: TableCatalogPageInfo }>(
        `${base}/object-types/${selectedId}/views?limit=${VIEW_PAGE_SIZE}&offset=${viewPage.offset + viewPage.limit}`,
      );
      setViews((current) => {
        const merged = new Map(current.map((view) => [view.id, view]));
        result.items.forEach((view) => merged.set(view.id, view));
        return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
      });
      setViewPage(result.pageInfo);
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('data.tableContextLoadFailed'));
    } finally {
      setViewsLoadingMore(false);
    }
  }

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
    setArchiveState('active');
    setActiveTool(null);
    setShowCreateView(false);
    setShowTableSettings(false);
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
    const view = views.find(
      (candidate) => candidate.id === selectedViewId || candidate.publicId === selectedViewId,
    );
    if (view) {
      const key = `${selectedId}:${view.id}:${view.rowVersion}:${fields.map((field) => field.id).join(',')}`;
      if (appliedViewKey.current === key) return;
      appliedViewKey.current = key;
      applyViewConfig(view.config);
      return;
    }
    return;
  }, [
    applyViewConfig,
    contextObjectTypeId,
    fields,
    selectedId,
    selectedPublicId,
    selectedViewId,
    selectDataLocation,
    views,
    viewsLoading,
  ]);

  useEffect(() => setQuickRecordTab('fields'), [selectedRecord?.id]);

  useEffect(() => {
    if (!selectedRows.size) setShowBulkEdit(false);
  }, [selectedRows]);

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
      archiveState,
      ...(debouncedSearchValue ? { search: debouncedSearchValue } : {}),
      ...(workspaceMode && contextProjectFilter !== 'all'
        ? {
            contextProjectId: contextProjectFilter === 'none' ? null : contextProjectFilter,
          }
        : {}),
      ...(activeViewType === 'kanban' && kanbanField ? { groupByFieldId: kanbanField.id } : {}),
      ...(activeViewType === 'grid' && activeGroupings.length
        ? { groupings: activeGroupings }
        : {}),
      ...(activeViewType === 'grid' ? { summaries: requestedSummaries } : {}),
      page,
      pageSize: ['kanban', 'calendar'].includes(activeViewType) ? 100 : pageSize,
    };
  }, [
    activeViewType,
    activeGroupings,
    archiveState,
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
    requestedSummaries,
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
        setRecordsObjectTypeId(selectedId);
        setMessage('');
      }
    } catch (cause) {
      if (requestId === recordsRequestId.current) {
        setMessageTone('error');
        setMessage(cause instanceof Error ? cause.message : t('data.recordsLoadFailed'));
      }
    } finally {
      if (requestId === recordsRequestId.current) setRecordsLoading(false);
    }
  }, [base, queryBody, selectedId]);

  useEffect(() => void loadRecords(), [loadRecords]);

  useEffect(() => {
    projectReferencesRequestId.current += 1;
    setProjectReferences(workspaceData?.projects ?? []);
  }, [workspaceData?.projects, workspaceData?.workspaceId]);

  useEffect(() => {
    if (!workspaceMode || !workspaceData) return;
    const referencedIds = new Set(
      records.items.flatMap((record) => (record.contextProjectId ? [record.contextProjectId] : [])),
    );
    if (contextProjectFilter !== 'all' && contextProjectFilter !== 'none') {
      referencedIds.add(contextProjectFilter);
    }
    const missingIds = [...referencedIds].filter((id) => !projectById.has(id));
    if (!missingIds.length) return;
    const requestId = ++projectReferencesRequestId.current;
    void Promise.all(
      Array.from({ length: Math.ceil(missingIds.length / 500) }, (_, index) =>
        api<{ items: ProjectReference[] }>(
          `/workspaces/${workspaceData.workspaceId}/project-references/query`,
          {
            method: 'POST',
            body: JSON.stringify({ ids: missingIds.slice(index * 500, (index + 1) * 500) }),
          },
        ),
      ),
    )
      .then((responses) => {
        if (requestId !== projectReferencesRequestId.current) return;
        mergeProjectReferences(responses.flatMap((response) => response.items));
      })
      .catch(() => {
        if (requestId !== projectReferencesRequestId.current) return;
        setMessageTone('error');
        setMessage(t('data.projectReferencesLoadFailed'));
      });
  }, [
    contextProjectFilter,
    mergeProjectReferences,
    projectById,
    records.items,
    t,
    workspaceData,
    workspaceMode,
  ]);

  async function installTemplate() {
    try {
      const result = await api<{ changed: boolean }>(
        `${base}/templates/test-characterization/install`,
        {
          method: 'POST',
          body: '{}',
        },
      );
      await loadTypes('', 0, false);
      setMessageTone('success');
      setMessage(result.changed ? t('data.templateInstalled') : t('data.templateCurrent'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('data.templateInstallFailed'));
    }
  }

  async function createObjectType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createTableBusy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setCreateTableBusy(true);
    setCreateTableError('');
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
      setShowCreateTable(false);
      setTableSearch('');
      setTableQuery('');
      await loadTypes('', 0, false);
      selectDataLocation(created.publicId ?? created.id);
    } catch (cause) {
      setMessageTone('error');
      const nextError = cause instanceof Error ? cause.message : t('data.objectTypeCreateFailed');
      setMessage(nextError);
      setCreateTableError(nextError);
    } finally {
      setCreateTableBusy(false);
    }
  }

  async function updateObjectType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    setSchemaBusy(true);
    try {
      const updated = await api<ObjectType>(`${base}/object-types/${selectedPublicId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: data.get('name'),
          pluralName: data.get('pluralName'),
          key: data.get('key'),
          description: data.get('description'),
        }),
      });
      setObjectTypes((current) =>
        current
          .map((objectType) => (objectType.id === updated.id ? updated : objectType))
          .sort((left, right) => left.name.localeCompare(right.name)),
      );
      setShowTableSettings(false);
      setMessageTone('success');
      setMessage(t('data.tableUpdated', { name: updated.pluralName }));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('data.tableUpdateFailed'));
    } finally {
      setSchemaBusy(false);
    }
  }

  function beginNewSchemaField() {
    setSchemaSelection('new');
    setSchemaFieldName('');
    setSchemaFieldKeyValue('');
    setSchemaKeyEdited(false);
    setSchemaFieldType('text');
  }

  async function createField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const selectedType = String(data.get('fieldType')) as SchemaFieldType;
    const type: FieldType = selectedType === 'image' ? 'file' : selectedType;
    const config =
      selectedType === 'image' ? { mediaKind: 'image' } : schemaFieldConfig(type, data);
    setSchemaBusy(true);
    try {
      const created = await api<FieldDefinition>(`${base}/object-types/${selectedId}/fields`, {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          key: data.get('key'),
          description: data.get('description'),
          fieldType: type,
          required: data.get('required') === 'on',
          unique: data.get('unique') === 'on',
          position: fields.length,
          config,
        }),
      });
      form.reset();
      await Promise.all([loadDataContext(), loadRecords()]);
      setSchemaSelection(created.id);
      setSchemaFieldName('');
      setSchemaFieldKeyValue('');
      setSchemaKeyEdited(false);
      setSchemaFieldType('text');
      setMessageTone('success');
      setMessage(t('data.fieldCreated', { name: created.name }));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('data.fieldCreateFailed'));
    } finally {
      setSchemaBusy(false);
    }
  }

  async function updateField(event: FormEvent<HTMLFormElement>, field: FieldDefinition) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSchemaBusy(true);
    try {
      const updated = await api<FieldDefinition>(
        `${base}/object-types/${selectedId}/fields/${field.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: data.get('name'),
            description: data.get('description'),
            required: data.get('required') === 'on',
            unique: data.get('unique') === 'on',
            position: Number(data.get('position') ?? field.position),
            config: [
              'single_select',
              'multi_select',
              'relation',
              'quantity',
              'measurement',
              'range',
              'spectral_data',
              'tabular_data',
              'formula',
              'lookup',
              'rollup',
            ].includes(field.fieldType)
              ? schemaFieldConfig(field.fieldType, data)
              : field.config,
          }),
        },
      );
      await Promise.all([loadDataContext(), loadRecords()]);
      setMessageTone('success');
      setMessage(t('data.fieldUpdated', { name: updated.name }));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('data.fieldUpdateFailed'));
    } finally {
      setSchemaBusy(false);
    }
  }

  async function exportCsv() {
    try {
      const job = await api<RecordExportJob>(`${base}/object-types/${selectedId}/records/exports`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          fieldKeys: visibleFields.map((field) => field.key),
          filters: queryBody.filters,
          sorts: queryBody.sorts,
          ...(queryBody.search ? { search: queryBody.search } : {}),
          ...(queryBody.contextProjectId !== undefined
            ? { contextProjectId: queryBody.contextProjectId }
            : {}),
          archiveState: queryBody.archiveState,
        }),
      });
      setRecordExport(job);
      setMessageTone('info');
      setMessage(t('data.csvExportQueued'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('data.csvExportFailed'));
    }
  }

  useEffect(() => {
    if (!recordExport || !['queued', 'running'].includes(recordExport.status)) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void api<RecordExportJob>(
        `${base}/object-types/${recordExport.objectTypeId}/records/exports/${recordExport.id}`,
      )
        .then(async (job) => {
          if (cancelled) return;
          if (job.status === 'succeeded') {
            const download = await api<{ url: string; expiresIn: 300; fileName: string }>(
              `${base}/object-types/${job.objectTypeId}/records/exports/${job.id}/download`,
            );
            if (cancelled) return;
            const link = document.createElement('a');
            link.href = download.url;
            link.download = download.fileName;
            link.click();
            setRecordExport(job);
            setMessageTone('success');
            setMessage(t('data.csvExportReady', { count: job.rowCount ?? 0 }));
          } else if (job.status === 'failed') {
            setRecordExport(job);
            setMessageTone('error');
            setMessage(t('data.csvExportFailed'));
          } else {
            setRecordExport(job);
          }
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setMessageTone('error');
          setMessage(cause instanceof Error ? cause.message : t('data.csvExportFailed'));
        });
    }, 1_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [base, recordExport, t]);

  function beginGridCellSelection(
    event: ReactPointerEvent<HTMLTableCellElement>,
    address: GridCellAddress,
  ) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-grid-cell-editor]')) return;
    event.currentTarget.focus({ preventScroll: true });
    setGridSelection((current) => ({
      anchor: event.shiftKey && current ? current.anchor : address,
      focus: address,
    }));
    setDragSelectingCells(true);
  }

  function extendGridCellSelection(
    event: ReactPointerEvent<HTMLTableCellElement>,
    address: GridCellAddress,
  ) {
    if (!dragSelectingCells || event.buttons !== 1) return;
    setGridSelection((current) => (current ? { ...current, focus: address } : undefined));
  }

  function gridCellSelectionClass(address: GridCellAddress): string {
    if (!gridSelectionBounds) return '';
    const rowIndex = records.items.findIndex((record) => record.id === address.rowId);
    const columnIndex = gridColumns.findIndex((column) => column.key === address.columnKey);
    const selectedCell =
      rowIndex >= gridSelectionBounds.rowStart &&
      rowIndex <= gridSelectionBounds.rowEnd &&
      columnIndex >= gridSelectionBounds.columnStart &&
      columnIndex <= gridSelectionBounds.columnEnd;
    if (!selectedCell) return '';
    const activeCell =
      gridSelection?.anchor.rowId === address.rowId &&
      gridSelection.anchor.columnKey === address.columnKey;
    return `!bg-sky-500/15 outline outline-offset-[-1px] ${activeCell ? 'z-10 outline-2 outline-sky-300' : 'outline-1 outline-sky-500/60'}`;
  }

  function gridClipboardValue(record: DynamicRecord, column: GridColumn): string {
    if (column.kind === 'displayName') return record.displayName;
    if (column.kind === 'contextProject') {
      return projectById.get(record.contextProjectId ?? '')?.name ?? '';
    }
    const value = recordGridValue(record, column.field);
    if (column.field.fieldType === 'measurement') {
      return record.measurements?.[column.field.id]?.value ?? '';
    }
    const draft = gridEditorDraft(column.field, value);
    if (column.field.fieldType === 'boolean') {
      return draft.primary === 'true' ? 'Yes' : draft.primary === 'false' ? 'No' : '';
    }
    if (column.field.fieldType === 'single_select') {
      return (
        column.field.config.options?.find((option) => option.key === draft.primary)?.label ??
        draft.primary
      );
    }
    if (column.field.fieldType === 'range') {
      return [draft.primary, draft.secondary].filter(Boolean).join(' .. ');
    }
    if (column.field.fieldType === 'quantity') {
      return [draft.primary, draft.unit].filter(Boolean).join(' ');
    }
    return draft.primary;
  }

  function pastedGridValue(record: DynamicRecord, column: GridColumn, text: string): unknown {
    if (column.kind === 'displayName') {
      return gridValue(undefined, { primary: text, secondary: '', unit: '' });
    }
    if (column.kind !== 'field' || !column.editable) return undefined;
    const field = column.field;
    const draft = gridEditorDraft(field, recordGridValue(record, field));
    let primary = text.trim();
    if (field.fieldType === 'boolean') {
      const normalized = primary.toLowerCase();
      primary = ['yes', 'true', '1', 'y'].includes(normalized)
        ? 'true'
        : ['no', 'false', '0', 'n'].includes(normalized)
          ? 'false'
          : primary;
    }
    if (field.fieldType === 'single_select') {
      primary =
        field.config.options?.find(
          (option) =>
            option.key.toLowerCase() === primary.toLowerCase() ||
            option.label.toLowerCase() === primary.toLowerCase(),
        )?.key ?? primary;
    }
    if (field.fieldType === 'quantity') {
      const pastedUnit = field.config.allowedUnits?.find((unit) =>
        primary.toLowerCase().endsWith(` ${unit.toLowerCase()}`),
      );
      if (pastedUnit) {
        primary = primary.slice(0, -(pastedUnit.length + 1));
        draft.unit = pastedUnit;
      }
    }
    if (field.fieldType === 'range') {
      const [lower = '', upper = ''] = primary.split(/\s*(?:\.\.|…|–)\s*/, 2);
      primary = lower;
      draft.secondary = upper;
    }
    return gridValue(field, { ...draft, primary });
  }

  async function resolveProjectReference(value: string): Promise<ProjectReference> {
    const normalized = value.trim().toLocaleLowerCase();
    const known = projectReferences.find(
      (project) =>
        project.id.toLocaleLowerCase() === normalized ||
        project.publicId?.toLocaleLowerCase() === normalized ||
        project.name.toLocaleLowerCase() === normalized ||
        project.key.toLocaleLowerCase() === normalized,
    );
    if (known) return known;
    if (!workspaceData) throw new Error(`Project “${value.trim()}” was not found.`);
    const parameters = new URLSearchParams({ limit: '20', query: value.trim() });
    const response = await api<{ items: ProjectReference[] }>(
      `/workspaces/${workspaceData.workspaceId}/project-options?${parameters.toString()}`,
    );
    const resolved = response.items.find(
      (project) =>
        project.id.toLocaleLowerCase() === normalized ||
        project.publicId?.toLocaleLowerCase() === normalized ||
        project.name.toLocaleLowerCase() === normalized ||
        project.key.toLocaleLowerCase() === normalized,
    );
    if (!resolved) throw new Error(`Project “${value.trim()}” was not found.`);
    mergeProjectReferences(resolved);
    return resolved;
  }

  function handleGridCopy(event: ReactClipboardEvent<HTMLTableElement>) {
    if (!gridSelectionBounds) return;
    const singleRecord = records.items[gridSelectionBounds.rowStart];
    const singleColumn = gridColumns[gridSelectionBounds.columnStart];
    const singleStructuredCell =
      gridSelectionBounds.rowStart === gridSelectionBounds.rowEnd &&
      gridSelectionBounds.columnStart === gridSelectionBounds.columnEnd &&
      singleRecord &&
      singleColumn?.kind === 'field' &&
      isStructuredFieldType(singleColumn.field.fieldType);
    const text = singleStructuredCell
      ? structuredDataText(singleColumn.field, recordGridValue(singleRecord, singleColumn.field))
      : records.items
          .slice(gridSelectionBounds.rowStart, gridSelectionBounds.rowEnd + 1)
          .map((record) =>
            gridColumns
              .slice(gridSelectionBounds.columnStart, gridSelectionBounds.columnEnd + 1)
              .map((column) => clipboardSafeValue(gridClipboardValue(record, column)))
              .join('\t'),
          )
          .join('\n');
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    setLayoutAnnouncement(`${selectedGridCellCount} cells copied.`);
  }

  async function pasteGridText(text: string) {
    if (archiveState !== 'active' || !gridSelection || clipboardBusy || !canUpdateRecords) return;
    const matrix = parseClipboardGrid(text);
    if (!matrix.length || !matrix.some((row) => row.length)) return;
    const anchorRow = records.items.findIndex((record) => record.id === gridSelection.anchor.rowId);
    const anchorColumn = gridColumns.findIndex(
      (column) => column.key === gridSelection.anchor.columnKey,
    );
    if (anchorRow < 0 || anchorColumn < 0) return;

    const targets: Array<{ rowIndex: number; columnIndex: number; value: string }> = [];
    const anchorField =
      gridColumns[anchorColumn]?.kind === 'field' ? gridColumns[anchorColumn].field : undefined;
    if (anchorField && isStructuredFieldType(anchorField.fieldType)) {
      targets.push({ rowIndex: anchorRow, columnIndex: anchorColumn, value: text });
    } else if (matrix.length === 1 && matrix[0]?.length === 1 && gridSelectionBounds) {
      for (
        let rowIndex = gridSelectionBounds.rowStart;
        rowIndex <= gridSelectionBounds.rowEnd;
        rowIndex += 1
      ) {
        for (
          let columnIndex = gridSelectionBounds.columnStart;
          columnIndex <= gridSelectionBounds.columnEnd;
          columnIndex += 1
        ) {
          targets.push({ rowIndex, columnIndex, value: matrix[0]![0] ?? '' });
        }
      }
    } else {
      matrix.forEach((row, rowOffset) => {
        row.forEach((value, columnOffset) => {
          const rowIndex = anchorRow + rowOffset;
          const columnIndex = anchorColumn + columnOffset;
          if (records.items[rowIndex] && gridColumns[columnIndex]) {
            targets.push({ rowIndex, columnIndex, value });
          }
        });
      });
    }
    if (!targets.length) return;

    setClipboardBusy(true);
    const workingRecords = new Map(records.items.map((record) => [record.id, record]));
    const failedRows = new Set<string>();
    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    for (const target of targets) {
      const originalRecord = records.items[target.rowIndex];
      const column = gridColumns[target.columnIndex];
      if (!originalRecord || !column || failedRows.has(originalRecord.id)) continue;
      if (!column.editable) {
        skippedCount += 1;
        continue;
      }
      const record = workingRecords.get(originalRecord.id) ?? originalRecord;
      try {
        const updated =
          column.kind === 'contextProject'
            ? await updateProjectCellRecord(
                record,
                target.value.trim()
                  ? (await resolveProjectReference(target.value.trim())).id
                  : null,
              )
            : await updateGridCellRecord(
                record,
                column.kind === 'displayName' ? 'displayName' : column.field,
                pastedGridValue(record, column, target.value),
              );
        workingRecords.set(updated.id, updated);
        updatedCount += 1;
      } catch {
        failedRows.add(originalRecord.id);
        failedCount += 1;
      }
    }
    setClipboardBusy(false);
    const lastTarget = targets.at(-1);
    const lastRecord = lastTarget ? records.items[lastTarget.rowIndex] : undefined;
    const lastColumn = lastTarget ? gridColumns[lastTarget.columnIndex] : undefined;
    if (lastRecord && lastColumn) {
      setGridSelection((current) =>
        current
          ? {
              anchor: current.anchor,
              focus: { rowId: lastRecord.id, columnKey: lastColumn.key },
            }
          : current,
      );
    }
    setMessageTone(failedCount ? 'error' : 'success');
    setMessage(
      `${updatedCount} cells pasted${skippedCount ? ` · ${skippedCount} read-only cells skipped` : ''}${failedCount ? ` · ${failedCount} rows failed` : ''}.`,
    );
    setLayoutAnnouncement(`${updatedCount} cells pasted.`);
  }

  function handleGridPaste(event: ReactClipboardEvent<HTMLTableElement>) {
    if (archiveState !== 'active' || !gridSelection || !canUpdateRecords) return;
    event.preventDefault();
    void pasteGridText(event.clipboardData.getData('text/plain'));
  }

  function handleGridSelectionKeyDown(event: ReactKeyboardEvent<HTMLTableElement>) {
    if (!gridSelection || (event.target as HTMLElement).closest('[data-grid-cell-editor]')) return;
    const movement: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (event.key === 'Escape') {
      setGridSelection(undefined);
      setLayoutAnnouncement('Cell selection cleared.');
      return;
    }
    const delta = movement[event.key];
    if (!delta || event.metaKey || event.ctrlKey || event.altKey) return;
    const focusRow = records.items.findIndex((record) => record.id === gridSelection.focus.rowId);
    const focusColumn = gridColumns.findIndex(
      (column) => column.key === gridSelection.focus.columnKey,
    );
    if (focusRow < 0 || focusColumn < 0) return;
    event.preventDefault();
    const nextRow = Math.max(0, Math.min(records.items.length - 1, focusRow + delta[0]));
    const nextColumn = Math.max(0, Math.min(gridColumns.length - 1, focusColumn + delta[1]));
    const nextAddress: GridCellAddress = {
      rowId: records.items[nextRow]!.id,
      columnKey: gridColumns[nextColumn]!.key,
    };
    setGridSelection((current) =>
      current && event.shiftKey
        ? { ...current, focus: nextAddress }
        : { anchor: nextAddress, focus: nextAddress },
    );
  }

  function storeUpdatedRecord(updated: DynamicRecord) {
    setRecords((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === updated.id ? updated : item)),
    }));
    setSelectedRecord((current) => (current?.id === updated.id ? updated : current));
  }

  async function updateGridCellRecord(
    record: DynamicRecord,
    target: 'displayName' | FieldDefinition,
    value: unknown,
  ): Promise<DynamicRecord> {
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
      storeUpdatedRecord(updated);
      return updated;
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') await loadRecords();
      throw cause;
    }
  }

  async function saveGridCell(
    record: DynamicRecord,
    target: 'displayName' | FieldDefinition,
    value: unknown,
  ): Promise<void> {
    await updateGridCellRecord(record, target, value);
  }

  async function updateProjectCellRecord(
    record: DynamicRecord,
    contextProjectId: string | null,
  ): Promise<DynamicRecord> {
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
      storeUpdatedRecord(updated);
      return updated;
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') await loadRecords();
      throw cause;
    }
  }

  async function saveProjectCell(
    record: DynamicRecord,
    contextProjectId: string | null,
  ): Promise<void> {
    await updateProjectCellRecord(record, contextProjectId);
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
    setMessage(t('data.recordSaved', { name: updated.displayName }));
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
    setMessage(t('data.recordCreated', { name: created.displayName }));
  }

  function chooseObjectType(objectTypeId: string, force = false) {
    if (objectTypeId === selectedId) return;
    if (!force && viewDirty) {
      void confirmAction(t('data.discardViewConfirm')).then((confirmed) => {
        if (confirmed) chooseObjectType(objectTypeId, true);
      });
      return;
    }
    const routeObject = objectTypes.find((objectType) => objectType.id === objectTypeId);
    const routeId = routeObject?.publicId ?? routeObject?.id;
    if (!routeId) return;
    setPage(1);
    setSortField('displayName');
    setSortDirection('asc');
    setFilterField('');
    setFilterValue('');
    selectDataLocation(routeId);
  }

  function chooseView(viewId: string, force = false) {
    if (viewId === selectedViewId) return;
    if (!force && viewDirty) {
      void confirmAction(t('data.discardViewConfirm')).then((confirmed) => {
        if (confirmed) chooseView(viewId, true);
      });
      return;
    }
    setSelectedRows(new Set());
    setSelectedRecord(undefined);
    const view = views.find(
      (candidate) => candidate.id === viewId || candidate.publicId === viewId,
    );
    const routeViewId = view?.publicId ?? viewId;
    pendingViewId.current = routeViewId;
    appliedViewKey.current =
      routeViewId === 'all'
        ? `${selectedId}:all:${fields.map((field) => field.id).join(',')}`
        : `${selectedId}:${routeViewId}:${view?.rowVersion ?? 0}:${fields.map((field) => field.id).join(',')}`;
    applyViewConfig(view?.config);
    selectDataLocation(selectedPublicId, routeViewId);
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
      return reorderIds(order, sourceFieldId, targetFieldId, position === 'after');
    });
    setLayoutAnnouncement(
      t('data.columnMoved', { column: sourceField.name, target: targetField.name }),
    );
  }

  async function reorderSchemaField(
    sourceFieldId: string,
    targetFieldId: string,
    position: 'before' | 'after',
  ) {
    if (schemaBusy || sourceFieldId === targetFieldId || !selectedId) return;
    const previous = fields;
    const previousOrder = fieldOrderIds;
    const fieldIds = reorderIds(
      schemaFields.map((field) => field.id),
      sourceFieldId,
      targetFieldId,
      position === 'after',
    );
    if (fieldIds.every((id, index) => id === schemaFields[index]?.id)) return;
    const positions = new Map(fieldIds.map((id, index) => [id, index]));
    setFields((current) =>
      current.map((field) => ({ ...field, position: positions.get(field.id) ?? field.position })),
    );
    setFieldOrderIds(fieldIds);
    setSchemaBusy(true);
    try {
      const result = await api<{ items: FieldDefinition[] }>(
        `${base}/object-types/${selectedId}/fields-order`,
        { method: 'PATCH', body: JSON.stringify({ fieldIds }) },
      );
      setFields(result.items);
      setMessageTone('success');
      setMessage(t('data.orderSaved'));
      setLayoutAnnouncement(t('data.orderSaved'));
    } catch (error) {
      setFields(previous);
      setFieldOrderIds(previousOrder);
      setMessageTone('error');
      setMessage(error instanceof ApiError ? error.message : t('data.reorderFailed'));
    } finally {
      setSchemaBusy(false);
      setSchemaDraggedFieldId('');
      setSchemaDragTargetId('');
    }
  }

  async function createView(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageViews) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const viewType = String(data.get('viewType') ?? 'grid') as RecordViewType;
    const permissionType = String(
      data.get('permissionType') ?? 'collaborative',
    ) as RecordViewPermissionType;
    if (!name) return;
    const groupFieldId = String(data.get('groupFieldId') ?? '');
    const dateFieldId = String(data.get('dateFieldId') ?? '');
    if (viewType === 'kanban' && !groupFieldId) {
      setMessageTone('error');
      setMessage(t('data.chooseKanbanGroup'));
      return;
    }
    if (viewType === 'calendar' && !dateFieldId) {
      setMessageTone('error');
      setMessage(t('data.chooseCalendarDate'));
      return;
    }
    const config: RecordViewConfig = { ...currentViewConfig };
    if (viewType !== 'grid') {
      delete config.groupings;
      delete config.summaries;
    }
    if (viewType === 'kanban')
      config.viewOptions = { ...currentViewConfig.viewOptions, groupFieldId };
    else if (viewType === 'calendar')
      config.viewOptions = { ...currentViewConfig.viewOptions, dateFieldId };
    setViewBusy(true);
    try {
      const created = await api<RecordView>(`${base}/object-types/${selectedId}/views`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          viewType,
          permissionType,
          ...(permissionType === 'locked'
            ? { lockReason: String(data.get('lockReason') ?? '').trim() }
            : {}),
          config,
        }),
      });
      const createdViewId = created.publicId ?? created.id;
      pendingViewId.current = createdViewId;
      appliedViewKey.current = `${selectedId}:${created.id}:${created.rowVersion}:${fields.map((field) => field.id).join(',')}`;
      setViews((current) =>
        [...current, created].sort((left, right) => left.name.localeCompare(right.name)),
      );
      setViewPage((current) => ({ ...current, total: current.total + 1 }));
      setShowCreateView(false);
      setNewViewType('grid');
      setNewViewPermission('collaborative');
      form.reset();
      selectDataLocation(selectedPublicId, createdViewId);
      setMessageTone('success');
      setMessage(t('data.viewCreated', { name: created.name }));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('data.viewCreateFailed'));
    } finally {
      setViewBusy(false);
    }
  }

  async function saveView() {
    if (!selectedView || !selectedViewWritable) return;
    setViewBusy(true);
    try {
      const updated = await api<RecordView>(
        `${base}/object-types/${selectedId}/views/${selectedView.publicId ?? selectedView.id}`,
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
      setMessage(t('data.viewSaved', { name: updated.name }));
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') await loadDataContext();
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('data.viewSaveFailed'));
    } finally {
      setViewBusy(false);
    }
  }

  async function renameView(view: RecordView) {
    if (!viewWritable(view)) return;
    const name = (
      await promptText(t('data.renameViewPrompt'), view.name, { label: t('data.viewName') })
    )?.trim();
    if (!name || name === view.name) return;
    setViewBusy(true);
    try {
      const updated = await api<RecordView>(
        `${base}/object-types/${selectedId}/views/${view.publicId ?? view.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            viewType: view.viewType,
            config: view.config,
            rowVersion: view.rowVersion,
          }),
        },
      );
      setViews((current) =>
        current
          .map((candidate) => (candidate.id === updated.id ? updated : candidate))
          .sort((left, right) => left.name.localeCompare(right.name)),
      );
      setMessageTone('success');
      setMessage(t('data.viewRenamed', { name: updated.name }));
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') await loadDataContext();
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('data.viewRenameFailed'));
    } finally {
      setViewBusy(false);
    }
  }

  async function duplicateView(view: RecordView) {
    if (!canManageViews) return;
    const names = new Set(views.map((candidate) => candidate.name.toLocaleLowerCase()));
    let name = `${view.name} copy`;
    let copy = 2;
    while (names.has(name.toLocaleLowerCase())) name = `${view.name} copy ${copy++}`;
    setViewBusy(true);
    try {
      const created = await api<RecordView>(`${base}/object-types/${selectedId}/views`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          viewType: view.viewType,
          permissionType: 'personal',
          config: view.config,
        }),
      });
      setViews((current) =>
        [...current, created].sort((left, right) => left.name.localeCompare(right.name)),
      );
      setViewPage((current) => ({ ...current, total: current.total + 1 }));
      chooseView(created.publicId ?? created.id);
      setMessageTone('success');
      setMessage(t('data.viewDuplicated', { name: created.name }));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('data.viewDuplicateFailed'));
    } finally {
      setViewBusy(false);
    }
  }

  async function changeViewPermission(view: RecordView, permissionType: RecordViewPermissionType) {
    if (
      selectedView?.id === view.id &&
      viewDirty &&
      !(await confirmAction(t('data.discardViewForPermissionConfirm')))
    )
      return;
    let lockReason = '';
    if (permissionType === 'locked') {
      const answer = await promptText(t('data.lockViewReasonPrompt'), view.lockReason ?? '', {
        label: t('data.lockReason'),
      });
      if (answer === null) return;
      lockReason = answer.trim();
    }
    setViewBusy(true);
    try {
      const updated = await api<RecordView>(
        `${base}/object-types/${selectedId}/views/${view.publicId ?? view.id}/permission`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            permissionType,
            ...(permissionType === 'locked' ? { lockReason } : {}),
            rowVersion: view.rowVersion,
          }),
        },
      );
      setViews((current) =>
        current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      if (selectedView?.id === view.id) applyViewConfig(updated.config);
      setMessageTone('success');
      setMessage(
        t('data.viewPermissionChanged', {
          name: updated.name,
          permission: t(`data.viewPermission.${recordViewPermission(updated)}`),
        }),
      );
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') await loadDataContext();
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('data.viewPermissionFailed'));
    } finally {
      setViewBusy(false);
    }
  }

  async function archiveView(target = selectedView) {
    if (!target || !viewArchivable(target)) return;
    if (
      !(await confirmAction(t('data.archiveViewConfirm', { name: target.name }), {
        tone: 'danger',
      }))
    )
      return;
    setViewBusy(true);
    try {
      await api(
        `${base}/object-types/${selectedId}/views/${target.publicId ?? target.id}/archive`,
        {
          method: 'POST',
          body: JSON.stringify({
            rowVersion: target.rowVersion,
            reason: 'Archived from the data workspace',
          }),
        },
      );
      setViews((current) => current.filter((view) => view.id !== target.id));
      setViewPage((current) => ({
        ...current,
        total: Math.max(0, current.total - 1),
        hasNext: views.length - 1 < current.total - 1,
      }));
      if (selectedView?.id === target.id) chooseView('all', true);
      setMessageTone('success');
      setMessage(t('data.viewArchived', { name: target.name }));
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') await loadDataContext();
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('data.viewArchiveFailed'));
    } finally {
      setViewBusy(false);
    }
  }

  async function changeSelectedRowsLifecycle(archived: boolean) {
    if (!selectedRows.size) return;
    if (
      !(await confirmAction(
        t(archived ? 'data.archiveSelectedConfirm' : 'data.restoreSelectedConfirm', {
          count: selectedRows.size,
        }),
        archived ? { tone: 'danger' } : undefined,
      ))
    )
      return;
    setBulkBusy(true);
    try {
      await api(
        `${base}/object-types/${selectedId}/records/bulk/${archived ? 'archive' : 'restore'}`,
        {
          method: 'POST',
          body: JSON.stringify({
            ids: [...selectedRows],
            ...(archived ? { reason: 'Archived from grid bulk action' } : {}),
          }),
        },
      );
      setSelectedRows(new Set());
      setMessageTone('success');
      setMessage(t(archived ? 'data.selectedArchived' : 'webhooks.record.restored'));
      await loadRecords();
    } catch (cause) {
      setMessageTone('error');
      setMessage(
        cause instanceof Error
          ? cause.message
          : t(archived ? 'data.selectedArchiveFailed' : 'data.lifecycleFailed'),
      );
    } finally {
      setBulkBusy(false);
    }
  }

  function toggleRecordSelection(recordId: string, selected: boolean) {
    const next = new Set(selectedRows);
    if (!selected) next.delete(recordId);
    else if (!next.has(recordId) && next.size >= MAX_BULK_RECORDS) {
      setMessageTone('error');
      setMessage(t('data.bulkSelectionLimit', { count: MAX_BULK_RECORDS }));
      return;
    } else next.add(recordId);
    setSelectedRows(next);
    if (!next.size) setShowBulkEdit(false);
  }

  function toggleVisibleRecordSelection(selected: boolean) {
    if (selected && records.items.length > MAX_BULK_RECORDS) {
      setMessageTone('error');
      setMessage(t('data.bulkSelectionLimit', { count: MAX_BULK_RECORDS }));
      return;
    }
    const next = new Set(selectedRows);
    for (const record of records.items) {
      if (selected) next.add(record.id);
      else next.delete(record.id);
    }
    setSelectedRows(next);
    if (!next.size) setShowBulkEdit(false);
  }

  async function updateSelectedRecordFields(changes: BulkRecordFieldChange[]) {
    const selected = records.items.filter((record) => selectedRows.has(record.id));
    if (!selected.length || selected.length !== selectedRows.size) {
      setMessageTone('error');
      setMessage(t('data.bulkEditSelectionChanged'));
      return;
    }
    if (
      !(await confirmAction(
        t('data.bulkEditConfirm', { count: selected.length, fields: changes.length }),
      ))
    )
      return;
    setBulkBusy(true);
    try {
      await api(`${base}/object-types/${selectedId}/records/bulk/fields`, {
        method: 'PATCH',
        body: JSON.stringify({
          records: selected.map((record) => ({ id: record.id, rowVersion: record.rowVersion })),
          changes,
        }),
      });
      setShowBulkEdit(false);
      setSelectedRows(new Set());
      setMessageTone('success');
      setMessage(t('data.bulkEditSucceeded', { count: selected.length, fields: changes.length }));
      await loadRecords();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') await loadRecords();
      setMessageTone('error');
      setMessage(
        cause instanceof ApiError && cause.code === 'VERSION_CONFLICT'
          ? t('data.bulkEditConflict')
          : cause instanceof Error
            ? cause.message
            : t('data.bulkEditFailed'),
      );
      throw cause;
    } finally {
      setBulkBusy(false);
    }
  }

  async function copyContextValue(label: string, value: string) {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard is unavailable.');
      await navigator.clipboard.writeText(value);
      setMessageTone('success');
      setMessage(t('data.copied', { label }));
    } catch {
      setMessageTone('error');
      setMessage(t('data.clipboardDenied'));
    }
  }

  async function changeRecordLifecycle(record: DynamicRecord, archived: boolean) {
    if (
      archived &&
      !(await confirmAction(t('data.archiveRecordConfirm', { name: record.displayName }), {
        tone: 'danger',
      }))
    )
      return;
    try {
      await api(
        `${base}/object-types/${record.objectTypeId}/records/${record.id}/${archived ? 'archive' : 'restore'}`,
        {
          method: 'POST',
          body: JSON.stringify(archived ? { reason: 'Archived from record context menu' } : {}),
        },
      );
      setSelectedRows((current) => {
        const next = new Set(current);
        next.delete(record.id);
        return next;
      });
      if (selectedRecord?.id === record.id) setSelectedRecord(undefined);
      setMessageTone('success');
      setMessage(
        t(archived ? 'data.recordArchived' : 'webhooks.record.restored', {
          name: record.displayName,
        }),
      );
      await loadRecords();
    } catch (cause) {
      setMessageTone('error');
      setMessage(
        cause instanceof Error
          ? cause.message
          : t(archived ? 'data.recordArchiveFailed' : 'data.lifecycleFailed'),
      );
    }
  }

  function recordContextItems(record: DynamicRecord): ContextMenuItem[] {
    const selectedRow = selectedRows.has(record.id);
    return [
      {
        label: 'Open quick view',
        icon: '↗',
        onSelect: () => setSelectedRecord(record),
      },
      ...(!workspaceMode
        ? [
            {
              label: 'Open full record',
              icon: '□',
              onSelect: () =>
                void navigate(
                  `${base}/data/${objectTypes.find((item) => item.id === record.objectTypeId)?.publicId ?? record.objectTypeId}/records/${record.id}`,
                ),
            } satisfies ContextMenuItem,
          ]
        : []),
      {
        label: selectedRow ? 'Deselect row' : 'Select row',
        icon: selectedRow ? '−' : '✓',
        separatorBefore: true,
        onSelect: () => toggleRecordSelection(record.id, !selectedRow),
      },
      {
        label: 'Copy record name',
        icon: '⧉',
        onSelect: () => void copyContextValue('Record name', record.displayName),
      },
      {
        label: 'Copy record ID',
        icon: '#',
        onSelect: () => void copyContextValue('Record ID', record.id),
      },
      ...(record.archivedAt && allowed(user, 'record.restore') && canArchiveRecords
        ? [
            {
              label: t('common.restore'),
              icon: '↺',
              separatorBefore: true,
              onSelect: () => void changeRecordLifecycle(record, false),
            },
          ]
        : !record.archivedAt && canArchiveRecords
          ? [
              {
                label: t('common.archive'),
                icon: '×',
                tone: 'danger' as const,
                separatorBefore: true,
                onSelect: () => void changeRecordLifecycle(record, true),
              },
            ]
          : []),
    ];
  }

  function openRecordContextMenu(event: ReactMouseEvent<HTMLElement>, record: DynamicRecord) {
    setContextMenu(menuFromPointer(event, record.displayName, recordContextItems(record)));
  }

  function openRecordContextMenuFromKeyboard(
    event: ReactKeyboardEvent<HTMLElement>,
    record: DynamicRecord,
  ) {
    const menu = menuFromKeyboard(event, record.displayName, recordContextItems(record));
    if (menu) setContextMenu(menu);
  }

  function viewContextItems(view: RecordView): ContextMenuItem[] {
    const permission = recordViewPermission(view);
    const writable = viewWritable(view);
    const permissionTargets: RecordViewPermissionType[] = canAdministerViews
      ? ['collaborative', 'personal', 'locked']
      : permission === 'collaborative' && view.createdBy === user.id
        ? ['personal']
        : permission === 'personal' && view.ownerId === user.id
          ? ['collaborative']
          : [];
    return [
      {
        label: t('data.openView'),
        icon: '↗',
        onSelect: () => chooseView(view.publicId ?? view.id),
      },
      ...(canManageViews
        ? [
            {
              label: t('data.duplicateView'),
              icon: '⧉',
              disabled: viewBusy,
              onSelect: () => void duplicateView(view),
            },
          ]
        : []),
      ...(writable
        ? [
            {
              label: t('data.renameView'),
              icon: '✎',
              disabled: viewBusy,
              onSelect: () => void renameView(view),
            },
          ]
        : []),
      ...permissionTargets.map((target, index) => ({
        label: t(`data.setViewPermission.${target}`),
        icon: target === 'locked' ? '▣' : target === 'personal' ? '●' : '◎',
        disabled: viewBusy || target === permission,
        separatorBefore: index === 0,
        onSelect: () => void changeViewPermission(view, target),
      })),
      ...(viewArchivable(view)
        ? [
            {
              label: t('data.archiveView'),
              icon: '×',
              disabled: viewBusy,
              tone: 'danger' as const,
              separatorBefore: true,
              onSelect: () => void archiveView(view),
            },
          ]
        : []),
    ];
  }

  function columnContextItems(field: FieldDefinition): ContextMenuItem[] {
    const sortable = ![
      'relation',
      'multi_select',
      'measurement',
      'range',
      'formula',
      'lookup',
      'rollup',
    ].includes(field.fieldType);
    const filterable = !['measurement', 'range'].includes(field.fieldType);
    return [
      {
        label: 'Sort ascending',
        icon: '↑',
        disabled: !sortable,
        onSelect: () => {
          setSortField(field.id);
          setSortDirection('asc');
          setPage(1);
        },
      },
      {
        label: 'Sort descending',
        icon: '↓',
        disabled: !sortable,
        onSelect: () => {
          setSortField(field.id);
          setSortDirection('desc');
          setPage(1);
        },
      },
      {
        label: 'Filter this column',
        icon: '⌕',
        disabled: !filterable,
        separatorBefore: true,
        onSelect: () => {
          setFilterField(field.id);
          setFilterOperator('eq');
          setFilterValue('');
          setDebouncedFilterValue('');
          setActiveTool('filter');
          setPage(1);
        },
      },
      {
        label: 'Reset column width',
        icon: '↔',
        disabled: fieldWidths[field.id] === undefined,
        onSelect: () =>
          setFieldWidths((current) => {
            const next = { ...current };
            delete next[field.id];
            return next;
          }),
      },
      {
        label: 'Hide column',
        icon: '◫',
        separatorBefore: true,
        onSelect: () => setHiddenFieldIds((current) => new Set([...current, field.id])),
      },
    ];
  }

  function systemColumnContextItems(column: SystemFieldWidthKey, label: string): ContextMenuItem[] {
    const sortable = column !== 'contextProject';
    const sortKey = column === 'displayName' ? 'displayName' : 'updatedAt';
    return [
      {
        label: 'Sort ascending',
        icon: '↑',
        disabled: !sortable,
        onSelect: () => {
          setSortField(sortKey);
          setSortDirection('asc');
          setPage(1);
        },
      },
      {
        label: 'Sort descending',
        icon: '↓',
        disabled: !sortable,
        onSelect: () => {
          setSortField(sortKey);
          setSortDirection('desc');
          setPage(1);
        },
      },
      {
        label: `Reset ${label} width`,
        icon: '↔',
        disabled: systemFieldWidths[column] === undefined,
        separatorBefore: true,
        onSelect: () =>
          setSystemFieldWidths((current) => {
            const next = { ...current };
            delete next[column];
            return next;
          }),
      },
    ];
  }

  return (
    <>
      <div className="flex justify-end gap-2">
        <h1 className="sr-only">{workspaceMode ? t('data.library') : t('data.projectRecords')}</h1>
        {!workspaceMode && allowed(user, 'schema.manage') && (
          <Button variant="quiet" onClick={() => void installTemplate()}>
            {t('data.installTemplate')}
          </Button>
        )}
      </div>
      <NoticeText tone={messageTone}>{message}</NoticeText>

      {sidebarPortal &&
        createPortal(
          <nav aria-label={t('data.navigation')} className="p-2">
            <div className="mb-1 px-2 py-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                {workspaceMode ? t('data.workspaceTables') : t('data.engineeringTables')}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-600">
                {t('data.tableCount', { count: tablePage.total })}
              </p>
            </div>
            <div className="mb-2 px-2">
              <input
                aria-label={t('data.searchTables')}
                className="h-8 w-full rounded-md border border-slate-800 bg-slate-950 px-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-500/60"
                onChange={(event) => setTableSearch(event.target.value)}
                placeholder={t('data.searchTables')}
                type="search"
                value={tableSearch}
              />
            </div>
            {typesLoading && (
              <div className="space-y-2 px-3 py-4" aria-label={t('data.loadingObjectTypes')}>
                <div className="h-8 animate-pulse rounded bg-slate-800" />
                <div className="h-8 animate-pulse rounded bg-slate-800" />
              </div>
            )}
            {!typesLoading && visibleObjectTypes.length === 0 && (
              <p className="px-3 py-4 text-sm text-slate-400">
                {tableQuery.trim()
                  ? t('data.noTablesFound')
                  : workspaceMode
                    ? t('data.noWorkspaceTables')
                    : t('data.noSchema')}
              </p>
            )}
            <div aria-label={t('data.tablesAndViews')} className="space-y-0.5">
              {visibleObjectTypes.map((objectType) => {
                const activeTable = selectedId === objectType.id;
                return (
                  <div key={objectType.id}>
                    <button
                      aria-expanded={activeTable}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${activeTable ? 'bg-slate-800 font-medium text-slate-100' : 'text-slate-300 hover:bg-slate-800'}`}
                      onClick={() => chooseObjectType(objectType.id)}
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
                          {canManageViews && (
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
                            <div
                              className="group/view relative flex items-center"
                              key={view.id}
                              onContextMenu={(event) =>
                                setContextMenu(
                                  menuFromPointer(event, view.name, viewContextItems(view)),
                                )
                              }
                            >
                              <button
                                aria-label={view.name}
                                className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-xs ${selectedView?.id === view.id ? 'bg-sky-500/15 text-sky-200' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}
                                onClick={() => chooseView(view.publicId ?? view.id)}
                                onKeyDown={(event) => {
                                  const menu = menuFromKeyboard(
                                    event,
                                    view.name,
                                    viewContextItems(view),
                                  );
                                  if (menu) setContextMenu(menu);
                                }}
                                type="button"
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <span className="text-sky-400">
                                    {viewTypeMeta[view.viewType].icon}
                                  </span>
                                  {recordViewPermission(view) !== 'collaborative' && (
                                    <span
                                      aria-label={t(
                                        `data.viewPermission.${recordViewPermission(view)}`,
                                      )}
                                      className="text-[10px] text-slate-500"
                                      title={t(`data.viewPermission.${recordViewPermission(view)}`)}
                                    >
                                      {recordViewPermission(view) === 'locked' ? '▣' : '●'}
                                    </span>
                                  )}
                                  <span className="truncate">{view.name}</span>
                                </span>
                              </button>
                            </div>
                          ))}
                        {!viewsLoading && viewPage.hasNext && (
                          <Button
                            className="mt-1 w-full"
                            disabled={viewsLoadingMore}
                            onClick={() => void loadMoreViews()}
                            type="button"
                            variant="quiet"
                          >
                            {viewsLoadingMore
                              ? t('common.loading')
                              : t('data.loadMoreTables', {
                                  shown: Math.min(views.length, viewPage.total),
                                  total: viewPage.total,
                                })}
                          </Button>
                        )}
                        {showCreateView && canManageViews && (
                          <form
                            className="mt-1 space-y-1.5 px-1"
                            onSubmit={(event) => void createView(event)}
                          >
                            <FormField label={t('data.viewName')} required>
                              <input
                                autoFocus
                                className={inputClass}
                                maxLength={120}
                                name="name"
                                required
                              />
                            </FormField>
                            <FormField label={t('data.viewType')} required>
                              <select
                                className={inputClass}
                                name="viewType"
                                required
                                value={newViewType}
                                onChange={(event) =>
                                  setNewViewType(event.target.value as RecordViewType)
                                }
                              >
                                {(
                                  Object.entries(viewTypeMeta) as Array<
                                    [RecordViewType, (typeof viewTypeMeta)[RecordViewType]]
                                  >
                                ).map(([type]) => (
                                  <option key={type} value={type}>
                                    {t(viewTypeTranslationKeys[type])}
                                  </option>
                                ))}
                              </select>
                            </FormField>
                            <FormField label={t('data.viewPermission')} required>
                              <select
                                className={inputClass}
                                name="permissionType"
                                onChange={(event) =>
                                  setNewViewPermission(
                                    event.target.value as RecordViewPermissionType,
                                  )
                                }
                                required
                                value={newViewPermission}
                              >
                                <option value="collaborative">
                                  {t('data.viewPermission.collaborative')}
                                </option>
                                <option value="personal">
                                  {t('data.viewPermission.personal')}
                                </option>
                                {canAdministerViews && (
                                  <option value="locked">{t('data.viewPermission.locked')}</option>
                                )}
                              </select>
                            </FormField>
                            {newViewPermission === 'locked' && (
                              <FormField label={t('data.lockReason')}>
                                <input className={inputClass} maxLength={500} name="lockReason" />
                              </FormField>
                            )}
                            {newViewType === 'kanban' && (
                              <FormField label={t('data.kanbanGroupField')} required>
                                <select
                                  className={inputClass}
                                  defaultValue=""
                                  name="groupFieldId"
                                  required
                                >
                                  <option value="">{t('data.kanbanGroupFieldOption')}</option>
                                  {fields
                                    .filter((field) => field.fieldType === 'single_select')
                                    .map((field) => (
                                      <option key={field.id} value={field.id}>
                                        {field.name}
                                      </option>
                                    ))}
                                </select>
                              </FormField>
                            )}
                            {newViewType === 'calendar' && (
                              <FormField label={t('data.calendarDateField')} required>
                                <select
                                  className={inputClass}
                                  defaultValue=""
                                  name="dateFieldId"
                                  required
                                >
                                  <option value="">{t('data.calendarDateFieldOption')}</option>
                                  {fields
                                    .filter((field) =>
                                      ['date', 'datetime'].includes(field.fieldType),
                                    )
                                    .map((field) => (
                                      <option key={field.id} value={field.id}>
                                        {field.name}
                                      </option>
                                    ))}
                                </select>
                              </FormField>
                            )}
                            <div className="flex gap-1">
                              <Button
                                aria-label={t('data.saveNewView')}
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
                                {t('common.cancel')}
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
            {tablePage.hasNext && (
              <button
                className="mt-2 w-full rounded-md px-2 py-1.5 text-xs text-sky-400 hover:bg-slate-800 disabled:opacity-50"
                disabled={tablesLoadingMore}
                onClick={() => void loadTypes(tableQuery, visibleObjectTypes.length, true)}
                type="button"
              >
                {tablesLoadingMore
                  ? t('common.loading')
                  : t('data.loadMoreTables', {
                      shown: visibleObjectTypes.length,
                      total: tablePage.total,
                    })}
              </button>
            )}
            {allowed(user, 'schema.manage') && (
              <div className="mt-2 border-t border-slate-800 px-1 pt-2">
                <button
                  className="w-full rounded-md px-2 py-2 text-left text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-sky-300"
                  onClick={openCreateTable}
                  type="button"
                >
                  {t('data.createTable')}
                </button>
              </div>
            )}
          </nav>,
          sidebarPortal,
        )}

      <section className="data-workbench min-w-0 p-3 sm:p-4">
        {!selected ? (
          <div className="engineering-empty-state relative isolate overflow-hidden rounded-2xl border border-dashed border-slate-700 p-10 text-center sm:p-14">
            <div aria-hidden="true" className="product-grid absolute inset-0 -z-10 opacity-60" />
            <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-sky-400/20 bg-sky-400/10 text-sky-300 shadow-lg shadow-sky-950/10">
              <svg
                aria-hidden="true"
                className="size-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                viewBox="0 0 24 24"
              >
                <rect height="16" rx="2.5" width="16" x="4" y="4" />
                <path d="M4 9h16M9 4v16" />
              </svg>
            </span>
            <h2 className="mt-5 text-xl font-semibold text-slate-200">{t('data.emptyTitle')}</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-500">
              {t('data.emptyBody')}
            </p>
            <div className="mx-auto mt-5 flex max-w-2xl flex-wrap justify-center gap-2 text-xs text-slate-400">
              {emptyCapabilities.map((capability) => (
                <span
                  className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1.5"
                  key={capability}
                >
                  {capability}
                </span>
              ))}
            </div>
            {allowed(user, 'schema.manage') && (
              <Button className="mt-6" onClick={openCreateTable} type="button">
                <span aria-hidden="true" className="mr-1 text-base leading-none">
                  +
                </span>
                {t('data.createTable')}
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="data-titlebar flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-baseline gap-2">
                <h2 className="truncate text-2xl font-semibold tracking-[-0.025em]">
                  {selected.pluralName}
                </h2>
                <p className="font-mono text-[10px] uppercase tracking-widest text-sky-400">
                  {selected.key}
                </p>
                <HelpTip label={t('data.tableControlsHelp')}>{t('data.tableControlsBody')}</HelpTip>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {workspaceMode && Boolean(workspaceData?.legacyProjects?.length) && (
                  <HelpTip align="right" label="Legacy engineering tables">
                    Existing project-owned engineering tables were preserved during the
                    workspace-data upgrade. Open{' '}
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
                    to continue using traceable records and project-scoped resources.
                  </HelpTip>
                )}
                <IconAction
                  aria-expanded={showApiPanel}
                  className="size-9 border border-slate-800 bg-slate-900/75 font-mono text-[10px] shadow-sm"
                  icon="</>"
                  label={t('data.tableApi')}
                  onClick={() => {
                    const next = !showApiPanel;
                    setShowApiPanel(next);
                    if (next) {
                      setShowSchema(false);
                      setShowTableSettings(false);
                      setShowTablePermissions(false);
                    }
                  }}
                />
                {allowed(user, 'schema.manage') && (
                  <IconAction
                    aria-expanded={showTableSettings}
                    className="size-9 border border-slate-800 bg-slate-900/75 shadow-sm"
                    icon="✎"
                    label={t('data.editTable')}
                    onClick={() => {
                      setShowTableSettings((value) => !value);
                      setShowTablePermissions(false);
                    }}
                  />
                )}
                {allowed(user, 'table.permission.manage') && (
                  <IconAction
                    aria-expanded={showTablePermissions}
                    className="size-9 border border-slate-800 bg-slate-900/75 shadow-sm"
                    icon="▣"
                    label={t('data.tablePermissions')}
                    onClick={() => {
                      const next = !showTablePermissions;
                      setShowTablePermissions(next);
                      if (next) {
                        setShowApiPanel(false);
                        setShowTableSettings(false);
                        setShowSchema(false);
                      }
                    }}
                  />
                )}
                {allowed(user, 'schema.manage') && (
                  <IconAction
                    aria-expanded={showSchema}
                    className="size-9 border border-slate-800 bg-slate-900/75 shadow-sm"
                    icon="▦"
                    label={t('data.schema')}
                    onClick={() => {
                      const next = !showSchema;
                      setShowSchema(next);
                      if (next) setShowTablePermissions(false);
                      if (next) setSchemaSelection(fields[0]?.id ?? 'new');
                    }}
                  />
                )}
                {allowed(user, 'export.execute') && (
                  <IconAction
                    className="size-9 border border-slate-800 bg-slate-900/75 text-base shadow-sm"
                    disabled={Boolean(
                      recordExport && ['queued', 'running'].includes(recordExport.status),
                    )}
                    icon={
                      recordExport && ['queued', 'running'].includes(recordExport.status)
                        ? '…'
                        : '↓'
                    }
                    label={
                      recordExport && ['queued', 'running'].includes(recordExport.status)
                        ? t('data.csvExportPreparing')
                        : t('data.exportCsv')
                    }
                    onClick={() => void exportCsv()}
                  />
                )}
                {archiveState === 'active' && canCreateRecords && (
                  <IconAction
                    aria-expanded={showImportCsv}
                    className="size-9 border border-slate-800 bg-slate-900/75 text-base shadow-sm"
                    icon="↑"
                    label={t('data.importCsv')}
                    onClick={() => setShowImportCsv((value) => !value)}
                  />
                )}
                {archiveState === 'active' && canCreateRecords && (
                  <Button
                    className="data-primary-action"
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

            {showImportCsv && archiveState === 'active' && canCreateRecords && (
              <CsvImportPanel
                base={base}
                objectTypeId={selectedId}
                onClose={() => setShowImportCsv(false)}
                onImported={loadRecords}
              />
            )}

            {showApiPanel && (
              <TableApiPanel
                fields={fields}
                onClose={() => setShowApiPanel(false)}
                projectId={projectId}
                table={selected}
                workspaceId={workspaceId}
              />
            )}

            {showTableSettings && allowed(user, 'schema.manage') && (
              <form
                className="mt-3 rounded-xl border border-sky-800/40 bg-slate-900/65 p-4"
                key={selected.id}
                onSubmit={(event) => void updateObjectType(event)}
              >
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className={fieldLabelClass}>
                    <FormFieldLabel required>{t('data.typeName')}</FormFieldLabel>
                    <input
                      className={inputClass}
                      defaultValue={selected.name}
                      name="name"
                      required
                    />
                  </label>
                  <label className={fieldLabelClass}>
                    <FormFieldLabel required>{t('data.tableLabel')}</FormFieldLabel>
                    <input
                      className={inputClass}
                      defaultValue={selected.pluralName}
                      name="pluralName"
                      required
                    />
                  </label>
                  <label className={fieldLabelClass}>
                    <FormFieldLabel required>{t('data.stableKey')}</FormFieldLabel>
                    <input
                      aria-readonly={selected.system}
                      className={inputClass}
                      defaultValue={selected.key}
                      maxLength={64}
                      minLength={2}
                      name="key"
                      pattern="[a-z][a-z0-9-]{1,63}"
                      readOnly={selected.system}
                      required
                      title="Start with a lowercase letter; use lowercase letters, numbers, and hyphens."
                    />
                    {selected.system && (
                      <span className="text-[10px] font-normal text-slate-500">
                        {t('data.templateKeysProtected')}
                      </span>
                    )}
                  </label>
                  <label className={fieldLabelClass}>
                    <FormFieldLabel>{t('data.tableDescription')}</FormFieldLabel>
                    <input
                      className={inputClass}
                      defaultValue={selected.description}
                      name="description"
                    />
                  </label>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Button disabled={schemaBusy} type="submit">
                    {schemaBusy ? t('data.saving') : t('data.saveTable')}
                  </Button>
                  <button
                    className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    onClick={() => setShowTableSettings(false)}
                    type="button"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </form>
            )}

            {showTablePermissions && allowed(user, 'table.permission.manage') && (
              <TablePermissionsPanel
                base={base}
                onClose={() => setShowTablePermissions(false)}
                onSaved={() => {
                  void api<ObjectType>(`${base}/object-types/${selected.id}`).then((updated) => {
                    setObjectTypes((current) => mergeObjectTypes(current, [updated]));
                    setVisibleObjectTypes((current) => mergeObjectTypes(current, [updated]));
                  });
                }}
                tableId={selected.id}
                tableName={selected.pluralName}
              />
            )}

            {showSchema && allowed(user, 'schema.manage') && (
              <section
                aria-labelledby="schema-editor-title"
                className="mt-2 overflow-hidden rounded-xl border border-slate-700 bg-slate-950/80 shadow-xl shadow-black/15"
              >
                <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/70 px-4 py-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-100" id="schema-editor-title">
                        {t('data.schemaEditor')}
                      </h3>
                      <HelpTip label={t('data.schemaEditorHelp')}>
                        {t('data.schemaEditorBody')}
                      </HelpTip>
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                        {fields.length} {fields.length === 1 ? 'field' : 'fields'}
                      </span>
                      {fields.some((field) => field.projectionStatus !== 'ready') && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                          {fields.filter((field) => field.projectionStatus !== 'ready').length}{' '}
                          needs attention
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    aria-label={t('data.closeSchemaEditor')}
                    className="grid size-7 place-items-center rounded-md text-sm text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                    onClick={() => setShowSchema(false)}
                    type="button"
                  >
                    ×
                  </button>
                </header>

                <div className="grid lg:grid-cols-[minmax(16rem,0.8fr)_minmax(24rem,1.2fr)]">
                  <aside className="border-b border-slate-800 bg-slate-900/35 p-2.5 lg:border-b-0 lg:border-r">
                    <div className="flex gap-2">
                      <div className="relative min-w-0 flex-1">
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-600"
                        >
                          ⌕
                        </span>
                        <input
                          aria-label={t('data.searchFields')}
                          className={`${inputClass} pl-7`}
                          placeholder={t('data.searchFields')}
                          type="search"
                          value={schemaSearch}
                          onChange={(event) => setSchemaSearch(event.target.value)}
                        />
                      </div>
                      <Button
                        aria-label={t('data.addField')}
                        className="shrink-0"
                        variant="quiet"
                        onClick={beginNewSchemaField}
                        type="button"
                      >
                        + Add
                      </Button>
                    </div>

                    <div
                      aria-label={t('data.fieldDefinitions')}
                      className="mt-2 overflow-y-auto pr-1"
                      role="list"
                      style={{ maxHeight: '16rem' }}
                    >
                      {filteredSchemaFields.map((field) => {
                        const meta = fieldMeta(field);
                        const active = schemaSelection === field.id;
                        return (
                          <div
                            aria-label={t('data.fieldLabel', { name: field.name })}
                            className={`group flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                              active || schemaDragTargetId === field.id
                                ? 'border-sky-400/30 bg-sky-400/10'
                                : 'border-transparent hover:border-slate-800 hover:bg-slate-900'
                            }`}
                            key={field.id}
                            role="listitem"
                            onDragOver={(event: ReactDragEvent<HTMLDivElement>) => {
                              if (
                                !schemaDraggedFieldId ||
                                schemaDraggedFieldId === field.id ||
                                schemaSearch.trim()
                              )
                                return;
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'move';
                              setSchemaDragTargetId(field.id);
                            }}
                            onDrop={(event: ReactDragEvent<HTMLDivElement>) => {
                              if (!schemaDraggedFieldId || schemaDraggedFieldId === field.id)
                                return;
                              event.preventDefault();
                              const bounds = event.currentTarget.getBoundingClientRect();
                              void reorderSchemaField(
                                schemaDraggedFieldId,
                                field.id,
                                event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after',
                              );
                            }}
                          >
                            <button
                              aria-label={t('data.reorderField', { name: field.name })}
                              className="inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-sm leading-none text-slate-600 hover:bg-slate-800 hover:text-sky-300 active:cursor-grabbing"
                              disabled={schemaBusy || Boolean(schemaSearch.trim())}
                              draggable={!schemaBusy && !schemaSearch.trim()}
                              title={
                                schemaSearch.trim()
                                  ? t('data.clearSearchToReorder')
                                  : t('data.dragToReorder')
                              }
                              type="button"
                              onDragEnd={() => {
                                setSchemaDraggedFieldId('');
                                setSchemaDragTargetId('');
                              }}
                              onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => {
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', field.id);
                                setSchemaDraggedFieldId(field.id);
                              }}
                              onKeyDown={(event) => {
                                const offset =
                                  event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
                                const target = schemaFields[schemaFields.indexOf(field) + offset];
                                if (!offset || !target) return;
                                event.preventDefault();
                                void reorderSchemaField(
                                  field.id,
                                  target.id,
                                  offset < 0 ? 'before' : 'after',
                                );
                              }}
                            >
                              ⠿
                            </button>
                            <button
                              aria-label={t('data.editField', { name: field.name })}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                              onClick={() => setSchemaSelection(field.id)}
                              type="button"
                            >
                              <span
                                aria-hidden="true"
                                className={`grid size-6 shrink-0 place-items-center rounded-md border font-mono text-[9px] ${
                                  active
                                    ? 'border-sky-400/25 bg-sky-400/10 text-sky-300'
                                    : 'border-slate-800 bg-slate-950/50 text-slate-500'
                                }`}
                              >
                                {meta.icon}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5">
                                  <span className="truncate text-xs font-medium text-slate-200">
                                    {field.name}
                                  </span>
                                  {field.required && (
                                    <span
                                      aria-label={t('data.required')}
                                      className="text-[10px] text-amber-300"
                                    >
                                      *
                                    </span>
                                  )}
                                </span>
                                <span className="block truncate font-mono text-[9px] leading-tight text-slate-600">
                                  {field.key} ·{' '}
                                  {t(schemaFieldTypeTranslationKeys[schemaTypeForField(field)])}
                                </span>
                              </span>
                              <span
                                aria-label={t('data.projectionStatus', {
                                  status: field.projectionStatus,
                                })}
                                className={`mt-1 size-1.5 shrink-0 rounded-full ${
                                  field.projectionStatus === 'ready'
                                    ? 'bg-emerald-400'
                                    : field.projectionStatus === 'failed'
                                      ? 'bg-rose-400'
                                      : 'animate-pulse bg-amber-400'
                                }`}
                                title={t('data.projectionStatus', {
                                  status: field.projectionStatus,
                                })}
                              />
                            </button>
                          </div>
                        );
                      })}
                      {filteredSchemaFields.length === 0 && (
                        <div className="rounded-lg border border-dashed border-slate-800 px-4 py-8 text-center">
                          <p className="text-xs font-medium text-slate-400">
                            {t('data.noMatchingFields')}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-600">
                            {t('data.tryFieldSearch')}
                          </p>
                        </div>
                      )}
                    </div>
                  </aside>

                  <div className="p-4 sm:p-5">
                    {schemaSelection === 'new' || !selectedSchemaField ? (
                      <form onSubmit={(event) => void createField(event)}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-sky-400">
                              {t('data.newField')}
                            </p>
                            <h4 className="mt-1 text-base font-semibold text-slate-100">
                              {t('data.addFieldHeading')}
                            </h4>
                            <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-500">
                              {t('data.addFieldBody')}
                            </p>
                          </div>
                          <span
                            aria-hidden="true"
                            className="grid size-10 shrink-0 place-items-center rounded-xl border border-sky-400/20 bg-sky-400/10 font-mono text-sm text-sky-300"
                          >
                            {schemaFieldTypeMeta[schemaFieldType].icon}
                          </span>
                        </div>

                        <div className="mt-5 grid gap-4 sm:grid-cols-2">
                          <label className={fieldLabelClass}>
                            <FormFieldLabel required>{t('data.fieldName')}</FormFieldLabel>
                            <input
                              aria-label={t('data.fieldName')}
                              autoFocus
                              className={`${inputClass} mt-1.5`}
                              maxLength={120}
                              name="name"
                              placeholder={t('data.fieldNameExample')}
                              required
                              value={schemaFieldName}
                              onChange={(event) => {
                                const value = event.target.value;
                                setSchemaFieldName(value);
                                if (!schemaKeyEdited) {
                                  setSchemaFieldKeyValue(
                                    schemaFieldKey(value) || `field-${fields.length + 1}`,
                                  );
                                }
                              }}
                            />
                          </label>
                          <label className={fieldLabelClass}>
                            <FormFieldLabel required>{t('data.stableFieldKey')}</FormFieldLabel>
                            <input
                              aria-label={t('data.stableFieldKey')}
                              className={`${inputClass} mt-1.5 font-mono`}
                              maxLength={64}
                              name="key"
                              pattern="[a-z][a-z0-9-]{1,63}"
                              placeholder="inspection-status"
                              required
                              value={schemaFieldKeyValue}
                              onChange={(event) => {
                                setSchemaKeyEdited(true);
                                setSchemaFieldKeyValue(event.target.value.toLowerCase());
                              }}
                            />
                            <span className={fieldHintClass}>{t('data.stableKeyHint')}</span>
                          </label>
                          <label className={wideFieldLabelClass}>
                            <FormFieldLabel required>{t('data.fieldType')}</FormFieldLabel>
                            <select
                              aria-label={t('data.fieldType')}
                              className={`${inputClass} mt-1.5`}
                              name="fieldType"
                              required
                              value={schemaFieldType}
                              onChange={(event) =>
                                setSchemaFieldType(event.target.value as SchemaFieldType)
                              }
                            >
                              {(
                                [
                                  'Basic',
                                  'Choice',
                                  'Linked',
                                  'Engineering',
                                  'Structured',
                                  'Calculated',
                                ] as const
                              ).map((group) => {
                                const groupTypes = availableFieldTypes.filter(
                                  (type) => schemaFieldTypeMeta[type].group === group,
                                );
                                if (!groupTypes.length) return null;
                                return (
                                  <optgroup key={group} label={t(fieldGroupTranslationKeys[group])}>
                                    {groupTypes.map((type) => (
                                      <option key={type} value={type}>
                                        {t(schemaFieldTypeTranslationKeys[type])}
                                      </option>
                                    ))}
                                  </optgroup>
                                );
                              })}
                            </select>
                          </label>
                          <label className={wideFieldLabelClass}>
                            <FormFieldLabel>{t('data.fieldDescription')}</FormFieldLabel>
                            <textarea
                              aria-label={t('data.fieldDescription')}
                              className={`${inputClass} mt-1.5 min-h-20 resize-y`}
                              maxLength={500}
                              name="description"
                              placeholder={t('data.descriptionPlaceholder')}
                            />
                          </label>

                          {['single_select', 'multi_select'].includes(schemaFieldType) && (
                            <label className={wideFieldLabelClass}>
                              <FormFieldLabel required>{t('data.options')}</FormFieldLabel>
                              <textarea
                                aria-label={t('data.selectOptions')}
                                className={`${inputClass} mt-1.5 min-h-28 resize-y font-mono`}
                                name="options"
                                placeholder={'ready: Ready\nblocked: Blocked\napproved: Approved'}
                                required
                              />
                              <span className={fieldHintClass}>{t('data.optionsHint')}</span>
                            </label>
                          )}

                          {schemaFieldType === 'relation' && (
                            <label className={wideFieldLabelClass}>
                              <FormFieldLabel required>{t('data.relatedTable')}</FormFieldLabel>
                              <select
                                aria-label={t('data.relatedTable')}
                                className={`${inputClass} mt-1.5`}
                                defaultValue=""
                                name="targetObjectTypeId"
                                required
                              >
                                <option disabled value="">
                                  {t('data.selectTable')}
                                </option>
                                {objectTypes.map((objectType) => (
                                  <option key={objectType.id} value={objectType.id}>
                                    {objectType.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}

                          {calculatedFieldTypeSet.has(schemaFieldType as FieldType) && (
                            <CalculatedFieldSettings
                              base={base}
                              fields={fields}
                              type={schemaFieldType as 'formula' | 'lookup' | 'rollup'}
                            />
                          )}

                          {['quantity', 'measurement', 'range'].includes(schemaFieldType) && (
                            <>
                              <label className={fieldLabelClass}>
                                <FormFieldLabel required>{t('data.dimension')}</FormFieldLabel>
                                <input
                                  aria-label={t('data.engineeringDimension')}
                                  className={`${inputClass} mt-1.5`}
                                  name="dimension"
                                  placeholder="length"
                                  required
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                <FormFieldLabel required>{t('data.canonicalUnit')}</FormFieldLabel>
                                <input
                                  aria-label={t('data.canonicalUnit')}
                                  className={`${inputClass} mt-1.5 font-mono`}
                                  name="canonicalUnit"
                                  placeholder="m"
                                  required
                                />
                              </label>
                              <label className={wideFieldLabelClass}>
                                <FormFieldLabel required>{t('data.allowedUnits')}</FormFieldLabel>
                                <input
                                  aria-label={t('data.allowedUnits')}
                                  className={`${inputClass} mt-1.5 font-mono`}
                                  name="allowedUnits"
                                  placeholder="m, mm, μm"
                                  required
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                <FormFieldLabel>{t('data.displayPrecision')}</FormFieldLabel>
                                <input
                                  aria-label={t('data.displayPrecision')}
                                  className={`${inputClass} mt-1.5`}
                                  defaultValue="3"
                                  max="34"
                                  min="0"
                                  name="displayPrecision"
                                  type="number"
                                />
                              </label>
                            </>
                          )}

                          {schemaFieldType === 'spectral_data' && (
                            <>
                              <div className="sm:col-span-2 rounded-lg border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
                                {t('data.spectralPasteHint')}
                              </div>
                              <label className={fieldLabelClass}>
                                <FormFieldLabel>{t('data.xAxisLabel')}</FormFieldLabel>
                                <input
                                  aria-label={t('data.xAxisLabel')}
                                  className={`${inputClass} mt-1.5`}
                                  defaultValue="Wavelength"
                                  name="xLabel"
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                <FormFieldLabel>{t('data.xAxisUnit')}</FormFieldLabel>
                                <input
                                  aria-label={t('data.xAxisUnit')}
                                  className={`${inputClass} mt-1.5 font-mono`}
                                  defaultValue="nm"
                                  name="xUnit"
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                <FormFieldLabel>{t('data.signalLabel')}</FormFieldLabel>
                                <input
                                  aria-label={t('data.signalLabel')}
                                  className={`${inputClass} mt-1.5`}
                                  defaultValue="Intensity"
                                  name="yLabel"
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                <FormFieldLabel>{t('data.signalUnit')}</FormFieldLabel>
                                <input
                                  aria-label={t('data.signalUnit')}
                                  className={`${inputClass} mt-1.5 font-mono`}
                                  defaultValue="a.u."
                                  name="yUnit"
                                />
                              </label>
                            </>
                          )}

                          {schemaFieldType === 'tabular_data' && (
                            <div className="sm:col-span-2 rounded-lg border border-sky-400/20 bg-sky-400/10 px-3 py-2.5">
                              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-300">
                                <input
                                  className={checkboxClass}
                                  defaultChecked
                                  name="firstRowHeader"
                                  type="checkbox"
                                />
                                {t('data.firstRowHeaders')}
                              </label>
                              <p className="mt-1 pl-5 text-[10px] leading-relaxed text-slate-500">
                                {t('data.firstRowHeadersHint')}
                              </p>
                            </div>
                          )}
                          {schemaFieldType === 'image' && (
                            <div className="sm:col-span-2 rounded-lg border border-sky-400/20 bg-sky-400/10 px-3 py-2.5">
                              <p className="text-xs font-medium text-sky-200">셀 이미지 첨부</p>
                              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                                각 레코드 셀에서 PNG, JPEG, WebP, GIF 또는 AVIF 이미지를 최대
                                25MB까지 첨부하고 미리볼 수 있습니다.
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-slate-800 bg-slate-900/45 px-3 py-2.5 text-xs text-slate-300">
                          {!calculatedFieldTypeSet.has(schemaFieldType as FieldType) && (
                            <label className={checkboxLabelClass}>
                              <input
                                className={checkboxClass}
                                disabled={records.total > 0}
                                name="required"
                                title={
                                  records.total > 0
                                    ? 'Add the field first, backfill existing records, then make it required.'
                                    : undefined
                                }
                                type="checkbox"
                              />
                              {t('data.requiredValue')}
                            </label>
                          )}
                          {schemaFieldType !== 'image' && fieldSupportsUnique(schemaFieldType) && (
                            <label className={checkboxLabelClass}>
                              <input className={checkboxClass} name="unique" type="checkbox" />
                              {t('data.uniqueValues')}
                            </label>
                          )}
                          {schemaFieldType === 'relation' && (
                            <label className={checkboxLabelClass}>
                              <input className={checkboxClass} name="multiple" type="checkbox" />
                              {t('data.allowMultipleRecords')}
                            </label>
                          )}
                          {records.total > 0 && (
                            <span className="text-[10px] text-slate-600">
                              {t('data.requiredBackfillHint')}
                            </span>
                          )}
                        </div>

                        <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-800 pt-4">
                          <button
                            className="rounded-md px-3 py-2 text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                            onClick={() => setShowSchema(false)}
                            type="button"
                          >
                            {t('common.cancel')}
                          </button>
                          <Button
                            disabled={
                              schemaBusy || !schemaFieldName.trim() || !schemaFieldKeyValue.trim()
                            }
                            type="submit"
                          >
                            {schemaBusy ? 'Adding…' : 'Add field'}
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <form
                        key={selectedSchemaField.id}
                        onSubmit={(event) => void updateField(event, selectedSchemaField)}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-sky-400">
                              {t(
                                schemaFieldTypeTranslationKeys[
                                  schemaTypeForField(selectedSchemaField)
                                ],
                              )}{' '}
                              {t('data.field')}
                            </p>
                            <h4 className="mt-1 text-base font-semibold text-slate-100">
                              Edit {selectedSchemaField.name}
                            </h4>
                            <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-500">
                              {t('data.updateFieldBody')}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                              selectedSchemaField.projectionStatus === 'ready'
                                ? 'bg-emerald-500/10 text-emerald-300'
                                : selectedSchemaField.projectionStatus === 'failed'
                                  ? 'bg-rose-500/10 text-rose-300'
                                  : 'bg-amber-500/10 text-amber-300'
                            }`}
                          >
                            {selectedSchemaField.projectionStatus === 'ready'
                              ? 'Index ready'
                              : selectedSchemaField.projectionStatus === 'failed'
                                ? 'Index failed'
                                : 'Index rebuilding'}
                          </span>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-600">
                              {t('data.type')}
                            </p>
                            <p className="mt-1 text-xs text-slate-300">
                              {t(
                                schemaFieldTypeTranslationKeys[
                                  schemaTypeForField(selectedSchemaField)
                                ],
                              )}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-600">
                              {t('data.stableKey')}
                            </p>
                            <p className="mt-1 truncate font-mono text-xs text-slate-300">
                              {selectedSchemaField.key}
                            </p>
                          </div>
                        </div>

                        <div className="mt-5 grid gap-4 sm:grid-cols-2">
                          <label className={wideFieldLabelClass}>
                            <FormFieldLabel required>{t('data.fieldName')}</FormFieldLabel>
                            <input
                              aria-label={t('data.fieldName')}
                              className={`${inputClass} mt-1.5`}
                              defaultValue={selectedSchemaField.name}
                              maxLength={120}
                              name="name"
                              required
                            />
                          </label>
                          <label className={wideFieldLabelClass}>
                            <FormFieldLabel>{t('data.fieldDescription')}</FormFieldLabel>
                            <textarea
                              aria-label={t('data.fieldDescription')}
                              className={`${inputClass} mt-1.5 min-h-20 resize-y`}
                              defaultValue={selectedSchemaField.description}
                              maxLength={500}
                              name="description"
                              placeholder={t('data.descriptionPlaceholder')}
                            />
                          </label>

                          {['single_select', 'multi_select'].includes(
                            selectedSchemaField.fieldType,
                          ) && (
                            <label className={wideFieldLabelClass}>
                              <FormFieldLabel required>{t('data.options')}</FormFieldLabel>
                              <textarea
                                aria-label={t('data.selectOptions')}
                                className={`${inputClass} mt-1.5 min-h-28 resize-y font-mono`}
                                defaultValue={(selectedSchemaField.config.options ?? [])
                                  .map((option) => `${option.key}: ${option.label}`)
                                  .join('\n')}
                                name="options"
                                required
                              />
                              <span className={fieldHintClass}>{t('data.optionKeyWarning')}</span>
                            </label>
                          )}

                          {selectedSchemaField.fieldType === 'relation' && (
                            <>
                              <label className={wideFieldLabelClass}>
                                <FormFieldLabel required>{t('data.relatedTable')}</FormFieldLabel>
                                <select
                                  aria-label={t('data.relatedTable')}
                                  aria-readonly="true"
                                  className={`${inputClass} mt-1.5 opacity-70`}
                                  disabled
                                  value={selectedSchemaField.config.targetObjectTypeId ?? ''}
                                >
                                  {objectTypes.map((objectType) => (
                                    <option key={objectType.id} value={objectType.id}>
                                      {objectType.name}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  name="targetObjectTypeId"
                                  type="hidden"
                                  value={selectedSchemaField.config.targetObjectTypeId ?? ''}
                                />
                                <span className={fieldHintClass}>
                                  {t('data.relationTargetLocked')}
                                </span>
                              </label>
                            </>
                          )}

                          {calculatedFieldTypeSet.has(selectedSchemaField.fieldType) && (
                            <CalculatedFieldSettings
                              base={base}
                              defaults={selectedSchemaField.config}
                              fields={fields.filter((field) => field.id !== selectedSchemaField.id)}
                              type={
                                selectedSchemaField.fieldType as 'formula' | 'lookup' | 'rollup'
                              }
                            />
                          )}

                          {['quantity', 'measurement', 'range'].includes(
                            selectedSchemaField.fieldType,
                          ) && (
                            <>
                              <label className={fieldLabelClass}>
                                <FormFieldLabel required>{t('data.dimension')}</FormFieldLabel>
                                <input
                                  aria-label={t('data.engineeringDimension')}
                                  className={`${inputClass} mt-1.5 opacity-70`}
                                  defaultValue={selectedSchemaField.config.dimension}
                                  name="dimension"
                                  readOnly
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                <FormFieldLabel required>{t('data.canonicalUnit')}</FormFieldLabel>
                                <input
                                  aria-label={t('data.canonicalUnit')}
                                  className={`${inputClass} mt-1.5 font-mono opacity-70`}
                                  defaultValue={selectedSchemaField.config.canonicalUnit}
                                  name="canonicalUnit"
                                  readOnly
                                />
                              </label>
                              <label className={wideFieldLabelClass}>
                                <FormFieldLabel required>{t('data.allowedUnits')}</FormFieldLabel>
                                <input
                                  aria-label={t('data.allowedUnits')}
                                  className={`${inputClass} mt-1.5 font-mono`}
                                  defaultValue={selectedSchemaField.config.allowedUnits?.join(', ')}
                                  name="allowedUnits"
                                  required
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                <FormFieldLabel>{t('data.displayPrecision')}</FormFieldLabel>
                                <input
                                  aria-label={t('data.displayPrecision')}
                                  className={`${inputClass} mt-1.5`}
                                  defaultValue={selectedSchemaField.config.displayPrecision ?? 3}
                                  max="34"
                                  min="0"
                                  name="displayPrecision"
                                  type="number"
                                />
                              </label>
                            </>
                          )}

                          {selectedSchemaField.fieldType === 'spectral_data' && (
                            <>
                              <label className={fieldLabelClass}>
                                <FormFieldLabel>{t('data.xAxisLabel')}</FormFieldLabel>
                                <input
                                  aria-label={t('data.xAxisLabel')}
                                  className={`${inputClass} mt-1.5`}
                                  defaultValue={selectedSchemaField.config.xLabel}
                                  name="xLabel"
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                <FormFieldLabel>{t('data.xAxisUnit')}</FormFieldLabel>
                                <input
                                  aria-label={t('data.xAxisUnit')}
                                  className={`${inputClass} mt-1.5 font-mono`}
                                  defaultValue={selectedSchemaField.config.xUnit}
                                  name="xUnit"
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                <FormFieldLabel>{t('data.signalLabel')}</FormFieldLabel>
                                <input
                                  aria-label={t('data.signalLabel')}
                                  className={`${inputClass} mt-1.5`}
                                  defaultValue={selectedSchemaField.config.yLabel}
                                  name="yLabel"
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                <FormFieldLabel>{t('data.signalUnit')}</FormFieldLabel>
                                <input
                                  aria-label={t('data.signalUnit')}
                                  className={`${inputClass} mt-1.5 font-mono`}
                                  defaultValue={selectedSchemaField.config.yUnit}
                                  name="yUnit"
                                />
                              </label>
                            </>
                          )}

                          {selectedSchemaField.fieldType === 'tabular_data' && (
                            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-300 sm:col-span-2">
                              <input
                                className={checkboxClass}
                                defaultChecked={selectedSchemaField.config.firstRowHeader !== false}
                                name="firstRowHeader"
                                type="checkbox"
                              />
                              {t('data.firstRowHeaders')}
                            </label>
                          )}

                          <label className={fieldLabelClass}>
                            <FormFieldLabel>{t('data.order')}</FormFieldLabel>
                            <input
                              aria-label={t('data.fieldOrder')}
                              className={`${inputClass} mt-1.5`}
                              defaultValue={selectedSchemaField.position}
                              min="0"
                              name="position"
                              type="number"
                            />
                          </label>
                        </div>

                        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-slate-800 bg-slate-900/45 px-3 py-2.5 text-xs text-slate-300">
                          {!calculatedFieldTypeSet.has(selectedSchemaField.fieldType) && (
                            <label className={checkboxLabelClass}>
                              <input
                                className={checkboxClass}
                                defaultChecked={selectedSchemaField.required}
                                name="required"
                                type="checkbox"
                              />
                              {t('data.requiredValue')}
                            </label>
                          )}
                          {fieldSupportsUnique(selectedSchemaField.fieldType) && (
                            <label className={checkboxLabelClass}>
                              <input
                                className={checkboxClass}
                                defaultChecked={selectedSchemaField.unique}
                                name="unique"
                                type="checkbox"
                              />
                              {t('data.uniqueValues')}
                            </label>
                          )}
                          {selectedSchemaField.fieldType === 'relation' && (
                            <label className={checkboxLabelClass}>
                              <input
                                className={checkboxClass}
                                defaultChecked={selectedSchemaField.config.multiple}
                                name="multiple"
                                type="checkbox"
                              />
                              {t('data.allowMultipleRecords')}
                            </label>
                          )}
                        </div>

                        {selectedSchemaField.projectionStatus !== 'ready' && (
                          <p
                            className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
                              selectedSchemaField.projectionStatus === 'failed'
                                ? 'border-rose-500/20 bg-rose-500/5 text-rose-300'
                                : 'border-amber-500/20 bg-amber-500/5 text-amber-300'
                            }`}
                          >
                            {selectedSchemaField.projectionStatus === 'failed'
                              ? 'This field index failed to build. Values remain available, but filtering may be incomplete.'
                              : 'This field index is rebuilding. Filtering and sorting may take a moment to catch up.'}
                          </p>
                        )}

                        <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-800 pt-4">
                          <p className="text-[10px] text-slate-600">{t('data.typeKeyProtected')}</p>
                          <Button disabled={schemaBusy} type="submit">
                            {schemaBusy ? 'Saving…' : 'Save changes'}
                          </Button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              </section>
            )}

            <div className="data-toolbar mt-3 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/75">
              <div className="flex min-h-9 flex-wrap items-center gap-0.5 p-1">
                <div className="mr-1 flex items-center gap-2 border-r border-slate-800 pr-3">
                  <span className="max-w-40 truncate px-2 text-sm font-medium text-slate-200">
                    {selectedView?.name ?? t('data.allRecords')}
                  </span>
                  {selectedView && recordViewPermission(selectedView) !== 'collaborative' && (
                    <span
                      aria-label={t(`data.viewPermission.${recordViewPermission(selectedView)}`)}
                      className="text-xs text-slate-500"
                      title={t(`data.viewPermission.${recordViewPermission(selectedView)}`)}
                    >
                      {recordViewPermission(selectedView) === 'locked' ? '▣' : '●'}
                    </span>
                  )}
                  {viewDirty && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-300">
                      {t(selectedViewWritable ? 'data.unsaved' : 'data.localViewChanges')}
                    </span>
                  )}
                  {selectedView && allowed(user, 'view.share') && (
                    <IconAction
                      aria-expanded={showShareView}
                      className="size-7"
                      icon="↗"
                      label={t('data.shareView')}
                      onClick={() => setShowShareView((value) => !value)}
                    />
                  )}
                </div>
                {(['fields', 'filter', 'sort', 'group'] as const)
                  .filter((tool) => tool !== 'group' || activeViewType === 'grid')
                  .map((tool) => {
                    const active = activeTool === tool;
                    const label =
                      tool === 'fields'
                        ? t('data.columns')
                        : tool === 'filter'
                          ? t('data.filter')
                          : tool === 'sort'
                            ? t('data.sort')
                            : t('data.group');
                    const count =
                      tool === 'fields'
                        ? `${visibleFields.length}/${fields.length}`
                        : tool === 'filter' && filterField
                          ? '1'
                          : tool === 'sort' && sortField
                            ? '1'
                            : tool === 'group' && groupings.length
                              ? String(groupings.length)
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
                {selectedView && selectedViewWritable && (
                  <>
                    <button
                      className={`rounded-lg px-3 py-2 text-sm ${viewDirty ? 'bg-sky-500/15 font-medium text-sky-300 hover:bg-sky-500/20' : 'text-slate-600'}`}
                      disabled={!viewDirty || viewBusy}
                      onClick={() => void saveView()}
                      type="button"
                    >
                      {viewBusy ? t('data.saving') : t('data.saveView')}
                    </button>
                    {viewDirty && (
                      <button
                        className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                        disabled={viewBusy}
                        onClick={() => applyViewConfig(selectedView.config)}
                        type="button"
                      >
                        {t('data.discardChanges')}
                      </button>
                    )}
                  </>
                )}
                {selectedView && !selectedViewWritable && viewDirty && (
                  <button
                    className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    disabled={viewBusy}
                    onClick={() => applyViewConfig(selectedView.config)}
                    type="button"
                  >
                    {t('data.resetLocalView')}
                  </button>
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
                      setPageSize(Number(event.target.value) as 25 | 50 | 100 | 250 | 500);
                      setPage(1);
                    }}
                  >
                    {[25, 50, 100, 250, 500].map((size) => (
                      <option key={size} value={size}>
                        {t('data.rows', { count: size })}
                      </option>
                    ))}
                  </select>
                )}
                {workspaceMode && (
                  <ProjectReferencePicker
                    ariaLabel={t('data.projectFilter')}
                    className="max-w-48 rounded-lg border border-transparent bg-transparent px-3 py-2 text-sm text-slate-300 outline-none hover:bg-slate-800 focus:border-sky-500"
                    projects={projectReferences}
                    specialOptions={[
                      {
                        value: 'all',
                        label: locale === 'ko' ? '모든 프로젝트' : 'All projects',
                      },
                      { value: 'none', label: t('data.noProject') },
                    ]}
                    value={contextProjectFilter}
                    workspaceId={workspaceId}
                    onChange={(nextValue) => {
                      setContextProjectFilter(nextValue);
                      setPage(1);
                    }}
                    onProjectResolved={mergeProjectReferences}
                  />
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
                    <IconAction
                      className="size-5 text-xs"
                      icon="×"
                      label={t('data.clearSearch')}
                      onClick={() => {
                        setSearchValue('');
                        setPage(1);
                      }}
                    />
                  )}
                </div>
                <IconAction
                  icon={archiveState === 'active' ? '⌫' : '↺'}
                  label={archiveState === 'active' ? t('data.showArchived') : t('data.showActive')}
                  onClick={() => {
                    setArchiveState((current) => (current === 'active' ? 'archived' : 'active'));
                    setPage(1);
                    setSelectedRows(new Set());
                    setGridSelection(undefined);
                    setSelectedRecord(undefined);
                    setShowInlineRecord(false);
                    setShowNewRecord(false);
                    setShowBulkEdit(false);
                  }}
                  tone={archiveState === 'archived' ? 'accent' : 'default'}
                />
                {selectedRows.size > 0 && (
                  <div className="flex items-center gap-2 pl-2">
                    <span className="text-xs font-medium text-sky-300">
                      {t('data.selected', { count: selectedRows.size })}
                    </span>
                    {archiveState === 'active' &&
                      canUpdateRecords &&
                      fields.some(
                        (field) =>
                          !['measurement', 'formula', 'lookup', 'rollup'].includes(field.fieldType),
                      ) && (
                        <IconAction
                          aria-expanded={showBulkEdit}
                          disabled={bulkBusy}
                          icon="✎"
                          label={t('data.bulkEdit')}
                          onClick={() => setShowBulkEdit((current) => !current)}
                          tone={showBulkEdit ? 'accent' : 'default'}
                        />
                      )}
                    {archiveState === 'active' && canArchiveRecords && (
                      <IconAction
                        disabled={bulkBusy}
                        icon={bulkBusy ? '…' : '⌫'}
                        label={t('common.archive')}
                        onClick={() => void changeSelectedRowsLifecycle(true)}
                        tone="danger"
                      />
                    )}
                    {archiveState === 'archived' &&
                      allowed(user, 'record.restore') &&
                      canArchiveRecords && (
                        <IconAction
                          disabled={bulkBusy}
                          icon={bulkBusy ? '…' : '↺'}
                          label={t('common.restore')}
                          onClick={() => void changeSelectedRowsLifecycle(false)}
                          tone="accent"
                        />
                      )}
                    <IconAction
                      icon="×"
                      label={t('data.clear')}
                      onClick={() => {
                        setSelectedRows(new Set());
                        setShowBulkEdit(false);
                      }}
                    />
                  </div>
                )}
                <span className="px-2 text-xs text-slate-500">
                  {t('data.records', { count: records.total })}
                </span>
              </div>

              {selectedView && !selectedViewWritable && (
                <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-950/35 px-3 py-1.5 text-[11px] text-slate-500">
                  <span aria-hidden="true">
                    {recordViewPermission(selectedView) === 'locked' ? '▣' : '●'}
                  </span>
                  <span>
                    {recordViewPermission(selectedView) === 'locked'
                      ? t('data.lockedViewNotice')
                      : t('data.personalViewNotice')}
                    {selectedView.lockReason ? ` · ${selectedView.lockReason}` : ''}
                  </span>
                </div>
              )}

              {showBulkEdit && selectedRows.size > 0 && archiveState === 'active' && (
                <div className="border-t border-slate-800 px-3 pb-3">
                  <BulkRecordEditPanel
                    base={base}
                    busy={bulkBusy}
                    count={selectedRows.size}
                    fields={fields}
                    onCancel={() => setShowBulkEdit(false)}
                    onSubmit={updateSelectedRecordFields}
                  />
                </div>
              )}

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
                              aria-label={t('data.moveFieldLeft', { name: field.name })}
                              className="rounded px-1.5 py-1 text-slate-500 hover:bg-slate-800 hover:text-sky-300 disabled:opacity-30"
                              disabled={index === 0}
                              onClick={() => moveField(field.id, -1)}
                              type="button"
                            >
                              ←
                            </button>
                            <button
                              aria-label={t('data.moveFieldRight', { name: field.name })}
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

              {activeTool === 'group' && (
                <div className="border-t border-slate-800 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-slate-300">{t('data.groupRecords')}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {t('data.groupRecordsHelp')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {activeGroupings.length > 0 && (
                        <>
                          <IconAction
                            className="size-7"
                            icon="▾"
                            label={t('data.expandAllGroups')}
                            onClick={() => setCollapsedGroupPaths(new Set())}
                          />
                          <IconAction
                            className="size-7"
                            icon="▸"
                            label={t('data.collapseAllGroups')}
                            onClick={() =>
                              setCollapsedGroupPaths(
                                new Set(
                                  (records.groupHierarchy ?? []).map((group) =>
                                    groupPathKey(group.path.map((part) => part.value)),
                                  ),
                                ),
                              )
                            }
                          />
                        </>
                      )}
                      {groupings.length > 0 && (
                        <IconAction
                          className="size-7"
                          icon="×"
                          label={t('data.clearGroups')}
                          onClick={() => {
                            setGroupings([]);
                            setPage(1);
                          }}
                        />
                      )}
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {groupings.map((grouping, index) => (
                      <div
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/35 p-2"
                        key={`${grouping.fieldId}:${index}`}
                      >
                        <label className="flex items-center gap-2 text-xs text-slate-400">
                          <input
                            aria-label={t('data.enableGroupLevel', { level: index + 1 })}
                            checked={grouping.enabled}
                            type="checkbox"
                            onChange={(event) =>
                              setGroupings((current) =>
                                current.map((candidate, candidateIndex) =>
                                  candidateIndex === index
                                    ? { ...candidate, enabled: event.target.checked }
                                    : candidate,
                                ),
                              )
                            }
                          />
                          {t('data.groupLevel', { level: index + 1 })}
                        </label>
                        <select
                          aria-label={t('data.groupLevelField', { level: index + 1 })}
                          className="min-w-48 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500"
                          value={grouping.fieldId}
                          onChange={(event) => {
                            setGroupings((current) =>
                              current.map((candidate, candidateIndex) =>
                                candidateIndex === index
                                  ? { ...candidate, fieldId: event.target.value }
                                  : candidate,
                              ),
                            );
                            setPage(1);
                          }}
                        >
                          {groupableFields.map((field) => (
                            <option
                              disabled={groupings.some(
                                (candidate, candidateIndex) =>
                                  candidateIndex !== index && candidate.fieldId === field.id,
                              )}
                              key={field.id}
                              value={field.id}
                            >
                              {field.name}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label={t('data.groupDirection', { level: index + 1 })}
                          className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-sky-500"
                          value={grouping.direction}
                          onChange={(event) => {
                            setGroupings((current) =>
                              current.map((candidate, candidateIndex) =>
                                candidateIndex === index
                                  ? {
                                      ...candidate,
                                      direction: event.target.value as 'asc' | 'desc',
                                    }
                                  : candidate,
                              ),
                            );
                            setPage(1);
                          }}
                        >
                          <option value="asc">{t('data.ascending')}</option>
                          <option value="desc">{t('data.descending')}</option>
                        </select>
                        <span className="flex-1" />
                        <IconAction
                          className="size-7"
                          disabled={index === 0}
                          icon="↑"
                          label={t('data.moveGroupUp', { level: index + 1 })}
                          onClick={() =>
                            setGroupings((current) => {
                              const next = [...current];
                              [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                              return next;
                            })
                          }
                        />
                        <IconAction
                          className="size-7"
                          disabled={index === groupings.length - 1}
                          icon="↓"
                          label={t('data.moveGroupDown', { level: index + 1 })}
                          onClick={() =>
                            setGroupings((current) => {
                              const next = [...current];
                              [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                              return next;
                            })
                          }
                        />
                        <IconAction
                          className="size-7"
                          icon="⌫"
                          label={t('data.removeGroupLevel', { level: index + 1 })}
                          onClick={() => {
                            setGroupings((current) =>
                              current.filter((_, candidateIndex) => candidateIndex !== index),
                            );
                            setPage(1);
                          }}
                          tone="danger"
                        />
                      </div>
                    ))}
                  </div>
                  {groupings.length < 3 && groupings.length < groupableFields.length && (
                    <button
                      className="mt-2 rounded-md px-2 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/10"
                      onClick={() => {
                        const nextField = groupableFields.find(
                          (field) => !groupings.some((grouping) => grouping.fieldId === field.id),
                        );
                        if (!nextField) return;
                        setGroupings((current) => [
                          ...current,
                          { fieldId: nextField.id, direction: 'asc', enabled: true },
                        ]);
                        setPage(1);
                      }}
                      type="button"
                    >
                      + {t(groupings.length ? 'data.addSubgroup' : 'data.addGroup')}
                    </button>
                  )}
                  {!groupableFields.length && (
                    <p className="mt-3 text-xs text-slate-500">{t('data.noGroupableFields')}</p>
                  )}
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
                            ![
                              'measurement',
                              'range',
                              'spectral_data',
                              'tabular_data',
                              'file',
                              'dataset',
                            ].includes(field.fieldType) &&
                            !calculatedFieldTypeSet.has(field.fieldType),
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
                            ![
                              'relation',
                              'multi_select',
                              'measurement',
                              'range',
                              'spectral_data',
                              'tabular_data',
                              'file',
                              'dataset',
                              'formula',
                              'lookup',
                              'rollup',
                            ].includes(field.fieldType),
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

            {showShareView && selectedView && allowed(user, 'view.share') && (
              <RecordViewSharePanel
                base={base}
                key={selectedView.id}
                objectTypeId={selectedId}
                onClose={() => setShowShareView(false)}
                viewId={selectedView.publicId ?? selectedView.id}
                viewName={selectedView.name}
                viewType={activeViewType}
              />
            )}

            <div className="mt-2.5 flex flex-wrap items-start justify-between gap-2 text-xs text-slate-500">
              <details className="group relative">
                <summary className="cursor-pointer list-none rounded-md px-1.5 py-1 font-medium text-slate-500 marker:content-none hover:bg-slate-800/70 hover:text-sky-300">
                  <span aria-hidden="true" className="mr-1.5 text-sky-400">
                    ?
                  </span>
                  {gridGuideLabel}
                </summary>
                <p className="absolute left-0 top-8 z-30 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs leading-relaxed text-slate-300 shadow-xl">
                  {gridGuide}
                </p>
              </details>
              <p aria-live="polite" className="px-1.5 py-1">
                {selectedGridCellCount > 0
                  ? `${selectedGridCellCount} cells selected${clipboardBusy ? ' · Pasting…' : ''}`
                  : sharedChangesLabel}
              </p>
            </div>

            <div
              aria-busy={recordsLoading}
              aria-label={t('data.tableAccessibleLabel', { name: selected.pluralName })}
              className={`mt-1.5 w-full min-w-0 max-w-full overflow-x-auto overflow-y-auto overscroll-x-contain rounded-md border border-slate-800 ${activeViewType === 'grid' ? 'max-h-[72vh]' : ''}`}
              onScroll={(event) => {
                if (virtualizeGrid) setGridScrollTop(event.currentTarget.scrollTop);
              }}
              role="region"
              tabIndex={0}
            >
              <p aria-live="polite" className="sr-only">
                {layoutAnnouncement}
              </p>
              {recordsLoading && recordsObjectTypeId !== selectedId && (
                <div className="space-y-3 p-5" aria-label={t('data.loadingRecords')}>
                  <div className={skeletonLineClass} />
                  <div className={skeletonLineClass} />
                  <div className={skeletonLineClass} />
                </div>
              )}
              {(!recordsLoading || recordsObjectTypeId === selectedId) &&
                activeViewType === 'grid' && (
                  <table
                    aria-multiselectable="true"
                    className="min-w-full table-fixed select-none border-separate border-spacing-0 text-left text-sm"
                    role="grid"
                    style={{ width: gridTableWidth }}
                    onCopy={handleGridCopy}
                    onKeyDown={handleGridSelectionKeyDown}
                    onPaste={handleGridPaste}
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
                    <thead className="sticky top-0 z-20 bg-slate-900 text-xs uppercase tracking-wider text-slate-400">
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
                                toggleVisibleRecordSelection(event.target.checked)
                              }
                            />
                            #
                          </span>
                        </th>
                        <th
                          aria-label={t('data.name')}
                          className="sticky left-0 z-30 border-b border-r border-slate-800 bg-slate-900 px-1.5 py-1"
                          onContextMenu={(event) =>
                            setContextMenu(
                              menuFromPointer(
                                event,
                                t('data.name'),
                                systemColumnContextItems('displayName', t('data.name')),
                              ),
                            )
                          }
                          onKeyDown={(event) => {
                            const menu = menuFromKeyboard(
                              event,
                              t('data.name'),
                              systemColumnContextItems('displayName', t('data.name')),
                            );
                            if (menu) setContextMenu(menu);
                          }}
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
                            onContextMenu={(event) =>
                              setContextMenu(
                                menuFromPointer(
                                  event,
                                  t('data.project'),
                                  systemColumnContextItems('contextProject', t('data.project')),
                                ),
                              )
                            }
                            onKeyDown={(event) => {
                              const menu = menuFromKeyboard(
                                event,
                                t('data.project'),
                                systemColumnContextItems('contextProject', t('data.project')),
                              );
                              if (menu) setContextMenu(menu);
                            }}
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
                            onContextMenu={(event) =>
                              setContextMenu(
                                menuFromPointer(event, field.name, columnContextItems(field)),
                              )
                            }
                            style={{ width: fieldWidths[field.id] ?? DEFAULT_FIELD_WIDTH }}
                            onDragOver={(event: ReactDragEvent<HTMLTableCellElement>) => {
                              if (!draggedFieldId || draggedFieldId === field.id) return;
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'move';
                              const bounds = event.currentTarget.getBoundingClientRect();
                              setDragTarget({
                                fieldId: field.id,
                                position:
                                  event.clientX < bounds.left + bounds.width / 2
                                    ? 'before'
                                    : 'after',
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
                            onKeyDown={(event) => {
                              const menu = menuFromKeyboard(
                                event,
                                field.name,
                                columnContextItems(field),
                              );
                              if (menu) setContextMenu(menu);
                            }}
                          >
                            <div className="flex min-w-0 items-center gap-1">
                              <span
                                aria-label={t('data.reorderColumn', { column: field.name })}
                                className="inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-sm leading-none text-slate-600 hover:bg-slate-800 hover:text-sky-300 active:cursor-grabbing"
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
                                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
                                    return;
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
                                  'spectral_data',
                                  'tabular_data',
                                  'file',
                                  'dataset',
                                  'formula',
                                  'lookup',
                                  'rollup',
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
                                <span
                                  aria-label={t(
                                    schemaFieldTypeTranslationKeys[schemaTypeForField(field)],
                                  )}
                                  className="ml-1.5 grid size-5 shrink-0 place-items-center rounded border border-slate-700 font-mono text-[9px] font-normal normal-case text-slate-500"
                                  role="img"
                                  title={t(
                                    schemaFieldTypeTranslationKeys[schemaTypeForField(field)],
                                  )}
                                >
                                  {fieldMeta(field).icon}
                                </span>
                              </button>
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
                          onContextMenu={(event) =>
                            setContextMenu(
                              menuFromPointer(
                                event,
                                t('data.updated'),
                                systemColumnContextItems('updatedAt', t('data.updated')),
                              ),
                            )
                          }
                          onKeyDown={(event) => {
                            const menu = menuFromKeyboard(
                              event,
                              t('data.updated'),
                              systemColumnContextItems('updatedAt', t('data.updated')),
                            );
                            if (menu) setContextMenu(menu);
                          }}
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
                        <th className="w-20 border-b border-slate-800 px-2.5 py-2 text-center">
                          <span aria-label={t('data.detail')} title={t('data.detail')}>
                            ↗
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {virtualStart > 0 && (
                        <tr aria-hidden="true">
                          <td
                            colSpan={visibleFields.length + 4 + (workspaceMode ? 1 : 0)}
                            style={{ height: virtualStart * virtualRowHeight }}
                          />
                        </tr>
                      )}
                      {virtualRecords.map((record, visibleIndex) => {
                        const index = virtualStart + visibleIndex;
                        const path = groupingFields.map((field) => recordGroupValue(record, field));
                        const previousRecord = records.items[index - 1];
                        const previousPath = previousRecord
                          ? groupingFields.map((field) => recordGroupValue(previousRecord, field))
                          : [];
                        const hiddenByGroup = path.some((_, level) =>
                          collapsedGroupPaths.has(groupPathKey(path.slice(0, level + 1))),
                        );
                        const groupHeaders = groupingFields.flatMap((field, level) => {
                          const currentPath = path.slice(0, level + 1);
                          const currentPathKey = groupPathKey(currentPath);
                          const previousPathKey = groupPathKey(previousPath.slice(0, level + 1));
                          const ancestorCollapsed = currentPath
                            .slice(0, -1)
                            .some((_, ancestor) =>
                              collapsedGroupPaths.has(
                                groupPathKey(currentPath.slice(0, ancestor + 1)),
                              ),
                            );
                          if (ancestorCollapsed || currentPathKey === previousPathKey) return [];
                          const value = currentPath[level] ?? null;
                          const optionLabel =
                            field.fieldType === 'single_select'
                              ? field.config.options?.find((option) => option.key === value)?.label
                              : undefined;
                          const label = value === null ? t('data.noValue') : (optionLabel ?? value);
                          const collapsed = collapsedGroupPaths.has(currentPathKey);
                          const groupResult = groupResultByPath.get(currentPathKey);
                          const count = groupResult?.count ?? 0;
                          return [
                            <tr className="bg-slate-900/90" key={`group:${currentPathKey}`}>
                              <td
                                className="border-b border-slate-800 py-1 text-xs text-slate-300"
                                colSpan={visibleFields.length + 4 + (workspaceMode ? 1 : 0)}
                                style={{ paddingLeft: 8 + level * 20 }}
                              >
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <button
                                    aria-expanded={!collapsed}
                                    aria-label={t(
                                      collapsed ? 'data.expandGroup' : 'data.collapseGroup',
                                      { group: label },
                                    )}
                                    className="inline-flex max-w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-slate-800 hover:text-sky-300"
                                    onClick={() =>
                                      setCollapsedGroupPaths((current) => {
                                        const next = new Set(current);
                                        if (collapsed) next.delete(currentPathKey);
                                        else next.add(currentPathKey);
                                        return next;
                                      })
                                    }
                                    type="button"
                                  >
                                    <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
                                    <span className="truncate font-medium">{field.name}</span>
                                    <span className="truncate text-slate-400">{label}</span>
                                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
                                      {count}
                                    </span>
                                  </button>
                                  {(groupResult?.summaries ?? []).map((summary) => {
                                    const summaryField = fields.find(
                                      (candidate) => candidate.id === summary.fieldId,
                                    );
                                    if (!summaryField) return null;
                                    const summaryValue =
                                      summary.value === null
                                        ? '—'
                                        : `${summary.value}${summary.unit ? ` ${summary.unit}` : ''}`;
                                    const summaryLabel = t('data.groupSummaryLabel', {
                                      field: summaryField.name,
                                      operation: t(summaryTranslationKeys[summary.operation]),
                                      value: summaryValue,
                                    });
                                    return (
                                      <span
                                        aria-label={summaryLabel}
                                        className="rounded-md border border-slate-800 bg-slate-950/70 px-1.5 py-0.5 text-[10px] text-slate-400"
                                        key={`${summary.fieldId}:${summary.operation}`}
                                        title={t('data.groupSummaryScope')}
                                      >
                                        {summaryField.name} ·{' '}
                                        {t(summaryTranslationKeys[summary.operation])}{' '}
                                        <strong className="font-medium text-slate-200">
                                          {summaryValue}
                                        </strong>
                                      </span>
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>,
                          ];
                        });
                        return (
                          <Fragment key={record.id}>
                            {groupHeaders}
                            {!hiddenByGroup && (
                              <tr
                                className={`${selectedRows.has(record.id) ? 'bg-sky-500/5' : 'bg-slate-950/30'} hover:bg-slate-900/40`}
                                onContextMenu={(event) => openRecordContextMenu(event, record)}
                                onKeyDown={(event) =>
                                  openRecordContextMenuFromKeyboard(event, record)
                                }
                              >
                                <td className="border-b border-r border-slate-800 px-3 text-xs text-slate-600">
                                  <span className="flex items-center gap-2">
                                    <input
                                      aria-label={t('data.selectRecord', {
                                        name: record.displayName,
                                      })}
                                      className="size-6"
                                      checked={selectedRows.has(record.id)}
                                      type="checkbox"
                                      onChange={(event) =>
                                        toggleRecordSelection(record.id, event.target.checked)
                                      }
                                    />
                                    <button
                                      aria-label={t('data.quickViewRecord', {
                                        name: record.displayName,
                                      })}
                                      className="min-w-6 rounded px-1 py-2 font-mono hover:bg-slate-800 hover:text-sky-300"
                                      onClick={() => setSelectedRecord(record)}
                                      title={t('data.openQuickView')}
                                      type="button"
                                    >
                                      {(records.page - 1) * records.pageSize + index + 1}
                                    </button>
                                  </span>
                                </td>
                                <td
                                  className={`sticky left-0 z-10 border-b border-r border-slate-800 bg-slate-950 ${gridCellSelectionClass({ rowId: record.id, columnKey: 'displayName' })}`}
                                  data-grid-cell=""
                                  data-grid-column-key="displayName"
                                  data-grid-row-id={record.id}
                                  onPointerDown={(event) =>
                                    beginGridCellSelection(event, {
                                      rowId: record.id,
                                      columnKey: 'displayName',
                                    })
                                  }
                                  onPointerEnter={(event) =>
                                    extendGridCellSelection(event, {
                                      rowId: record.id,
                                      columnKey: 'displayName',
                                    })
                                  }
                                  tabIndex={-1}
                                >
                                  {!record.archivedAt && canUpdateRecords ? (
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
                                  <td
                                    className={`border-b border-r border-slate-800 px-1.5 py-1 ${gridCellSelectionClass({ rowId: record.id, columnKey: 'contextProject' })}`}
                                    data-grid-cell=""
                                    data-grid-column-key="contextProject"
                                    data-grid-row-id={record.id}
                                    onPointerDown={(event) =>
                                      beginGridCellSelection(event, {
                                        rowId: record.id,
                                        columnKey: 'contextProject',
                                      })
                                    }
                                    onPointerEnter={(event) =>
                                      extendGridCellSelection(event, {
                                        rowId: record.id,
                                        columnKey: 'contextProject',
                                      })
                                    }
                                    tabIndex={-1}
                                  >
                                    {!record.archivedAt && canUpdateRecords ? (
                                      <ProjectReferencePicker
                                        ariaLabel={t('data.projectForRecord', {
                                          name: record.displayName,
                                        })}
                                        className="min-h-7 w-full select-text rounded border border-transparent bg-transparent px-1.5 text-xs text-slate-300 outline-none hover:border-slate-700 focus:border-sky-400"
                                        projects={projectReferences}
                                        specialOptions={[{ value: '', label: t('data.noProject') }]}
                                        value={record.contextProjectId ?? ''}
                                        workspaceId={workspaceId}
                                        onChange={(nextValue) =>
                                          void saveProjectCell(record, nextValue || null).catch(
                                            (cause: unknown) => {
                                              setMessageTone('error');
                                              setMessage(
                                                cause instanceof Error
                                                  ? cause.message
                                                  : t('data.projectLinkSaveFailed'),
                                              );
                                            },
                                          )
                                        }
                                        onProjectResolved={mergeProjectReferences}
                                      />
                                    ) : (
                                      <span className="block truncate px-1.5 text-xs text-slate-400">
                                        {projectById.get(record.contextProjectId ?? '')?.name ??
                                          t('data.noProject')}
                                      </span>
                                    )}
                                  </td>
                                )}
                                {visibleFields.map((field) => (
                                  <td
                                    className={`border-b border-r border-slate-800 ${gridCellSelectionClass({ rowId: record.id, columnKey: `field:${field.id}` })}`}
                                    data-grid-cell=""
                                    data-grid-column-key={`field:${field.id}`}
                                    data-grid-row-id={record.id}
                                    key={field.id}
                                    onPointerDown={(event) =>
                                      beginGridCellSelection(event, {
                                        rowId: record.id,
                                        columnKey: `field:${field.id}`,
                                      })
                                    }
                                    onPointerEnter={(event) =>
                                      extendGridCellSelection(event, {
                                        rowId: record.id,
                                        columnKey: `field:${field.id}`,
                                      })
                                    }
                                    tabIndex={-1}
                                  >
                                    {field.fieldType === 'measurement' ? (
                                      <span className="block max-w-64 truncate px-2.5 py-2 text-xs text-slate-400">
                                        {record.measurements?.[field.id]?.resultId
                                          ? `${record.measurements[field.id]?.value} ${record.measurements[field.id]?.unit} · ${record.measurements[field.id]?.status ?? 'pending'}`
                                          : (record.measurements?.[field.id]?.status ?? '—')}
                                      </span>
                                    ) : field.fieldType === 'file' && isImageField(field.config) ? (
                                      <ImageGridCell
                                        base={base}
                                        comfortable={rowDensity === 'comfortable'}
                                        editable={!record.archivedAt && canUpdateRecords}
                                        label={field.name}
                                        recordName={record.displayName}
                                        value={recordGridValue(record, field)}
                                        onSave={(value) => saveGridCell(record, field, value)}
                                      />
                                    ) : !record.archivedAt &&
                                      canUpdateRecords &&
                                      !calculatedFieldTypeSet.has(field.fieldType) ? (
                                      <GridCell
                                        base={base}
                                        comfortable={rowDensity === 'comfortable'}
                                        field={field}
                                        label={field.name}
                                        recordName={record.displayName}
                                        relationReferences={record.relationLabels?.[field.id]}
                                        referenceLabels={record.referenceLabels?.[field.id]}
                                        value={recordGridValue(record, field)}
                                        onSave={(value) => saveGridCell(record, field, value)}
                                      />
                                    ) : (
                                      <span
                                        className={`flex w-full items-center px-2.5 text-xs text-slate-300 ${rowDensity === 'comfortable' ? 'min-h-11 py-2' : 'min-h-8 py-1'}`}
                                      >
                                        {field.fieldType === 'relation' ? (
                                          <RelationValue
                                            ids={record.relations[field.id] ?? []}
                                            references={record.relationLabels?.[field.id]}
                                          />
                                        ) : (
                                          <CellValuePreview
                                            base={base}
                                            field={field}
                                            label={field.name}
                                            references={record.referenceLabels?.[field.id]}
                                            value={recordGridValue(record, field)}
                                          />
                                        )}
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
                                    aria-label={t('data.expandRecord', {
                                      name: record.displayName,
                                    })}
                                    className="rounded-lg px-2 py-1 text-sky-400 hover:bg-sky-500/10 hover:text-sky-300"
                                    onClick={() => setSelectedRecord(record)}
                                    title={t('data.quickViewRecord', { name: record.displayName })}
                                    type="button"
                                  >
                                    ↗
                                  </button>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                      {virtualEnd < records.items.length && (
                        <tr aria-hidden="true">
                          <td
                            colSpan={visibleFields.length + 4 + (workspaceMode ? 1 : 0)}
                            style={{
                              height: (records.items.length - virtualEnd) * virtualRowHeight,
                            }}
                          />
                        </tr>
                      )}
                      {archiveState === 'active' && showInlineRecord && canCreateRecords && (
                        <InlineRecordRow
                          base={base}
                          fields={visibleFields}
                          projects={workspaceMode ? projectReferences : undefined}
                          workspaceId={workspaceMode ? workspaceId : undefined}
                          key={`${selectedId}:${visibleFields.map((field) => field.id).join(',')}`}
                          onCancel={() => setShowInlineRecord(false)}
                          onCreate={createInlineRecord}
                          onOpenFullForm={() => {
                            setShowInlineRecord(false);
                            setShowNewRecord(true);
                          }}
                          onProjectResolved={mergeProjectReferences}
                        />
                      )}
                      {archiveState === 'active' && !showInlineRecord && canCreateRecords && (
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
                              {locale === 'ko' ? '+ 레코드 추가' : '+ Add record'}
                            </button>
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot className="sticky bottom-0 z-20 bg-slate-900 text-xs">
                      <tr>
                        <td className="border-r border-slate-800 p-1 text-sky-400">Σ</td>
                        <td className="sticky left-0 z-30 bg-slate-900 p-1 text-slate-400">
                          {t('data.summaryFilteredRows', { count: records.total })}
                        </td>
                        {workspaceMode && <td className="border-r border-slate-800" />}
                        {visibleFields.map((field) => {
                          const operation = fieldSummaries[field.id] ?? '';
                          const options = summaryOperationsForField(field);
                          const result = records.summaries?.find(
                            (summary) =>
                              summary.fieldId === field.id && summary.operation === operation,
                          );
                          const value =
                            result?.value == null
                              ? ''
                              : `${result.value}${result.unit ? ` ${result.unit}` : ''}`;
                          return (
                            <td className="border-r border-slate-800 p-1" key={field.id}>
                              {options.length ? (
                                <div className="flex items-center gap-1">
                                  <select
                                    aria-label={t('data.summaryFor', { field: field.name })}
                                    className="min-w-0 flex-1 bg-transparent text-xs text-slate-400"
                                    title={t('data.summaryFullScope')}
                                    value={operation}
                                    onChange={(event) => {
                                      const nextOperation = event.target.value as
                                        RecordSummaryOperation | '';
                                      setFieldSummaries((current) => {
                                        const next = { ...current };
                                        if (nextOperation) next[field.id] = nextOperation;
                                        else delete next[field.id];
                                        return next;
                                      });
                                    }}
                                  >
                                    <option value="">—</option>
                                    {options.map((candidate) => (
                                      <option key={candidate} value={candidate}>
                                        {t(summaryTranslationKeys[candidate])}
                                      </option>
                                    ))}
                                  </select>
                                  {operation && (
                                    <span
                                      className="max-w-24 truncate font-mono text-sky-300"
                                      title={value || undefined}
                                    >
                                      {recordsLoading ? '…' : value || '—'}
                                    </span>
                                  )}
                                </div>
                              ) : null}
                            </td>
                          );
                        })}
                        <td className="border-r border-slate-800" />
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                )}
              {(!recordsLoading || recordsObjectTypeId === selectedId) &&
                activeViewType === 'gallery' && (
                  <GalleryRecordsView
                    fields={visibleFields}
                    records={records.items}
                    onContextMenu={openRecordContextMenu}
                    onContextMenuKeyDown={openRecordContextMenuFromKeyboard}
                    onOpen={setSelectedRecord}
                  />
                )}
              {(!recordsLoading || recordsObjectTypeId === selectedId) &&
                activeViewType === 'kanban' && (
                  <>
                    {kanbanField ? (
                      <KanbanRecordsView
                        canUpdate={archiveState === 'active' && canUpdateRecords}
                        field={kanbanField}
                        groups={records.groups}
                        records={records.items}
                        onContextMenu={openRecordContextMenu}
                        onContextMenuKeyDown={openRecordContextMenuFromKeyboard}
                        onMove={(record, value) => saveGridCell(record, kanbanField, value)}
                        onOpen={setSelectedRecord}
                      />
                    ) : (
                      <p className="p-8 text-center text-sm text-rose-300">
                        {t('data.invalidKanban')}
                      </p>
                    )}
                  </>
                )}
              {(!recordsLoading || recordsObjectTypeId === selectedId) &&
                activeViewType === 'calendar' && (
                  <>
                    {calendarField ? (
                      <CalendarRecordsView
                        field={calendarField}
                        month={calendarMonth}
                        records={records.items}
                        onContextMenu={openRecordContextMenu}
                        onContextMenuKeyDown={openRecordContextMenuFromKeyboard}
                        onMonthChange={(month) => {
                          setCalendarMonth(month);
                          setPage(1);
                        }}
                        onOpen={setSelectedRecord}
                      />
                    ) : (
                      <p className="p-8 text-center text-sm text-rose-300">
                        {t('data.invalidCalendar')}
                      </p>
                    )}
                  </>
                )}
              {(!recordsLoading || recordsObjectTypeId === selectedId) &&
                activeViewType === 'form' && (
                  <div className="mx-auto max-w-3xl p-5">
                    <div className="mb-4 border-b border-slate-800 pb-3">
                      <h3 className="text-lg font-semibold">Add {selected.name}</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Submissions create records in {selected.pluralName} and appear in every
                        view.
                      </p>
                    </div>
                    {archiveState === 'active' && canCreateRecords ? (
                      <RecordForm
                        base={base}
                        fields={formFields}
                        projects={workspaceMode ? projectReferences : undefined}
                        submitLabel="Submit record"
                        workspaceId={workspaceMode ? workspaceId : undefined}
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
                          setMessage(t('data.recordSubmitted', { name: created.displayName }));
                          await loadRecords();
                        }}
                        onProjectResolved={mergeProjectReferences}
                      />
                    ) : (
                      <p className="rounded-md border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">
                        {t('data.readOnlyForm')}
                      </p>
                    )}
                  </div>
                )}
              {(!recordsLoading || recordsObjectTypeId === selectedId) &&
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
                {locale === 'ko'
                  ? `${t('data.records', { count: records.total })} · 페이지 ${records.page} / ${Math.max(1, Math.ceil(records.total / records.pageSize))}`
                  : `${records.total} records · page ${records.page} of ${Math.max(1, Math.ceil(records.total / records.pageSize))}`}
              </span>
              <div className="flex gap-1">
                <IconAction
                  disabled={page <= 1}
                  icon="←"
                  label={t('common.previous')}
                  onClick={() => setPage((value) => value - 1)}
                />
                <IconAction
                  disabled={page * records.pageSize >= records.total}
                  icon="→"
                  label={t('common.next')}
                  onClick={() => setPage((value) => value + 1)}
                />
              </div>
            </div>

            <SpecificationsPanel base={base} fields={fields} user={user} />
          </>
        )}
      </section>
      {archiveState === 'active' && showNewRecord && selected && canCreateRecords && (
        <div className="fixed inset-0 z-[70] flex justify-end" role="presentation">
          <button
            aria-label={t('data.closeNewRecordPanel')}
            className="absolute inset-0 cursor-default bg-slate-950/65 backdrop-blur-sm"
            data-modal-backdrop
            onClick={() => setShowNewRecord(false)}
            type="button"
          />
          <aside
            aria-labelledby="new-record-title"
            aria-modal="true"
            className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-slate-700 bg-slate-950 shadow-2xl shadow-black/50"
            ref={newRecordDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/90 px-5 py-4 backdrop-blur-xl sm:px-7">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-400">
                  {selected.name}
                </p>
                <h2 className="mt-1 text-2xl font-semibold" id="new-record-title">
                  {t('data.newRecord')}
                </h2>
              </div>
              <button
                aria-label={t('data.closeNewRecordPanel')}
                className="grid size-9 place-items-center rounded-lg border border-slate-700 text-xl text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                data-dialog-initial-focus
                onClick={() => setShowNewRecord(false)}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="p-5 sm:p-7">
              <RecordForm
                base={base}
                fields={fields}
                projects={workspaceMode ? projectReferences : undefined}
                submitLabel="Create record"
                workspaceId={workspaceMode ? workspaceId : undefined}
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
                onProjectResolved={mergeProjectReferences}
              />
            </div>
          </aside>
        </div>
      )}
      {selectedRecord && (
        <div className="fixed inset-0 z-[70] flex justify-end" role="presentation">
          <button
            aria-label={t('data.closeQuickRecordView')}
            className="absolute inset-0 cursor-default bg-slate-950/65 backdrop-blur-sm"
            data-modal-backdrop
            onClick={() => setSelectedRecord(undefined)}
            type="button"
          />
          <aside
            aria-labelledby="quick-record-title"
            aria-modal="true"
            className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-slate-700 bg-slate-950 shadow-2xl shadow-black/50"
            ref={quickRecordDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-950/90 px-5 py-4 backdrop-blur-xl sm:px-7">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-400">
                  {selected?.name ?? 'Record'} · quick view
                </p>
                <h2 className="mt-1 truncate text-2xl font-semibold" id="quick-record-title">
                  {selectedRecord.displayName}
                </h2>
                <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-600">
                  <span className="font-mono">
                    {t('data.version', { version: selectedRecord.rowVersion })}
                  </span>
                  <IconAction
                    className="size-5 text-[10px]"
                    icon="#"
                    label={t('data.copyIdentifier', { label: t('data.recordId') })}
                    onClick={() => void copyContextValue(t('data.recordId'), selectedRecord.id)}
                  />
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {selectedRecord.archivedAt &&
                  allowed(user, 'record.restore') &&
                  canArchiveRecords && (
                    <IconAction
                      className="size-9"
                      icon="↺"
                      label={t('common.restore')}
                      onClick={() => void changeRecordLifecycle(selectedRecord, false)}
                      tone="accent"
                    />
                  )}
                {!workspaceMode && (
                  <Link
                    className="rounded-lg px-3 py-2 text-sm text-sky-300 hover:bg-sky-500/10"
                    to={`${base}/data/${objectTypes.find((item) => item.id === selectedRecord.objectTypeId)?.publicId ?? selectedRecord.objectTypeId}/records/${selectedRecord.id}`}
                  >
                    {t('data.fullRecord')}
                  </Link>
                )}
                <button
                  aria-label={t('data.closeQuickRecordView')}
                  className="grid size-9 place-items-center rounded-lg border border-slate-700 text-xl text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                  data-dialog-initial-focus
                  onClick={() => setSelectedRecord(undefined)}
                  type="button"
                >
                  ×
                </button>
              </div>
            </header>
            <div className="p-5 sm:p-7">
              <div
                aria-label={t('data.recordDetail')}
                className="mb-5 grid grid-cols-3 rounded-lg border border-slate-800 bg-slate-900/45 p-1"
                role="tablist"
              >
                {(['fields', 'comments', 'history'] as const).map((tab) => (
                  <button
                    aria-selected={quickRecordTab === tab}
                    className={`rounded-md px-2 py-2 text-xs font-medium ${quickRecordTab === tab ? 'bg-sky-500/15 text-sky-300' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'}`}
                    key={tab}
                    onClick={() => setQuickRecordTab(tab)}
                    role="tab"
                    type="button"
                  >
                    {t(
                      tab === 'fields'
                        ? 'data.propertiesRelations'
                        : tab === 'comments'
                          ? 'data.comments'
                          : 'data.changeHistory',
                    )}
                  </button>
                ))}
              </div>
              {quickRecordTab === 'fields' && (
                <>
                  <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/45 px-4 py-3 text-xs text-slate-400">
                    {selectedRecord.archivedAt
                      ? t('data.archivedReadOnly')
                      : 'Mutable properties can be edited here without leaving the grid.'}
                    {!selectedRecord.archivedAt &&
                      !workspaceMode &&
                      ' Measurements and evaluation history remain available in the full record view.'}
                  </div>
                  {!selectedRecord.archivedAt && canUpdateRecords ? (
                    <RecordForm
                      base={base}
                      fields={fields}
                      projects={workspaceMode ? projectReferences : undefined}
                      record={selectedRecord}
                      submitLabel="Save record"
                      workspaceId={workspaceMode ? workspaceId : undefined}
                      onSubmit={(form) => saveRecordPanel(selectedRecord, form)}
                      onProjectResolved={mergeProjectReferences}
                    />
                  ) : (
                    <dl className="divide-y divide-slate-800 rounded-xl border border-slate-800">
                      {visibleFields.map((field) => (
                        <div
                          className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]"
                          key={field.id}
                        >
                          <dt className="text-sm text-slate-500">{field.name}</dt>
                          <dd className="text-sm text-slate-200">
                            {field.fieldType === 'relation' ? (
                              <RelationValue
                                ids={selectedRecord.relations[field.id] ?? []}
                                references={selectedRecord.relationLabels?.[field.id]}
                              />
                            ) : field.fieldType === 'measurement' ? (
                              displayValue(selectedRecord.measurements?.[field.id]?.value)
                            ) : (
                              displayFieldValue(
                                field,
                                recordGridValue(selectedRecord, field),
                                selectedRecord.referenceLabels?.[field.id],
                              )
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </>
              )}
              {quickRecordTab === 'comments' && (
                <RecordCommentsPanel
                  archived={Boolean(selectedRecord.archivedAt)}
                  base={base}
                  compact
                  objectTypeId={selectedRecord.objectTypeId}
                  recordId={selectedRecord.id}
                  user={user}
                />
              )}
              {quickRecordTab === 'history' && (
                <RecordHistoryPanel
                  base={base}
                  objectTypeId={selectedRecord.objectTypeId}
                  record={selectedRecord}
                  user={user}
                  onRestored={(restored) => {
                    setSelectedRecord(restored);
                    void loadRecords();
                  }}
                />
              )}
            </div>
          </aside>
        </div>
      )}
      {showCreateTable && allowed(user, 'schema.manage') && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <button
            aria-label={t('common.close')}
            className="absolute inset-0 cursor-default"
            data-modal-backdrop
            onClick={() => setShowCreateTable(false)}
            type="button"
          />
          <section
            aria-labelledby="create-table-title"
            aria-modal="true"
            className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl shadow-black/40 sm:p-6"
            ref={createTableDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold" id="create-table-title">
                  {t('data.createTable')}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">
                  {t('data.createTableHint')}
                </p>
              </div>
              <button
                aria-label={t('common.close')}
                className="grid size-9 shrink-0 place-items-center rounded-lg text-xl text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                onClick={() => setShowCreateTable(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <form className="mt-5 space-y-4" onSubmit={(event) => void createObjectType(event)}>
              <label className="block text-sm font-medium text-slate-300">
                <FormFieldLabel required>{t('data.typeName')}</FormFieldLabel>
                <input
                  autoFocus
                  className={inputClass}
                  data-dialog-initial-focus
                  name="name"
                  placeholder={t('data.typeName')}
                  required
                />
              </label>
              <label className="block text-sm font-medium text-slate-300">
                <FormFieldLabel required>{t('data.tableLabel')}</FormFieldLabel>
                <input
                  className={inputClass}
                  name="pluralName"
                  placeholder={t('data.tableLabel')}
                  required
                />
              </label>
              <label className="block text-sm font-medium text-slate-300">
                <FormFieldLabel required>{t('data.stableKey')}</FormFieldLabel>
                <input
                  className={inputClass}
                  name="key"
                  pattern="[a-z][a-z0-9-]{1,63}"
                  placeholder="test-samples"
                  required
                />
              </label>
              <ErrorText>{createTableError}</ErrorText>
              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <Button
                  className="sm:min-w-24"
                  onClick={() => setShowCreateTable(false)}
                  type="button"
                  variant="quiet"
                >
                  {t('common.cancel')}
                </Button>
                <Button className="sm:min-w-28" disabled={createTableBusy} type="submit">
                  {createTableBusy ? t('common.working') : t('data.addTable')}
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(undefined)} />
    </>
  );
}

export function RecordDetailPage({ user }: { user: User }) {
  const { t } = useI18n();
  const { confirmAction } = useActionDialog();
  const { workspaceId = '', projectId = '', objectTypeId = '', recordId = '' } = useParams();
  const navigate = useNavigate();
  const base = projectPath(workspaceId, projectId);
  const [objectType, setObjectType] = useState<ObjectType>();
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [record, setRecord] = useState<DynamicRecord>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try {
      const [loadedObjectType, fieldResult, recordResult] = await Promise.all([
        api<ObjectType>(`${base}/object-types/${objectTypeId}`),
        api<{ items: FieldDefinition[] }>(`${base}/object-types/${objectTypeId}/fields`),
        api<DynamicRecord>(`${base}/object-types/${objectTypeId}/records/${recordId}`),
      ]);
      setObjectType(loadedObjectType);
      setFields(fieldResult.items);
      setRecord(recordResult);
      setError('');
      if (loadedObjectType.publicId && loadedObjectType.publicId !== objectTypeId) {
        void navigate(`${base}/data/${loadedObjectType.publicId}/records/${recordId}`, {
          replace: true,
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('data.recordLoadFailed'));
    }
  }, [base, navigate, objectTypeId, recordId, t]);
  useEffect(() => void load(), [load]);

  async function archive(archived: boolean) {
    if (archived && !(await confirmAction(t('data.recordArchiveConfirm'), { tone: 'danger' })))
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
      setError(cause instanceof Error ? cause.message : t('data.lifecycleFailed'));
    }
  }

  async function copyRecordId() {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard is unavailable.');
      await navigator.clipboard.writeText(recordId);
      setNotice(t('data.copied', { label: t('data.recordId') }));
    } catch {
      setError(t('data.clipboardDenied'));
    }
  }

  if (!record && !error) return <p className="text-slate-400">{t('data.loadingRecord')}</p>;
  if (!record) return <ErrorText>{error}</ErrorText>;
  const canUpdateRecord =
    allowed(user, 'record.update') && (objectType?.recordPermissions?.canUpdate ?? true);
  const canArchiveRecord =
    (objectType?.recordPermissions?.canArchive ?? true) &&
    (allowed(user, 'record.archive') || allowed(user, 'record.restore'));
  return (
    <>
      <Link className="text-sm text-sky-400" to={`${base}/data?type=${objectTypeId}`}>
        ← {t('data.dataGrid')}
      </Link>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-sky-400">
            {t('data.recordDetail')}
          </p>
          <h1 className="mt-2 text-4xl font-semibold">{record.displayName}</h1>
          <div className="mt-2 flex items-center gap-1 text-sm text-slate-500">
            <span>{t('data.version', { version: record.rowVersion })}</span>
            <IconAction
              className="size-6 text-xs"
              icon="#"
              label={t('data.copyIdentifier', { label: t('data.recordId') })}
              onClick={() => void copyRecordId()}
            />
          </div>
        </div>
        <div className="flex gap-2">
          {record.archivedAt
            ? allowed(user, 'record.restore') &&
              canArchiveRecord && (
                <Button onClick={() => void archive(false)}>{t('common.restore')}</Button>
              )
            : allowed(user, 'record.archive') &&
              canArchiveRecord && (
                <Button variant="quiet" onClick={() => void archive(true)}>
                  {t('common.archive')}
                </Button>
              )}
        </div>
      </div>
      <ErrorText>{error}</ErrorText>
      <NoticeText tone="success">{notice}</NoticeText>
      <section className={emptyPanelClass}>
        <h2 className="mb-5 text-xl font-semibold">{t('data.propertiesRelations')}</h2>
        {record.archivedAt && (
          <p className="mb-5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
            {t('data.archivedReadOnly')}
          </p>
        )}
        {!record.archivedAt && canUpdateRecord ? (
          <RecordForm
            base={base}
            key={record.rowVersion}
            fields={fields}
            record={record}
            submitLabel={t('data.saveChanges')}
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
                  {field.fieldType === 'relation' ? (
                    <RelationValue
                      ids={record.relations[field.id] ?? []}
                      references={record.relationLabels?.[field.id]}
                    />
                  ) : field.fieldType === 'measurement' ? (
                    record.measurements?.[field.id]?.resultId ? (
                      `${record.measurements[field.id]?.value} ${record.measurements[field.id]?.unit} · ${record.measurements[field.id]?.status ?? 'pending'}`
                    ) : (
                      (record.measurements?.[field.id]?.status ?? '—')
                    )
                  ) : (
                    displayFieldValue(
                      field,
                      recordGridValue(record, field),
                      record.referenceLabels?.[field.id],
                    )
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <RecordCommentsPanel
        archived={Boolean(record.archivedAt)}
        base={base}
        objectTypeId={objectTypeId}
        recordId={record.id}
        user={user}
      />
      <RecordReviewsPanel
        base={base}
        objectTypeId={objectTypeId}
        recordId={record.id}
        user={user}
      />
      <RecordHistoryPanel
        base={base}
        objectTypeId={objectTypeId}
        record={record}
        user={user}
        onRestored={(restored) => {
          setRecord(restored);
          setError('');
        }}
      />
      <MeasurementsPanel base={base} fields={fields} recordId={record.id} user={user} />
      <LinkedTasksPanel base={base} recordId={record.id} />
      <button
        className="mt-8 text-sm text-slate-500 hover:text-rose-300"
        onClick={() => navigate(`${base}/data?type=${objectTypeId}`)}
      >
        {t('data.closeDetail')}
      </button>
    </>
  );
}
