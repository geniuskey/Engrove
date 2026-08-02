import { Button } from '@engrove/ui';
import { BarChart, BoxplotChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { allowed, api, ErrorText, inputClass, type User } from './App.js';

echarts.use([
  BarChart,
  BoxplotChart,
  LineChart,
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
  config: { title?: string; metric?: string };
  x: number;
  y: number;
  width: number;
  height: number;
  position: number;
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

function EChart({ option }: { option: EChartsOption }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const instance = echarts.init(host.current, undefined, { renderer: 'svg' });
    instance.setOption(option, true);
    const resize = () => instance.resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      instance.dispose();
    };
  }, [option]);
  return <div className="h-80 w-full" ref={host} />;
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
    <EChart option={option} />
  ) : (
    <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-700 text-sm text-amber-300">
      {error || 'Missing chart data'}
    </div>
  );
}

export function VisualizationsPage({ user }: { user: User }) {
  const { workspaceId, projectId } = useParams();
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [datasets, setDatasets] = useState<Dataset[]>([]),
    [charts, setCharts] = useState<Chart[]>([]),
    [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [metrics, setMetrics] = useState<Metrics>(),
    [message, setMessage] = useState(''),
    [selectedDashboard, setSelectedDashboard] = useState('');
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
          cards: dashboard.cards.map((card) => ({
            cardType: card.card_type,
            ...(card.chart_revision_id ? { chartRevisionId: card.chart_revision_id } : {}),
            configVersion: 1,
            config: card.config,
            x: card.x,
            y: card.y,
            width: card.width,
            height: card.height,
            position: card.position,
          })),
        }),
      }),
    );
  }
  const metricValue = (card: DashboardCard) =>
    card.config.metric === 'total_samples'
      ? metrics?.total_samples
      : card.config.metric === 'pass_rate'
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
        Every chart source and dashboard card is pinned to an immutable revision.
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
          {dashboard && allowed(user, 'dashboard.manage') && (
            <button
              className="text-sm text-sky-400"
              onClick={() => void publishDashboardRevision()}
            >
              Publish layout revision
            </button>
          )}
        </div>
        {dashboard ? (
          <div className="mt-5 grid grid-cols-12 gap-4">
            {dashboard.cards.map((card) => (
              <article
                className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
                key={card.id}
                style={{
                  gridColumn: `span ${card.width} / span ${card.width}`,
                  minHeight: `${Math.max(8, card.height * 3)}rem`,
                }}
              >
                <h3 className="text-sm font-medium text-slate-300">{card.config.title}</h3>
                {card.card_type === 'chart' && card.chart_revision_id ? (
                  <ChartView base={base} revisionId={card.chart_revision_id} />
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
    </>
  );
}
