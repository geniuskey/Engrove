import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { appendAudit, RepositoryError, type ActorSession } from './community.js';

export type RecordReviewStatus = 'discussion' | 'requested' | 'approved' | 'changes_requested';

export interface ReviewParticipant {
  id: string;
  displayName: string;
  email: string;
  role: ActorSession['role'];
}

export interface ReviewParticipantPage {
  items: ReviewParticipant[];
  pageInfo: {
    limit: number;
    offset: number;
    total: number;
    hasNext: boolean;
  };
  overallTotal: number;
}

export interface ReviewMention {
  id: string;
  displayName: string;
}

export interface RecordReviewMessage {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  mentionedUserIds: string[];
  mentionedUsers: ReviewMention[];
  createdAt: string;
}

export interface RecordReviewThread {
  id: string;
  subject: string;
  status: 'open' | 'resolved';
  reviewStatus: RecordReviewStatus;
  reviewerId: string | null;
  reviewerName: string | null;
  createdBy: string;
  creatorName: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  messages: RecordReviewMessage[];
  messagePageInfo: {
    limit: number;
    offset: number;
    total: number;
    hasNext: boolean;
  };
}

export interface RecordReviewThreadPage {
  items: RecordReviewThread[];
  pageInfo: {
    limit: number;
    offset: number;
    total: number;
    hasNext: boolean;
  };
  summary: {
    open: number;
    resolved: number;
  };
}

export interface RecordReviewMessagePage {
  items: RecordReviewMessage[];
  pageInfo: {
    limit: number;
    offset: number;
    total: number;
    hasNext: boolean;
  };
}

export interface RecordReviewInboxItem {
  id: string;
  subject: string;
  status: 'open' | 'resolved';
  reviewStatus: RecordReviewStatus;
  reviewerId: string | null;
  reviewerName: string | null;
  recordId: string;
  recordName: string;
  objectTypeId: string;
  objectTypePublicId: string;
  objectTypeName: string;
  latestMessage: string;
  messageCount: number;
  updatedAt: string;
}

export interface RecordReviewInboxOptions {
  includeResolved?: boolean;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface RecordReviewInboxPage {
  items: RecordReviewInboxItem[];
  pageInfo: {
    limit: number;
    offset: number;
    total: number;
    hasNext: boolean;
  };
  summary: {
    waitingForMe: number;
    openInvolved: number;
  };
}

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin isolation level serializable');
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

export class RecordReviewRepository {
  private constructor(
    private readonly pool: Pool,
    private readonly actor: ActorSession,
    private readonly workspaceId: string,
    private readonly projectId: string,
  ) {}

  static async open(
    pool: Pool,
    actor: ActorSession,
    workspaceId: string,
    projectId: string,
  ): Promise<RecordReviewRepository> {
    const project = await pool.query(
      `select 1 from projects p join workspaces w on w.id=p.workspace_id
       where p.id=$1 and p.workspace_id=$2 and w.organization_id=$3
         and project_visible_to(p.id,$2,$3,$4,$5)`,
      [projectId, workspaceId, actor.organizationId, actor.actorId, actor.role],
    );
    if (!project.rowCount)
      throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
    return new RecordReviewRepository(pool, actor, workspaceId, projectId);
  }

  async listParticipantPage(
    options: { query?: string; reviewerOnly?: boolean; limit?: number; offset?: number } = {},
  ): Promise<ReviewParticipantPage> {
    const query = (options.query ?? '').normalize('NFKC').trim();
    const escapedQuery = query.replace(/[\\%_]/g, '\\$&');
    const reviewerOnly = options.reviewerOnly ?? false;
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100);
    const offset = Math.min(Math.max(Math.trunc(options.offset ?? 0), 0), 1_000_000);
    const scope = `m.organization_id=$1 and u.disabled_at is null
      and project_visible_to($5,$6,$1,m.user_id,m.role::text)
      and (not $4::boolean or m.role<>'viewer')`;
    const matches = `${scope}
      and ($2::text='' or u.display_name ilike '%'||$3||'%' escape '\\'
                       or u.email ilike '%'||$3||'%' escape '\\'
                       or u.id::text=$2)`;
    const [result, counts] = await Promise.all([
      this.pool.query<{
        id: string;
        display_name: string;
        email: string;
        role: ActorSession['role'];
      }>(
        `select u.id,u.display_name,u.email,m.role
         from memberships m join users u on u.id=m.user_id
         where ${matches}
         order by case when lower(u.display_name)=lower($2) or lower(u.email)=lower($2)
                       then 0 else 1 end,
                  lower(u.display_name),lower(u.email),u.id
         limit $7 offset $8`,
        [
          this.actor.organizationId,
          query,
          escapedQuery,
          reviewerOnly,
          this.projectId,
          this.workspaceId,
          limit,
          offset,
        ],
      ),
      this.pool.query<{ total: string; overall_total: string }>(
        `select count(*) filter (where ${matches})::text total,
                count(*) filter (where ${scope})::text overall_total
         from memberships m join users u on u.id=m.user_id
         where m.organization_id=$1`,
        [
          this.actor.organizationId,
          query,
          escapedQuery,
          reviewerOnly,
          this.projectId,
          this.workspaceId,
        ],
      ),
    ]);
    const total = Number(counts.rows[0]?.total ?? 0);
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        email: row.email,
        role: row.role,
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

  async listInboxPage(options: RecordReviewInboxOptions = {}): Promise<RecordReviewInboxPage> {
    const limit = Math.min(200, Math.max(1, options.limit ?? 200));
    const offset = Math.max(0, options.offset ?? 0);
    const query = options.query?.trim();
    const search = query ? `%${query.replace(/[\\%_]/g, '\\$&')}%` : null;
    const involved = `
      from record_review_threads t
      join records r on r.project_id=t.project_id and r.id=t.record_id
      join object_types ot on ot.project_id=t.project_id and ot.id=t.object_type_id
      left join users reviewer on reviewer.id=t.reviewer_id
      join lateral (
        select body from record_review_messages message
        where message.thread_id=t.id order by message.created_at desc,message.id desc limit 1
      ) latest on true
      where t.project_id=$1
        and (
          t.reviewer_id=$2 or t.created_by=$2 or exists(
            select 1 from record_review_messages mention
            where mention.thread_id=t.id and mention.mentioned_user_ids ? $2::text
          )
        )`;
    const matchesPage = `
      ($3::boolean or t.status='open')
      and ($4::text is null
        or t.subject ilike $4 escape '\\'
        or r.display_name ilike $4 escape '\\'
        or ot.name ilike $4 escape '\\'
        or coalesce(reviewer.display_name,'') ilike $4 escape '\\'
        or latest.body ilike $4 escape '\\')`;
    const [result, counts] = await Promise.all([
      this.pool.query<{
        id: string;
        subject: string;
        status: 'open' | 'resolved';
        review_status: RecordReviewStatus;
        reviewer_id: string | null;
        reviewer_name: string | null;
        record_id: string;
        record_name: string;
        object_type_id: string;
        object_type_public_id: string;
        object_type_name: string;
        latest_message: string;
        message_count: string;
        updated_at: Date;
      }>(
        `select t.id,t.subject,t.status,t.review_status,t.reviewer_id,
              reviewer.display_name reviewer_name,t.record_id,r.display_name record_name,
              t.object_type_id,ot.public_id object_type_public_id,ot.name object_type_name,
              latest.body latest_message,
              (select count(*) from record_review_messages counted where counted.thread_id=t.id)::text message_count,
              t.updated_at
       ${involved} and ${matchesPage}
       order by (t.status='open') desc,
                (t.reviewer_id=$2 and t.review_status='requested') desc,
                t.updated_at desc,t.id desc
       limit $5 offset $6`,
        [
          this.projectId,
          this.actor.actorId,
          options.includeResolved ?? false,
          search,
          limit,
          offset,
        ],
      ),
      this.pool.query<{ total: string; waiting_for_me: string; open_involved: string }>(
        `select
           count(*) filter(where ${matchesPage})::text total,
           count(*) filter(where t.status='open' and t.reviewer_id=$2 and t.review_status='requested')::text waiting_for_me,
           count(*) filter(where t.status='open')::text open_involved
         ${involved}`,
        [this.projectId, this.actor.actorId, options.includeResolved ?? false, search],
      ),
    ]);
    const total = Number(counts.rows[0]?.total ?? 0);
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        subject: row.subject,
        status: row.status,
        reviewStatus: row.review_status,
        reviewerId: row.reviewer_id,
        reviewerName: row.reviewer_name,
        recordId: row.record_id,
        recordName: row.record_name,
        objectTypeId: row.object_type_id,
        objectTypePublicId: row.object_type_public_id,
        objectTypeName: row.object_type_name,
        latestMessage: row.latest_message,
        messageCount: Number(row.message_count),
        updatedAt: row.updated_at.toISOString(),
      })),
      pageInfo: {
        limit,
        offset,
        total,
        hasNext: offset + result.rows.length < total,
      },
      summary: {
        waitingForMe: Number(counts.rows[0]?.waiting_for_me ?? 0),
        openInvolved: Number(counts.rows[0]?.open_involved ?? 0),
      },
    };
  }

  private async ensureRecord(client: Pool | PoolClient, objectTypeId: string, recordId: string) {
    const result = await client.query(
      `select 1 from records where project_id=$1 and object_type_id=$2 and id=$3`,
      [this.projectId, objectTypeId, recordId],
    );
    if (!result.rowCount)
      throw new RepositoryError('RECORD_NOT_FOUND', 404, 'Record was not found.');
  }

  private async validateParticipants(client: PoolClient, userIds: string[]) {
    const uniqueIds = [...new Set(userIds)];
    if (!uniqueIds.length) return;
    const result = await client.query<{ id: string }>(
      `select u.id from memberships m join users u on u.id=m.user_id
       where m.organization_id=$1 and m.user_id=any($2::uuid[]) and u.disabled_at is null
         and project_visible_to($3,$4,$1,m.user_id,m.role::text)`,
      [this.actor.organizationId, uniqueIds, this.projectId, this.workspaceId],
    );
    if (result.rowCount !== uniqueIds.length) {
      throw new RepositoryError(
        'REVIEW_PARTICIPANT_INVALID',
        400,
        'Every mentioned person must be an active organization member.',
      );
    }
  }

  private async validateReviewer(client: PoolClient, reviewerId: string | null | undefined) {
    if (!reviewerId) return;
    const result = await client.query(
      `select 1 from memberships m join users u on u.id=m.user_id
       where m.organization_id=$1 and m.user_id=$2 and m.role<>'viewer'
         and u.disabled_at is null
         and project_visible_to($3,$4,$1,m.user_id,m.role::text)`,
      [this.actor.organizationId, reviewerId, this.projectId, this.workspaceId],
    );
    if (!result.rowCount) {
      throw new RepositoryError(
        'REVIEW_REVIEWER_INELIGIBLE',
        400,
        'A reviewer must be an active organization member who can resolve reviews.',
      );
    }
  }

  async listThreadPage(
    objectTypeId: string,
    recordId: string,
    options: {
      includeResolved?: boolean;
      limit?: number;
      offset?: number;
      threadId?: string;
    } = {},
  ): Promise<RecordReviewThreadPage> {
    await this.ensureRecord(this.pool, objectTypeId, recordId);
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 50);
    const offset = Math.min(Math.max(Math.trunc(options.offset ?? 0), 0), 1_000_000);
    const includeResolved = options.includeResolved ?? true;
    const threadId = options.threadId ?? null;
    const [threads, counts] = await Promise.all([
      this.pool.query<{
        id: string;
        subject: string;
        status: 'open' | 'resolved';
        review_status: RecordReviewStatus;
        reviewer_id: string | null;
        reviewer_name: string | null;
        created_by: string;
        creator_name: string;
        resolved_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `select t.id,t.subject,t.status,t.review_status,t.reviewer_id,
                reviewer.display_name reviewer_name,t.created_by,creator.display_name creator_name,
                t.resolved_at,t.created_at,t.updated_at
         from record_review_threads t
         join users creator on creator.id=t.created_by
         left join users reviewer on reviewer.id=t.reviewer_id
         where t.project_id=$1 and t.object_type_id=$2 and t.record_id=$3
           and ($4::boolean or t.status='open')
           and ($5::uuid is null or t.id=$5)
         order by (t.status='open') desc,t.updated_at desc,t.id desc
         limit $6 offset $7`,
        [this.projectId, objectTypeId, recordId, includeResolved, threadId, limit, offset],
      ),
      this.pool.query<{ total: string; open_total: string; resolved_total: string }>(
        `select
           count(*) filter(where ($4::boolean or t.status='open')
                              and ($5::uuid is null or t.id=$5))::text total,
           count(*) filter(where t.status='open')::text open_total,
           count(*) filter(where t.status='resolved')::text resolved_total
         from record_review_threads t
         where t.project_id=$1 and t.object_type_id=$2 and t.record_id=$3`,
        [this.projectId, objectTypeId, recordId, includeResolved, threadId],
      ),
    ]);
    const total = Number(counts.rows[0]?.total ?? 0);
    if (!threads.rows.length) {
      return {
        items: [],
        pageInfo: { limit, offset, total, hasNext: false },
        summary: {
          open: Number(counts.rows[0]?.open_total ?? 0),
          resolved: Number(counts.rows[0]?.resolved_total ?? 0),
        },
      };
    }
    const messageLimit = 20;
    const messages = await this.pool.query<{
      id: string;
      thread_id: string;
      body: string;
      author_id: string;
      author_name: string;
      mentioned_user_ids: unknown;
      mentioned_users: unknown;
      message_total: string;
      created_at: Date;
    }>(
      `select m.id,m.thread_id,m.body,m.author_id,u.display_name author_name,
              m.mentioned_user_ids,
              coalesce((
                select jsonb_agg(
                  jsonb_build_object('id',mentioned.id,'displayName',mentioned.display_name)
                  order by mention.ordinality
                )
                from jsonb_array_elements_text(m.mentioned_user_ids)
                  with ordinality mention(user_id,ordinality)
                join users mentioned on mentioned.id=mention.user_id::uuid
              ),'[]'::jsonb) mentioned_users,
              m.message_total,m.created_at
       from (
         select message.*,
                row_number() over(
                  partition by message.thread_id order by message.created_at desc,message.id desc
                ) message_rank,
                count(*) over(partition by message.thread_id)::text message_total
         from record_review_messages message
         where message.thread_id=any($1::uuid[])
       ) m
       join users u on u.id=m.author_id
       where m.message_rank<=$2
       order by m.thread_id,m.created_at,m.id`,
      [threads.rows.map((thread) => thread.id), messageLimit],
    );
    const byThread = new Map<string, RecordReviewMessage[]>();
    const messageTotals = new Map<string, number>();
    for (const row of messages.rows) {
      const current = byThread.get(row.thread_id) ?? [];
      current.push(this.mapMessage(row));
      byThread.set(row.thread_id, current);
      messageTotals.set(row.thread_id, Number(row.message_total));
    }
    return {
      items: threads.rows.map((row) => {
        const threadMessages = byThread.get(row.id) ?? [];
        const messageTotal = messageTotals.get(row.id) ?? 0;
        return {
          id: row.id,
          subject: row.subject,
          status: row.status,
          reviewStatus: row.review_status,
          reviewerId: row.reviewer_id,
          reviewerName: row.reviewer_name,
          createdBy: row.created_by,
          creatorName: row.creator_name,
          resolvedAt: row.resolved_at?.toISOString() ?? null,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
          messages: threadMessages,
          messagePageInfo: {
            limit: messageLimit,
            offset: 0,
            total: messageTotal,
            hasNext: threadMessages.length < messageTotal,
          },
        };
      }),
      pageInfo: {
        limit,
        offset,
        total,
        hasNext: offset + threads.rows.length < total,
      },
      summary: {
        open: Number(counts.rows[0]?.open_total ?? 0),
        resolved: Number(counts.rows[0]?.resolved_total ?? 0),
      },
    };
  }

  async listMessagePage(
    threadId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<RecordReviewMessagePage> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 100);
    const offset = Math.min(Math.max(Math.trunc(options.offset ?? 0), 0), 1_000_000);
    const thread = await this.pool.query(
      `select 1 from record_review_threads where id=$1 and project_id=$2`,
      [threadId, this.projectId],
    );
    if (!thread.rowCount)
      throw new RepositoryError('REVIEW_THREAD_NOT_FOUND', 404, 'Review thread was not found.');
    const [messages, count] = await Promise.all([
      this.pool.query<{
        id: string;
        thread_id: string;
        body: string;
        author_id: string;
        author_name: string;
        mentioned_user_ids: unknown;
        mentioned_users: unknown;
        created_at: Date;
      }>(
        `select m.id,m.thread_id,m.body,m.author_id,u.display_name author_name,
                m.mentioned_user_ids,
                coalesce((
                  select jsonb_agg(
                    jsonb_build_object('id',mentioned.id,'displayName',mentioned.display_name)
                    order by mention.ordinality
                  )
                  from jsonb_array_elements_text(m.mentioned_user_ids)
                    with ordinality mention(user_id,ordinality)
                  join users mentioned on mentioned.id=mention.user_id::uuid
                ),'[]'::jsonb) mentioned_users,
                m.created_at
         from record_review_messages m join users u on u.id=m.author_id
         where m.thread_id=$1
         order by m.created_at desc,m.id desc
         limit $2 offset $3`,
        [threadId, limit, offset],
      ),
      this.pool.query<{ total: string }>(
        `select count(*)::text total from record_review_messages where thread_id=$1`,
        [threadId],
      ),
    ]);
    const total = Number(count.rows[0]?.total ?? 0);
    return {
      items: messages.rows.map((row) => this.mapMessage(row)).reverse(),
      pageInfo: {
        limit,
        offset,
        total,
        hasNext: offset + messages.rows.length < total,
      },
    };
  }

  private mapMessage(row: {
    id: string;
    body: string;
    author_id: string;
    author_name: string;
    mentioned_user_ids: unknown;
    mentioned_users: unknown;
    created_at: Date;
  }): RecordReviewMessage {
    const mentionedUserIds = Array.isArray(row.mentioned_user_ids)
      ? row.mentioned_user_ids.filter((value): value is string => typeof value === 'string')
      : [];
    const mentionedUsers = Array.isArray(row.mentioned_users)
      ? row.mentioned_users.filter(
          (value): value is ReviewMention =>
            typeof value === 'object' &&
            value !== null &&
            typeof (value as ReviewMention).id === 'string' &&
            typeof (value as ReviewMention).displayName === 'string',
        )
      : [];
    return {
      id: row.id,
      body: row.body,
      authorId: row.author_id,
      authorName: row.author_name,
      mentionedUserIds,
      mentionedUsers,
      createdAt: row.created_at.toISOString(),
    };
  }

  private async getThread(objectTypeId: string, recordId: string, threadId: string) {
    const result = await this.listThreadPage(objectTypeId, recordId, {
      includeResolved: true,
      threadId,
      limit: 1,
    });
    const thread = result.items[0];
    if (!thread)
      throw new RepositoryError('REVIEW_THREAD_NOT_FOUND', 404, 'Review thread was not found.');
    return thread;
  }

  async createThread(input: {
    objectTypeId: string;
    recordId: string;
    subject: string;
    body: string;
    reviewerId?: string | null;
    mentionedUserIds?: string[];
    requestId: string;
  }): Promise<RecordReviewThread> {
    const threadId = uuidv7();
    await transaction(this.pool, async (client) => {
      await this.ensureRecord(client, input.objectTypeId, input.recordId);
      await this.validateReviewer(client, input.reviewerId);
      await this.validateParticipants(client, input.mentionedUserIds ?? []);
      await client.query(
        `insert into record_review_threads
          (id,project_id,object_type_id,record_id,subject,review_status,reviewer_id,created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          threadId,
          this.projectId,
          input.objectTypeId,
          input.recordId,
          input.subject.trim(),
          input.reviewerId ? 'requested' : 'discussion',
          input.reviewerId ?? null,
          this.actor.actorId,
        ],
      );
      await client.query(
        `insert into record_review_messages
          (id,thread_id,author_id,body,mentioned_user_ids)
         values ($1,$2,$3,$4,$5::jsonb)`,
        [
          uuidv7(),
          threadId,
          this.actor.actorId,
          input.body.trim(),
          JSON.stringify(input.mentionedUserIds ?? []),
        ],
      );
      await appendAudit(client, {
        organizationId: this.actor.organizationId,
        workspaceId: this.workspaceId,
        projectId: this.projectId,
        actorId: this.actor.actorId,
        action: input.reviewerId ? 'record.review_requested' : 'record.discussion_created',
        targetType: 'record_review_thread',
        targetId: threadId,
        requestId: input.requestId,
        payload: {
          recordId: input.recordId,
          objectTypeId: input.objectTypeId,
          reviewerId: input.reviewerId ?? null,
          mentionedUserIds: input.mentionedUserIds ?? [],
        },
      });
    });
    return this.getThread(input.objectTypeId, input.recordId, threadId);
  }

  private async lockedThread(client: PoolClient, threadId: string) {
    const result = await client.query<{
      id: string;
      object_type_id: string;
      record_id: string;
      status: 'open' | 'resolved';
      review_status: RecordReviewStatus;
      reviewer_id: string | null;
      created_by: string;
    }>(
      `select id,object_type_id,record_id,status,review_status,reviewer_id,created_by
       from record_review_threads where id=$1 and project_id=$2 for update`,
      [threadId, this.projectId],
    );
    if (!result.rows[0])
      throw new RepositoryError('REVIEW_THREAD_NOT_FOUND', 404, 'Review thread was not found.');
    return result.rows[0];
  }

  async reply(input: {
    threadId: string;
    body: string;
    mentionedUserIds?: string[];
    requestId: string;
  }): Promise<RecordReviewThread> {
    let record!: { objectTypeId: string; recordId: string };
    await transaction(this.pool, async (client) => {
      const thread = await this.lockedThread(client, input.threadId);
      if (thread.status === 'resolved')
        throw new RepositoryError('REVIEW_THREAD_RESOLVED', 409, 'Resolved threads are read-only.');
      await this.validateParticipants(client, input.mentionedUserIds ?? []);
      await client.query(
        `insert into record_review_messages
          (id,thread_id,author_id,body,mentioned_user_ids)
         values ($1,$2,$3,$4,$5::jsonb)`,
        [
          uuidv7(),
          input.threadId,
          this.actor.actorId,
          input.body.trim(),
          JSON.stringify(input.mentionedUserIds ?? []),
        ],
      );
      await client.query('update record_review_threads set updated_at=now() where id=$1', [
        input.threadId,
      ]);
      await appendAudit(client, {
        organizationId: this.actor.organizationId,
        workspaceId: this.workspaceId,
        projectId: this.projectId,
        actorId: this.actor.actorId,
        action: 'record.discussion_replied',
        targetType: 'record_review_thread',
        targetId: input.threadId,
        requestId: input.requestId,
        payload: { recordId: thread.record_id, mentionedUserIds: input.mentionedUserIds ?? [] },
      });
      record = { objectTypeId: thread.object_type_id, recordId: thread.record_id };
    });
    return this.getThread(record.objectTypeId, record.recordId, input.threadId);
  }

  async decide(input: {
    threadId: string;
    decision: 'approved' | 'changes_requested';
    body: string;
    requestId: string;
  }): Promise<RecordReviewThread> {
    let record!: { objectTypeId: string; recordId: string };
    await transaction(this.pool, async (client) => {
      const thread = await this.lockedThread(client, input.threadId);
      if (thread.status === 'resolved')
        throw new RepositoryError('REVIEW_THREAD_RESOLVED', 409, 'This review is already closed.');
      if (thread.review_status !== 'requested' || !thread.reviewer_id) {
        throw new RepositoryError(
          'REVIEW_DECISION_NOT_REQUESTED',
          409,
          'A decision can only be recorded for a requested review.',
        );
      }
      const elevated = ['owner', 'admin', 'engineer'].includes(this.actor.role);
      if (thread.reviewer_id && thread.reviewer_id !== this.actor.actorId && !elevated) {
        throw new RepositoryError(
          'REVIEW_DECISION_FORBIDDEN',
          403,
          'Only the requested reviewer or an Engineer can decide this review.',
        );
      }
      await client.query(
        `insert into record_review_messages (id,thread_id,author_id,body,mentioned_user_ids)
         values ($1,$2,$3,$4,'[]'::jsonb)`,
        [uuidv7(), input.threadId, this.actor.actorId, input.body.trim()],
      );
      await client.query(
        `update record_review_threads
         set status='resolved',review_status=$2,resolved_at=now(),resolved_by=$3,updated_at=now()
         where id=$1`,
        [input.threadId, input.decision, this.actor.actorId],
      );
      await appendAudit(client, {
        organizationId: this.actor.organizationId,
        workspaceId: this.workspaceId,
        projectId: this.projectId,
        actorId: this.actor.actorId,
        action: `record.review_${input.decision}`,
        targetType: 'record_review_thread',
        targetId: input.threadId,
        requestId: input.requestId,
        payload: { recordId: thread.record_id, decision: input.decision },
      });
      record = { objectTypeId: thread.object_type_id, recordId: thread.record_id };
    });
    return this.getThread(record.objectTypeId, record.recordId, input.threadId);
  }

  async resolve(threadId: string, requestId: string): Promise<RecordReviewThread> {
    let record!: { objectTypeId: string; recordId: string };
    await transaction(this.pool, async (client) => {
      const thread = await this.lockedThread(client, threadId);
      if (thread.status === 'resolved') {
        record = { objectTypeId: thread.object_type_id, recordId: thread.record_id };
        return;
      }
      const elevated = ['owner', 'admin', 'engineer'].includes(this.actor.role);
      if (
        thread.created_by !== this.actor.actorId &&
        thread.reviewer_id !== this.actor.actorId &&
        !elevated
      ) {
        throw new RepositoryError(
          'REVIEW_RESOLVE_FORBIDDEN',
          403,
          'Only the thread owner, reviewer, or an Engineer can resolve this thread.',
        );
      }
      await client.query(
        `update record_review_threads
         set status='resolved',resolved_at=now(),resolved_by=$2,updated_at=now() where id=$1`,
        [threadId, this.actor.actorId],
      );
      await appendAudit(client, {
        organizationId: this.actor.organizationId,
        workspaceId: this.workspaceId,
        projectId: this.projectId,
        actorId: this.actor.actorId,
        action: 'record.discussion_resolved',
        targetType: 'record_review_thread',
        targetId: threadId,
        requestId,
        payload: { recordId: thread.record_id },
      });
      record = { objectTypeId: thread.object_type_id, recordId: thread.record_id };
    });
    return this.getThread(record.objectTypeId, record.recordId, threadId);
  }
}
