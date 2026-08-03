import { Button } from '@engrove/ui';
import { BarChart, BoxplotChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { allowed, api, ErrorText, inputClass, type User } from './App.js';
import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuModel,
  menuFromKeyboard,
  menuFromPointer,
} from './ContextMenu.js';

echarts.use([
  BarChart,
  BoxplotChart,
  LineChart,
  PieChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  SVGRenderer,
]);

interface Dataset {
  id: string;
  name: string;
  dataset_type: 'tabular' | 'xy';
  status: string;
  schema: {
    columns?: Array<{
      id: string;
      name: string;
      dataType: string;
      dimension?: string;
      unit?: string;
      role?: string;
    }>;
  };
}
interface ChartSource {
  source_key: string;
  dataset_id: string;
  source_role: string;
  series_order: number;
}
interface Chart {
  id: string;
  name: string;
  description: string;
  current_revision_id: string;
  revision_number: number;
  chart_type: 'line' | 'scatter' | 'histogram' | 'box_plot';
  config_version: 1;
  config: ChartConfig;
  sources: ChartSource[];
  archived_at: string | null;
  revisions?: Array<{ id: string }>;
}
type Literal = string | number | boolean | null;
type FilterNode =
  | { type: 'and'; children: FilterNode[] }
  | { type: 'or'; children: FilterNode[] }
  | {
      type: 'comparison';
      sourceKey: string;
      columnId: string;
      operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
      value: Literal;
    }
  | { type: 'membership'; sourceKey: string; columnId: string; values: Literal[] }
  | { type: 'null'; sourceKey: string; columnId: string }
  | {
      type: 'range';
      sourceKey: string;
      columnId: string;
      lower?: Literal;
      upper?: Literal;
    };
interface AxisConfig {
  label: string;
  dimension?: string;
  displayUnit?: string;
  scale: 'linear' | 'log';
}
interface CommonChartConfig {
  title: string;
  legend: boolean;
  axes: { x: AxisConfig; y: AxisConfig };
  filter?: FilterNode | null;
  missingData: 'gap' | 'skip' | 'zero' | 'indicate';
}
interface CartesianChartConfig extends CommonChartConfig {
  series: Array<{
    sourceKey: string;
    name: string;
    xColumnId: string;
    yColumnId: string;
  }>;
}
interface HistogramChartConfig extends CommonChartConfig {
  sourceKey: string;
  columnId: string;
  binStrategy: 'auto' | 'fixed';
  binCount?: number;
  fixedRange?: [number, number];
}
interface BoxPlotChartConfig extends CommonChartConfig {
  sourceKey: string;
  valueColumnId: string;
  groupColumnId?: string;
}
type ChartConfig = CartesianChartConfig | HistogramChartConfig | BoxPlotChartConfig;
interface ChartRevision {
  chart_type: Chart['chart_type'];
  config: ChartConfig;
  sources: ChartSource[];
}
interface DashboardCard {
  id: string;
  card_type: string;
  chart_revision_id: string | null;
  config: DashboardCardConfig;
  x: number;
  y: number;
  width: number;
  height: number;
  position: number;
}

interface ObjectType {
  id: string;
  name: string;
  pluralName: string;
}
interface RecordField {
  id: string;
  name: string;
  key: string;
  fieldType: string;
  projectionStatus: string;
  config: { options?: Array<{ key: string; label: string }> };
}
interface RecordViewConfig {
  visibleFieldIds: string[];
  filters: Array<{ fieldId: string; operator: string; value?: unknown }>;
  sorts: Array<{
    fieldId?: string;
    systemField?: 'displayName' | 'createdAt' | 'updatedAt';
    direction: 'asc' | 'desc';
  }>;
}
interface RecordView {
  id: string;
  name: string;
  viewType: string;
  config: RecordViewConfig;
}
interface RecordSourceConfig {
  objectTypeId: string;
  tableName: string;
  viewId?: string;
  viewName?: string;
  filters: RecordViewConfig['filters'];
  sorts: RecordViewConfig['sorts'];
}
interface RecordKpiConfig {
  title: string;
  source: RecordSourceConfig;
  metric: 'count';
}
interface RecordChartConfig {
  title: string;
  source: RecordSourceConfig;
  groupByFieldId: string;
  groupByLabel: string;
  groupLabels: Record<string, string>;
  chartType: 'bar' | 'donut';
}
interface RecordListConfig {
  title: string;
  source: RecordSourceConfig;
  columns: Array<{ fieldId: string; key: string; label: string }>;
  limit: number;
}
type DashboardCardConfig =
  { title?: string; metric?: string } | RecordKpiConfig | RecordChartConfig | RecordListConfig;
interface DynamicRecord {
  id: string;
  displayName: string;
  values: Record<string, unknown>;
}
interface RecordQueryResult {
  items: DynamicRecord[];
  total: number;
  groups?: Array<{ value: string | null; count: number }>;
}
interface Dashboard {
  id: string;
  name: string;
  description: string;
  current_revision_id: string;
  revision_number: number;
  cards: DashboardCard[];
  archived_at: string | null;
  revisions?: Array<{ id: string }>;
}
interface Metrics {
  total_samples: number;
  dataset_count: number;
  failed_evaluations: number;
  pass_rate: string | null;
  overdue_tasks: number;
  recent_datasets: Array<{ id: string; name: string; status: string }>;
}

function applyFilter(
  rows: Record<string, unknown>[],
  node: FilterNode | null | undefined,
  columns: Map<string, string>,
): Record<string, unknown>[] {
  if (!node) return rows;
  const test = (row: Record<string, unknown>, current: FilterNode): boolean => {
    if (current.type === 'and' || current.type === 'or')
      return current.type === 'and'
        ? current.children.every((child) => test(row, child))
        : current.children.some((child) => test(row, child));
    const value = row[columns.get(`${current.sourceKey}:${current.columnId}`) ?? ''];
    if (current.type === 'null') return value === null || value === undefined;
    if (current.type === 'membership')
      return current.values.some((candidate) => candidate === value);
    if (current.type === 'range')
      return (
        (current.lower === undefined || Number(value) >= Number(current.lower)) &&
        (current.upper === undefined || Number(value) <= Number(current.upper))
      );
    const right = current.value;
    return current.operator === 'eq'
      ? value === right
      : current.operator === 'ne'
        ? value !== right
        : current.operator === 'gt'
          ? Number(value) > Number(right)
          : current.operator === 'gte'
            ? Number(value) >= Number(right)
            : current.operator === 'lt'
              ? Number(value) < Number(right)
              : Number(value) <= Number(right);
  };
  return rows.filter((row) => test(row, node));
}

function EChart({ option, ariaLabel }: { option: EChartsOption; ariaLabel: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const element = host.current;
    let instance: ReturnType<typeof echarts.init>;
    const render = () => {
      instance?.dispose();
      const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : undefined;
      instance = echarts.init(element, theme, { renderer: 'svg' });
      instance.setOption({ ...option, backgroundColor: 'transparent' }, true);
    };
    render();
    const resize = () => instance.resize();
    const themeObserver = new MutationObserver(render);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    window.addEventListener('resize', resize);
    return () => {
      themeObserver.disconnect();
      window.removeEventListener('resize', resize);
      instance.dispose();
    };
  }, [option]);
  return <div aria-label={ariaLabel} className="h-64 w-full" ref={host} role="img" />;
}

function percentile(sorted: number[], fraction: number) {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index),
    upper = Math.ceil(index);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

function ChartView({
  base,
  revisionId,
  fallback,
}: {
  base: string;
  revisionId: string;
  fallback?: Chart;
}) {
  const [option, setOption] = useState<EChartsOption>();
  const [error, setError] = useState('');
  const [ariaLabel, setAriaLabel] = useState('Pinned data chart');
  useEffect(
    () =>
      void (async () => {
        try {
          const revision: ChartRevision =
            fallback?.current_revision_id === revisionId
              ? fallback
              : await api<ChartRevision>(`${base}/chart-revisions/${revisionId}`);
          const sources: ChartSource[] = revision.sources ?? [];
          if (!sources.length) {
            setOption(undefined);
            setError('No compatible dataset has been pinned yet.');
            return;
          }
          const loaded = new Map<string, { dataset: Dataset; rows: Record<string, unknown>[] }>();
          const columns = new Map<string, string>();
          for (const source of sources) {
            const [dataset, preview] = await Promise.all([
              api<Dataset>(`${base}/datasets/${source.dataset_id}`),
              api<{ items: Record<string, unknown>[] }>(
                `${base}/datasets/${source.dataset_id}/preview`,
              ),
            ]);
            loaded.set(source.source_key, { dataset, rows: preview.items });
            for (const column of dataset.schema.columns ?? [])
              columns.set(`${source.source_key}:${column.id}`, column.name);
          }
          const config = revision.config;
          setAriaLabel(`${config.title}. ${revision.chart_type} chart.`);
          const axisName = (axis: AxisConfig) =>
            `${axis.label}${axis.displayUnit ? ` (${axis.displayUnit})` : ''}`;
          const common: Record<string, unknown> = {
            title: { text: config.title },
            tooltip: { trigger: 'axis' },
            legend: { show: config.legend },
            xAxis: {
              type: config.axes.x.scale === 'log' ? 'log' : 'value',
              name: axisName(config.axes.x),
            },
            yAxis: {
              type: config.axes.y.scale === 'log' ? 'log' : 'value',
              name: axisName(config.axes.y),
            },
            series: [],
          };
          if (revision.chart_type === 'line' || revision.chart_type === 'scatter') {
            const cartesian = config as CartesianChartConfig;
            common.series = cartesian.series.map((series) => {
              const source = loaded.get(series.sourceKey)!;
              const rows = applyFilter(source.rows, cartesian.filter, columns);
              const x = columns.get(`${series.sourceKey}:${series.xColumnId}`)!;
              const y = columns.get(`${series.sourceKey}:${series.yColumnId}`)!;
              return {
                name: series.name,
                type: revision.chart_type === 'line' ? 'line' : 'scatter',
                showSymbol: revision.chart_type === 'scatter',
                connectNulls: cartesian.missingData === 'skip',
                data: rows.map((row) => [row[x], row[y]]),
              };
            });
          } else {
            const statistical = config as HistogramChartConfig | BoxPlotChartConfig;
            const source = loaded.get(statistical.sourceKey)!;
            const columnId =
              revision.chart_type === 'histogram'
                ? (statistical as HistogramChartConfig).columnId
                : (statistical as BoxPlotChartConfig).valueColumnId;
            const name = columns.get(`${statistical.sourceKey}:${columnId}`)!;
            const values = applyFilter(source.rows, statistical.filter, columns)
              .map((row) => Number(row[name]))
              .filter(Number.isFinite)
              .sort((a, b) => a - b);
            if (revision.chart_type === 'histogram') {
              const histogram = config as HistogramChartConfig;
              const count =
                histogram.binStrategy === 'fixed'
                  ? (histogram.binCount ?? 10)
                  : Math.max(2, Math.ceil(Math.sqrt(values.length)));
              const min = histogram.fixedRange?.[0] ?? values[0] ?? 0,
                max = histogram.fixedRange?.[1] ?? values.at(-1) ?? 1,
                width = (max - min || 1) / count;
              const bins = Array.from({ length: count }, (_, index) => ({
                label: (min + width * (index + 0.5)).toPrecision(4),
                count: 0,
              }));
              for (const value of values) {
                const index = Math.min(count - 1, Math.max(0, Math.floor((value - min) / width)));
                bins[index]!.count += 1;
              }
              common.xAxis = {
                type: 'category',
                name: axisName(config.axes.x),
                data: bins.map((bin) => bin.label),
              };
              common.series = [
                { type: 'bar', name: config.title, data: bins.map((bin) => bin.count) },
              ];
            } else {
              common.xAxis = { type: 'category', data: [config.title] };
              common.series = [
                {
                  type: 'boxplot',
                  data: [
                    [
                      values[0] ?? 0,
                      percentile(values, 0.25),
                      percentile(values, 0.5),
                      percentile(values, 0.75),
                      values.at(-1) ?? 0,
                    ],
                  ],
                },
              ];
            }
          }
          setOption(common as EChartsOption);
          setError('');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Chart data is invalid.');
          setOption(undefined);
        }
      })(),
    [base, revisionId, fallback],
  );
  return option ? (
    <EChart ariaLabel={ariaLabel} option={option} />
  ) : (
    <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-700 text-sm text-amber-300">
      {error || 'Missing chart data'}
    </div>
  );
}

function displayRecordValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function RecordCardView({
  base,
  card,
  refreshKey,
}: {
  base: string;
  card: DashboardCard;
  refreshKey: number;
}) {
  const config = card.config as RecordKpiConfig | RecordChartConfig | RecordListConfig;
  const [result, setResult] = useState<RecordQueryResult>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void api<RecordQueryResult>(
      `${base}/object-types/${config.source.objectTypeId}/records/query`,
      {
        method: 'POST',
        body: JSON.stringify({
          filters: config.source.filters,
          sorts: config.source.sorts,
          page: 1,
          pageSize: card.card_type === 'record_list' ? (config as RecordListConfig).limit : 1,
          ...(card.card_type === 'record_chart'
            ? { groupByFieldId: (config as RecordChartConfig).groupByFieldId }
            : {}),
        }),
      },
    )
      .then((response) => {
        if (!active) return;
        setResult(response);
        setError('');
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : 'Card data could not be loaded.');
        setResult(undefined);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base, card.card_type, config, refreshKey]);

  if (loading) return <div className="mt-4 h-16 animate-pulse rounded-lg bg-slate-800/70" />;
  if (error)
    return (
      <p className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-300">
        {error}
      </p>
    );
  if (card.card_type === 'record_kpi')
    return (
      <div className="mt-3">
        <p className="text-4xl font-semibold tracking-tight text-sky-300">
          {result?.total.toLocaleString() ?? '—'}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {(config as RecordKpiConfig).source.tableName}
          {(config as RecordKpiConfig).source.viewName
            ? ` · ${(config as RecordKpiConfig).source.viewName}`
            : ''}
        </p>
      </div>
    );
  if (card.card_type === 'record_chart') {
    const chart = config as RecordChartConfig;
    const groups = result?.groups ?? [];
    const data = groups.map((group) => ({
      name: group.value === null ? 'Empty' : (chart.groupLabels[group.value] ?? group.value),
      value: group.count,
    }));
    const option: EChartsOption =
      chart.chartType === 'donut'
        ? {
            tooltip: { trigger: 'item' },
            legend: { bottom: 0 },
            series: [
              {
                type: 'pie',
                radius: ['45%', '72%'],
                avoidLabelOverlap: true,
                data,
              },
            ],
          }
        : {
            tooltip: { trigger: 'axis' },
            grid: { left: 40, right: 16, top: 16, bottom: 50 },
            xAxis: {
              type: 'category',
              name: chart.groupByLabel,
              data: data.map((item) => item.name),
              axisLabel: { interval: 0, rotate: data.length > 5 ? 25 : 0 },
            },
            yAxis: { type: 'value', minInterval: 1 },
            series: [{ type: 'bar', data: data.map((item) => item.value) }],
          };
    return data.length ? (
      <>
        <EChart
          ariaLabel={`${chart.title}. ${chart.chartType} chart grouped by ${chart.groupByLabel}. ${data.map((item) => `${item.name}: ${item.value}`).join(', ')}.`}
          option={option}
        />
        <ul className="sr-only">
          {data.map((item) => (
            <li key={item.name}>
              {item.name}: {item.value}
            </li>
          ))}
        </ul>
      </>
    ) : (
      <p className="mt-4 text-sm text-slate-500">No grouped records match this card.</p>
    );
  }
  const list = config as RecordListConfig;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="border-b border-slate-800 px-2 py-2 font-medium">Name</th>
            {list.columns.map((column) => (
              <th className="border-b border-slate-800 px-2 py-2 font-medium" key={column.fieldId}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(result?.items ?? []).map((record) => (
            <tr key={record.id}>
              <td className="border-b border-slate-800/70 px-2 py-2 font-medium text-slate-200">
                {record.displayName}
              </td>
              {list.columns.map((column) => (
                <td
                  className="max-w-56 truncate border-b border-slate-800/70 px-2 py-2 text-slate-400"
                  key={column.fieldId}
                >
                  {displayRecordValue(record.values[column.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!result?.items.length && <p className="p-3 text-sm text-slate-500">No records found.</p>}
      {(result?.total ?? 0) > list.limit && (
        <p className="mt-2 text-right text-[11px] text-slate-500">
          Showing {list.limit} of {result?.total.toLocaleString()}
        </p>
      )}
    </div>
  );
}

function dashboardCardInput(card: DashboardCard) {
  return {
    cardType: card.card_type,
    ...(card.chart_revision_id ? { chartRevisionId: card.chart_revision_id } : {}),
    configVersion: ['record_kpi', 'record_chart', 'record_list'].includes(card.card_type) ? 2 : 1,
    config: card.config,
    x: card.x,
    y: card.y,
    width: card.width,
    height: card.height,
    position: card.position,
  };
}

function nextCardPlacement(cards: DashboardCard[], width: number, height: number) {
  for (let y = 0; y <= 1_000 - height; y += 1) {
    for (let x = 0; x <= 12 - width; x += 1) {
      const overlaps = cards.some(
        (card) =>
          x < card.x + card.width &&
          x + width > card.x &&
          y < card.y + card.height &&
          y + height > card.y,
      );
      if (!overlaps) return { x, y };
    }
  }
  throw new Error('The dashboard layout is full.');
}

export function VisualizationsPage({ user }: { user: User }) {
  const { workspaceId, projectId } = useParams();
  const navigate = useNavigate();
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [datasets, setDatasets] = useState<Dataset[]>([]),
    [charts, setCharts] = useState<Chart[]>([]),
    [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [metrics, setMetrics] = useState<Metrics>(),
    [message, setMessage] = useState(''),
    [selectedDashboard, setSelectedDashboard] = useState('');
  const [recordTables, setRecordTables] = useState<ObjectType[]>([]);
  const [recordFields, setRecordFields] = useState<RecordField[]>([]);
  const [recordViews, setRecordViews] = useState<RecordView[]>([]);
  const [recordSourceId, setRecordSourceId] = useState('');
  const [recordViewId, setRecordViewId] = useState('');
  const [recordCardType, setRecordCardType] = useState<
    'record_kpi' | 'record_chart' | 'record_list'
  >('record_kpi');
  const [recordChartType, setRecordChartType] = useState<'bar' | 'donut'>('bar');
  const [recordGroupFieldId, setRecordGroupFieldId] = useState('');
  const [recordListFieldIds, setRecordListFieldIds] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuModel>();
  const [recordRefreshKey, setRecordRefreshKey] = useState(0);
  const [lastRecordRefreshAt, setLastRecordRefreshAt] = useState(() => new Date());
  const refresh = useCallback(async () => {
    try {
      const [d, c, b, m] = await Promise.all([
        api<{ items: Dataset[] }>(`${base}/datasets`),
        api<{ items: Chart[] }>(`${base}/charts?includeArchived=true`),
        api<{ items: Dashboard[] }>(`${base}/dashboards?includeArchived=true`),
        api<Metrics>(`${base}/dashboard-metrics`),
      ]);
      setDatasets(d.items);
      setCharts(c.items);
      setDashboards(b.items);
      setMetrics(m);
      setMessage('');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Visualizations could not be loaded.');
    }
  }, [base]);
  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    let active = true;
    void api<{ items: ObjectType[] }>(`${base}/object-types`)
      .then((response) => {
        if (!active) return;
        setRecordTables(response.items);
        setRecordSourceId((current) => current || response.items[0]?.id || '');
      })
      .catch((cause: unknown) => {
        if (active)
          setMessage(cause instanceof Error ? cause.message : 'Record tables could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [base]);
  useEffect(() => {
    if (!recordSourceId) {
      setRecordFields([]);
      setRecordViews([]);
      return;
    }
    let active = true;
    void Promise.all([
      api<{ items: RecordField[] }>(`${base}/object-types/${recordSourceId}/fields`),
      api<{ items: RecordView[] }>(`${base}/object-types/${recordSourceId}/views`),
    ])
      .then(([fieldResponse, viewResponse]) => {
        if (!active) return;
        const usableFields = fieldResponse.items.filter(
          (field) =>
            field.projectionStatus === 'ready' &&
            !['measurement', 'range', 'file', 'dataset'].includes(field.fieldType),
        );
        setRecordFields(usableFields);
        setRecordViews(viewResponse.items);
        setRecordViewId('');
        setRecordGroupFieldId(
          usableFields.find((field) =>
            ['single_select', 'multi_select', 'boolean', 'date', 'datetime'].includes(
              field.fieldType,
            ),
          )?.id ?? '',
        );
        setRecordListFieldIds(usableFields.slice(0, 4).map((field) => field.id));
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setMessage(cause instanceof Error ? cause.message : 'Table fields could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [base, recordSourceId]);
  const xy = useMemo(
    () => datasets.filter((dataset) => dataset.status === 'ready' && dataset.dataset_type === 'xy'),
    [datasets],
  );
  const statisticalDatasets = useMemo(
    () =>
      datasets.filter(
        (dataset) =>
          dataset.status === 'ready' &&
          dataset.schema.columns?.some((column) =>
            /(int|float|double|decimal)/i.test(column.dataType),
          ),
      ),
    [datasets],
  );
  const dashboard = dashboards.find((item) => item.id === selectedDashboard) ?? dashboards[0];
  const liveCardCount =
    dashboard?.cards.filter((card) =>
      ['record_kpi', 'record_chart', 'record_list'].includes(card.card_type),
    ).length ?? 0;
  const selectedRecordTable = recordTables.find((item) => item.id === recordSourceId);
  const selectedRecordView = recordViews.find((item) => item.id === recordViewId);
  const recordGroupFields = recordFields.filter((field) =>
    ['single_select', 'multi_select', 'boolean', 'date', 'datetime'].includes(field.fieldType),
  );
  useEffect(() => {
    if (!liveCardCount) return;
    const refreshLiveCards = () => {
      if (document.visibilityState !== 'visible') return;
      setRecordRefreshKey((current) => current + 1);
      setLastRecordRefreshAt(new Date());
    };
    const interval = window.setInterval(refreshLiveCards, 60_000);
    document.addEventListener('visibilitychange', refreshLiveCards);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshLiveCards);
    };
  }, [dashboard?.id, liveCardCount]);

  function refreshLiveCards() {
    setRecordRefreshKey((current) => current + 1);
    setLastRecordRefreshAt(new Date());
  }
  async function mutate(operation: () => Promise<unknown>) {
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Operation failed.');
    }
  }
  async function createChart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selected = form.getAll('datasets').map(String);
    if (!selected.length) {
      setMessage('Select at least one ready XY dataset.');
      return;
    }
    const sources = selected.map((datasetId, index) => ({
      sourceKey: `series-${index + 1}`,
      datasetId,
      sourceRole: 'series',
      seriesOrder: index,
    }));
    const series = selected.map((datasetId, index) => {
      const dataset = xy.find((item) => item.id === datasetId)!;
      const columns = dataset.schema.columns ?? [];
      return {
        sourceKey: `series-${index + 1}`,
        name: dataset.name,
        xColumnId: (columns.find((column) => column.role === 'x') ?? columns[0])!.id,
        yColumnId: (columns.find((column) => column.role === 'y') ?? columns[1])!.id,
      };
    });
    const first = xy.find((item) => item.id === selected[0]);
    const columns = first?.schema.columns ?? [];
    const x = columns.find((column) => column.role === 'x') ?? columns[0],
      y = columns.find((column) => column.role === 'y') ?? columns[1];
    await mutate(() =>
      api(`${base}/charts`, {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          description: 'Created in chart studio',
          chartType: form.get('chartType'),
          configVersion: 1,
          changeNote: 'Initial chart',
          sources,
          config: {
            title: form.get('name'),
            legend: true,
            axes: {
              x: {
                label: x?.name ?? 'X',
                dimension: x?.dimension,
                displayUnit: x?.unit,
                scale: 'linear',
              },
              y: {
                label: y?.name ?? 'Y',
                dimension: y?.dimension,
                displayUnit: y?.unit,
                scale: 'linear',
              },
            },
            series,
            filter: null,
            missingData: 'indicate',
          },
        }),
      }),
    );
  }
  async function createStatisticalChart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const dataset = statisticalDatasets.find((item) => item.id === form.get('datasetId'));
    const column = dataset?.schema.columns?.find((candidate) =>
      /(int|float|double|decimal)/i.test(candidate.dataType),
    );
    if (!dataset || !column) {
      setMessage('Select a ready dataset with a numeric column.');
      return;
    }
    const chartType = String(form.get('chartType')) as 'histogram' | 'box_plot';
    const name = String(form.get('name'));
    const valueAxis = {
      label: column.name,
      dimension: column.dimension,
      displayUnit: column.unit,
      scale: 'linear',
    };
    const config =
      chartType === 'histogram'
        ? {
            title: name,
            legend: false,
            axes: {
              x: valueAxis,
              y: { label: 'Count', scale: 'linear' },
            },
            sourceKey: 'values',
            columnId: column.id,
            binStrategy: 'auto',
            filter: null,
            missingData: 'indicate',
          }
        : {
            title: name,
            legend: false,
            axes: {
              x: { label: 'Series', scale: 'linear' },
              y: valueAxis,
            },
            sourceKey: 'values',
            valueColumnId: column.id,
            filter: null,
            missingData: 'indicate',
          };
    await mutate(() =>
      api(`${base}/charts`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: 'Created in statistical chart studio',
          chartType,
          configVersion: 1,
          config,
          sources: [
            {
              sourceKey: 'values',
              datasetId: dataset.id,
              sourceRole: 'values',
              seriesOrder: 0,
            },
          ],
          changeNote: 'Initial statistical chart',
        }),
      }),
    );
  }
  async function createDashboard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const revisionId = String(form.get('chartRevisionId'));
    await mutate(() =>
      api(`${base}/dashboards`, {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          description: 'Custom dashboard',
          changeNote: 'Initial layout',
          cards: revisionId
            ? [
                {
                  cardType: 'chart',
                  chartRevisionId: revisionId,
                  configVersion: 1,
                  config: { title: 'Pinned chart' },
                  x: 0,
                  y: 0,
                  width: 12,
                  height: 5,
                  position: 0,
                },
              ]
            : [],
        }),
      }),
    );
  }
  async function publishDashboardRevision() {
    if (!dashboard) return;
    await mutate(() =>
      api(`${base}/dashboards/${dashboard.id}/revisions`, {
        method: 'POST',
        body: JSON.stringify({
          name: dashboard.name,
          description: dashboard.description,
          changeNote: 'Explicit layout publication',
          cards: dashboard.cards.map(dashboardCardInput),
        }),
      }),
    );
  }
  async function addRecordCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!dashboard || !selectedRecordTable) {
      setMessage('Create a dashboard and select a source table first.');
      return;
    }
    const form = new FormData(formElement);
    const title = String(form.get('title') ?? '').trim();
    const source: RecordSourceConfig = {
      objectTypeId: selectedRecordTable.id,
      tableName: selectedRecordTable.pluralName,
      ...(selectedRecordView
        ? { viewId: selectedRecordView.id, viewName: selectedRecordView.name }
        : {}),
      filters: selectedRecordView?.config.filters ?? [],
      sorts: selectedRecordView?.config.sorts ?? [
        { systemField: 'updatedAt' as const, direction: 'desc' as const },
      ],
    };
    const dimensions =
      recordCardType === 'record_kpi'
        ? { width: 4, height: 3 }
        : recordCardType === 'record_chart'
          ? { width: 6, height: 6 }
          : { width: 12, height: 5 };
    const placement = nextCardPlacement(dashboard.cards, dimensions.width, dimensions.height);
    let config: RecordKpiConfig | RecordChartConfig | RecordListConfig;
    if (recordCardType === 'record_kpi') {
      config = { title, source, metric: 'count' };
    } else if (recordCardType === 'record_chart') {
      const groupField = recordFields.find((field) => field.id === recordGroupFieldId);
      if (!groupField) {
        setMessage('Select a field to group the chart by.');
        return;
      }
      config = {
        title,
        source,
        groupByFieldId: groupField.id,
        groupByLabel: groupField.name,
        groupLabels: Object.fromEntries(
          (groupField.config.options ?? []).map((option) => [option.key, option.label]),
        ),
        chartType: recordChartType,
      };
    } else {
      const columns = recordListFieldIds
        .map((fieldId) => recordFields.find((field) => field.id === fieldId))
        .filter((field): field is RecordField => Boolean(field))
        .slice(0, 6)
        .map((field) => ({ fieldId: field.id, key: field.key, label: field.name }));
      config = { title, source, columns, limit: 10 };
    }
    await mutate(() =>
      api(`${base}/dashboards/${dashboard.id}/revisions`, {
        method: 'POST',
        body: JSON.stringify({
          name: dashboard.name,
          description: dashboard.description,
          changeNote: `Added ${title} from ${selectedRecordTable.pluralName}`,
          cards: [
            ...dashboard.cards.map(dashboardCardInput),
            {
              cardType: recordCardType,
              configVersion: 2,
              config,
              ...placement,
              ...dimensions,
              position: Math.max(-1, ...dashboard.cards.map((card) => card.position)) + 1,
            },
          ],
        }),
      }),
    );
    formElement.reset();
  }
  async function removeDashboardCard(cardId: string) {
    if (!dashboard) return;
    await mutate(() =>
      api(`${base}/dashboards/${dashboard.id}/revisions`, {
        method: 'POST',
        body: JSON.stringify({
          name: dashboard.name,
          description: dashboard.description,
          changeNote: 'Removed a dashboard card',
          cards: dashboard.cards.filter((card) => card.id !== cardId).map(dashboardCardInput),
        }),
      }),
    );
  }
  async function duplicateDashboardCard(card: DashboardCard) {
    if (!dashboard) return;
    const placement = nextCardPlacement(dashboard.cards, card.width, card.height);
    await mutate(() =>
      api(`${base}/dashboards/${dashboard.id}/revisions`, {
        method: 'POST',
        body: JSON.stringify({
          name: dashboard.name,
          description: dashboard.description,
          changeNote: `Duplicated ${card.config.title ?? 'dashboard card'}`,
          cards: [
            ...dashboard.cards.map(dashboardCardInput),
            {
              ...dashboardCardInput(card),
              ...placement,
              position: Math.max(-1, ...dashboard.cards.map((item) => item.position)) + 1,
            },
          ],
        }),
      }),
    );
  }
  async function copyDashboardValue(label: string, value: string) {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard is unavailable.');
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied.`);
    } catch {
      setMessage('Clipboard access was denied by the browser.');
    }
  }
  function dashboardCardContextItems(card: DashboardCard): ContextMenuItem[] {
    const recordConfig = ['record_kpi', 'record_chart', 'record_list'].includes(card.card_type)
      ? (card.config as RecordKpiConfig | RecordChartConfig | RecordListConfig)
      : undefined;
    return [
      ...(recordConfig
        ? [
            {
              label: 'Open source table',
              icon: '↗',
              onSelect: () =>
                void navigate(`${base}/data?type=${recordConfig.source.objectTypeId}`),
            } satisfies ContextMenuItem,
          ]
        : []),
      {
        label: 'Copy card title',
        icon: '⧉',
        onSelect: () =>
          void copyDashboardValue('Card title', card.config.title ?? 'Dashboard card'),
      },
      ...(recordConfig
        ? [
            {
              label: 'Copy source name',
              icon: '#',
              onSelect: () => void copyDashboardValue('Source name', recordConfig.source.tableName),
            } satisfies ContextMenuItem,
          ]
        : []),
      ...(allowed(user, 'dashboard.manage')
        ? [
            {
              label: 'Duplicate card',
              icon: '＋',
              separatorBefore: true,
              onSelect: () => void duplicateDashboardCard(card),
            },
            {
              label: 'Remove card',
              icon: '×',
              tone: 'danger' as const,
              onSelect: () => void removeDashboardCard(card.id),
            },
          ]
        : []),
    ];
  }
  function openDashboardCardMenu(event: ReactMouseEvent<HTMLElement>, card: DashboardCard) {
    setContextMenu(
      menuFromPointer(
        event,
        card.config.title ?? 'Dashboard card',
        dashboardCardContextItems(card),
      ),
    );
  }
  function openDashboardCardMenuFromKeyboard(
    event: ReactKeyboardEvent<HTMLElement>,
    card: DashboardCard,
  ) {
    const menu = menuFromKeyboard(
      event,
      card.config.title ?? 'Dashboard card',
      dashboardCardContextItems(card),
    );
    if (menu) setContextMenu(menu);
  }
  const metricValue = (card: DashboardCard) =>
    (card.config as { metric?: string }).metric === 'total_samples'
      ? metrics?.total_samples
      : (card.config as { metric?: string }).metric === 'pass_rate'
        ? metrics?.pass_rate === null
          ? '—'
          : `${metrics?.pass_rate}%`
        : metrics?.dataset_count;
  return (
    <>
      <Link className="text-sm text-slate-400 hover:text-sky-300" to={base}>
        ← Project
      </Link>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
        Charts &amp; dashboards
      </h1>
      <p className="mt-3 text-slate-400">
        Every chart source and dashboard card is pinned to an immutable revision. Right-click a card
        for source and layout actions.
      </p>
      <ErrorText>{message}</ErrorText>
      {allowed(user, 'dashboard.manage') && (
        <div className="mt-8 grid gap-5 xl:grid-cols-3">
          <form
            className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-5 shadow-lg shadow-slate-950/10"
            onSubmit={(event) => void createChart(event)}
          >
            <h2 className="text-xl font-semibold">Overlay XY datasets</h2>
            <input className={inputClass} name="name" placeholder="Chart name" required />
            <select className={inputClass} name="chartType">
              <option value="line">Line</option>
              <option value="scatter">Scatter</option>
            </select>
            <div className="max-h-40 space-y-2 overflow-auto">
              {xy.map((dataset) => (
                <label className="block text-sm" key={dataset.id}>
                  <input className="mr-2" name="datasets" type="checkbox" value={dataset.id} />
                  {dataset.name}
                </label>
              ))}
            </div>
            <Button type="submit">Save chart</Button>
          </form>
          <form
            className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-5 shadow-lg shadow-slate-950/10"
            onSubmit={(event) => void createStatisticalChart(event)}
          >
            <h2 className="text-xl font-semibold">Statistical chart</h2>
            <input className={inputClass} name="name" placeholder="Chart name" required />
            <select className={inputClass} name="chartType">
              <option value="histogram">Histogram</option>
              <option value="box_plot">Box plot</option>
            </select>
            <select className={inputClass} name="datasetId" required>
              <option value="">Select a numeric dataset</option>
              {statisticalDatasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">
              The first numeric stable column is selected; its exact dataset revision is pinned.
            </p>
            <Button type="submit">Save statistical chart</Button>
          </form>
          <form
            className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-5 shadow-lg shadow-slate-950/10"
            onSubmit={(event) => void createDashboard(event)}
          >
            <h2 className="text-xl font-semibold">New dashboard</h2>
            <input className={inputClass} name="name" placeholder="Dashboard name" required />
            <select className={inputClass} name="chartRevisionId">
              <option value="">Empty dashboard</option>
              {charts
                .filter((chart) => !chart.archived_at)
                .map((chart) => (
                  <option key={chart.current_revision_id} value={chart.current_revision_id}>
                    {chart.name} · revision {chart.revision_number}
                  </option>
                ))}
            </select>
            <Button type="submit">Publish dashboard</Button>
          </form>
        </div>
      )}
      <section className="mt-10">
        <h2 className="text-2xl font-semibold">Saved charts</h2>
        <div className="mt-4 grid gap-5 xl:grid-cols-2">
          {charts.map((chart) => (
            <article
              className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-xl shadow-slate-950/10"
              key={chart.id}
            >
              <div className="flex justify-between">
                <div>
                  <h3 className="font-semibold">{chart.name}</h3>
                  <p className="text-xs text-slate-500">
                    Revision {chart.revision_number} · {chart.chart_type} · {chart.sources.length}{' '}
                    exact source(s)
                  </p>
                </div>
                {allowed(user, 'dashboard.manage') && (
                  <button
                    className="text-sm text-sky-400"
                    onClick={() =>
                      void mutate(() =>
                        api(`${base}/charts/${chart.id}/revisions`, {
                          method: 'POST',
                          body: JSON.stringify({
                            name: chart.name,
                            description: chart.description,
                            chartType: chart.chart_type,
                            configVersion: chart.config_version,
                            config: chart.config,
                            sources: chart.sources.map((source) => ({
                              sourceKey: source.source_key,
                              datasetId: source.dataset_id,
                              sourceRole: source.source_role,
                              seriesOrder: source.series_order,
                            })),
                            changeNote: 'Explicit republish',
                          }),
                        }),
                      )
                    }
                  >
                    Publish revision
                  </button>
                )}
              </div>
              <ChartView base={base} revisionId={chart.current_revision_id} fallback={chart} />
              <div className="text-xs text-slate-500">
                {chart.sources.map((source) => (
                  <Link
                    className="mr-3 text-sky-400"
                    key={source.source_key}
                    to={`${base}/files-datasets`}
                  >
                    Source {source.source_key}: {source.dataset_id}
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="mt-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold">Dashboards</h2>
          <select
            className={inputClass}
            value={dashboard?.id ?? ''}
            onChange={(event) => setSelectedDashboard(event.target.value)}
          >
            {dashboards.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · revision {item.revision_number}
              </option>
            ))}
          </select>
          {liveCardCount > 0 && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span aria-live="polite">
                {liveCardCount} live · updated{' '}
                {lastRecordRefreshAt.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <button
                className="rounded-md px-2 py-1 text-sky-400 hover:bg-sky-500/10"
                onClick={refreshLiveCards}
                type="button"
              >
                Refresh live data
              </button>
            </div>
          )}
          {dashboard && allowed(user, 'dashboard.manage') && (
            <button
              className="text-sm text-sky-400"
              onClick={() => void publishDashboardRevision()}
            >
              Publish layout revision
            </button>
          )}
        </div>
        {dashboard && allowed(user, 'dashboard.manage') && (
          <form
            className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/40 p-5"
            onSubmit={(event) => void addRecordCard(event)}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">Compose from record tables</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Mix cards from different tables. Saved-view filters and sorts are pinned into the
                  next dashboard revision.
                </p>
              </div>
              <Button disabled={!recordTables.length} type="submit">
                Add card
              </Button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <input className={inputClass} name="title" placeholder="Card title" required />
              <select
                className={inputClass}
                value={recordCardType}
                onChange={(event) =>
                  setRecordCardType(
                    event.target.value as 'record_kpi' | 'record_chart' | 'record_list',
                  )
                }
              >
                <option value="record_kpi">Record count KPI</option>
                <option value="record_chart">Grouped chart</option>
                <option value="record_list">Record list</option>
              </select>
              <select
                className={inputClass}
                value={recordSourceId}
                onChange={(event) => setRecordSourceId(event.target.value)}
                required
              >
                <option value="">Select a source table</option>
                {recordTables.map((table) => (
                  <option key={table.id} value={table.id}>
                    {table.pluralName}
                  </option>
                ))}
              </select>
              <select
                className={inputClass}
                value={recordViewId}
                onChange={(event) => {
                  const viewId = event.target.value;
                  const view = recordViews.find((item) => item.id === viewId);
                  setRecordViewId(viewId);
                  if (view) {
                    const visible = view.config.visibleFieldIds.filter((fieldId) =>
                      recordFields.some((field) => field.id === fieldId),
                    );
                    if (visible.length) setRecordListFieldIds(visible.slice(0, 6));
                  }
                }}
              >
                <option value="">All records (no saved view)</option>
                {recordViews.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name} · {view.viewType}
                  </option>
                ))}
              </select>
            </div>
            {recordCardType === 'record_chart' && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <select
                  className={inputClass}
                  value={recordChartType}
                  onChange={(event) => setRecordChartType(event.target.value as 'bar' | 'donut')}
                >
                  <option value="bar">Bar chart</option>
                  <option value="donut">Donut chart</option>
                </select>
                <select
                  className={inputClass}
                  value={recordGroupFieldId}
                  onChange={(event) => setRecordGroupFieldId(event.target.value)}
                  required
                >
                  <option value="">Group by field</option>
                  {recordGroupFields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {recordCardType === 'record_list' && (
              <fieldset className="mt-3">
                <legend className="text-xs font-medium text-slate-400">
                  Visible columns · up to 6
                </legend>
                <div className="mt-2 flex max-h-28 flex-wrap gap-x-4 gap-y-2 overflow-auto">
                  {recordFields.map((field) => {
                    const checked = recordListFieldIds.includes(field.id);
                    return (
                      <label className="text-xs text-slate-300" key={field.id}>
                        <input
                          checked={checked}
                          className="mr-2"
                          disabled={!checked && recordListFieldIds.length >= 6}
                          onChange={() =>
                            setRecordListFieldIds((current) =>
                              current.includes(field.id)
                                ? current.filter((fieldId) => fieldId !== field.id)
                                : [...current, field.id].slice(0, 6),
                            )
                          }
                          type="checkbox"
                        />
                        {field.name}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
          </form>
        )}
        {dashboard ? (
          <div className="dashboard-grid mt-5 grid grid-cols-12 gap-4">
            {dashboard.cards.map((card) => (
              <article
                className="dashboard-card relative rounded-xl border border-slate-800 bg-slate-900/60 p-4"
                key={card.id}
                onContextMenu={(event) => openDashboardCardMenu(event, card)}
                onKeyDown={(event) => openDashboardCardMenuFromKeyboard(event, card)}
                style={
                  {
                    '--dashboard-column': `${card.x + 1} / span ${card.width}`,
                    '--dashboard-row': `${card.y + 1} / span ${card.height}`,
                    '--dashboard-height': card.height,
                  } as CSSProperties
                }
                tabIndex={0}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-medium text-slate-300">{card.config.title}</h3>
                  {allowed(user, 'dashboard.manage') && (
                    <button
                      aria-label={`Remove ${card.config.title ?? 'card'}`}
                      className="text-xs text-slate-500 hover:text-rose-300"
                      onClick={() => void removeDashboardCard(card.id)}
                      type="button"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {card.card_type === 'chart' && card.chart_revision_id ? (
                  <ChartView base={base} revisionId={card.chart_revision_id} />
                ) : ['record_kpi', 'record_chart', 'record_list'].includes(card.card_type) ? (
                  <RecordCardView base={base} card={card} refreshKey={recordRefreshKey} />
                ) : card.card_type === 'kpi' ? (
                  <p className="mt-4 text-4xl font-semibold text-sky-300">
                    {metricValue(card) ?? '—'}
                  </p>
                ) : card.card_type === 'specification_status' ? (
                  <p className="mt-4 text-4xl font-semibold text-rose-300">
                    {metrics?.failed_evaluations ?? 0}
                  </p>
                ) : card.card_type === 'recent_dataset' ? (
                  <ul className="mt-3 text-sm">
                    {metrics?.recent_datasets.map((item) => (
                      <li key={item.id}>
                        {item.name} · {item.status}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-4xl font-semibold">{metrics?.overdue_tasks ?? 0}</p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-5 text-slate-500">No dashboard has been published.</p>
        )}
      </section>
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(undefined)} />
    </>
  );
}
