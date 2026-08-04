import { useEffect, useId, useMemo, useState } from 'react';
import { api } from './App.js';
import type { FieldDefinition } from './DataPageTypes.js';
import { displayFieldValue } from './DataPageViews.js';

interface ChartPoint {
  x: number;
  y: number;
}

interface ChartSeries {
  name: string;
  points: ChartPoint[];
}

interface DatasetChart {
  name: string;
  series: ChartSeries;
}

interface DatasetDetails {
  name: string;
  dataset_type: 'tabular' | 'xy';
  status: string;
  schema?: {
    columns?: Array<{
      name: string;
      role?: string;
    }>;
  };
}

const datasetChartCache = new Map<string, Promise<DatasetChart | undefined>>();
const SERIES_COLORS = ['var(--color-sky-400)', '#14b8a6', '#d99a2b', '#a78bfa', '#fb7185'];
const RGB_SERIES_COLORS: Record<string, string> = {
  r: '#ef4444',
  red: '#ef4444',
  g: '#22c55e',
  green: '#22c55e',
  b: '#3b82f6',
  blue: '#3b82f6',
};

export function chartSeriesColor(name: string, index: number): string {
  return (
    RGB_SERIES_COLORS[name.trim().toLocaleLowerCase()] ??
    SERIES_COLORS[index % SERIES_COLORS.length]!
  );
}

function number(value: unknown): number | undefined {
  const converted = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(converted) ? converted : undefined;
}

function pairedPoints(xValues: unknown[], yValues: unknown[]): ChartPoint[] {
  const points: ChartPoint[] = [];
  for (let index = 0; index < Math.min(xValues.length, yValues.length); index += 1) {
    const x = number(xValues[index]);
    const y = number(yValues[index]);
    if (x !== undefined && y !== undefined) points.push({ x, y });
  }
  return points;
}

export function chartSeriesFromValue(
  field: FieldDefinition,
  value: unknown,
): ChartSeries[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (field.fieldType === 'spectral_data') {
    const spectral = value as {
      x?: unknown[];
      series?: Array<{ name?: string; values?: unknown[] }>;
    };
    if (!Array.isArray(spectral.x) || !Array.isArray(spectral.series)) return undefined;
    const series = spectral.series
      .map((candidate, index) => ({
        name: candidate.name?.trim() || `Signal ${index + 1}`,
        points: Array.isArray(candidate.values) ? pairedPoints(spectral.x!, candidate.values) : [],
      }))
      .filter((candidate) => candidate.points.length > 0);
    return series.length ? series : undefined;
  }
  if (field.fieldType === 'tabular_data') {
    const table = value as { columns?: unknown[]; rows?: unknown[][] };
    if (!Array.isArray(table.columns) || table.columns.length !== 2 || !Array.isArray(table.rows))
      return undefined;
    const points = pairedPoints(
      table.rows.map((row) => row[0]),
      table.rows.map((row) => row[1]),
    );
    if (points.length !== table.rows.length || points.length === 0) return undefined;
    return [{ name: String(table.columns[1] ?? field.config.yLabel ?? 'Y'), points }];
  }
  return undefined;
}

function sampled(points: ChartPoint[], maximum = 96): ChartPoint[] {
  if (points.length <= maximum) return points;
  const result: ChartPoint[] = [];
  const step = (points.length - 1) / (maximum - 1);
  for (let index = 0; index < maximum; index += 1) {
    result.push(points[Math.round(index * step)]!);
  }
  return result;
}

function MiniLineChart({ label, series }: { label: string; series: ChartSeries[] }) {
  const gradientId = useId();
  const plotted = useMemo(
    () => series.map((candidate) => ({ ...candidate, points: sampled(candidate.points) })),
    [series],
  );
  const allPoints = plotted.flatMap((candidate) => candidate.points);
  const pointCount = Math.max(...series.map((candidate) => candidate.points.length));
  const xMin = Math.min(...allPoints.map((point) => point.x));
  const xMax = Math.max(...allPoints.map((point) => point.x));
  const yMin = Math.min(...allPoints.map((point) => point.y));
  const yMax = Math.max(...allPoints.map((point) => point.y));
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const coordinate = (point: ChartPoint) => ({
    x: 2 + ((point.x - xMin) / xRange) * 116,
    y: yMax === yMin ? 16 : 30 - ((point.y - yMin) / yRange) * 28,
  });
  const paths = plotted.map((candidate) =>
    candidate.points
      .map((point, index) => {
        const position = coordinate(point);
        return `${index === 0 ? 'M' : 'L'}${position.x.toFixed(2)},${position.y.toFixed(2)}`;
      })
      .join(' '),
  );
  const firstArea = paths[0]
    ? `${paths[0]} L${coordinate(plotted[0]!.points.at(-1)!).x.toFixed(2)},31 L${coordinate(plotted[0]!.points[0]!).x.toFixed(2)},31 Z`
    : '';
  const firstColor = chartSeriesColor(series[0]?.name ?? '', 0);
  const description = `${label} mini chart · ${pointCount.toLocaleString()} points · ${series.length} ${series.length === 1 ? 'series' : 'series'}`;

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2" data-cell-mini-chart="">
      <svg
        aria-label={description}
        className="h-7 min-w-20 flex-1 overflow-visible"
        preserveAspectRatio="none"
        role="img"
        viewBox="0 0 120 32"
      >
        <title>{description}</title>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={firstColor} stopOpacity="0.22" />
            <stop offset="1" stopColor={firstColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M2 30.5H118" stroke="var(--color-slate-700)" strokeWidth="0.7" />
        {firstArea && <path d={firstArea} fill={`url(#${gradientId})`} />}
        {paths.map((path, index) => (
          <path
            data-chart-series={series[index]?.name ?? `series-${index + 1}`}
            d={path}
            fill="none"
            key={`${series[index]?.name ?? 'series'}-${index}`}
            stroke={chartSeriesColor(series[index]?.name ?? '', index)}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={index === 0 ? 1.8 : 1.4}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <span className="shrink-0 rounded bg-slate-800/70 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-500">
        {pointCount.toLocaleString()} pts
      </span>
    </span>
  );
}

async function loadDatasetChart(
  base: string,
  datasetId: string,
): Promise<DatasetChart | undefined> {
  const cacheKey = `${base}:${datasetId}`;
  const cached = datasetChartCache.get(cacheKey);
  if (cached) return cached;
  const request = (async () => {
    const details = await api<DatasetDetails>(`${base}/datasets/${datasetId}`);
    if (details.dataset_type !== 'xy' || details.status !== 'ready') return undefined;
    const columns = details.schema?.columns ?? [];
    const xColumn = columns.find((column) => column.role === 'x') ?? columns[0];
    const yColumn = columns.find((column) => column.role === 'y') ?? columns[1];
    if (!xColumn || !yColumn) return undefined;
    const preview = await api<{ items: Array<Record<string, unknown>> }>(
      `${base}/datasets/${datasetId}/preview`,
    );
    const points = pairedPoints(
      preview.items.map((row) => row[xColumn.name]),
      preview.items.map((row) => row[yColumn.name]),
    );
    if (!points.length) return undefined;
    return {
      name: details.name,
      series: { name: details.name || yColumn.name, points },
    };
  })()
    .then((result) => {
      if (!result) datasetChartCache.delete(cacheKey);
      return result;
    })
    .catch(() => {
      datasetChartCache.delete(cacheKey);
      return undefined;
    });
  datasetChartCache.set(cacheKey, request);
  return request;
}

function DatasetCellPreview({
  base,
  field,
  label,
  value,
}: {
  base: string;
  field: FieldDefinition;
  label: string;
  value: unknown;
}) {
  const datasetIds = useMemo(
    () =>
      (Array.isArray(value) ? value : [])
        .filter(
          (candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate),
        )
        .slice(0, 4),
    [value],
  );
  const [charts, setCharts] = useState<DatasetChart[]>();

  useEffect(() => {
    let active = true;
    setCharts(undefined);
    if (!datasetIds.length) {
      setCharts([]);
      return () => {
        active = false;
      };
    }
    void Promise.all(datasetIds.map((datasetId) => loadDatasetChart(base, datasetId))).then(
      (loaded) => {
        if (active) setCharts(loaded.filter((item): item is DatasetChart => Boolean(item)));
      },
    );
    return () => {
      active = false;
    };
  }, [base, datasetIds]);

  if (charts?.length)
    return <MiniLineChart label={label} series={charts.map(({ series }) => series)} />;
  if (datasetIds.length && charts === undefined)
    return (
      <span
        aria-label={`${label} chart loading`}
        className="flex min-w-0 flex-1 items-center gap-1.5"
      >
        <span className="h-1 flex-1 rounded-full bg-slate-800" />
        <span className="h-1 w-8 rounded-full bg-slate-700" />
      </span>
    );
  return (
    <span className="block max-w-64 truncate text-slate-300">
      {displayFieldValue(field, value)}
    </span>
  );
}

export function CellValuePreview({
  base,
  field,
  label,
  value,
}: {
  base?: string | undefined;
  field: FieldDefinition;
  label?: string;
  value: unknown;
}) {
  const chartSeries = chartSeriesFromValue(field, value);
  if (chartSeries) return <MiniLineChart label={label ?? field.name} series={chartSeries} />;
  if (field.fieldType === 'dataset' && base)
    return (
      <DatasetCellPreview base={base} field={field} label={label ?? field.name} value={value} />
    );
  return (
    <span className="block max-w-64 truncate text-slate-300">
      {displayFieldValue(field, value)}
    </span>
  );
}
