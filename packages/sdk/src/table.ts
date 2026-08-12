import type { EngroveClient } from './client.js';
import type {
  ApiResponse,
  BulkFieldUpdateInput,
  BulkRecordCreateResponse,
  BulkRecordUpdateResponse,
  EngroveRecord,
  FieldDefinition,
  JsonValue,
  RecordCreateInput,
  RecordExportInput,
  RecordPage,
  RecordQueryInput,
  RecordUpdateInput,
  TableReference,
} from './types.js';

export interface IdempotentRequestOptions {
  idempotencyKey?: string;
}

export class EngroveTable<TValues extends Record<string, unknown> = Record<string, JsonValue>> {
  private readonly path: string;

  constructor(
    private readonly client: EngroveClient,
    reference: TableReference,
  ) {
    this.path = `/api/v1/workspaces/${encodeURIComponent(reference.workspaceId)}/projects/${encodeURIComponent(reference.projectId)}/object-types/${encodeURIComponent(reference.tableId)}`;
  }

  fields(): Promise<ApiResponse<{ items: FieldDefinition[] }>> {
    return this.client.request(`${this.path}/fields`);
  }

  query(input: RecordQueryInput = {}): Promise<ApiResponse<RecordPage<TValues>>> {
    return this.client.request(`${this.path}/records/query`, {
      method: 'POST',
      body: input,
      retry: 'safe',
    });
  }

  async *pages(input: RecordQueryInput = {}): AsyncGenerator<RecordPage<TValues>> {
    let page = input.page ?? 1;
    while (true) {
      const response = await this.query({ ...input, page });
      yield response.data;
      const { items, page: currentPage, pageSize, total } = response.data;
      if (items.length === 0 || currentPage * pageSize >= total) return;
      page = currentPage + 1;
    }
  }

  async *records(input: RecordQueryInput = {}): AsyncGenerator<EngroveRecord<TValues>> {
    for await (const page of this.pages(input)) {
      yield* page.items;
    }
  }

  create(input: RecordCreateInput<TValues>): Promise<ApiResponse<EngroveRecord<TValues>>> {
    return this.client.request(`${this.path}/records`, {
      method: 'POST',
      body: input,
    });
  }

  update(
    recordId: string,
    input: RecordUpdateInput<TValues>,
  ): Promise<ApiResponse<EngroveRecord<TValues>>> {
    return this.client.request(`${this.path}/records/${encodeURIComponent(recordId)}`, {
      method: 'PATCH',
      body: input,
    });
  }

  bulkCreate(
    items: Array<RecordCreateInput<TValues>>,
    options: IdempotentRequestOptions = {},
  ): Promise<ApiResponse<BulkRecordCreateResponse>> {
    return this.client.request(`${this.path}/records/bulk`, {
      method: 'POST',
      body: { items },
      idempotencyKey: options.idempotencyKey ?? createIdempotencyKey('bulk-create'),
    });
  }

  bulkUpdateFields(input: BulkFieldUpdateInput): Promise<ApiResponse<BulkRecordUpdateResponse>> {
    return this.client.request(`${this.path}/records/bulk/fields`, {
      method: 'PATCH',
      body: input,
    });
  }

  archive(recordId: string, reason: string): Promise<ApiResponse<EngroveRecord<TValues>>> {
    return this.client.request(`${this.path}/records/${encodeURIComponent(recordId)}/archive`, {
      method: 'POST',
      body: { reason },
    });
  }

  restore(recordId: string): Promise<ApiResponse<EngroveRecord<TValues>>> {
    return this.client.request(`${this.path}/records/${encodeURIComponent(recordId)}/restore`, {
      method: 'POST',
    });
  }

  exportCsv(input: RecordExportInput = {}): Promise<ApiResponse<string>> {
    return this.client.request(`${this.path}/records/export.csv`, {
      method: 'POST',
      body: input,
      responseType: 'text',
      retry: 'safe',
    });
  }
}

export function createIdempotencyKey(prefix = 'engrove-sdk'): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 64) || 'engrove-sdk';
  return `${safePrefix}-${crypto.randomUUID()}`;
}
