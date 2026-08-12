import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  resolveProjectIdentifier,
  resolveWorkspaceIdentifier,
  ScopedEngineeringRepository,
} from '@engrove/database';
import { UNIT_REGISTRY, REGISTRY_DIGEST } from '@engrove/units';
import type { Request } from 'express';
import { z } from 'zod';
import { requestId, requireActor } from './community.controller.js';
import { ApiZodBody, openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const id = z.string().uuid();
const decimal = z.string().regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/);
const limits = z
  .object({
    targetValue: decimal.nullable().optional(),
    lowerLimit: decimal.nullable().optional(),
    upperLimit: decimal.nullable().optional(),
    warningLowerLimit: decimal.nullable().optional(),
    warningUpperLimit: decimal.nullable().optional(),
  })
  .strict();
const pageInfoResponse = z.object({
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  hasNext: z.boolean(),
});
const evaluationStatus = z.enum(['pass', 'warning', 'fail', 'missing']);
const evaluationResponse = z
  .object({
    id,
    measurement_field_id: id,
    measurement_result_id: id.nullable(),
    status: evaluationStatus,
    reason_code: z.string(),
    evaluated_at: z.string(),
  })
  .loose();
const measurementResponse = z
  .object({
    id,
    record_id: id,
    field_id: id,
    canonical_value: z.string(),
    canonical_unit: z.string(),
    original_value: z.string(),
    original_unit: z.string(),
    measured_at: z.string(),
    supersedes_result_id: id.nullable(),
    current: z.boolean(),
    evaluation: evaluationResponse.nullable(),
  })
  .loose();
const createdMeasurementResponse = measurementResponse.omit({ current: true });
const specificationResponse = z
  .object({
    id,
    name: z.string(),
    measurement_field_id: id,
    status: z.enum(['active', 'archived']),
    revisions: z.array(z.record(z.string(), z.unknown())),
  })
  .loose();
const specificationLifecycleResponse = specificationResponse.omit({ revisions: true });
const unitRegistryResponse = z.object({
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.string(),
  exponentRange: z.tuple([z.number().int(), z.number().int()]),
  dimensions: z.record(z.string(), z.object({ canonicalUnit: z.string() })),
  units: z.array(
    z.object({
      id: z.string(),
      dimension: z.string(),
      symbol: z.string(),
      name: z.string(),
      scaleNumerator: z.string(),
      scaleDenominator: z.string(),
      offsetNumerator: z.string(),
      offsetDenominator: z.string(),
      prefixable: z.boolean().optional(),
      aliases: z.array(z.string()),
    }),
  ),
});
const measurementCreateInput = z
  .object({
    recordId: id,
    fieldId: id,
    value: decimal,
    unit: z.string().min(1).max(40),
    precision: z.number().int().min(0).max(34).optional(),
    uncertaintyValue: decimal.optional(),
    uncertaintyUnit: z.string().min(1).max(40).optional(),
    measuredAt: z.iso.datetime({ offset: true }),
    equipmentRecordId: id.optional(),
    datasetId: id.optional(),
    supersedesResultId: id.optional(),
    correctionReason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.supersedesResultId) === Boolean(value.correctionReason), {
    message: 'A correction requires both supersedesResultId and correctionReason.',
  });
const specificationCreateInput = z
  .object({
    name: z.string().trim().min(1).max(160),
    measurementFieldId: id,
    limits,
    changeNote: z.string().trim().min(1).max(2000),
  })
  .strict();
const specificationRevisionInput = z
  .object({ limits, changeNote: z.string().trim().min(1).max(2000) })
  .strict();
const archiveInput = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();
const evaluationRetryInput = z
  .object({ specificationRevisionId: id, recordId: id, measurementResultId: id.optional() })
  .strict();
const measurementListInput = z.object({
  fieldId: id.optional(),
  currentState: z.enum(['all', 'current', 'superseded']).default('all'),
  query: z.string().trim().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const specificationListInput = z
  .object({
    includeArchived: z.enum(['true', 'false']).optional(),
    archiveState: z.enum(['active', 'archived', 'all']).optional(),
    query: z.string().trim().max(120).default(''),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .transform(({ includeArchived, archiveState, ...input }) => ({
    ...input,
    archiveState: archiveState ?? (includeArchived === 'true' ? ('all' as const) : 'active'),
  }));
const evaluationListInput = z.object({
  recordId: id.optional(),
  status: z.union([z.literal('all'), evaluationStatus]).default('all'),
  query: z.string().trim().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
async function repository(
  runtime: Runtime,
  request: Request,
  workspaceId: string,
  projectId: string,
  action:
    | 'measurement.create'
    | 'measurement.correct'
    | 'measurement.read'
    | 'specification.read'
    | 'specification.manage',
  csrf = false,
) {
  const actor = await requireActor(runtime, request, action, csrf);
  return ScopedEngineeringRepository.open(
    runtime.pool,
    actor,
    await resolveWorkspaceIdentifier(runtime.pool, workspaceId),
    await resolveProjectIdentifier(runtime.pool, projectId),
  );
}

@ApiTags('EngineeringTypes')
@Controller('api/v1')
export class EngineeringTypesController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiOkResponse({ schema: openApiSchema(unitRegistryResponse) })
  @Get('units')
  units() {
    return { digest: REGISTRY_DIGEST, ...UNIT_REGISTRY };
  }

  @ApiCreatedResponse({ schema: openApiSchema(createdMeasurementResponse) })
  @ApiZodBody(measurementCreateInput, 'Record an append-only scalar measurement or correction.', {
    recordId: '019fbcf9-e020-71da-935a-6a6a728b3790',
    fieldId: '019fbcf9-e020-71da-935a-6a6a728b3791',
    value: '12.45',
    unit: 'N',
    precision: 2,
    measuredAt: '2026-08-11T16:00:00.000Z',
  })
  @Post('workspaces/:workspaceId/projects/:projectId/measurement-results')
  async createMeasurement(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const body = measurementCreateInput.parse(raw);
    return (
      await repository(
        this.runtime,
        request,
        workspaceId,
        projectId,
        body.supersedesResultId ? 'measurement.correct' : 'measurement.create',
        true,
      )
    ).createMeasurement({ ...body, requestId: requestId(request) });
  }

  @ApiOkResponse({
    description: 'A bounded measurement history page with each result’s latest evaluation.',
    schema: openApiSchema(
      z.object({ items: z.array(measurementResponse).max(100), pageInfo: pageInfoResponse }),
    ),
  })
  @ApiQuery({ name: 'fieldId', required: false, type: String, format: 'uuid' })
  @ApiQuery({
    name: 'currentState',
    required: false,
    enum: ['all', 'current', 'superseded'],
  })
  @ApiQuery({ name: 'query', required: false, type: String, maxLength: 120 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @Get('workspaces/:workspaceId/projects/:projectId/records/:recordId/measurement-results')
  async measurements(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('recordId') recordId: string,
    @Query() raw: unknown,
  ) {
    const input = measurementListInput.parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'measurement.read')
    ).listMeasurementPage({ recordId: id.parse(recordId), ...input });
  }

  @ApiOkResponse({
    description: 'A bounded, searchable specification catalog with revision histories.',
    schema: openApiSchema(
      z.object({ items: z.array(specificationResponse).max(100), pageInfo: pageInfoResponse }),
    ),
  })
  @ApiQuery({
    name: 'includeArchived',
    required: false,
    type: Boolean,
    deprecated: true,
    description: 'Legacy alias. Use archiveState=all instead.',
  })
  @ApiQuery({ name: 'archiveState', required: false, enum: ['active', 'archived', 'all'] })
  @ApiQuery({ name: 'query', required: false, type: String, maxLength: 120 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @Get('workspaces/:workspaceId/projects/:projectId/specifications')
  async specifications(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query() raw: unknown,
  ) {
    const input = specificationListInput.parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'specification.read')
    ).listSpecificationPage(input);
  }

  @ApiCreatedResponse({ schema: openApiSchema(specificationResponse) })
  @ApiZodBody(specificationCreateInput, 'Create the first immutable specification revision.', {
    name: 'Peak force acceptance',
    measurementFieldId: '019fbcf9-e020-71da-935a-6a6a728b3791',
    limits: { lowerLimit: '11.5', upperLimit: '13.5' },
    changeNote: 'Initial qualification limits',
  })
  @Post('workspaces/:workspaceId/projects/:projectId/specifications')
  async createSpecification(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const body = specificationCreateInput.parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'specification.manage', true)
    ).createSpecification({ ...body, requestId: requestId(request) });
  }

  @ApiCreatedResponse({ schema: openApiSchema(specificationResponse) })
  @ApiZodBody(specificationRevisionInput, 'Create a new immutable specification revision.', {
    limits: { lowerLimit: '11.8', upperLimit: '13.2' },
    changeNote: 'Tightened after gauge R&R review',
  })
  @Post('workspaces/:workspaceId/projects/:projectId/specifications/:specificationId/revisions')
  async reviseSpecification(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('specificationId') specificationId: string,
    @Body() raw: unknown,
  ) {
    const body = specificationRevisionInput.parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'specification.manage', true)
    ).reviseSpecification(id.parse(specificationId), { ...body, requestId: requestId(request) });
  }

  @ApiOkResponse({ schema: openApiSchema(specificationLifecycleResponse) })
  @ApiZodBody(archiveInput, 'Archive a specification without deleting its evaluation history.', {
    reason: 'Superseded by the released qualification plan',
  })
  @Patch('workspaces/:workspaceId/projects/:projectId/specifications/:specificationId/archive')
  async archive(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('specificationId') specificationId: string,
    @Body() raw: unknown,
  ) {
    const body = archiveInput.parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'specification.manage', true)
    ).setSpecificationArchived(id.parse(specificationId), true, body.reason, requestId(request));
  }

  @ApiCreatedResponse({ schema: openApiSchema(specificationLifecycleResponse) })
  @Post('workspaces/:workspaceId/projects/:projectId/specifications/:specificationId/restore')
  async restore(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('specificationId') specificationId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'specification.manage', true)
    ).setSpecificationArchived(id.parse(specificationId), false, '', requestId(request));
  }

  @ApiOkResponse({
    description: 'A bounded, searchable specification evaluation page.',
    schema: openApiSchema(
      z.object({ items: z.array(evaluationResponse).max(100), pageInfo: pageInfoResponse }),
    ),
  })
  @ApiQuery({ name: 'recordId', required: false, type: String, format: 'uuid' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['all', 'pass', 'warning', 'fail', 'missing'],
  })
  @ApiQuery({ name: 'query', required: false, type: String, maxLength: 120 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @Get('workspaces/:workspaceId/projects/:projectId/specification-evaluations')
  async evaluations(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query() raw: unknown,
  ) {
    const input = evaluationListInput.parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'specification.read')
    ).listEvaluationPage(input);
  }

  @ApiCreatedResponse({ schema: openApiSchema(evaluationResponse) })
  @ApiZodBody(evaluationRetryInput, 'Re-evaluate an exact record and specification revision.', {
    specificationRevisionId: '019fbcf9-e020-71da-935a-6a6a728b3792',
    recordId: '019fbcf9-e020-71da-935a-6a6a728b3790',
    measurementResultId: '019fbcf9-e020-71da-935a-6a6a728b3793',
  })
  @Post('workspaces/:workspaceId/projects/:projectId/specification-evaluations/retry')
  async retryEvaluation(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const body = evaluationRetryInput.parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, 'specification.manage', true)
    ).retryEvaluation({ ...body, requestId: requestId(request) });
  }
}
