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

function renderPage() {
  return render(
    <I18nProvider>
      <MemoryRouter
        initialEntries={[`/workspaces/${workspaceId}/projects/${projectId}/milestones`]}
      >
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
  it('edits a major project milestone from the timeline', async () => {
    const milestone = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3701',
      title: 'Release qualification',
      description: 'Complete system qualification.',
      status: 'active',
      start_date: '2026-08-01',
      target_date: '2026-09-15',
      progress: 45,
      completed_at: null,
      row_version: 1,
      archived_at: null,
    } as const;
    let patchBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'PATCH') {
        patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({ ...milestone, progress: 70, row_version: 2 });
      }
      return json({ items: [milestone] });
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Milestones' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open milestone Release qualification' }));
    const dialog = screen.getByRole('dialog', { name: 'Release qualification' });
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Progress (%)' }), {
      target: { value: '70' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save milestone' }));

    await waitFor(() =>
      expect(patchBody).toMatchObject({
        title: 'Release qualification',
        status: 'active',
        progress: 70,
        rowVersion: 1,
      }),
    );
    expect(await screen.findByText('70% · 9/15/2026')).toBeInTheDocument();
  });

  it('creates the first milestone as persistent project data', async () => {
    const created = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3704',
      title: 'Design freeze',
      description: 'Lock the production design.',
      status: 'planned',
      start_date: null,
      target_date: '2026-10-01',
      progress: 0,
      completed_at: null,
      row_version: 1,
      archived_at: null,
    } as const;
    let saved = false;
    let postBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') {
        saved = true;
        postBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json(created);
      }
      return json({ items: saved ? [created] : [] });
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Create milestone' }));
    const dialog = screen.getByRole('dialog', { name: 'Create milestone' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Milestone title' }), {
      target: { value: 'Design freeze' },
    });
    fireEvent.change(within(dialog).getByLabelText('Target date'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create milestone' }));

    await waitFor(() =>
      expect(postBody).toMatchObject({
        title: 'Design freeze',
        targetDate: '2026-10-01',
        status: 'planned',
        progress: 0,
      }),
    );
    expect(await screen.findByText('Design freeze')).toBeInTheDocument();
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
