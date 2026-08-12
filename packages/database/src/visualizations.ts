import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { assertCompatibleUnit, type Dimension } from '@engrove/units';
import { appendAudit, RepositoryError, type ActorSession } from './community.js';

interface Scope {
  actor: ActorSession;
  workspaceId: string;
  projectId: string;
}

export interface ChartSourceInput {
  sourceKey: string;
  datasetId: string;
  sourceRole: string;
  seriesOrder: number;
}

export interface DashboardCardInput {
  cardType:
    | 'chart'
    | 'kpi'
    | 'specification_status'
    | 'recent_dataset'
    | 'overdue_task'
    | 'record_kpi'
    | 'record_chart'
    | 'record_list';
  chartRevisionId?: string | undefined;
  configVersion: 1 | 2;
  config: Record<string, unknown>;
  x: number;
  y: number;
  width: number;
  height: number;
  position: number;
}

async function transaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function referencedSeries(chartType: string, config: Record<string, unknown>) {
  if (chartType === 'line' || chartType === 'scatter')
    return (config.series ?? []) as Array<{
      sourceKey: string;
      xColumnId: string;
      yColumnId: string;
    }>;
  return [
    {
      sourceKey: String(config.sourceKey),
      xColumnId: String(config.columnId ?? config.valueColumnId),
      yColumnId: String(config.columnId ?? config.valueColumnId),
    },
  ];
}

function walkFilters(value: unknown, visit: (sourceKey: string, columnId: string) => void): void {
  if (!value || typeof value !== 'object') return;
  const node = value as Record<string, unknown>;
  if (typeof node.sourceKey === 'string' && typeof node.columnId === 'string')
    visit(node.sourceKey, node.columnId);
  if (Array.isArray(node.children)) for (const child of node.children) walkFilters(child, visit);
}

async function validateChartSources(
  client: PoolClient,
  projectId: string,
  chartType: string,
  config: Record<string, unknown>,
  sources: ChartSourceInput[],
) {
  if (!sources.length)
    throw new RepositoryError('CHART_SOURCE_REQUIRED', 400, 'At least one source is required.');
  const byKey = new Map(sources.map((source) => [source.sourceKey, source]));
  if (byKey.size !== sources.length)
    throw new RepositoryError('CHART_SOURCE_DUPLICATE', 400, 'Source keys must be unique.');
  const schemas = new Map<string, Array<Record<string, unknown>>>();
  for (const source of sources) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(source.sourceKey))
      throw new RepositoryError('CHART_SOURCE_KEY_INVALID', 400, 'A source key is invalid.');
    const dataset = await client.query<{
      dataset_type: string;
      schema: { columns?: Array<Record<string, unknown>> };
    }>(
      "select dataset_type,schema from datasets where project_id=$1 and id=$2 and status='ready'",
      [projectId, source.datasetId],
    );
    if (!dataset.rows[0])
      throw new RepositoryError('DATASET_NOT_READY', 409, 'Every chart source must be ready.');
    if (['line', 'scatter'].includes(chartType) && dataset.rows[0].dataset_type !== 'xy')
      throw new RepositoryError(
        'CHART_SOURCE_TYPE_INVALID',
        400,
        'Line and scatter sources must be XY.',
      );
    schemas.set(source.sourceKey, dataset.rows[0].schema.columns ?? []);
  }
  const series = referencedSeries(chartType, config);
  if (!series.length)
    throw new RepositoryError('CHART_SERIES_REQUIRED', 400, 'At least one series is required.');
  if (series.length > 8)
    throw new RepositoryError('CHART_SERIES_LIMIT', 400, 'At most eight series are allowed.');
  const dimensions: Record<'x' | 'y', Set<string>> = { x: new Set(), y: new Set() };
  for (const item of series) {
    if (!byKey.has(item.sourceKey))
      throw new RepositoryError(
        'CHART_SOURCE_UNKNOWN',
        400,
        'Config references an unknown source key.',
      );
    const columns = schemas.get(item.sourceKey)!;
    for (const [axis, columnId] of [
      ['x', item.xColumnId],
      ['y', item.yColumnId],
    ] as const) {
      const column = columns.find((candidate) => candidate.id === columnId);
      if (!column)
        throw new RepositoryError(
          'CHART_COLUMN_NOT_FOUND',
          400,
          'Config references an unknown column.',
        );
      if (!/(int|float|double|decimal)/i.test(String(column.dataType)))
        throw new RepositoryError(
          'CHART_COLUMN_NOT_NUMERIC',
          400,
          'Chart value columns must be numeric.',
        );
      if (column.dimension) dimensions[axis].add(String(column.dimension));
    }
  }
  for (const axis of ['x', 'y'] as const) {
    if (dimensions[axis].size > 1)
      throw new RepositoryError(
        'CHART_AXIS_DIMENSION_CONFLICT',
        400,
        `Series on the ${axis.toUpperCase()} axis have incompatible dimensions.`,
      );
    const axisConfig = (config.axes as Record<string, Record<string, unknown>> | undefined)?.[axis];
    const dimension = [...dimensions[axis]][0];
    if (axisConfig?.dimension && dimension && axisConfig.dimension !== dimension)
      throw new RepositoryError(
        'CHART_AXIS_DIMENSION_CONFLICT',
        400,
        'Axis dimension is incompatible.',
      );
    if (axisConfig?.displayUnit && (axisConfig.dimension ?? dimension))
      try {
        assertCompatibleUnit(
          String(axisConfig.displayUnit),
          String(axisConfig.dimension ?? dimension) as Dimension,
        );
      } catch {
        throw new RepositoryError(
          'CHART_AXIS_UNIT_INCOMPATIBLE',
          400,
          'Axis display unit is unknown or incompatible.',
        );
      }
  }
  if (chartType === 'box_plot' && config.groupColumnId) {
    const sourceKey = String(config.sourceKey);
    if (!schemas.get(sourceKey)?.some((column) => column.id === config.groupColumnId))
      throw new RepositoryError(
        'CHART_GROUP_COLUMN_NOT_FOUND',
        400,
        'Box plot group column is unknown.',
      );
  }
  walkFilters(config.filter, (sourceKey, columnId) => {
    if (!schemas.get(sourceKey)?.some((column) => column.id === columnId))
      throw new RepositoryError('CHART_FILTER_COLUMN_NOT_FOUND', 400, 'Filter column is unknown.');
  });
}

export class ScopedVisualizationRepository {
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
    return new ScopedVisualizationRepository(pool, { actor, workspaceId, projectId });
  }

  private audit(
    action: string,
    targetType: string,
    targetId: string,
    requestId: string,
    payload = {},
  ) {
    return {
      organizationId: this.scope.actor.organizationId,
      workspaceId: this.scope.workspaceId,
      projectId: this.scope.projectId,
      actorId: this.scope.actor.actorId,
      action,
      targetType,
      targetId,
      requestId,
      payload,
    };
  }

  async listCharts(includeArchived = false) {
    const result = await this.pool.query(
      `select c.*,r.revision_number,r.config_version,r.chart_type,r.config,r.change_note,
       coalesce(json_agg(s order by s.series_order,s.source_key) filter(where s.id is not null),'[]') sources
       from charts c join chart_revisions r on r.id=c.current_revision_id and r.project_id=c.project_id
       left join chart_dataset_sources s on s.chart_revision_id=r.id and s.project_id=r.project_id
       where c.project_id=$1 and ($2::boolean or c.archived_at is null)
       group by c.id,r.id order by c.updated_at desc,c.id`,
      [this.scope.projectId, includeArchived],
    );
    return result.rows;
  }

  async listChartPage(options: {
    archiveState: 'active' | 'all' | 'archived';
    query: string;
    limit: number;
    offset: number;
  }) {
    const parameters = [
      this.scope.projectId,
      options.archiveState,
      options.query.toLocaleLowerCase(),
    ];
    const lifecycle = `($2='all' or ($2='active' and c.archived_at is null)
      or ($2='archived' and c.archived_at is not null))`;
    const search = `($3='' or position($3 in lower(c.name||' '||c.description))>0)`;
    const [count, result] = await Promise.all([
      this.pool.query<{ total: number }>(
        `select count(*)::int total from charts c
         where c.project_id=$1 and ${lifecycle} and ${search}`,
        parameters,
      ),
      this.pool.query(
        `select c.*,r.revision_number,r.config_version,r.chart_type,r.config,r.change_note,
         coalesce(json_agg(s order by s.series_order,s.source_key)
           filter(where s.id is not null),'[]') sources
         from charts c join chart_revisions r
           on r.id=c.current_revision_id and r.project_id=c.project_id
         left join chart_dataset_sources s
           on s.chart_revision_id=r.id and s.project_id=r.project_id
         where c.project_id=$1 and ${lifecycle} and ${search}
         group by c.id,r.id order by c.updated_at desc,c.id limit $4 offset $5`,
        [...parameters, options.limit, options.offset],
      ),
    ]);
    const total = count.rows[0]?.total ?? 0;
    return {
      items: result.rows,
      pageInfo: {
        limit: options.limit,
        offset: options.offset,
        total,
        hasNext: options.offset + result.rows.length < total,
      },
    };
  }

  async getChart(chartId: string) {
    const chart = await this.pool.query(
      `select c.*,r.revision_number,r.config_version,r.chart_type,r.config,r.change_note
       from charts c join chart_revisions r on r.id=c.current_revision_id and r.project_id=c.project_id
       where c.project_id=$1 and c.id=$2`,
      [this.scope.projectId, chartId],
    );
    if (!chart.rows[0]) throw new RepositoryError('CHART_NOT_FOUND', 404, 'Chart was not found.');
    const [sources, revisions] = await Promise.all([
      this.pool.query(
        'select * from chart_dataset_sources where project_id=$1 and chart_revision_id=$2 order by series_order,source_key',
        [this.scope.projectId, chart.rows[0].current_revision_id],
      ),
      this.pool.query(
        'select * from chart_revisions where project_id=$1 and chart_id=$2 order by revision_number desc',
        [this.scope.projectId, chartId],
      ),
    ]);
    return { ...chart.rows[0], sources: sources.rows, revisions: revisions.rows };
  }

  async getChartRevision(revisionId: string) {
    const revision = await this.pool.query(
      `select r.*,c.name chart_name,c.description chart_description from chart_revisions r
       join charts c on c.id=r.chart_id and c.project_id=r.project_id
       where r.project_id=$1 and r.id=$2`,
      [this.scope.projectId, revisionId],
    );
    if (!revision.rows[0])
      throw new RepositoryError('CHART_REVISION_NOT_FOUND', 404, 'Chart revision was not found.');
    const sources = await this.pool.query(
      'select * from chart_dataset_sources where project_id=$1 and chart_revision_id=$2 order by series_order,source_key',
      [this.scope.projectId, revisionId],
    );
    return { ...revision.rows[0], sources: sources.rows };
  }

  async createChart(input: {
    name: string;
    description: string;
    chartType: string;
    configVersion: number;
    config: Record<string, unknown>;
    sources: ChartSourceInput[];
    changeNote: string;
    requestId: string;
  }) {
    const chartId = uuidv7();
    await transaction(this.pool, async (client) => {
      await validateChartSources(
        client,
        this.scope.projectId,
        input.chartType,
        input.config,
        input.sources,
      );
      const revisionId = uuidv7();
      await client.query(
        'insert into charts (id,project_id,name,description,created_by) values ($1,$2,$3,$4,$5)',
        [chartId, this.scope.projectId, input.name, input.description, this.scope.actor.actorId],
      );
      await this.insertChartRevision(client, chartId, revisionId, 1, input);
      await client.query('update charts set current_revision_id=$2 where id=$1', [
        chartId,
        revisionId,
      ]);
      await appendAudit(client, this.audit('chart.created', 'chart', chartId, input.requestId));
    });
    return this.getChart(chartId);
  }

  private async insertChartRevision(
    client: PoolClient,
    chartId: string,
    revisionId: string,
    revisionNumber: number,
    input: {
      chartType: string;
      configVersion: number;
      config: Record<string, unknown>;
      sources: ChartSourceInput[];
      changeNote: string;
    },
  ) {
    await client.query(
      'insert into chart_revisions (id,project_id,chart_id,revision_number,config_version,chart_type,config,change_note,created_by) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)',
      [
        revisionId,
        this.scope.projectId,
        chartId,
        revisionNumber,
        input.configVersion,
        input.chartType,
        JSON.stringify(input.config),
        input.changeNote,
        this.scope.actor.actorId,
      ],
    );
    for (const source of input.sources)
      await client.query(
        'insert into chart_dataset_sources (id,project_id,chart_revision_id,source_key,dataset_id,source_role,series_order) values ($1,$2,$3,$4,$5,$6,$7)',
        [
          uuidv7(),
          this.scope.projectId,
          revisionId,
          source.sourceKey,
          source.datasetId,
          source.sourceRole,
          source.seriesOrder,
        ],
      );
  }

  async reviseChart(
    chartId: string,
    input: {
      name: string;
      description: string;
      chartType: string;
      configVersion: number;
      config: Record<string, unknown>;
      sources: ChartSourceInput[];
      changeNote: string;
      requestId: string;
    },
  ) {
    await transaction(this.pool, async (client) => {
      const current = await client.query<{ revision_number: number }>(
        `select r.revision_number from charts c join chart_revisions r on r.id=c.current_revision_id
         where c.project_id=$1 and c.id=$2 and c.archived_at is null for update of c`,
        [this.scope.projectId, chartId],
      );
      if (!current.rows[0])
        throw new RepositoryError('CHART_NOT_FOUND', 404, 'Chart was not found.');
      await validateChartSources(
        client,
        this.scope.projectId,
        input.chartType,
        input.config,
        input.sources,
      );
      const revisionId = uuidv7();
      await this.insertChartRevision(
        client,
        chartId,
        revisionId,
        current.rows[0].revision_number + 1,
        input,
      );
      await client.query(
        'update charts set name=$3,description=$4,current_revision_id=$5,updated_at=now() where project_id=$1 and id=$2',
        [this.scope.projectId, chartId, input.name, input.description, revisionId],
      );
      await appendAudit(
        client,
        this.audit('chart.revised', 'chart', chartId, input.requestId, { revisionId }),
      );
    });
    return this.getChart(chartId);
  }

  async setChartArchived(chartId: string, archived: boolean, reason: string, requestId: string) {
    return transaction(this.pool, async (client) => {
      const row = await client.query(
        `update charts set archived_at=${archived ? 'now()' : 'null'},archived_by=${archived ? '$3' : 'null'},archive_reason=${archived ? '$4' : 'null'},updated_at=now() where project_id=$1 and id=$2 and archived_at is ${archived ? 'null' : 'not null'} returning *`,
        archived
          ? [this.scope.projectId, chartId, this.scope.actor.actorId, reason]
          : [this.scope.projectId, chartId],
      );
      if (!row.rows[0])
        throw new RepositoryError('CHART_STATE_CONFLICT', 409, 'Chart state conflicts.');
      await appendAudit(
        client,
        this.audit(archived ? 'chart.archived' : 'chart.restored', 'chart', chartId, requestId),
      );
      return row.rows[0];
    });
  }

  async listDashboards(includeArchived = false) {
    const result = await this.pool.query(
      `select d.*,r.revision_number,r.layout_version,r.change_note,
       coalesce(json_agg(c order by c.position) filter(where c.id is not null),'[]') cards
       from dashboards d join dashboard_revisions r on r.id=d.current_revision_id and r.project_id=d.project_id
       left join dashboard_cards c on c.dashboard_revision_id=r.id and c.project_id=r.project_id
       where d.project_id=$1 and ($2::boolean or d.archived_at is null) group by d.id,r.id order by d.updated_at desc,d.id`,
      [this.scope.projectId, includeArchived],
    );
    return result.rows;
  }

  async listDashboardPage(options: {
    archiveState: 'active' | 'all' | 'archived';
    query: string;
    limit: number;
    offset: number;
  }) {
    const parameters = [
      this.scope.projectId,
      options.archiveState,
      options.query.toLocaleLowerCase(),
    ];
    const lifecycle = `($2='all' or ($2='active' and d.archived_at is null)
      or ($2='archived' and d.archived_at is not null))`;
    const search = `($3='' or position($3 in lower(d.name||' '||d.description))>0)`;
    const [count, result] = await Promise.all([
      this.pool.query<{ total: number }>(
        `select count(*)::int total from dashboards d
         where d.project_id=$1 and ${lifecycle} and ${search}`,
        parameters,
      ),
      this.pool.query(
        `select d.*,r.revision_number,r.layout_version,r.change_note,
         coalesce(json_agg(c order by c.position) filter(where c.id is not null),'[]') cards
         from dashboards d join dashboard_revisions r
           on r.id=d.current_revision_id and r.project_id=d.project_id
         left join dashboard_cards c
           on c.dashboard_revision_id=r.id and c.project_id=r.project_id
         where d.project_id=$1 and ${lifecycle} and ${search}
         group by d.id,r.id order by d.updated_at desc,d.id limit $4 offset $5`,
        [...parameters, options.limit, options.offset],
      ),
    ]);
    const total = count.rows[0]?.total ?? 0;
    return {
      items: result.rows,
      pageInfo: {
        limit: options.limit,
        offset: options.offset,
        total,
        hasNext: options.offset + result.rows.length < total,
      },
    };
  }

  async dashboardMetrics() {
    const result = await this.pool.query(
      `select
       (select count(*)::int from records r join object_types o on o.id=r.object_type_id and o.project_id=r.project_id where r.project_id=$1 and o.key='sample' and r.archived_at is null) total_samples,
       (select count(*)::int from datasets where project_id=$1 and status='ready' and archived_at is null) dataset_count,
       (select count(*)::int from charts where project_id=$1 and archived_at is null) chart_count,
       (select count(*)::int from dashboards where project_id=$1 and archived_at is null) dashboard_count,
       (select count(*)::int from object_types where project_id=$1) object_type_count,
       (select count(*)::int from specification_evaluations where project_id=$1 and status='fail') failed_evaluations,
       (select case when count(*)=0 then null else round(100.0*count(*) filter(where status='pass')/count(*),1) end from specification_evaluations where project_id=$1 and status<>'missing') pass_rate,
       (select count(*)::int from tasks t where project_id=$1 and archived_at is null
          and task_visible_to(t.id,$2::uuid,$3::text)) active_task_count,
       (select count(*)::int from tasks t join task_workflow_statuses s
          on s.project_id=t.project_id and s.key=t.status
         where t.project_id=$1 and t.archived_at is null and s.category='done'
           and task_visible_to(t.id,$2::uuid,$3::text)) completed_task_count,
       (select count(*)::int from tasks t join task_workflow_statuses s
          on s.project_id=t.project_id and s.key=t.status
         where t.project_id=$1 and t.archived_at is null and s.key='blocked'
           and task_visible_to(t.id,$2::uuid,$3::text)) blocked_task_count,
       (select count(*)::int from tasks t join task_workflow_statuses s
          on s.project_id=t.project_id and s.key=t.status
         where t.project_id=$1 and t.archived_at is null and s.category<>'done'
           and t.due_date < current_date and task_visible_to(t.id,$2::uuid,$3::text)) overdue_tasks`,
      [this.scope.projectId, this.scope.actor.actorId, this.scope.actor.role],
    );
    const recent = await this.pool.query(
      `select id,name,dataset_type,status,row_count,created_at from datasets
       where project_id=$1 and archived_at is null order by created_at desc,id limit 5`,
      [this.scope.projectId],
    );
    return { ...result.rows[0], recent_datasets: recent.rows };
  }

  async getDashboard(dashboardId: string) {
    const dashboard = await this.pool.query(
      `select d.*,r.revision_number,r.layout_version,r.change_note from dashboards d
       join dashboard_revisions r on r.id=d.current_revision_id and r.project_id=d.project_id
       where d.project_id=$1 and d.id=$2`,
      [this.scope.projectId, dashboardId],
    );
    if (!dashboard.rows[0])
      throw new RepositoryError('DASHBOARD_NOT_FOUND', 404, 'Dashboard was not found.');
    const [cards, revisions] = await Promise.all([
      this.pool.query(
        'select * from dashboard_cards where project_id=$1 and dashboard_revision_id=$2 order by position',
        [this.scope.projectId, dashboard.rows[0].current_revision_id],
      ),
      this.pool.query(
        'select * from dashboard_revisions where project_id=$1 and dashboard_id=$2 order by revision_number desc',
        [this.scope.projectId, dashboardId],
      ),
    ]);
    return { ...dashboard.rows[0], cards: cards.rows, revisions: revisions.rows };
  }

  private async validateCards(client: PoolClient, cards: DashboardCardInput[]) {
    if (cards.length > 40)
      throw new RepositoryError('DASHBOARD_CARD_LIMIT', 400, 'At most 40 cards are allowed.');
    if (new Set(cards.map((card) => card.position)).size !== cards.length)
      throw new RepositoryError(
        'DASHBOARD_POSITION_DUPLICATE',
        400,
        'Card positions must be unique.',
      );
    for (const card of cards) {
      if (card.cardType === 'chart') {
        const found = await client.query(
          'select 1 from chart_revisions where project_id=$1 and id=$2',
          [this.scope.projectId, card.chartRevisionId],
        );
        if (!found.rowCount)
          throw new RepositoryError(
            'CHART_REVISION_NOT_FOUND',
            404,
            'Pinned chart revision was not found.',
          );
      }
      if (['record_kpi', 'record_chart', 'record_list'].includes(card.cardType)) {
        const config = card.config as {
          source?: {
            objectTypeId?: string;
            viewId?: string;
            filters?: Array<{ fieldId?: string }>;
            sorts?: Array<{ fieldId?: string }>;
          };
          groupByFieldId?: string;
          columns?: Array<{ fieldId?: string }>;
        };
        const objectTypeId = config.source?.objectTypeId;
        const objectType = await client.query(
          'select 1 from object_types where project_id=$1 and id=$2',
          [this.scope.projectId, objectTypeId],
        );
        if (!objectType.rowCount)
          throw new RepositoryError(
            'DASHBOARD_RECORD_SOURCE_NOT_FOUND',
            404,
            'A dashboard record source was not found.',
          );
        if (config.source?.viewId) {
          const view = await client.query(
            'select 1 from record_views where project_id=$1 and object_type_id=$2 and id=$3',
            [this.scope.projectId, objectTypeId, config.source.viewId],
          );
          if (!view.rowCount)
            throw new RepositoryError(
              'DASHBOARD_RECORD_VIEW_NOT_FOUND',
              404,
              'A dashboard source view was not found.',
            );
        }
        const referencedFieldIds = new Set([
          ...(config.source?.filters ?? []).flatMap((filter) =>
            filter.fieldId ? [filter.fieldId] : [],
          ),
          ...(config.source?.sorts ?? []).flatMap((sort) => (sort.fieldId ? [sort.fieldId] : [])),
          ...(config.groupByFieldId ? [config.groupByFieldId] : []),
          ...(config.columns ?? []).flatMap((column) => (column.fieldId ? [column.fieldId] : [])),
        ]);
        if (referencedFieldIds.size) {
          const found = await client.query<{ id: string; field_type: string }>(
            'select id,field_type from field_definitions where project_id=$1 and object_type_id=$2 and id=any($3::uuid[])',
            [this.scope.projectId, objectTypeId, [...referencedFieldIds]],
          );
          if (found.rowCount !== referencedFieldIds.size)
            throw new RepositoryError(
              'DASHBOARD_RECORD_FIELD_NOT_FOUND',
              404,
              'A dashboard card references a field outside its source table.',
            );
          const groupField = found.rows.find((field) => field.id === config.groupByFieldId);
          if (
            card.cardType === 'record_chart' &&
            (!groupField ||
              !['single_select', 'multi_select', 'boolean', 'date', 'datetime'].includes(
                groupField.field_type,
              ))
          )
            throw new RepositoryError(
              'DASHBOARD_GROUP_FIELD_UNSUPPORTED',
              400,
              'Dashboard charts require a select, boolean, or date grouping field.',
            );
        }
      }
    }
  }

  private async insertDashboardRevision(
    client: PoolClient,
    dashboardId: string,
    revisionId: string,
    revisionNumber: number,
    changeNote: string,
    cards: DashboardCardInput[],
  ) {
    await client.query(
      'insert into dashboard_revisions (id,project_id,dashboard_id,revision_number,layout_version,change_note,created_by) values ($1,$2,$3,$4,1,$5,$6)',
      [
        revisionId,
        this.scope.projectId,
        dashboardId,
        revisionNumber,
        changeNote,
        this.scope.actor.actorId,
      ],
    );
    for (const card of cards)
      await client.query(
        'insert into dashboard_cards (id,project_id,dashboard_revision_id,card_type,chart_revision_id,config_version,config,x,y,width,height,position) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)',
        [
          uuidv7(),
          this.scope.projectId,
          revisionId,
          card.cardType,
          card.chartRevisionId ?? null,
          card.configVersion,
          JSON.stringify(card.config),
          card.x,
          card.y,
          card.width,
          card.height,
          card.position,
        ],
      );
  }

  async createDashboard(input: {
    name: string;
    description: string;
    changeNote: string;
    cards: DashboardCardInput[];
    requestId: string;
  }) {
    const dashboardId = uuidv7();
    await transaction(this.pool, async (client) => {
      await this.validateCards(client, input.cards);
      const revisionId = uuidv7();
      await client.query(
        'insert into dashboards (id,project_id,name,description,created_by) values ($1,$2,$3,$4,$5)',
        [
          dashboardId,
          this.scope.projectId,
          input.name,
          input.description,
          this.scope.actor.actorId,
        ],
      );
      await this.insertDashboardRevision(
        client,
        dashboardId,
        revisionId,
        1,
        input.changeNote,
        input.cards,
      );
      await client.query('update dashboards set current_revision_id=$2 where id=$1', [
        dashboardId,
        revisionId,
      ]);
      await appendAudit(
        client,
        this.audit('dashboard.created', 'dashboard', dashboardId, input.requestId),
      );
    });
    return this.getDashboard(dashboardId);
  }

  async reviseDashboard(
    dashboardId: string,
    input: {
      name: string;
      description: string;
      changeNote: string;
      cards: DashboardCardInput[];
      requestId: string;
    },
  ) {
    await transaction(this.pool, async (client) => {
      const current = await client.query<{ revision_number: number }>(
        'select r.revision_number from dashboards d join dashboard_revisions r on r.id=d.current_revision_id where d.project_id=$1 and d.id=$2 and d.archived_at is null for update of d',
        [this.scope.projectId, dashboardId],
      );
      if (!current.rows[0])
        throw new RepositoryError('DASHBOARD_NOT_FOUND', 404, 'Dashboard was not found.');
      await this.validateCards(client, input.cards);
      const revisionId = uuidv7();
      await this.insertDashboardRevision(
        client,
        dashboardId,
        revisionId,
        current.rows[0].revision_number + 1,
        input.changeNote,
        input.cards,
      );
      await client.query(
        'update dashboards set name=$3,description=$4,current_revision_id=$5,updated_at=now() where project_id=$1 and id=$2',
        [this.scope.projectId, dashboardId, input.name, input.description, revisionId],
      );
      await appendAudit(
        client,
        this.audit('dashboard.revised', 'dashboard', dashboardId, input.requestId, { revisionId }),
      );
    });
    return this.getDashboard(dashboardId);
  }

  async setDashboardArchived(
    dashboardId: string,
    archived: boolean,
    reason: string,
    requestId: string,
  ) {
    return transaction(this.pool, async (client) => {
      const row = await client.query(
        `update dashboards set archived_at=${archived ? 'now()' : 'null'},archived_by=${archived ? '$3' : 'null'},archive_reason=${archived ? '$4' : 'null'},updated_at=now() where project_id=$1 and id=$2 and archived_at is ${archived ? 'null' : 'not null'} returning *`,
        archived
          ? [this.scope.projectId, dashboardId, this.scope.actor.actorId, reason]
          : [this.scope.projectId, dashboardId],
      );
      if (!row.rows[0])
        throw new RepositoryError('DASHBOARD_STATE_CONFLICT', 409, 'Dashboard state conflicts.');
      await appendAudit(
        client,
        this.audit(
          archived ? 'dashboard.archived' : 'dashboard.restored',
          'dashboard',
          dashboardId,
          requestId,
        ),
      );
      return row.rows[0];
    });
  }
}

export async function installDefaultVisualizations(client: PoolClient, scope: Scope) {
  const chartIds: string[] = [];
  for (const name of ['Test status overview', 'Measurement trend']) {
    const chartId = uuidv7();
    const revisionId = uuidv7();
    chartIds.push(revisionId);
    await client.query(
      'insert into charts (id,project_id,name,description,system,created_by) values ($1,$2,$3,$4,true,$5)',
      [
        chartId,
        scope.projectId,
        name,
        'Template chart awaiting a compatible dataset.',
        scope.actor.actorId,
      ],
    );
    await client.query(
      "insert into chart_revisions (id,project_id,chart_id,revision_number,config_version,chart_type,config,change_note,created_by) values ($1,$2,$3,1,1,'line',$4::jsonb,'Template installation',$5)",
      [
        revisionId,
        scope.projectId,
        chartId,
        JSON.stringify({
          title: name,
          legend: true,
          axes: { x: { label: 'X', scale: 'linear' }, y: { label: 'Y', scale: 'linear' } },
          series: [],
          filter: null,
          missingData: 'indicate',
        }),
        scope.actor.actorId,
      ],
    );
    await client.query('update charts set current_revision_id=$2 where id=$1', [
      chartId,
      revisionId,
    ]);
  }
  const dashboardId = uuidv7();
  const revisionId = uuidv7();
  await client.query(
    "insert into dashboards (id,project_id,name,description,system,created_by) values ($1,$2,'Test & Characterization','Default engineering overview',true,$3)",
    [dashboardId, scope.projectId, scope.actor.actorId],
  );
  await client.query(
    "insert into dashboard_revisions (id,project_id,dashboard_id,revision_number,layout_version,change_note,created_by) values ($1,$2,$3,1,1,'Template installation',$4)",
    [revisionId, scope.projectId, dashboardId, scope.actor.actorId],
  );
  const cards: DashboardCardInput[] = [
    {
      cardType: 'kpi',
      configVersion: 1,
      config: { metric: 'total_samples', title: 'Total samples' },
      x: 0,
      y: 0,
      width: 3,
      height: 2,
      position: 0,
    },
    {
      cardType: 'kpi',
      configVersion: 1,
      config: { metric: 'pass_rate', title: 'Pass rate' },
      x: 3,
      y: 0,
      width: 3,
      height: 2,
      position: 1,
    },
    {
      cardType: 'specification_status',
      configVersion: 1,
      config: { title: 'Failed evaluations' },
      x: 6,
      y: 0,
      width: 3,
      height: 2,
      position: 2,
    },
    {
      cardType: 'recent_dataset',
      configVersion: 1,
      config: { title: 'Recent datasets' },
      x: 9,
      y: 0,
      width: 3,
      height: 2,
      position: 3,
    },
    {
      cardType: 'chart',
      chartRevisionId: chartIds[0],
      configVersion: 1,
      config: { title: 'Tests by status' },
      x: 0,
      y: 2,
      width: 6,
      height: 4,
      position: 4,
    },
    {
      cardType: 'chart',
      chartRevisionId: chartIds[1],
      configVersion: 1,
      config: { title: 'Measurements by equipment' },
      x: 6,
      y: 2,
      width: 6,
      height: 4,
      position: 5,
    },
    {
      cardType: 'overdue_task',
      configVersion: 1,
      config: { title: 'Overdue tasks' },
      x: 0,
      y: 6,
      width: 12,
      height: 2,
      position: 6,
    },
  ];
  for (const card of cards)
    await client.query(
      'insert into dashboard_cards (id,project_id,dashboard_revision_id,card_type,chart_revision_id,config_version,config,x,y,width,height,position) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)',
      [
        uuidv7(),
        scope.projectId,
        revisionId,
        card.cardType,
        card.chartRevisionId ?? null,
        1,
        JSON.stringify(card.config),
        card.x,
        card.y,
        card.width,
        card.height,
        card.position,
      ],
    );
  await client.query('update dashboards set current_revision_id=$2 where id=$1', [
    dashboardId,
    revisionId,
  ]);
}
