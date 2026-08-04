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
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { allowed, api, HelpTip, inputClass, NoticeText, type User } from './App.js';
import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuModel,
  menuFromKeyboard,
  menuFromPointer,
} from './ContextMenu.js';
import { useI18n } from './i18n.js';

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

const visualizationSourceCopy = {
  en: {
    emptyTitle: 'Add a data source to start visualizing',
    emptyBody:
      'This project has no datasets or record tables yet. Upload a CSV and derive an XY dataset for line and statistical charts, or create a record table for live dashboard cards.',
    addDataset: 'Add a dataset',
    createTable: 'Create a record table',
    noXy: 'No ready XY dataset is available in this project.',
    noNumeric: 'No ready dataset with a numeric column is available.',
    noRecordTable: 'No record table is available for live dashboard cards.',
    noSavedCharts: 'No charts have been saved in this project yet.',
  },
  ko: {
    emptyTitle: '시각화를 시작할 데이터 소스를 추가하세요',
    emptyBody:
      '이 프로젝트에는 아직 데이터셋이나 레코드 테이블이 없습니다. CSV를 업로드하고 XY 데이터셋을 파생해 선·통계 차트를 만들거나, 레코드 테이블을 만들어 라이브 대시보드 카드를 구성하세요.',
    addDataset: '데이터셋 추가',
    createTable: '레코드 테이블 만들기',
    noXy: '이 프로젝트에 준비된 XY 데이터셋이 없습니다.',
    noNumeric: '수치 컬럼이 있는 준비된 데이터셋이 없습니다.',
    noRecordTable: '라이브 대시보드 카드에 사용할 레코드 테이블이 없습니다.',
    noSavedCharts: '이 프로젝트에 저장된 차트가 아직 없습니다.',
  },
};

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
  const { t } = useI18n();
  const [option, setOption] = useState<EChartsOption>();
  const [error, setError] = useState('');
  const [ariaLabel, setAriaLabel] = useState(() => t('visualizations.pinnedChart'));
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
            setError(t('visualizations.noPinnedDataset'));
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
          setError(cause instanceof Error ? cause.message : t('visualizations.invalidChart'));
          setOption(undefined);
        }
      })(),
    [base, revisionId, fallback, t],
  );
  return option ? (
    <EChart ariaLabel={ariaLabel} option={option} />
  ) : (
    <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-700 text-sm text-amber-300">
      {error || t('visualizations.missingChart')}
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
  globalSearch,
}: {
  base: string;
  card: DashboardCard;
  refreshKey: number;
  globalSearch: string;
}) {
  const { formatNumber, t } = useI18n();
  const config = card.config as RecordKpiConfig | RecordChartConfig | RecordListConfig;
  const [result, setResult] = useState<RecordQueryResult>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [drilldown, setDrilldown] = useState<{ value: string | null; label: string }>();
  const [drilldownItems, setDrilldownItems] = useState<DynamicRecord[]>([]);
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
          ...(globalSearch.trim() ? { search: globalSearch.trim() } : {}),
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
        setError(cause instanceof Error ? cause.message : t('visualizations.cardLoadError'));
        setResult(undefined);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base, card.card_type, config, globalSearch, refreshKey, t]);
  useEffect(() => {
    if (!drilldown || card.card_type !== 'record_chart') {
      setDrilldownItems([]);
      return;
    }
    const chart = config as RecordChartConfig;
    let active = true;
    void api<RecordQueryResult>(
      `${base}/object-types/${config.source.objectTypeId}/records/query`,
      {
        method: 'POST',
        body: JSON.stringify({
          filters: [
            ...config.source.filters,
            drilldown.value === null
              ? { fieldId: chart.groupByFieldId, operator: 'is_null' }
              : { fieldId: chart.groupByFieldId, operator: 'eq', value: drilldown.value },
          ],
          sorts: config.source.sorts,
          ...(globalSearch.trim() ? { search: globalSearch.trim() } : {}),
          page: 1,
          pageSize: 10,
        }),
      },
    ).then(
      (response) => {
        if (active) setDrilldownItems(response.items);
      },
      () => {
        if (active) setDrilldownItems([]);
      },
    );
    return () => {
      active = false;
    };
  }, [base, card.card_type, config, drilldown, globalSearch]);

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
          {result ? formatNumber(result.total) : '—'}
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
      name:
        group.value === null
          ? t('visualizations.empty')
          : (chart.groupLabels[group.value] ?? group.value),
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
        <div className="mt-1 flex flex-wrap gap-1.5" aria-label={t('visualizations.drillOptions')}>
          {groups.map((group, index) => (
            <button
              className={`rounded-md px-2 py-1 text-[10px] ${drilldown?.value === group.value ? 'bg-sky-400/15 text-sky-200' : 'bg-slate-800 text-slate-400 hover:text-sky-300'}`}
              key={`${group.value ?? 'empty'}-${index}`}
              onClick={() => setDrilldown({ value: group.value, label: data[index]!.name })}
              type="button"
            >
              {data[index]!.name} · {group.count}
            </button>
          ))}
        </div>
        {drilldown && (
          <div className="mt-2 rounded-lg border border-sky-400/15 bg-slate-950/50 p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium text-sky-200">
                {t('visualizations.recordsFor', { label: drilldown.label })}
              </p>
              <button
                className="text-[10px] text-slate-500 hover:text-slate-200"
                onClick={() => setDrilldown(undefined)}
                type="button"
              >
                {t('visualizations.close')}
              </button>
            </div>
            <ul className="mt-1 grid gap-1">
              {drilldownItems.map((record) => (
                <li key={record.id}>
                  <Link
                    className="block truncate rounded px-1.5 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-sky-300"
                    to={`${base}/data/${config.source.objectTypeId}/records/${record.id}`}
                  >
                    {record.displayName}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    ) : (
      <p className="mt-4 text-sm text-slate-500">{t('visualizations.noGrouped')}</p>
    );
  }
  const list = config as RecordListConfig;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="border-b border-slate-800 px-2 py-2 font-medium">
              {t('visualizations.name')}
            </th>
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
                <Link
                  className="hover:text-sky-300"
                  to={`${base}/data/${config.source.objectTypeId}/records/${record.id}`}
                >
                  {record.displayName}
                </Link>
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
      {!result?.items.length && (
        <p className="p-3 text-sm text-slate-500">{t('visualizations.noRecords')}</p>
      )}
      {(result?.total ?? 0) > list.limit && (
        <p className="mt-2 text-right text-[11px] text-slate-500">
          {t('visualizations.showing', {
            shown: formatNumber(list.limit),
            total: formatNumber(result?.total ?? 0),
          })}
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

type VisualizationElementKind =
  | 'metric'
  | 'quality_status'
  | 'recent_dataset'
  | 'overdue_task'
  | 'saved_chart'
  | 'xy_chart'
  | 'statistical_chart'
  | 'record_kpi'
  | 'record_chart'
  | 'record_list';
type VisualizationElementSize = 'compact' | 'wide' | 'full';

const visualizationElementSizes: Record<
  VisualizationElementSize,
  { width: number; height: number }
> = {
  compact: { width: 4, height: 3 },
  wide: { width: 8, height: 4 },
  full: { width: 12, height: 5 },
};

function VisualizationElementIcon({ kind }: { kind: VisualizationElementKind }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
  };
  return (
    <svg aria-hidden="true" className="size-6" viewBox="0 0 24 24">
      {kind === 'metric' || kind === 'record_kpi' ? (
        <>
          <path {...common} d="M4 19V9m6 10V5m6 14v-7m4 7H2" />
          <path {...common} d="m5 6 4-3 5 4 5-4" />
        </>
      ) : kind === 'quality_status' ? (
        <>
          <path {...common} d="M12 3 5 6v5c0 4.5 2.8 8 7 10 4.2-2 7-5.5 7-10V6l-7-3Z" />
          <path {...common} d="m9 12 2 2 4-5" />
        </>
      ) : kind === 'recent_dataset' ? (
        <>
          <ellipse {...common} cx="10" cy="5" rx="6" ry="2.5" />
          <path {...common} d="M4 5v8c0 1.4 2.7 2.5 6 2.5M4 9c0 1.4 2.7 2.5 6 2.5" />
          <circle {...common} cx="17" cy="16" r="4" />
          <path {...common} d="M17 14v2l1.5 1" />
        </>
      ) : kind === 'overdue_task' ? (
        <>
          <circle {...common} cx="12" cy="12" r="9" />
          <path {...common} d="M12 7v6l4 2" />
          <path {...common} d="M9 2h6" />
        </>
      ) : kind === 'record_list' ? (
        <>
          <rect {...common} x="3" y="4" width="18" height="16" rx="2" />
          <path {...common} d="M3 9h18M8 4v16M3 14h18" />
        </>
      ) : kind === 'record_chart' ? (
        <>
          <path {...common} d="M4 19V5m0 14h16" />
          <path {...common} d="M7 16v-4m4 4V8m4 8v-6m4 6V6" />
        </>
      ) : kind === 'statistical_chart' ? (
        <>
          <path {...common} d="M4 19V5m0 14h16" />
          <path {...common} d="M7 17v-5h3v5m1 0V8h3v9m1 0v-8h3v8" />
        </>
      ) : (
        <>
          <path {...common} d="M3 18 8 11l4 3 5-8 4 4" />
          <path {...common} d="M3 4v16h18" />
          {kind === 'xy_chart' && <circle cx="8" cy="11" fill="currentColor" r="1.5" />}
        </>
      )}
    </svg>
  );
}

export function VisualizationsPage({ user }: { user: User }) {
  const { formatNumber, formatTime, locale, t } = useI18n();
  const sourceCopy = visualizationSourceCopy[locale];
  const { workspaceId, projectId } = useParams();
  const navigate = useNavigate();
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [datasets, setDatasets] = useState<Dataset[]>([]),
    [charts, setCharts] = useState<Chart[]>([]),
    [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [metrics, setMetrics] = useState<Metrics>(),
    [message, setMessage] = useState(''),
    [selectedDashboard, setSelectedDashboard] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const [loading, setLoading] = useState(true);
  const [recordTablesLoading, setRecordTablesLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showElementLibrary, setShowElementLibrary] = useState(false);
  const [showNewDashboard, setShowNewDashboard] = useState(false);
  const [elementPickerStep, setElementPickerStep] = useState<1 | 2 | 3>(1);
  const [elementKind, setElementKind] = useState<VisualizationElementKind>();
  const [elementSize, setElementSize] = useState<VisualizationElementSize>('wide');
  const [recordTables, setRecordTables] = useState<ObjectType[]>([]);
  const [recordFields, setRecordFields] = useState<RecordField[]>([]);
  const [recordViews, setRecordViews] = useState<RecordView[]>([]);
  const [recordSourceId, setRecordSourceId] = useState('');
  const [recordViewId, setRecordViewId] = useState('');
  const [recordChartType, setRecordChartType] = useState<'bar' | 'donut'>('bar');
  const [recordGroupFieldId, setRecordGroupFieldId] = useState('');
  const [recordListFieldIds, setRecordListFieldIds] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuModel>();
  const [recordRefreshKey, setRecordRefreshKey] = useState(0);
  const [lastRecordRefreshAt, setLastRecordRefreshAt] = useState(() => new Date());
  const [dashboardSearch, setDashboardSearch] = useState('');
  const [dashboardQuery, setDashboardQuery] = useState('');
  const [layoutDraft, setLayoutDraft] = useState<
    Record<string, Pick<DashboardCard, 'x' | 'y' | 'width' | 'height'>>
  >({});
  const dashboardGridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDashboardQuery(dashboardSearch), 250);
    return () => window.clearTimeout(timeout);
  }, [dashboardSearch]);
  useEffect(() => {
    if (!showElementLibrary) return;
    const closePicker = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowElementLibrary(false);
    };
    window.addEventListener('keydown', closePicker);
    return () => window.removeEventListener('keydown', closePicker);
  }, [showElementLibrary]);
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
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('visualizations.loadError'));
    } finally {
      setLoading(false);
    }
  }, [base, t]);
  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    let active = true;
    setRecordTablesLoading(true);
    setRecordTables([]);
    setRecordSourceId('');
    void api<{ items: ObjectType[] }>(`${base}/object-types`)
      .then((response) => {
        if (!active) return;
        setRecordTables(response.items);
        setRecordSourceId((current) => current || response.items[0]?.id || '');
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setMessageTone('error');
        setMessage(cause instanceof Error ? cause.message : t('visualizations.tablesError'));
      })
      .finally(() => {
        if (active) setRecordTablesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base, t]);
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
        setMessageTone('error');
        setMessage(cause instanceof Error ? cause.message : t('visualizations.fieldsError'));
      });
    return () => {
      active = false;
    };
  }, [base, recordSourceId, t]);
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
  const sourceDiscoveryComplete = !loading && !recordTablesLoading;
  const hasVisualizationSources = datasets.length > 0 || recordTables.length > 0;
  const dashboard = dashboards.find((item) => item.id === selectedDashboard) ?? dashboards[0];
  useEffect(() => setLayoutDraft({}), [dashboard?.id, dashboard?.revision_number]);
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
  function cardWithDraft(card: DashboardCard): DashboardCard {
    return { ...card, ...(layoutDraft[card.id] ?? {}) };
  }
  function beginLayoutChange(
    event: ReactPointerEvent<HTMLButtonElement>,
    card: DashboardCard,
    mode: 'move' | 'resize',
  ) {
    const grid = dashboardGridRef.current;
    if (!grid || window.innerWidth < 768) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = cardWithDraft(card);
    const bounds = grid.getBoundingClientRect();
    const columnStep = Math.max(40, (bounds.width - 11 * 16) / 12 + 16);
    const rowStep = 64;
    const move = (pointer: PointerEvent) => {
      const columns = Math.round((pointer.clientX - startX) / columnStep);
      const rows = Math.round((pointer.clientY - startY) / rowStep);
      setLayoutDraft((current) => ({
        ...current,
        [card.id]:
          mode === 'move'
            ? {
                x: Math.max(0, Math.min(12 - initial.width, initial.x + columns)),
                y: Math.max(0, initial.y + rows),
                width: initial.width,
                height: initial.height,
              }
            : {
                x: initial.x,
                y: initial.y,
                width: Math.max(2, Math.min(12 - initial.x, initial.width + columns)),
                height: Math.max(2, Math.min(20, initial.height + rows)),
              },
      }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }
  async function mutate(operation: () => Promise<unknown>) {
    setBusy(true);
    try {
      await operation();
      await refresh();
      setMessageTone('success');
      setMessage(t('common.changesSaved'));
      return true;
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('files.operationError'));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function createDashboard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const revisionId = String(form.get('chartRevisionId') ?? '');
    const created = await mutate(() =>
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
    if (created) setShowNewDashboard(false);
  }

  function openElementPicker() {
    setElementPickerStep(1);
    setElementKind(undefined);
    setElementSize('wide');
    setShowElementLibrary(true);
  }

  function chooseElement(kind: VisualizationElementKind) {
    const defaultSize: VisualizationElementSize = [
      'metric',
      'quality_status',
      'overdue_task',
      'record_kpi',
    ].includes(kind)
      ? 'compact'
      : ['saved_chart', 'xy_chart', 'statistical_chart', 'record_list'].includes(kind)
        ? 'full'
        : 'wide';
    setElementKind(kind);
    setElementSize(defaultSize);
    setElementPickerStep(2);
  }

  async function insertElement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dashboard || !elementKind) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    const dimensions = visualizationElementSizes[elementSize];
    const placement = nextCardPlacement(dashboard.cards, dimensions.width, dimensions.height);
    const position = Math.max(-1, ...dashboard.cards.map((card) => card.position)) + 1;
    let validationError = '';

    const inserted = await mutate(async () => {
      let cardInput: Record<string, unknown>;
      if (elementKind === 'metric') {
        cardInput = {
          cardType: 'kpi',
          configVersion: 1,
          config: { title, metric: String(form.get('metric') ?? 'total_samples') },
        };
      } else if (elementKind === 'quality_status') {
        cardInput = {
          cardType: 'specification_status',
          configVersion: 1,
          config: { title },
        };
      } else if (elementKind === 'recent_dataset') {
        cardInput = {
          cardType: 'recent_dataset',
          configVersion: 1,
          config: { title },
        };
      } else if (elementKind === 'overdue_task') {
        cardInput = {
          cardType: 'overdue_task',
          configVersion: 1,
          config: { title },
        };
      } else if (elementKind === 'saved_chart') {
        const chart = charts.find((candidate) => candidate.id === form.get('chartId'));
        if (!chart) {
          validationError = t('visualizations.chooseSavedChart');
          throw new Error(validationError);
        }
        cardInput = {
          cardType: 'chart',
          chartRevisionId: chart.current_revision_id,
          configVersion: 1,
          config: { title },
        };
      } else if (elementKind === 'xy_chart') {
        const selected = form.getAll('datasets').map(String);
        if (!selected.length) {
          validationError = t('visualizations.selectXy');
          throw new Error(validationError);
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
        const x = columns.find((column) => column.role === 'x') ?? columns[0];
        const y = columns.find((column) => column.role === 'y') ?? columns[1];
        const created = await api<Chart>(`${base}/charts`, {
          method: 'POST',
          body: JSON.stringify({
            name: title,
            description: 'Created while inserting a dashboard element',
            chartType: form.get('chartType'),
            configVersion: 1,
            changeNote: 'Initial chart',
            sources,
            config: {
              title,
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
        });
        cardInput = {
          cardType: 'chart',
          chartRevisionId: created.current_revision_id,
          configVersion: 1,
          config: { title },
        };
      } else if (elementKind === 'statistical_chart') {
        const dataset = statisticalDatasets.find((item) => item.id === form.get('datasetId'));
        const column = dataset?.schema.columns?.find((candidate) =>
          /(int|float|double|decimal)/i.test(candidate.dataType),
        );
        if (!dataset || !column) {
          validationError = t('visualizations.selectNumericError');
          throw new Error(validationError);
        }
        const chartType = String(form.get('chartType')) as 'histogram' | 'box_plot';
        const valueAxis = {
          label: column.name,
          dimension: column.dimension,
          displayUnit: column.unit,
          scale: 'linear',
        };
        const config =
          chartType === 'histogram'
            ? {
                title,
                legend: false,
                axes: { x: valueAxis, y: { label: 'Count', scale: 'linear' } },
                sourceKey: 'values',
                columnId: column.id,
                binStrategy: 'auto',
                filter: null,
                missingData: 'indicate',
              }
            : {
                title,
                legend: false,
                axes: { x: { label: 'Series', scale: 'linear' }, y: valueAxis },
                sourceKey: 'values',
                valueColumnId: column.id,
                filter: null,
                missingData: 'indicate',
              };
        const created = await api<Chart>(`${base}/charts`, {
          method: 'POST',
          body: JSON.stringify({
            name: title,
            description: 'Created while inserting a dashboard element',
            chartType,
            configVersion: 1,
            config,
            sources: [
              { sourceKey: 'values', datasetId: dataset.id, sourceRole: 'values', seriesOrder: 0 },
            ],
            changeNote: 'Initial statistical chart',
          }),
        });
        cardInput = {
          cardType: 'chart',
          chartRevisionId: created.current_revision_id,
          configVersion: 1,
          config: { title },
        };
      } else {
        if (!selectedRecordTable) {
          validationError = t('visualizations.selectDashboardSource');
          throw new Error(validationError);
        }
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
        if (elementKind === 'record_kpi') {
          cardInput = {
            cardType: 'record_kpi',
            configVersion: 2,
            config: { title, source, metric: 'count' },
          };
        } else if (elementKind === 'record_chart') {
          const groupField = recordFields.find((field) => field.id === recordGroupFieldId);
          if (!groupField) {
            validationError = t('visualizations.selectGroup');
            throw new Error(validationError);
          }
          cardInput = {
            cardType: 'record_chart',
            configVersion: 2,
            config: {
              title,
              source,
              groupByFieldId: groupField.id,
              groupByLabel: groupField.name,
              groupLabels: Object.fromEntries(
                (groupField.config.options ?? []).map((option) => [option.key, option.label]),
              ),
              chartType: recordChartType,
            },
          };
        } else {
          const columns = recordListFieldIds
            .map((fieldId) => recordFields.find((field) => field.id === fieldId))
            .filter((field): field is RecordField => Boolean(field))
            .slice(0, 6)
            .map((field) => ({ fieldId: field.id, key: field.key, label: field.name }));
          cardInput = {
            cardType: 'record_list',
            configVersion: 2,
            config: { title, source, columns, limit: 10 },
          };
        }
      }

      await api(`${base}/dashboards/${dashboard.id}/revisions`, {
        method: 'POST',
        body: JSON.stringify({
          name: dashboard.name,
          description: dashboard.description,
          changeNote: `Inserted ${title}`,
          cards: [
            ...dashboard.cards.map(dashboardCardInput),
            { ...cardInput, ...placement, ...dimensions, position },
          ],
        }),
      });
    });
    if (inserted) {
      setShowElementLibrary(false);
      setElementPickerStep(1);
      setElementKind(undefined);
      setMessage(t('visualizations.elementInserted'));
    } else if (validationError) {
      setMessage(validationError);
    }
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
          cards: dashboard.cards.map((card) => dashboardCardInput(cardWithDraft(card))),
        }),
      }),
    );
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
      setMessageTone('success');
      setMessage(t('common.copied', { label }));
    } catch {
      setMessageTone('error');
      setMessage(t('common.copyDenied'));
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
              label: t('visualizations.openSource'),
              icon: '↗',
              onSelect: () =>
                void navigate(`${base}/data?type=${recordConfig.source.objectTypeId}`),
            } satisfies ContextMenuItem,
          ]
        : []),
      {
        label: t('visualizations.copyCardTitle'),
        icon: '⧉',
        onSelect: () =>
          void copyDashboardValue(
            t('visualizations.cardTitle'),
            card.config.title ?? t('visualizations.dashboardCard'),
          ),
      },
      ...(recordConfig
        ? [
            {
              label: t('visualizations.copySource'),
              icon: '#',
              onSelect: () => void copyDashboardValue('Source name', recordConfig.source.tableName),
            } satisfies ContextMenuItem,
          ]
        : []),
      ...(allowed(user, 'dashboard.manage')
        ? [
            {
              label: t('visualizations.duplicateCard'),
              icon: '＋',
              separatorBefore: true,
              onSelect: () => void duplicateDashboardCard(card),
            },
            {
              label: t('visualizations.removeCardAction'),
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
        card.config.title ?? t('visualizations.dashboardCard'),
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
      card.config.title ?? t('visualizations.dashboardCard'),
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
  const elementOptions: Array<{
    kind: VisualizationElementKind;
    group: 'project' | 'charts' | 'records';
    name: string;
    body: string;
    accent: string;
    disabled?: boolean;
  }> = [
    {
      kind: 'metric',
      group: 'project',
      name: t('visualizations.elementMetricName'),
      body: t('visualizations.elementMetricBody'),
      accent: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
    },
    {
      kind: 'quality_status',
      group: 'project',
      name: t('visualizations.elementQualityName'),
      body: t('visualizations.elementQualityBody'),
      accent: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
    },
    {
      kind: 'recent_dataset',
      group: 'project',
      name: t('visualizations.elementRecentName'),
      body: t('visualizations.elementRecentBody'),
      accent: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20',
    },
    {
      kind: 'overdue_task',
      group: 'project',
      name: t('visualizations.elementOverdueName'),
      body: t('visualizations.elementOverdueBody'),
      accent: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
    },
    {
      kind: 'saved_chart',
      group: 'charts',
      name: t('visualizations.elementSavedChartName'),
      body: t('visualizations.elementSavedChartBody'),
      accent: 'text-violet-300 bg-violet-500/10 border-violet-500/20',
      disabled: charts.filter((chart) => !chart.archived_at).length === 0,
    },
    {
      kind: 'xy_chart',
      group: 'charts',
      name: t('visualizations.elementXyName'),
      body: t('visualizations.elementXyBody'),
      accent: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20',
      disabled: xy.length === 0,
    },
    {
      kind: 'statistical_chart',
      group: 'charts',
      name: t('visualizations.elementStatName'),
      body: t('visualizations.elementStatBody'),
      accent: 'text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/20',
      disabled: statisticalDatasets.length === 0,
    },
    {
      kind: 'record_kpi',
      group: 'records',
      name: t('visualizations.elementRecordKpiName'),
      body: t('visualizations.elementRecordKpiBody'),
      accent: 'text-lime-300 bg-lime-500/10 border-lime-500/20',
      disabled: recordTables.length === 0,
    },
    {
      kind: 'record_chart',
      group: 'records',
      name: t('visualizations.elementRecordChartName'),
      body: t('visualizations.elementRecordChartBody'),
      accent: 'text-orange-300 bg-orange-500/10 border-orange-500/20',
      disabled: recordTables.length === 0,
    },
    {
      kind: 'record_list',
      group: 'records',
      name: t('visualizations.elementRecordListName'),
      body: t('visualizations.elementRecordListBody'),
      accent: 'text-rose-300 bg-rose-500/10 border-rose-500/20',
      disabled: recordTables.length === 0,
    },
  ];
  const selectedElement = elementOptions.find((option) => option.kind === elementKind);
  return (
    <>
      <Link className="text-sm text-slate-400 hover:text-sky-300" to={base}>
        ← {t('common.projectBack')}
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-sky-400">
            {t('visualizations.canvasEyebrow')}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              {t('visualizations.heading')}
            </h1>
            <HelpTip label={t('visualizations.help')}>{t('visualizations.helpBody')}</HelpTip>
          </div>
          <p className="mt-3 max-w-2xl text-sm text-slate-400">{t('visualizations.canvasBody')}</p>
        </div>
      </div>
      <NoticeText tone={messageTone}>{message}</NoticeText>
      {loading && (
        <p aria-live="polite" className="mt-4 text-sm text-slate-400" role="status">
          {t('common.loading')}
        </p>
      )}
      <div className="flex flex-col">
        {sourceDiscoveryComplete && !hasVisualizationSources && (
          <section
            aria-labelledby="visualization-empty-sources-title"
            className="order-3 mt-6 overflow-hidden rounded-2xl border border-sky-400/25 bg-gradient-to-br from-sky-500/10 via-slate-900/45 to-indigo-500/10 p-6 shadow-xl shadow-sky-950/10"
          >
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">
                {t('common.getStarted')}
              </p>
              <h2
                className="mt-2 text-2xl font-semibold text-slate-100"
                id="visualization-empty-sources-title"
              >
                {sourceCopy.emptyTitle}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{sourceCopy.emptyBody}</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  className="rounded-lg bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
                  to={`${base}/files-datasets`}
                >
                  {sourceCopy.addDataset}
                </Link>
                <Link
                  className="rounded-lg border border-slate-700 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-sky-400/50 hover:text-sky-200"
                  to={`${base}/data`}
                >
                  {sourceCopy.createTable}
                </Link>
              </div>
            </div>
          </section>
        )}
        <details className="group order-4 mt-8 rounded-2xl border border-slate-800 bg-slate-900/30">
          <summary className="flex cursor-pointer list-none items-center justify-between p-5 marker:content-none">
            <h2 className="text-lg font-semibold">{t('visualizations.savedCharts')}</h2>
            <span aria-hidden="true" className="text-slate-500 transition group-open:rotate-180">
              ⌄
            </span>
          </summary>
          <div className="border-t border-slate-800 p-5">
            {!loading && charts.length === 0 && (
              <p className="mt-3 text-sm text-slate-500">{sourceCopy.noSavedCharts}</p>
            )}
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
                        {t('visualizations.revisionSummary', {
                          revision: chart.revision_number,
                          type: chart.chart_type,
                          count: formatNumber(chart.sources.length),
                        })}
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
                        {t('visualizations.publishRevision')}
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
                        {t('visualizations.source', {
                          key: source.source_key,
                          id: source.dataset_id,
                        })}
                      </Link>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </details>
        <section className="order-2 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-semibold">
                {dashboard?.name ?? t('visualizations.canvasTitle')}
              </h2>
              <HelpTip label={t('visualizations.dashboardHelp')}>
                {t('visualizations.dashboardHelpBody')}
              </HelpTip>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {dashboards.length > 0 && (
                <select
                  aria-label={t('visualizations.dashboards')}
                  className={inputClass}
                  value={dashboard?.id ?? ''}
                  onChange={(event) => setSelectedDashboard(event.target.value)}
                >
                  {dashboards.map((item) => (
                    <option key={item.id} value={item.id}>
                      {t('visualizations.dashboardOption', {
                        name: item.name,
                        revision: item.revision_number,
                      })}
                    </option>
                  ))}
                </select>
              )}
              {dashboard && allowed(user, 'dashboard.manage') && (
                <Button disabled={busy} onClick={openElementPicker}>
                  <span aria-hidden="true">＋</span> {t('visualizations.addElement')}
                </Button>
              )}
              {allowed(user, 'dashboard.manage') && (
                <button
                  className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 hover:border-sky-500/50 hover:text-sky-200"
                  onClick={() => setShowNewDashboard((current) => !current)}
                  type="button"
                >
                  {t('visualizations.newDashboard')}
                </button>
              )}
            </div>
            {liveCardCount > 0 && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span aria-live="polite">
                  {t('visualizations.liveUpdated', {
                    count: formatNumber(liveCardCount),
                    time: formatTime(lastRecordRefreshAt),
                  })}
                </span>
                <button
                  className="rounded-md px-2 py-1 text-sky-400 hover:bg-sky-500/10"
                  onClick={refreshLiveCards}
                  type="button"
                >
                  {t('visualizations.refresh')}
                </button>
              </div>
            )}
            {dashboard && allowed(user, 'dashboard.manage') && (
              <div className="flex items-center gap-2">
                {Object.keys(layoutDraft).length > 0 && (
                  <button
                    className="text-xs text-slate-500 hover:text-slate-200"
                    onClick={() => setLayoutDraft({})}
                    type="button"
                  >
                    {t('visualizations.resetLayout')}
                  </button>
                )}
                <button
                  className="text-sm text-sky-400"
                  onClick={() => void publishDashboardRevision()}
                  type="button"
                >
                  {t('visualizations.publishLayout')}
                </button>
              </div>
            )}
          </div>
          {showNewDashboard && allowed(user, 'dashboard.manage') && (
            <form
              className="mt-4 flex flex-col gap-3 rounded-2xl border border-sky-500/25 bg-sky-500/5 p-4 sm:flex-row sm:items-center"
              onSubmit={(event) => void createDashboard(event)}
            >
              <input
                aria-label={t('visualizations.dashboardName')}
                autoFocus
                className={`${inputClass} flex-1`}
                name="name"
                placeholder={t('visualizations.dashboardName')}
                required
              />
              <Button disabled={busy} type="submit">
                {t('visualizations.createCanvas')}
              </Button>
              <button
                className="px-3 py-2 text-sm text-slate-500 hover:text-slate-200"
                onClick={() => setShowNewDashboard(false)}
                type="button"
              >
                {t('common.cancel')}
              </button>
            </form>
          )}
          {dashboard && liveCardCount > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/45 p-3">
              <label className="min-w-64 flex-1 text-xs text-slate-400">
                {t('visualizations.globalFilter')}
                <input
                  aria-label={t('visualizations.searchSources')}
                  className={`${inputClass} mt-1`}
                  placeholder={t('visualizations.searchPlaceholder')}
                  type="search"
                  value={dashboardSearch}
                  onChange={(event) => setDashboardSearch(event.target.value)}
                />
              </label>
              <p className="max-w-md text-[11px] leading-relaxed text-slate-500">
                {t('visualizations.searchHelp')}
              </p>
            </div>
          )}
          {dashboard?.cards.length ? (
            <div
              className="dashboard-grid mt-5 grid min-h-[28rem] grid-cols-12 gap-4 rounded-3xl border border-slate-800 bg-[radial-gradient(circle_at_1px_1px,rgb(51_65_85_/_0.34)_1px,transparent_0)] bg-[size:24px_24px] p-4"
              ref={dashboardGridRef}
            >
              {dashboard.cards.map((card) => (
                <article
                  className="dashboard-card relative rounded-xl border border-slate-800 bg-slate-900/60 p-4"
                  key={card.id}
                  onContextMenu={(event) => openDashboardCardMenu(event, card)}
                  onKeyDown={(event) => openDashboardCardMenuFromKeyboard(event, card)}
                  style={
                    {
                      '--dashboard-column': `${cardWithDraft(card).x + 1} / span ${cardWithDraft(card).width}`,
                      '--dashboard-row': `${cardWithDraft(card).y + 1} / span ${cardWithDraft(card).height}`,
                      '--dashboard-height': cardWithDraft(card).height,
                    } as CSSProperties
                  }
                  tabIndex={0}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {allowed(user, 'dashboard.manage') && (
                        <button
                          aria-label={t('visualizations.moveCard', {
                            title: card.config.title ?? 'card',
                          })}
                          className="cursor-grab rounded px-1 text-slate-600 hover:bg-slate-800 hover:text-sky-300 active:cursor-grabbing"
                          onPointerDown={(event) => beginLayoutChange(event, card, 'move')}
                          title={t('visualizations.dragMove')}
                          type="button"
                        >
                          ⠿
                        </button>
                      )}
                      <h3 className="truncate text-sm font-medium text-slate-300">
                        {card.config.title}
                      </h3>
                    </div>
                    {allowed(user, 'dashboard.manage') && (
                      <button
                        aria-label={t('visualizations.removeCard', {
                          title: card.config.title ?? 'card',
                        })}
                        className="text-xs text-slate-500 hover:text-rose-300"
                        onClick={() => void removeDashboardCard(card.id)}
                        type="button"
                      >
                        {t('visualizations.remove')}
                      </button>
                    )}
                  </div>
                  {card.card_type === 'chart' && card.chart_revision_id ? (
                    <ChartView base={base} revisionId={card.chart_revision_id} />
                  ) : ['record_kpi', 'record_chart', 'record_list'].includes(card.card_type) ? (
                    <RecordCardView
                      base={base}
                      card={card}
                      globalSearch={dashboardQuery}
                      refreshKey={recordRefreshKey}
                    />
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
                  {allowed(user, 'dashboard.manage') && (
                    <button
                      aria-label={t('visualizations.resizeCard', {
                        title: card.config.title ?? 'card',
                      })}
                      className="absolute bottom-1 right-1 cursor-nwse-resize px-1 text-slate-700 hover:text-sky-300"
                      onPointerDown={(event) => beginLayoutChange(event, card, 'resize')}
                      title={t('visualizations.dragResize')}
                      type="button"
                    >
                      ◢
                    </button>
                  )}
                </article>
              ))}
              {allowed(user, 'dashboard.manage') && (
                <button
                  className="col-span-12 flex min-h-24 items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-700 bg-slate-950/20 text-sm font-medium text-slate-500 transition hover:border-sky-500/50 hover:bg-sky-500/5 hover:text-sky-300"
                  onClick={openElementPicker}
                  type="button"
                >
                  <span aria-hidden="true" className="text-lg">
                    ＋
                  </span>
                  {t('visualizations.addElement')}
                </button>
              )}
            </div>
          ) : (
            <div className="mt-5 grid min-h-[32rem] place-items-center rounded-3xl border border-dashed border-slate-700 bg-[radial-gradient(circle_at_1px_1px,rgb(51_65_85_/_0.38)_1px,transparent_0)] bg-[size:24px_24px] p-6 text-center">
              <div className="max-w-lg rounded-3xl border border-slate-800 bg-slate-950/75 p-8 shadow-2xl shadow-slate-950/30 backdrop-blur">
                <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-sky-500/25 bg-sky-500/10 text-2xl text-sky-300">
                  ＋
                </span>
                <h3 className="mt-5 text-2xl font-semibold">
                  {dashboard
                    ? t('visualizations.emptyCanvasTitle')
                    : t('visualizations.noDashboardTitle')}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {dashboard
                    ? t('visualizations.emptyCanvasBody')
                    : t('visualizations.noDashboardBody')}
                </p>
                {allowed(user, 'dashboard.manage') && (
                  <Button
                    className="mt-6"
                    onClick={() => (dashboard ? openElementPicker() : setShowNewDashboard(true))}
                  >
                    {dashboard
                      ? t('visualizations.addFirstElement')
                      : t('visualizations.createCanvas')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
      {showElementLibrary && dashboard && allowed(user, 'dashboard.manage') && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowElementLibrary(false);
          }}
        >
          <section
            aria-labelledby="visualization-element-picker-title"
            aria-modal="true"
            className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-3xl border border-slate-700 bg-slate-950 shadow-2xl shadow-black/50 sm:rounded-3xl"
            role="dialog"
          >
            <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4 sm:px-7">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-sky-400">
                  {t('visualizations.pickerStep', { current: elementPickerStep })}
                </p>
                <h2 className="mt-1 text-2xl font-semibold" id="visualization-element-picker-title">
                  {t('visualizations.elementPicker')}
                </h2>
              </div>
              <button
                aria-label={t('visualizations.closePicker')}
                className="grid size-10 place-items-center rounded-xl border border-slate-800 text-xl text-slate-400 transition hover:border-sky-500/50 hover:bg-sky-500/10 hover:text-sky-200"
                onClick={() => setShowElementLibrary(false)}
                type="button"
              >
                ×
              </button>
            </header>

            <div className="grid min-h-0 flex-1 md:grid-cols-[13rem_1fr]">
              <nav
                aria-label={t('visualizations.elementPicker')}
                className="border-b border-slate-800 bg-slate-900/45 p-4 md:border-b-0 md:border-r"
              >
                <ol className="grid grid-cols-3 gap-2 md:grid-cols-1 md:gap-1">
                  {[
                    [1, t('visualizations.chooseElement')],
                    [2, t('visualizations.chooseSize')],
                    [3, t('visualizations.configureElement')],
                  ].map(([step, label]) => (
                    <li key={String(step)}>
                      <button
                        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs transition md:text-sm ${elementPickerStep === step ? 'bg-sky-500/12 font-medium text-sky-200' : Number(step) < elementPickerStep ? 'text-emerald-300 hover:bg-slate-800' : 'text-slate-600'}`}
                        disabled={
                          Number(step) > elementPickerStep || (Number(step) > 1 && !elementKind)
                        }
                        onClick={() => setElementPickerStep(Number(step) as 1 | 2 | 3)}
                        type="button"
                      >
                        <span
                          className={`grid size-6 shrink-0 place-items-center rounded-full border text-[11px] ${Number(step) < elementPickerStep ? 'border-emerald-500/30 bg-emerald-500/10' : elementPickerStep === step ? 'border-sky-400/40 bg-sky-500/10' : 'border-slate-700'}`}
                        >
                          {Number(step) < elementPickerStep ? '✓' : step}
                        </span>
                        <span className="hidden md:block">{label}</span>
                      </button>
                    </li>
                  ))}
                </ol>
                {selectedElement && (
                  <div className="mt-5 hidden rounded-2xl border border-slate-800 bg-slate-950/40 p-3 md:block">
                    <span
                      className={`grid size-10 place-items-center rounded-xl border ${selectedElement.accent}`}
                    >
                      <VisualizationElementIcon kind={selectedElement.kind} />
                    </span>
                    <p className="mt-3 text-sm font-medium text-slate-200">
                      {selectedElement.name}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{selectedElement.body}</p>
                  </div>
                )}
              </nav>

              <div className="min-h-0 overflow-y-auto p-5 sm:p-7">
                {elementPickerStep === 1 && (
                  <div>
                    <h3 className="text-2xl font-semibold">{t('visualizations.chooseElement')}</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {t('visualizations.chooseElementBody')}
                    </p>
                    <div className="mt-5 space-y-5">
                      {(
                        [
                          ['project', t('visualizations.groupProject')],
                          ['charts', t('visualizations.groupCharts')],
                          ['records', t('visualizations.groupRecords')],
                        ] as const
                      ).map(([group, label]) => (
                        <section key={group}>
                          <h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
                            {label}
                          </h4>
                          <div className="mt-2 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                            {elementOptions
                              .filter((option) => option.group === group)
                              .map((option, index) => (
                                <button
                                  autoFocus={group === 'project' && index === 0}
                                  className="group flex min-h-24 items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/45 p-3 text-left transition enabled:hover:-translate-y-0.5 enabled:hover:border-sky-500/50 enabled:hover:bg-sky-500/5 disabled:cursor-not-allowed disabled:opacity-35"
                                  disabled={option.disabled}
                                  key={option.kind}
                                  onClick={() => chooseElement(option.kind)}
                                  type="button"
                                >
                                  <span
                                    className={`grid size-9 shrink-0 place-items-center rounded-lg border [&_svg]:size-5 ${option.accent}`}
                                  >
                                    <VisualizationElementIcon kind={option.kind} />
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block text-sm font-semibold leading-5 text-slate-200 group-enabled:group-hover:text-sky-200">
                                      {option.name}
                                    </span>
                                    <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-slate-500">
                                      {option.body}
                                    </span>
                                  </span>
                                </button>
                              ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                )}

                {elementPickerStep === 2 && selectedElement && (
                  <div>
                    <h3 className="text-2xl font-semibold">{t('visualizations.chooseSize')}</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {t('visualizations.chooseSizeBody')}
                    </p>
                    <div className="mt-7 grid gap-4 lg:grid-cols-3">
                      {(
                        [
                          [
                            'compact',
                            t('visualizations.sizeCompact'),
                            t('visualizations.sizeCompactBody'),
                          ],
                          ['wide', t('visualizations.sizeWide'), t('visualizations.sizeWideBody')],
                          ['full', t('visualizations.sizeFull'), t('visualizations.sizeFullBody')],
                        ] as const
                      ).map(([size, label, body]) => (
                        <button
                          className={`rounded-2xl border p-4 text-left transition ${elementSize === size ? 'border-sky-400 bg-sky-500/10 ring-2 ring-sky-500/15' : 'border-slate-800 bg-slate-900/45 hover:border-slate-600'}`}
                          key={size}
                          onClick={() => setElementSize(size)}
                          type="button"
                        >
                          <span className="grid h-36 place-items-center rounded-xl border border-slate-800 bg-[radial-gradient(circle_at_1px_1px,rgb(71_85_105_/_0.4)_1px,transparent_0)] bg-[size:16px_16px] p-3">
                            <span
                              className={`grid h-20 place-items-center rounded-xl border ${selectedElement.accent}`}
                              style={{
                                width: `${(visualizationElementSizes[size].width / 12) * 100}%`,
                              }}
                            >
                              <VisualizationElementIcon kind={selectedElement.kind} />
                            </span>
                          </span>
                          <span className="mt-4 flex items-center justify-between gap-3">
                            <span>
                              <span className="block font-semibold text-slate-200">{label}</span>
                              <span className="mt-1 block text-xs text-slate-500">{body}</span>
                            </span>
                            <span
                              className={`grid size-5 place-items-center rounded-full border ${elementSize === size ? 'border-sky-400 bg-sky-400 text-slate-950' : 'border-slate-600'}`}
                            >
                              {elementSize === size ? '✓' : ''}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="mt-8 flex items-center justify-between">
                      <button
                        className="px-3 py-2 text-sm text-slate-400 hover:text-slate-200"
                        onClick={() => setElementPickerStep(1)}
                        type="button"
                      >
                        ← {t('visualizations.backStep')}
                      </button>
                      <Button onClick={() => setElementPickerStep(3)}>
                        {t('visualizations.continueStep')} →
                      </Button>
                    </div>
                  </div>
                )}

                {elementPickerStep === 3 && selectedElement && (
                  <form key={selectedElement.kind} onSubmit={(event) => void insertElement(event)}>
                    <div className="flex items-start gap-4">
                      <span
                        className={`grid size-12 shrink-0 place-items-center rounded-xl border ${selectedElement.accent}`}
                      >
                        <VisualizationElementIcon kind={selectedElement.kind} />
                      </span>
                      <div>
                        <h3 className="text-2xl font-semibold">
                          {t('visualizations.configureElement')}
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                          {t('visualizations.configureElementBody')}
                        </p>
                      </div>
                    </div>
                    <div className="mt-7 grid gap-5 rounded-2xl border border-slate-800 bg-slate-900/35 p-5 md:grid-cols-2">
                      <label className="text-sm text-slate-400 md:col-span-2">
                        {t('visualizations.elementTitle')}
                        <input
                          autoFocus
                          className={inputClass}
                          defaultValue={selectedElement.name}
                          name="title"
                          required
                        />
                      </label>
                      {elementKind === 'metric' && (
                        <label className="text-sm text-slate-400 md:col-span-2">
                          {t('visualizations.elementMetric')}
                          <select className={inputClass} name="metric">
                            <option value="total_samples">
                              {t('visualizations.metricSamples')}
                            </option>
                            <option value="pass_rate">{t('visualizations.metricPassRate')}</option>
                            <option value="dataset_count">
                              {t('visualizations.metricDatasets')}
                            </option>
                          </select>
                        </label>
                      )}
                      {elementKind === 'saved_chart' && (
                        <label className="text-sm text-slate-400 md:col-span-2">
                          {t('visualizations.elementSavedChartName')}
                          <select className={inputClass} name="chartId" required>
                            <option value="">{t('visualizations.chooseSavedChart')}</option>
                            {charts
                              .filter((chart) => !chart.archived_at)
                              .map((chart) => (
                                <option key={chart.id} value={chart.id}>
                                  {chart.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                      {elementKind === 'xy_chart' && (
                        <>
                          <label className="text-sm text-slate-400">
                            {t('visualizations.xyHeading')}
                            <select className={inputClass} name="chartType">
                              <option value="line">{t('visualizations.line')}</option>
                              <option value="scatter">{t('visualizations.scatter')}</option>
                            </select>
                          </label>
                          <fieldset className="text-sm text-slate-400">
                            <legend>{t('common.filesDatasets')}</legend>
                            <div className="mt-2 max-h-36 space-y-2 overflow-auto rounded-xl border border-slate-800 p-3">
                              {xy.map((dataset) => (
                                <label className="block text-sm text-slate-300" key={dataset.id}>
                                  <input
                                    className="mr-2"
                                    name="datasets"
                                    type="checkbox"
                                    value={dataset.id}
                                  />
                                  {dataset.name}
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        </>
                      )}
                      {elementKind === 'statistical_chart' && (
                        <>
                          <label className="text-sm text-slate-400">
                            {t('visualizations.statisticalHeading')}
                            <select className={inputClass} name="chartType">
                              <option value="histogram">{t('visualizations.histogram')}</option>
                              <option value="box_plot">{t('visualizations.boxPlot')}</option>
                            </select>
                          </label>
                          <label className="text-sm text-slate-400">
                            {t('common.filesDatasets')}
                            <select className={inputClass} name="datasetId" required>
                              <option value="">{t('visualizations.selectNumeric')}</option>
                              {statisticalDatasets.map((dataset) => (
                                <option key={dataset.id} value={dataset.id}>
                                  {dataset.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        </>
                      )}
                      {elementKind?.startsWith('record_') && (
                        <>
                          <label className="text-sm text-slate-400">
                            {t('visualizations.selectTable')}
                            <select
                              className={inputClass}
                              value={recordSourceId}
                              onChange={(event) => setRecordSourceId(event.target.value)}
                              required
                            >
                              {recordTables.map((table) => (
                                <option key={table.id} value={table.id}>
                                  {table.pluralName}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-sm text-slate-400">
                            {t('visualizations.allRecords')}
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
                              <option value="">{t('visualizations.allRecords')}</option>
                              {recordViews.map((view) => (
                                <option key={view.id} value={view.id}>
                                  {view.name} · {view.viewType}
                                </option>
                              ))}
                            </select>
                          </label>
                        </>
                      )}
                      {elementKind === 'record_chart' && (
                        <>
                          <label className="text-sm text-slate-400">
                            {t('visualizations.groupedChart')}
                            <select
                              className={inputClass}
                              value={recordChartType}
                              onChange={(event) =>
                                setRecordChartType(event.target.value as 'bar' | 'donut')
                              }
                            >
                              <option value="bar">{t('visualizations.barChart')}</option>
                              <option value="donut">{t('visualizations.donutChart')}</option>
                            </select>
                          </label>
                          <label className="text-sm text-slate-400">
                            {t('visualizations.groupBy')}
                            <select
                              className={inputClass}
                              value={recordGroupFieldId}
                              onChange={(event) => setRecordGroupFieldId(event.target.value)}
                              required
                            >
                              <option value="">{t('visualizations.groupBy')}</option>
                              {recordGroupFields.map((field) => (
                                <option key={field.id} value={field.id}>
                                  {field.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        </>
                      )}
                      {elementKind === 'record_list' && (
                        <fieldset className="md:col-span-2">
                          <legend className="text-sm text-slate-400">
                            {t('visualizations.visibleColumns')}
                          </legend>
                          <div className="mt-2 flex max-h-36 flex-wrap gap-3 overflow-auto rounded-xl border border-slate-800 p-3">
                            {recordFields.map((field) => {
                              const checked = recordListFieldIds.includes(field.id);
                              return (
                                <label className="text-sm text-slate-300" key={field.id}>
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
                    </div>
                    <div className="mt-7 flex items-center justify-between gap-4">
                      <button
                        className="px-3 py-2 text-sm text-slate-400 hover:text-slate-200"
                        onClick={() => setElementPickerStep(2)}
                        type="button"
                      >
                        ← {t('visualizations.backStep')}
                      </button>
                      <Button disabled={busy} type="submit">
                        {busy ? t('common.loading') : t('visualizations.insertElement')}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(undefined)} />
    </>
  );
}
