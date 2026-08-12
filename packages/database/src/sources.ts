import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { appendAudit, RepositoryError, type ActorSession } from './community.js';

interface Scope {
  actor: ActorSession;
  workspaceId: string;
  projectId: string;
}

interface SourceInput {
  title: string;
  provider: string;
  url: string;
  externalId: string;
  version: string;
  observedOn: string;
  notes: string;
}

export interface SourceListOptions {
  archiveState?: 'active' | 'archived' | 'all';
  query?: string;
  provider?: string;
  limit?: number;
  offset?: number;
}

export interface SourceListPage {
  items: Record<string, unknown>[];
  pageInfo: {
    limit: number;
    offset: number;
    total: number;
    hasNext: boolean;
  };
  summary: {
    providerCount: number;
  };
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

export class ScopedSourceRepository {
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
    return new ScopedSourceRepository(pool, { actor, workspaceId, projectId });
  }

  private audit(action: string, sourceId: string, requestId: string) {
    return {
      organizationId: this.scope.actor.organizationId,
      workspaceId: this.scope.workspaceId,
      projectId: this.scope.projectId,
      actorId: this.scope.actor.actorId,
      action,
      targetType: 'external_source',
      targetId: sourceId,
      requestId,
      payload: {},
    };
  }

  async listSources(options: SourceListOptions = {}): Promise<SourceListPage> {
    const limit = Math.min(200, Math.max(1, options.limit ?? 50));
    const offset = Math.max(0, options.offset ?? 0);
    const parameters: unknown[] = [this.scope.projectId];
    const bind = (value: unknown): string => {
      parameters.push(value);
      return `$${parameters.length}`;
    };
    const where = ['s.project_id=$1'];
    const archiveState = options.archiveState ?? 'active';
    if (archiveState === 'active') where.push('s.archived_at is null');
    if (archiveState === 'archived') where.push('s.archived_at is not null');

    const query = options.query?.trim();
    if (query) {
      const escaped = query.replace(/[\\%_]/g, '\\$&');
      const search = bind(`%${escaped}%`);
      where.push(`(
        s.title ilike ${search} escape '\\'
        or s.provider ilike ${search} escape '\\'
        or s.url ilike ${search} escape '\\'
        or s.external_id ilike ${search} escape '\\'
        or s.version ilike ${search} escape '\\'
        or s.notes ilike ${search} escape '\\'
      )`);
    }
    if (options.provider?.trim()) {
      where.push(`lower(s.provider)=lower(${bind(options.provider.trim())})`);
    }

    const filterParameters = [...parameters];
    const count = await this.pool.query<{ total: string; provider_count: string }>(
      `select count(*)::text total,count(distinct lower(s.provider))::text provider_count
       from external_sources s where ${where.join(' and ')}`,
      filterParameters,
    );
    const limitBind = bind(limit);
    const offsetBind = bind(offset);
    const result = await this.pool.query(
      `select s.*,s.observed_on::text observed_on
       from external_sources s where ${where.join(' and ')}
       order by s.updated_at desc,s.id
       limit ${limitBind} offset ${offsetBind}`,
      parameters,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return {
      items: result.rows,
      pageInfo: { limit, offset, total, hasNext: offset + result.rows.length < total },
      summary: { providerCount: Number(count.rows[0]?.provider_count ?? 0) },
    };
  }

  async getSource(sourceId: string) {
    const result = await this.pool.query(
      `select s.*,s.observed_on::text observed_on
       from external_sources s where s.project_id=$1 and s.id=$2`,
      [this.scope.projectId, sourceId],
    );
    if (!result.rows[0])
      throw new RepositoryError('SOURCE_NOT_FOUND', 404, 'Data source was not found.');
    return result.rows[0];
  }

  async createSource(input: SourceInput & { requestId: string }) {
    const sourceId = uuidv7();
    await transaction(this.pool, async (client) => {
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
      await appendAudit(client, this.audit('external_source.created', sourceId, input.requestId));
    });
    return this.getSource(sourceId);
  }

  async updateSource(
    sourceId: string,
    input: SourceInput & { rowVersion: number; requestId: string },
  ) {
    await transaction(this.pool, async (client) => {
      const changed = await client.query(
        `update external_sources set title=$4,provider=$5,url=$6,external_id=$7,version=$8,
         observed_on=$9,notes=$10,row_version=row_version+1,updated_at=now()
         where project_id=$1 and id=$2 and row_version=$3 and archived_at is null returning id`,
        [
          this.scope.projectId,
          sourceId,
          input.rowVersion,
          input.title,
          input.provider,
          input.url,
          input.externalId,
          input.version,
          input.observedOn,
          input.notes,
        ],
      );
      if (!changed.rowCount)
        throw new RepositoryError(
          'SOURCE_VERSION_CONFLICT',
          409,
          'Data source changed or is unavailable.',
        );
      await appendAudit(client, this.audit('external_source.updated', sourceId, input.requestId));
    });
    return this.getSource(sourceId);
  }

  async setArchived(sourceId: string, archived: boolean, reason: string, requestId: string) {
    await transaction(this.pool, async (client) => {
      const changed = await client.query(
        `update external_sources set archived_at=${archived ? 'now()' : 'null'},archived_by=${archived ? '$3' : 'null'},archive_reason=${archived ? '$4' : 'null'},
         row_version=row_version+1,updated_at=now()
         where project_id=$1 and id=$2 and archived_at is ${archived ? 'null' : 'not null'} returning id`,
        archived
          ? [this.scope.projectId, sourceId, this.scope.actor.actorId, reason]
          : [this.scope.projectId, sourceId],
      );
      if (!changed.rowCount)
        throw new RepositoryError('SOURCE_STATE_CONFLICT', 409, 'Data source state conflicts.');
      await appendAudit(
        client,
        this.audit(
          archived ? 'external_source.archived' : 'external_source.restored',
          sourceId,
          requestId,
        ),
      );
    });
    return this.getSource(sourceId);
  }
}
