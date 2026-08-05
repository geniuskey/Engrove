import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { appendAudit, RepositoryError, type ActorSession } from './community.js';

export type MilestoneStatus = 'planned' | 'active' | 'at_risk' | 'completed';

interface Scope {
  actor: ActorSession;
  workspaceId: string;
  projectId: string;
}

interface MilestoneInput {
  title: string;
  description: string;
  status: MilestoneStatus;
  startDate?: string | undefined;
  targetDate: string;
  progress: number;
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

export class ScopedMilestoneRepository {
  private constructor(
    private readonly pool: Pool,
    private readonly scope: Scope,
  ) {}

  static async open(pool: Pool, actor: ActorSession, workspaceId: string, projectId: string) {
    const found = await pool.query(
      'select 1 from projects p join workspaces w on w.id=p.workspace_id where p.id=$1 and p.workspace_id=$2 and w.organization_id=$3 and p.system=false',
      [projectId, workspaceId, actor.organizationId],
    );
    if (!found.rowCount)
      throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
    return new ScopedMilestoneRepository(pool, { actor, workspaceId, projectId });
  }

  private audit(action: string, milestoneId: string, requestId: string, payload = {}) {
    return {
      organizationId: this.scope.actor.organizationId,
      workspaceId: this.scope.workspaceId,
      projectId: this.scope.projectId,
      actorId: this.scope.actor.actorId,
      action,
      targetType: 'project_milestone',
      targetId: milestoneId,
      requestId,
      payload,
    };
  }

  async listMilestones(includeArchived = false) {
    const result = await this.pool.query(
      `select m.*,m.start_date::text start_date,m.target_date::text target_date
       from project_milestones m where m.project_id=$1 and ($2::boolean or m.archived_at is null)
       order by (m.archived_at is not null),case m.status when 'at_risk' then 0 when 'active' then 1 when 'planned' then 2 else 3 end,
       m.target_date,m.created_at,m.id`,
      [this.scope.projectId, includeArchived],
    );
    return result.rows;
  }

  async getMilestone(milestoneId: string) {
    const result = await this.pool.query(
      `select m.*,m.start_date::text start_date,m.target_date::text target_date
       from project_milestones m where m.project_id=$1 and m.id=$2`,
      [this.scope.projectId, milestoneId],
    );
    if (!result.rows[0])
      throw new RepositoryError('MILESTONE_NOT_FOUND', 404, 'Milestone was not found.');
    return result.rows[0];
  }

  async createMilestone(input: MilestoneInput & { requestId: string }) {
    const milestoneId = uuidv7();
    const progress = input.status === 'completed' ? 100 : input.progress;
    await transaction(this.pool, async (client) => {
      await client.query(
        `insert into project_milestones
         (id,project_id,title,description,status,start_date,target_date,progress,completed_at,created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,case when $5='completed' then now() else null end,$9)`,
        [
          milestoneId,
          this.scope.projectId,
          input.title,
          input.description,
          input.status,
          input.startDate ?? null,
          input.targetDate,
          progress,
          this.scope.actor.actorId,
        ],
      );
      await appendAudit(
        client,
        this.audit('project_milestone.created', milestoneId, input.requestId),
      );
    });
    return this.getMilestone(milestoneId);
  }

  async updateMilestone(
    milestoneId: string,
    input: MilestoneInput & { rowVersion: number; requestId: string },
  ) {
    const progress = input.status === 'completed' ? 100 : input.progress;
    await transaction(this.pool, async (client) => {
      const changed = await client.query(
        `update project_milestones set title=$4,description=$5,status=$6,start_date=$7,target_date=$8,progress=$9,
         completed_at=case when $6='completed' then coalesce(completed_at,now()) else null end,
         row_version=row_version+1,updated_at=now()
         where project_id=$1 and id=$2 and row_version=$3 and archived_at is null returning id`,
        [
          this.scope.projectId,
          milestoneId,
          input.rowVersion,
          input.title,
          input.description,
          input.status,
          input.startDate ?? null,
          input.targetDate,
          progress,
        ],
      );
      if (!changed.rowCount)
        throw new RepositoryError(
          'MILESTONE_VERSION_CONFLICT',
          409,
          'Milestone changed or is unavailable.',
        );
      await appendAudit(
        client,
        this.audit('project_milestone.updated', milestoneId, input.requestId),
      );
    });
    return this.getMilestone(milestoneId);
  }

  async setArchived(milestoneId: string, archived: boolean, reason: string, requestId: string) {
    await transaction(this.pool, async (client) => {
      const changed = await client.query(
        `update project_milestones set archived_at=${archived ? 'now()' : 'null'},archived_by=${archived ? '$3' : 'null'},archive_reason=${archived ? '$4' : 'null'},
         row_version=row_version+1,updated_at=now()
         where project_id=$1 and id=$2 and archived_at is ${archived ? 'null' : 'not null'} returning id`,
        archived
          ? [this.scope.projectId, milestoneId, this.scope.actor.actorId, reason]
          : [this.scope.projectId, milestoneId],
      );
      if (!changed.rowCount)
        throw new RepositoryError('MILESTONE_STATE_CONFLICT', 409, 'Milestone state conflicts.');
      await appendAudit(
        client,
        this.audit(
          archived ? 'project_milestone.archived' : 'project_milestone.restored',
          milestoneId,
          requestId,
        ),
      );
    });
    return this.getMilestone(milestoneId);
  }
}
