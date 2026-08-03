import { Body, Controller, Get, Headers, Param, Patch, Post, Req, Res } from '@nestjs/common';
import {
  configurableFieldTypes,
  resolveObjectTypeIdentifier,
  resolveProjectIdentifier,
  ScopedProjectRepository,
  type JsonValue,
  type RecordQuery,
  type RecordViewConfig,
  type RecordViewType,
} from '@engrove/database';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { appRuntime, requestId, requireActor } from './community.controller.js';

const id = z.string().uuid();
const key = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{1,63}$/);
const jsonObject = z.record(z.string(), z.unknown());
const relationMap = z.record(z.string().uuid(), z.array(z.string().uuid()).max(100));
const fieldType = z.enum(configurableFieldTypes);
const recordViewType = z.enum(['grid', 'form', 'gallery', 'kanban', 'calendar']);
const recordFilter = z.object({
  fieldId: id,
  operator: z.enum(['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'in', 'is_null']),
  value: z.unknown().optional(),
});
const recordSort = z
  .object({
    fieldId: id.optional(),
    systemField: z.enum(['displayName', 'createdAt', 'updatedAt']).optional(),
    direction: z.enum(['asc', 'desc']),
  })
  .refine((sort) => Number(Boolean(sort.fieldId)) + Number(Boolean(sort.systemField)) === 1);
const recordViewConfig = z
  .object({
    visibleFieldIds: z
      .array(id)
      .max(200)
      .refine((ids) => new Set(ids).size === ids.length),
    fieldWidths: z
      .record(id, z.number().int().min(80).max(800))
      .refine((widths) => Object.keys(widths).length <= 200),
    systemFieldWidths: z
      .record(
        z.enum(['displayName', 'contextProject', 'updatedAt']),
        z.number().int().min(80).max(800),
      )
      .optional(),
    filters: z.array(recordFilter).max(20),
    sorts: z.array(recordSort).max(5),
    rowDensity: z.enum(['compact', 'comfortable']),
    pageSize: z.union([
      z.literal(25),
      z.literal(50),
      z.literal(100),
      z.literal(250),
      z.literal(500),
    ]),
    viewOptions: z
      .object({
        groupFieldId: id.optional(),
        dateFieldId: id.optional(),
        contextProjectId: id.nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

async function repository(
  request: Request,
  workspaceId: string,
  projectId: string,
  action:
    | 'schema.read'
    | 'schema.manage'
    | 'record.read'
    | 'record.create'
    | 'record.update'
    | 'record.archive'
    | 'record.restore'
    | 'export.execute',
  csrf = false,
): Promise<ScopedProjectRepository> {
  const actor = await requireActor(request, action, csrf);
  return ScopedProjectRepository.open(
    appRuntime().pool,
    actor,
    id.parse(workspaceId),
    await resolveProjectIdentifier(appRuntime().pool, projectId),
  );
}

@Controller('api/v1/workspaces/:workspaceId/projects/:projectId')
export class ConfigurableDataController {
  @Get('object-types')
  async objectTypes(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
  ) {
    return {
      items: await (
        await repository(request, workspaceId, projectId, 'schema.read')
      ).listObjectTypes(),
    };
  }

  @Post('object-types')
  async createObjectType(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() unparsed: unknown,
  ) {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        pluralName: z.string().trim().min(1).max(120),
        key,
        icon: z.string().trim().min(1).max(64).optional(),
        description: z.string().max(2000).optional(),
      })
      .parse(unparsed);
    return (
      await repository(request, workspaceId, projectId, 'schema.manage', true)
    ).createObjectType({
      name: body.name,
      pluralName: body.pluralName,
      key: body.key,
      icon: body.icon ?? 'table',
      description: body.description ?? '',
      requestId: requestId(request),
    });
  }

  @Get('object-types/:objectTypeId/fields')
  async fields(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
  ) {
    return {
      items: await (
        await repository(request, workspaceId, projectId, 'schema.read')
      ).listFields(await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId)),
    };
  }

  @Post('object-types/:objectTypeId/fields')
  async createField(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        key,
        description: z.string().max(2000).optional(),
        fieldType,
        required: z.boolean().optional(),
        unique: z.boolean().optional(),
        position: z.number().int().min(0).max(10_000).optional(),
        config: jsonObject.optional(),
        defaultValue: z.unknown().optional(),
      })
      .parse(unparsed);
    return (await repository(request, workspaceId, projectId, 'schema.manage', true)).createField({
      objectTypeId: await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId),
      name: body.name,
      key: body.key,
      description: body.description ?? '',
      fieldType: body.fieldType,
      required: body.required ?? false,
      unique: body.unique ?? false,
      position: body.position ?? 0,
      config: (body.config ?? {}) as Record<string, JsonValue>,
      ...(body.defaultValue === undefined ? {} : { defaultValue: body.defaultValue as JsonValue }),
      requestId: requestId(request),
    });
  }

  @Patch('object-types/:objectTypeId/fields-order')
  async reorderFields(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = z
      .object({ fieldIds: z.array(id).min(1).max(1_000) })
      .strict()
      .parse(unparsed);
    return {
      items: await (
        await repository(request, workspaceId, projectId, 'schema.manage', true)
      ).reorderFields({
        objectTypeId: await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId),
        fieldIds: body.fieldIds,
        requestId: requestId(request),
      }),
    };
  }

  @Patch('object-types/:objectTypeId/fields/:fieldId')
  async updateField(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('fieldId') fieldId: string,
    @Body() unparsed: unknown,
  ) {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().max(2000),
        required: z.boolean(),
        unique: z.boolean(),
        position: z.number().int().min(0).max(10_000),
        config: jsonObject,
      })
      .parse(unparsed);
    return (await repository(request, workspaceId, projectId, 'schema.manage', true)).updateField({
      objectTypeId: await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId),
      fieldId: id.parse(fieldId),
      ...body,
      config: body.config as Record<string, JsonValue>,
      requestId: requestId(request),
    });
  }

  @Post('templates/test-characterization/install')
  async installTemplate(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
  ) {
    return (
      await repository(request, workspaceId, projectId, 'schema.manage', true)
    ).installTestCharacterizationTemplate(requestId(request));
  }

  @Get('object-types/:objectTypeId/views')
  async views(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
  ) {
    return {
      items: await (
        await repository(request, workspaceId, projectId, 'schema.read')
      ).listRecordViews(await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId)),
    };
  }

  @Post('object-types/:objectTypeId/views')
  async createView(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        viewType: recordViewType.default('grid'),
        config: recordViewConfig,
      })
      .parse(unparsed);
    return (
      await repository(request, workspaceId, projectId, 'schema.manage', true)
    ).createRecordView({
      objectTypeId: await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId),
      name: body.name,
      viewType: body.viewType as RecordViewType,
      config: body.config as RecordViewConfig,
      requestId: requestId(request),
    });
  }

  @Patch('object-types/:objectTypeId/views/:viewId')
  async updateView(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('viewId') viewId: string,
    @Body() unparsed: unknown,
  ) {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        viewType: recordViewType,
        config: recordViewConfig,
        rowVersion: z.number().int().positive(),
      })
      .parse(unparsed);
    return (
      await repository(request, workspaceId, projectId, 'schema.manage', true)
    ).updateRecordView({
      objectTypeId: await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId),
      viewId: id.parse(viewId),
      name: body.name,
      viewType: body.viewType as RecordViewType,
      config: body.config as RecordViewConfig,
      rowVersion: body.rowVersion,
      requestId: requestId(request),
    });
  }

  @Post('object-types/:objectTypeId/views/:viewId/archive')
  async archiveView(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('viewId') viewId: string,
    @Body() unparsed: unknown,
  ) {
    const body = z
      .object({
        rowVersion: z.number().int().positive(),
        reason: z.string().trim().min(1).max(500),
      })
      .parse(unparsed);
    return (
      await repository(request, workspaceId, projectId, 'schema.manage', true)
    ).setRecordViewArchived({
      objectTypeId: await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId),
      viewId: id.parse(viewId),
      archived: true,
      rowVersion: body.rowVersion,
      reason: body.reason,
      requestId: requestId(request),
    });
  }

  @Post('object-types/:objectTypeId/records/query')
  async queryRecords(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = z
      .object({
        filters: z.array(recordFilter).max(20).optional(),
        sorts: z.array(recordSort).max(5).optional(),
        search: z.string().trim().max(200).optional(),
        contextProjectId: id.nullable().optional(),
        groupByFieldId: id.optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(500).optional(),
        includeArchived: z.boolean().optional(),
      })
      .parse(unparsed);
    return (await repository(request, workspaceId, projectId, 'record.read')).queryRecords(
      await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId),
      body as RecordQuery,
    );
  }

  @Get('object-types/:objectTypeId/records/:recordId')
  async record(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('recordId') recordId: string,
  ) {
    return (await repository(request, workspaceId, projectId, 'record.read')).getRecord(
      await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId),
      id.parse(recordId),
    );
  }

  @Get('object-types/:objectTypeId/records/:recordId/history')
  async recordHistory(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('recordId') recordId: string,
  ) {
    return {
      items: await (
        await repository(request, workspaceId, projectId, 'record.read')
      ).listRecordHistory(
        await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId),
        id.parse(recordId),
      ),
    };
  }

  @Post('object-types/:objectTypeId/records/:recordId/history/:eventId/undo')
  async undoRecordChange(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('recordId') recordId: string,
    @Param('eventId') eventId: string,
    @Body() unparsed: unknown,
  ) {
    const body = z.object({ rowVersion: z.number().int().positive() }).parse(unparsed);
    return (
      await repository(request, workspaceId, projectId, 'record.update', true)
    ).undoRecordChange({
      objectTypeId: await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId),
      recordId: id.parse(recordId),
      eventId: id.parse(eventId),
      rowVersion: body.rowVersion,
      requestId: requestId(request),
    });
  }

  @Post('object-types/:objectTypeId/records')
  async createRecord(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Body() unparsed: unknown,
  ) {
    const body = z
      .object({
        displayName: z.string().trim().min(1).max(240),
        contextProjectId: id.nullable().optional(),
        values: jsonObject,
        relations: relationMap.optional(),
        fileReferences: relationMap.optional(),
        datasetReferences: relationMap.optional(),
      })
      .parse(unparsed);
    return (await repository(request, workspaceId, projectId, 'record.create', true)).createRecord({
      objectTypeId: await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId),
      ...(body.contextProjectId !== undefined ? { contextProjectId: body.contextProjectId } : {}),
      displayName: body.displayName,
      values: body.values as Record<string, JsonValue>,
      relations: body.relations ?? {},
      fileReferences: body.fileReferences ?? {},
      datasetReferences: body.datasetReferences ?? {},
      requestId: requestId(request),
    });
  }

  @Patch('object-types/:objectTypeId/records/:recordId')
  async updateRecord(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('recordId') recordId: string,
    @Body() unparsed: unknown,
  ) {
    const body = z
      .object({
        displayName: z.string().trim().min(1).max(240),
        contextProjectId: id.nullable().optional(),
        values: jsonObject,
        relations: relationMap.optional(),
        fileReferences: relationMap.optional(),
        datasetReferences: relationMap.optional(),
        rowVersion: z.number().int().positive(),
      })
      .parse(unparsed);
    return (await repository(request, workspaceId, projectId, 'record.update', true)).updateRecord({
      objectTypeId: await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId),
      recordId: id.parse(recordId),
      ...(body.contextProjectId !== undefined ? { contextProjectId: body.contextProjectId } : {}),
      displayName: body.displayName,
      values: body.values as Record<string, JsonValue>,
      relations: body.relations ?? {},
      fileReferences: body.fileReferences ?? {},
      datasetReferences: body.datasetReferences ?? {},
      rowVersion: body.rowVersion,
      requestId: requestId(request),
    });
  }

  @Post('object-types/:objectTypeId/records/:recordId/archive')
  async archiveRecord(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('recordId') recordId: string,
    @Body() unparsed: unknown,
  ) {
    const body = z.object({ reason: z.string().trim().min(1).max(500) }).parse(unparsed);
    return (
      await repository(request, workspaceId, projectId, 'record.archive', true)
    ).setRecordArchived({
      objectTypeId: await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId),
      recordId: id.parse(recordId),
      archived: true,
      reason: body.reason,
      requestId: requestId(request),
    });
  }

  @Post('object-types/:objectTypeId/records/:recordId/restore')
  async restoreRecord(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Param('recordId') recordId: string,
  ) {
    return (
      await repository(request, workspaceId, projectId, 'record.restore', true)
    ).setRecordArchived({
      objectTypeId: await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId),
      recordId: id.parse(recordId),
      archived: false,
      requestId: requestId(request),
    });
  }

  @Post('object-types/:objectTypeId/records/import-csv')
  async importCsv(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() unparsed: unknown,
  ) {
    const body = z.object({ csv: z.string().min(1) }).parse(unparsed);
    return (
      await repository(request, workspaceId, projectId, 'record.create', true)
    ).importRecordsCsv({
      objectTypeId: await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId),
      csv: body.csv,
      idempotencyKey: z.string().min(8).max(200).parse(idempotencyKey),
      requestId: requestId(request),
    });
  }

  @Get('object-types/:objectTypeId/export.csv')
  async exportCsv(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('objectTypeId') objectTypeId: string,
  ) {
    const csv = await (
      await repository(request, workspaceId, projectId, 'export.execute')
    ).exportRecordsCsv(
      await resolveObjectTypeIdentifier(appRuntime().pool, objectTypeId),
      requestId(request),
    );
    response
      .type('text/csv')
      .setHeader('content-disposition', 'attachment; filename="engrove-records.csv"');
    return csv;
  }
}
