import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { RecordReviewRepository } from '../src/record-reviews.js';

const actor = {
  sessionId: 'session-1',
  actorId: '019fbcf9-e020-71da-935a-6a6a728b3790',
  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
  role: 'contributor' as const,
  email: 'contributor@example.com',
  displayName: 'Contributor',
  csrfTokenHash: '',
};

describe('record review workflow', () => {
  it('searches a bounded reviewer directory with exact totals', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: '019fbcf9-e020-71da-935a-6a6a728b3792',
            display_name: 'Quality Reviewer',
            email: 'reviewer@example.com',
            role: 'reviewer',
          },
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ total: '3', overall_total: '14' }],
      });
    const repository = await RecordReviewRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.listParticipantPage({
        query: 'Quality_%',
        reviewerOnly: true,
        limit: 1,
        offset: 1,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3792',
          displayName: 'Quality Reviewer',
          email: 'reviewer@example.com',
          role: 'reviewer',
        },
      ],
      pageInfo: { limit: 1, offset: 1, total: 3, hasNext: true },
      overallTotal: 14,
    });
    expect(query.mock.calls[1]?.[1]).toEqual([
      actor.organizationId,
      'Quality_%',
      'Quality\\_\\%',
      true,
      'project-1',
      'workspace-1',
      1,
      1,
    ]);
  });

  it('maps the current actor review inbox with exact record routes', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'thread-1',
            subject: 'Verify calibration',
            status: 'open',
            review_status: 'requested',
            reviewer_id: actor.actorId,
            reviewer_name: actor.displayName,
            record_id: 'record-1',
            record_name: 'Sample 24',
            object_type_id: 'object-1',
            object_type_public_id: 't1234567890abcd',
            object_type_name: 'Sample',
            latest_message: 'Please verify the certificate.',
            message_count: '2',
            updated_at: new Date('2026-08-07T12:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ total: '2', waiting_for_me: '7', open_involved: '19' }],
      });
    const repository = await RecordReviewRepository.open(
      { query } as unknown as Pool,
      actor,
      'workspace-1',
      'project-1',
    );

    await expect(
      repository.listInboxPage({ query: 'certificate', limit: 1, offset: 0 }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          subject: 'Verify calibration',
          objectTypePublicId: 't1234567890abcd',
          recordId: 'record-1',
          messageCount: 2,
        }),
      ],
      pageInfo: { limit: 1, offset: 0, total: 2, hasNext: true },
      summary: { waitingForMe: 7, openInvolved: 19 },
    });
    expect(query.mock.calls[1]?.[1]).toEqual([
      'project-1',
      actor.actorId,
      false,
      '%certificate%',
      1,
      0,
    ]);
  });

  it('rejects decisions on ordinary discussions even through the direct repository API', async () => {
    const clientQuery = vi.fn(async (statement: string) => {
      if (statement.includes('from record_review_threads')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3792',
              object_type_id: 'object-1',
              record_id: 'record-1',
              status: 'open',
              review_status: 'discussion',
              reviewer_id: null,
              created_by: actor.actorId,
            },
          ],
        };
      }
      return { rowCount: null, rows: [] };
    });
    const client = { query: clientQuery, release: vi.fn() };
    const pool = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{}] }),
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const repository = await RecordReviewRepository.open(pool, actor, 'workspace-1', 'project-1');

    await expect(
      repository.decide({
        threadId: '019fbcf9-e020-71da-935a-6a6a728b3792',
        decision: 'approved',
        body: 'Approved',
        requestId: 'request-1',
      }),
    ).rejects.toMatchObject({ code: 'REVIEW_DECISION_NOT_REQUESTED' });
    expect(clientQuery).toHaveBeenLastCalledWith('rollback');
  });

  it('rejects a requested reviewer who cannot resolve reviews', async () => {
    const viewerId = '019fbcf9-e020-71da-935a-6a6a728b3795';
    const clientQuery = vi.fn(async (statement: string) => {
      if (statement.includes('from records')) return { rowCount: 1, rows: [{}] };
      if (statement.includes("m.role<>'viewer'")) return { rowCount: 0, rows: [] };
      return { rowCount: null, rows: [] };
    });
    const client = { query: clientQuery, release: vi.fn() };
    const pool = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{}] }),
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const repository = await RecordReviewRepository.open(pool, actor, 'workspace-1', 'project-1');

    await expect(
      repository.createThread({
        objectTypeId: 'object-1',
        recordId: 'record-1',
        subject: 'Release review',
        body: 'Please decide.',
        reviewerId: viewerId,
        requestId: 'request-1',
      }),
    ).rejects.toMatchObject({ code: 'REVIEW_REVIEWER_INELIGIBLE', status: 400 });
    expect(clientQuery).toHaveBeenLastCalledWith('rollback');
  });
});
