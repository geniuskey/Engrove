import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { appendAudit, RepositoryError, type ActorSession } from './community.js';
import { assertTaskStatus } from './task-workflows.js';

export const taskAutomationTriggerTypes = [
  'task.created',
  'task.status_changed',
  'task.priority_changed',
  'task.assignee_changed',
] as const;
export type TaskAutomationTriggerType = (typeof taskAutomationTriggerTypes)[number];
export type AutomationTaskStatus = string;
export type AutomationTaskPriority = 'low' | 'medium' | 'high' | 'critical';
export const taskAutomationOutcomes = ['succeeded', 'no_change', 'failed'] as const;
export type TaskAutomationOutcome = (typeof taskAutomationOutcomes)[number];

export interface TaskAutomationExecutionListOptions {
  outcome?: TaskAutomationOutcome;
  ruleId?: string;
  limit?: number;
  offset?: number;
}

export interface TaskAutomationExecutionRow {
  id: string;
  ruleId: string;
  ruleName: string;
  triggerType: TaskAutomationTriggerType;
  triggerEvent: Record<string, unknown>;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  traceId: string;
  depth: number;
  outcome: TaskAutomationOutcome;
  changes: Record<string, unknown>;
  errorCode: string | null;
  durationMs: number;
  createdAt: string;
}

export interface TaskAutomationExecutionPage {
  items: TaskAutomationExecutionRow[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
  summary: Record<TaskAutomationOutcome, number>;
}

export interface TaskAutomationRulePage {
  items: ReturnType<typeof mapRule>[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
}

export interface TaskAutomationTriggerConfig {
  fromStatus?: 'any' | AutomationTaskStatus;
  toStatus?: 'any' | AutomationTaskStatus;
  fromPriority?: 'any' | AutomationTaskPriority;
  toPriority?: 'any' | AutomationTaskPriority;
  assignment?: 'any' | 'assigned' | 'unassigned' | 'changed';
}

export interface TaskAutomationConditionConfig {
  status?: AutomationTaskStatus;
  priority?: AutomationTaskPriority;
  assignee?: 'assigned' | 'unassigned';
}

export interface TaskAutomationActionConfig {
  status?: AutomationTaskStatus;
  priority?: AutomationTaskPriority;
  assigneeId?: string | null;
}

export interface TaskAutomationRuleInput {
  name: string;
  description: string;
  triggerType: TaskAutomationTriggerType;
  triggerConfig: TaskAutomationTriggerConfig;
  conditionConfig: TaskAutomationConditionConfig;
  actionConfig: TaskAutomationActionConfig;
  active: boolean;
}

interface Scope {
  actor: ActorSession;
  workspaceId: string;
  projectId: string;
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

function mapRule(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    triggerType: row.trigger_type,
    triggerConfig: row.trigger_config,
    conditionConfig: row.condition_config,
    actionConfig: row.action_config,
    active: row.active,
    executionCount: row.execution_count,
    failedCount: Number(row.failed_count ?? 0),
    lastOutcome: row.last_outcome ?? null,
    lastErrorCode: row.last_error_code ?? null,
    lastExecutedAt:
      row.last_executed_at instanceof Date ? row.last_executed_at.toISOString() : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

const ruleSelect = `r.id,r.name,r.description,r.trigger_type,r.trigger_config,r.condition_config,
  r.action_config,r.active,r.execution_count,r.last_executed_at,r.created_at,r.updated_at,
  coalesce(health.failed_count,0)::int failed_count,health.last_outcome,health.last_error_code`;
const ruleHealthJoin = `left join lateral (
  select count(*) filter(where e.outcome='failed') failed_count,
         (array_agg(e.outcome order by e.created_at desc,e.id desc))[1] last_outcome,
         (array_agg(e.error_code order by e.created_at desc,e.id desc))[1] last_error_code
  from task_automation_executions e where e.project_id=r.project_id and e.rule_id=r.id
) health on true`;

export class ScopedTaskAutomationRepository {
  private constructor(
    private readonly pool: Pool,
    private readonly scope: Scope,
  ) {}

  static async open(pool: Pool, actor: ActorSession, workspaceId: string, projectId: string) {
    const found = await pool.query(
      `select 1 from projects p join workspaces w on w.id=p.workspace_id
       where p.id=$1 and p.workspace_id=$2 and w.organization_id=$3 and p.system=false
         and project_visible_to(p.id,$2,$3,$4,$5)`,
      [projectId, workspaceId, actor.organizationId, actor.actorId, actor.role],
    );
    if (!found.rowCount)
      throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
    return new ScopedTaskAutomationRepository(pool, { actor, workspaceId, projectId });
  }

  private audit(action: string, ruleId: string, requestId: string, payload = {}) {
    return {
      organizationId: this.scope.actor.organizationId,
      workspaceId: this.scope.workspaceId,
      projectId: this.scope.projectId,
      actorId: this.scope.actor.actorId,
      action,
      targetType: 'task_automation_rule',
      targetId: ruleId,
      requestId,
      payload,
    };
  }

  private async validateAssignee(client: PoolClient, assigneeId?: string | null) {
    if (!assigneeId) return;
    const member = await client.query(
      `select 1 from memberships m join users u on u.id=m.user_id
       where m.organization_id=$1 and m.user_id=$2 and u.disabled_at is null`,
      [this.scope.actor.organizationId, assigneeId],
    );
    if (!member.rowCount)
      throw new RepositoryError(
        'TASK_AUTOMATION_ASSIGNEE_INVALID',
        400,
        'Automation assignee is not an active organization member.',
      );
  }

  private async validateStatuses(client: PoolClient, input: TaskAutomationRuleInput) {
    const candidates = [
      input.triggerConfig.fromStatus,
      input.triggerConfig.toStatus,
      input.conditionConfig.status,
      input.actionConfig.status,
    ].filter((value): value is string => Boolean(value) && value !== 'any');
    for (const status of new Set(candidates))
      await assertTaskStatus(client, this.scope.projectId, status);
  }

  private async getRule(ruleId: string) {
    const result = await this.pool.query(
      `select ${ruleSelect} from task_automation_rules r ${ruleHealthJoin}
       where r.project_id=$1 and r.id=$2 and r.archived_at is null`,
      [this.scope.projectId, ruleId],
    );
    if (!result.rows[0])
      throw new RepositoryError('TASK_AUTOMATION_NOT_FOUND', 404, 'Automation rule was not found.');
    return mapRule(result.rows[0]);
  }

  async listRulePage(
    options: { limit?: number; offset?: number } = {},
  ): Promise<TaskAutomationRulePage> {
    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const offset = Math.max(0, options.offset ?? 0);
    const [result, count] = await Promise.all([
      this.pool.query(
        `select ${ruleSelect} from task_automation_rules r ${ruleHealthJoin}
         where r.project_id=$1 and r.archived_at is null
         order by r.active desc,lower(r.name),r.id limit $2 offset $3`,
        [this.scope.projectId, limit, offset],
      ),
      this.pool.query<{ count: string }>(
        'select count(*)::text count from task_automation_rules where project_id=$1 and archived_at is null',
        [this.scope.projectId],
      ),
    ]);
    const items = result.rows.map(mapRule);
    const total = Number(count.rows[0]?.count ?? 0);
    return {
      items,
      pageInfo: { limit, offset, total, hasNext: offset + items.length < total },
    };
  }

  async createRule(input: TaskAutomationRuleInput & { requestId: string }) {
    const ruleId = uuidv7();
    try {
      await transaction(this.pool, async (client) => {
        await this.validateAssignee(client, input.actionConfig.assigneeId);
        await this.validateStatuses(client, input);
        await client.query(
          `insert into task_automation_rules
           (id,project_id,name,description,trigger_type,trigger_config,condition_config,
            action_config,active,created_by)
           values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10)`,
          [
            ruleId,
            this.scope.projectId,
            input.name,
            input.description,
            input.triggerType,
            JSON.stringify(input.triggerConfig),
            JSON.stringify(input.conditionConfig),
            JSON.stringify(input.actionConfig),
            input.active,
            this.scope.actor.actorId,
          ],
        );
        await appendAudit(
          client,
          this.audit('task_automation.created', ruleId, input.requestId, {
            triggerType: input.triggerType,
            active: input.active,
          }),
        );
      });
    } catch (error) {
      if (
        (error as { constraint?: string }).constraint === 'task_automation_rules_project_name_key'
      )
        throw new RepositoryError(
          'TASK_AUTOMATION_NAME_CONFLICT',
          409,
          'An automation rule with this name already exists.',
        );
      throw error;
    }
    return this.getRule(ruleId);
  }

  async updateRule(ruleId: string, input: TaskAutomationRuleInput & { requestId: string }) {
    try {
      await transaction(this.pool, async (client) => {
        await this.validateAssignee(client, input.actionConfig.assigneeId);
        await this.validateStatuses(client, input);
        const updated = await client.query(
          `update task_automation_rules set name=$3,description=$4,trigger_type=$5,
                  trigger_config=$6::jsonb,condition_config=$7::jsonb,action_config=$8::jsonb,
                  active=$9,updated_at=now()
           where project_id=$1 and id=$2 and archived_at is null returning id`,
          [
            this.scope.projectId,
            ruleId,
            input.name,
            input.description,
            input.triggerType,
            JSON.stringify(input.triggerConfig),
            JSON.stringify(input.conditionConfig),
            JSON.stringify(input.actionConfig),
            input.active,
          ],
        );
        if (!updated.rowCount)
          throw new RepositoryError(
            'TASK_AUTOMATION_NOT_FOUND',
            404,
            'Automation rule was not found.',
          );
        await appendAudit(
          client,
          this.audit('task_automation.updated', ruleId, input.requestId, {
            triggerType: input.triggerType,
            active: input.active,
          }),
        );
      });
    } catch (error) {
      if (
        (error as { constraint?: string }).constraint === 'task_automation_rules_project_name_key'
      )
        throw new RepositoryError(
          'TASK_AUTOMATION_NAME_CONFLICT',
          409,
          'An automation rule with this name already exists.',
        );
      throw error;
    }
    return this.getRule(ruleId);
  }

  async listExecutionPage(
    options: TaskAutomationExecutionListOptions = {},
  ): Promise<TaskAutomationExecutionPage> {
    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const offset = Math.max(0, options.offset ?? 0);
    const outcome = options.outcome ?? null;
    const ruleId = options.ruleId ?? null;
    const [result, counts] = await Promise.all([
      this.pool.query(
        `select e.id,e.rule_id,e.rule_name,e.trigger_type,e.trigger_event,e.task_id,
                p.key||'-'||t.task_number task_key,t.title task_title,e.trace_id,e.depth,e.outcome,
                e.changes,e.error_code,e.duration_ms,e.created_at
         from task_automation_executions e
         join tasks t on t.project_id=e.project_id and t.id=e.task_id
         join projects p on p.id=e.project_id
         where e.project_id=$1 and ($2::text is null or e.outcome=$2)
           and ($3::uuid is null or e.rule_id=$3)
         order by e.created_at desc,e.id desc limit $4 offset $5`,
        [this.scope.projectId, outcome, ruleId, limit, offset],
      ),
      this.pool.query<{
        total: string;
        succeeded: string;
        no_change: string;
        failed: string;
      }>(
        `select
           count(*) filter(where ($2::text is null or outcome=$2)
             and ($3::uuid is null or rule_id=$3))::text total,
           count(*) filter(where outcome='succeeded')::text succeeded,
           count(*) filter(where outcome='no_change')::text no_change,
           count(*) filter(where outcome='failed')::text failed
         from task_automation_executions where project_id=$1
           and ($3::uuid is null or rule_id=$3)`,
        [this.scope.projectId, outcome, ruleId],
      ),
    ]);
    const items = result.rows.map((row) => ({
      id: row.id,
      ruleId: row.rule_id,
      ruleName: row.rule_name,
      triggerType: row.trigger_type,
      triggerEvent: row.trigger_event,
      taskId: row.task_id,
      taskKey: row.task_key,
      taskTitle: row.task_title,
      traceId: row.trace_id,
      depth: row.depth,
      outcome: row.outcome,
      changes: row.changes,
      errorCode: row.error_code,
      durationMs: row.duration_ms,
      createdAt: row.created_at.toISOString(),
    }));
    const total = Number(counts.rows[0]?.total ?? 0);
    return {
      items,
      pageInfo: { limit, offset, total, hasNext: offset + items.length < total },
      summary: {
        succeeded: Number(counts.rows[0]?.succeeded ?? 0),
        no_change: Number(counts.rows[0]?.no_change ?? 0),
        failed: Number(counts.rows[0]?.failed ?? 0),
      },
    };
  }

  async archiveRule(ruleId: string, requestId: string): Promise<void> {
    await transaction(this.pool, async (client) => {
      const archived = await client.query(
        `update task_automation_rules set active=false,archived_at=now(),archived_by=$3,updated_at=now()
         where project_id=$1 and id=$2 and archived_at is null returning name`,
        [this.scope.projectId, ruleId, this.scope.actor.actorId],
      );
      if (!archived.rows[0])
        throw new RepositoryError(
          'TASK_AUTOMATION_NOT_FOUND',
          404,
          'Automation rule was not found.',
        );
      await appendAudit(
        client,
        this.audit('task_automation.archived', ruleId, requestId, {
          name: archived.rows[0].name,
        }),
      );
    });
  }
}
