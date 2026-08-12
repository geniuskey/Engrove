export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface RateLimitMetadata {
  limit?: number;
  remaining?: number;
  reset?: number;
  policy?: string;
}

export interface ApiResponse<T> {
  data: T;
  requestId?: string;
  etag?: string;
  rateLimit: RateLimitMetadata;
}

export interface FieldDefinition {
  id: string;
  projectId: string;
  objectTypeId: string;
  name: string;
  key: string;
  description: string;
  fieldType: string;
  required: boolean;
  unique: boolean;
  position: number;
  config: Record<string, JsonValue>;
  defaultValue?: JsonValue;
  system: boolean;
  projectionStatus: string;
  projectionVersion: number;
}

export interface MeasurementValue {
  resultId: string | null;
  value: string | null;
  unit: string | null;
  status: string | null;
}

export interface RecordReference {
  id: string;
  displayName: string;
  archivedAt: string | null;
}

export interface EngroveRecord<
  TValues extends Record<string, unknown> = Record<string, JsonValue>,
> {
  id: string;
  projectId: string;
  objectTypeId: string;
  contextProjectId: string | null;
  displayName: string;
  values: TValues;
  relations: Record<string, string[]>;
  relationLabels: Record<string, RecordReference[]>;
  referenceLabels: Record<string, RecordReference[]>;
  fileReferences: Record<string, string[]>;
  datasetReferences: Record<string, string[]>;
  measurements: Record<string, MeasurementValue>;
  rowVersion: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FilterOperator =
  'eq' | 'ne' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is_null';

export interface RecordFilter {
  fieldId: string;
  operator: FilterOperator;
  value?: JsonValue;
}

export type RecordSort =
  | { fieldId: string; direction: 'asc' | 'desc' }
  | {
      systemField: 'displayName' | 'createdAt' | 'updatedAt';
      direction: 'asc' | 'desc';
    };

export interface RecordQueryInput {
  fields?: string[];
  filters?: RecordFilter[];
  sorts?: RecordSort[];
  search?: string;
  contextProjectId?: string;
  groupByFieldId?: string;
  groupings?: Array<Record<string, JsonValue>>;
  summaries?: Array<Record<string, JsonValue>>;
  page?: number;
  pageSize?: number;
  includeArchived?: boolean;
  archiveState?: 'active' | 'archived' | 'all';
}

export interface RecordPage<TValues extends Record<string, unknown> = Record<string, JsonValue>> {
  items: Array<EngroveRecord<TValues>>;
  page: number;
  pageSize: number;
  total: number;
  groups?: JsonValue[];
  groupHierarchy?: JsonValue[];
  summaries?: JsonValue[];
}

export interface RecordCreateInput<
  TValues extends Record<string, unknown> = Record<string, JsonValue>,
> {
  displayName: string;
  contextProjectId?: string;
  values: TValues;
  relations?: Record<string, string[]>;
  fileReferences?: Record<string, string[]>;
  datasetReferences?: Record<string, string[]>;
}

export interface RecordUpdateInput<
  TValues extends Record<string, unknown> = Record<string, JsonValue>,
> extends Partial<RecordCreateInput<TValues>> {
  rowVersion: number;
}

export interface RecordVersionReference {
  id: string;
  rowVersion: number;
}

export interface BulkRecordCreateResponse {
  created: RecordVersionReference[];
  idempotentReplay: boolean;
}

export interface BulkRecordUpdateResponse {
  updated: RecordVersionReference[];
}

export interface BulkFieldUpdateInput {
  records: Array<{ id: string; rowVersion: number }>;
  changes: Array<{
    fieldKey: string;
    operation: 'set' | 'clear';
    value?: JsonValue;
  }>;
}

export interface RecordExportInput {
  fieldKeys?: string[];
  filters?: RecordFilter[];
  sorts?: RecordSort[];
  search?: string;
  contextProjectId?: string;
  archiveState?: 'active' | 'archived' | 'all';
}

export interface TableReference {
  workspaceId: string;
  projectId: string;
  tableId: string;
}
