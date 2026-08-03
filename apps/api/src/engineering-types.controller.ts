import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { resolveProjectIdentifier, ScopedEngineeringRepository } from '@engrove/database';
import { UNIT_REGISTRY, REGISTRY_DIGEST } from '@engrove/units';
import type { Request } from 'express';
import { z } from 'zod';
import { appRuntime, requestId, requireActor } from './community.controller.js';

const id = z.string().uuid();
const decimal = z.string().regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/);
const limits = z.object({
  targetValue: decimal.nullable().optional(),
  lowerLimit: decimal.nullable().optional(),
  upperLimit: decimal.nullable().optional(),
  warningLowerLimit: decimal.nullable().optional(),
  warningUpperLimit: decimal.nullable().optional(),
});
async function repository(
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
  const actor = await requireActor(request, action, csrf);
  return ScopedEngineeringRepository.open(
    appRuntime().pool,
    actor,
    id.parse(workspaceId),
    await resolveProjectIdentifier(appRuntime().pool, projectId),
  );
}

@Controller('api/v1')
export class EngineeringTypesController {
  @Get('units') units() {
    return { digest: REGISTRY_DIGEST, ...UNIT_REGISTRY };
  }

  @Post('workspaces/:workspaceId/projects/:projectId/measurement-results')
  async createMeasurement(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const body = z
      .object({
        recordId: id,
        fieldId: id,
        value: decimal,
        unit: z.string().min(1).max(40),
        precision: z.number().int().min(0).max(34).optional(),
        uncertaintyValue: decimal.optional(),
        uncertaintyUnit: z.string().min(1).max(40).optional(),
        measuredAt: z.string().datetime({ offset: true }),
        equipmentRecordId: id.optional(),
        datasetId: id.optional(),
        supersedesResultId: id.optional(),
        correctionReason: z.string().trim().min(1).max(2000).optional(),
      })
      .refine((value) => Boolean(value.supersedesResultId) === Boolean(value.correctionReason), {
        message: 'A correction requires both supersedesResultId and correctionReason.',
      })
      .parse(raw);
    return (
      await repository(
        request,
        workspaceId,
        projectId,
        body.supersedesResultId ? 'measurement.correct' : 'measurement.create',
        true,
      )
    ).createMeasurement({ ...body, requestId: requestId(request) });
  }

  @Get('workspaces/:workspaceId/projects/:projectId/records/:recordId/measurement-results')
  async measurements(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('recordId') recordId: string,
    @Query('fieldId') fieldId?: string,
  ) {
    return {
      items: await (
        await repository(request, workspaceId, projectId, 'measurement.read')
      ).listMeasurements(id.parse(recordId), fieldId ? id.parse(fieldId) : undefined),
    };
  }

  @Get('workspaces/:workspaceId/projects/:projectId/specifications')
  async specifications(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return {
      items: await (
        await repository(request, workspaceId, projectId, 'specification.read')
      ).listSpecifications(includeArchived === 'true'),
    };
  }

  @Post('workspaces/:workspaceId/projects/:projectId/specifications')
  async createSpecification(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const body = z
      .object({
        name: z.string().trim().min(1).max(160),
        measurementFieldId: id,
        limits,
        changeNote: z.string().trim().min(1).max(2000),
      })
      .parse(raw);
    return (
      await repository(request, workspaceId, projectId, 'specification.manage', true)
    ).createSpecification({ ...body, requestId: requestId(request) });
  }

  @Post('workspaces/:workspaceId/projects/:projectId/specifications/:specificationId/revisions')
  async reviseSpecification(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('specificationId') specificationId: string,
    @Body() raw: unknown,
  ) {
    const body = z.object({ limits, changeNote: z.string().trim().min(1).max(2000) }).parse(raw);
    return (
      await repository(request, workspaceId, projectId, 'specification.manage', true)
    ).reviseSpecification(id.parse(specificationId), { ...body, requestId: requestId(request) });
  }

  @Patch('workspaces/:workspaceId/projects/:projectId/specifications/:specificationId/archive')
  async archive(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('specificationId') specificationId: string,
    @Body() raw: unknown,
  ) {
    const body = z.object({ reason: z.string().trim().min(1).max(2000) }).parse(raw);
    return (
      await repository(request, workspaceId, projectId, 'specification.manage', true)
    ).setSpecificationArchived(id.parse(specificationId), true, body.reason, requestId(request));
  }

  @Post('workspaces/:workspaceId/projects/:projectId/specifications/:specificationId/restore')
  async restore(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('specificationId') specificationId: string,
  ) {
    return (
      await repository(request, workspaceId, projectId, 'specification.manage', true)
    ).setSpecificationArchived(id.parse(specificationId), false, '', requestId(request));
  }

  @Get('workspaces/:workspaceId/projects/:projectId/specification-evaluations')
  async evaluations(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('recordId') recordId?: string,
  ) {
    return {
      items: await (
        await repository(request, workspaceId, projectId, 'specification.read')
      ).listEvaluations(recordId ? id.parse(recordId) : undefined),
    };
  }

  @Post('workspaces/:workspaceId/projects/:projectId/specification-evaluations/retry')
  async retryEvaluation(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const body = z
      .object({ specificationRevisionId: id, recordId: id, measurementResultId: id.optional() })
      .parse(raw);
    return (
      await repository(request, workspaceId, projectId, 'specification.manage', true)
    ).retryEvaluation({ ...body, requestId: requestId(request) });
  }
}
