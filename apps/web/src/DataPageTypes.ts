export interface ObjectType {
  id: string;
  publicId?: string;
  projectId: string;
  name: string;
  pluralName: string;
  key: string;
  icon: string;
  description: string;
  system: boolean;
  recordPermissions?: {
    canCreate: boolean;
    canUpdate: boolean;
    canArchive: boolean;
  };
}

export type FieldType =
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

export interface FieldDefinition {
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
    xLabel?: string;
    xUnit?: string;
    yLabel?: string;
    yUnit?: string;
    firstRowHeader?: boolean;
    expression?: string;
    relationFieldId?: string;
    targetFieldId?: string;
    aggregation?: 'count' | 'sum' | 'average' | 'min' | 'max';
    mediaKind?: 'image';
  };
  defaultValue?: unknown;
  projectionStatus: 'ready' | 'rebuilding' | 'failed';
}

export interface DynamicRecord {
  id: string;
  objectTypeId: string;
  contextProjectId?: string | null;
  displayName: string;
  values: Record<string, unknown>;
  relations: Record<string, string[]>;
  relationLabels?: Record<string, RecordReference[]>;
  referenceLabels?: Record<string, RecordReference[]>;
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

export interface RecordReference {
  id: string;
  displayName: string;
  archivedAt: string | null;
}

export interface ProjectReference {
  id: string;
  publicId?: string;
  name: string;
  key: string;
  archivedAt: string | null;
}

export interface WorkspaceDataContext {
  workspaceId: string;
  backingProjectId: string;
  projects: ProjectReference[];
  legacyProjects?: Array<{ id: string; name: string }>;
}

export interface QueryResult {
  items: DynamicRecord[];
  page: number;
  pageSize: number;
  total: number;
  groups?: Array<{ value: string | null; count: number }>;
  groupHierarchy?: RecordGroupResult[];
  summaries?: RecordSummaryResult[];
}

export interface RecordGrouping {
  fieldId: string;
  direction: 'asc' | 'desc';
  enabled: boolean;
}

export interface RecordGroupResult {
  level: number;
  fieldId: string;
  path: Array<{ fieldId: string; value: string | null }>;
  count: number;
  summaries?: RecordSummaryResult[];
}

export type RecordSummaryOperation = 'count' | 'sum' | 'average' | 'min' | 'max';

export interface RecordSummaryRequest {
  fieldId: string;
  operation: RecordSummaryOperation;
}

export interface RecordSummaryResult extends RecordSummaryRequest {
  value: string | null;
  unit: string | null;
}

export type GridColumn =
  | { key: 'displayName'; label: string; kind: 'displayName'; editable: boolean }
  | { key: 'contextProject'; label: string; kind: 'contextProject'; editable: boolean }
  | {
      key: `field:${string}`;
      label: string;
      kind: 'field';
      editable: boolean;
      field: FieldDefinition;
    };

export interface GridCellAddress {
  rowId: string;
  columnKey: GridColumn['key'];
}

export interface GridSelection {
  anchor: GridCellAddress;
  focus: GridCellAddress;
}

export interface GridSelectionBounds {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
}

export type RecordViewType = 'grid' | 'form' | 'gallery' | 'kanban' | 'calendar';
export type RecordViewPermissionType = 'collaborative' | 'personal' | 'locked';

export interface RecordViewConfig {
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
  pageSize: 25 | 50 | 100 | 250 | 500;
  groupings?: RecordGrouping[];
  summaries?: RecordSummaryRequest[];
  viewOptions?: {
    groupFieldId?: string;
    dateFieldId?: string;
    contextProjectId?: string | null;
  };
}

export type SystemFieldWidthKey = 'displayName' | 'contextProject' | 'updatedAt';

export interface RecordView {
  id: string;
  publicId?: string;
  objectTypeId: string;
  name: string;
  viewType: RecordViewType;
  permissionType: RecordViewPermissionType;
  ownerId: string | null;
  lockReason: string | null;
  config: RecordViewConfig;
  rowVersion: number;
  createdBy: string;
  updatedBy: string;
  archivedAt: string | null;
  updatedAt: string;
}
export interface CsvResult {
  imported: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  createdIds: string[];
  updatedIds: string[];
  errors: Array<{ row: number; field?: string; reason: string }>;
  errorsTruncated: boolean;
  idempotentReplay: boolean;
}

export interface CsvImportPreview {
  headers: string[];
  totalRows: number;
  sampleRows: Array<Record<string, string>>;
  targetFields: Array<{
    key: string;
    name: string;
    fieldType: FieldType | 'display_name';
    required: boolean;
    unique: boolean;
    supported: boolean;
  }>;
  suggestedMappings: Array<{ sourceHeader: string; targetFieldKey: string | null }>;
}

export interface RecordExportJob {
  id: string;
  objectTypeId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'expired';
  progress: number;
  rowCount: number | null;
  fieldCount: number | null;
  sizeBytes: number | null;
  fileName: string;
  errorCode: string | null;
  retryable: boolean;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  downloadReady: boolean;
}

export interface BulkRecordFieldChange {
  fieldKey: string;
  operation: 'set' | 'clear';
  value?: unknown;
}

export interface MeasurementResult {
  id: string;
  field_id: string;
  canonical_value: string;
  canonical_unit: string;
  original_value: string;
  original_unit: string;
  measured_at: string;
  supersedes_result_id: string | null;
  current: boolean;
  evaluation: SpecificationEvaluation | null;
}

export interface Specification {
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

export interface SpecificationEvaluation {
  id: string;
  measurement_field_id: string;
  measurement_result_id: string | null;
  status: 'pass' | 'warning' | 'fail' | 'missing';
  reason_code: string;
  evaluated_at: string;
}

export interface LinkedTask {
  id: string;
  task_key: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  archived_at: string | null;
}

export interface RecordHistoryItem {
  id: string;
  action: string;
  actorName: string | null;
  createdAt: string;
  rowVersion: number | null;
  undoable: boolean;
}

export interface ReviewParticipant {
  id: string;
  displayName: string;
  email: string;
  role: string;
}

export interface RecordReviewMessage {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  mentionedUserIds: string[];
  mentionedUsers?: Array<{ id: string; displayName: string }>;
  createdAt: string;
}

export interface RecordReviewThread {
  id: string;
  subject: string;
  status: 'open' | 'resolved';
  reviewStatus: 'discussion' | 'requested' | 'approved' | 'changes_requested';
  reviewerId: string | null;
  reviewerName: string | null;
  createdBy: string;
  creatorName: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  messages: RecordReviewMessage[];
  messagePageInfo?: {
    limit: number;
    offset: number;
    total: number;
    hasNext: boolean;
  };
}
