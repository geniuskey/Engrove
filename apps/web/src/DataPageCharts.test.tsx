import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CellValuePreview, chartSeriesColor, chartSeriesFromValue } from './DataPageCharts.js';
import type { FieldDefinition } from './DataPageTypes.js';

function field(fieldType: FieldDefinition['fieldType']): FieldDefinition {
  return {
    id: 'field-1',
    objectTypeId: 'object-1',
    name: fieldType === 'spectral_data' ? 'Spectrum' : 'Response',
    key: 'response',
    description: '',
    fieldType,
    required: false,
    unique: false,
    position: 0,
    config: {},
    projectionStatus: 'ready',
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CellValuePreview', () => {
  it('maps RGB aliases to red, green, and blue chart colors', () => {
    expect(chartSeriesColor('r', 0)).toBe('#ef4444');
    expect(chartSeriesColor('Red', 1)).toBe('#ef4444');
    expect(chartSeriesColor('g', 2)).toBe('#22c55e');
    expect(chartSeriesColor('GREEN', 3)).toBe('#22c55e');
    expect(chartSeriesColor('b', 4)).toBe('#3b82f6');
    expect(chartSeriesColor(' blue ', 0)).toBe('#3b82f6');
    expect(chartSeriesColor('Reflectance', 2)).toBe('#d99a2b');
  });

  it('renders RGB spectral keys with their semantic colors', () => {
    render(
      <CellValuePreview
        field={{ ...field('spectral_data'), name: 'QE' }}
        value={{
          x: [400, 500],
          series: [
            { name: 'r', values: [0.1, 0.8] },
            { name: 'g', values: [0.2, 0.7] },
            { name: 'b', values: [0.3, 0.6] },
          ],
        }}
      />,
    );

    expect(
      screen.getByRole('img', { name: 'QE mini chart · 2 points · 3 series' }),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-chart-series="r"]')).toHaveAttribute('stroke', '#ef4444');
    expect(document.querySelector('[data-chart-series="g"]')).toHaveAttribute('stroke', '#22c55e');
    expect(document.querySelector('[data-chart-series="b"]')).toHaveAttribute('stroke', '#3b82f6');
  });

  it('renders spectral and numeric two-column data as miniature charts', () => {
    const spectrum = field('spectral_data');
    const table = field('tabular_data');
    const { rerender } = render(
      <CellValuePreview
        field={spectrum}
        value={{
          x: [400, 450, 500],
          series: [{ name: 'Absorbance', values: [0.1, 0.6, 0.2] }],
        }}
      />,
    );
    expect(
      screen.getByRole('img', { name: 'Spectrum mini chart · 3 points · 1 series' }),
    ).toBeInTheDocument();

    rerender(
      <CellValuePreview
        field={table}
        value={{
          columns: ['Time', 'Force'],
          rows: [
            [0, 10],
            [1, 12],
          ],
        }}
      />,
    );
    expect(
      screen.getByRole('img', { name: 'Response mini chart · 2 points · 1 series' }),
    ).toBeInTheDocument();
  });

  it('keeps non-XY tables as summaries', () => {
    const table = field('tabular_data');
    expect(
      chartSeriesFromValue(table, {
        columns: ['Time', 'Force', 'Temperature'],
        rows: [[0, 10, 20]],
      }),
    ).toBeUndefined();
    render(
      <CellValuePreview
        field={table}
        value={{
          columns: ['Time', 'Force', 'Temperature'],
          rows: [[0, 10, 20]],
        }}
      />,
    );
    expect(screen.getByText('1 rows × 3 columns')).toBeInTheDocument();
  });

  it('loads referenced XY datasets and renders their preview in the cell', async () => {
    const dataset = field('dataset');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/datasets/dataset-1')) {
        return json({
          name: 'Force sweep',
          dataset_type: 'xy',
          status: 'ready',
          schema: {
            columns: [
              { name: 'time', role: 'x' },
              { name: 'force', role: 'y' },
            ],
          },
        });
      }
      if (url.endsWith('/datasets/dataset-1/preview')) {
        return json({
          items: [
            { time: 0, force: 10 },
            { time: 1, force: 12 },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <CellValuePreview
        base="/workspaces/workspace-1/projects/project-1"
        field={dataset}
        value={['dataset-1']}
      />,
    );
    expect(
      await screen.findByRole('img', { name: 'Response mini chart · 2 points · 1 series' }),
    ).toBeInTheDocument();
  });
});
