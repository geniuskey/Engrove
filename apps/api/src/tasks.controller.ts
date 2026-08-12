import {
  resolveProjectIdentifier,
  resolveWorkspaceIdentifier,
  ScopedTaskRepository,
  type TaskEntityType,
  type TaskLinkInput,
} from '@engrove/database';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { requestId, requireActor } from './community.controller.js';
import { ApiZodBody, openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const id = z.string().uuid();
const taskIdentifier = z
  .string()
  .trim()
  .max(64)
  .refine(
    (value) =>
      id.safeParse(value).success || /^[A-Za-z][A-Za-z0-9_-]{1,15}-[1-9][0-9]*$/.test(value),
    'Expected a task UUID or project task key such as FORCE-6.',
  );
const status = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const priority = z.enum(['low', 'medium', 'high', 'critical']);
const taskVisibility = z.enum(['project', 'restricted']);
const taskLabel = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,39}$/u);
const taskLabels = z.array(taskLabel).max(12);
const entityType = z.enum([
  'record',
  'sample',
  'issue',
  'test_run',
  'measurement_result',
  'specification_evaluation',
  'dataset',
  'external_source',
  'file',
]);
const link = z.object({ entityType, entityId: id }).strict();
const fileLinkInput = z.object({ fileId: id }).strict();
const httpUrl = z
  .url()
  .max(2_048)
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'Only HTTP and HTTPS evidence URLs are supported.',
  });
const externalLinkInput = z
  .object({
    title: z.string().trim().min(1).max(240),
    url: httpUrl,
    provider: z.string().trim().max(120).optional(),
    externalId: z.string().trim().max(500).default(''),
    version: z.string().trim().max(240).default(''),
    observedOn: z.iso.date().optional(),
    notes: z.string().trim().max(10_000).default(''),
  })
  .strict();
const baseInput = {
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(10_000).default(''),
  priority: priority.default('medium'),
  assigneeId: id.optional(),
  dueDate: z.iso.date().optional(),
  originalEstimateMinutes: z.number().int().min(0).max(5_256_000).nullable().optional(),
  remainingEstimateMinutes: z.number().int().min(0).max(5_256_000).nullable().optional(),
};
const createInput = z
  .object({
    ...baseInput,
    status: status.optional(),
    visibility: taskVisibility.default('project'),
    labels: taskLabels.default([]),
    parentTaskId: id.optional(),
    cloneSourceTaskId: id.optional(),
    links: z.array(link).max(30).default([]),
  })
  .strict();
const idempotencyKey = z.string().min(8).max(200);
const updateInput = z
  .object({
    ...baseInput,
    status,
    labels: taskLabels.optional(),
    parentTaskId: id.nullable().optional(),
    rowVersion: z.number().int().positive(),
  })
  .strict();
const commentInput = z
  .object({
    body: z.string().trim().min(1).max(10_000),
    mentionedUserIds: z.array(id).max(20).default([]),
    watch: z.boolean().optional(),
  })
  .strict();
const commentEditInput = z
  .object({
    body: z.string().trim().min(1).max(10_000),
    mentionedUserIds: z.array(id).max(20).default([]),
    rowVersion: z.number().int().positive(),
  })
  .strict();
const relationshipInput = z
  .object({
    relatedTaskId: id,
    type: z.enum(['blocks', 'blocked_by', 'relates_to']),
  })
  .strict();
const archiveInput = z
  .object({
    reason: z.string().trim().min(1).max(2_000),
    rowVersion: z.number().int().positive(),
  })
  .strict();
const restoreInput = z.object({ rowVersion: z.number().int().positive() }).strict();
const taskListColumn = z.enum(['title', 'status', 'priority', 'assignee', 'dueDate']);
const defaultTaskListColumns = taskListColumn.options;
const savedFilterConfig = z
  .object({
    query: z.string().max(240).default(''),
    assignee: z
      .union([z.literal('all'), z.literal('mine'), z.literal('unassigned'), id])
      .default('all'),
    priority: z.union([z.literal('all'), priority]).default('all'),
    statuses: z
      .array(status)
      .max(40)
      .refine((values) => new Set(values).size === values.length, 'Statuses must be unique.')
      .default([]),
    labels: taskLabels.default([]),
    view: z.enum(['board', 'list', 'calendar']).default('board'),
    sort: z.enum(['rank', 'title', 'status', 'priority', 'assignee', 'dueDate']).default('rank'),
    direction: z.enum(['asc', 'desc']).default('asc'),
    group: z.enum(['none', 'status', 'priority', 'assignee']).default('none'),
    listColumns: z
      .array(taskListColumn)
      .min(1)
      .max(defaultTaskListColumns.length)
      .refine(
        (columns) => columns[0] === 'title' && new Set(columns).size === columns.length,
        'Task list columns must be unique and begin with title.',
      )
      .default(defaultTaskListColumns),
  })
  .strict();
const savedFilterInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    visibility: z.enum(['personal', 'project']).default('personal'),
    config: savedFilterConfig,
  })
  .strict();
const savedFilterResponse = z.object({
  id,
  owner_id: id,
  owner_name: z.string(),
  name: z.string(),
  visibility: z.enum(['personal', 'project']),
  config: savedFilterConfig,
  favorite: z.boolean(),
  is_owner: z.boolean(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
const savedFilterPageInput = z
  .object({
    query: z.string().trim().max(200).default(''),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
const savedFilterPageInfoResponse = z.object({
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  hasNext: z.boolean(),
});
const savedFilterListResponse = z.object({
  items: z.array(savedFilterResponse).max(100),
  pageInfo: savedFilterPageInfoResponse,
});
const savedFilterFavoriteInput = z.object({ favorite: z.boolean() }).strict();
const bulkUpdateInput = z
  .object({
    items: z
      .array(z.object({ id, rowVersion: z.number().int().positive() }).strict())
      .min(1)
      .max(100)
      .refine((items) => new Set(items.map((item) => item.id)).size === items.length, {
        message: 'Task IDs must be unique.',
      }),
    changes: z
      .object({
        status: status.optional(),
        priority: priority.optional(),
        assigneeId: id.nullable().optional(),
      })
      .strict()
      .refine((changes) => Object.values(changes).some((value) => value !== undefined), {
        message: 'At least one change is required.',
      }),
  })
  .strict();
const moveInput = z
  .object({
    status,
    beforeTaskId: id.nullable().optional(),
    placement: z.enum(['top', 'bottom']).optional(),
    rowVersion: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.beforeTaskId && value.placement)
      context.addIssue({
        code: 'custom',
        path: ['placement'],
        message: 'Choose either beforeTaskId or placement, not both.',
      });
  });
const taskListInput = z
  .object({
    includeArchived: z.enum(['true', 'false']).default('false'),
    archiveState: z.enum(['active', 'all', 'archived']).optional(),
    entityType: entityType.optional(),
    entityId: id.optional(),
    query: z.string().trim().max(240).optional(),
    assignee: z.union([z.literal('mine'), z.literal('unassigned'), id]).optional(),
    priority: priority.optional(),
    status: z.union([status, z.array(status).min(1).max(40)]).optional(),
    label: z.union([taskLabel, taskLabels]).optional(),
    hasDueDate: z.enum(['true', 'false']).default('false'),
    sort: z.enum(['rank', 'title', 'status', 'priority', 'assignee', 'dueDate']).default('rank'),
    direction: z.enum(['asc', 'desc']).default('asc'),
    limit: z.coerce.number().int().min(1).max(100).default(100),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
const activityPageInput = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
const commentRevisionPageInput = activityPageInput.extend({
  limit: activityPageInput.shape.limit.default(20),
});
const worklogPageInput = activityPageInput.extend({
  limit: activityPageInput.shape.limit.default(20),
});
const remainingEstimateMode = z.enum(['auto', 'set', 'unchanged']);
const worklogBaseInput = z
  .object({
    durationMinutes: z.number().int().min(1).max(525_600),
    startedAt: z.iso.datetime({ offset: true }),
    note: z.string().trim().max(2_000).default(''),
    remainingEstimateMode: remainingEstimateMode.default('auto'),
    remainingEstimateMinutes: z.number().int().min(0).max(5_256_000).optional(),
    taskRowVersion: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.remainingEstimateMode === 'set' && value.remainingEstimateMinutes === undefined)
      context.addIssue({
        code: 'custom',
        path: ['remainingEstimateMinutes'],
        message: 'Remaining estimate is required in set mode.',
      });
    if (value.remainingEstimateMode !== 'set' && value.remainingEstimateMinutes !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['remainingEstimateMinutes'],
        message: 'Remaining estimate is accepted only in set mode.',
      });
  });
const worklogUpdateInput = worklogBaseInput.safeExtend({
  worklogRowVersion: z.number().int().positive(),
});
const worklogDeleteInput = z
  .object({
    remainingEstimateMode: remainingEstimateMode.default('auto'),
    remainingEstimateMinutes: z.number().int().min(0).max(5_256_000).optional(),
    taskRowVersion: z.number().int().positive(),
    worklogRowVersion: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.remainingEstimateMode === 'set' && value.remainingEstimateMinutes === undefined)
      context.addIssue({
        code: 'custom',
        path: ['remainingEstimateMinutes'],
        message: 'Remaining estimate is required in set mode.',
      });
    if (value.remainingEstimateMode !== 'set' && value.remainingEstimateMinutes !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['remainingEstimateMinutes'],
        message: 'Remaining estimate is accepted only in set mode.',
      });
  });
const pageInfoResponse = z.object({
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  hasNext: z.boolean(),
});
const assigneePageInput = z
  .object({
    query: z.string().trim().max(200).default(''),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
const taskAssigneeResponse = z.object({
  id,
  displayName: z.string(),
  email: z.string().email(),
});
const assigneePageResponse = z.object({
  items: z.array(taskAssigneeResponse).max(100),
  pageInfo: pageInfoResponse,
  overallTotal: z.number().int().nonnegative(),
});
const taskVisibilityInput = z
  .object({
    visibility: taskVisibility,
    userIds: z.array(id).max(100).default([]),
    groupIds: z.array(id).max(100).default([]),
    rowVersion: z.number().int().positive(),
  })
  .strict();
const taskVisibilityResponse = z.object({
  visibility: taskVisibility,
  rowVersion: z.number().int().positive(),
  members: z.array(z.object({ id, displayName: z.string(), email: z.string().email() })).max(100),
  groups: z.array(z.object({ id, name: z.string(), color: z.string() })).max(100),
});
const taskVisibilityGroupsResponse = z.object({
  items: z.array(z.object({ id, name: z.string(), color: z.string() })).max(100),
});

const taskLinkResponse = z.object({
  id,
  entity_type: entityType,
  entity_id: id,
  created_at: z.string(),
  title: z.string().nullable().optional(),
  detail: z.string().nullable().optional(),
  object_type_public_id: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  external_id: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  observed_on: z.string().nullable().optional(),
  archived_at: z.string().nullable().optional(),
  original_name: z.string().nullable().optional(),
  content_type: z.string().nullable().optional(),
  size_bytes: z.number().nonnegative().nullable().optional(),
  file_series_name: z.string().nullable().optional(),
  file_version_number: z.number().int().positive().nullable().optional(),
  file_status: z.string().nullable().optional(),
});
const taskResponse = z
  .object({
    id,
    project_id: id,
    task_number: z.number().int().positive(),
    task_key: z.string(),
    title: z.string(),
    description: z.string(),
    status,
    status_category: z.enum(['todo', 'in_progress', 'done']),
    priority,
    visibility: taskVisibility,
    labels: taskLabels,
    parent_task_id: id.nullable(),
    parent_task_key: z.string().nullable(),
    parent_task_title: z.string().nullable(),
    child_count: z.number().int().nonnegative(),
    child_done_count: z.number().int().nonnegative(),
    board_position: z.number().int().nonnegative(),
    assignee_id: id.nullable(),
    assignee_name: z.string().nullable(),
    due_date: z.iso.date().nullable(),
    original_estimate_minutes: z.number().int().nonnegative().nullable(),
    remaining_estimate_minutes: z.number().int().nonnegative().nullable(),
    time_spent_minutes: z.number().int().nonnegative(),
    row_version: z.number().int().positive(),
    open_blocker_count: z.number().int().nonnegative(),
    archived_at: z.string().nullable(),
    created_by: id,
    created_by_name: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    links: z.array(taskLinkResponse).optional(),
  })
  .passthrough();
const taskStatusHistoryResponse = z.object({
  id,
  from_status: status.nullable(),
  to_status: status,
  changed_by: id,
  changed_by_name: z.string(),
  changed_at: z.string(),
});
const taskCommentResponse = z.object({
  id,
  body: z.string(),
  author_id: id,
  author_name: z.string(),
  mentions: z.array(z.object({ id, displayName: z.string() })),
  row_version: z.number().int().positive(),
  revisions: z.array(
    z.object({
      revision: z.number().int().positive(),
      body: z.string(),
      mentions: z.array(z.object({ id, displayName: z.string() })),
      edited_by_name: z.string(),
      edited_at: z.string(),
    }),
  ),
  revision_count: z.number().int().nonnegative(),
  edited_at: z.string().nullable(),
  created_at: z.string(),
});
const taskRelationshipResponse = z.object({
  id,
  relation_type: z.enum(['blocks', 'relates_to']),
  direction: z.enum(['outward', 'inward']),
  related_task_id: id,
  related_task_key: z.string(),
  related_task_title: z.string(),
  related_task_status: status,
  related_task_archived_at: z.string().nullable(),
  created_at: z.string(),
});
const taskChangeResponse = z.object({
  id,
  action: z.enum(['task.updated', 'task.automated']),
  changed_by_name: z.string(),
  changed_at: z.string(),
  automation_rule_name: z.string().nullable(),
  changes: z.array(
    z.object({
      field: z.enum([
        'title',
        'description',
        'priority',
        'assigneeId',
        'dueDate',
        'labels',
        'parentTaskId',
        'originalEstimateMinutes',
        'remainingEstimateMinutes',
      ]),
      from: z.string().nullable(),
      to: z.string().nullable(),
      changed: z.boolean(),
    }),
  ),
});
const taskLinkActivityResponse = z.object({
  id,
  action: z.enum(['task.link_added', 'task.link_removed']),
  changed_by_name: z.string(),
  changed_at: z.string(),
  link_id: z.string(),
  entity_type: entityType,
  entity_id: z.string(),
  title: z.string().nullable(),
  url: z.string().nullable(),
});
const taskActivityResponse = z.object({
  status_history: z.array(taskStatusHistoryResponse),
  comments: z.array(taskCommentResponse),
  change_history: z.array(taskChangeResponse),
  link_history: z.array(taskLinkActivityResponse),
  pageInfo: pageInfoResponse,
});
const taskCommentRevisionResponse = taskCommentResponse.shape.revisions.element;
const taskWorklogResponse = z.object({
  id,
  duration_minutes: z.number().int().positive(),
  started_at: z.iso.datetime(),
  note: z.string(),
  author_id: id,
  author_name: z.string(),
  remaining_estimate_before: z.number().int().nonnegative().nullable(),
  remaining_estimate_after: z.number().int().nonnegative().nullable(),
  row_version: z.number().int().positive(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  can_edit: z.boolean(),
});
const taskWorklogPageResponse = z.object({
  items: z.array(taskWorklogResponse).max(100),
  pageInfo: pageInfoResponse,
});
const taskCommentRevisionPageResponse = z.object({
  items: z.array(taskCommentRevisionResponse),
  pageInfo: pageInfoResponse,
});
const taskDetailResponse = taskResponse
  .extend({
    relationships: z.array(taskRelationshipResponse),
    comments: z.array(taskCommentResponse),
    watchers: z.array(z.object({ user_id: id, display_name: z.string() })),
    status_history: z.array(taskStatusHistoryResponse),
    change_history: z.array(taskChangeResponse),
    link_history: z.array(taskLinkActivityResponse),
    activity_page_info: pageInfoResponse,
    worklogs: z.array(taskWorklogResponse).max(20),
    worklog_page_info: pageInfoResponse,
    watcher_count: z.number().int().nonnegative(),
    watching: z.boolean(),
    children: z.array(
      z.object({
        id,
        task_key: z.string(),
        title: z.string(),
        status,
        status_category: z.enum(['todo', 'in_progress', 'done']),
        assignee_id: id.nullable(),
        assignee_name: z.string().nullable(),
        due_date: z.iso.date().nullable(),
        archived_at: z.string().nullable(),
      }),
    ),
    linked_key_dates: z.array(
      z.object({
        id,
        title: z.string(),
        status: z.enum(['planned', 'active', 'at_risk', 'completed']),
        target_date: z.iso.date(),
        archived_at: z.string().nullable(),
      }),
    ),
  })
  .passthrough();
const taskCreateResponse = taskDetailResponse.extend({ idempotent_replay: z.boolean() });
const taskListResponse = z.object({
  items: z.array(taskResponse).max(100),
  pageInfo: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    hasNext: z.boolean(),
  }),
});
const taskFlowInsightsResponse = z.object({
  calculated_at: z.iso.datetime(),
  window_days: z.number().int().min(7).max(365),
  stale_after_days: z.number().int().min(1).max(90),
  summary: z.object({
    active_count: z.number().int().nonnegative(),
    wip_count: z.number().int().nonnegative(),
    stale_count: z.number().int().nonnegative(),
    completed_count: z.number().int().nonnegative(),
    average_cycle_hours: z.number().nonnegative().nullable(),
    median_cycle_hours: z.number().nonnegative().nullable(),
    p85_cycle_hours: z.number().nonnegative().nullable(),
  }),
  statuses: z.array(
    z.object({
      key: status,
      name: z.string(),
      category: z.enum(['todo', 'in_progress', 'done']),
      color: z.enum(['slate', 'sky', 'violet', 'amber', 'rose', 'emerald']),
      position: z.number().int().nonnegative(),
      current_count: z.number().int().nonnegative(),
      wip_limit: z.number().int().positive().nullable(),
      average_age_hours: z.number().nonnegative().nullable(),
      oldest_age_hours: z.number().nonnegative().nullable(),
      stale_count: z.number().int().nonnegative(),
    }),
  ),
  aging_tasks: z.array(
    z.object({
      id,
      task_key: z.string(),
      title: z.string(),
      status,
      status_name: z.string(),
      assignee_name: z.string().nullable(),
      age_hours: z.number().nonnegative(),
    }),
  ),
  completed_tasks: z.array(
    z.object({
      id,
      task_key: z.string(),
      title: z.string(),
      completed_at: z.iso.datetime(),
      cycle_time_hours: z.number().nonnegative(),
    }),
  ),
  flow_statuses: z.array(
    z.object({
      key: status,
      name: z.string(),
      color: z.enum(['slate', 'sky', 'violet', 'amber', 'rose', 'emerald']),
      position: z.number().int().nonnegative(),
      archived: z.boolean(),
    }),
  ),
  flow_series: z
    .array(
      z.object({
        date: z.iso.date(),
        counts: z.record(status, z.number().int().nonnegative()),
      }),
    )
    .max(365),
  throughput_series: z
    .array(
      z.object({
        date: z.iso.date(),
        created_count: z.number().int().nonnegative(),
        completed_count: z.number().int().nonnegative(),
      }),
    )
    .max(365),
});
const taskCandidateResponse = z.object({
  id,
  task_key: z.string(),
  title: z.string(),
  parent_task_id: id.nullable(),
  child_count: z.number().int().nonnegative(),
});

async function repository(
  runtime: Runtime,
  request: Request,
  workspaceId: string,
  projectId: string,
  action:
    | 'task.read'
    | 'task.personalize'
    | 'task.watch'
    | 'task.create'
    | 'task.comment'
    | 'task.worklog'
    | 'task.update'
    | 'task.archive'
    | 'task.restore',
  mutation = false,
) {
  const actor = await requireActor(runtime, request, action, mutation);
  return ScopedTaskRepository.open(
    runtime.pool,
    actor,
    await resolveWorkspaceIdentifier(runtime.pool, workspaceId),
    await resolveProjectIdentifier(runtime.pool, projectId),
  );
}

function ApiTaskIdentifierParam() {
  return ApiParam({
    name: 'taskId',
    required: true,
    description: 'Internal task UUID or stable, case-insensitive project task key such as FORCE-6.',
    schema: { type: 'string', maxLength: 64, example: 'FORCE-6' },
  });
}

async function resolveTaskId(taskRepository: ScopedTaskRepository, rawIdentifier: string) {
  return taskRepository.resolveTaskIdentifier(taskIdentifier.parse(rawIdentifier));
}

@ApiTags('Tasks')
@Controller('api/v1/workspaces/:workspaceId/projects/:projectId')
export class TasksController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiOkResponse({ schema: openApiSchema(savedFilterListResponse) })
  @ApiQuery({ name: 'query', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @Get('task-filters')
  async savedFilters(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('query') query?: string,
    @Query('limit') rawLimit?: string,
    @Query('offset') rawOffset?: string,
  ) {
    const input = savedFilterPageInput.parse({ query, limit: rawLimit, offset: rawOffset });
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'task.personalize')
    ).listSavedFilterPage(input);
  }

  @ApiOkResponse({ schema: openApiSchema(savedFilterResponse) })
  @Get('task-filters/:filterId')
  async savedFilter(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('filterId') filterId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'task.personalize')
    ).getSavedFilter(id.parse(filterId));
  }

  @ApiZodBody(
    savedFilterInput,
    'A personal or project-shared task filter. Project sharing requires project.update.',
  )
  @ApiCreatedResponse({ schema: openApiSchema(savedFilterResponse) })
  @Post('task-filters')
  async createSavedFilter(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const input = savedFilterInput.parse(raw);
    if (input.visibility === 'project')
      await requireActor(this.runtime, request, 'project.update', true);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'task.personalize', true)
    ).createSavedFilter({ ...input, requestId: requestId(request) });
  }

  @ApiZodBody(savedFilterInput, 'Replacement name and filter configuration.')
  @ApiOkResponse({ schema: openApiSchema(savedFilterResponse) })
  @Patch('task-filters/:filterId')
  async updateSavedFilter(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('filterId') filterId: string,
    @Body() raw: unknown,
  ) {
    const input = savedFilterInput.parse(raw);
    if (input.visibility === 'project')
      await requireActor(this.runtime, request, 'project.update', true);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'task.personalize', true)
    ).updateSavedFilter(id.parse(filterId), {
      ...input,
      requestId: requestId(request),
    });
  }

  @ApiZodBody(savedFilterFavoriteInput, 'Star or unstar any visible saved task filter.')
  @ApiOkResponse({ schema: openApiSchema(z.object({ favorite: z.boolean() })) })
  @Post('task-filters/:filterId/favorite')
  async favoriteSavedFilter(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('filterId') filterId: string,
    @Body() raw: unknown,
  ) {
    const body = savedFilterFavoriteInput.parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'task.personalize', true)
    ).setSavedFilterFavorite(id.parse(filterId), body.favorite, requestId(request));
  }

  @ApiOkResponse({ schema: openApiSchema(z.object({ deleted: z.literal(true) }).strict()) })
  @Delete('task-filters/:filterId')
  async deleteSavedFilter(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('filterId') filterId: string,
  ) {
    await (
      await repository(this.runtime, request, workspaceId, projectId, 'task.personalize', true)
    ).deleteSavedFilter(id.parse(filterId), requestId(request));
    return { deleted: true };
  }

  @ApiOkResponse({
    description: 'A bounded, searchable directory of active organization members for assignment.',
    schema: openApiSchema(assigneePageResponse),
  })
  @ApiQuery({ name: 'query', required: false, type: String, maxLength: 200 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0, maximum: 1_000_000 })
  @Get('task-assignees')
  async assignees(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query() raw: unknown,
  ) {
    const input = assigneePageInput.parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'task.update')
    ).listAssigneePage(input);
  }

  @ApiOkResponse({
    schema: openApiSchema(
      z.object({
        items: z.array(z.object({ value: taskLabel, count: z.number().int().positive() })),
      }),
    ),
  })
  @ApiQuery({ name: 'query', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @Get('task-labels')
  async labels(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('query') query?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const parsed = z
      .object({
        query: z.string().trim().max(40).default(''),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      })
      .parse({ query, limit: rawLimit });
    return {
      items: await (
        await repository(this.runtime, request, workspaceId, projectId, 'task.read')
      ).listLabels(parsed.query, parsed.limit),
    };
  }

  @ApiOkResponse({
    schema: openApiSchema(
      z.object({ items: z.array(taskCandidateResponse), pageInfo: pageInfoResponse }),
    ),
  })
  @ApiQuery({ name: 'query', required: false, type: String })
  @ApiQuery({ name: 'topLevelOnly', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @Get('task-candidates')
  async candidates(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('query') query?: string,
    @Query('topLevelOnly') rawTopLevelOnly?: string,
    @Query('limit') rawLimit?: string,
    @Query('offset') rawOffset?: string,
  ) {
    const parsed = z
      .object({
        query: z.string().trim().max(240).default(''),
        topLevelOnly: z.enum(['true', 'false']).default('false'),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
      })
      .parse({ query, topLevelOnly: rawTopLevelOnly, limit: rawLimit, offset: rawOffset });
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'task.update')
    ).listCandidates({
      query: parsed.query,
      topLevelOnly: parsed.topLevelOnly === 'true',
      limit: parsed.limit,
      offset: parsed.offset,
    });
  }

  @ApiOperation({
    summary: 'Analyze project task flow',
    description:
      'Returns project-wide current WIP aging, stale work, daily created-versus-completed throughput, cycle-time statistics, and cumulative-flow state calculated from status and lifecycle history. Cycle time sums time spent in in-progress workflow statuses, including reopened work.',
  })
  @ApiQuery({
    name: 'windowDays',
    required: false,
    schema: { type: 'integer', minimum: 7, maximum: 365, default: 30 },
    description: 'Completion and daily cumulative-flow lookback window in UTC calendar days.',
  })
  @ApiQuery({
    name: 'staleAfterDays',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 90, default: 7 },
    description: 'Age threshold used to identify stale active work.',
  })
  @ApiOkResponse({ schema: openApiSchema(taskFlowInsightsResponse) })
  @Get('task-flow-insights')
  async taskFlowInsights(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('windowDays') rawWindowDays?: string,
    @Query('staleAfterDays') rawStaleAfterDays?: string,
  ) {
    const input = z
      .object({
        windowDays: z.coerce.number().int().min(7).max(365).default(30),
        staleAfterDays: z.coerce.number().int().min(1).max(90).default(7),
      })
      .parse({ windowDays: rawWindowDays, staleAfterDays: rawStaleAfterDays });
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'task.read')
    ).getFlowInsights(input.windowDays, input.staleAfterDays);
  }

  @ApiOkResponse({ schema: openApiSchema(taskListResponse) })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  @ApiQuery({
    name: 'archiveState',
    required: false,
    enum: ['active', 'all', 'archived'],
    description: 'Lifecycle scope. Overrides the legacy includeArchived flag.',
  })
  @ApiQuery({ name: 'entityType', required: false, enum: entityType.options })
  @ApiQuery({ name: 'entityId', required: false, type: String, format: 'uuid' })
  @ApiQuery({
    name: 'query',
    required: false,
    type: String,
    description: 'Case-insensitive task key, title, description, or assignee search.',
  })
  @ApiQuery({
    name: 'assignee',
    required: false,
    type: String,
    description: 'Use mine, unassigned, or an organization member UUID.',
  })
  @ApiQuery({ name: 'priority', required: false, enum: priority.options })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    isArray: true,
    description: 'Repeat to include tasks in any selected project workflow status.',
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['rank', 'title', 'status', 'priority', 'assignee', 'dueDate'],
    description: 'Stable task ordering. Child tasks remain adjacent to their parent.',
  })
  @ApiQuery({ name: 'direction', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({
    name: 'hasDueDate',
    required: false,
    type: Boolean,
    description: 'When true, returns only tasks with a due date.',
  })
  @ApiQuery({
    name: 'label',
    required: false,
    type: String,
    isArray: true,
    description: 'Repeat to require every selected normalized project label.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
    description: 'Page size from 1 to 100. Defaults to 100.',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Zero-based page offset. Defaults to 0.',
  })
  @Get('tasks')
  async tasks(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('includeArchived') includeArchived?: string,
    @Query('archiveState') rawArchiveState?: string,
    @Query('entityType') rawEntityType?: string,
    @Query('entityId') rawEntityId?: string,
    @Query('query') rawQuery?: string,
    @Query('assignee') rawAssignee?: string,
    @Query('priority') rawPriority?: string,
    @Query('status') rawStatuses?: string | string[],
    @Query('label') rawLabels?: string | string[],
    @Query('sort') rawSort?: string,
    @Query('direction') rawDirection?: string,
    @Query('hasDueDate') rawHasDueDate?: string,
    @Query('limit') rawLimit?: string,
    @Query('offset') rawOffset?: string,
  ) {
    const parsed = taskListInput.parse({
      includeArchived,
      archiveState: rawArchiveState,
      entityType: rawEntityType,
      entityId: rawEntityId,
      query: rawQuery,
      assignee: rawAssignee,
      priority: rawPriority,
      status: rawStatuses,
      label: rawLabels,
      sort: rawSort,
      direction: rawDirection,
      hasDueDate: rawHasDueDate,
      limit: rawLimit,
      offset: rawOffset,
    });
    return (await repository(this.runtime, request, workspaceId, projectId, 'task.read')).listTasks(
      {
        ...parsed,
        includeArchived: parsed.includeArchived === 'true',
        archiveState: parsed.archiveState ?? (parsed.includeArchived === 'true' ? 'all' : 'active'),
        entityType: parsed.entityType as TaskEntityType | undefined,
        statuses: parsed.status
          ? Array.isArray(parsed.status)
            ? parsed.status
            : [parsed.status]
          : [],
        labels: parsed.label ? (Array.isArray(parsed.label) ? parsed.label : [parsed.label]) : [],
        hasDueDate: parsed.hasDueDate === 'true',
      },
    );
  }

  @ApiQuery({ name: 'query', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: '1–100; defaults to 50.' })
  @ApiOkResponse({ schema: openApiSchema(taskVisibilityGroupsResponse) })
  @Get('task-visibility-groups')
  async taskVisibilityGroups(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('query') rawQuery?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const query = z.string().trim().max(200).default('').parse(rawQuery);
    const limit = z.coerce.number().int().min(1).max(100).default(50).parse(rawLimit);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'task.update')
    ).listTaskVisibilityGroups(query, limit);
  }

  @ApiOkResponse({ schema: openApiSchema(taskDetailResponse) })
  @ApiTaskIdentifierParam()
  @Get('tasks/:taskId')
  async task(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ) {
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.read',
    );
    return taskRepository.getTask(await resolveTaskId(taskRepository, taskId));
  }

  @ApiOkResponse({ schema: openApiSchema(taskVisibilityResponse) })
  @ApiTaskIdentifierParam()
  @Get('tasks/:taskId/visibility')
  async taskVisibility(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ) {
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.update',
    );
    return taskRepository.getTaskVisibility(await resolveTaskId(taskRepository, taskId));
  }

  @ApiZodBody(
    taskVisibilityInput,
    'Last-read rowVersion plus the active organization members and groups allowed to see a restricted task.',
  )
  @ApiOkResponse({ schema: openApiSchema(taskVisibilityResponse) })
  @ApiTaskIdentifierParam()
  @Patch('tasks/:taskId/visibility')
  async updateTaskVisibility(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() raw: unknown,
  ) {
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.update',
      true,
    );
    const input = taskVisibilityInput.parse(raw);
    return taskRepository.setTaskVisibility({
      taskId: await resolveTaskId(taskRepository, taskId),
      ...input,
      requestId: requestId(request),
    });
  }

  @ApiQuery({ name: 'limit', required: false, type: Number, description: '1–100; defaults to 50.' })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Zero-based activity offset.',
  })
  @ApiOkResponse({ schema: openApiSchema(taskActivityResponse) })
  @ApiTaskIdentifierParam()
  @Get('tasks/:taskId/activity')
  async taskActivity(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Query('limit') rawLimit?: string,
    @Query('offset') rawOffset?: string,
  ) {
    const page = activityPageInput.parse({ limit: rawLimit, offset: rawOffset });
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.read',
    );
    return taskRepository.getTaskActivity(await resolveTaskId(taskRepository, taskId), page);
  }

  @ApiQuery({ name: 'limit', required: false, type: Number, description: '1–100; defaults to 20.' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Zero-based offset.' })
  @ApiOkResponse({ schema: openApiSchema(taskWorklogPageResponse) })
  @ApiTaskIdentifierParam()
  @Get('tasks/:taskId/worklogs')
  async taskWorklogs(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Query('limit') rawLimit?: string,
    @Query('offset') rawOffset?: string,
  ) {
    const page = worklogPageInput.parse({ limit: rawLimit, offset: rawOffset });
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.read',
    );
    return taskRepository.listTaskWorklogs(await resolveTaskId(taskRepository, taskId), page);
  }

  @ApiZodBody(
    worklogBaseInput,
    'Log time against the task using its last-read row version. Auto mode subtracts the duration from a present remaining estimate.',
  )
  @ApiCreatedResponse({ schema: openApiSchema(taskDetailResponse) })
  @ApiTaskIdentifierParam()
  @Post('tasks/:taskId/worklogs')
  async createWorklog(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() raw: unknown,
  ) {
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.worklog',
      true,
    );
    return taskRepository.createWorklog(await resolveTaskId(taskRepository, taskId), {
      ...worklogBaseInput.parse(raw),
      requestId: requestId(request),
    });
  }

  @ApiZodBody(
    worklogUpdateInput,
    'Edit an authored worklog using both task and worklog row versions. Auto mode adjusts remaining time by the duration delta.',
  )
  @ApiOkResponse({ schema: openApiSchema(taskDetailResponse) })
  @ApiTaskIdentifierParam()
  @Patch('tasks/:taskId/worklogs/:worklogId')
  async updateWorklog(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Param('worklogId') worklogId: string,
    @Body() raw: unknown,
  ) {
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.worklog',
      true,
    );
    return taskRepository.updateWorklog(
      await resolveTaskId(taskRepository, taskId),
      id.parse(worklogId),
      { ...worklogUpdateInput.parse(raw), requestId: requestId(request) },
    );
  }

  @ApiZodBody(
    worklogDeleteInput,
    'Soft-delete an authored worklog using both row versions. Auto mode adds its duration back to remaining time.',
  )
  @ApiOkResponse({ schema: openApiSchema(taskDetailResponse) })
  @ApiTaskIdentifierParam()
  @Delete('tasks/:taskId/worklogs/:worklogId')
  async deleteWorklog(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Param('worklogId') worklogId: string,
    @Body() raw: unknown,
  ) {
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.worklog',
      true,
    );
    return taskRepository.deleteWorklog(
      await resolveTaskId(taskRepository, taskId),
      id.parse(worklogId),
      { ...worklogDeleteInput.parse(raw), requestId: requestId(request) },
    );
  }

  @ApiZodBody(
    createInput,
    'Task fields, optional traceability links, and an optional same-project source task to link atomically when creating a reviewed clone.',
  )
  @ApiHeader({
    name: 'idempotency-key',
    required: true,
    description:
      'Caller-generated key (8–200 characters). Identical retries replay the created task for 24 hours.',
  })
  @ApiCreatedResponse({ schema: openApiSchema(taskCreateResponse) })
  @Post('tasks')
  async create(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Body() raw: unknown,
  ) {
    const input = createInput.parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'task.create', true)
    ).createTask({
      ...input,
      links: input.links as TaskLinkInput[],
      idempotencyKey: idempotencyKey.parse(rawIdempotencyKey),
      requestId: requestId(request),
    });
  }

  @ApiZodBody(updateInput, 'Complete editable task state with the last-read rowVersion.')
  @ApiOkResponse({ schema: openApiSchema(taskDetailResponse) })
  @ApiTaskIdentifierParam()
  @Patch('tasks/:taskId')
  async update(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() raw: unknown,
  ) {
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.update',
      true,
    );
    return taskRepository.updateTask(await resolveTaskId(taskRepository, taskId), {
      ...updateInput.parse(raw),
      requestId: requestId(request),
    });
  }

  @ApiZodBody(
    moveInput,
    'Move a task to a workflow status and rank it before another task, at an absolute edge, or at the bottom when no rank target is supplied.',
  )
  @ApiOkResponse({ schema: openApiSchema(taskDetailResponse) })
  @ApiTaskIdentifierParam()
  @Post('tasks/:taskId/move')
  async move(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() raw: unknown,
  ) {
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.update',
      true,
    );
    return taskRepository.moveTask(await resolveTaskId(taskRepository, taskId), {
      ...moveInput.parse(raw),
      requestId: requestId(request),
    });
  }

  @ApiZodBody(bulkUpdateInput, 'Atomic changes for up to 100 tasks using last-read row versions.')
  @ApiOkResponse({ schema: openApiSchema(z.object({ items: z.array(taskResponse) })) })
  @Post('tasks/bulk-update')
  async bulkUpdate(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    return {
      items: await (
        await repository(this.runtime, request, workspaceId, projectId, 'task.update', true)
      ).bulkUpdateTasks({ ...bulkUpdateInput.parse(raw), requestId: requestId(request) }),
    };
  }

  @ApiZodBody(commentInput)
  @ApiCreatedResponse({ schema: openApiSchema(taskCommentResponse) })
  @ApiTaskIdentifierParam()
  @Post('tasks/:taskId/comments')
  async comment(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() raw: unknown,
  ) {
    const body = commentInput.parse(raw);
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.comment',
      true,
    );
    return taskRepository.addComment({
      taskId: await resolveTaskId(taskRepository, taskId),
      ...body,
      requestId: requestId(request),
    });
  }

  @ApiZodBody(
    commentEditInput,
    'Edit an authored comment using its last-read row version. Previous revisions remain auditable.',
  )
  @ApiOkResponse({ schema: openApiSchema(taskCommentResponse) })
  @ApiTaskIdentifierParam()
  @Patch('tasks/:taskId/comments/:commentId')
  async editComment(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Param('commentId') commentId: string,
    @Body() raw: unknown,
  ) {
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.comment',
      true,
    );
    return taskRepository.updateComment({
      taskId: await resolveTaskId(taskRepository, taskId),
      commentId: id.parse(commentId),
      ...commentEditInput.parse(raw),
      requestId: requestId(request),
    });
  }

  @ApiQuery({ name: 'limit', required: false, type: Number, description: '1–100; defaults to 20.' })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Zero-based revision offset.',
  })
  @ApiOkResponse({ schema: openApiSchema(taskCommentRevisionPageResponse) })
  @ApiTaskIdentifierParam()
  @Get('tasks/:taskId/comments/:commentId/revisions')
  async commentRevisions(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Param('commentId') commentId: string,
    @Query('limit') rawLimit?: string,
    @Query('offset') rawOffset?: string,
  ) {
    const page = commentRevisionPageInput.parse({ limit: rawLimit, offset: rawOffset });
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.read',
    );
    return taskRepository.getCommentRevisions(
      await resolveTaskId(taskRepository, taskId),
      id.parse(commentId),
      page,
    );
  }

  @ApiZodBody(
    externalLinkInput,
    'Create a project traceability source and attach it to this task in one transaction.',
  )
  @ApiCreatedResponse({ schema: openApiSchema(taskDetailResponse) })
  @ApiTaskIdentifierParam()
  @Post('tasks/:taskId/external-links')
  async addExternalLink(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() raw: unknown,
  ) {
    const input = externalLinkInput.parse(raw);
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.update',
      true,
    );
    return taskRepository.addExternalLink({
      taskId: await resolveTaskId(taskRepository, taskId),
      ...input,
      provider: input.provider || new URL(input.url).hostname.replace(/^www\./, ''),
      observedOn: input.observedOn ?? new Date().toISOString().slice(0, 10),
      requestId: requestId(request),
    });
  }

  @ApiZodBody(fileLinkInput, 'Attach an exact, available project file version to this task.')
  @ApiCreatedResponse({ schema: openApiSchema(taskDetailResponse) })
  @ApiTaskIdentifierParam()
  @Post('tasks/:taskId/file-links')
  async addFileLink(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() raw: unknown,
  ) {
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.update',
      true,
    );
    return taskRepository.addFileLink(
      await resolveTaskId(taskRepository, taskId),
      fileLinkInput.parse(raw).fileId,
      requestId(request),
    );
  }

  @ApiOkResponse({ schema: openApiSchema(taskDetailResponse) })
  @ApiTaskIdentifierParam()
  @Delete('tasks/:taskId/links/:linkId')
  async removeLink(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Param('linkId') linkId: string,
  ) {
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.update',
      true,
    );
    return taskRepository.removeLink(
      await resolveTaskId(taskRepository, taskId),
      id.parse(linkId),
      requestId(request),
    );
  }

  @ApiZodBody(relationshipInput)
  @ApiCreatedResponse({ schema: openApiSchema(taskDetailResponse) })
  @ApiTaskIdentifierParam()
  @Post('tasks/:taskId/relationships')
  async addRelationship(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() raw: unknown,
  ) {
    const input = relationshipInput.parse(raw);
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.update',
      true,
    );
    return taskRepository.addRelationship({
      taskId: await resolveTaskId(taskRepository, taskId),
      ...input,
      requestId: requestId(request),
    });
  }

  @ApiOkResponse({ schema: openApiSchema(taskDetailResponse) })
  @ApiTaskIdentifierParam()
  @Delete('tasks/:taskId/relationships/:relationshipId')
  async removeRelationship(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Param('relationshipId') relationshipId: string,
  ) {
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.update',
      true,
    );
    return taskRepository.removeRelationship(
      await resolveTaskId(taskRepository, taskId),
      id.parse(relationshipId),
      requestId(request),
    );
  }

  @ApiCreatedResponse({ schema: openApiSchema(taskDetailResponse) })
  @ApiTaskIdentifierParam()
  @Post('tasks/:taskId/watch')
  async watch(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ) {
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.watch',
      true,
    );
    return taskRepository.setWatching(
      await resolveTaskId(taskRepository, taskId),
      true,
      requestId(request),
    );
  }

  @ApiCreatedResponse({ schema: openApiSchema(taskDetailResponse) })
  @ApiTaskIdentifierParam()
  @Post('tasks/:taskId/unwatch')
  async unwatch(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ) {
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.watch',
      true,
    );
    return taskRepository.setWatching(
      await resolveTaskId(taskRepository, taskId),
      false,
      requestId(request),
    );
  }

  @ApiZodBody(
    archiveInput,
    'Archive the task only if its row version still matches the last-read task state.',
  )
  @ApiOkResponse({ schema: openApiSchema(taskDetailResponse) })
  @ApiTaskIdentifierParam()
  @Patch('tasks/:taskId/archive')
  async archive(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() raw: unknown,
  ) {
    const body = archiveInput.parse(raw);
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.archive',
      true,
    );
    return taskRepository.setArchived(
      await resolveTaskId(taskRepository, taskId),
      true,
      body.reason,
      body.rowVersion,
      requestId(request),
    );
  }

  @ApiZodBody(
    restoreInput,
    'Restore the task only if its row version still matches the last-read archived state.',
  )
  @ApiOkResponse({ schema: openApiSchema(taskDetailResponse) })
  @ApiTaskIdentifierParam()
  @HttpCode(200)
  @Post('tasks/:taskId/restore')
  async restore(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() raw: unknown,
  ) {
    const body = restoreInput.parse(raw);
    const taskRepository = await repository(
      this.runtime,
      request,
      workspaceId,
      projectId,
      'task.restore',
      true,
    );
    return taskRepository.setArchived(
      await resolveTaskId(taskRepository, taskId),
      false,
      '',
      body.rowVersion,
      requestId(request),
    );
  }

  @ApiCreatedResponse({ schema: openApiSchema(taskCreateResponse) })
  @Post('specification-evaluations/:evaluationId/task')
  async fromEvaluation(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('evaluationId') evaluationId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'task.create', true)
    ).createFromFailedEvaluation(id.parse(evaluationId), requestId(request));
  }
}
