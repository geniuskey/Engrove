import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n.js';
import { TasksPage } from './TasksPage.js';

const workspaceId = '019fbcf9-e020-71da-935a-6a6a728b3790';
const projectId = '019fbcf9-e020-71da-935a-6a6a728b3791';

afterEach(() => {
  cleanup();
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

    expect(screen.queryByRole('textbox', { name: 'Task title' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    const dialog = screen.getByRole('dialog', { name: 'Create task' });
    const title = within(dialog).getByRole('textbox', { name: 'Task title' });
    const description = within(dialog).getByRole('textbox', { name: 'Description' });
    fireEvent.change(title, { target: { value: 'Inspect failed sample' } });
    fireEvent.change(description, { target: { value: 'Keep this context for retry' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));

    expect(await screen.findByText('Task was not saved.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Create task' })).toBeInTheDocument();
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
    const card = screen.getByLabelText('시편 확인, 할 일');
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    fireEvent.contextMenu(card, { clientX: 120, clientY: 140 });
    expect(screen.getByRole('menu', { name: '시편 확인' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '작업 제목 복사' })).toBeInTheDocument();
  });

  it('moves a task between status columns with drag and drop', async () => {
    const task = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3798',
      title: 'Move motor review',
      description: 'Review the latest motor result.',
      status: 'todo',
      priority: 'medium',
      assignee_id: null,
      assignee_name: null,
      due_date: null,
      row_version: 1,
      archived_at: null,
      links: [],
    } as const;
    let resolvePatch!: (response: Response) => void;
    const patchResponse = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'PATCH') return patchResponse;
      return json({ items: [task] });
    });

    render(
      <I18nProvider>
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
        </MemoryRouter>
      </I18nProvider>,
    );

    const card = await screen.findByLabelText('Move motor review, To do');
    expect(
      within(card).queryByRole('combobox', { name: 'Status for Move motor review' }),
    ).not.toBeInTheDocument();
    const destination = screen.getByRole('region', { name: 'In progress, tasks: 0' });
    const transferValues = new Map<string, string>();
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      getData: vi.fn((type: string) => transferValues.get(type) ?? ''),
      setData: vi.fn((type: string, value: string) => transferValues.set(type, value)),
    };

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragEnter(destination, { dataTransfer });
    expect(destination).toHaveAttribute('data-drop-active', 'true');
    expect(within(destination).getByText('Drop in In progress')).toBeInTheDocument();
    fireEvent.drop(destination, { dataTransfer });

    expect(within(destination).getByText('Move motor review')).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/tasks/${task.id}`),
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"status":"in_progress"'),
        }),
      ),
    );
    resolvePatch(json({ ...task, status: 'in_progress', row_version: 2 }));
    expect(await screen.findAllByText('Move motor review moved to In progress.')).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'In progress, tasks: 1' })).toBeInTheDocument();
  });

  it('opens a task detail panel from the card and saves edits', async () => {
    const task = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3701',
      title: 'Release readiness review',
      description: 'Review the release evidence.',
      status: 'todo',
      priority: 'high',
      assignee_id: null,
      assignee_name: null,
      due_date: '2026-08-20',
      row_version: 1,
      archived_at: null,
      links: [],
      status_history: [
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3702',
          from_status: null,
          to_status: 'todo',
          changed_at: '2026-08-01T12:00:00.000Z',
          changed_by_name: 'Owner',
        },
      ],
    } as const;
    let patchBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'PATCH') {
        patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({
          ...task,
          title: 'Release decision',
          status: 'in_progress',
          row_version: 2,
          status_history: [
            ...task.status_history,
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3703',
              from_status: 'todo',
              to_status: 'in_progress',
              changed_at: '2026-08-05T12:00:00.000Z',
              changed_by_name: 'Owner',
            },
          ],
        });
      }
      if (url.endsWith(`/tasks/${task.id}`)) return json(task);
      return json({ items: [task] });
    });

    render(
      <I18nProvider>
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
        </MemoryRouter>
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByLabelText('Release readiness review, To do'));
    const dialog = await screen.findByRole('dialog', { name: 'Release readiness review' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'Release decision' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Status' }), {
      target: { value: 'in_progress' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(patchBody).toMatchObject({
        title: 'Release decision',
        status: 'in_progress',
        priority: 'high',
        dueDate: '2026-08-20',
        rowVersion: 1,
      }),
    );
    expect(within(dialog).getByRole('heading', { name: 'Release decision' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'In progress, tasks: 1' })).getByText(
        'Release decision',
      ),
    ).toBeInTheDocument();
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
