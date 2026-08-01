import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { appendAudit, RepositoryError, type ActorSession } from './community.js';

export const onboardingSteps = [
  'create-project',
  'install-template',
  'load-demo',
  'trace-results',
  'create-task',
] as const;
export type OnboardingStep = (typeof onboardingSteps)[number];

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await action(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export class PilotRepository {
  constructor(
    private readonly pool: Pool,
    private readonly actor: ActorSession,
  ) {}

  async onboarding() {
    const result = await this.pool.query(
      `select completed_steps,completed_at,dismissed_at,created_at,updated_at
       from onboarding_progress where user_id=$1 and organization_id=$2`,
      [this.actor.actorId, this.actor.organizationId],
    );
    const row = result.rows[0];
    return (
      row ?? {
        completed_steps: [],
        completed_at: null,
        dismissed_at: null,
        created_at: null,
        updated_at: null,
      }
    );
  }

  async updateOnboarding(input: {
    completedSteps: OnboardingStep[];
    dismissed: boolean;
    requestId: string;
  }) {
    const uniqueSteps = onboardingSteps.filter((step) => input.completedSteps.includes(step));
    const completed = uniqueSteps.length === onboardingSteps.length;
    return transaction(this.pool, async (client) => {
      const result = await client.query(
        `insert into onboarding_progress
         (user_id,organization_id,completed_steps,completed_at,dismissed_at)
       values ($1,$2,$3::jsonb,$4,$5)
       on conflict (user_id) do update set
         completed_steps=excluded.completed_steps,
         completed_at=case when excluded.completed_at is not null
           then coalesce(onboarding_progress.completed_at,excluded.completed_at) else null end,
         dismissed_at=excluded.dismissed_at,
         updated_at=now()
       returning completed_steps,completed_at,dismissed_at,created_at,updated_at`,
        [
          this.actor.actorId,
          this.actor.organizationId,
          JSON.stringify(uniqueSteps),
          completed ? new Date() : null,
          input.dismissed ? new Date() : null,
        ],
      );
      await appendAudit(client, {
        organizationId: this.actor.organizationId,
        actorId: this.actor.actorId,
        action: 'onboarding.updated',
        targetType: 'user',
        targetId: this.actor.actorId,
        requestId: input.requestId,
        payload: { completedSteps: uniqueSteps, dismissed: input.dismissed },
      });
      return result.rows[0];
    });
  }

  async captureFeedback(input: {
    projectId?: string | undefined;
    category: 'bug' | 'usability' | 'workflow' | 'idea' | 'other';
    rating: number;
    message: string;
    context: Record<string, unknown>;
    requestId: string;
  }) {
    if (input.projectId) {
      const scoped = await this.pool.query(
        `select 1 from projects p join workspaces w on w.id=p.workspace_id
         where p.id=$1 and w.organization_id=$2`,
        [input.projectId, this.actor.organizationId],
      );
      if (!scoped.rowCount)
        throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
    }
    const feedbackId = uuidv7();
    return transaction(this.pool, async (client) => {
      const result = await client.query(
        `insert into pilot_feedback
         (id,organization_id,project_id,actor_id,category,rating,message,context)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       returning id,project_id,category,rating,status,created_at`,
        [
          feedbackId,
          this.actor.organizationId,
          input.projectId ?? null,
          this.actor.actorId,
          input.category,
          input.rating,
          input.message.trim(),
          JSON.stringify(input.context),
        ],
      );
      await appendAudit(client, {
        organizationId: this.actor.organizationId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        actorId: this.actor.actorId,
        action: 'pilot.feedback_submitted',
        targetType: 'pilot_feedback',
        targetId: feedbackId,
        requestId: input.requestId,
        payload: { category: input.category, rating: input.rating },
      });
      return result.rows[0];
    });
  }

  async summary() {
    const result = await this.pool.query(
      `select
        (select count(*)::int from users u join memberships m on m.user_id=u.id
          where m.organization_id=$1 and u.disabled_at is null) users,
        (select count(*)::int from (select actor_id from audit_events where organization_id=$1
          and actor_id is not null and created_at>=now()-interval '30 days'
          group by actor_id having count(distinct created_at::date)>=2) repeat_users) repeat_users,
        (select count(*)::int from records r join projects p on p.id=r.project_id
          join workspaces w on w.id=p.workspace_id where w.organization_id=$1 and r.archived_at is null) records,
        (select count(*)::int from datasets d join projects p on p.id=d.project_id
          join workspaces w on w.id=p.workspace_id where w.organization_id=$1 and d.status='ready'
          and d.archived_at is null) datasets,
        (select count(*)::int from chart_dataset_sources s join projects p on p.id=s.project_id
          join workspaces w on w.id=p.workspace_id where w.organization_id=$1) chart_dataset_links,
        (select count(*)::int from task_links l join projects p on p.id=l.project_id
          join workspaces w on w.id=p.workspace_id where w.organization_id=$1) task_links,
        (select count(*)::int from pilot_feedback where organization_id=$1) feedback_items,
        (select count(*)::int from project_demo_installations i join projects p on p.id=i.project_id
          join workspaces w on w.id=p.workspace_id where w.organization_id=$1) demo_projects`,
      [this.actor.organizationId],
    );
    return { ...result.rows[0], measuredAt: new Date().toISOString() };
  }

  async feedbackItems(limit = 100) {
    const result = await this.pool.query(
      `select f.id,f.project_id,p.name project_name,u.display_name actor_name,
              f.category,f.rating,f.message,f.context,f.status,f.created_at
       from pilot_feedback f join users u on u.id=f.actor_id
       left join projects p on p.id=f.project_id
       where f.organization_id=$1 order by f.created_at desc,f.id desc limit $2`,
      [this.actor.organizationId, limit],
    );
    return result.rows;
  }
}
