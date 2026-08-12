import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7, validate as validateUuid } from 'uuid';
import { appendAudit, RepositoryError, type ActorSession } from './community.js';
import { notificationPreferencesForUser } from './notifications.js';
import {
  claimProjectCreate,
  hashIdempotencyPayload,
  rememberProjectCreate,
} from './project-idempotency.js';
import type {
  TaskAutomationActionConfig,
  TaskAutomationConditionConfig,
  TaskAutomationTriggerConfig,
  TaskAutomationTriggerType,
} from './task-automations.js';
import { assertTaskStatus, assertTaskTransition, initialTaskStatus } from './task-workflows.js';

export type TaskStatus = string;
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type TaskVisibility = 'project' | 'restricted';
export interface TaskVisibilityPolicy {
  visibility: TaskVisibility;
  rowVersion: number;
  members: Array<{ id: string; displayName: string; email: string }>;
  groups: Array<{ id: string; name: string; color: string }>;
}
const taskRankStep = 1_024;
const taskRankRebalanceThreshold = 2_147_000_000;
type TaskAutomationEvent =
  | { type: 'task.created' }
  | { type: 'task.status_changed'; from: TaskStatus; to: TaskStatus }
  | { type: 'task.priority_changed'; from: TaskPriority; to: TaskPriority }
  | {
      type: 'task.assignee_changed';
      from: string | null;
      to: string | null;
    };

interface AutomationTaskState {
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
}

interface AutomationRuleRow {
  id: string;
  name: string;
  trigger_type: TaskAutomationTriggerType;
  trigger_config: TaskAutomationTriggerConfig;
  condition_config: TaskAutomationConditionConfig;
  action_config: TaskAutomationActionConfig;
}

function automationTriggerMatches(rule: AutomationRuleRow, event: TaskAutomationEvent): boolean {
  if (rule.trigger_type !== event.type) return false;
  if (event.type === 'task.status_changed')
    return (
      (!rule.trigger_config.fromStatus ||
        rule.trigger_config.fromStatus === 'any' ||
        rule.trigger_config.fromStatus === event.from) &&
      (!rule.trigger_config.toStatus ||
        rule.trigger_config.toStatus === 'any' ||
        rule.trigger_config.toStatus === event.to)
    );
  if (event.type === 'task.priority_changed')
    return (
      (!rule.trigger_config.fromPriority ||
        rule.trigger_config.fromPriority === 'any' ||
        rule.trigger_config.fromPriority === event.from) &&
      (!rule.trigger_config.toPriority ||
        rule.trigger_config.toPriority === 'any' ||
        rule.trigger_config.toPriority === event.to)
    );
  if (event.type === 'task.assignee_changed') {
    const assignment = rule.trigger_config.assignment ?? 'any';
    return (
      assignment === 'any' ||
      assignment === 'changed' ||
      (assignment === 'assigned' && Boolean(event.to)) ||
      (assignment === 'unassigned' && !event.to)
    );
  }
  return true;
}

function automationConditionsMatch(
  conditions: TaskAutomationConditionConfig,
  task: AutomationTaskState,
): boolean {
  return (
    (!conditions.status || conditions.status === task.status) &&
    (!conditions.priority || conditions.priority === task.priority) &&
    (!conditions.assignee ||
      (conditions.assignee === 'assigned' ? Boolean(task.assignee_id) : !task.assignee_id))
  );
}
export type TaskEntityType =
  | 'record'
  | 'sample'
  | 'issue'
  | 'test_run'
  | 'measurement_result'
  | 'specification_evaluation'
  | 'dataset'
  | 'external_source'
  | 'file';
export interface TaskLinkInput {
  entityType: TaskEntityType;
  entityId: string;
}
export interface TaskEvidenceLink {
  id: string;
  entity_type: TaskEntityType;
  entity_id: string;
  created_at: string;
  title: string | null;
  detail: string | null;
  object_type_public_id: string | null;
  provider: string | null;
  url: string | null;
  external_id: string | null;
  version: string | null;
  observed_on: string | null;
  archived_at: string | null;
  original_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  file_series_name: string | null;
  file_version_number: number | null;
  file_status: string | null;
}
export interface TaskLinkActivity {
  id: string;
  action: 'task.link_added' | 'task.link_removed';
  changed_by_name: string;
  changed_at: string;
  link_id: string;
  entity_type: TaskEntityType;
  entity_id: string;
  title: string | null;
  url: string | null;
}
export interface TaskAssignee {
  id: string;
  displayName: string;
  email: string;
}

export interface TaskAssigneePage {
  items: TaskAssignee[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
  overallTotal: number;
}
export interface TaskSavedFilterConfig {
  query: string;
  assignee: string;
  priority: 'all' | TaskPriority;
  statuses?: TaskStatus[];
  labels?: string[];
  view: 'board' | 'list' | 'calendar';
  sort?: TaskSort;
  direction?: TaskSortDirection;
  group?: TaskGroup;
  listColumns?: TaskListColumn[];
}
export interface TaskSavedFilter {
  id: string;
  owner_id: string;
  owner_name: string;
  name: string;
  visibility: 'personal' | 'project';
  config: TaskSavedFilterConfig;
  favorite: boolean;
  is_owner: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}
export interface TaskComment {
  id: string;
  body: string;
  author_id: string;
  author_name: string;
  mentions: Array<{ id: string; displayName: string }>;
  row_version: number;
  revisions: Array<{
    revision: number;
    body: string;
    mentions: Array<{ id: string; displayName: string }>;
    edited_by_name: string;
    edited_at: string;
  }>;
  revision_count: number;
  edited_at: string | null;
  created_at: string;
}
export type TaskChangeField =
  | 'title'
  | 'description'
  | 'priority'
  | 'assigneeId'
  | 'dueDate'
  | 'labels'
  | 'parentTaskId'
  | 'originalEstimateMinutes'
  | 'remainingEstimateMinutes';
export interface TaskChangeActivity {
  id: string;
  action: 'task.updated' | 'task.automated';
  changed_by_name: string;
  changed_at: string;
  automation_rule_name: string | null;
  changes: Array<{
    field: TaskChangeField;
    from: string | null;
    to: string | null;
    changed: boolean;
  }>;
}
export interface TaskActivityPage {
  status_history: Array<{
    id: string;
    from_status: TaskStatus | null;
    to_status: TaskStatus;
    changed_by: string;
    changed_by_name: string;
    changed_at: string;
  }>;
  comments: TaskComment[];
  change_history: TaskChangeActivity[];
  link_history: TaskLinkActivity[];
  pageInfo: {
    limit: number;
    offset: number;
    total: number;
    hasNext: boolean;
  };
}
export interface TaskCommentRevisionPage {
  items: TaskComment['revisions'];
  pageInfo: {
    limit: number;
    offset: number;
    total: number;
    hasNext: boolean;
  };
}
export type RemainingEstimateMode = 'auto' | 'set' | 'unchanged';
export interface TaskWorklog {
  id: string;
  duration_minutes: number;
  started_at: string;
  note: string;
  author_id: string;
  author_name: string;
  remaining_estimate_before: number | null;
  remaining_estimate_after: number | null;
  row_version: number;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
}
export interface TaskWorklogPage {
  items: TaskWorklog[];
  pageInfo: {
    limit: number;
    offset: number;
    total: number;
    hasNext: boolean;
  };
}
export interface TaskRelationship {
  id: string;
  relation_type: 'blocks' | 'relates_to';
  direction: 'outward' | 'inward';
  related_task_id: string;
  related_task_key: string;
  related_task_title: string;
  related_task_status: TaskStatus;
  related_task_archived_at: string | null;
  created_at: string;
}
export interface TaskListOptions {
  includeArchived?: boolean;
  archiveState?: 'active' | 'all' | 'archived';
  entityType?: TaskEntityType | undefined;
  entityId?: string | undefined;
  query?: string | undefined;
  assignee?: 'mine' | 'unassigned' | string | undefined;
  priority?: TaskPriority | undefined;
  statuses?: TaskStatus[] | undefined;
  labels?: string[] | undefined;
  hasDueDate?: boolean;
  limit?: number;
  offset?: number;
  sort?: TaskSort;
  direction?: TaskSortDirection;
  /** Internal bounded lookup used after an atomic bulk mutation. */
  taskIds?: string[] | undefined;
}
export type TaskSort = 'rank' | 'title' | 'status' | 'priority' | 'assignee' | 'dueDate';
export type TaskSortDirection = 'asc' | 'desc';
export type TaskGroup = 'none' | 'status' | 'priority' | 'assignee';
export type TaskListColumn = Exclude<TaskSort, 'rank'>;
export interface TaskListRow extends Record<string, unknown> {
  id: string;
  board_position: number;
  row_version: number;
}
export interface TaskCandidate {
  id: string;
  task_key: string;
  title: string;
  parent_task_id: string | null;
  child_count: number;
}
export interface TaskListPage<T = TaskListRow> {
  items: T[];
  pageInfo: {
    limit: number;
    offset: number;
    total: number;
    hasNext: boolean;
  };
}
export interface TaskFlowInsights {
  calculated_at: string;
  window_days: number;
  stale_after_days: number;
  summary: {
    active_count: number;
    wip_count: number;
    stale_count: number;
    completed_count: number;
    average_cycle_hours: number | null;
    median_cycle_hours: number | null;
    p85_cycle_hours: number | null;
  };
  statuses: Array<{
    key: TaskStatus;
    name: string;
    category: 'todo' | 'in_progress' | 'done';
    color: string;
    position: number;
    current_count: number;
    wip_limit: number | null;
    average_age_hours: number | null;
    oldest_age_hours: number | null;
    stale_count: number;
  }>;
  aging_tasks: Array<{
    id: string;
    task_key: string;
    title: string;
    status: TaskStatus;
    status_name: string;
    assignee_name: string | null;
    age_hours: number;
  }>;
  completed_tasks: Array<{
    id: string;
    task_key: string;
    title: string;
    completed_at: string;
    cycle_time_hours: number;
  }>;
  flow_statuses: Array<{
    key: TaskStatus;
    name: string;
    color: string;
    position: number;
    archived: boolean;
  }>;
  flow_series: Array<{
    date: string;
    counts: Record<TaskStatus, number>;
  }>;
  throughput_series: Array<{
    date: string;
    created_count: number;
    completed_count: number;
  }>;
}
interface Scope {
  actor: ActorSession;
  workspaceId: string;
  projectId: string;
}

const taskChangeFields: TaskChangeField[] = [
  'title',
  'description',
  'priority',
  'assigneeId',
  'dueDate',
  'labels',
  'parentTaskId',
  'originalEstimateMinutes',
  'remainingEstimateMinutes',
];

const taskLabelPattern = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,39}$/u;
const maxTaskEstimateMinutes = 5_256_000;
const maxWorklogDurationMinutes = 525_600;

function validateTaskEstimate(value: number | null | undefined, field: string) {
  if (
    value !== undefined &&
    value !== null &&
    (!Number.isSafeInteger(value) || value < 0 || value > maxTaskEstimateMinutes)
  )
    throw new RepositoryError(
      'TASK_ESTIMATE_INVALID',
      400,
      `${field} must be a whole number of minutes between 0 and ${maxTaskEstimateMinutes}.`,
    );
}

function validateWorklogDuration(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maxWorklogDurationMinutes)
    throw new RepositoryError(
      'TASK_WORKLOG_DURATION_INVALID',
      400,
      `Worklog duration must be between 1 and ${maxWorklogDurationMinutes} minutes.`,
    );
}

function adjustRemainingEstimate(
  current: number | null,
  durationDelta: number,
  mode: RemainingEstimateMode,
  explicit: number | null | undefined,
) {
  validateTaskEstimate(explicit, 'Remaining estimate');
  if (mode === 'set') {
    if (explicit === undefined || explicit === null)
      throw new RepositoryError(
        'TASK_REMAINING_ESTIMATE_REQUIRED',
        400,
        'A remaining estimate is required when using set mode.',
      );
    return explicit;
  }
  if (mode === 'unchanged' || current === null) return current;
  return Math.max(0, Math.min(maxTaskEstimateMinutes, current - durationDelta));
}

function normalizeTaskLabels(values: string[] = []): string[] {
  if (values.length > 12)
    throw new RepositoryError('TASK_LABEL_LIMIT', 400, 'A task can have at most 12 labels.');
  const labels = [
    ...new Set(values.map((value) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US'))),
  ];
  if (labels.some((label) => !taskLabelPattern.test(label)))
    throw new RepositoryError(
      'TASK_LABEL_INVALID',
      400,
      'Labels must start with a letter or number and use only letters, numbers, dots, hyphens, or underscores.',
    );
  return labels.sort();
}

function taskChanges(payload: Record<string, unknown>): TaskChangeActivity['changes'] {
  const raw = payload.changes;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return taskChangeFields.flatMap((field) => {
    const value = (raw as Record<string, unknown>)[field];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const change = value as Record<string, unknown>;
    const scalar = (candidate: unknown) =>
      typeof candidate === 'string' ? candidate : candidate === null ? null : null;
    return [
      {
        field,
        from: scalar(change.from),
        to: scalar(change.to),
        changed: change.changed === true || change.from !== change.to,
      },
    ];
  });
}

async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export class ScopedTaskRepository {
  private constructor(
    private readonly pool: Pool,
    private readonly scope: Scope,
  ) {}

  static async open(pool: Pool, actor: ActorSession, workspaceId: string, projectId: string) {
    const found = await pool.query(
      'select 1 from projects p join workspaces w on w.id=p.workspace_id where p.id=$1 and p.workspace_id=$2 and w.organization_id=$3 and p.system=false and project_visible_to(p.id,$2,$3,$4,$5)',
      [projectId, workspaceId, actor.organizationId, actor.actorId, actor.role],
    );
    if (!found.rowCount)
      throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
    return new ScopedTaskRepository(pool, { actor, workspaceId, projectId });
  }

  private audit(action: string, taskId: string, requestId: string, payload = {}) {
    return {
      organizationId: this.scope.actor.organizationId,
      workspaceId: this.scope.workspaceId,
      projectId: this.scope.projectId,
      actorId: this.scope.actor.actorId,
      action,
      targetType: 'task',
      targetId: taskId,
      requestId,
      payload,
    };
  }

  private savedFilterAudit(action: string, filterId: string, requestId: string, payload = {}) {
    return {
      organizationId: this.scope.actor.organizationId,
      workspaceId: this.scope.workspaceId,
      projectId: this.scope.projectId,
      actorId: this.scope.actor.actorId,
      action,
      targetType: 'task_saved_filter',
      targetId: filterId,
      requestId,
      payload,
    };
  }

  /** Actor values originate in the authenticated session; validate before SQL interpolation. */
  private taskVisibilityPredicate(alias = 't') {
    const actorId = this.scope.actor.actorId;
    if (!validateUuid(actorId))
      throw new RepositoryError('ACTOR_INVALID', 401, 'Authenticated user is invalid.');
    return `task_visible_to(${alias}.id,'${actorId}'::uuid,'${this.scope.actor.role}'::text)`;
  }

  private async assertTaskVisible(taskId: string, client: Pool | PoolClient = this.pool) {
    const found = await client.query(
      `select 1 from tasks t
       where t.project_id=$1 and t.id=$2 and ${this.taskVisibilityPredicate('t')}`,
      [this.scope.projectId, taskId],
    );
    if (!found.rowCount) throw new RepositoryError('TASK_NOT_FOUND', 404, 'Task was not found.');
  }

  private assertCanManageVisibility() {
    if (!['owner', 'admin', 'engineer'].includes(this.scope.actor.role))
      throw new RepositoryError(
        'TASK_VISIBILITY_FORBIDDEN',
        403,
        'Only workspace owners, administrators, and engineers can change task visibility.',
      );
  }

  async resolveTaskIdentifier(identifier: string): Promise<string> {
    const normalized = identifier.trim();
    if (validateUuid(normalized)) {
      await this.assertTaskVisible(normalized);
      return normalized;
    }
    const key = /^([A-Za-z][A-Za-z0-9_-]{1,15})-([1-9][0-9]*)$/.exec(normalized);
    const taskNumber = Number(key?.[2]);
    if (!key || !Number.isSafeInteger(taskNumber) || taskNumber > 2_147_483_647)
      throw new RepositoryError('TASK_NOT_FOUND', 404, 'Task was not found.');
    const task = await this.pool.query<{ id: string }>(
      `select t.id
       from tasks t join projects p on p.id=t.project_id
       where t.project_id=$1 and p.key=upper($2) and t.task_number=$3
         and ${this.taskVisibilityPredicate('t')}`,
      [this.scope.projectId, key[1], taskNumber],
    );
    if (!task.rows[0]) throw new RepositoryError('TASK_NOT_FOUND', 404, 'Task was not found.');
    return task.rows[0].id;
  }

  async getTaskVisibility(taskId: string): Promise<TaskVisibilityPolicy> {
    this.assertCanManageVisibility();
    await this.assertTaskVisible(taskId);
    const task = await this.pool.query<{ visibility: TaskVisibility; row_version: number }>(
      'select visibility,row_version from tasks where project_id=$1 and id=$2',
      [this.scope.projectId, taskId],
    );
    const [members, groups] = await Promise.all([
      this.pool.query<{ id: string; display_name: string; email: string }>(
        `select u.id,u.display_name,u.email
         from task_visibility_subjects subject join users u on u.id=subject.user_id
         where subject.project_id=$1 and subject.task_id=$2 and u.disabled_at is null
         order by lower(u.display_name),u.id`,
        [this.scope.projectId, taskId],
      ),
      this.pool.query<{ id: string; name: string; color: string }>(
        `select group_row.id,group_row.name,group_row.color
         from task_visibility_subjects subject
         join member_groups group_row on group_row.id=subject.group_id
          and group_row.organization_id=subject.organization_id
         where subject.project_id=$1 and subject.task_id=$2 and group_row.archived_at is null
         order by lower(group_row.name),group_row.id`,
        [this.scope.projectId, taskId],
      ),
    ]);
    const row = task.rows[0];
    if (!row) throw new RepositoryError('TASK_NOT_FOUND', 404, 'Task was not found.');
    return {
      visibility: row.visibility,
      rowVersion: row.row_version,
      members: members.rows.map((member) => ({
        id: member.id,
        displayName: member.display_name,
        email: member.email,
      })),
      groups: groups.rows,
    };
  }

  async listTaskVisibilityGroups(query = '', limit = 50) {
    this.assertCanManageVisibility();
    const normalizedQuery = query.normalize('NFKC').trim();
    const escapedQuery = normalizedQuery.replace(/[\\%_]/g, '\\$&');
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const result = await this.pool.query<{ id: string; name: string; color: string }>(
      `select id,name,color from member_groups
       where organization_id=$1 and archived_at is null
         and ($2::text='' or name ilike '%'||$2||'%' escape '\\')
       order by lower(name),id limit $3`,
      [this.scope.actor.organizationId, escapedQuery, boundedLimit],
    );
    return { items: result.rows };
  }

  async setTaskVisibility(input: {
    taskId: string;
    visibility: TaskVisibility;
    userIds: string[];
    groupIds: string[];
    rowVersion: number;
    requestId: string;
  }): Promise<TaskVisibilityPolicy> {
    this.assertCanManageVisibility();
    const userIds = [...new Set(input.userIds)];
    const groupIds = [...new Set(input.groupIds)];
    if (
      userIds.length > 100 ||
      groupIds.length > 100 ||
      [...userIds, ...groupIds].some((value) => !validateUuid(value))
    )
      throw new RepositoryError(
        'TASK_VISIBILITY_SUBJECT_INVALID',
        400,
        'Visibility subjects must contain at most 100 valid member and group IDs.',
      );
    await transaction(this.pool, async (client) => {
      await this.assertTaskVisible(input.taskId, client);
      const current = await client.query<{ visibility: TaskVisibility; row_version: number }>(
        `select visibility,row_version from tasks
         where project_id=$1 and id=$2 and row_version=$3 for update`,
        [this.scope.projectId, input.taskId, input.rowVersion],
      );
      if (!current.rows[0])
        throw new RepositoryError('TASK_VERSION_CONFLICT', 409, 'Task changed or is unavailable.');
      if (userIds.length) {
        const validUsers = await client.query(
          `select m.user_id from memberships m join users u on u.id=m.user_id
           where m.organization_id=$1 and m.user_id=any($2::uuid[]) and u.disabled_at is null
             and project_visible_to($3,$4,$1,m.user_id,m.role::text)`,
          [this.scope.actor.organizationId, userIds, this.scope.projectId, this.scope.workspaceId],
        );
        if (validUsers.rowCount !== userIds.length)
          throw new RepositoryError(
            'TASK_VISIBILITY_SUBJECT_INVALID',
            400,
            'Every selected member must be active in this organization.',
          );
      }
      if (groupIds.length) {
        const validGroups = await client.query(
          `select id from member_groups
           where organization_id=$1 and id=any($2::uuid[]) and archived_at is null`,
          [this.scope.actor.organizationId, groupIds],
        );
        if (validGroups.rowCount !== groupIds.length)
          throw new RepositoryError(
            'TASK_VISIBILITY_SUBJECT_INVALID',
            400,
            'Every selected group must be active in this organization.',
          );
      }
      await client.query(
        `update tasks set visibility=$3,row_version=row_version+1,updated_at=now()
         where project_id=$1 and id=$2`,
        [this.scope.projectId, input.taskId, input.visibility],
      );
      await client.query(
        'delete from task_visibility_subjects where project_id=$1 and task_id=$2',
        [this.scope.projectId, input.taskId],
      );
      for (const userId of userIds)
        await client.query(
          `insert into task_visibility_subjects
           (id,project_id,task_id,organization_id,user_id,created_by)
           values ($1,$2,$3,$4,$5,$6)`,
          [
            uuidv7(),
            this.scope.projectId,
            input.taskId,
            this.scope.actor.organizationId,
            userId,
            this.scope.actor.actorId,
          ],
        );
      for (const groupId of groupIds)
        await client.query(
          `insert into task_visibility_subjects
           (id,project_id,task_id,organization_id,group_id,created_by)
           values ($1,$2,$3,$4,$5,$6)`,
          [
            uuidv7(),
            this.scope.projectId,
            input.taskId,
            this.scope.actor.organizationId,
            groupId,
            this.scope.actor.actorId,
          ],
        );
      if (input.visibility === 'restricted') {
        await client.query(
          `delete from task_watchers watcher
           using memberships membership
           where watcher.project_id=$1 and watcher.task_id=$2
             and membership.organization_id=$3 and membership.user_id=watcher.user_id
             and not task_visible_to($2,membership.user_id,membership.role::text)`,
          [this.scope.projectId, input.taskId, this.scope.actor.organizationId],
        );
        await client.query(
          `delete from outbox_events
             where project_id=$1 and entity_type='task' and entity_id=$2 and dispatched_at is null`,
          [this.scope.projectId, input.taskId],
        );
        await client.query(
          `delete from notifications notification using memberships membership
           where notification.project_id=$1 and notification.task_id=$2
             and membership.organization_id=$3 and membership.user_id=notification.recipient_id
             and not task_visible_to($2,membership.user_id,membership.role::text)`,
          [this.scope.projectId, input.taskId, this.scope.actor.organizationId],
        );
      }
      await appendAudit(
        client,
        this.audit('task.visibility_changed', input.taskId, input.requestId, {
          from: current.rows[0].visibility,
          to: input.visibility,
          memberCount: userIds.length,
          groupCount: groupIds.length,
        }),
      );
    });
    return this.getTaskVisibility(input.taskId);
  }

  private async appendWebhookEvent(
    client: PoolClient,
    eventType: 'task.created' | 'task.updated' | 'task.archived' | 'task.restored',
    taskId: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    const task = await client.query<{
      task_key: string;
      title: string;
      description: string;
      status: TaskStatus;
      priority: TaskPriority;
      labels: string[];
      parent_task_id: string | null;
      assignee_id: string | null;
      due_date: string | null;
      original_estimate_minutes: number | null;
      remaining_estimate_minutes: number | null;
      time_spent_minutes: number;
      row_version: number;
      archived: boolean;
    }>(
      `select p.key||'-'||t.task_number task_key,t.title,t.description,t.status,t.priority,t.labels,
              t.parent_task_id,t.assignee_id,t.due_date::text due_date,
              t.original_estimate_minutes,t.remaining_estimate_minutes,
              (select coalesce(sum(w.duration_minutes),0)::int from task_worklogs w
               where w.project_id=t.project_id and w.task_id=t.id and w.deleted_at is null) time_spent_minutes,
              t.row_version,
              (t.archived_at is not null) archived
       from tasks t join projects p on p.id=t.project_id
       where t.project_id=$1 and t.id=$2 and t.visibility='project'`,
      [this.scope.projectId, taskId],
    );
    const row = task.rows[0];
    if (!row) return;
    const eventId = uuidv7();
    await client.query(
      `insert into outbox_events (id,project_id,event_type,entity_type,entity_id,payload)
       values ($1,$2,$3,'task',$4,$5::jsonb)`,
      [
        eventId,
        this.scope.projectId,
        eventType,
        taskId,
        JSON.stringify({
          version: 1,
          id: eventId,
          type: eventType,
          occurredAt: new Date().toISOString(),
          workspaceId: this.scope.workspaceId,
          projectId: this.scope.projectId,
          taskId,
          actorId: this.scope.actor.actorId,
          data: {
            ...data,
            task: {
              key: row.task_key,
              title: row.title,
              description: row.description,
              status: row.status,
              priority: row.priority,
              labels: row.labels,
              parentTaskId: row.parent_task_id,
              assigneeId: row.assignee_id,
              dueDate: row.due_date,
              originalEstimateMinutes: row.original_estimate_minutes,
              remainingEstimateMinutes: row.remaining_estimate_minutes,
              timeSpentMinutes: row.time_spent_minutes,
              rowVersion: row.row_version,
              archived: row.archived,
            },
          },
        }),
      ],
    );
  }

  private async notify(
    client: PoolClient,
    taskId: string,
    type:
      | 'task.assigned'
      | 'task.updated'
      | 'task.status_changed'
      | 'task.commented'
      | 'task.mentioned'
      | 'task.archived'
      | 'task.restored',
    payload: Record<string, unknown>,
    options: { only?: string[]; exclude?: string[]; eventId?: string } = {},
  ) {
    const recipientIds = options.only
      ? [...new Set(options.only)]
      : (
          await client.query<{ user_id: string }>(
            `select w.user_id from task_watchers w join users u on u.id=w.user_id
             where w.project_id=$1 and w.task_id=$2 and u.disabled_at is null
             union select t.assignee_id from tasks t join users u on u.id=t.assignee_id
             where t.project_id=$1 and t.id=$2 and u.disabled_at is null`,
            [this.scope.projectId, taskId],
          )
        ).rows.map((row) => row.user_id);
    const excluded = new Set([this.scope.actor.actorId, ...(options.exclude ?? [])]);
    const candidateRecipientIds = [...new Set(recipientIds)].filter((id) => !excluded.has(id));
    const visibleRecipients = candidateRecipientIds.length
      ? await client.query<{ user_id: string }>(
          `select m.user_id from memberships m
           where m.organization_id=$1 and m.user_id=any($2::uuid[])
             and task_visible_to($3,m.user_id,m.role::text)`,
          [this.scope.actor.organizationId, candidateRecipientIds, taskId],
        )
      : { rows: [] };
    const eligibleRecipientIds = visibleRecipients.rows.map((row) => row.user_id);
    if (!eligibleRecipientIds.length) return;
    const preferenceRows = await client.query<{
      user_id: string;
      notify_assigned: boolean;
      notify_mentioned: boolean;
      notify_task_activity: boolean;
    }>(
      `select user_id,notify_assigned,notify_mentioned,notify_task_activity
       from user_notification_preferences where organization_id=$1 and user_id=any($2::uuid[])`,
      [this.scope.actor.organizationId, eligibleRecipientIds],
    );
    const preferenceByUser = new Map(preferenceRows.rows.map((row) => [row.user_id, row]));
    const eventId = options.eventId ?? uuidv7();
    for (const recipientId of eligibleRecipientIds) {
      const preference = preferenceByUser.get(recipientId);
      const enabled =
        type === 'task.assigned'
          ? preference?.notify_assigned !== false
          : type === 'task.mentioned'
            ? preference?.notify_mentioned !== false
            : preference?.notify_task_activity !== false;
      if (!enabled) continue;
      await client.query(
        `insert into notifications
         (id,event_id,organization_id,workspace_id,project_id,task_id,recipient_id,actor_id,type,payload)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
         on conflict (event_id,recipient_id) do nothing`,
        [
          uuidv7(),
          eventId,
          this.scope.actor.organizationId,
          this.scope.workspaceId,
          this.scope.projectId,
          taskId,
          recipientId,
          this.scope.actor.actorId,
          type,
          JSON.stringify(payload),
        ],
      );
    }
  }

  private async mentionedUsers(client: PoolClient, userIds: string[]) {
    const uniqueUserIds = [...new Set(userIds)];
    if (!uniqueUserIds.length) return [];
    const members = await client.query<{ id: string; display_name: string }>(
      `select m.user_id id,u.display_name from memberships m join users u on u.id=m.user_id
       where m.organization_id=$1 and m.user_id=any($2::uuid[]) and u.disabled_at is null
         and project_visible_to($3,$4,$1,m.user_id,m.role::text)
       order by lower(u.display_name),m.user_id`,
      [
        this.scope.actor.organizationId,
        uniqueUserIds,
        this.scope.projectId,
        this.scope.workspaceId,
      ],
    );
    if (members.rowCount !== uniqueUserIds.length)
      throw new RepositoryError(
        'TASK_MENTION_INVALID',
        400,
        'A mentioned user is not an active organization member.',
      );
    return members.rows.map((member) => ({ id: member.id, displayName: member.display_name }));
  }

  private async addWatcher(client: PoolClient, taskId: string, userId: string) {
    await client.query(
      `insert into task_watchers (id,project_id,task_id,user_id,created_by)
       values ($1,$2,$3,$4,$5) on conflict (task_id,user_id) do nothing`,
      [uuidv7(), this.scope.projectId, taskId, userId, this.scope.actor.actorId],
    );
  }

  async listAssigneePage(
    options: { query?: string; limit?: number; offset?: number } = {},
  ): Promise<TaskAssigneePage> {
    const query = (options.query ?? '').normalize('NFKC').trim();
    const escapedQuery = query.replace(/[\\%_]/g, '\\$&');
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100);
    const offset = Math.min(Math.max(Math.trunc(options.offset ?? 0), 0), 1_000_000);
    const scope = `m.organization_id=$1 and u.disabled_at is null
      and project_visible_to($4,$5,$1,m.user_id,m.role::text)`;
    const predicate = `${scope}
      and ($2::text='' or u.display_name ilike '%'||$3||'%' escape '\\'
                       or u.email ilike '%'||$3||'%' escape '\\'
                       or u.id::text=$2)`;
    const [result, counts] = await Promise.all([
      this.pool.query<{
        id: string;
        display_name: string;
        email: string;
      }>(
        `select u.id,u.display_name,u.email
         from memberships m join users u on u.id=m.user_id
         where ${predicate}
         order by case when lower(u.display_name)=lower($2) or lower(u.email)=lower($2)
                       then 0 else 1 end,
                  lower(u.display_name),lower(u.email),u.id
         limit $6 offset $7`,
        [
          this.scope.actor.organizationId,
          query,
          escapedQuery,
          this.scope.projectId,
          this.scope.workspaceId,
          limit,
          offset,
        ],
      ),
      this.pool.query<{ total: string; overall_total: string }>(
        `select count(*) filter (where ${predicate})::text total,
                count(*) filter (where ${scope})::text overall_total
         from memberships m join users u on u.id=m.user_id
         where m.organization_id=$1`,
        [
          this.scope.actor.organizationId,
          query,
          escapedQuery,
          this.scope.projectId,
          this.scope.workspaceId,
        ],
      ),
    ]);
    const total = Number(counts.rows[0]?.total ?? 0);
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        email: row.email,
      })),
      pageInfo: {
        limit,
        offset,
        total,
        hasNext: offset + result.rows.length < total,
      },
      overallTotal: Number(counts.rows[0]?.overall_total ?? 0),
    };
  }

  async listSavedFilterPage(
    options: { query?: string; limit?: number; offset?: number } = {},
  ): Promise<TaskListPage<TaskSavedFilter>> {
    const normalizedQuery = (options.query ?? '').normalize('NFKC').trim();
    const escapedQuery = normalizedQuery.replace(/[\\%_]/g, '\\$&');
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const offset = Math.max(0, Math.min(options.offset ?? 0, 1_000_000));
    const parameters = [this.scope.projectId, this.scope.actor.actorId, escapedQuery];
    const predicate = `f.project_id=$1 and (f.user_id=$2 or f.visibility='project')
       and ($3::text='' or concat_ws(' ',f.name,u.display_name) ilike '%'||$3||'%' escape '\\')`;
    const [count, result] = await Promise.all([
      this.pool.query<{ count: number }>(
        `select count(*)::int count from task_saved_filters f join users u on u.id=f.user_id
         where ${predicate}`,
        parameters,
      ),
      this.pool.query<TaskSavedFilter>(
        `select f.id,f.user_id owner_id,u.display_name owner_name,f.name,f.visibility,f.config,
              (f.user_id=$2) is_owner,(favorite.filter_id is not null) favorite,
              f.created_at,f.updated_at
       from task_saved_filters f join users u on u.id=f.user_id
       left join task_saved_filter_favorites favorite
         on favorite.filter_id=f.id and favorite.user_id=$2
       where ${predicate}
       order by (favorite.filter_id is not null) desc,lower(f.name),f.id
       limit $4 offset $5`,
        [...parameters, limit, offset],
      ),
    ]);
    const total = Number(count.rows[0]?.count ?? 0);
    return {
      items: result.rows,
      pageInfo: {
        limit,
        offset,
        total,
        hasNext: offset + result.rows.length < total,
      },
    };
  }

  async getSavedFilter(filterId: string): Promise<TaskSavedFilter> {
    const result = await this.pool.query<TaskSavedFilter>(
      `select f.id,f.user_id owner_id,u.display_name owner_name,f.name,f.visibility,f.config,
              (f.user_id=$3) is_owner,(favorite.filter_id is not null) favorite,
              f.created_at,f.updated_at
       from task_saved_filters f join users u on u.id=f.user_id
       left join task_saved_filter_favorites favorite
         on favorite.filter_id=f.id and favorite.user_id=$3
       where f.id=$1 and f.project_id=$2 and (f.user_id=$3 or f.visibility='project')`,
      [filterId, this.scope.projectId, this.scope.actor.actorId],
    );
    if (!result.rows[0])
      throw new RepositoryError('TASK_FILTER_NOT_FOUND', 404, 'Saved filter was not found.');
    return result.rows[0];
  }

  async createSavedFilter(input: {
    name: string;
    visibility?: 'personal' | 'project';
    config: TaskSavedFilterConfig;
    requestId: string;
  }): Promise<TaskSavedFilter> {
    const filterId = uuidv7();
    const visibility = input.visibility ?? 'personal';
    try {
      return await transaction(this.pool, async (client) => {
        const created = await client.query<TaskSavedFilter>(
          `insert into task_saved_filters (id,project_id,user_id,name,visibility,config)
           values ($1,$2,$3,$4,$5,$6::jsonb)
           returning id,name,visibility,config,created_at,updated_at`,
          [
            filterId,
            this.scope.projectId,
            this.scope.actor.actorId,
            input.name,
            visibility,
            JSON.stringify(input.config),
          ],
        );
        await client.query(
          `insert into task_saved_filter_favorites (filter_id,user_id) values ($1,$2)`,
          [filterId, this.scope.actor.actorId],
        );
        await appendAudit(
          client,
          this.savedFilterAudit('task_filter.created', filterId, input.requestId, {
            name: input.name,
            visibility,
          }),
        );
        return {
          ...created.rows[0]!,
          owner_id: this.scope.actor.actorId,
          owner_name: this.scope.actor.displayName,
          favorite: true,
          is_owner: true,
        };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new RepositoryError(
          'TASK_FILTER_NAME_CONFLICT',
          409,
          'A saved filter with this name already exists.',
        );
      throw error;
    }
  }

  async updateSavedFilter(
    filterId: string,
    input: {
      name: string;
      visibility?: 'personal' | 'project';
      config: TaskSavedFilterConfig;
      requestId: string;
    },
  ): Promise<TaskSavedFilter> {
    const visibility = input.visibility ?? 'personal';
    try {
      return await transaction(this.pool, async (client) => {
        const updated = await client.query<TaskSavedFilter>(
          `update task_saved_filters set name=$4,visibility=$5,config=$6::jsonb,updated_at=now()
           where id=$1 and project_id=$2 and user_id=$3
           returning id,name,visibility,config,created_at,updated_at`,
          [
            filterId,
            this.scope.projectId,
            this.scope.actor.actorId,
            input.name,
            visibility,
            JSON.stringify(input.config),
          ],
        );
        if (!updated.rows[0])
          throw new RepositoryError('TASK_FILTER_NOT_FOUND', 404, 'Saved filter was not found.');
        await appendAudit(
          client,
          this.savedFilterAudit('task_filter.updated', filterId, input.requestId, {
            name: input.name,
            visibility,
          }),
        );
        const favorite = await client.query(
          `select 1 from task_saved_filter_favorites where filter_id=$1 and user_id=$2`,
          [filterId, this.scope.actor.actorId],
        );
        return {
          ...updated.rows[0],
          owner_id: this.scope.actor.actorId,
          owner_name: this.scope.actor.displayName,
          favorite: Boolean(favorite.rowCount),
          is_owner: true,
        };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new RepositoryError(
          'TASK_FILTER_NAME_CONFLICT',
          409,
          'A saved filter with this name already exists.',
        );
      throw error;
    }
  }

  async deleteSavedFilter(filterId: string, requestId: string): Promise<void> {
    await transaction(this.pool, async (client) => {
      const deleted = await client.query(
        'delete from task_saved_filters where id=$1 and project_id=$2 and user_id=$3 returning name',
        [filterId, this.scope.projectId, this.scope.actor.actorId],
      );
      if (!deleted.rows[0])
        throw new RepositoryError('TASK_FILTER_NOT_FOUND', 404, 'Saved filter was not found.');
      await appendAudit(
        client,
        this.savedFilterAudit('task_filter.deleted', filterId, requestId, {
          name: deleted.rows[0].name,
        }),
      );
    });
  }

  async setSavedFilterFavorite(
    filterId: string,
    favorite: boolean,
    requestId: string,
  ): Promise<{ favorite: boolean }> {
    await transaction(this.pool, async (client) => {
      const visible = await client.query(
        `select 1 from task_saved_filters
         where id=$1 and project_id=$2 and (user_id=$3 or visibility='project')`,
        [filterId, this.scope.projectId, this.scope.actor.actorId],
      );
      if (!visible.rowCount)
        throw new RepositoryError('TASK_FILTER_NOT_FOUND', 404, 'Saved filter was not found.');
      if (favorite) {
        await client.query(
          `insert into task_saved_filter_favorites (filter_id,user_id) values ($1,$2)
           on conflict do nothing`,
          [filterId, this.scope.actor.actorId],
        );
      } else {
        await client.query(
          `delete from task_saved_filter_favorites where filter_id=$1 and user_id=$2`,
          [filterId, this.scope.actor.actorId],
        );
      }
      await appendAudit(
        client,
        this.savedFilterAudit(
          favorite ? 'task_filter.favorited' : 'task_filter.unfavorited',
          filterId,
          requestId,
        ),
      );
    });
    return { favorite };
  }

  async getFlowInsights(windowDays = 30, staleAfterDays = 7): Promise<TaskFlowInsights> {
    const safeWindowDays = Math.max(7, Math.min(Math.trunc(windowDays), 365));
    const safeStaleAfterDays = Math.max(1, Math.min(Math.trunc(staleAfterDays), 90));
    const result = await this.pool.query<{
      calculated_at: Date;
      summary: TaskFlowInsights['summary'];
      statuses: TaskFlowInsights['statuses'];
      aging_tasks: TaskFlowInsights['aging_tasks'];
      completed_tasks: TaskFlowInsights['completed_tasks'];
      flow_statuses: TaskFlowInsights['flow_statuses'];
      flow_series: TaskFlowInsights['flow_series'];
      throughput_series: TaskFlowInsights['throughput_series'];
    }>(
      `with visible_tasks as materialized (
         select t.id from tasks t
         where t.project_id=$1 and ${this.taskVisibilityPredicate('t')}
       ), all_workflow as materialized (
         select key,name,category,color,position,wip_limit,archived_at
         from task_workflow_statuses
         where project_id=$1
       ), workflow as materialized (
         select key,name,category,color,position,wip_limit
         from all_workflow where archived_at is null
       ), latest_history as materialized (
         select distinct on (h.task_id) h.task_id,h.changed_at
         from task_status_history h
         where h.project_id=$1
         order by h.task_id,h.changed_at desc,h.id desc
       ), current_tasks as materialized (
         select t.id,t.task_number,t.title,t.status,t.assignee_id,u.display_name assignee_name,
           w.name status_name,w.category,w.position,w.wip_limit,
           greatest(0,extract(epoch from (now()-coalesce(h.changed_at,t.created_at)))/3600) age_hours
         from tasks t
         join visible_tasks visible on visible.id=t.id
         join workflow w on w.key=t.status
         left join latest_history h on h.task_id=t.id
         left join users u on u.id=t.assignee_id
         where t.project_id=$1 and t.archived_at is null
       ), status_stats as materialized (
         select w.key,w.name,w.category,w.color,w.position,w.wip_limit,
           count(c.id)::int current_count,
           case when w.category='done' or count(c.id)=0 then null
             else round(avg(c.age_hours)::numeric,1)::float8 end average_age_hours,
           case when w.category='done' or count(c.id)=0 then null
             else round(max(c.age_hours)::numeric,1)::float8 end oldest_age_hours,
           count(c.id) filter (
             where w.category<>'done' and c.age_hours >= $3::int*24
           )::int stale_count
         from workflow w left join current_tasks c on c.status=w.key
         group by w.key,w.name,w.category,w.color,w.position,w.wip_limit
       ), history as materialized (
         select h.task_id,h.to_status status,h.changed_at,w.category,
           lead(h.changed_at) over (partition by h.task_id order by h.changed_at,h.id) next_at
         from task_status_history h join visible_tasks visible on visible.id=h.task_id
         join all_workflow w on w.key=h.to_status
         where h.project_id=$1
       ), lifecycle_events as materialized (
         select t.id task_id,t.created_at changed_at,true active,
           '00000000-0000-0000-0000-000000000000'::uuid event_id
         from tasks t join visible_tasks visible on visible.id=t.id where t.project_id=$1
         union all
         select e.target_id task_id,e.created_at changed_at,e.action='task.restored' active,e.id event_id
         from audit_events e
         where e.project_id=$1 and e.target_type='task' and e.target_id is not null
           and e.action in ('task.archived','task.restored')
           and exists(select 1 from visible_tasks visible where visible.id=e.target_id)
       ), lifecycle as materialized (
         select task_id,changed_at,active,
           lead(changed_at) over (partition by task_id order by changed_at,event_id) next_at
         from lifecycle_events
       ), bounds as materialized (
         select (now() at time zone 'UTC')::date end_date,
           (now() at time zone 'UTC')::date-($2::int-1) start_date
       ), days as materialized (
         select bucket_at::date bucket_date
         from bounds b cross join lateral generate_series(
           b.start_date,b.end_date,interval '1 day'
         ) bucket_at
       ), active_status_intervals as materialized (
         select h.task_id,h.status,
           greatest(h.changed_at,l.changed_at) started_at,
           least(
             coalesce(h.next_at,'infinity'::timestamptz),
             coalesce(l.next_at,'infinity'::timestamptz)
           ) ended_at
         from history h join lifecycle l on l.task_id=h.task_id and l.active is true
           and h.changed_at<coalesce(l.next_at,'infinity'::timestamptz)
           and l.changed_at<coalesce(h.next_at,'infinity'::timestamptz)
       ), flow_deltas as materialized (
         select status,(started_at at time zone 'UTC')::date bucket_date,1 delta
         from active_status_intervals
         union all
         select status,(ended_at at time zone 'UTC')::date bucket_date,-1 delta
         from active_status_intervals where ended_at<'infinity'::timestamptz
       ), flow_daily_deltas as materialized (
         select status,bucket_date,sum(delta)::int delta
         from flow_deltas group by status,bucket_date
       ), flow_opening as materialized (
         select f.status,sum(f.delta)::int count
         from flow_deltas f cross join bounds b
         where f.bucket_date<b.start_date group by f.status
       ), flow_counts as materialized (
         select d.bucket_date,w.key,w.position,
           greatest(0,
             coalesce(o.count,0)+sum(coalesce(f.delta,0)) over (
               partition by w.key order by d.bucket_date rows unbounded preceding
             )
           )::int count
         from days d cross join all_workflow w
         left join flow_daily_deltas f on f.status=w.key and f.bucket_date=d.bucket_date
         left join flow_opening o on o.status=w.key
       ), completions as materialized (
         select distinct on (h.task_id) h.task_id,h.changed_at completed_at
         from history h
         join current_tasks c on c.id=h.task_id and c.category='done'
         where h.category='done' and h.changed_at >= now()-make_interval(days=>$2::int)
         order by h.task_id,h.changed_at desc
       ), completed_cycle as materialized (
         select c.task_id,c.completed_at,
           coalesce(sum(greatest(0,extract(epoch from (
             least(coalesce(h.next_at,c.completed_at),c.completed_at)-h.changed_at
           )))) filter (where h.category='in_progress'),0)/3600 cycle_time_hours
         from completions c left join history h
           on h.task_id=c.task_id and h.changed_at<c.completed_at
         group by c.task_id,c.completed_at
       ), completed_stats as materialized (
         select count(*)::int completed_count,
           round(avg(cycle_time_hours)::numeric,1)::float8 average_cycle_hours,
           round(percentile_cont(0.5) within group (order by cycle_time_hours)::numeric,1)::float8 median_cycle_hours,
           round(percentile_cont(0.85) within group (order by cycle_time_hours)::numeric,1)::float8 p85_cycle_hours
         from completed_cycle
       ), created_daily as materialized (
         select (t.created_at at time zone 'UTC')::date bucket_date,count(*)::int created_count
         from tasks t join visible_tasks visible on visible.id=t.id
         where t.project_id=$1 and t.created_at>=now()-make_interval(days=>$2::int)
         group by (t.created_at at time zone 'UTC')::date
       ), completed_daily as materialized (
         select (c.completed_at at time zone 'UTC')::date bucket_date,count(*)::int completed_count
         from completions c group by (c.completed_at at time zone 'UTC')::date
       ), throughput_daily as materialized (
         select d.bucket_date,coalesce(created.created_count,0)::int created_count,
           coalesce(completed.completed_count,0)::int completed_count
         from days d
         left join created_daily created on created.bucket_date=d.bucket_date
         left join completed_daily completed on completed.bucket_date=d.bucket_date
       )
       select now() calculated_at,
         jsonb_build_object(
           'active_count',(select count(*)::int from current_tasks where category<>'done'),
           'wip_count',(select count(*)::int from current_tasks where category='in_progress'),
           'stale_count',(select count(*)::int from current_tasks where category<>'done' and age_hours >= $3::int*24),
           'completed_count',coalesce(cs.completed_count,0),
           'average_cycle_hours',cs.average_cycle_hours,
           'median_cycle_hours',cs.median_cycle_hours,
           'p85_cycle_hours',cs.p85_cycle_hours
         ) summary,
         coalesce((select jsonb_agg(to_jsonb(s) order by s.position) from status_stats s),'[]'::jsonb) statuses,
         coalesce((select jsonb_agg(to_jsonb(a) order by a.age_hours desc,a.id) from (
           select c.id,p.key||'-'||c.task_number task_key,c.title,c.status,c.status_name,
             c.assignee_name,round(c.age_hours::numeric,1)::float8 age_hours
           from current_tasks c join projects p on p.id=$1
           where c.category<>'done'
           order by c.age_hours desc,c.id limit 5
         ) a),'[]'::jsonb) aging_tasks,
         coalesce((select jsonb_agg(to_jsonb(done) order by done.completed_at desc,done.id) from (
           select t.id,p.key||'-'||t.task_number task_key,t.title,c.completed_at,
             round(c.cycle_time_hours::numeric,1)::float8 cycle_time_hours
           from completed_cycle c join tasks t on t.id=c.task_id join projects p on p.id=t.project_id
           order by c.completed_at desc,t.id limit 50
         ) done),'[]'::jsonb) completed_tasks,
         coalesce((select jsonb_agg(jsonb_build_object(
           'key',w.key,'name',w.name,'color',w.color,'position',w.position,
           'archived',w.archived_at is not null
         ) order by w.position,w.key) from all_workflow w),'[]'::jsonb) flow_statuses,
         coalesce((select jsonb_agg(jsonb_build_object(
           'date',to_char(series.bucket_date,'YYYY-MM-DD'),'counts',series.counts
         ) order by series.bucket_date) from (
           select f.bucket_date,jsonb_object_agg(f.key,f.count order by f.position,f.key) counts
           from flow_counts f group by f.bucket_date
         ) series),'[]'::jsonb) flow_series,
         coalesce((select jsonb_agg(jsonb_build_object(
           'date',to_char(t.bucket_date,'YYYY-MM-DD'),
           'created_count',t.created_count,'completed_count',t.completed_count
         ) order by t.bucket_date) from throughput_daily t),'[]'::jsonb) throughput_series
       from completed_stats cs`,
      [this.scope.projectId, safeWindowDays, safeStaleAfterDays],
    );
    const row = result.rows[0];
    if (!row) throw new RepositoryError('TASK_FLOW_UNAVAILABLE', 500, 'Flow insights unavailable.');
    return {
      calculated_at: row.calculated_at.toISOString(),
      window_days: safeWindowDays,
      stale_after_days: safeStaleAfterDays,
      summary: row.summary,
      statuses: row.statuses,
      aging_tasks: row.aging_tasks,
      completed_tasks: row.completed_tasks,
      flow_statuses: row.flow_statuses,
      flow_series: row.flow_series,
      throughput_series: row.throughput_series,
    };
  }

  async listTasks(options: TaskListOptions): Promise<TaskListPage> {
    const limit = Math.max(1, Math.min(options.limit ?? 100, 100));
    const offset = Math.max(0, options.offset ?? 0);
    const query = options.query?.trim() ? options.query.trim().replace(/[\\%_]/g, '\\$&') : null;
    const assigneeId =
      options.assignee === 'mine'
        ? this.scope.actor.actorId
        : options.assignee && options.assignee !== 'unassigned'
          ? options.assignee
          : null;
    const unassigned = options.assignee === 'unassigned';
    const archiveState = options.archiveState ?? (options.includeArchived ? 'all' : 'active');
    const labels = normalizeTaskLabels(options.labels);
    const statuses = [...new Set((options.statuses ?? []).map((value) => value.trim()))].filter(
      Boolean,
    );
    const direction = options.direction === 'desc' ? 'desc' : 'asc';
    const sort = options.sort ?? 'rank';
    const rootSort = {
      title: 'lower(root.title)',
      status: 'root_workflow.position',
      priority:
        "case root.priority when 'low' then 0 when 'medium' then 1 when 'high' then 2 else 3 end",
      assignee: 'lower(root_assignee.display_name)',
      dueDate: 'root.due_date',
    }[sort === 'rank' ? 'title' : sort];
    const childSort = {
      title: 'lower(t.title)',
      status: 'workflow_status.position',
      priority:
        "case t.priority when 'low' then 0 when 'medium' then 1 when 'high' then 2 else 3 end",
      assignee: 'lower(u.display_name)',
      dueDate: 't.due_date',
    }[sort === 'rank' ? 'title' : sort];
    const rootOrder =
      sort === 'rank'
        ? `root_workflow.position ${direction},root.board_position ${direction}`
        : `${rootSort} ${direction} nulls last`;
    const childOrder =
      sort === 'rank'
        ? `workflow_status.position ${direction},t.board_position ${direction}`
        : `${childSort} ${direction} nulls last`;
    const order = `${rootOrder},root.id,
       case when t.parent_task_id is null then 0 else 1 end,
       ${childOrder},t.id`;
    const parameters = [
      this.scope.projectId,
      archiveState,
      options.entityId ?? null,
      options.entityType ?? null,
      query,
      assigneeId,
      unassigned,
      options.priority ?? null,
      labels.length ? labels : null,
      statuses.length ? statuses : null,
      options.taskIds?.length ? options.taskIds : null,
      options.hasDueDate ?? false,
    ];
    const filter = `from tasks t join projects p on p.id=t.project_id
       left join users u on u.id=t.assignee_id
       left join tasks parent on parent.project_id=t.project_id and parent.id=t.parent_task_id
        and ${this.taskVisibilityPredicate('parent')}
       where t.project_id=$1 and ${this.taskVisibilityPredicate('t')}
       and ($2::text='all' or ($2::text='active' and t.archived_at is null) or ($2::text='archived' and t.archived_at is not null))
       and (($3::uuid is null and $4::text is null) or exists(
         select 1 from task_links f where f.task_id=t.id and f.project_id=t.project_id
          and not exists(select 1 from task_link_removals fr where fr.link_id=f.id)
          and ($3::uuid is null or f.entity_id=$3) and ($4::text is null or f.entity_type=$4)))
       and ($5::text is null or concat_ws(' ',p.key||'-'||t.task_number::text,t.title,t.description,u.display_name,array_to_string(t.labels,' '),p.key||'-'||parent.task_number::text,parent.title) ilike '%'||$5||'%' escape '\\')
       and ($6::uuid is null or t.assignee_id=$6)
       and (not $7::boolean or t.assignee_id is null)
       and ($8::text is null or t.priority=$8::task_priority)
       and ($9::text[] is null or t.labels @> $9)
       and ($10::text[] is null or t.status=any($10))
       and ($11::uuid[] is null or t.id=any($11))
       and (not $12::boolean or t.due_date is not null)`;
    const totalResult = await this.pool.query<{ count: number }>(
      `select count(*)::int count ${filter}`,
      parameters,
    );
    const result = await this.pool.query<TaskListRow>(
      `select t.*,p.key||'-'||t.task_number task_key,t.due_date::text due_date,u.display_name assignee_name,
       creator.display_name created_by_name,
       case when parent.id is null then null else p.key||'-'||parent.task_number end parent_task_key,
       parent.title parent_task_title,
       workflow_status.category status_category,
       (select count(*)::int from tasks child where child.project_id=t.project_id
         and child.parent_task_id=t.id and child.archived_at is null
         and ${this.taskVisibilityPredicate('child')}) child_count,
       (select count(*)::int from tasks child
         join task_workflow_statuses child_status on child_status.project_id=child.project_id and child_status.key=child.status
         where child.project_id=t.project_id and child.parent_task_id=t.id
           and child.archived_at is null and child_status.category='done'
           and ${this.taskVisibilityPredicate('child')}) child_done_count,
       (select count(*)::int from task_relationships tr join tasks blocker
        on blocker.project_id=tr.project_id and blocker.id=tr.source_task_id
        join task_workflow_statuses blocker_status on blocker_status.project_id=blocker.project_id and blocker_status.key=blocker.status
        where tr.project_id=t.project_id and tr.target_task_id=t.id and tr.relation_type='blocks'
          and blocker_status.category<>'done' and blocker.archived_at is null
          and ${this.taskVisibilityPredicate('blocker')}) open_blocker_count,
       (select coalesce(sum(w.duration_minutes),0)::int from task_worklogs w
        where w.project_id=t.project_id and w.task_id=t.id and w.deleted_at is null) time_spent_minutes,
       coalesce(json_agg(distinct l) filter(where l.id is not null),'[]') links
       from tasks t join projects p on p.id=t.project_id
       join task_workflow_statuses workflow_status on workflow_status.project_id=t.project_id and workflow_status.key=t.status
       left join users u on u.id=t.assignee_id
       join users creator on creator.id=t.created_by
       left join tasks parent on parent.project_id=t.project_id and parent.id=t.parent_task_id
        and ${this.taskVisibilityPredicate('parent')}
       join tasks root on root.project_id=t.project_id and root.id=coalesce(t.parent_task_id,t.id)
       join task_workflow_statuses root_workflow on root_workflow.project_id=root.project_id and root_workflow.key=root.status
       left join users root_assignee on root_assignee.id=root.assignee_id
       left join task_links l on l.task_id=t.id and l.project_id=t.project_id
        and not exists(select 1 from task_link_removals lr where lr.link_id=l.id)
       where t.project_id=$1 and ${this.taskVisibilityPredicate('t')}
       and ($2::text='all' or ($2::text='active' and t.archived_at is null) or ($2::text='archived' and t.archived_at is not null))
       and (($3::uuid is null and $4::text is null) or exists(
         select 1 from task_links f where f.task_id=t.id and f.project_id=t.project_id
          and not exists(select 1 from task_link_removals fr where fr.link_id=f.id)
          and ($3::uuid is null or f.entity_id=$3) and ($4::text is null or f.entity_type=$4)))
       and ($5::text is null or concat_ws(' ',p.key||'-'||t.task_number::text,t.title,t.description,u.display_name,array_to_string(t.labels,' '),p.key||'-'||parent.task_number::text,parent.title) ilike '%'||$5||'%' escape '\\')
       and ($6::uuid is null or t.assignee_id=$6)
       and (not $7::boolean or t.assignee_id is null)
       and ($8::text is null or t.priority=$8::task_priority)
       and ($9::text[] is null or t.labels @> $9)
       and ($10::text[] is null or t.status=any($10))
       and ($11::uuid[] is null or t.id=any($11))
       and (not $12::boolean or t.due_date is not null)
       group by t.id,p.key,u.display_name,creator.display_name,parent.id,parent.task_number,parent.title,workflow_status.position,workflow_status.category,
         root.id,root_workflow.position,root_assignee.display_name order by ${order}
       limit $13 offset $14`,
      [...parameters, limit, offset],
    );
    const total = Number(totalResult.rows[0]?.count ?? 0);
    return {
      items: result.rows,
      pageInfo: {
        limit,
        offset,
        total,
        hasNext: offset + result.rows.length < total,
      },
    };
  }

  async listLabels(query = '', limit = 100) {
    const normalizedQuery = query.normalize('NFKC').trim().toLocaleLowerCase('en-US');
    const escapedQuery = normalizedQuery.replace(/[\\%_]/g, '\\$&');
    const boundedLimit = Math.max(1, Math.min(limit, 200));
    const result = await this.pool.query<{ value: string; count: number }>(
      `select label value,count(*)::int count from tasks t cross join lateral unnest(t.labels) label
       where t.project_id=$1 and t.archived_at is null
         and ${this.taskVisibilityPredicate('t')}
         and ($2::text='' or label ilike '%'||$2||'%' escape '\\')
       group by label order by count(*) desc,label limit $3`,
      [this.scope.projectId, escapedQuery, boundedLimit],
    );
    return result.rows;
  }

  async listCandidates(
    options: { query?: string; topLevelOnly?: boolean; limit?: number; offset?: number } = {},
  ): Promise<TaskListPage<TaskCandidate>> {
    const normalizedQuery = (options.query ?? '').normalize('NFKC').trim();
    const escapedQuery = normalizedQuery.replace(/[\\%_]/g, '\\$&');
    const topLevelOnly = options.topLevelOnly ?? false;
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    const offset = Math.max(0, Math.min(options.offset ?? 0, 1_000_000));
    const parameters = [this.scope.projectId, escapedQuery, topLevelOnly];
    const predicate = `t.project_id=$1 and t.archived_at is null
      and ${this.taskVisibilityPredicate('t')}
      and (not $3::boolean or t.parent_task_id is null)
      and ($2::text='' or p.key||'-'||t.task_number::text ilike '%'||$2||'%' escape '\\'
        or t.title ilike '%'||$2||'%' escape '\\')`;
    const [count, result] = await Promise.all([
      this.pool.query<{ count: number }>(
        `select count(*)::int count from tasks t join projects p on p.id=t.project_id
         where ${predicate}`,
        parameters,
      ),
      this.pool.query<TaskCandidate>(
        `select t.id,p.key||'-'||t.task_number task_key,t.title,t.parent_task_id,
       (select count(*)::int from tasks child where child.project_id=t.project_id
         and child.parent_task_id=t.id and child.archived_at is null) child_count
       from tasks t join projects p on p.id=t.project_id
       where ${predicate}
       order by t.task_number desc,t.id desc limit $4 offset $5`,
        [...parameters, limit, offset],
      ),
    ]);
    const total = count.rows[0]?.count ?? 0;
    return {
      items: result.rows,
      pageInfo: { limit, offset, total, hasNext: offset + result.rows.length < total },
    };
  }

  private async loadTaskActivity(
    taskId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<TaskActivityPage> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const offset = Math.max(0, Math.min(options.offset ?? 0, 1_000_000));
    const activityIndex = await this.pool.query<{
      items: Array<{ kind: 'status' | 'comment' | 'change' | 'link'; id: string }>;
      total: number;
    }>(
      `with activity as materialized (
         select 'status'::text kind,h.id,h.changed_at activity_at
         from task_status_history h where h.project_id=$1 and h.task_id=$2
         union all
         select 'comment',c.id,coalesce(c.edited_at,c.created_at)
         from task_comments c where c.project_id=$1 and c.task_id=$2
         union all
         select 'change',a.id,a.created_at
         from audit_events a
         where a.project_id=$1 and a.target_type='task' and a.target_id=$2
           and a.action in ('task.updated','task.automated')
           and jsonb_typeof(a.payload->'changes')='object'
           and exists (
             select 1 from jsonb_each(a.payload->'changes') change
             where change.key=any($3::text[]) and jsonb_typeof(change.value)='object'
               and ((change.value->>'changed')='true'
                 or change.value->'from' is distinct from change.value->'to')
           )
         union all
         select 'link',a.id,a.created_at
         from audit_events a
         where a.project_id=$1 and a.target_type='task' and a.target_id=$2
           and a.action in ('task.link_added','task.link_removed')
       ), page as (
         select kind,id,activity_at from activity
         order by activity_at desc,kind desc,id desc limit $4 offset $5
       )
       select coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'id',id)
         order by activity_at desc,kind desc,id desc) from page),'[]'::jsonb) items,
         (select count(*)::int from activity) total`,
      [this.scope.projectId, taskId, taskChangeFields, limit, offset],
    );
    const selected = activityIndex.rows[0]?.items ?? [];
    const idsFor = (kind: (typeof selected)[number]['kind']) =>
      selected.filter((item) => item.kind === kind).map((item) => item.id);
    const statusIds = idsFor('status');
    const commentIds = idsFor('comment');
    const changeIds = idsFor('change');
    const linkIds = idsFor('link');
    const [history, comments, changeHistory, linkHistory] = await Promise.all([
      this.pool.query<{
        id: string;
        from_status: TaskStatus | null;
        to_status: TaskStatus;
        changed_by: string;
        changed_by_name: string;
        changed_at: Date;
      }>(
        `select h.id,h.from_status,h.to_status,h.changed_by,u.display_name changed_by_name,
          h.changed_at from task_status_history h join users u on u.id=h.changed_by
         where h.project_id=$1 and h.task_id=$2 and h.id=any($3::uuid[])
         order by h.changed_at,h.id`,
        [this.scope.projectId, taskId, statusIds],
      ),
      this.pool.query<{
        id: string;
        body: string;
        author_id: string;
        author_name: string;
        row_version: number;
        edited_at: Date | null;
        created_at: Date;
        mentions: TaskComment['mentions'];
        revision_count: number;
      }>(
        `select c.id,c.body,c.author_id,u.display_name author_name,c.row_version,c.edited_at,c.created_at,
          greatest(c.row_version-1,0)::int revision_count,
          coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'displayName',mu.display_name)
            order by lower(mu.display_name),m.user_id) from task_comment_mentions m
            join users mu on mu.id=m.user_id where m.comment_id=c.id),'[]'::jsonb) mentions
         from task_comments c join users u on u.id=c.author_id
         where c.project_id=$1 and c.task_id=$2 and c.id=any($3::uuid[])
         order by coalesce(c.edited_at,c.created_at),c.id`,
        [this.scope.projectId, taskId, commentIds],
      ),
      this.pool.query<{
        id: string;
        action: 'task.updated' | 'task.automated';
        changed_by_name: string;
        changed_at: Date;
        payload: Record<string, unknown>;
      }>(
        `select a.id,a.action,u.display_name changed_by_name,a.created_at changed_at,a.payload
         from audit_events a join users u on u.id=a.actor_id
         where a.project_id=$1 and a.target_type='task' and a.target_id=$2
           and a.id=any($3::uuid[]) order by a.created_at,a.id`,
        [this.scope.projectId, taskId, changeIds],
      ),
      this.pool.query<{
        id: string;
        action: 'task.link_added' | 'task.link_removed';
        changed_by_name: string;
        changed_at: Date;
        payload: Record<string, unknown>;
      }>(
        `select a.id,a.action,u.display_name changed_by_name,a.created_at changed_at,a.payload
         from audit_events a join users u on u.id=a.actor_id
         where a.project_id=$1 and a.target_type='task' and a.target_id=$2
           and a.id=any($3::uuid[]) order by a.created_at,a.id`,
        [this.scope.projectId, taskId, linkIds],
      ),
    ]);
    const total = activityIndex.rows[0]?.total ?? 0;
    return {
      status_history: history.rows.map((entry) => ({
        ...entry,
        changed_at: entry.changed_at.toISOString(),
      })),
      comments: comments.rows.map((comment) => ({
        ...comment,
        revisions: [],
        edited_at: comment.edited_at?.toISOString() ?? null,
        created_at: comment.created_at.toISOString(),
      })),
      change_history: changeHistory.rows.map((entry) => ({
        id: entry.id,
        action: entry.action,
        changed_by_name: entry.changed_by_name,
        changed_at: entry.changed_at.toISOString(),
        automation_rule_name:
          typeof entry.payload.ruleName === 'string' ? entry.payload.ruleName : null,
        changes: taskChanges(entry.payload),
      })),
      link_history: linkHistory.rows.map((entry) => ({
        id: entry.id,
        action: entry.action,
        changed_by_name: entry.changed_by_name,
        changed_at: entry.changed_at.toISOString(),
        link_id: typeof entry.payload.linkId === 'string' ? entry.payload.linkId : '',
        entity_type:
          typeof entry.payload.entityType === 'string'
            ? (entry.payload.entityType as TaskEntityType)
            : 'external_source',
        entity_id: typeof entry.payload.entityId === 'string' ? entry.payload.entityId : '',
        title: typeof entry.payload.title === 'string' ? entry.payload.title : null,
        url: typeof entry.payload.url === 'string' ? entry.payload.url : null,
      })),
      pageInfo: { limit, offset, total, hasNext: offset + selected.length < total },
    };
  }

  async getTaskActivity(
    taskId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<TaskActivityPage> {
    await this.assertTaskVisible(taskId);
    return this.loadTaskActivity(taskId, options);
  }

  async listTaskWorklogs(
    taskId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<TaskWorklogPage> {
    await this.assertTaskVisible(taskId);
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    const offset = Math.max(0, Math.min(options.offset ?? 0, 1_000_000));
    const task = await this.pool.query<{ total: number }>(
      `select count(w.id)::int total
       from tasks t left join task_worklogs w on w.project_id=t.project_id and w.task_id=t.id
        and w.deleted_at is null
       where t.project_id=$1 and t.id=$2
       group by t.id`,
      [this.scope.projectId, taskId],
    );
    if (!task.rowCount) throw new RepositoryError('TASK_NOT_FOUND', 404, 'Task was not found.');
    const result = await this.pool.query<{
      id: string;
      duration_minutes: number;
      started_at: Date;
      note: string;
      author_id: string;
      author_name: string;
      remaining_estimate_before: number | null;
      remaining_estimate_after: number | null;
      row_version: number;
      created_at: Date;
      updated_at: Date;
      can_edit: boolean;
    }>(
      `select w.id,w.duration_minutes,w.started_at,w.note,w.author_id,u.display_name author_name,
        w.remaining_estimate_before,w.remaining_estimate_after,w.row_version,w.created_at,w.updated_at,
        ((w.author_id=$5 or $6::boolean) and t.archived_at is null) can_edit
       from tasks t left join task_worklogs w on w.project_id=t.project_id and w.task_id=t.id
        and w.deleted_at is null
       left join users u on u.id=w.author_id
       where t.project_id=$1 and t.id=$2 and w.id is not null
       order by w.started_at desc,w.id desc limit $3 offset $4`,
      [
        this.scope.projectId,
        taskId,
        limit,
        offset,
        this.scope.actor.actorId,
        ['owner', 'admin'].includes(this.scope.actor.role),
      ],
    );
    const total = task.rows[0]?.total ?? 0;
    return {
      items: result.rows.map((row) => ({
        ...row,
        started_at: row.started_at.toISOString(),
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      })),
      pageInfo: { limit, offset, total, hasNext: offset + result.rows.length < total },
    };
  }

  async getCommentRevisions(
    taskId: string,
    commentId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<TaskCommentRevisionPage> {
    await this.assertTaskVisible(taskId);
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    const offset = Math.max(0, Math.min(options.offset ?? 0, 1_000_000));
    const comment = await this.pool.query<{ total: number }>(
      `select greatest(c.row_version-1,0)::int total
       from task_comments c join tasks t on t.project_id=c.project_id and t.id=c.task_id
       where c.project_id=$1 and c.task_id=$2 and c.id=$3`,
      [this.scope.projectId, taskId, commentId],
    );
    if (!comment.rowCount)
      throw new RepositoryError('TASK_COMMENT_NOT_FOUND', 404, 'Task comment was not found.');
    const result = await this.pool.query<{
      id: string;
      created_at: Date;
      edited_by_name: string;
      payload: Record<string, unknown>;
      total: number;
    }>(
      `select a.id,a.created_at,u.display_name edited_by_name,a.payload,
        count(*) over()::int total
       from audit_events a join users u on u.id=a.actor_id
       where a.project_id=$1 and a.target_type='task' and a.target_id=$2
         and a.action='task.comment_edited' and a.payload->>'commentId'=$3
         and jsonb_typeof(a.payload->'previousMentions')='array'
       order by a.created_at desc,a.id desc limit $4 offset $5`,
      [this.scope.projectId, taskId, commentId, limit, offset],
    );
    const total = comment.rows[0]?.total ?? 0;
    const items = result.rows
      .map((entry) => ({
        revision:
          typeof entry.payload.fromRowVersion === 'number'
            ? entry.payload.fromRowVersion
            : Number(entry.payload.fromRowVersion),
        body: typeof entry.payload.previousBody === 'string' ? entry.payload.previousBody : '',
        mentions: Array.isArray(entry.payload.previousMentions)
          ? (entry.payload.previousMentions as TaskComment['mentions'])
          : [],
        edited_by_name: entry.edited_by_name,
        edited_at: entry.created_at.toISOString(),
      }))
      .sort((left, right) => left.edited_at.localeCompare(right.edited_at));
    return {
      items,
      pageInfo: { limit, offset, total, hasNext: offset + result.rows.length < total },
    };
  }

  async getTask(taskId: string) {
    await this.assertTaskVisible(taskId);
    const task = await this.pool.query(
      `select t.*,p.key||'-'||t.task_number task_key,t.due_date::text due_date,u.display_name assignee_name,
       creator.display_name created_by_name,
       case when parent.id is null then null else p.key||'-'||parent.task_number end parent_task_key,
       parent.title parent_task_title,
       workflow_status.category status_category,
       (select count(*)::int from tasks child where child.project_id=t.project_id
         and child.parent_task_id=t.id and child.archived_at is null
         and ${this.taskVisibilityPredicate('child')}) child_count,
       (select count(*)::int from tasks child
         join task_workflow_statuses child_status on child_status.project_id=child.project_id and child_status.key=child.status
         where child.project_id=t.project_id and child.parent_task_id=t.id
           and child.archived_at is null and child_status.category='done'
           and ${this.taskVisibilityPredicate('child')}) child_done_count,
       (select count(*)::int from task_relationships tr join tasks blocker
        on blocker.project_id=tr.project_id and blocker.id=tr.source_task_id
        join task_workflow_statuses blocker_status on blocker_status.project_id=blocker.project_id and blocker_status.key=blocker.status
        where tr.project_id=t.project_id and tr.target_task_id=t.id and tr.relation_type='blocks'
          and blocker_status.category<>'done' and blocker.archived_at is null
          and ${this.taskVisibilityPredicate('blocker')}) open_blocker_count,
       (select coalesce(sum(w.duration_minutes),0)::int from task_worklogs w
        where w.project_id=t.project_id and w.task_id=t.id and w.deleted_at is null) time_spent_minutes
       from tasks t join projects p on p.id=t.project_id
       join task_workflow_statuses workflow_status on workflow_status.project_id=t.project_id and workflow_status.key=t.status
       left join users u on u.id=t.assignee_id
       join users creator on creator.id=t.created_by
       left join tasks parent on parent.project_id=t.project_id and parent.id=t.parent_task_id
        and ${this.taskVisibilityPredicate('parent')}
       where t.project_id=$1 and t.id=$2`,
      [this.scope.projectId, taskId],
    );
    if (!task.rows[0]) throw new RepositoryError('TASK_NOT_FOUND', 404, 'Task was not found.');
    const [links, relationships, watchers, children, keyDates, activity, worklogs] =
      await Promise.all([
        this.pool.query(
          `select l.id,l.entity_type,l.entity_id,l.created_at,
          coalesce(s.title,f.original_name,r.display_name,d.name,
            case when mr.id is not null then concat_ws(' · ',mr_record.display_name,mr_field.name) end,
            case when evaluation.id is not null then concat_ws(' · ',evaluation_record.display_name,evaluation_field.name) end) title,
          case
            when r.id is not null then record_type.name
            when d.id is not null then concat_ws(' · ',d.dataset_type::text,d.status::text)
            when mr.id is not null then concat_ws(' ',mr.original_value::text,mr.original_unit)
            when evaluation.id is not null then evaluation.status::text
            else null
          end detail,
          record_type.public_id object_type_public_id,
          s.provider,s.url,s.external_id,
          coalesce(nullif(s.version,''),case when f.id is not null then 'v'||f.version_number::text end) version,
          s.observed_on::text observed_on,
          coalesce(s.archived_at,f.archived_at,fs.archived_at,r.archived_at,d.archived_at) archived_at,
          f.original_name,f.content_type,f.size_bytes::float8 size_bytes,
          fs.name file_series_name,f.version_number file_version_number,f.status::text file_status
         from task_links l
         left join external_sources s on s.project_id=l.project_id and s.id=l.entity_id
          and l.entity_type='external_source'
         left join file_objects f on f.project_id=l.project_id and f.id=l.entity_id
          and l.entity_type='file'
         left join file_series fs on fs.project_id=f.project_id and fs.id=f.file_series_id
         left join records r on r.project_id=l.project_id and r.id=l.entity_id
          and l.entity_type in ('record','sample','issue','test_run')
         left join object_types record_type on record_type.project_id=r.project_id
          and record_type.id=r.object_type_id
         left join datasets d on d.project_id=l.project_id and d.id=l.entity_id
          and l.entity_type='dataset'
         left join measurement_results mr on mr.project_id=l.project_id and mr.id=l.entity_id
          and l.entity_type='measurement_result'
         left join records mr_record on mr_record.project_id=mr.project_id and mr_record.id=mr.record_id
         left join field_definitions mr_field on mr_field.project_id=mr.project_id and mr_field.id=mr.field_id
         left join specification_evaluations evaluation on evaluation.project_id=l.project_id
          and evaluation.id=l.entity_id and l.entity_type='specification_evaluation'
         left join records evaluation_record on evaluation_record.project_id=evaluation.project_id
          and evaluation_record.id=evaluation.record_id
         left join field_definitions evaluation_field on evaluation_field.project_id=evaluation.project_id
          and evaluation_field.id=evaluation.measurement_field_id
         where l.project_id=$1 and l.task_id=$2
          and not exists(select 1 from task_link_removals r where r.link_id=l.id)
         order by l.created_at,l.id`,
          [this.scope.projectId, taskId],
        ),
        this.pool.query(
          `select r.id,r.relation_type,r.created_at,
          case when r.source_task_id=$2 then 'outward' else 'inward' end direction,
          related.id related_task_id,p.key||'-'||related.task_number related_task_key,
          related.title related_task_title,related.status related_task_status,
          related.archived_at related_task_archived_at
         from task_relationships r join tasks related on related.project_id=r.project_id
          and related.id=case when r.source_task_id=$2 then r.target_task_id else r.source_task_id end
         join projects p on p.id=r.project_id
         where r.project_id=$1 and (r.source_task_id=$2 or r.target_task_id=$2)
           and ${this.taskVisibilityPredicate('related')}
         order by r.created_at,r.id`,
          [this.scope.projectId, taskId],
        ),
        this.pool.query(
          `select w.user_id,u.display_name from task_watchers w join users u on u.id=w.user_id
         where w.project_id=$1 and w.task_id=$2 order by lower(u.display_name),w.created_at`,
          [this.scope.projectId, taskId],
        ),
        this.pool.query(
          `select child.id,p.key||'-'||child.task_number task_key,child.title,child.status,
           child_status.category status_category,child.assignee_id,u.display_name assignee_name,
           child.due_date::text due_date,child.archived_at
           from tasks child join projects p on p.id=child.project_id
           join task_workflow_statuses child_status
             on child_status.project_id=child.project_id and child_status.key=child.status
           left join users u on u.id=child.assignee_id
           where child.project_id=$1 and child.parent_task_id=$2
             and ${this.taskVisibilityPredicate('child')}
           order by child.archived_at nulls first,child.board_position,child.id`,
          [this.scope.projectId, taskId],
        ),
        this.pool.query(
          `select milestone.id,milestone.title,milestone.status,
          milestone.target_date::text target_date,milestone.archived_at
         from project_milestone_tasks link
         join project_milestones milestone
           on milestone.project_id=link.project_id and milestone.id=link.milestone_id
         where link.project_id=$1 and link.task_id=$2
         order by milestone.archived_at nulls first,milestone.target_date,milestone.id`,
          [this.scope.projectId, taskId],
        ),
        this.loadTaskActivity(taskId),
        this.listTaskWorklogs(taskId),
      ]);
    return {
      ...task.rows[0],
      links: links.rows.map((link) => ({
        ...link,
        created_at: link.created_at.toISOString(),
        archived_at: link.archived_at?.toISOString() ?? null,
      })),
      status_history: activity.status_history,
      watchers: watchers.rows,
      watcher_count: watchers.rowCount ?? watchers.rows.length,
      watching: watchers.rows.some((watcher) => watcher.user_id === this.scope.actor.actorId),
      comments: activity.comments,
      change_history: activity.change_history,
      link_history: activity.link_history,
      activity_page_info: activity.pageInfo,
      worklogs: worklogs.items,
      worklog_page_info: worklogs.pageInfo,
      relationships: relationships.rows.map((relationship) => ({
        ...relationship,
        related_task_archived_at: relationship.related_task_archived_at?.toISOString() ?? null,
        created_at: relationship.created_at.toISOString(),
      })),
      children: children.rows.map((child) => ({
        ...child,
        archived_at: child.archived_at?.toISOString() ?? null,
      })),
      linked_key_dates: keyDates.rows.map((keyDate) => ({
        ...keyDate,
        archived_at: keyDate.archived_at?.toISOString() ?? null,
      })),
    };
  }

  private async validateAssignee(client: PoolClient, assigneeId?: string | undefined) {
    if (!assigneeId) return;
    const found = await client.query(
      `select 1 from memberships m join users u on u.id=m.user_id
       where m.organization_id=$1 and m.user_id=$2 and u.disabled_at is null
         and project_visible_to($3,$4,$1,m.user_id,m.role::text)`,
      [this.scope.actor.organizationId, assigneeId, this.scope.projectId, this.scope.workspaceId],
    );
    if (!found.rowCount)
      throw new RepositoryError(
        'TASK_ASSIGNEE_INVALID',
        400,
        'Assignee is not an organization member.',
      );
  }

  private async validateParentTask(
    client: PoolClient,
    taskId: string | undefined,
    parentTaskId: string | null,
  ) {
    if (!parentTaskId) return;
    if (taskId === parentTaskId)
      throw new RepositoryError('TASK_PARENT_SELF', 400, 'A task cannot be its own parent.');
    const parent = await client.query<{ parent_task_id: string | null }>(
      `select parent_task_id from tasks t
       where project_id=$1 and id=$2 and archived_at is null
         and ${this.taskVisibilityPredicate('t')} for share`,
      [this.scope.projectId, parentTaskId],
    );
    if (!parent.rows[0])
      throw new RepositoryError(
        'TASK_PARENT_INVALID',
        400,
        'Parent task must be an active task in the same project.',
      );
    if (parent.rows[0].parent_task_id)
      throw new RepositoryError(
        'TASK_PARENT_DEPTH_LIMIT',
        409,
        'A subtask cannot be used as a parent task.',
      );
    if (!taskId) return;
    const child = await client.query(
      `select 1 from tasks
       where project_id=$1 and parent_task_id=$2 and archived_at is null limit 1`,
      [this.scope.projectId, taskId],
    );
    if (child.rowCount)
      throw new RepositoryError(
        'TASK_PARENT_HAS_CHILDREN',
        409,
        'A task with active subtasks cannot become a subtask.',
      );
  }

  private async rebalanceTaskRanks(client: PoolClient) {
    await client.query(
      `with ranked as (
         select id,(row_number() over(order by board_position,id)*$2)::int board_position
         from tasks where project_id=$1
       )
       update tasks t set board_position=ranked.board_position
       from ranked where t.project_id=$1 and t.id=ranked.id`,
      [this.scope.projectId, taskRankStep],
    );
  }

  private async recordAutomationExecution(
    client: PoolClient,
    input: {
      rule: AutomationRuleRow;
      taskId: string;
      event: TaskAutomationEvent;
      traceId: string;
      depth: number;
      outcome: 'succeeded' | 'no_change' | 'failed';
      changes?: Record<string, unknown>;
      errorCode?: string;
      startedAt: number;
    },
  ): Promise<void> {
    await client.query(
      `insert into task_automation_executions
       (id,project_id,rule_id,rule_name,trigger_type,trigger_event,task_id,trace_id,depth,
        outcome,changes,error_code,duration_ms,executed_by)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`,
      [
        uuidv7(),
        this.scope.projectId,
        input.rule.id,
        input.rule.name,
        input.event.type,
        JSON.stringify(input.event),
        input.taskId,
        input.traceId,
        input.depth,
        input.outcome,
        JSON.stringify(input.changes ?? {}),
        input.errorCode ?? null,
        Math.max(0, Date.now() - input.startedAt),
        this.scope.actor.actorId,
      ],
    );
    await client.query(
      `update task_automation_rules set execution_count=execution_count+1,
              last_executed_at=now(),updated_at=now()
       where project_id=$1 and id=$2`,
      [this.scope.projectId, input.rule.id],
    );
  }

  private async runAutomations(
    client: PoolClient,
    taskId: string,
    event: TaskAutomationEvent,
    requestId: string,
    context: { traceId: string; executedRuleIds: Set<string>; depth: number },
  ): Promise<void> {
    if (context.depth > 10) {
      await appendAudit(
        client,
        this.audit('task_automation.depth_limited', taskId, requestId, {
          traceId: context.traceId,
          event: event.type,
        }),
      );
      return;
    }
    let task = (
      await client.query<AutomationTaskState>(
        `select status,priority,assignee_id from tasks
         where project_id=$1 and id=$2 and archived_at is null for update`,
        [this.scope.projectId, taskId],
      )
    ).rows[0];
    if (!task) return;
    const rules = await client.query<AutomationRuleRow>(
      `select id,name,trigger_type,trigger_config,condition_config,action_config
       from task_automation_rules
       where project_id=$1 and active and archived_at is null and trigger_type=$2
       order by created_at,id`,
      [this.scope.projectId, event.type],
    );
    for (const rule of rules.rows) {
      if (
        context.executedRuleIds.has(rule.id) ||
        !automationTriggerMatches(rule, event) ||
        !automationConditionsMatch(rule.condition_config, task)
      )
        continue;
      context.executedRuleIds.add(rule.id);
      const startedAt = Date.now();
      const assigns = Object.prototype.hasOwnProperty.call(rule.action_config, 'assigneeId');
      const nextStatus = rule.action_config.status ?? task.status;
      const nextPriority = rule.action_config.priority ?? task.priority;
      const nextAssignee = assigns ? (rule.action_config.assigneeId ?? null) : task.assignee_id;
      const changedFields = [
        ...(task.status !== nextStatus ? ['status'] : []),
        ...(task.priority !== nextPriority ? ['priority'] : []),
        ...(task.assignee_id !== nextAssignee ? ['assigneeId'] : []),
      ];
      if (task.status !== nextStatus) {
        const allowed = await client.query(
          `select 1 from task_workflow_transitions
           where project_id=$1 and from_status=$2 and to_status=$3`,
          [this.scope.projectId, task.status, nextStatus],
        );
        if (!allowed.rowCount) {
          await this.recordAutomationExecution(client, {
            rule,
            taskId,
            event,
            traceId: context.traceId,
            depth: context.depth,
            outcome: 'failed',
            errorCode: 'TRANSITION_NOT_ALLOWED',
            startedAt,
          });
          continue;
        }
      }
      if (nextAssignee) {
        const activeMember = await client.query(
          `select 1 from memberships m join users u on u.id=m.user_id
           where m.organization_id=$1 and m.user_id=$2 and u.disabled_at is null`,
          [this.scope.actor.organizationId, nextAssignee],
        );
        if (!activeMember.rowCount) {
          await this.recordAutomationExecution(client, {
            rule,
            taskId,
            event,
            traceId: context.traceId,
            depth: context.depth,
            outcome: 'failed',
            errorCode: 'ASSIGNEE_UNAVAILABLE',
            startedAt,
          });
          continue;
        }
      }
      if (!changedFields.length) {
        await this.recordAutomationExecution(client, {
          rule,
          taskId,
          event,
          traceId: context.traceId,
          depth: context.depth,
          outcome: 'no_change',
          startedAt,
        });
        continue;
      }
      const before = task;
      await client.query(
        `update tasks set status=$3,priority=$4,assignee_id=$5,
                row_version=row_version+1,updated_at=now()
         where project_id=$1 and id=$2`,
        [this.scope.projectId, taskId, nextStatus, nextPriority, nextAssignee],
      );
      if (before.status !== nextStatus) {
        await client.query(
          `insert into task_status_history
           (id,project_id,task_id,from_status,to_status,changed_by)
           values ($1,$2,$3,$4,$5,$6)`,
          [
            uuidv7(),
            this.scope.projectId,
            taskId,
            before.status,
            nextStatus,
            this.scope.actor.actorId,
          ],
        );
      }
      if (nextAssignee) await this.addWatcher(client, taskId, nextAssignee);
      if (before.assignee_id !== nextAssignee && nextAssignee)
        await this.notify(
          client,
          taskId,
          'task.assigned',
          { automationRuleId: rule.id, automationRuleName: rule.name },
          { only: [nextAssignee] },
        );
      await this.notify(
        client,
        taskId,
        before.status === nextStatus ? 'task.updated' : 'task.status_changed',
        {
          automationRuleId: rule.id,
          automationRuleName: rule.name,
          ...(before.status === nextStatus ? {} : { from: before.status, to: nextStatus }),
        },
        nextAssignee ? { exclude: [nextAssignee] } : {},
      );
      const changes = {
        ...(before.status !== nextStatus
          ? { status: { from: before.status, to: nextStatus } }
          : {}),
        ...(before.priority !== nextPriority
          ? { priority: { from: before.priority, to: nextPriority } }
          : {}),
        ...(before.assignee_id !== nextAssignee
          ? { assigneeId: { from: before.assignee_id, to: nextAssignee } }
          : {}),
      };
      await this.recordAutomationExecution(client, {
        rule,
        taskId,
        event,
        traceId: context.traceId,
        depth: context.depth,
        outcome: 'succeeded',
        changes,
        startedAt,
      });
      await appendAudit(
        client,
        this.audit('task.automated', taskId, requestId, {
          ruleId: rule.id,
          ruleName: rule.name,
          traceId: context.traceId,
          depth: context.depth,
          fields: changedFields,
          changes,
        }),
      );
      const followUps: TaskAutomationEvent[] = [
        ...(before.status !== nextStatus
          ? [{ type: 'task.status_changed' as const, from: before.status, to: nextStatus }]
          : []),
        ...(before.priority !== nextPriority
          ? [
              {
                type: 'task.priority_changed' as const,
                from: before.priority,
                to: nextPriority,
              },
            ]
          : []),
        ...(before.assignee_id !== nextAssignee
          ? [
              {
                type: 'task.assignee_changed' as const,
                from: before.assignee_id,
                to: nextAssignee,
              },
            ]
          : []),
      ];
      for (const followUp of followUps)
        await this.runAutomations(client, taskId, followUp, requestId, {
          ...context,
          depth: context.depth + 1,
        });
      task = (
        await client.query<AutomationTaskState>(
          'select status,priority,assignee_id from tasks where project_id=$1 and id=$2',
          [this.scope.projectId, taskId],
        )
      ).rows[0]!;
    }
  }

  private async validateLink(client: PoolClient, link: TaskLinkInput) {
    let query: string;
    let parameters: unknown[] = [this.scope.projectId, link.entityId];
    if (['record', 'sample', 'issue', 'test_run'].includes(link.entityType)) {
      query = `select 1 from records r join object_types o on o.id=r.object_type_id and o.project_id=r.project_id
        where r.project_id=$1 and r.id=$2`;
      const recordKeyByType: Partial<Record<TaskEntityType, string>> = {
        sample: 'sample',
        issue: 'issue',
        test_run: 'test-run',
      };
      const expected = recordKeyByType[link.entityType];
      if (expected) {
        query += ' and o.key=$3';
        parameters = [...parameters, expected];
      }
    } else if (link.entityType === 'measurement_result')
      query = 'select 1 from measurement_results where project_id=$1 and id=$2';
    else if (link.entityType === 'specification_evaluation')
      query = 'select 1 from specification_evaluations where project_id=$1 and id=$2';
    else if (link.entityType === 'dataset')
      query = 'select 1 from datasets where project_id=$1 and id=$2';
    else if (link.entityType === 'file')
      query =
        "select 1 from file_objects where project_id=$1 and id=$2 and status='available' and archived_at is null";
    else query = 'select 1 from external_sources where project_id=$1 and id=$2';
    if (!(await client.query(query, parameters)).rowCount)
      throw new RepositoryError(
        'TASK_LINK_NOT_FOUND',
        400,
        'Linked engineering entity was not found.',
      );
  }

  private async insertLinks(client: PoolClient, taskId: string, links: TaskLinkInput[]) {
    const unique = new Map(links.map((link) => [`${link.entityType}:${link.entityId}`, link]));
    for (const link of unique.values()) {
      await this.validateLink(client, link);
      await client.query(
        'insert into task_links (id,project_id,task_id,entity_type,entity_id) values ($1,$2,$3,$4,$5)',
        [uuidv7(), this.scope.projectId, taskId, link.entityType, link.entityId],
      );
    }
  }

  async createTask(input: {
    title: string;
    description: string;
    status?: TaskStatus | undefined;
    priority: TaskPriority;
    visibility?: TaskVisibility | undefined;
    labels?: string[] | undefined;
    parentTaskId?: string | undefined;
    cloneSourceTaskId?: string | undefined;
    originEvaluationId?: string | undefined;
    assigneeId?: string | undefined;
    dueDate?: string | undefined;
    originalEstimateMinutes?: number | null | undefined;
    remainingEstimateMinutes?: number | null | undefined;
    links: TaskLinkInput[];
    idempotencyKey?: string | undefined;
    requestId: string;
  }) {
    const taskId = uuidv7();
    const creation = await transaction(this.pool, async (client) => {
      const labels = normalizeTaskLabels(input.labels);
      validateTaskEstimate(input.originalEstimateMinutes, 'Original estimate');
      validateTaskEstimate(input.remainingEstimateMinutes, 'Remaining estimate');
      const originalEstimateMinutes = input.originalEstimateMinutes ?? null;
      const remainingEstimateMinutes =
        input.remainingEstimateMinutes === undefined
          ? originalEstimateMinutes
          : input.remainingEstimateMinutes;
      const idempotencyScope = input.idempotencyKey
        ? {
            projectId: this.scope.projectId,
            actorId: this.scope.actor.actorId,
            operation: 'task.create' as const,
            idempotencyKey: input.idempotencyKey,
          }
        : undefined;
      const requestHash = hashIdempotencyPayload({
        title: input.title,
        description: input.description,
        status: input.status ?? null,
        priority: input.priority,
        visibility: input.visibility ?? 'project',
        labels,
        parentTaskId: input.parentTaskId ?? null,
        cloneSourceTaskId: input.cloneSourceTaskId ?? null,
        originEvaluationId: input.originEvaluationId ?? null,
        assigneeId: input.assigneeId ?? null,
        dueDate: input.dueDate ?? null,
        originalEstimateMinutes,
        remainingEstimateMinutes,
        links: input.links,
      });
      if (idempotencyScope) {
        const replayId = await claimProjectCreate(client, idempotencyScope, requestHash);
        if (replayId) return { resourceId: replayId, idempotentReplay: true };
      }
      await this.validateAssignee(client, input.assigneeId);
      const status = input.status ?? (await initialTaskStatus(client, this.scope.projectId));
      await assertTaskStatus(client, this.scope.projectId, status);
      await client.query('select pg_advisory_xact_lock(hashtextextended($1::text,1))', [
        this.scope.projectId,
      ]);
      if (input.originEvaluationId) {
        const existing = await client.query<{ task_id: string }>(
          `select l.task_id
           from task_links l
           join tasks t on t.id=l.task_id and t.project_id=l.project_id
           where l.project_id=$1
             and l.entity_type='specification_evaluation'
             and l.entity_id=$2
             and not exists(select 1 from task_link_removals r where r.link_id=l.id)
           order by t.created_at,l.id
           limit 1`,
          [this.scope.projectId, input.originEvaluationId],
        );
        if (existing.rows[0])
          return { resourceId: existing.rows[0].task_id, idempotentReplay: true };
      }
      await this.validateParentTask(client, undefined, input.parentTaskId ?? null);
      if (input.cloneSourceTaskId) {
        const source = await client.query(
          `select id from tasks t where project_id=$1 and id=$2 and archived_at is null
           and ${this.taskVisibilityPredicate('t')} for update`,
          [this.scope.projectId, input.cloneSourceTaskId],
        );
        if (!source.rowCount)
          throw new RepositoryError(
            'TASK_CLONE_SOURCE_INVALID',
            400,
            'The clone source must be an active task in this project.',
          );
      }
      let next = await client.query<{ task_number: number; board_position: number }>(
        `select coalesce(max(task_number),0)::int+1 task_number,
                coalesce(max(board_position),0)::int+$2 board_position
         from tasks where project_id=$1`,
        [this.scope.projectId, taskRankStep],
      );
      if ((next.rows[0]?.board_position ?? 0) >= taskRankRebalanceThreshold) {
        await this.rebalanceTaskRanks(client);
        next = await client.query<{ task_number: number; board_position: number }>(
          `select coalesce(max(task_number),0)::int+1 task_number,
                  coalesce(max(board_position),0)::int+$2 board_position
           from tasks where project_id=$1`,
          [this.scope.projectId, taskRankStep],
        );
      }
      await client.query(
        `insert into tasks
         (id,project_id,task_number,title,description,status,priority,visibility,labels,parent_task_id,board_position,
          assignee_id,due_date,original_estimate_minutes,remaining_estimate_minutes,created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          taskId,
          this.scope.projectId,
          next.rows[0]?.task_number ?? 1,
          input.title,
          input.description,
          status,
          input.priority,
          input.visibility ?? 'project',
          labels,
          input.parentTaskId ?? null,
          next.rows[0]?.board_position ?? taskRankStep,
          input.assigneeId ?? null,
          input.dueDate ?? null,
          originalEstimateMinutes,
          remainingEstimateMinutes,
          this.scope.actor.actorId,
        ],
      );
      await client.query(
        'insert into task_status_history (id,project_id,task_id,from_status,to_status,changed_by) values ($1,$2,$3,null,$4,$5)',
        [uuidv7(), this.scope.projectId, taskId, status, this.scope.actor.actorId],
      );
      await this.insertLinks(client, taskId, input.links);
      if (input.cloneSourceTaskId) {
        const relationshipId = uuidv7();
        const sourceTaskId = input.cloneSourceTaskId < taskId ? input.cloneSourceTaskId : taskId;
        const targetTaskId = sourceTaskId === taskId ? input.cloneSourceTaskId : taskId;
        await client.query(
          `insert into task_relationships
           (id,project_id,source_task_id,target_task_id,relation_type,created_by)
           values ($1,$2,$3,$4,'relates_to',$5)`,
          [
            relationshipId,
            this.scope.projectId,
            sourceTaskId,
            targetTaskId,
            this.scope.actor.actorId,
          ],
        );
        const clonePayload = {
          relationshipId,
          sourceTaskId: input.cloneSourceTaskId,
          clonedTaskId: taskId,
        };
        await appendAudit(client, this.audit('task.cloned', taskId, input.requestId, clonePayload));
        await this.notify(client, input.cloneSourceTaskId, 'task.updated', clonePayload);
      }
      const creatorPreferences = await notificationPreferencesForUser(
        client,
        this.scope.actor.organizationId,
        this.scope.actor.actorId,
      );
      if (creatorPreferences.autoWatchCreated)
        await this.addWatcher(client, taskId, this.scope.actor.actorId);
      if (input.assigneeId) await this.addWatcher(client, taskId, input.assigneeId);
      if (input.assigneeId)
        await this.notify(client, taskId, 'task.assigned', {}, { only: [input.assigneeId] });
      await appendAudit(client, this.audit('task.created', taskId, input.requestId));
      if (input.originEvaluationId)
        await appendAudit(
          client,
          this.audit('task.created_from_evaluation', taskId, input.requestId, {
            evaluationId: input.originEvaluationId,
          }),
        );
      await this.runAutomations(client, taskId, { type: 'task.created' }, input.requestId, {
        traceId: uuidv7(),
        executedRuleIds: new Set(),
        depth: 0,
      });
      await this.appendWebhookEvent(client, 'task.created', taskId);
      if (idempotencyScope)
        await rememberProjectCreate(client, idempotencyScope, requestHash, taskId);
      return { resourceId: taskId, idempotentReplay: false };
    });
    return {
      ...(await this.getTask(creation.resourceId)),
      idempotent_replay: creation.idempotentReplay,
    };
  }

  async createFromFailedEvaluation(evaluationId: string, requestId: string) {
    const evidence = await this.pool.query<{
      status: string;
      record_id: string;
      display_name: string;
      object_key: string;
      measurement_result_id: string | null;
      dataset_id: string | null;
    }>(
      `select e.status,e.record_id,r.display_name,o.key object_key,e.measurement_result_id,m.dataset_id
       from specification_evaluations e join records r on r.id=e.record_id and r.project_id=e.project_id
       join object_types o on o.id=r.object_type_id and o.project_id=r.project_id
       left join measurement_results m on m.id=e.measurement_result_id and m.project_id=e.project_id
       where e.project_id=$1 and e.id=$2`,
      [this.scope.projectId, evaluationId],
    );
    const row = evidence.rows[0];
    if (!row) throw new RepositoryError('EVALUATION_NOT_FOUND', 404, 'Evaluation was not found.');
    if (row.status !== 'fail')
      throw new RepositoryError(
        'EVALUATION_NOT_FAILED',
        409,
        'Only a failed evaluation can create a task.',
      );
    const specialized = { sample: 'sample', issue: 'issue', 'test-run': 'test_run' }[
      row.object_key
    ] as TaskEntityType | undefined;
    const links: TaskLinkInput[] = [
      { entityType: 'record', entityId: row.record_id },
      { entityType: 'specification_evaluation', entityId: evaluationId },
      ...(specialized ? [{ entityType: specialized, entityId: row.record_id }] : []),
      ...(row.measurement_result_id
        ? [{ entityType: 'measurement_result' as const, entityId: row.measurement_result_id }]
        : []),
      ...(row.dataset_id ? [{ entityType: 'dataset' as const, entityId: row.dataset_id }] : []),
    ];
    const task = await this.createTask({
      title: `Investigate failed specification: ${row.display_name}`,
      description: 'Created from a failed specification evaluation with exact evidence links.',
      priority: 'high',
      links,
      originEvaluationId: evaluationId,
      requestId,
    });
    return task;
  }

  async updateTask(
    taskId: string,
    input: {
      title: string;
      description: string;
      status: TaskStatus;
      priority: TaskPriority;
      labels?: string[] | undefined;
      parentTaskId?: string | null | undefined;
      assigneeId?: string | undefined;
      dueDate?: string | undefined;
      originalEstimateMinutes?: number | null | undefined;
      remainingEstimateMinutes?: number | null | undefined;
      rowVersion: number;
      requestId: string;
    },
  ) {
    await transaction(this.pool, async (client) => {
      const requestedLabels = input.labels ? normalizeTaskLabels(input.labels) : undefined;
      validateTaskEstimate(input.originalEstimateMinutes, 'Original estimate');
      validateTaskEstimate(input.remainingEstimateMinutes, 'Remaining estimate');
      await this.validateAssignee(client, input.assigneeId);
      await client.query('select pg_advisory_xact_lock(hashtextextended($1::text,1))', [
        this.scope.projectId,
      ]);
      const current = await client.query<{
        title: string;
        description: string;
        status: TaskStatus;
        priority: TaskPriority;
        assignee_id: string | null;
        due_date: string | null;
        labels: string[];
        parent_task_id: string | null;
        original_estimate_minutes: number | null;
        remaining_estimate_minutes: number | null;
      }>(
        `select title,description,status,priority,labels,parent_task_id,assignee_id,
          due_date::text due_date,original_estimate_minutes,remaining_estimate_minutes
         from tasks where project_id=$1 and id=$2 and archived_at is null and row_version=$3 for update`,
        [this.scope.projectId, taskId, input.rowVersion],
      );
      if (!current.rows[0])
        throw new RepositoryError('TASK_VERSION_CONFLICT', 409, 'Task changed or is unavailable.');
      const labels = requestedLabels ?? current.rows[0].labels;
      const parentTaskId =
        input.parentTaskId === undefined ? current.rows[0].parent_task_id : input.parentTaskId;
      const originalEstimateMinutes =
        input.originalEstimateMinutes === undefined
          ? current.rows[0].original_estimate_minutes
          : input.originalEstimateMinutes;
      const remainingEstimateMinutes =
        input.remainingEstimateMinutes === undefined
          ? current.rows[0].remaining_estimate_minutes
          : input.remainingEstimateMinutes;
      if (parentTaskId !== current.rows[0].parent_task_id)
        await this.validateParentTask(client, taskId, parentTaskId);
      await assertTaskTransition(
        client,
        this.scope.projectId,
        current.rows[0].status,
        input.status,
      );
      await client.query(
        `update tasks set title=$4,description=$5,status=$6,priority=$7,labels=$8,parent_task_id=$9,
         assignee_id=$10,due_date=$11,original_estimate_minutes=$12,remaining_estimate_minutes=$13,
         row_version=row_version+1,updated_at=now() where project_id=$1 and id=$2 and row_version=$3`,
        [
          this.scope.projectId,
          taskId,
          input.rowVersion,
          input.title,
          input.description,
          input.status,
          input.priority,
          labels,
          parentTaskId,
          input.assigneeId ?? null,
          input.dueDate ?? null,
          originalEstimateMinutes,
          remainingEstimateMinutes,
        ],
      );
      if (current.rows[0].status !== input.status) {
        await client.query(
          'insert into task_status_history (id,project_id,task_id,from_status,to_status,changed_by) values ($1,$2,$3,$4,$5,$6)',
          [
            uuidv7(),
            this.scope.projectId,
            taskId,
            current.rows[0].status,
            input.status,
            this.scope.actor.actorId,
          ],
        );
        await appendAudit(
          client,
          this.audit('task.status_changed', taskId, input.requestId, {
            from: current.rows[0].status,
            to: input.status,
          }),
        );
      }
      if (input.assigneeId) await this.addWatcher(client, taskId, input.assigneeId);
      const assigneeChanged = current.rows[0].assignee_id !== (input.assigneeId ?? null);
      if (assigneeChanged && input.assigneeId)
        await this.notify(client, taskId, 'task.assigned', {}, { only: [input.assigneeId] });
      await this.notify(
        client,
        taskId,
        current.rows[0].status === input.status ? 'task.updated' : 'task.status_changed',
        current.rows[0].status === input.status
          ? {}
          : { from: current.rows[0].status, to: input.status },
        input.assigneeId ? { exclude: [input.assigneeId] } : {},
      );
      const nextDueDate = input.dueDate ?? null;
      const labelsChanged = current.rows[0].labels.join(',') !== labels.join(',');
      const parentChanged = current.rows[0].parent_task_id !== parentTaskId;
      const changes = {
        ...(current.rows[0].title !== input.title
          ? { title: { from: current.rows[0].title, to: input.title } }
          : {}),
        ...(current.rows[0].description !== input.description
          ? { description: { changed: true } }
          : {}),
        ...(current.rows[0].priority !== input.priority
          ? { priority: { from: current.rows[0].priority, to: input.priority } }
          : {}),
        ...(assigneeChanged
          ? {
              assigneeId: {
                from: current.rows[0].assignee_id,
                to: input.assigneeId ?? null,
              },
            }
          : {}),
        ...(current.rows[0].due_date !== nextDueDate
          ? { dueDate: { from: current.rows[0].due_date, to: nextDueDate } }
          : {}),
        ...(labelsChanged
          ? { labels: { from: current.rows[0].labels.join(', '), to: labels.join(', ') } }
          : {}),
        ...(parentChanged
          ? { parentTaskId: { from: current.rows[0].parent_task_id, to: parentTaskId } }
          : {}),
        ...(current.rows[0].original_estimate_minutes !== originalEstimateMinutes
          ? {
              originalEstimateMinutes: {
                from:
                  current.rows[0].original_estimate_minutes === null
                    ? null
                    : String(current.rows[0].original_estimate_minutes),
                to: originalEstimateMinutes === null ? null : String(originalEstimateMinutes),
              },
            }
          : {}),
        ...(current.rows[0].remaining_estimate_minutes !== remainingEstimateMinutes
          ? {
              remainingEstimateMinutes: {
                from:
                  current.rows[0].remaining_estimate_minutes === null
                    ? null
                    : String(current.rows[0].remaining_estimate_minutes),
                to: remainingEstimateMinutes === null ? null : String(remainingEstimateMinutes),
              },
            }
          : {}),
      };
      await appendAudit(client, this.audit('task.updated', taskId, input.requestId, { changes }));
      const traceId = uuidv7();
      const executedRuleIds = new Set<string>();
      const events: TaskAutomationEvent[] = [
        ...(current.rows[0].status !== input.status
          ? [
              {
                type: 'task.status_changed' as const,
                from: current.rows[0].status,
                to: input.status,
              },
            ]
          : []),
        ...(current.rows[0].priority !== input.priority
          ? [
              {
                type: 'task.priority_changed' as const,
                from: current.rows[0].priority,
                to: input.priority,
              },
            ]
          : []),
        ...(current.rows[0].assignee_id !== (input.assigneeId ?? null)
          ? [
              {
                type: 'task.assignee_changed' as const,
                from: current.rows[0].assignee_id,
                to: input.assigneeId ?? null,
              },
            ]
          : []),
      ];
      for (const event of events)
        await this.runAutomations(client, taskId, event, input.requestId, {
          traceId,
          executedRuleIds,
          depth: 0,
        });
      await this.appendWebhookEvent(client, 'task.updated', taskId, {
        changes: {
          ...(current.rows[0].status !== input.status
            ? { status: { from: current.rows[0].status, to: input.status } }
            : {}),
          ...changes,
        },
      });
    });
    return this.getTask(taskId);
  }

  async createWorklog(
    taskId: string,
    input: {
      durationMinutes: number;
      startedAt: string;
      note?: string | undefined;
      remainingEstimateMode?: RemainingEstimateMode | undefined;
      remainingEstimateMinutes?: number | null | undefined;
      taskRowVersion: number;
      requestId: string;
    },
  ) {
    validateWorklogDuration(input.durationMinutes);
    const startedAt = new Date(input.startedAt);
    if (!Number.isFinite(startedAt.getTime()))
      throw new RepositoryError('TASK_WORKLOG_STARTED_AT_INVALID', 400, 'Started at is invalid.');
    const note = input.note?.trim() ?? '';
    if (note.length > 2_000)
      throw new RepositoryError(
        'TASK_WORKLOG_NOTE_TOO_LONG',
        400,
        'Worklog notes are limited to 2,000 characters.',
      );
    const worklogId = uuidv7();
    await transaction(this.pool, async (client) => {
      const current = await client.query<{ remaining_estimate_minutes: number | null }>(
        `select remaining_estimate_minutes from tasks
         where project_id=$1 and id=$2 and archived_at is null and row_version=$3 for update`,
        [this.scope.projectId, taskId, input.taskRowVersion],
      );
      if (!current.rows[0])
        throw new RepositoryError('TASK_VERSION_CONFLICT', 409, 'Task changed or is unavailable.');
      const before = current.rows[0].remaining_estimate_minutes;
      const after = adjustRemainingEstimate(
        before,
        input.durationMinutes,
        input.remainingEstimateMode ?? 'auto',
        input.remainingEstimateMinutes,
      );
      await client.query(
        `insert into task_worklogs
         (id,project_id,task_id,author_id,duration_minutes,started_at,note,
          remaining_estimate_before,remaining_estimate_after)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          worklogId,
          this.scope.projectId,
          taskId,
          this.scope.actor.actorId,
          input.durationMinutes,
          startedAt,
          note,
          before,
          after,
        ],
      );
      await client.query(
        `update tasks set remaining_estimate_minutes=$4,row_version=row_version+1,updated_at=now()
         where project_id=$1 and id=$2 and row_version=$3`,
        [this.scope.projectId, taskId, input.taskRowVersion, after],
      );
      const payload = {
        worklogId,
        durationMinutes: input.durationMinutes,
        startedAt: startedAt.toISOString(),
        remainingEstimateBefore: before,
        remainingEstimateAfter: after,
      };
      await appendAudit(client, this.audit('task.work_logged', taskId, input.requestId, payload));
      await this.notify(client, taskId, 'task.updated', { worklogId, action: 'created' });
      await this.appendWebhookEvent(client, 'task.updated', taskId, {
        changes: { timeTracking: { action: 'worklog.created', ...payload } },
      });
    });
    return this.getTask(taskId);
  }

  async updateWorklog(
    taskId: string,
    worklogId: string,
    input: {
      durationMinutes: number;
      startedAt: string;
      note?: string | undefined;
      remainingEstimateMode?: RemainingEstimateMode | undefined;
      remainingEstimateMinutes?: number | null | undefined;
      taskRowVersion: number;
      worklogRowVersion: number;
      requestId: string;
    },
  ) {
    validateWorklogDuration(input.durationMinutes);
    const startedAt = new Date(input.startedAt);
    if (!Number.isFinite(startedAt.getTime()))
      throw new RepositoryError('TASK_WORKLOG_STARTED_AT_INVALID', 400, 'Started at is invalid.');
    const note = input.note?.trim() ?? '';
    if (note.length > 2_000)
      throw new RepositoryError(
        'TASK_WORKLOG_NOTE_TOO_LONG',
        400,
        'Worklog notes are limited to 2,000 characters.',
      );
    await transaction(this.pool, async (client) => {
      const current = await client.query<{
        remaining_estimate_minutes: number | null;
        author_id: string;
        duration_minutes: number;
        started_at: Date;
        note: string;
      }>(
        `select t.remaining_estimate_minutes,w.author_id,w.duration_minutes,w.started_at,w.note
         from tasks t join task_worklogs w on w.project_id=t.project_id and w.task_id=t.id
         where t.project_id=$1 and t.id=$2 and t.archived_at is null and t.row_version=$3
           and w.id=$4 and w.deleted_at is null and w.row_version=$5
         for update of t,w`,
        [this.scope.projectId, taskId, input.taskRowVersion, worklogId, input.worklogRowVersion],
      );
      const beforeWorklog = current.rows[0];
      if (!beforeWorklog)
        throw new RepositoryError(
          'TASK_WORKLOG_VERSION_CONFLICT',
          409,
          'The task or worklog changed or is unavailable.',
        );
      if (
        beforeWorklog.author_id !== this.scope.actor.actorId &&
        !['owner', 'admin'].includes(this.scope.actor.role)
      )
        throw new RepositoryError(
          'TASK_WORKLOG_FORBIDDEN',
          403,
          'Only the author or an administrator can edit this worklog.',
        );
      const remainingBefore = beforeWorklog.remaining_estimate_minutes;
      const remainingAfter = adjustRemainingEstimate(
        remainingBefore,
        input.durationMinutes - beforeWorklog.duration_minutes,
        input.remainingEstimateMode ?? 'auto',
        input.remainingEstimateMinutes,
      );
      await client.query(
        `update task_worklogs set duration_minutes=$6,started_at=$7,note=$8,
          remaining_estimate_before=$9,remaining_estimate_after=$10,
          row_version=row_version+1,updated_at=now()
         where project_id=$1 and task_id=$2 and id=$3 and row_version=$4 and deleted_at is null
           and author_id=$5`,
        [
          this.scope.projectId,
          taskId,
          worklogId,
          input.worklogRowVersion,
          beforeWorklog.author_id,
          input.durationMinutes,
          startedAt,
          note,
          remainingBefore,
          remainingAfter,
        ],
      );
      await client.query(
        `update tasks set remaining_estimate_minutes=$4,row_version=row_version+1,updated_at=now()
         where project_id=$1 and id=$2 and row_version=$3`,
        [this.scope.projectId, taskId, input.taskRowVersion, remainingAfter],
      );
      const payload = {
        worklogId,
        fromDurationMinutes: beforeWorklog.duration_minutes,
        toDurationMinutes: input.durationMinutes,
        fromStartedAt: beforeWorklog.started_at.toISOString(),
        toStartedAt: startedAt.toISOString(),
        noteChanged: beforeWorklog.note !== note,
        remainingEstimateBefore: remainingBefore,
        remainingEstimateAfter: remainingAfter,
      };
      await appendAudit(
        client,
        this.audit('task.worklog_updated', taskId, input.requestId, payload),
      );
      await this.notify(client, taskId, 'task.updated', { worklogId, action: 'updated' });
      await this.appendWebhookEvent(client, 'task.updated', taskId, {
        changes: { timeTracking: { action: 'worklog.updated', ...payload } },
      });
    });
    return this.getTask(taskId);
  }

  async deleteWorklog(
    taskId: string,
    worklogId: string,
    input: {
      remainingEstimateMode?: RemainingEstimateMode | undefined;
      remainingEstimateMinutes?: number | null | undefined;
      taskRowVersion: number;
      worklogRowVersion: number;
      requestId: string;
    },
  ) {
    await transaction(this.pool, async (client) => {
      const current = await client.query<{
        remaining_estimate_minutes: number | null;
        author_id: string;
        duration_minutes: number;
      }>(
        `select t.remaining_estimate_minutes,w.author_id,w.duration_minutes
         from tasks t join task_worklogs w on w.project_id=t.project_id and w.task_id=t.id
         where t.project_id=$1 and t.id=$2 and t.archived_at is null and t.row_version=$3
           and w.id=$4 and w.deleted_at is null and w.row_version=$5
         for update of t,w`,
        [this.scope.projectId, taskId, input.taskRowVersion, worklogId, input.worklogRowVersion],
      );
      const worklog = current.rows[0];
      if (!worklog)
        throw new RepositoryError(
          'TASK_WORKLOG_VERSION_CONFLICT',
          409,
          'The task or worklog changed or is unavailable.',
        );
      if (
        worklog.author_id !== this.scope.actor.actorId &&
        !['owner', 'admin'].includes(this.scope.actor.role)
      )
        throw new RepositoryError(
          'TASK_WORKLOG_FORBIDDEN',
          403,
          'Only the author or an administrator can delete this worklog.',
        );
      const remainingBefore = worklog.remaining_estimate_minutes;
      const remainingAfter = adjustRemainingEstimate(
        remainingBefore,
        -worklog.duration_minutes,
        input.remainingEstimateMode ?? 'auto',
        input.remainingEstimateMinutes,
      );
      await client.query(
        `update task_worklogs set deleted_at=now(),deleted_by=$6,row_version=row_version+1,
          remaining_estimate_before=$7,remaining_estimate_after=$8,updated_at=now()
         where project_id=$1 and task_id=$2 and id=$3 and row_version=$4 and deleted_at is null
           and author_id=$5`,
        [
          this.scope.projectId,
          taskId,
          worklogId,
          input.worklogRowVersion,
          worklog.author_id,
          this.scope.actor.actorId,
          remainingBefore,
          remainingAfter,
        ],
      );
      await client.query(
        `update tasks set remaining_estimate_minutes=$4,row_version=row_version+1,updated_at=now()
         where project_id=$1 and id=$2 and row_version=$3`,
        [this.scope.projectId, taskId, input.taskRowVersion, remainingAfter],
      );
      const payload = {
        worklogId,
        durationMinutes: worklog.duration_minutes,
        remainingEstimateBefore: remainingBefore,
        remainingEstimateAfter: remainingAfter,
      };
      await appendAudit(
        client,
        this.audit('task.worklog_deleted', taskId, input.requestId, payload),
      );
      await this.notify(client, taskId, 'task.updated', { worklogId, action: 'deleted' });
      await this.appendWebhookEvent(client, 'task.updated', taskId, {
        changes: { timeTracking: { action: 'worklog.deleted', ...payload } },
      });
    });
    return this.getTask(taskId);
  }

  async moveTask(
    taskId: string,
    input: {
      status: TaskStatus;
      beforeTaskId?: string | null | undefined;
      placement?: 'top' | 'bottom' | undefined;
      rowVersion: number;
      requestId: string;
    },
  ) {
    await transaction(this.pool, async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1::text,1))', [
        this.scope.projectId,
      ]);
      const current = await client.query<{
        id: string;
        status: TaskStatus;
        board_position: number;
      }>(
        `select id,status,board_position from tasks
         where project_id=$1 and id=$2 and archived_at is null and row_version=$3 for update`,
        [this.scope.projectId, taskId, input.rowVersion],
      );
      const before = current.rows[0];
      if (!before)
        throw new RepositoryError('TASK_VERSION_CONFLICT', 409, 'Task changed or is unavailable.');
      if (input.beforeTaskId === taskId)
        throw new RepositoryError(
          'TASK_RANK_TARGET_INVALID',
          400,
          'A task cannot be ranked before itself.',
        );
      await assertTaskTransition(client, this.scope.projectId, before.status, input.status);

      const loadBounds = async () => {
        if (input.placement === 'top') {
          const next = await client.query<{ id: string; board_position: number }>(
            `select id,board_position from tasks
             where project_id=$1 and status=$2 and archived_at is null and id<>$3
             order by board_position,id limit 1 for update`,
            [this.scope.projectId, input.status, taskId],
          );
          return {
            previous: 0,
            next: next.rows[0]?.board_position ?? null,
          };
        }
        if (input.beforeTaskId) {
          const target = await client.query<{ id: string; board_position: number }>(
            `select id,board_position from tasks
             where project_id=$1 and id=$2 and status=$3 and archived_at is null for update`,
            [this.scope.projectId, input.beforeTaskId, input.status],
          );
          const next = target.rows[0];
          if (!next)
            throw new RepositoryError(
              'TASK_RANK_TARGET_NOT_FOUND',
              404,
              'The destination task was not found in that status.',
            );
          const previous = await client.query<{ board_position: number }>(
            `select board_position from tasks
             where project_id=$1 and status=$2 and archived_at is null and id<>$3
               and (board_position,id)<($4,$5::uuid)
             order by board_position desc,id desc limit 1`,
            [this.scope.projectId, input.status, taskId, next.board_position, next.id],
          );
          return {
            previous: previous.rows[0]?.board_position ?? 0,
            next: next.board_position,
          };
        }
        const previous = await client.query<{ board_position: number }>(
          `select board_position from tasks
           where project_id=$1 and status=$2 and archived_at is null and id<>$3
           order by board_position desc,id desc limit 1`,
          [this.scope.projectId, input.status, taskId],
        );
        return { previous: previous.rows[0]?.board_position ?? 0, next: null };
      };

      if (before.status === input.status) {
        if (input.placement) {
          const edge = await client.query<{ id: string }>(
            `select id from tasks where project_id=$1 and status=$2 and archived_at is null
             order by board_position ${input.placement === 'top' ? 'asc' : 'desc'},
                      id ${input.placement === 'top' ? 'asc' : 'desc'} limit 1`,
            [this.scope.projectId, input.status],
          );
          if (edge.rows[0]?.id === taskId) return;
        } else {
          const adjacent = input.beforeTaskId
            ? await client.query<{ id: string }>(
                `select id from tasks where project_id=$1 and status=$2 and archived_at is null
                   and id<>$3 and (board_position,id)>($4,$3::uuid)
                 order by board_position,id limit 1`,
                [this.scope.projectId, input.status, taskId, before.board_position],
              )
            : await client.query<{ id: string }>(
                `select id from tasks where project_id=$1 and status=$2 and archived_at is null
                 order by board_position desc,id desc limit 1`,
                [this.scope.projectId, input.status],
              );
          if (adjacent.rows[0]?.id === (input.beforeTaskId ?? taskId)) return;
        }
      }

      let bounds = await loadBounds();
      let position =
        bounds.next === null
          ? bounds.previous + taskRankStep
          : Math.floor((bounds.previous + bounds.next) / 2);
      if (
        position <= bounds.previous ||
        (bounds.next !== null && position >= bounds.next) ||
        position >= taskRankRebalanceThreshold
      ) {
        await this.rebalanceTaskRanks(client);
        bounds = await loadBounds();
        position =
          bounds.next === null
            ? bounds.previous + taskRankStep
            : Math.floor((bounds.previous + bounds.next) / 2);
      }
      await client.query(
        `update tasks set status=$3,board_position=$4,row_version=row_version+1,updated_at=now()
         where project_id=$1 and id=$2`,
        [this.scope.projectId, taskId, input.status, position],
      );
      if (before.status !== input.status) {
        await client.query(
          `insert into task_status_history
           (id,project_id,task_id,from_status,to_status,changed_by)
           values ($1,$2,$3,$4,$5,$6)`,
          [
            uuidv7(),
            this.scope.projectId,
            taskId,
            before.status,
            input.status,
            this.scope.actor.actorId,
          ],
        );
        await appendAudit(
          client,
          this.audit('task.status_changed', taskId, input.requestId, {
            from: before.status,
            to: input.status,
          }),
        );
      }
      if (before.status !== input.status)
        await this.notify(client, taskId, 'task.status_changed', {
          from: before.status,
          to: input.status,
        });
      await appendAudit(
        client,
        this.audit('task.ranked', taskId, input.requestId, {
          fromStatus: before.status,
          toStatus: input.status,
          beforeTaskId: input.beforeTaskId ?? null,
          placement: input.placement ?? null,
        }),
      );
      if (before.status !== input.status)
        await this.runAutomations(
          client,
          taskId,
          { type: 'task.status_changed', from: before.status, to: input.status },
          input.requestId,
          { traceId: uuidv7(), executedRuleIds: new Set(), depth: 0 },
        );
      await this.appendWebhookEvent(client, 'task.updated', taskId, {
        changes: {
          ...(before.status !== input.status
            ? { status: { from: before.status, to: input.status } }
            : {}),
          rank: { beforeTaskId: input.beforeTaskId ?? null },
        },
      });
    });
    return this.getTask(taskId);
  }

  async bulkUpdateTasks(input: {
    items: Array<{ id: string; rowVersion: number }>;
    changes: {
      status?: TaskStatus | undefined;
      priority?: TaskPriority | undefined;
      assigneeId?: string | null | undefined;
    };
    requestId: string;
  }) {
    const taskIds = input.items.map((item) => item.id);
    await transaction(this.pool, async (client) => {
      if (input.changes.assigneeId) await this.validateAssignee(client, input.changes.assigneeId);
      const current = await client.query<{
        id: string;
        status: TaskStatus;
        priority: TaskPriority;
        assignee_id: string | null;
        row_version: number;
      }>(
        `select id,status,priority,assignee_id,row_version from tasks t
         where project_id=$1 and id=any($2::uuid[]) and archived_at is null
           and ${this.taskVisibilityPredicate('t')} for update`,
        [this.scope.projectId, taskIds],
      );
      const currentById = new Map(current.rows.map((task) => [task.id, task]));
      if (
        current.rows.length !== input.items.length ||
        input.items.some((item) => currentById.get(item.id)?.row_version !== item.rowVersion)
      )
        throw new RepositoryError(
          'TASK_BULK_VERSION_CONFLICT',
          409,
          'One or more tasks changed. No tasks were updated.',
        );

      const changesAssignee = input.changes.assigneeId !== undefined;
      for (const item of input.items) {
        const before = currentById.get(item.id)!;
        const nextStatus = input.changes.status ?? before.status;
        const nextPriority = input.changes.priority ?? before.priority;
        const nextAssignee = changesAssignee
          ? (input.changes.assigneeId ?? null)
          : before.assignee_id;
        const changedFields = [
          ...(before.status !== nextStatus ? ['status'] : []),
          ...(before.priority !== nextPriority ? ['priority'] : []),
          ...(before.assignee_id !== nextAssignee ? ['assigneeId'] : []),
        ];
        if (!changedFields.length) continue;
        await assertTaskTransition(client, this.scope.projectId, before.status, nextStatus);
        await client.query(
          `update tasks set status=$3,priority=$4,assignee_id=$5,row_version=row_version+1,updated_at=now()
           where project_id=$1 and id=$2`,
          [this.scope.projectId, item.id, nextStatus, nextPriority, nextAssignee],
        );
        if (before.status !== nextStatus) {
          await client.query(
            `insert into task_status_history
             (id,project_id,task_id,from_status,to_status,changed_by)
             values ($1,$2,$3,$4,$5,$6)`,
            [
              uuidv7(),
              this.scope.projectId,
              item.id,
              before.status,
              nextStatus,
              this.scope.actor.actorId,
            ],
          );
          await appendAudit(
            client,
            this.audit('task.status_changed', item.id, input.requestId, {
              from: before.status,
              to: nextStatus,
              bulk: true,
            }),
          );
        }
        if (nextAssignee) await this.addWatcher(client, item.id, nextAssignee);
        if (before.assignee_id !== nextAssignee && nextAssignee)
          await this.notify(
            client,
            item.id,
            'task.assigned',
            { bulk: true },
            { only: [nextAssignee] },
          );
        await this.notify(
          client,
          item.id,
          before.status === nextStatus ? 'task.updated' : 'task.status_changed',
          before.status === nextStatus
            ? { bulk: true }
            : { from: before.status, to: nextStatus, bulk: true },
          nextAssignee ? { exclude: [nextAssignee] } : {},
        );
        const changes = {
          ...(before.priority !== nextPriority
            ? { priority: { from: before.priority, to: nextPriority } }
            : {}),
          ...(before.assignee_id !== nextAssignee
            ? { assigneeId: { from: before.assignee_id, to: nextAssignee } }
            : {}),
        };
        await appendAudit(
          client,
          this.audit('task.updated', item.id, input.requestId, {
            bulk: true,
            fields: changedFields,
            changes,
          }),
        );
        const traceId = uuidv7();
        const executedRuleIds = new Set<string>();
        const events: TaskAutomationEvent[] = [
          ...(before.status !== nextStatus
            ? [
                {
                  type: 'task.status_changed' as const,
                  from: before.status,
                  to: nextStatus,
                },
              ]
            : []),
          ...(before.priority !== nextPriority
            ? [
                {
                  type: 'task.priority_changed' as const,
                  from: before.priority,
                  to: nextPriority,
                },
              ]
            : []),
          ...(before.assignee_id !== nextAssignee
            ? [
                {
                  type: 'task.assignee_changed' as const,
                  from: before.assignee_id,
                  to: nextAssignee,
                },
              ]
            : []),
        ];
        for (const event of events)
          await this.runAutomations(client, item.id, event, input.requestId, {
            traceId,
            executedRuleIds,
            depth: 0,
          });
        await this.appendWebhookEvent(client, 'task.updated', item.id, {
          bulk: true,
          changes: {
            ...(before.status !== nextStatus
              ? { status: { from: before.status, to: nextStatus } }
              : {}),
            ...changes,
          },
        });
      }
    });
    const updated = await this.listTasks({
      includeArchived: false,
      taskIds,
      limit: taskIds.length,
    });
    const updatedById = new Map(updated.items.map((task) => [task.id, task]));
    return taskIds
      .map((taskId) => updatedById.get(taskId))
      .filter((task): task is TaskListRow => Boolean(task));
  }

  async setArchived(
    taskId: string,
    archived: boolean,
    reason: string,
    rowVersion: number,
    requestId: string,
  ) {
    await transaction(this.pool, async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1::text,1))', [
        this.scope.projectId,
      ]);
      const current = await client.query<{ row_version: number; archived_at: Date | null }>(
        `select row_version,archived_at from tasks
         where project_id=$1 and id=$2 for update`,
        [this.scope.projectId, taskId],
      );
      const before = current.rows[0];
      if (
        !before ||
        before.row_version !== rowVersion ||
        (archived ? before.archived_at !== null : before.archived_at === null)
      )
        throw new RepositoryError(
          'TASK_VERSION_CONFLICT',
          409,
          'Task changed or its lifecycle state conflicts. Refresh before trying again.',
        );
      if (archived) {
        const child = await client.query(
          `select 1 from tasks where project_id=$1 and parent_task_id=$2
           and archived_at is null limit 1`,
          [this.scope.projectId, taskId],
        );
        if (child.rowCount)
          throw new RepositoryError(
            'TASK_HAS_ACTIVE_CHILDREN',
            409,
            'Archive or move every active subtask before archiving its parent.',
          );
      } else {
        const parent = await client.query(
          `select 1 from tasks child join tasks parent
             on parent.project_id=child.project_id and parent.id=child.parent_task_id
           where child.project_id=$1 and child.id=$2 and parent.archived_at is not null`,
          [this.scope.projectId, taskId],
        );
        if (parent.rowCount)
          throw new RepositoryError(
            'TASK_PARENT_ARCHIVED',
            409,
            'Restore the parent task before restoring this subtask.',
          );
      }
      const changed = await client.query(
        `update tasks set archived_at=${archived ? 'now()' : 'null'},archived_by=${archived ? '$3' : 'null'},archive_reason=${archived ? '$4' : 'null'},row_version=row_version+1,updated_at=now()
         where project_id=$1 and id=$2 and archived_at is ${archived ? 'null' : 'not null'}
           and row_version=${archived ? '$5' : '$3'} returning id`,
        archived
          ? [this.scope.projectId, taskId, this.scope.actor.actorId, reason, rowVersion]
          : [this.scope.projectId, taskId, rowVersion],
      );
      if (!changed.rowCount)
        throw new RepositoryError(
          'TASK_VERSION_CONFLICT',
          409,
          'Task changed or its lifecycle state conflicts. Refresh before trying again.',
        );
      await appendAudit(
        client,
        this.audit(archived ? 'task.archived' : 'task.restored', taskId, requestId, {
          ...(archived ? { reason } : {}),
          fromRowVersion: rowVersion,
          toRowVersion: rowVersion + 1,
        }),
      );
      await this.notify(client, taskId, archived ? 'task.archived' : 'task.restored', {});
      await this.appendWebhookEvent(
        client,
        archived ? 'task.archived' : 'task.restored',
        taskId,
        archived ? { reason } : {},
      );
    });
    return this.getTask(taskId);
  }

  async setWatching(taskId: string, watching: boolean, requestId: string) {
    await transaction(this.pool, async (client) => {
      const task = await client.query('select 1 from tasks where project_id=$1 and id=$2', [
        this.scope.projectId,
        taskId,
      ]);
      if (!task.rowCount) throw new RepositoryError('TASK_NOT_FOUND', 404, 'Task was not found.');
      if (watching) await this.addWatcher(client, taskId, this.scope.actor.actorId);
      else
        await client.query(
          'delete from task_watchers where project_id=$1 and task_id=$2 and user_id=$3',
          [this.scope.projectId, taskId, this.scope.actor.actorId],
        );
      await appendAudit(
        client,
        this.audit(watching ? 'task.watched' : 'task.unwatched', taskId, requestId),
      );
    });
    return this.getTask(taskId);
  }

  async addExternalLink(input: {
    taskId: string;
    title: string;
    provider: string;
    url: string;
    externalId: string;
    version: string;
    observedOn: string;
    notes: string;
    requestId: string;
  }) {
    const sourceId = uuidv7();
    const linkId = uuidv7();
    await transaction(this.pool, async (client) => {
      const task = await client.query(
        'select 1 from tasks where project_id=$1 and id=$2 and archived_at is null for update',
        [this.scope.projectId, input.taskId],
      );
      if (!task.rowCount) throw new RepositoryError('TASK_NOT_FOUND', 404, 'Task was not found.');
      await client.query(
        `insert into external_sources
         (id,project_id,title,provider,url,external_id,version,observed_on,notes,created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          sourceId,
          this.scope.projectId,
          input.title,
          input.provider,
          input.url,
          input.externalId,
          input.version,
          input.observedOn,
          input.notes,
          this.scope.actor.actorId,
        ],
      );
      await client.query(
        `insert into task_links (id,project_id,task_id,entity_type,entity_id)
         values ($1,$2,$3,'external_source',$4)`,
        [linkId, this.scope.projectId, input.taskId, sourceId],
      );
      await appendAudit(client, {
        organizationId: this.scope.actor.organizationId,
        workspaceId: this.scope.workspaceId,
        projectId: this.scope.projectId,
        actorId: this.scope.actor.actorId,
        action: 'external_source.created',
        targetType: 'external_source',
        targetId: sourceId,
        requestId: input.requestId,
        payload: { linkedTaskId: input.taskId },
      });
      const payload = {
        linkId,
        entityType: 'external_source',
        entityId: sourceId,
        title: input.title,
        url: input.url,
      };
      await appendAudit(
        client,
        this.audit('task.link_added', input.taskId, input.requestId, payload),
      );
      await this.notify(client, input.taskId, 'task.updated', payload);
    });
    return this.getTask(input.taskId);
  }

  async addFileLink(taskId: string, fileId: string, requestId: string) {
    await transaction(this.pool, async (client) => {
      const task = await client.query(
        'select 1 from tasks where project_id=$1 and id=$2 and archived_at is null for update',
        [this.scope.projectId, taskId],
      );
      if (!task.rowCount) throw new RepositoryError('TASK_NOT_FOUND', 404, 'Task was not found.');
      const file = await client.query<{
        original_name: string;
        version_number: number;
      }>(
        `select f.original_name,f.version_number from file_objects f
         join file_series s on s.project_id=f.project_id and s.id=f.file_series_id
         where f.project_id=$1 and f.id=$2 and f.status='available'
          and f.archived_at is null and s.archived_at is null for share of f,s`,
        [this.scope.projectId, fileId],
      );
      const attachedFile = file.rows[0];
      if (!attachedFile)
        throw new RepositoryError(
          'TASK_FILE_NOT_AVAILABLE',
          400,
          'Only an available, active project file can be attached.',
        );
      const existing = await client.query<{ id: string }>(
        `select l.id
         from task_links l where l.project_id=$1 and l.task_id=$2
          and l.entity_type='file' and l.entity_id=$3
          and not exists(select 1 from task_link_removals r where r.link_id=l.id)
         order by l.created_at desc,l.id desc limit 1 for update`,
        [this.scope.projectId, taskId, fileId],
      );
      if (existing.rows[0]) return;
      const linkId = uuidv7();
      await client.query(
        `insert into task_links (id,project_id,task_id,entity_type,entity_id)
         values ($1,$2,$3,'file',$4)`,
        [linkId, this.scope.projectId, taskId, fileId],
      );
      const payload = {
        linkId,
        entityType: 'file',
        entityId: fileId,
        title: attachedFile.original_name,
        version: `v${attachedFile.version_number}`,
      };
      await appendAudit(client, this.audit('task.link_added', taskId, requestId, payload));
      await this.notify(client, taskId, 'task.updated', payload);
    });
    return this.getTask(taskId);
  }

  async removeLink(taskId: string, linkId: string, requestId: string) {
    await transaction(this.pool, async (client) => {
      const found = await client.query<{
        entity_type: TaskEntityType;
        entity_id: string;
        title: string | null;
        url: string | null;
      }>(
        `select l.entity_type,l.entity_id,
          coalesce(s.title,f.original_name,r.display_name,d.name,
            case when mr.id is not null then concat_ws(' · ',mr_record.display_name,mr_field.name) end,
            case when evaluation.id is not null then concat_ws(' · ',evaluation_record.display_name,evaluation_field.name) end) title,
          s.url
         from task_links l join tasks t on t.project_id=l.project_id and t.id=l.task_id
         left join external_sources s on s.project_id=l.project_id and s.id=l.entity_id
          and l.entity_type='external_source'
         left join file_objects f on f.project_id=l.project_id and f.id=l.entity_id
          and l.entity_type='file'
         left join records r on r.project_id=l.project_id and r.id=l.entity_id
          and l.entity_type in ('record','sample','issue','test_run')
         left join datasets d on d.project_id=l.project_id and d.id=l.entity_id
          and l.entity_type='dataset'
         left join measurement_results mr on mr.project_id=l.project_id and mr.id=l.entity_id
          and l.entity_type='measurement_result'
         left join records mr_record on mr_record.project_id=mr.project_id and mr_record.id=mr.record_id
         left join field_definitions mr_field on mr_field.project_id=mr.project_id and mr_field.id=mr.field_id
         left join specification_evaluations evaluation on evaluation.project_id=l.project_id
          and evaluation.id=l.entity_id and l.entity_type='specification_evaluation'
         left join records evaluation_record on evaluation_record.project_id=evaluation.project_id
          and evaluation_record.id=evaluation.record_id
         left join field_definitions evaluation_field on evaluation_field.project_id=evaluation.project_id
          and evaluation_field.id=evaluation.measurement_field_id
         where l.project_id=$1 and l.task_id=$2 and l.id=$3 and t.archived_at is null
          and not exists(select 1 from task_link_removals r where r.link_id=l.id)
         for update of l`,
        [this.scope.projectId, taskId, linkId],
      );
      const link = found.rows[0];
      if (!link)
        throw new RepositoryError('TASK_LINK_NOT_FOUND', 404, 'Task evidence link was not found.');
      await client.query(
        'insert into task_link_removals (id,link_id,removed_by) values ($1,$2,$3)',
        [uuidv7(), linkId, this.scope.actor.actorId],
      );
      const payload = {
        linkId,
        entityType: link.entity_type,
        entityId: link.entity_id,
        title: link.title,
        url: link.url,
      };
      await appendAudit(client, this.audit('task.link_removed', taskId, requestId, payload));
      await this.notify(client, taskId, 'task.updated', payload);
    });
    return this.getTask(taskId);
  }

  async addRelationship(input: {
    taskId: string;
    relatedTaskId: string;
    type: 'blocks' | 'blocked_by' | 'relates_to';
    requestId: string;
  }) {
    await transaction(this.pool, async (client) => {
      if (input.taskId === input.relatedTaskId)
        throw new RepositoryError(
          'TASK_RELATIONSHIP_SELF',
          400,
          'A task cannot be related to itself.',
        );
      await client.query('select pg_advisory_xact_lock(hashtextextended($1::text,0))', [
        this.scope.projectId,
      ]);
      const found = await client.query<{ id: string }>(
        `select id from tasks t where project_id=$1 and id=any($2::uuid[])
         and archived_at is null and ${this.taskVisibilityPredicate('t')} for update`,
        [this.scope.projectId, [input.taskId, input.relatedTaskId]],
      );
      if (found.rowCount !== 2)
        throw new RepositoryError(
          'TASK_RELATIONSHIP_TARGET_INVALID',
          400,
          'Both related tasks must be active tasks in this project.',
        );
      let sourceTaskId = input.taskId;
      let targetTaskId = input.relatedTaskId;
      const relationType = input.type === 'relates_to' ? 'relates_to' : 'blocks';
      if (input.type === 'blocked_by') {
        sourceTaskId = input.relatedTaskId;
        targetTaskId = input.taskId;
      } else if (input.type === 'relates_to' && sourceTaskId > targetTaskId) {
        [sourceTaskId, targetTaskId] = [targetTaskId, sourceTaskId];
      }
      if (relationType === 'blocks') {
        const cycle = await client.query(
          `with recursive reachable(task_id) as (
             select target_task_id from task_relationships
              where project_id=$1 and relation_type='blocks' and source_task_id=$2
             union
             select r.target_task_id from task_relationships r join reachable x
              on x.task_id=r.source_task_id
              where r.project_id=$1 and r.relation_type='blocks'
           ) select 1 from reachable where task_id=$3 limit 1`,
          [this.scope.projectId, targetTaskId, sourceTaskId],
        );
        if (cycle.rowCount)
          throw new RepositoryError(
            'TASK_RELATIONSHIP_CYCLE',
            409,
            'This blocking relationship would create a dependency cycle.',
          );
      }
      const relationshipId = uuidv7();
      const inserted = await client.query(
        `insert into task_relationships
         (id,project_id,source_task_id,target_task_id,relation_type,created_by)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (project_id,relation_type,source_task_id,target_task_id) do nothing returning id`,
        [
          relationshipId,
          this.scope.projectId,
          sourceTaskId,
          targetTaskId,
          relationType,
          this.scope.actor.actorId,
        ],
      );
      if (!inserted.rowCount)
        throw new RepositoryError(
          'TASK_RELATIONSHIP_EXISTS',
          409,
          'This task relationship already exists.',
        );
      const payload = { relationshipId, relationType, sourceTaskId, targetTaskId };
      const notificationEventId = uuidv7();
      await this.notify(client, sourceTaskId, 'task.updated', payload, {
        eventId: notificationEventId,
      });
      await this.notify(client, targetTaskId, 'task.updated', payload, {
        eventId: notificationEventId,
      });
      await appendAudit(
        client,
        this.audit('task.relationship_added', input.taskId, input.requestId, payload),
      );
    });
    return this.getTask(input.taskId);
  }

  async removeRelationship(taskId: string, relationshipId: string, requestId: string) {
    await transaction(this.pool, async (client) => {
      const found = await client.query<{
        source_task_id: string;
        target_task_id: string;
        relation_type: string;
      }>(
        `select source_task_id,target_task_id,relation_type from task_relationships
         where project_id=$1 and id=$2 and (source_task_id=$3 or target_task_id=$3) for update`,
        [this.scope.projectId, relationshipId, taskId],
      );
      const relationship = found.rows[0];
      if (!relationship)
        throw new RepositoryError(
          'TASK_RELATIONSHIP_NOT_FOUND',
          404,
          'Task relationship was not found.',
        );
      await client.query('delete from task_relationships where project_id=$1 and id=$2', [
        this.scope.projectId,
        relationshipId,
      ]);
      const payload = {
        relationshipId,
        relationType: relationship.relation_type,
        sourceTaskId: relationship.source_task_id,
        targetTaskId: relationship.target_task_id,
      };
      const notificationEventId = uuidv7();
      await this.notify(client, relationship.source_task_id, 'task.updated', payload, {
        eventId: notificationEventId,
      });
      await this.notify(client, relationship.target_task_id, 'task.updated', payload, {
        eventId: notificationEventId,
      });
      await appendAudit(
        client,
        this.audit('task.relationship_removed', taskId, requestId, payload),
      );
    });
    return this.getTask(taskId);
  }

  async addComment(input: {
    taskId: string;
    body: string;
    mentionedUserIds: string[];
    watch?: boolean | undefined;
    requestId: string;
  }): Promise<TaskComment> {
    const commentId = uuidv7();
    await transaction(this.pool, async (client) => {
      const task = await client.query(
        'select 1 from tasks where project_id=$1 and id=$2 and archived_at is null',
        [this.scope.projectId, input.taskId],
      );
      if (!task.rowCount) throw new RepositoryError('TASK_NOT_FOUND', 404, 'Task was not found.');
      const mentionedUserIds = [...new Set(input.mentionedUserIds)];
      await this.mentionedUsers(client, mentionedUserIds);
      await client.query(
        `insert into task_comments (id,project_id,task_id,author_id,body)
         values ($1,$2,$3,$4,$5)`,
        [commentId, this.scope.projectId, input.taskId, this.scope.actor.actorId, input.body],
      );
      for (const userId of mentionedUserIds)
        await client.query(
          'insert into task_comment_mentions (comment_id,user_id) values ($1,$2)',
          [commentId, userId],
        );
      const commentPreferences = await notificationPreferencesForUser(
        client,
        this.scope.actor.organizationId,
        this.scope.actor.actorId,
      );
      if (input.watch ?? commentPreferences.autoWatchCommented)
        await this.addWatcher(client, input.taskId, this.scope.actor.actorId);
      await this.notify(
        client,
        input.taskId,
        'task.mentioned',
        { commentId },
        { only: mentionedUserIds },
      );
      await this.notify(
        client,
        input.taskId,
        'task.commented',
        { commentId },
        {
          exclude: mentionedUserIds,
        },
      );
      await appendAudit(
        client,
        this.audit('task.comment_added', input.taskId, input.requestId, {
          commentId,
          mentionedUserIds,
        }),
      );
    });
    const detail = await this.getTask(input.taskId);
    return detail.comments.find((comment: TaskComment) => comment.id === commentId)!;
  }

  async updateComment(input: {
    taskId: string;
    commentId: string;
    body: string;
    mentionedUserIds: string[];
    rowVersion: number;
    requestId: string;
  }): Promise<TaskComment> {
    await transaction(this.pool, async (client) => {
      const found = await client.query<{
        body: string;
        author_id: string;
        row_version: number;
      }>(
        `select c.body,c.author_id,c.row_version from task_comments c join tasks t
         on t.project_id=c.project_id and t.id=c.task_id
         where c.project_id=$1 and c.task_id=$2 and c.id=$3 and t.archived_at is null
         for update of c`,
        [this.scope.projectId, input.taskId, input.commentId],
      );
      const current = found.rows[0];
      if (!current)
        throw new RepositoryError('TASK_COMMENT_NOT_FOUND', 404, 'Task comment was not found.');
      if (current.author_id !== this.scope.actor.actorId)
        throw new RepositoryError(
          'TASK_COMMENT_EDIT_FORBIDDEN',
          403,
          'Only the comment author can edit this comment.',
        );
      if (current.row_version !== input.rowVersion)
        throw new RepositoryError(
          'TASK_COMMENT_VERSION_CONFLICT',
          409,
          'The comment changed after it was loaded. Refresh and try again.',
        );

      const previousMentions = (
        await client.query<{ id: string; display_name: string }>(
          `select m.user_id id,u.display_name from task_comment_mentions m join users u on u.id=m.user_id
           where m.comment_id=$1 order by lower(u.display_name),m.user_id`,
          [input.commentId],
        )
      ).rows.map((mention) => ({ id: mention.id, displayName: mention.display_name }));
      const mentions = await this.mentionedUsers(client, input.mentionedUserIds);
      const previousIds = previousMentions.map((mention) => mention.id).sort();
      const nextIds = mentions.map((mention) => mention.id).sort();
      if (current.body === input.body && previousIds.join(',') === nextIds.join(','))
        throw new RepositoryError(
          'TASK_COMMENT_NO_CHANGES',
          400,
          'The comment has no changes to save.',
        );

      await client.query(
        `update task_comments set body=$4,row_version=row_version+1,edited_at=now(),updated_at=now()
         where project_id=$1 and task_id=$2 and id=$3`,
        [this.scope.projectId, input.taskId, input.commentId, input.body],
      );
      await client.query('delete from task_comment_mentions where comment_id=$1', [
        input.commentId,
      ]);
      for (const mention of mentions)
        await client.query(
          'insert into task_comment_mentions (comment_id,user_id) values ($1,$2)',
          [input.commentId, mention.id],
        );

      const newlyMentionedUserIds = nextIds.filter((id) => !previousIds.includes(id));
      await this.notify(
        client,
        input.taskId,
        'task.mentioned',
        { commentId: input.commentId, edited: true },
        { only: newlyMentionedUserIds },
      );
      await this.notify(
        client,
        input.taskId,
        'task.commented',
        { commentId: input.commentId, edited: true },
        { exclude: nextIds },
      );
      await appendAudit(
        client,
        this.audit('task.comment_edited', input.taskId, input.requestId, {
          commentId: input.commentId,
          fromRowVersion: current.row_version,
          toRowVersion: current.row_version + 1,
          previousBody: current.body,
          body: input.body,
          previousMentions,
          mentions,
        }),
      );
    });
    const detail = await this.getTask(input.taskId);
    return detail.comments.find((comment: TaskComment) => comment.id === input.commentId)!;
  }
}
