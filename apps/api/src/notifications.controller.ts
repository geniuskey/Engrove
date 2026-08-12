import {
  getNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationPreferences,
} from '@engrove/database';
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { requestId, requireActor } from './community.controller.js';
import { ApiZodBody, openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const notificationType = z.enum([
  'task.assigned',
  'task.updated',
  'task.status_changed',
  'task.commented',
  'task.mentioned',
  'task.archived',
  'task.restored',
  'task.due_soon',
  'task.overdue',
  'record.mentioned',
]);
const notificationListInput = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const notificationListResponse = z.object({
  items: z
    .array(
      z.object({
        id: z.uuid(),
        type: notificationType,
        actorName: z.string(),
        workspaceId: z.string(),
        projectId: z.string(),
        taskId: z.uuid().nullable(),
        taskKey: z.string().nullable(),
        taskTitle: z.string().nullable(),
        objectTypeId: z.string().nullable(),
        recordId: z.uuid().nullable(),
        recordTitle: z.string().nullable(),
        payload: z.record(z.string(), z.unknown()),
        readAt: z.string().nullable(),
        createdAt: z.string(),
      }),
    )
    .max(100),
  unreadCount: z.number().int().nonnegative(),
  pageInfo: z.object({
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    hasNext: z.boolean(),
  }),
});
const notificationPreferences = z
  .object({
    autoWatchCreated: z.boolean(),
    autoWatchCommented: z.boolean(),
    notifyAssigned: z.boolean(),
    notifyMentioned: z.boolean(),
    notifyTaskActivity: z.boolean(),
    notifyDueDates: z.boolean(),
    dueReminderDays: z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(7)]),
  })
  .strict();
const markAllReadResponse = z.object({ updated: z.number().int().nonnegative() }).strict();
const markReadResponse = z.object({ read: z.literal(true) }).strict();

@ApiTags('Notifications')
@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiOkResponse({ schema: openApiSchema(notificationPreferences) })
  @Get('preferences')
  async preferences(@Req() request: Request) {
    const actor = await requireActor(this.runtime, request, 'notification.read');
    return getNotificationPreferences(this.runtime.pool, actor);
  }

  @ApiZodBody(notificationPreferences, 'Replace the authenticated member notification policy.', {
    autoWatchCreated: true,
    autoWatchCommented: true,
    notifyAssigned: true,
    notifyMentioned: true,
    notifyTaskActivity: false,
    notifyDueDates: true,
    dueReminderDays: 3,
  })
  @ApiOkResponse({ schema: openApiSchema(notificationPreferences) })
  @Patch('preferences')
  async updatePreferences(@Req() request: Request, @Body() raw: unknown) {
    const actor = await requireActor(this.runtime, request, 'notification.read', true);
    const input = notificationPreferences.parse(raw);
    return updateNotificationPreferences(this.runtime.pool, actor, {
      ...input,
      requestId: requestId(request),
    });
  }

  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiOkResponse({ schema: openApiSchema(notificationListResponse) })
  @Get()
  async list(
    @Req() request: Request,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('limit') rawLimit?: string,
    @Query('offset') rawOffset?: string,
  ) {
    const actor = await requireActor(this.runtime, request, 'notification.read');
    return listNotifications(
      this.runtime.pool,
      actor,
      notificationListInput.parse({ unreadOnly, limit: rawLimit, offset: rawOffset }),
    );
  }

  @ApiOkResponse({ schema: openApiSchema(markAllReadResponse) })
  @Post('read-all')
  async readAll(@Req() request: Request) {
    const actor = await requireActor(this.runtime, request, 'notification.read', true);
    return { updated: await markAllNotificationsRead(this.runtime.pool, actor) };
  }

  @ApiOkResponse({ schema: openApiSchema(markReadResponse) })
  @Post(':notificationId/read')
  async read(@Req() request: Request, @Param('notificationId') notificationId: string) {
    const actor = await requireActor(this.runtime, request, 'notification.read', true);
    await markNotificationRead(this.runtime.pool, actor, z.string().uuid().parse(notificationId));
    return { read: true };
  }
}
