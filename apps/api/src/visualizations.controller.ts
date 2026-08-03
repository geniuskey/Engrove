import {
  RepositoryError,
  resolveProjectIdentifier,
  resolveWorkspaceIdentifier,
  ScopedVisualizationRepository,
  type ChartSourceInput,
  type DashboardCardInput,
} from '@engrove/database';
import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { appRuntime, requestId, requireActor } from './community.controller.js';

const id = z.string().uuid();
const safeText = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine(
    (value) => !/(?:javascript:|<script|=>|\bfunction\s*\(|\b(?:eval|exec)\s*\()/i.test(value),
    'Executable text is forbidden.',
  );
const key = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
const literal = z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]);
type FilterNode = {
  type: string;
  sourceKey?: string;
  columnId?: string;
  children?: FilterNode[];
};
const filterNode: z.ZodType<FilterNode> = z.lazy(() =>
  z.union([
    z
      .object({
        type: z.literal('comparison'),
        sourceKey: key,
        columnId: safeText.max(80),
        operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']),
        value: literal,
      })
      .strict(),
    z
      .object({
        type: z.literal('membership'),
        sourceKey: key,
        columnId: safeText.max(80),
        values: z.array(literal).min(1).max(50),
      })
      .strict(),
    z.object({ type: z.literal('null'), sourceKey: key, columnId: safeText.max(80) }).strict(),
    z
      .object({
        type: z.literal('range'),
        sourceKey: key,
        columnId: safeText.max(80),
        lower: literal.optional(),
        upper: literal.optional(),
      })
      .strict(),
    z
      .object({
        type: z.enum(['and', 'or']),
        children: z.array(filterNode).min(1).max(10),
      })
      .strict(),
  ]),
);

function verifyFilterBounds(node: FilterNode | null | undefined, depth = 1): number {
  if (!node) return 0;
  if (depth > 5)
    throw new RepositoryError('CHART_FILTER_TOO_DEEP', 400, 'Filter depth cannot exceed five.');
  const count =
    1 + (node.children ?? []).reduce((sum, child) => sum + verifyFilterBounds(child, depth + 1), 0);
  if (count > 50)
    throw new RepositoryError('CHART_FILTER_TOO_LARGE', 400, 'Filter cannot exceed 50 nodes.');
  return count;
}

const axis = z
  .object({
    label: safeText,
    dimension: key.optional(),
    displayUnit: z.string().trim().min(1).max(30).optional(),
    scale: z.enum(['linear', 'log']).default('linear'),
  })
  .strict();
const common = {
  title: safeText,
  legend: z.boolean().default(true),
  axes: z.object({ x: axis, y: axis }).strict(),
  filter: filterNode.nullable().optional(),
  missingData: z.enum(['gap', 'skip', 'zero', 'indicate']).default('indicate'),
};
const series = z
  .object({
    sourceKey: key,
    name: safeText,
    xColumnId: safeText.max(80),
    yColumnId: safeText.max(80),
  })
  .strict();
const cartesianConfig = z.object({ ...common, series: z.array(series).min(1).max(8) }).strict();
const histogramConfig = z
  .object({
    ...common,
    sourceKey: key,
    columnId: safeText.max(80),
    binStrategy: z.enum(['auto', 'fixed']),
    binCount: z.number().int().min(2).max(200).optional(),
    fixedRange: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.binStrategy === 'fixed' && value.binCount === undefined)
      context.addIssue({
        code: 'custom',
        path: ['binCount'],
        message: 'A fixed histogram requires a bin count.',
      });
    if (value.fixedRange && value.fixedRange[0] >= value.fixedRange[1])
      context.addIssue({
        code: 'custom',
        path: ['fixedRange'],
        message: 'Histogram range must increase.',
      });
  });
const boxPlotConfig = z
  .object({
    ...common,
    sourceKey: key,
    valueColumnId: safeText.max(80),
    groupColumnId: safeText.max(80).optional(),
  })
  .strict();
const source = z
  .object({
    sourceKey: key,
    datasetId: id,
    sourceRole: z.enum(['series', 'values']),
    seriesOrder: z.number().int().min(0).max(100),
  })
  .strict();

function chartInput(raw: unknown) {
  const envelope = z
    .object({
      name: safeText,
      description: z.string().trim().max(2_000).default(''),
      chartType: z.enum(['line', 'scatter', 'histogram', 'box_plot']),
      configVersion: z.number().int(),
      config: z.unknown(),
      sources: z.array(source).min(1).max(8),
      changeNote: safeText,
    })
    .strict()
    .parse(raw);
  if (envelope.configVersion !== 1)
    throw new RepositoryError(
      'CHART_CONFIG_VERSION_UNSUPPORTED',
      400,
      'Only chart config version 1 is supported.',
    );
  const schema =
    envelope.chartType === 'line' || envelope.chartType === 'scatter'
      ? cartesianConfig
      : envelope.chartType === 'histogram'
        ? histogramConfig
        : boxPlotConfig;
  const config = schema.parse(envelope.config);
  verifyFilterBounds(config.filter);
  return { ...envelope, config } as typeof envelope & { config: Record<string, unknown> };
}

const cardBase = {
  chartRevisionId: id.optional(),
  configVersion: z.literal(1),
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(1_000),
  width: z.number().int().min(1).max(12),
  height: z.number().int().min(1).max(12),
  position: z.number().int().min(0).max(100),
};
const recordFilter = z
  .object({
    fieldId: id,
    operator: z.enum(['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'in', 'is_null']),
    value: z.unknown().optional(),
  })
  .strict();
const recordSort = z
  .object({
    fieldId: id.optional(),
    systemField: z.enum(['displayName', 'createdAt', 'updatedAt']).optional(),
    direction: z.enum(['asc', 'desc']),
  })
  .strict()
  .refine((sort) => Number(Boolean(sort.fieldId)) + Number(Boolean(sort.systemField)) === 1);
const recordSource = z
  .object({
    objectTypeId: id,
    tableName: safeText,
    viewId: id.optional(),
    viewName: safeText.optional(),
    filters: z.array(recordFilter).max(20),
    sorts: z.array(recordSort).max(5),
  })
  .strict();
const recordColumn = z.object({ fieldId: id, key, label: safeText }).strict();
const card = z.discriminatedUnion('cardType', [
  z
    .object({
      ...cardBase,
      cardType: z.literal('chart'),
      chartRevisionId: id,
      config: z.object({ title: safeText }).strict(),
    })
    .strict(),
  z
    .object({
      ...cardBase,
      cardType: z.literal('kpi'),
      config: z
        .object({
          title: safeText,
          metric: z.enum(['total_samples', 'pass_rate', 'dataset_count']),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...cardBase,
      cardType: z.literal('specification_status'),
      config: z.object({ title: safeText }).strict(),
    })
    .strict(),
  z
    .object({
      ...cardBase,
      cardType: z.literal('recent_dataset'),
      config: z.object({ title: safeText }).strict(),
    })
    .strict(),
  z
    .object({
      ...cardBase,
      cardType: z.literal('overdue_task'),
      config: z.object({ title: safeText }).strict(),
    })
    .strict(),
  z
    .object({
      ...cardBase,
      cardType: z.literal('record_kpi'),
      configVersion: z.literal(2),
      config: z
        .object({ title: safeText, source: recordSource, metric: z.literal('count') })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...cardBase,
      cardType: z.literal('record_chart'),
      configVersion: z.literal(2),
      config: z
        .object({
          title: safeText,
          source: recordSource,
          groupByFieldId: id,
          groupByLabel: safeText,
          groupLabels: z
            .record(z.string().max(200), safeText)
            .refine((labels) => Object.keys(labels).length <= 100),
          chartType: z.enum(['bar', 'donut']),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...cardBase,
      cardType: z.literal('record_list'),
      configVersion: z.literal(2),
      config: z
        .object({
          title: safeText,
          source: recordSource,
          columns: z.array(recordColumn).max(6),
          limit: z.number().int().min(1).max(20),
        })
        .strict(),
    })
    .strict(),
]);

function dashboardInput(raw: unknown) {
  const parsed = z
    .object({
      name: safeText,
      description: z.string().trim().max(2_000).default(''),
      changeNote: safeText,
      cards: z.array(card).max(40),
    })
    .strict()
    .parse(raw);
  for (const candidate of parsed.cards)
    if (candidate.x + candidate.width > 12)
      throw new RepositoryError('DASHBOARD_LAYOUT_INVALID', 400, 'A card exceeds the grid.');
  for (let left = 0; left < parsed.cards.length; left++)
    for (let right = left + 1; right < parsed.cards.length; right++) {
      const a = parsed.cards[left]!;
      const b = parsed.cards[right]!;
      if (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
      )
        throw new RepositoryError(
          'DASHBOARD_LAYOUT_OVERLAP',
          400,
          'Dashboard cards cannot overlap.',
        );
    }
  return parsed as typeof parsed & { cards: DashboardCardInput[] };
}

async function repository(
  request: Request,
  workspaceId: string,
  projectId: string,
  mutation = false,
) {
  const actor = await requireActor(
    request,
    mutation ? 'dashboard.manage' : 'dataset.read',
    mutation,
  );
  return ScopedVisualizationRepository.open(
    appRuntime().pool,
    actor,
    await resolveWorkspaceIdentifier(appRuntime().pool, workspaceId),
    await resolveProjectIdentifier(appRuntime().pool, projectId),
  );
}

@Controller('api/v1/workspaces/:workspaceId/projects/:projectId')
export class VisualizationsController {
  @Get('charts') async charts(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return {
      items: await (
        await repository(request, workspaceId, projectId)
      ).listCharts(includeArchived === 'true'),
    };
  }
  @Get('charts/:chartId') async chart(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('chartId') chartId: string,
  ) {
    return (await repository(request, workspaceId, projectId)).getChart(id.parse(chartId));
  }
  @Get('chart-revisions/:revisionId') async chartRevision(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('revisionId') revisionId: string,
  ) {
    return (await repository(request, workspaceId, projectId)).getChartRevision(
      id.parse(revisionId),
    );
  }
  @Post('charts') async createChart(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const input = chartInput(raw);
    return (await repository(request, workspaceId, projectId, true)).createChart({
      ...input,
      sources: input.sources as ChartSourceInput[],
      requestId: requestId(request),
    });
  }
  @Post('charts/:chartId/revisions') async reviseChart(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('chartId') chartId: string,
    @Body() raw: unknown,
  ) {
    const input = chartInput(raw);
    return (await repository(request, workspaceId, projectId, true)).reviseChart(
      id.parse(chartId),
      { ...input, sources: input.sources as ChartSourceInput[], requestId: requestId(request) },
    );
  }
  @Patch('charts/:chartId/archive') async archiveChart(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('chartId') chartId: string,
    @Body() raw: unknown,
  ) {
    const body = z
      .object({ reason: safeText.max(2_000) })
      .strict()
      .parse(raw);
    return (await repository(request, workspaceId, projectId, true)).setChartArchived(
      id.parse(chartId),
      true,
      body.reason,
      requestId(request),
    );
  }
  @Post('charts/:chartId/restore') async restoreChart(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('chartId') chartId: string,
  ) {
    return (await repository(request, workspaceId, projectId, true)).setChartArchived(
      id.parse(chartId),
      false,
      '',
      requestId(request),
    );
  }
  @Get('dashboards') async dashboards(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return {
      items: await (
        await repository(request, workspaceId, projectId)
      ).listDashboards(includeArchived === 'true'),
    };
  }
  @Get('dashboard-metrics') async metrics(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
  ) {
    return (await repository(request, workspaceId, projectId)).dashboardMetrics();
  }
  @Get('dashboards/:dashboardId') async dashboard(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('dashboardId') dashboardId: string,
  ) {
    return (await repository(request, workspaceId, projectId)).getDashboard(id.parse(dashboardId));
  }
  @Post('dashboards') async createDashboard(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    return (await repository(request, workspaceId, projectId, true)).createDashboard({
      ...dashboardInput(raw),
      requestId: requestId(request),
    });
  }
  @Post('dashboards/:dashboardId/revisions') async reviseDashboard(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('dashboardId') dashboardId: string,
    @Body() raw: unknown,
  ) {
    return (await repository(request, workspaceId, projectId, true)).reviseDashboard(
      id.parse(dashboardId),
      { ...dashboardInput(raw), requestId: requestId(request) },
    );
  }
  @Patch('dashboards/:dashboardId/archive') async archiveDashboard(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('dashboardId') dashboardId: string,
    @Body() raw: unknown,
  ) {
    const body = z
      .object({ reason: safeText.max(2_000) })
      .strict()
      .parse(raw);
    return (await repository(request, workspaceId, projectId, true)).setDashboardArchived(
      id.parse(dashboardId),
      true,
      body.reason,
      requestId(request),
    );
  }
  @Post('dashboards/:dashboardId/restore') async restoreDashboard(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('dashboardId') dashboardId: string,
  ) {
    return (await repository(request, workspaceId, projectId, true)).setDashboardArchived(
      id.parse(dashboardId),
      false,
      '',
      requestId(request),
    );
  }
}
