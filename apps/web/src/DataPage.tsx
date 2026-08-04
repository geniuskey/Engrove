import { Button } from '@engrove/ui';
import {
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
import { useI18n } from './i18n.js';
import { useServiceSidebarPortal } from './ServiceSidebar.js';
import { useModalDialog } from './useModalDialog.js';
import type {
  CsvResult,
  DynamicRecord,
  FieldDefinition,
  FieldType,
  GridCellAddress,
  GridColumn,
  GridSelection,
  ObjectType,
  QueryResult,
  RecordView,
  RecordViewConfig,
  RecordViewType,
  SystemFieldWidthKey,
  WorkspaceDataContext,
} from './DataPageTypes.js';
export type { WorkspaceDataContext } from './DataPageTypes.js';
import {
  canonicalTableIdentifier,
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
import { ImageGridCell, isImageField } from './DataPageImages.js';
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
  compactMenuItemClass,
  emptyPanelClass,
  fieldSupportsUnique,
  fieldHintClass,
  fieldLabelClass,
  fieldTypeMeta,
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

type SchemaFieldType = FieldType | 'image';
const imageFieldMeta = {
  label: 'Image',
  description: 'Upload and preview an image in each cell',
  icon: '▧',
  group: 'Linked' as const,
};
const schemaFieldTypeMeta = { ...fieldTypeMeta, image: imageFieldMeta };

function fieldMeta(field: FieldDefinition) {
  return field.fieldType === 'file' && isImageField(field.config)
    ? imageFieldMeta
    : fieldTypeMeta[field.fieldType];
}

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

const viewTypeMeta: Record<RecordViewType, { icon: string; label: string }> = {
  grid: { icon: '▦', label: 'Grid' },
  form: { icon: '▤', label: 'Form' },
  gallery: { icon: '▧', label: 'Gallery' },
  kanban: { icon: '▥', label: 'Kanban' },
  calendar: { icon: '□', label: 'Calendar' },
};

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
  const params = useParams();
  const workspaceId = workspaceData?.workspaceId ?? params.workspaceId ?? '';
  const projectId = workspaceData?.backingProjectId ?? params.projectId ?? '';
  const workspaceMode = Boolean(workspaceData);
  const routeObjectTypeId = workspaceMode ? params.objectTypeId : undefined;
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
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
  const [gridSelection, setGridSelection] = useState<GridSelection>();
  const [dragSelectingCells, setDragSelectingCells] = useState(false);
  const [clipboardBusy, setClipboardBusy] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(() => new Set());
  const [selectedRecord, setSelectedRecord] = useState<DynamicRecord>();
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const [showTableSettings, setShowTableSettings] = useState(false);
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
  const [newViewType, setNewViewType] = useState<RecordViewType>('grid');
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const [contextMenu, setContextMenu] = useState<ContextMenuModel>();
  const [csvResult, setCsvResult] = useState<CsvResult>();
  const newRecordDialogRef = useModalDialog<HTMLElement>(showNewRecord, () =>
    setShowNewRecord(false),
  );
  const quickRecordDialogRef = useModalDialog<HTMLElement>(Boolean(selectedRecord), () =>
    setSelectedRecord(undefined),
  );
  const appliedViewKey = useRef('');
  const pendingViewId = useRef('');
  const layoutPreferenceReadyKey = useRef('');
  const dataContextRequestId = useRef(0);
  const recordsRequestId = useRef(0);
  const sidebarPortal = useServiceSidebarPortal();
  const selectedIdentifier = canonicalTableIdentifier(
    routeObjectTypeId ?? search.get('type') ?? objectTypes[0]?.publicId ?? objectTypes[0]?.id ?? '',
  );
  const requestedViewId = search.get('view') ?? 'all';
  const selected = objectTypes.find(
    (objectType) =>
      (objectType.publicId ?? objectType.id) === selectedIdentifier ||
      objectType.id === selectedIdentifier,
  );
  const selectedId = selected?.id ?? '';
  const selectedPublicId = selected?.publicId ?? selectedIdentifier;
  const selectedView = views.find(
    (view) => view.id === requestedViewId || view.publicId === requestedViewId,
  );
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
        fieldMeta(field).label.toLowerCase().includes(query),
    );
  }, [schemaFields, schemaSearch]);
  const selectedSchemaField = fields.find((field) => field.id === schemaSelection);
  const visibleFields = useMemo(
    () => orderedFields.filter((field) => !hiddenFieldIds.has(field.id)),
    [hiddenFieldIds, orderedFields],
  );
  const gridColumns = useMemo<GridColumn[]>(
    () => [
      { key: 'displayName', label: t('data.name'), kind: 'displayName', editable: true },
      ...(workspaceMode
        ? ([
            {
              key: 'contextProject',
              label: t('data.project'),
              kind: 'contextProject',
              editable: true,
            },
          ] satisfies GridColumn[])
        : []),
      ...visibleFields.map((field): GridColumn => ({
        key: `field:${field.id}`,
        label: field.name,
        kind: 'field',
        editable: field.fieldType !== 'measurement' && !calculatedFieldTypeSet.has(field.fieldType),
        field,
      })),
    ],
    [t, visibleFields, workspaceMode],
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
  const virtualizeGrid = activeViewType === 'grid' && records.items.length > 80;
  const virtualStart = virtualizeGrid
    ? Math.max(0, Math.floor(gridScrollTop / virtualRowHeight) - 10)
    : 0;
  const virtualEnd = virtualizeGrid
    ? Math.min(records.items.length, virtualStart + Math.ceil(720 / virtualRowHeight) + 20)
    : records.items.length;
  const virtualRecords = records.items.slice(virtualStart, virtualEnd);
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
      if (!routeObjectTypeId && !search.get('type') && result.items[0])
        selectDataLocation(result.items[0].publicId ?? result.items[0].id, 'all', true);
      setMessage('');
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Object types could not be loaded.');
    } finally {
      setTypesLoading(false);
    }
  }, [base, routeObjectTypeId, search, selectDataLocation]);

  useEffect(() => void loadTypes(), [loadTypes]);

  const loadDataContext = useCallback(async () => {
    const requestId = ++dataContextRequestId.current;
    if (!selectedId) {
      setFields([]);
      setViews([]);
      setContextObjectTypeId('');
      setViewsLoading(false);
      return;
    }
    setViewsLoading(true);
    try {
      const [fieldResult, viewResult] = await Promise.all([
        api<{ items: FieldDefinition[] }>(`${base}/object-types/${selectedId}/fields`),
        api<{ items: RecordView[] }>(`${base}/object-types/${selectedId}/views`),
      ]);
      if (requestId === dataContextRequestId.current) {
        setFields(fieldResult.items);
        setViews(viewResult.items);
        setContextObjectTypeId(selectedId);
      }
    } catch (cause) {
      if (requestId === dataContextRequestId.current) {
        setMessageTone('error');
        setMessage(cause instanceof Error ? cause.message : 'Table context could not be loaded.');
      }
    } finally {
      if (requestId === dataContextRequestId.current) setViewsLoading(false);
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
    selectDataLocation(selectedPublicId, 'all', true);
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
      selectDataLocation(created.publicId ?? created.id);
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Object type creation failed.');
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
      setMessage(`Table “${updated.pluralName}” updated.`);
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Table could not be updated.');
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
      setMessage(`${created.name} field created.`);
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Field creation failed.');
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
      setMessage(`${updated.name} field updated.`);
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Field update failed.');
    } finally {
      setSchemaBusy(false);
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
      return (
        workspaceData?.projects.find((project) => project.id === record.contextProjectId)?.name ??
        ''
      );
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
    if (!gridSelection || clipboardBusy || !allowed(user, 'record.update')) return;
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
                  ? (workspaceData?.projects.find(
                      (project) =>
                        project.id === target.value.trim() ||
                        project.name.toLowerCase() === target.value.trim().toLowerCase(),
                    )?.id ??
                      (() => {
                        throw new Error(`Project “${target.value.trim()}” was not found.`);
                      })())
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
    if (!gridSelection || !allowed(user, 'record.update')) return;
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

  function confirmDiscardViewChanges() {
    return (
      !viewDirty ||
      window.confirm('Discard unsaved changes to this shared view? This cannot be undone.')
    );
  }

  function chooseObjectType(objectTypeId: string) {
    if (objectTypeId === selectedId || !confirmDiscardViewChanges()) return;
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
    if (viewId === selectedViewId || (!force && !confirmDiscardViewChanges())) return;
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
      setMessage('Order saved.');
      setLayoutAnnouncement('Order saved.');
    } catch (error) {
      setFields(previous);
      setFieldOrderIds(previousOrder);
      setMessageTone('error');
      setMessage(error instanceof ApiError ? error.message : 'Could not reorder columns.');
    } finally {
      setSchemaBusy(false);
      setSchemaDraggedFieldId('');
      setSchemaDragTargetId('');
    }
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
      const createdViewId = created.publicId ?? created.id;
      pendingViewId.current = createdViewId;
      appliedViewKey.current = `${selectedId}:${created.id}:${created.rowVersion}:${fields.map((field) => field.id).join(',')}`;
      setViews((current) =>
        [...current, created].sort((left, right) => left.name.localeCompare(right.name)),
      );
      setShowCreateView(false);
      setNewViewType('grid');
      form.reset();
      selectDataLocation(selectedPublicId, createdViewId);
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
      chooseView(created.publicId ?? created.id);
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
      if (selectedView?.id === target.id) chooseView('all', true);
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

  async function copyContextValue(label: string, value: string) {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard is unavailable.');
      await navigator.clipboard.writeText(value);
      setMessageTone('success');
      setMessage(`${label} copied.`);
    } catch {
      setMessageTone('error');
      setMessage('Clipboard access was denied by the browser.');
    }
  }

  async function archiveRecord(record: DynamicRecord) {
    if (!window.confirm(`Archive “${record.displayName}”? History is preserved.`)) return;
    try {
      await api(`${base}/object-types/${record.objectTypeId}/records/${record.id}/archive`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Archived from record context menu' }),
      });
      setSelectedRows((current) => {
        const next = new Set(current);
        next.delete(record.id);
        return next;
      });
      if (selectedRecord?.id === record.id) setSelectedRecord(undefined);
      setMessageTone('success');
      setMessage(`“${record.displayName}” archived.`);
      await loadRecords();
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Record could not be archived.');
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
        onSelect: () =>
          setSelectedRows((current) => {
            const next = new Set(current);
            if (next.has(record.id)) next.delete(record.id);
            else next.add(record.id);
            return next;
          }),
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
      ...(allowed(user, 'record.archive')
        ? [
            {
              label: 'Archive record',
              icon: '×',
              tone: 'danger' as const,
              separatorBefore: true,
              onSelect: () => void archiveRecord(record),
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
    return [
      {
        label: 'Open view',
        icon: '↗',
        onSelect: () => chooseView(view.publicId ?? view.id),
      },
      ...(allowed(user, 'schema.manage')
        ? [
            {
              label: 'Rename view',
              icon: '✎',
              disabled: viewBusy,
              onSelect: () => void renameView(view),
            },
            {
              label: 'Duplicate view',
              icon: '⧉',
              disabled: viewBusy,
              onSelect: () => void duplicateView(view),
            },
            {
              label: 'Archive view',
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
                                  <span className="truncate">{view.name}</span>
                                </span>
                              </button>
                              {allowed(user, 'schema.manage') && (
                                <details className="relative -ml-6" data-popover-menu>
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
                <HelpTip label="Table controls help">
                  Drag to resize or reorder columns. Select cell ranges to copy or paste, and
                  right-click for more actions.
                </HelpTip>
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
                {allowed(user, 'schema.manage') && (
                  <Button
                    aria-expanded={showTableSettings}
                    className="data-secondary-action"
                    variant="quiet"
                    onClick={() => setShowTableSettings((value) => !value)}
                  >
                    {t('data.editTable')}
                  </Button>
                )}
                {allowed(user, 'schema.manage') && (
                  <Button
                    aria-expanded={showSchema}
                    className="data-secondary-action"
                    variant="quiet"
                    onClick={() => {
                      const next = !showSchema;
                      setShowSchema(next);
                      if (next) setSchemaSelection(fields[0]?.id ?? 'new');
                    }}
                  >
                    {t('data.schema')}
                  </Button>
                )}
                {allowed(user, 'export.execute') && (
                  <Button
                    className="data-secondary-action"
                    variant="quiet"
                    onClick={() => void exportCsv()}
                  >
                    {t('data.exportCsv')}
                  </Button>
                )}
                {allowed(user, 'record.create') && (
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
                {allowed(user, 'record.create') && (
                  <details className="group relative" data-popover-menu>
                    <summary
                      aria-label="More table actions"
                      className="grid size-9 cursor-pointer list-none place-items-center rounded-lg border border-slate-800 bg-slate-900/75 text-base text-slate-500 shadow-sm marker:content-none hover:border-slate-700 hover:bg-slate-800 hover:text-slate-200"
                      title="More table actions"
                    >
                      ⋯
                    </summary>
                    <div className="absolute right-0 top-10 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-700 bg-slate-950 p-4 shadow-2xl shadow-black/40">
                      <h3 className="text-sm font-semibold text-slate-200">Import CSV</h3>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">
                        Use displayName and stable field keys as headers. Relations use
                        semicolon-separated record UUIDs.
                      </p>
                      <form className="mt-3" onSubmit={(event) => void importCsv(event)}>
                        <input
                          accept=".csv,text/csv"
                          className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-xs file:font-medium file:text-slate-200 hover:file:bg-slate-700"
                          name="csv"
                          required
                          type="file"
                        />
                        <Button className="mt-3 w-full" variant="quiet" type="submit">
                          Import records
                        </Button>
                      </form>
                      {csvResult && (
                        <p className="mt-3 text-xs text-slate-300">
                          Imported {csvResult.imported}; {csvResult.failed} failed.
                        </p>
                      )}
                      {csvResult?.errors.map((error) => (
                        <p
                          className="mt-1 text-xs text-rose-300"
                          key={`${error.row}:${error.reason}`}
                        >
                          Row {error.row}: {error.reason}
                        </p>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>

            {showTableSettings && allowed(user, 'schema.manage') && (
              <form
                className="mt-3 rounded-xl border border-sky-800/40 bg-slate-900/65 p-4"
                key={selected.id}
                onSubmit={(event) => void updateObjectType(event)}
              >
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className={fieldLabelClass}>
                    {t('data.typeName')}
                    <input
                      className={inputClass}
                      defaultValue={selected.name}
                      name="name"
                      required
                    />
                  </label>
                  <label className={fieldLabelClass}>
                    {t('data.tableLabel')}
                    <input
                      className={inputClass}
                      defaultValue={selected.pluralName}
                      name="pluralName"
                      required
                    />
                  </label>
                  <label className={fieldLabelClass}>
                    {t('data.stableKey')}
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
                        Template table keys are protected.
                      </span>
                    )}
                  </label>
                  <label className={fieldLabelClass}>
                    {t('data.tableDescription')}
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
                    Cancel
                  </button>
                </div>
              </form>
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
                        Schema editor
                      </h3>
                      <HelpTip label="Schema editor help">
                        Drag fields to set their shared order. Status dots show whether searchable
                        projections are ready.
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
                    aria-label="Close schema editor"
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
                          aria-label="Search fields"
                          className={`${inputClass} pl-7`}
                          placeholder="Search fields"
                          type="search"
                          value={schemaSearch}
                          onChange={(event) => setSchemaSearch(event.target.value)}
                        />
                      </div>
                      <Button
                        aria-label="Add field"
                        className="shrink-0"
                        variant="quiet"
                        onClick={beginNewSchemaField}
                        type="button"
                      >
                        + Add
                      </Button>
                    </div>

                    <div
                      aria-label="Field definitions"
                      className="mt-2 overflow-y-auto pr-1"
                      role="list"
                      style={{ maxHeight: '16rem' }}
                    >
                      {filteredSchemaFields.map((field) => {
                        const meta = fieldMeta(field);
                        const active = schemaSelection === field.id;
                        return (
                          <div
                            aria-label={`Field ${field.name}`}
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
                              aria-label={`Reorder field ${field.name}`}
                              className="shrink-0 cursor-grab rounded px-0.5 py-1 text-sm leading-none text-slate-600 hover:bg-slate-800 hover:text-sky-300 active:cursor-grabbing"
                              disabled={schemaBusy || Boolean(schemaSearch.trim())}
                              draggable={!schemaBusy && !schemaSearch.trim()}
                              title={
                                schemaSearch.trim()
                                  ? 'Clear search to reorder fields.'
                                  : 'Drag to reorder. Arrow keys also work.'
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
                              aria-label={`Edit field ${field.name}`}
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
                                      aria-label="Required"
                                      className="text-[10px] text-amber-300"
                                    >
                                      *
                                    </span>
                                  )}
                                </span>
                                <span className="block truncate font-mono text-[9px] leading-tight text-slate-600">
                                  {field.key} · {meta.label}
                                </span>
                              </span>
                              <span
                                aria-label={`Projection ${field.projectionStatus}`}
                                className={`mt-1 size-1.5 shrink-0 rounded-full ${
                                  field.projectionStatus === 'ready'
                                    ? 'bg-emerald-400'
                                    : field.projectionStatus === 'failed'
                                      ? 'bg-rose-400'
                                      : 'animate-pulse bg-amber-400'
                                }`}
                                title={`Projection ${field.projectionStatus}`}
                              />
                            </button>
                          </div>
                        );
                      })}
                      {filteredSchemaFields.length === 0 && (
                        <div className="rounded-lg border border-dashed border-slate-800 px-4 py-8 text-center">
                          <p className="text-xs font-medium text-slate-400">No matching fields</p>
                          <p className="mt-1 text-[11px] text-slate-600">
                            Try a field name, key, or type.
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
                              New field
                            </p>
                            <h4 className="mt-1 text-base font-semibold text-slate-100">
                              Add a field
                            </h4>
                            <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-500">
                              Choose a data type first. Only the settings relevant to that type will
                              appear.
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
                            Field name
                            <input
                              aria-label="Field name"
                              autoFocus
                              className={`${inputClass} mt-1.5`}
                              maxLength={120}
                              name="name"
                              placeholder="e.g. Inspection status"
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
                            Stable field key
                            <input
                              aria-label="Stable field key"
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
                            <span className={fieldHintClass}>
                              Used by imports and API integrations; it cannot change later.
                            </span>
                          </label>
                          <label className={wideFieldLabelClass}>
                            Field type
                            <select
                              aria-label="Field type"
                              className={`${inputClass} mt-1.5`}
                              name="fieldType"
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
                                  <optgroup key={group} label={group}>
                                    {groupTypes.map((type) => (
                                      <option key={type} value={type}>
                                        {schemaFieldTypeMeta[type].label} —{' '}
                                        {schemaFieldTypeMeta[type].description}
                                      </option>
                                    ))}
                                  </optgroup>
                                );
                              })}
                            </select>
                          </label>
                          <label className={wideFieldLabelClass}>
                            Description <span className="font-normal text-slate-600">Optional</span>
                            <textarea
                              aria-label="Field description"
                              className={`${inputClass} mt-1.5 min-h-20 resize-y`}
                              maxLength={500}
                              name="description"
                              placeholder="Explain what belongs in this field."
                            />
                          </label>

                          {['single_select', 'multi_select'].includes(schemaFieldType) && (
                            <label className={wideFieldLabelClass}>
                              Options
                              <textarea
                                aria-label="Select options"
                                className={`${inputClass} mt-1.5 min-h-28 resize-y font-mono`}
                                name="options"
                                placeholder={'ready: Ready\nblocked: Blocked\napproved: Approved'}
                                required
                              />
                              <span className={fieldHintClass}>
                                One option per line. Use “stable-key: Display label” to preserve API
                                values.
                              </span>
                            </label>
                          )}

                          {schemaFieldType === 'relation' && (
                            <label className={wideFieldLabelClass}>
                              Related table
                              <select
                                aria-label="Related table"
                                className={`${inputClass} mt-1.5`}
                                defaultValue=""
                                name="targetObjectTypeId"
                                required
                              >
                                <option disabled value="">
                                  Select a table…
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
                                Dimension
                                <input
                                  aria-label="Engineering dimension"
                                  className={`${inputClass} mt-1.5`}
                                  name="dimension"
                                  placeholder="length"
                                  required
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                Canonical unit
                                <input
                                  aria-label="Canonical unit"
                                  className={`${inputClass} mt-1.5 font-mono`}
                                  name="canonicalUnit"
                                  placeholder="m"
                                  required
                                />
                              </label>
                              <label className={wideFieldLabelClass}>
                                Allowed units
                                <input
                                  aria-label="Allowed units"
                                  className={`${inputClass} mt-1.5 font-mono`}
                                  name="allowedUnits"
                                  placeholder="m, mm, μm"
                                  required
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                Display precision
                                <input
                                  aria-label="Display precision"
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
                                Paste an Excel range with X values in the first column and one or
                                more signal series in the remaining columns. The first row may
                                contain headers.
                              </div>
                              <label className={fieldLabelClass}>
                                X-axis label
                                <input
                                  aria-label="X-axis label"
                                  className={`${inputClass} mt-1.5`}
                                  defaultValue="Wavelength"
                                  name="xLabel"
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                X-axis unit
                                <input
                                  aria-label="X-axis unit"
                                  className={`${inputClass} mt-1.5 font-mono`}
                                  defaultValue="nm"
                                  name="xUnit"
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                Signal label
                                <input
                                  aria-label="Signal label"
                                  className={`${inputClass} mt-1.5`}
                                  defaultValue="Intensity"
                                  name="yLabel"
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                Signal unit
                                <input
                                  aria-label="Signal unit"
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
                                Treat the first pasted row as column headers
                              </label>
                              <p className="mt-1 pl-5 text-[10px] leading-relaxed text-slate-500">
                                Excel cells are stored as JSON columns and rows while preserving
                                numbers, booleans, text, and blanks.
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
                              Required value
                            </label>
                          )}
                          {schemaFieldType !== 'image' && fieldSupportsUnique(schemaFieldType) && (
                            <label className={checkboxLabelClass}>
                              <input className={checkboxClass} name="unique" type="checkbox" />
                              Unique values
                            </label>
                          )}
                          {schemaFieldType === 'relation' && (
                            <label className={checkboxLabelClass}>
                              <input className={checkboxClass} name="multiple" type="checkbox" />
                              Allow multiple records
                            </label>
                          )}
                          {records.total > 0 && (
                            <span className="text-[10px] text-slate-600">
                              Required becomes available after existing records are backfilled.
                            </span>
                          )}
                        </div>

                        <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-800 pt-4">
                          <button
                            className="rounded-md px-3 py-2 text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                            onClick={() => setShowSchema(false)}
                            type="button"
                          >
                            Cancel
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
                              {fieldMeta(selectedSchemaField).label} field
                            </p>
                            <h4 className="mt-1 text-base font-semibold text-slate-100">
                              Edit {selectedSchemaField.name}
                            </h4>
                            <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-500">
                              Update labels and validation without breaking existing API references.
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
                              Type
                            </p>
                            <p className="mt-1 text-xs text-slate-300">
                              {fieldMeta(selectedSchemaField).label}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-600">
                              Stable key
                            </p>
                            <p className="mt-1 truncate font-mono text-xs text-slate-300">
                              {selectedSchemaField.key}
                            </p>
                          </div>
                        </div>

                        <div className="mt-5 grid gap-4 sm:grid-cols-2">
                          <label className={wideFieldLabelClass}>
                            Field name
                            <input
                              aria-label="Field name"
                              className={`${inputClass} mt-1.5`}
                              defaultValue={selectedSchemaField.name}
                              maxLength={120}
                              name="name"
                              required
                            />
                          </label>
                          <label className={wideFieldLabelClass}>
                            Description <span className="font-normal text-slate-600">Optional</span>
                            <textarea
                              aria-label="Field description"
                              className={`${inputClass} mt-1.5 min-h-20 resize-y`}
                              defaultValue={selectedSchemaField.description}
                              maxLength={500}
                              name="description"
                              placeholder="Explain what belongs in this field."
                            />
                          </label>

                          {['single_select', 'multi_select'].includes(
                            selectedSchemaField.fieldType,
                          ) && (
                            <label className={wideFieldLabelClass}>
                              Options
                              <textarea
                                aria-label="Select options"
                                className={`${inputClass} mt-1.5 min-h-28 resize-y font-mono`}
                                defaultValue={(selectedSchemaField.config.options ?? [])
                                  .map((option) => `${option.key}: ${option.label}`)
                                  .join('\n')}
                                name="options"
                                required
                              />
                              <span className={fieldHintClass}>
                                Changing stable option keys can invalidate existing values. Prefer
                                editing labels only.
                              </span>
                            </label>
                          )}

                          {selectedSchemaField.fieldType === 'relation' && (
                            <>
                              <label className={wideFieldLabelClass}>
                                Related table
                                <select
                                  aria-label="Related table"
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
                                  The target is locked after creation to protect linked records.
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
                                Dimension
                                <input
                                  aria-label="Engineering dimension"
                                  className={`${inputClass} mt-1.5 opacity-70`}
                                  defaultValue={selectedSchemaField.config.dimension}
                                  name="dimension"
                                  readOnly
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                Canonical unit
                                <input
                                  aria-label="Canonical unit"
                                  className={`${inputClass} mt-1.5 font-mono opacity-70`}
                                  defaultValue={selectedSchemaField.config.canonicalUnit}
                                  name="canonicalUnit"
                                  readOnly
                                />
                              </label>
                              <label className={wideFieldLabelClass}>
                                Allowed units
                                <input
                                  aria-label="Allowed units"
                                  className={`${inputClass} mt-1.5 font-mono`}
                                  defaultValue={selectedSchemaField.config.allowedUnits?.join(', ')}
                                  name="allowedUnits"
                                  required
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                Display precision
                                <input
                                  aria-label="Display precision"
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
                                X-axis label
                                <input
                                  aria-label="X-axis label"
                                  className={`${inputClass} mt-1.5`}
                                  defaultValue={selectedSchemaField.config.xLabel}
                                  name="xLabel"
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                X-axis unit
                                <input
                                  aria-label="X-axis unit"
                                  className={`${inputClass} mt-1.5 font-mono`}
                                  defaultValue={selectedSchemaField.config.xUnit}
                                  name="xUnit"
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                Signal label
                                <input
                                  aria-label="Signal label"
                                  className={`${inputClass} mt-1.5`}
                                  defaultValue={selectedSchemaField.config.yLabel}
                                  name="yLabel"
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                Signal unit
                                <input
                                  aria-label="Signal unit"
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
                              Treat the first pasted row as column headers
                            </label>
                          )}

                          <label className={fieldLabelClass}>
                            Order
                            <input
                              aria-label="Field order"
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
                              Required value
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
                              Unique values
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
                              Allow multiple records
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
                          <p className="text-[10px] text-slate-600">
                            Type and stable key are protected after creation.
                          </p>
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
                    {viewDirty && (
                      <button
                        className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                        disabled={viewBusy}
                        onClick={() => applyViewConfig(selectedView.config)}
                        type="button"
                      >
                        Discard changes
                      </button>
                    )}
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
                  <select
                    aria-label="Project filter"
                    className="max-w-48 rounded-lg border border-transparent bg-transparent px-3 py-2 text-sm text-slate-300 outline-none hover:bg-slate-800 focus:border-sky-500"
                    value={contextProjectFilter}
                    onChange={(event) => {
                      setContextProjectFilter(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="all">
                      {locale === 'ko' ? '모든 프로젝트' : 'All projects'}
                    </option>
                    <option value="none">{t('data.noProject')}</option>
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
                            field.fieldType !== 'measurement' &&
                            field.fieldType !== 'range' &&
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
              aria-label={`${selected.pluralName} table. Scroll horizontally to view more columns.`}
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
              {recordsLoading && (
                <div className="space-y-3 p-5" aria-label="Loading records">
                  <div className={skeletonLineClass} />
                  <div className={skeletonLineClass} />
                  <div className={skeletonLineClass} />
                </div>
              )}
              {!recordsLoading && activeViewType === 'grid' && (
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
                              <span className="ml-2 truncate font-normal normal-case text-slate-600">
                                {fieldMeta(field).label}
                              </span>
                            </button>
                            <details className="relative shrink-0 normal-case" data-popover-menu>
                              <summary
                                aria-label={t('data.columnOptions', { column: field.name })}
                                className="grid size-7 cursor-pointer list-none place-items-center rounded text-base tracking-normal text-slate-500 marker:content-none hover:bg-slate-800 hover:text-slate-200"
                                role="button"
                              >
                                ⋮
                              </summary>
                              <div className="absolute right-0 top-8 z-50 grid w-52 gap-0.5 rounded-md border border-slate-700 bg-slate-950 p-1 text-xs font-normal tracking-normal text-slate-300 shadow-xl">
                                {![
                                  'relation',
                                  'multi_select',
                                  'measurement',
                                  'range',
                                  'formula',
                                  'lookup',
                                  'rollup',
                                ].includes(field.fieldType) && (
                                  <>
                                    <button
                                      aria-label={`Sort ${field.name} ascending`}
                                      className={compactMenuItemClass}
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
                                      className={compactMenuItemClass}
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
                                        className={compactMenuItemClass}
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
                                    className={compactMenuItemClass}
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
                                  className={compactMenuItemClass}
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
                      <th className="w-20 border-b border-slate-800 px-2.5 py-2">
                        {t('data.detail')}
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
                      return (
                        <tr
                          className={`${selectedRows.has(record.id) ? 'bg-sky-500/5' : 'bg-slate-950/30'} hover:bg-slate-900/40`}
                          key={record.id}
                          onContextMenu={(event) => openRecordContextMenu(event, record)}
                          onKeyDown={(event) => openRecordContextMenuFromKeyboard(event, record)}
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
                              {allowed(user, 'record.update') ? (
                                <select
                                  aria-label={`Project for ${record.displayName}`}
                                  className="min-h-7 w-full select-text rounded border border-transparent bg-transparent px-1.5 text-xs text-slate-300 outline-none hover:border-slate-700 focus:border-sky-400"
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
                                  editable={allowed(user, 'record.update')}
                                  label={field.name}
                                  recordName={record.displayName}
                                  value={recordGridValue(record, field)}
                                  onSave={(value) => saveGridCell(record, field, value)}
                                />
                              ) : allowed(user, 'record.update') &&
                                !calculatedFieldTypeSet.has(field.fieldType) ? (
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
                                  {displayFieldValue(field, recordGridValue(record, field))}
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
                      );
                    })}
                    {virtualEnd < records.items.length && (
                      <tr aria-hidden="true">
                        <td
                          colSpan={visibleFields.length + 4 + (workspaceMode ? 1 : 0)}
                          style={{ height: (records.items.length - virtualEnd) * virtualRowHeight }}
                        />
                      </tr>
                    )}
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
                            {locale === 'ko' ? '+ 레코드 추가' : '+ Add record'}
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
                  onContextMenu={openRecordContextMenu}
                  onContextMenuKeyDown={openRecordContextMenuFromKeyboard}
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
                      onContextMenu={openRecordContextMenu}
                      onContextMenuKeyDown={openRecordContextMenuFromKeyboard}
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
                {locale === 'ko'
                  ? `${t('data.records', { count: records.total })} · 페이지 ${records.page} / ${Math.max(1, Math.ceil(records.total / records.pageSize))}`
                  : `${records.total} records · page ${records.page} of ${Math.max(1, Math.ceil(records.total / records.pageSize))}`}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="quiet"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  {locale === 'ko' ? '이전' : 'Previous'}
                </Button>
                <Button
                  variant="quiet"
                  disabled={page * records.pageSize >= records.total}
                  onClick={() => setPage((value) => value + 1)}
                >
                  {locale === 'ko' ? '다음' : 'Next'}
                </Button>
              </div>
            </div>

            <SpecificationsPanel base={base} fields={fields} user={user} />
          </>
        )}
      </section>
      {showNewRecord && selected && allowed(user, 'record.create') && (
        <div className="fixed inset-0 z-[70] flex justify-end" role="presentation">
          <button
            aria-label="Close new record panel"
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
                  New record
                </h2>
              </div>
              <button
                aria-label="Close new record panel"
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
                <p className="mt-1 font-mono text-[10px] text-slate-600">
                  v{selectedRecord.rowVersion} · {selectedRecord.id}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!workspaceMode && (
                  <Link
                    className="rounded-lg px-3 py-2 text-sm text-sky-300 hover:bg-sky-500/10"
                    to={`${base}/data/${objectTypes.find((item) => item.id === selectedRecord.objectTypeId)?.publicId ?? selectedRecord.objectTypeId}/records/${selectedRecord.id}`}
                  >
                    Full record
                  </Link>
                )}
                <button
                  aria-label="Close quick record view"
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
                          : displayFieldValue(field, recordGridValue(selectedRecord, field))}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </aside>
        </div>
      )}
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(undefined)} />
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
      const [typeResult, fieldResult, recordResult] = await Promise.all([
        api<{ items: ObjectType[] }>(`${base}/object-types`),
        api<{ items: FieldDefinition[] }>(`${base}/object-types/${objectTypeId}/fields`),
        api<DynamicRecord>(`${base}/object-types/${objectTypeId}/records/${recordId}`),
      ]);
      setFields(fieldResult.items);
      setRecord(recordResult);
      setError('');
      const objectType = typeResult.items.find(
        (item) =>
          item.id === objectTypeId || item.publicId === canonicalTableIdentifier(objectTypeId),
      );
      if (objectType?.publicId && objectType.publicId !== objectTypeId) {
        void navigate(`${base}/data/${objectType.publicId}/records/${recordId}`, {
          replace: true,
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Record could not be loaded.');
    }
  }, [base, navigate, objectTypeId, recordId]);
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
      <section className={emptyPanelClass}>
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
                      : displayFieldValue(field, record.values[field.key])}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
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
        Close detail
      </button>
    </>
  );
}
