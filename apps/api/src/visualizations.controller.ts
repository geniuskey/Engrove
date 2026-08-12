import {
  RepositoryError,
  resolveProjectIdentifier,
  resolveWorkspaceIdentifier,
  ScopedVisualizationRepository,
  type ChartSourceInput,
  type DashboardCardInput,
} from '@engrove/database';
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { requestId, requireActor } from './community.controller.js';
import { ApiZodBody, openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

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
const dashboardMetricsResponse = z.object({
  total_samples: z.number().int().nonnegative(),
  dataset_count: z.number().int().nonnegative(),
  chart_count: z.number().int().nonnegative(),
  dashboard_count: z.number().int().nonnegative(),
  object_type_count: z.number().int().nonnegative(),
  failed_evaluations: z.number().int().nonnegative(),
  pass_rate: z.string().nullable(),
  active_task_count: z.number().int().nonnegative(),
  completed_task_count: z.number().int().nonnegative(),
  blocked_task_count: z.number().int().nonnegative(),
  overdue_tasks: z.number().int().nonnegative(),
  recent_datasets: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        dataset_type: z.string(),
        status: z.string(),
        row_count: z.number().int().nonnegative(),
        created_at: z.string(),
      }),
    )
    .max(5),
});
const visualizationListQuery = z
  .object({
    query: z.string().trim().max(120).default(''),
    archiveState: z.enum(['active', 'all', 'archived']).optional(),
    includeArchived: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
const visualizationPageInfo = z.object({
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  hasNext: z.boolean(),
});
const visualizationListResponse = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        description: z.string(),
        archived_at: z.string().nullable(),
      }),
    )
    .max(100),
  pageInfo: visualizationPageInfo,
});
const visualizationLifecycleResponse = z.object({
  id,
  name: z.string(),
  description: z.string(),
  archived_at: z.string().nullable(),
});
const visualizationArchiveInput = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .refine(
        (value) => !/(?:javascript:|<script|=>|\bfunction\s*\(|\b(?:eval|exec)\s*\()/i.test(value),
        'Executable text is forbidden.',
      ),
  })
  .strict();
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

const chartRequestInput = z.discriminatedUnion('chartType', [
  z
    .object({
      name: safeText,
      description: z.string().trim().max(2_000).default(''),
      chartType: z.literal('line'),
      configVersion: z.literal(1),
      config: cartesianConfig,
      sources: z.array(source).min(1).max(8),
      changeNote: safeText,
    })
    .strict(),
  z
    .object({
      name: safeText,
      description: z.string().trim().max(2_000).default(''),
      chartType: z.literal('scatter'),
      configVersion: z.literal(1),
      config: cartesianConfig,
      sources: z.array(source).min(1).max(8),
      changeNote: safeText,
    })
    .strict(),
  z
    .object({
      name: safeText,
      description: z.string().trim().max(2_000).default(''),
      chartType: z.literal('histogram'),
      configVersion: z.literal(1),
      config: histogramConfig,
      sources: z.array(source).min(1).max(8),
      changeNote: safeText,
    })
    .strict(),
  z
    .object({
      name: safeText,
      description: z.string().trim().max(2_000).default(''),
      chartType: z.literal('box_plot'),
      configVersion: z.literal(1),
      config: boxPlotConfig,
      sources: z.array(source).min(1).max(8),
      changeNote: safeText,
    })
    .strict(),
]);

function chartInput(raw: unknown) {
  const envelope = chartRequestInput.parse(raw);
  verifyFilterBounds(envelope.config.filter);
  return envelope as typeof envelope & { config: Record<string, unknown> };
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
  const parsed = dashboardRequestInput.parse(raw);
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

const dashboardRequestInput = z
  .object({
    name: safeText,
    description: z.string().trim().max(2_000).default(''),
    changeNote: safeText,
    cards: z.array(card).max(40),
  })
  .strict();

const storedChartSourceResponse = z
  .object({
    id,
    source_key: key,
    dataset_id: id,
    source_role: z.string(),
    series_order: z.number().int().nonnegative(),
  })
  .loose();
const chartRevisionResponse = z
  .object({
    id,
    chart_id: id,
    revision_number: z.number().int().positive(),
    config_version: z.literal(1),
    chart_type: z.enum(['line', 'scatter', 'histogram', 'box_plot']),
    config: z.record(z.string(), z.unknown()),
    change_note: z.string(),
    created_at: z.iso.datetime(),
  })
  .loose();
const chartDetailResponse = z
  .object({
    id,
    name: z.string(),
    description: z.string(),
    current_revision_id: id,
    archived_at: z.iso.datetime().nullable(),
    revision_number: z.number().int().positive(),
    config_version: z.literal(1),
    chart_type: z.enum(['line', 'scatter', 'histogram', 'box_plot']),
    config: z.record(z.string(), z.unknown()),
    change_note: z.string(),
    sources: z.array(storedChartSourceResponse).max(8),
    revisions: z.array(chartRevisionResponse),
  })
  .loose();
const chartRevisionDetailResponse = chartRevisionResponse
  .extend({
    chart_name: z.string(),
    chart_description: z.string(),
    sources: z.array(storedChartSourceResponse).max(8),
  })
  .loose();
const dashboardCardResponse = z
  .object({
    id,
    card_type: z.enum([
      'chart',
      'kpi',
      'specification_status',
      'recent_dataset',
      'overdue_task',
      'record_kpi',
      'record_chart',
      'record_list',
    ]),
    chart_revision_id: id.nullable(),
    config_version: z.union([z.literal(1), z.literal(2)]),
    config: z.record(z.string(), z.unknown()),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    position: z.number().int().nonnegative(),
  })
  .loose();
const dashboardRevisionResponse = z
  .object({
    id,
    dashboard_id: id,
    revision_number: z.number().int().positive(),
    layout_version: z.number().int().positive(),
    change_note: z.string(),
    created_at: z.iso.datetime(),
  })
  .loose();
const dashboardDetailResponse = z
  .object({
    id,
    name: z.string(),
    description: z.string(),
    current_revision_id: id,
    archived_at: z.iso.datetime().nullable(),
    revision_number: z.number().int().positive(),
    layout_version: z.number().int().positive(),
    change_note: z.string(),
    cards: z.array(dashboardCardResponse).max(40),
    revisions: z.array(dashboardRevisionResponse),
  })
  .loose();

async function repository(
  runtime: Runtime,
  request: Request,
  workspaceId: string,
  projectId: string,
  mutation = false,
) {
  const actor = await requireActor(
    runtime,
    request,
    mutation ? 'dashboard.manage' : 'dataset.read',
    mutation,
  );
  return ScopedVisualizationRepository.open(
    runtime.pool,
    actor,
    await resolveWorkspaceIdentifier(runtime.pool, workspaceId),
    await resolveProjectIdentifier(runtime.pool, projectId),
  );
}

@ApiTags('Visualizations')
@Controller('api/v1/workspaces/:workspaceId/projects/:projectId')
export class VisualizationsController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiQuery({ name: 'query', required: false, type: String, maxLength: 120 })
  @ApiQuery({ name: 'archiveState', required: false, enum: ['active', 'all', 'archived'] })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean, deprecated: true })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiOkResponse({ schema: openApiSchema(visualizationListResponse) })
  @Get('charts')
  async charts(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query() raw: unknown,
  ) {
    const input = visualizationListQuery.parse(raw);
    return (await repository(this.runtime, request, workspaceId, projectId)).listChartPage({
      archiveState: input.archiveState ?? (input.includeArchived === 'true' ? 'all' : 'active'),
      query: input.query,
      limit: input.limit,
      offset: input.offset,
    });
  }
  @ApiOkResponse({ schema: openApiSchema(chartDetailResponse) })
  @Get('charts/:chartId')
  async chart(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('chartId') chartId: string,
  ) {
    return (await repository(this.runtime, request, workspaceId, projectId)).getChart(
      id.parse(chartId),
    );
  }
  @ApiOkResponse({ schema: openApiSchema(chartRevisionDetailResponse) })
  @Get('chart-revisions/:revisionId')
  async chartRevision(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('revisionId') revisionId: string,
  ) {
    return (await repository(this.runtime, request, workspaceId, projectId)).getChartRevision(
      id.parse(revisionId),
    );
  }
  @ApiZodBody(chartRequestInput, 'Create a versioned chart pinned to ready datasets.', {
    name: 'Temperature distribution',
    description: 'Qualification chamber readings',
    chartType: 'histogram',
    configVersion: 1,
    config: {
      title: 'Temperature distribution',
      legend: false,
      axes: {
        x: { label: 'Temperature', dimension: 'temperature', displayUnit: 'degC' },
        y: { label: 'Frequency' },
      },
      missingData: 'indicate',
      sourceKey: 'qualification',
      columnId: 'temperature',
      binStrategy: 'auto',
    },
    sources: [
      {
        sourceKey: 'qualification',
        datasetId: '550e8400-e29b-41d4-a716-446655440000',
        sourceRole: 'values',
        seriesOrder: 0,
      },
    ],
    changeNote: 'Initial qualification chart',
  })
  @ApiCreatedResponse({ schema: openApiSchema(chartDetailResponse) })
  @Post('charts')
  async createChart(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    const input = chartInput(raw);
    return (await repository(this.runtime, request, workspaceId, projectId, true)).createChart({
      ...input,
      sources: input.sources as ChartSourceInput[],
      requestId: requestId(request),
    });
  }
  @ApiZodBody(chartRequestInput, 'Publish a new immutable chart revision.', {
    name: 'Temperature distribution',
    description: 'Qualification chamber readings after recalibration',
    chartType: 'histogram',
    configVersion: 1,
    config: {
      title: 'Temperature distribution',
      legend: false,
      axes: { x: { label: 'Temperature', displayUnit: 'degC' }, y: { label: 'Frequency' } },
      missingData: 'indicate',
      sourceKey: 'qualification',
      columnId: 'temperature',
      binStrategy: 'fixed',
      binCount: 20,
    },
    sources: [
      {
        sourceKey: 'qualification',
        datasetId: '550e8400-e29b-41d4-a716-446655440000',
        sourceRole: 'values',
        seriesOrder: 0,
      },
    ],
    changeNote: 'Use fixed bins after sensor recalibration',
  })
  @ApiCreatedResponse({ schema: openApiSchema(chartDetailResponse) })
  @Post('charts/:chartId/revisions')
  async reviseChart(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('chartId') chartId: string,
    @Body() raw: unknown,
  ) {
    const input = chartInput(raw);
    return (await repository(this.runtime, request, workspaceId, projectId, true)).reviseChart(
      id.parse(chartId),
      { ...input, sources: input.sources as ChartSourceInput[], requestId: requestId(request) },
    );
  }
  @ApiZodBody(visualizationArchiveInput, 'Archive a chart while retaining every revision.', {
    reason: 'Superseded visualization',
  })
  @ApiOkResponse({ schema: openApiSchema(visualizationLifecycleResponse) })
  @Patch('charts/:chartId/archive')
  async archiveChart(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('chartId') chartId: string,
    @Body() raw: unknown,
  ) {
    const body = visualizationArchiveInput.parse(raw);
    return (await repository(this.runtime, request, workspaceId, projectId, true)).setChartArchived(
      id.parse(chartId),
      true,
      body.reason,
      requestId(request),
    );
  }
  @ApiOkResponse({ schema: openApiSchema(visualizationLifecycleResponse) })
  @Post('charts/:chartId/restore')
  async restoreChart(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('chartId') chartId: string,
  ) {
    return (await repository(this.runtime, request, workspaceId, projectId, true)).setChartArchived(
      id.parse(chartId),
      false,
      '',
      requestId(request),
    );
  }
  @ApiQuery({ name: 'query', required: false, type: String, maxLength: 120 })
  @ApiQuery({ name: 'archiveState', required: false, enum: ['active', 'all', 'archived'] })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean, deprecated: true })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiOkResponse({ schema: openApiSchema(visualizationListResponse) })
  @Get('dashboards')
  async dashboards(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query() raw: unknown,
  ) {
    const input = visualizationListQuery.parse(raw);
    return (await repository(this.runtime, request, workspaceId, projectId)).listDashboardPage({
      archiveState: input.archiveState ?? (input.includeArchived === 'true' ? 'all' : 'active'),
      query: input.query,
      limit: input.limit,
      offset: input.offset,
    });
  }
  @ApiOkResponse({ schema: openApiSchema(dashboardMetricsResponse) })
  @Get('dashboard-metrics')
  async metrics(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
  ) {
    return (await repository(this.runtime, request, workspaceId, projectId)).dashboardMetrics();
  }
  @ApiOkResponse({ schema: openApiSchema(dashboardDetailResponse) })
  @Get('dashboards/:dashboardId')
  async dashboard(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('dashboardId') dashboardId: string,
  ) {
    return (await repository(this.runtime, request, workspaceId, projectId)).getDashboard(
      id.parse(dashboardId),
    );
  }
  @ApiZodBody(dashboardRequestInput, 'Create a versioned project dashboard.', {
    name: 'Release readiness',
    description: 'A compact view of qualification progress',
    changeNote: 'Initial release dashboard',
    cards: [
      {
        cardType: 'kpi',
        configVersion: 1,
        config: { title: 'Ready datasets', metric: 'dataset_count' },
        x: 0,
        y: 0,
        width: 4,
        height: 3,
        position: 0,
      },
    ],
  })
  @ApiCreatedResponse({ schema: openApiSchema(dashboardDetailResponse) })
  @Post('dashboards')
  async createDashboard(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
  ) {
    return (await repository(this.runtime, request, workspaceId, projectId, true)).createDashboard({
      ...dashboardInput(raw),
      requestId: requestId(request),
    });
  }
  @ApiZodBody(dashboardRequestInput, 'Publish a new immutable dashboard revision.', {
    name: 'Release readiness',
    description: 'Qualification progress and overdue work',
    changeNote: 'Add overdue work indicator',
    cards: [
      {
        cardType: 'overdue_task',
        configVersion: 1,
        config: { title: 'Overdue work' },
        x: 0,
        y: 0,
        width: 4,
        height: 3,
        position: 0,
      },
    ],
  })
  @ApiCreatedResponse({ schema: openApiSchema(dashboardDetailResponse) })
  @Post('dashboards/:dashboardId/revisions')
  async reviseDashboard(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('dashboardId') dashboardId: string,
    @Body() raw: unknown,
  ) {
    return (await repository(this.runtime, request, workspaceId, projectId, true)).reviseDashboard(
      id.parse(dashboardId),
      { ...dashboardInput(raw), requestId: requestId(request) },
    );
  }
  @ApiZodBody(
    visualizationArchiveInput,
    'Archive a dashboard while retaining cards and published revisions.',
    { reason: 'Superseded dashboard' },
  )
  @ApiOkResponse({ schema: openApiSchema(visualizationLifecycleResponse) })
  @Patch('dashboards/:dashboardId/archive')
  async archiveDashboard(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('dashboardId') dashboardId: string,
    @Body() raw: unknown,
  ) {
    const body = visualizationArchiveInput.parse(raw);
    return (
      await repository(this.runtime, request, workspaceId, projectId, true)
    ).setDashboardArchived(id.parse(dashboardId), true, body.reason, requestId(request));
  }
  @ApiOkResponse({ schema: openApiSchema(visualizationLifecycleResponse) })
  @Post('dashboards/:dashboardId/restore')
  async restoreDashboard(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('dashboardId') dashboardId: string,
  ) {
    return (
      await repository(this.runtime, request, workspaceId, projectId, true)
    ).setDashboardArchived(id.parse(dashboardId), false, '', requestId(request));
  }
}
