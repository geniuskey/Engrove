import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { DynamicRecord, FieldDefinition } from './DataPageTypes.js';
import {
  LinkedTasksPanel,
  MeasurementsPanel,
  RecordHistoryPanel,
  SpecificationsPanel,
} from './DataPageViews.js';
import { I18nProvider } from './i18n.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('RecordHistoryPanel', () => {
  it('pages older changes and keeps their exact undo action available', async () => {
    const recent = history('019fbcf9-e020-71da-935a-6a6a728b3780', '2026-08-09T12:00:00Z', 3);
    const older = history('019fbcf9-e020-71da-935a-6a6a728b3781', '2026-08-01T12:00:00Z', 2);
    const urls: string[] = [];
    const onRestored = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (init?.method === 'POST') return json({ ...record, rowVersion: 4 });
      if (url.includes('offset=1'))
        return json({
          items: [older],
          pageInfo: { limit: 50, offset: 1, total: 2, hasNext: false },
        });
      return json({
        items: [recent],
        pageInfo: { limit: 50, offset: 0, total: 2, hasNext: true },
      });
    });

    render(
      <I18nProvider>
        <RecordHistoryPanel
          base="/workspaces/w1234567890abcd/projects/p1234567890abcd"
          objectTypeId="019fbcf9-e020-71da-935a-6a6a728b3792"
          record={record}
          user={user}
          onRestored={onRestored}
        />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Load more history (1 of 2)' }));
    const olderEntry = (await screen.findByText(/version 2/i)).closest('li')!;
    fireEvent.click(within(olderEntry).getByRole('button', { name: 'Undo to here' }));

    await waitFor(() => expect(onRestored).toHaveBeenCalledWith({ ...record, rowVersion: 4 }));
    expect(urls.some((url) => url.includes('history?limit=50&offset=1'))).toBe(true);
    expect(urls.some((url) => url.endsWith(`/history/${older.id}/undo`))).toBe(true);
  });
});

describe('bounded engineering histories', () => {
  it('loads older specifications without replacing the current page', async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('offset=1'))
        return json({
          items: [specification('019fbcf9-e020-71da-935a-6a6a728b3781', 'Older envelope')],
          pageInfo: { limit: 50, offset: 1, total: 2, hasNext: false },
        });
      return json({
        items: [specification('019fbcf9-e020-71da-935a-6a6a728b3780', 'Current envelope')],
        pageInfo: { limit: 50, offset: 0, total: 2, hasNext: true },
      });
    });

    render(
      <I18nProvider>
        <SpecificationsPanel
          base="/workspaces/w123/projects/p123"
          fields={[measurementField]}
          user={user}
        />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Load more history (1 of 2)' }));
    expect(await screen.findByText('Older envelope')).toBeInTheDocument();
    expect(screen.getByText('Current envelope')).toBeInTheDocument();
    expect(urls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('specifications?archiveState=all&limit=50&offset=0'),
        expect.stringContaining('specifications?archiveState=all&limit=50&offset=1'),
      ]),
    );
  });

  it('uses one paged history request across measurement fields and loads older results', async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('offset=1'))
        return json({
          items: [measurement('019fbcf9-e020-71da-935a-6a6a728b3783', '9.8', false)],
          pageInfo: { limit: 50, offset: 1, total: 2, hasNext: false },
        });
      return json({
        items: [measurement('019fbcf9-e020-71da-935a-6a6a728b3782', '12.4', true)],
        pageInfo: { limit: 50, offset: 0, total: 2, hasNext: true },
      });
    });

    render(
      <I18nProvider>
        <MeasurementsPanel
          base="/workspaces/w123/projects/p123"
          fields={[measurementField]}
          recordId="019fbcf9-e020-71da-935a-6a6a728b3784"
          user={user}
        />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Load more history (1 of 2)' }));
    expect((await screen.findAllByText(/9\.8 mm/)).length).toBeGreaterThan(0);
    expect(urls.some((url) => url.includes('specification-evaluations'))).toBe(false);
    expect(urls.some((url) => url.includes('fieldId='))).toBe(false);
    expect(urls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('currentState=all&limit=50&offset=0'),
        expect.stringContaining('currentState=all&limit=50&offset=1'),
      ]),
    );
  });

  it('keeps the selected measurement field and its allowed unit synchronized across submissions', async () => {
    const temperatureField: FieldDefinition = {
      ...measurementField,
      id: '019fbcf9-e020-71da-935a-6a6a728b3785',
      name: 'Temperature',
      key: 'temperature',
      position: 1,
      config: {
        allowedUnits: ['K', 'degC'],
        canonicalUnit: 'K',
        dimension: 'temperature',
      },
    };
    const created: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') {
        created.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return json({ id: '019fbcf9-e020-71da-935a-6a6a728b3786' });
      }
      return json({
        items: [],
        pageInfo: { limit: 50, offset: 0, total: 0, hasNext: false },
      });
    });

    render(
      <I18nProvider>
        <MeasurementsPanel
          base="/workspaces/w123/projects/p123"
          fields={[measurementField, temperatureField]}
          recordId="019fbcf9-e020-71da-935a-6a6a728b3784"
          user={user}
        />
      </I18nProvider>,
    );

    const field = await screen.findByRole('combobox', { name: 'Measurement field' });
    const unit = screen.getByRole('combobox', { name: 'Unit' });
    const measuredAt = document.querySelector<HTMLInputElement>('input[name="measuredAt"]')!;
    expect(field).toHaveValue(measurementField.id);
    expect(unit).toHaveValue('mm');
    expect(measuredAt).not.toHaveValue('');

    fireEvent.change(field, { target: { value: temperatureField.id } });
    expect(unit).toHaveValue('K');
    expect(within(unit).getByRole('option', { name: 'degC' })).toBeInTheDocument();
    fireEvent.change(unit, { target: { value: 'degC' } });
    fireEvent.change(screen.getByLabelText(/Decimal value/), {
      target: { value: '24.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record measurement' }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      fieldId: temperatureField.id,
      value: '24.5',
      unit: 'degC',
    });
    expect(field).toHaveValue(temperatureField.id);
    expect(unit).toHaveValue('degC');

    fireEvent.change(field, { target: { value: measurementField.id } });
    expect(unit).toHaveValue('mm');
    expect(within(unit).queryByRole('option', { name: 'degC' })).not.toBeInTheDocument();
  });

  it('creates one failed-evaluation follow-up and exposes its durable detail link', async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const evaluationId = '019fbcf9-e020-71da-935a-6a6a728b3787';
    const followUp = linkedTask('8', 'FORCE-10');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      requests.push({ method, url });
      if (method === 'POST') return json({ ...followUp, idempotent_replay: false });
      return json({
        items: [
          {
            ...measurement('019fbcf9-e020-71da-935a-6a6a728b3786', '24.0', true),
            evaluation: {
              id: evaluationId,
              measurement_field_id: measurementField.id,
              measurement_result_id: '019fbcf9-e020-71da-935a-6a6a728b3786',
              status: 'fail',
              reason_code: 'above_upper_limit',
              evaluated_at: '2026-08-10T12:00:01Z',
            },
          },
        ],
        pageInfo: { limit: 50, offset: 0, total: 1, hasNext: false },
      });
    });

    render(
      <MemoryRouter>
        <I18nProvider>
          <MeasurementsPanel
            base="/workspaces/w123/projects/p123"
            fields={[measurementField]}
            recordId="019fbcf9-e020-71da-935a-6a6a728b3784"
            user={user}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Create follow-up task' }));
    const taskLink = await screen.findByRole('link', { name: 'Open follow-up task FORCE-10' });
    expect(taskLink).toHaveAttribute('href', '/workspaces/w123/projects/p123/tasks?task=FORCE-10');
    expect(within(taskLink).getByRole('tooltip')).toHaveTextContent('Open follow-up task FORCE-10');
    expect(requests).toContainEqual({
      method: 'POST',
      url: expect.stringContaining(
        `/api/v1/workspaces/w123/projects/p123/specification-evaluations/${evaluationId}/task`,
      ),
    });
    expect(screen.queryByRole('button', { name: 'Create follow-up task' })).not.toBeInTheDocument();
  });
});

describe('bounded linked tasks', () => {
  it('loads linked work in pages and exposes a durable task-detail link', async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      const older = url.includes('offset=1');
      return json({
        items: [linkedTask(older ? '2' : '1', older ? 'FORCE-2' : 'FORCE-1')],
        pageInfo: { limit: 50, offset: older ? 1 : 0, total: 2, hasNext: !older },
      });
    });

    render(
      <MemoryRouter>
        <I18nProvider>
          <LinkedTasksPanel
            base="/workspaces/w123/projects/p123"
            recordId="019fbcf9-e020-71da-935a-6a6a728b3784"
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    const first = await screen.findByRole('link', { name: /FORCE-1.*Linked task 1/ });
    expect(first).toHaveAttribute('href', '/workspaces/w123/projects/p123/tasks?task=FORCE-1');
    fireEvent.click(screen.getByRole('button', { name: 'Load more (1 of 2)' }));
    expect(await screen.findByRole('link', { name: /FORCE-2.*Linked task 2/ })).toBeInTheDocument();
    expect(urls).toEqual([
      expect.stringContaining('archiveState=all&limit=50&offset=0'),
      expect.stringContaining('archiveState=all&limit=50&offset=1'),
    ]);
    expect(urls.every((url) => !url.includes('limit=5000'))).toBe(true);
  });
});

const user = {
  id: '019fbcf9-e020-71da-935a-6a6a728b3793',
  email: 'owner@example.com',
  displayName: 'Owner',
  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3794',
  role: 'owner' as const,
};

const record: DynamicRecord = {
  id: '019fbcf9-e020-71da-935a-6a6a728b3795',
  objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
  contextProjectId: null,
  displayName: 'Qualification sample',
  values: {},
  relations: {},
  fileReferences: {},
  datasetReferences: {},
  measurements: {},
  rowVersion: 3,
  archivedAt: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-09T12:00:00Z',
};

const measurementField: FieldDefinition = {
  id: '019fbcf9-e020-71da-935a-6a6a728b3796',
  objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
  name: 'Displacement',
  key: 'displacement',
  description: '',
  fieldType: 'measurement',
  required: false,
  unique: false,
  position: 0,
  config: { allowedUnits: ['mm'], canonicalUnit: 'mm', dimension: 'length' },
  projectionStatus: 'ready',
};

function specification(id: string, name: string) {
  return {
    id,
    name,
    measurement_field_id: measurementField.id,
    status: 'active',
    revisions: [
      {
        id: `${id}-revision`,
        revision_number: 1,
        lower_limit: '0',
        upper_limit: '20',
        warning_lower_limit: null,
        warning_upper_limit: null,
        canonical_unit: 'mm',
      },
    ],
  };
}

function measurement(id: string, value: string, current: boolean) {
  return {
    id,
    field_id: measurementField.id,
    canonical_value: value,
    canonical_unit: 'mm',
    original_value: value,
    original_unit: 'mm',
    measured_at: '2026-08-10T12:00:00Z',
    supersedes_result_id: current ? null : '019fbcf9-e020-71da-935a-6a6a728b3782',
    current,
    evaluation: null,
  };
}

function linkedTask(suffix: string, key: string) {
  return {
    id: `019fbcf9-e020-71da-935a-6a6a728b378${suffix}`,
    task_key: key,
    title: `Linked task ${suffix}`,
    status: 'todo',
    priority: 'medium',
    due_date: null,
    archived_at: null,
  };
}

function history(id: string, createdAt: string, rowVersion: number) {
  return {
    id,
    action: 'record.updated',
    actorName: 'Ada Engineer',
    createdAt,
    rowVersion,
    undoable: true,
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
