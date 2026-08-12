import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n.js';
import { MilestonesPage } from './MilestonesPage.js';

const workspaceId = '019fbcf9-e020-71da-935a-6a6a728b3790';
const projectId = '019fbcf9-e020-71da-935a-6a6a728b3791';
const user = {
  id: '019fbcf9-e020-71da-935a-6a6a728b3792',
  email: 'owner@example.com',
  displayName: 'Owner',
  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3793',
  role: 'owner' as const,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function renderPage(entry = `/workspaces/${workspaceId}/projects/${projectId}/milestones`) {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            element={<MilestonesPage user={user} />}
            path="/workspaces/:workspaceId/projects/:projectId/milestones"
          />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('MilestonesPage', () => {
  it('edits a key project date from the chronological timeline', async () => {
    const linkedTask = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3710',
      task_key: 'QUAL-41',
      title: 'Approve qualification evidence',
      status: 'done',
      status_name: 'Done',
      status_category: 'done',
      archived_at: null,
    } as const;
    const candidate = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3711',
      task_key: 'QUAL-42',
      title: 'Publish release package',
    } as const;
    const milestone = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3701',
      title: 'Release qualification',
      description: 'Complete system qualification.',
      status: 'active',
      target_date: '2099-09-15',
      completed_at: null,
      row_version: 1,
      archived_at: null,
      linked_tasks: [linkedTask],
      task_count: 1,
      completed_task_count: 1,
    } as const;
    let patchBody: Record<string, unknown> | undefined;
    let currentStatus: MilestoneFixture['status'] = milestone.status;
    const requestedUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      requestedUrls.push(url);
      if (init?.method === 'PATCH') {
        patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        currentStatus = 'at_risk';
        return json({ ...milestone, status: currentStatus, row_version: 2 });
      }
      if (url.includes('/task-candidates?')) {
        return json({
          items: url.includes('query=Publish') ? [candidate] : [linkedTask],
          pageInfo: { limit: 20, offset: 0, total: 1, hasNext: false },
        });
      }
      return json(milestonePage([{ ...milestone, status: currentStatus }]));
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Key dates' })).toBeInTheDocument();
    expect(screen.getByLabelText('Key date status summary')).toHaveTextContent(/Active\s*1/);
    const timeline = screen.getByRole('region', { name: 'Key date timeline' });
    expect(within(timeline).getByRole('list')).toBeInTheDocument();
    expect(within(timeline).getByText('9/15/2099')).toBeInTheDocument();
    expect(within(timeline).getByText('Next')).toBeInTheDocument();
    expect(within(timeline).getByLabelText('1 of 1 linked tasks completed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open key date Release qualification' }));
    const dialog = screen.getByRole('dialog', { name: 'Release qualification' });
    expect(within(dialog).getByRole('button', { name: 'Archive' })).toHaveAttribute(
      'title',
      'Archive',
    );
    expect(within(dialog).getAllByText('Required')).toHaveLength(3);
    expect(within(dialog).getAllByText('Optional')).toHaveLength(2);
    expect(
      within(dialog).getByRole('checkbox', { name: /Approve qualification evidence/ }),
    ).toBeChecked();
    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Search project tasks' }), {
      target: { value: 'Publish' },
    });
    fireEvent.click(
      await within(dialog).findByRole('checkbox', { name: /Publish release package/ }),
    );
    expect(requestedUrls).toContain(
      `http://localhost:3000/api/v1/workspaces/${workspaceId}/projects/${projectId}/task-candidates?query=Publish&limit=20`,
    );
    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Search project tasks' }), {
      target: { value: 'Approve' },
    });
    expect(within(dialog).getByRole('checkbox', { name: /Publish release package/ })).toBeChecked();
    fireEvent.change(within(dialog).getByRole('combobox', { name: /Status/ }), {
      target: { value: 'at_risk' },
    });
    expect(within(dialog).queryByLabelText('Start date')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('spinbutton')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save key date' }));

    await waitFor(() =>
      expect(patchBody).toMatchObject({
        title: 'Release qualification',
        status: 'at_risk',
        rowVersion: 1,
        taskIds: [linkedTask.id, candidate.id],
      }),
    );
    expect(patchBody).not.toHaveProperty('progress');
    expect(await within(timeline).findByText('At risk')).toBeInTheDocument();
  });

  it('creates the first key date as persistent project data', async () => {
    const created = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3704',
      title: 'Design freeze',
      description: 'Lock the production design.',
      status: 'planned',
      target_date: '2026-10-01',
      completed_at: null,
      row_version: 1,
      archived_at: null,
      linked_tasks: [],
      task_count: 0,
      completed_task_count: 0,
    } as const;
    let saved = false;
    let postBody: Record<string, unknown> | undefined;
    let postIdempotencyKey = '';
    const requestedUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      requestedUrls.push(url);
      if (init?.method === 'POST') {
        saved = true;
        postBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        postIdempotencyKey = new Headers(init.headers).get('Idempotency-Key') ?? '';
        return json(created);
      }
      return json(milestonePage(saved ? [created] : []));
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add key date' }));
    const dialog = screen.getByRole('dialog', { name: 'Add key date' });
    expect(within(dialog).getAllByText('Required')).toHaveLength(3);
    expect(within(dialog).getAllByText('Optional')).toHaveLength(2);
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Schedule title/ }), {
      target: { value: 'Design freeze' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Date/), {
      target: { value: '2026-10-01' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add key date' }));

    await waitFor(() =>
      expect(postBody).toMatchObject({
        title: 'Design freeze',
        targetDate: '2026-10-01',
        status: 'planned',
        taskIds: [],
      }),
    );
    expect(postBody).not.toHaveProperty('startDate');
    expect(postBody).not.toHaveProperty('progress');
    expect(postIdempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestedUrls.some((url) => url.includes('/task-candidates'))).toBe(false);
    expect(await screen.findByText('Design freeze')).toBeInTheDocument();
    expect(screen.getByText('Key date added.')).toBeInTheDocument();
  });

  it('opens an exact key date from a durable task-detail deep link', async () => {
    const milestone = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3720',
      title: 'Supplier approval',
      description: '',
      status: 'planned',
      target_date: '2026-11-03',
      completed_at: null,
      row_version: 1,
      archived_at: null,
      linked_tasks: [],
      task_count: 0,
      completed_task_count: 0,
    } as const;
    const requestedUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith(`/milestones/${milestone.id}`)) return json(milestone);
      return json(milestonePage([]));
    });

    renderPage(
      `/workspaces/${workspaceId}/projects/${projectId}/milestones?milestone=${milestone.id}`,
    );

    expect(await screen.findByRole('dialog', { name: 'Supplier approval' })).toBeInTheDocument();
    expect(requestedUrls.some((url) => url.endsWith(`/milestones/${milestone.id}`))).toBe(true);
  });

  it('searches and pages the bounded key-date timeline with exact summary counts', async () => {
    const first = keyDate('019fbcf9-e020-71da-935a-6a6a728b3730', 'Concept review', '2099-01-10');
    const second = keyDate(
      '019fbcf9-e020-71da-935a-6a6a728b3731',
      'Production release',
      '2099-02-20',
    );
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('query=Production')) return json(milestonePage([second]));
      if (url.includes('offset=1'))
        return json(
          milestonePage([second], {
            pageInfo: { limit: 50, offset: 1, total: 2, hasNext: false },
          }),
        );
      return json(
        milestonePage([first], {
          pageInfo: { limit: 50, offset: 0, total: 2, hasNext: true },
          summary: { planned: 2, active: 0, atRisk: 0, completed: 0, archived: 0 },
        }),
      );
    });

    renderPage();

    expect(await screen.findByLabelText('Key date status summary')).toHaveTextContent(
      /Planned\s*2/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load more key dates (1 of 2)' }));
    expect(await screen.findByText('Production release')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search key dates' }), {
      target: { value: 'Production' },
    });
    await waitFor(() => expect(urls.some((url) => url.includes('query=Production'))).toBe(true));
    expect(screen.queryByText('Concept review')).not.toBeInTheDocument();
    expect(screen.getByText('Production release')).toBeInTheDocument();
    expect(urls.some((url) => url.includes('archiveState=all&limit=50&offset=0'))).toBe(true);
  });
});

function keyDate(id: string, title: string, targetDate: string): MilestoneFixture {
  return {
    id,
    title,
    description: '',
    status: 'planned',
    target_date: targetDate,
    completed_at: null,
    row_version: 1,
    archived_at: null,
    linked_tasks: [],
    task_count: 0,
    completed_task_count: 0,
  };
}

interface MilestoneFixture {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: 'planned' | 'active' | 'at_risk' | 'completed';
  readonly target_date: string;
  readonly completed_at: string | null;
  readonly row_version: number;
  readonly archived_at: string | null;
  readonly linked_tasks: readonly unknown[];
  readonly task_count: number;
  readonly completed_task_count: number;
}

function milestonePage(
  items: readonly MilestoneFixture[],
  overrides: Partial<{
    pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
    summary: {
      planned: number;
      active: number;
      atRisk: number;
      completed: number;
      archived: number;
    };
    nextMilestoneId: string | null;
  }> = {},
) {
  return {
    items,
    pageInfo: overrides.pageInfo ?? {
      limit: 50,
      offset: 0,
      total: items.length,
      hasNext: false,
    },
    summary: overrides.summary ?? {
      planned: items.filter((item) => !item.archived_at && item.status === 'planned').length,
      active: items.filter((item) => !item.archived_at && item.status === 'active').length,
      atRisk: items.filter((item) => !item.archived_at && item.status === 'at_risk').length,
      completed: items.filter((item) => !item.archived_at && item.status === 'completed').length,
      archived: items.filter((item) => item.archived_at).length,
    },
    nextMilestoneId: overrides.nextMilestoneId ?? items[0]?.id ?? null,
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
