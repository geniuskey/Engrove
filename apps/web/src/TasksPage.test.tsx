import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n.js';
import { TasksPage } from './TasksPage.js';

const workspaceId = '019fbcf9-e020-71da-935a-6a6a728b3790';
const projectId = '019fbcf9-e020-71da-935a-6a6a728b3791';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('TasksPage', () => {
  it('preserves task form values when creation fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') {
        return new Response(
          JSON.stringify({ error: { code: 'REQUEST_FAILED', message: 'Task was not saved.' } }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        );
      }
      return json({ items: [] });
    });

    render(
      <MemoryRouter initialEntries={[`/workspaces/${workspaceId}/projects/${projectId}/tasks`]}>
        <Routes>
          <Route
            element={
              <TasksPage
                user={{
                  id: '019fbcf9-e020-71da-935a-6a6a728b3792',
                  email: 'owner@example.com',
                  displayName: 'Owner',
                  organizationId: '019fbcf9-e020-71da-935a-6a6a728b3793',
                  role: 'owner',
                }}
              />
            }
            path="/workspaces/:workspaceId/projects/:projectId/tasks"
          />
        </Routes>
      </MemoryRouter>,
    );

    const title = screen.getByRole('textbox', { name: 'Task title' });
    const description = screen.getByRole('textbox', { name: 'Description' });
    fireEvent.change(title, { target: { value: 'Inspect failed sample' } });
    fireEvent.change(description, { target: { value: 'Keep this context for retry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    expect(await screen.findByText('Task was not saved.')).toBeInTheDocument();
    await waitFor(() => expect(title).toHaveValue('Inspect failed sample'));
    expect(description).toHaveValue('Keep this context for retry');
  });

  it('localizes task labels and due dates in Korean', async () => {
    window.localStorage.setItem('engrove-locale', 'ko');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({
        items: [
          {
            id: '019fbcf9-e020-71da-935a-6a6a728b3799',
            title: '시편 확인',
            description: '',
            status: 'todo',
            priority: 'high',
            assignee_id: null,
            assignee_name: null,
            due_date: '2026-08-04',
            row_version: 1,
            archived_at: null,
            links: [],
          },
        ],
      }),
    );

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workspaces/${workspaceId}/projects/${projectId}/tasks`]}>
          <Routes>
            <Route
              element={
                <TasksPage
                  user={{
                    id: '019fbcf9-e020-71da-935a-6a6a728b3792',
                    email: 'viewer@example.com',
                    displayName: 'Viewer',
                    organizationId: '019fbcf9-e020-71da-935a-6a6a728b3793',
                    role: 'viewer',
                  }}
                />
              }
              path="/workspaces/:workspaceId/projects/:projectId/tasks"
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: '엔지니어링 작업' })).toBeInTheDocument();
    const expectedDate = new Intl.DateTimeFormat('ko').format(new Date('2026-08-04T00:00:00'));
    expect(screen.getByText(new RegExp(expectedDate.replaceAll('.', '\\.')))).toBeInTheDocument();
    expect(screen.getByText('높음')).toBeInTheDocument();
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
