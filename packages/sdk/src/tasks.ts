import type { EngroveClient } from './client.js';
import { createIdempotencyKey } from './table.js';
import type { ApiResponse } from './types.js';
import type {
  EngroveTask,
  EngroveTaskDetail,
  ProjectReference,
  TaskBulkUpdateInput,
  TaskComment,
  TaskCommentInput,
  TaskCreateInput,
  TaskCreateResponse,
  TaskMoveInput,
  TaskPage,
  TaskQueryInput,
  TaskUpdateInput,
} from './task-types.js';

export interface TaskCreateOptions {
  idempotencyKey?: string;
}

export class EngroveTasks {
  private readonly path: string;

  constructor(
    private readonly client: EngroveClient,
    reference: ProjectReference,
  ) {
    this.path = `/api/v1/workspaces/${encodeURIComponent(reference.workspaceId)}/projects/${encodeURIComponent(reference.projectId)}/tasks`;
  }

  list(input: TaskQueryInput = {}): Promise<ApiResponse<TaskPage>> {
    return this.client.request(`${this.path}${taskQuery(input)}`);
  }

  async *pages(input: TaskQueryInput = {}): AsyncGenerator<TaskPage> {
    let offset = input.offset ?? 0;
    while (true) {
      const response = await this.list({ ...input, offset });
      yield response.data;
      const { items, pageInfo } = response.data;
      if (!pageInfo.hasNext || items.length === 0) return;
      offset = pageInfo.offset + items.length;
    }
  }

  async *all(input: TaskQueryInput = {}): AsyncGenerator<EngroveTask> {
    for await (const page of this.pages(input)) yield* page.items;
  }

  get(taskIdOrKey: string): Promise<ApiResponse<EngroveTaskDetail>> {
    return this.client.request(`${this.path}/${taskIdentifier(taskIdOrKey)}`);
  }

  create(
    input: TaskCreateInput,
    options: TaskCreateOptions = {},
  ): Promise<ApiResponse<TaskCreateResponse>> {
    return this.client.request(this.path, {
      method: 'POST',
      body: input,
      idempotencyKey: options.idempotencyKey ?? createIdempotencyKey('task-create'),
    });
  }

  update(taskIdOrKey: string, input: TaskUpdateInput): Promise<ApiResponse<EngroveTaskDetail>> {
    return this.client.request(`${this.path}/${taskIdentifier(taskIdOrKey)}`, {
      method: 'PATCH',
      body: input,
    });
  }

  move(taskIdOrKey: string, input: TaskMoveInput): Promise<ApiResponse<EngroveTaskDetail>> {
    return this.client.request(`${this.path}/${taskIdentifier(taskIdOrKey)}/move`, {
      method: 'POST',
      body: input,
    });
  }

  bulkUpdate(input: TaskBulkUpdateInput): Promise<ApiResponse<{ items: EngroveTask[] }>> {
    return this.client.request(`${this.path}/bulk-update`, {
      method: 'POST',
      body: input,
    });
  }

  comment(taskIdOrKey: string, input: TaskCommentInput): Promise<ApiResponse<TaskComment>> {
    return this.client.request(`${this.path}/${taskIdentifier(taskIdOrKey)}/comments`, {
      method: 'POST',
      body: input,
    });
  }

  watch(taskIdOrKey: string): Promise<ApiResponse<EngroveTaskDetail>> {
    return this.client.request(`${this.path}/${taskIdentifier(taskIdOrKey)}/watch`, {
      method: 'POST',
    });
  }

  unwatch(taskIdOrKey: string): Promise<ApiResponse<EngroveTaskDetail>> {
    return this.client.request(`${this.path}/${taskIdentifier(taskIdOrKey)}/unwatch`, {
      method: 'POST',
    });
  }

  archive(
    taskIdOrKey: string,
    input: { reason: string; rowVersion: number },
  ): Promise<ApiResponse<EngroveTaskDetail>> {
    return this.client.request(`${this.path}/${taskIdentifier(taskIdOrKey)}/archive`, {
      method: 'PATCH',
      body: input,
    });
  }

  restore(taskIdOrKey: string, rowVersion: number): Promise<ApiResponse<EngroveTaskDetail>> {
    return this.client.request(`${this.path}/${taskIdentifier(taskIdOrKey)}/restore`, {
      method: 'POST',
      body: { rowVersion },
    });
  }
}

function taskIdentifier(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError('taskIdOrKey must not be empty.');
  return encodeURIComponent(trimmed);
}

function taskQuery(input: TaskQueryInput): string {
  const query = new URLSearchParams();
  if (input.archiveState !== undefined) query.set('archiveState', input.archiveState);
  if (input.entityType !== undefined) query.set('entityType', input.entityType);
  if (input.entityId !== undefined) query.set('entityId', input.entityId);
  if (input.query !== undefined) query.set('query', input.query);
  if (input.assignee !== undefined) query.set('assignee', input.assignee);
  if (input.priority !== undefined) query.set('priority', input.priority);
  for (const status of input.statuses ?? []) query.append('status', status);
  for (const label of input.labels ?? []) query.append('label', label);
  if (input.hasDueDate !== undefined) query.set('hasDueDate', String(input.hasDueDate));
  if (input.sort !== undefined) query.set('sort', input.sort);
  if (input.direction !== undefined) query.set('direction', input.direction);
  if (input.limit !== undefined) query.set('limit', String(input.limit));
  if (input.offset !== undefined) query.set('offset', String(input.offset));
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}
