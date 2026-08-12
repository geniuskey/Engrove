import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  RecordReviewRepository,
  resolveObjectTypeIdentifier,
  resolveProjectIdentifier,
  resolveWorkspaceIdentifier,
} from '@engrove/database';
import type { Request } from 'express';
import { z } from 'zod';
import { requestId, requireActor } from './community.controller.js';
import { ApiZodBody, openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const uuid = z.string().uuid();
const message = z.string().trim().min(1).max(10_000);
const mentionedUserIds = z
  .array(uuid)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length);
const createReviewInput = z
  .object({
    subject: z.string().trim().min(1).max(240),
    body: message,
    reviewerId: uuid.nullable().optional(),
    mentionedUserIds: mentionedUserIds.optional(),
  })
  .strict();
const replyInput = z
  .object({ body: message, mentionedUserIds: mentionedUserIds.optional() })
  .strict();
const decisionInput = z
  .object({ decision: z.enum(['approved', 'changes_requested']), body: message })
  .strict();
const inboxListInput = z.object({
  includeResolved: z.enum(['true', 'false']).default('false'),
  query: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(200),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const participantPageInput = z
  .object({
    query: z.string().trim().max(200).default(''),
    reviewerOnly: z.enum(['true', 'false']).default('false'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
const participantResponse = z.object({
  id: uuid,
  displayName: z.string(),
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'engineer', 'contributor', 'reviewer', 'viewer']),
});
const participantPageResponse = z.object({
  items: z.array(participantResponse).max(100),
  pageInfo: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    hasNext: z.boolean(),
  }),
  overallTotal: z.number().int().nonnegative(),
});
const reviewStatus = z.enum(['discussion', 'requested', 'approved', 'changes_requested']);
const reviewPageInfoResponse = z.object({
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  hasNext: z.boolean(),
});
const threadPageInput = z
  .object({
    includeResolved: z.enum(['true', 'false']).default('true'),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
const messagePageInput = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
const reviewMessageResponse = z.object({
  id: uuid,
  body: z.string(),
  authorId: uuid,
  authorName: z.string(),
  mentionedUserIds: z.array(uuid).max(50),
  mentionedUsers: z.array(z.object({ id: uuid, displayName: z.string() })).max(50),
  createdAt: z.iso.datetime(),
});
const reviewThreadResponse = z.object({
  id: uuid,
  subject: z.string(),
  status: z.enum(['open', 'resolved']),
  reviewStatus,
  reviewerId: uuid.nullable(),
  reviewerName: z.string().nullable(),
  createdBy: uuid,
  creatorName: z.string(),
  resolvedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  messages: z.array(reviewMessageResponse).max(20),
  messagePageInfo: reviewPageInfoResponse,
});
const reviewThreadPageResponse = z.object({
  items: z.array(reviewThreadResponse).max(50),
  pageInfo: reviewPageInfoResponse,
  summary: z.object({
    open: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
  }),
});
const reviewMessagePageResponse = z.object({
  items: z.array(reviewMessageResponse).max(100),
  pageInfo: reviewPageInfoResponse,
});
const inboxItemResponse = z.object({
  id: uuid,
  subject: z.string(),
  status: z.enum(['open', 'resolved']),
  reviewStatus,
  reviewerId: uuid.nullable(),
  reviewerName: z.string().nullable(),
  recordId: uuid,
  recordName: z.string(),
  objectTypeId: uuid,
  objectTypePublicId: z.string(),
  objectTypeName: z.string(),
  latestMessage: z.string(),
  messageCount: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
});
const inboxResponse = z.object({
  items: z.array(inboxItemResponse).max(200),
  pageInfo: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    hasNext: z.boolean(),
  }),
  summary: z.object({
    waitingForMe: z.number().int().nonnegative(),
    openInvolved: z.number().int().nonnegative(),
  }),
});

@ApiTags('Record reviews')
@Controller('api/v1/workspaces/:workspaceId/projects/:projectId')
export class RecordReviewsController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  private async repository(
    request: Request,
    workspaceId: string,
    projectId: string,
    action: 'review.read' | 'review.create' | 'review.resolve',
    csrf = false,
  ) {
    const actor = await requireActor(this.runtime, request, action, csrf);
    return RecordReviewRepository.open(
      this.runtime.pool,
      actor,
      await resolveWorkspaceIdentifier(this.runtime.pool, workspaceId),
      await resolveProjectIdentifier(this.runtime.pool, projectId),
    );
  }

  @ApiOkResponse({
    description:
      'A bounded, searchable directory of active organization members available to review workflows.',
    schema: openApiSchema(participantPageResponse),
  })
  @ApiQuery({ name: 'query', required: false, type: String, maxLength: 200 })
  @ApiQuery({
    name: 'reviewerOnly',
    required: false,
    type: Boolean,
    description: 'Exclude members who cannot resolve a requested review.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0, maximum: 1_000_000 })
  @Get('review-participants')
  async participants(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query() raw: unknown,
  ) {
    const input = participantPageInput.parse(raw);
    return (
      await this.repository(request, workspaceId, projectId, 'review.read')
    ).listParticipantPage({
      query: input.query,
      reviewerOnly: input.reviewerOnly === 'true',
      limit: input.limit,
      offset: input.offset,
    });
  }

  @ApiQuery({ name: 'includeResolved', required: false, type: Boolean })
  @ApiQuery({
    name: 'query',
    required: false,
    type: String,
    description: 'Literal search across review, record, table, reviewer, and latest message.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–200).' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Zero-based offset.' })
  @ApiOkResponse({ schema: openApiSchema(inboxResponse) })
  @Get('reviews/inbox')
  async inbox(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('includeResolved') includeResolved?: string,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const input = inboxListInput.parse({ includeResolved, query, limit, offset });
    return (await this.repository(request, workspaceId, projectId, 'review.read')).listInboxPage({
      includeResolved: input.includeResolved === 'true',
      ...(input.query ? { query: input.query } : {}),
      limit: input.limit,
      offset: input.offset,
    });
  }

  @ApiOkResponse({
    description: 'A bounded page of record review threads with their newest messages.',
    schema: openApiSchema(reviewThreadPageResponse),
  })
  @ApiQuery({ name: 'includeResolved', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 50 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0, maximum: 1_000_000 })
  @Get('object-types/:objectTypeId/records/:recordId/reviews')
  async reviews(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('recordId') recordId: string,
    @Query() raw: unknown,
  ) {
    const input = threadPageInput.parse(raw);
    return (await this.repository(request, workspaceId, projectId, 'review.read')).listThreadPage(
      await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      uuid.parse(recordId),
      {
        includeResolved: input.includeResolved === 'true',
        limit: input.limit,
        offset: input.offset,
      },
    );
  }

  @ApiOkResponse({
    description: 'A bounded chronological page of messages, paged from newest to oldest.',
    schema: openApiSchema(reviewMessagePageResponse),
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0, maximum: 1_000_000 })
  @Get('reviews/:threadId/messages')
  async messages(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('threadId') threadId: string,
    @Query() raw: unknown,
  ) {
    const input = messagePageInput.parse(raw);
    return (await this.repository(request, workspaceId, projectId, 'review.read')).listMessagePage(
      uuid.parse(threadId),
      input,
    );
  }

  @ApiZodBody(createReviewInput, 'Open a record-scoped review discussion or request.', {
    subject: 'Confirm pressure limit evidence',
    body: 'Please verify the linked test report before release.',
    reviewerId: '018f6f4d-7f3a-7f34-8bcb-5df2634e9674',
    mentionedUserIds: [],
  })
  @ApiCreatedResponse({ schema: openApiSchema(reviewThreadResponse) })
  @Post('object-types/:objectTypeId/records/:recordId/reviews')
  async createReview(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('recordId') recordId: string,
    @Body() unparsed: unknown,
  ) {
    const body = createReviewInput.parse(unparsed);
    return (
      await this.repository(request, workspaceId, projectId, 'review.create', true)
    ).createThread({
      objectTypeId: await resolveObjectTypeIdentifier(this.runtime.pool, objectTypeId),
      recordId: uuid.parse(recordId),
      subject: body.subject,
      body: body.body,
      ...(body.reviewerId !== undefined ? { reviewerId: body.reviewerId } : {}),
      ...(body.mentionedUserIds !== undefined ? { mentionedUserIds: body.mentionedUserIds } : {}),
      requestId: requestId(request),
    });
  }

  @ApiZodBody(replyInput, 'Add a message and optional participant mentions.', {
    body: 'The Rev D report now contains the missing pressure trace.',
    mentionedUserIds: [],
  })
  @ApiCreatedResponse({ schema: openApiSchema(reviewThreadResponse) })
  @Post('reviews/:threadId/replies')
  async reply(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('threadId') threadId: string,
    @Body() unparsed: unknown,
  ) {
    const body = replyInput.parse(unparsed);
    return (await this.repository(request, workspaceId, projectId, 'review.create', true)).reply({
      threadId: uuid.parse(threadId),
      body: body.body,
      ...(body.mentionedUserIds !== undefined ? { mentionedUserIds: body.mentionedUserIds } : {}),
      requestId: requestId(request),
    });
  }

  @ApiZodBody(decisionInput, 'Record the assigned reviewer decision and its rationale.', {
    decision: 'approved',
    body: 'The qualification evidence satisfies the release criteria.',
  })
  @ApiCreatedResponse({ schema: openApiSchema(reviewThreadResponse) })
  @Post('reviews/:threadId/decision')
  async decide(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('threadId') threadId: string,
    @Body() unparsed: unknown,
  ) {
    const body = decisionInput.parse(unparsed);
    return (await this.repository(request, workspaceId, projectId, 'review.resolve', true)).decide({
      threadId: uuid.parse(threadId),
      decision: body.decision,
      body: body.body,
      requestId: requestId(request),
    });
  }

  @ApiOkResponse({ schema: openApiSchema(reviewThreadResponse) })
  @Patch('reviews/:threadId/resolve')
  async resolve(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('threadId') threadId: string,
  ) {
    return (await this.repository(request, workspaceId, projectId, 'review.resolve', true)).resolve(
      uuid.parse(threadId),
      requestId(request),
    );
  }
}
