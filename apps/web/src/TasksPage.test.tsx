import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
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
  it('renders project-defined columns and only exposes allowed transitions', async () => {
    const task = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3798',
      title: 'Inspect release evidence',
      description: '',
      status: 'todo',
      priority: 'medium',
      board_position: 1024,
      assignee_id: null,
      assignee_name: null,
      due_date: null,
      row_version: 1,
      archived_at: null,
      links: [],
    };
    const secondTask = {
      ...task,
      id: '019fbcf9-e020-71da-935a-6a6a728b3797',
      title: 'Verify inspection notes',
      board_position: 2048,
    };
    const moveBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith(`/tasks/${secondTask.id}/move`)) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        moveBodies.push(body);
        return json({
          ...secondTask,
          board_position: body.placement === 'top' ? 512 : 3072,
          row_version: moveBodies.length + 1,
        });
      }
      if (url.endsWith('/task-workflow'))
        return json({
          statuses: [
            {
              id: 'todo',
              key: 'todo',
              name: 'To do',
              category: 'todo',
              color: 'slate',
              position: 0,
              wip_limit: 1,
              initial: true,
              row_version: 1,
              task_count: 2,
            },
            {
              id: 'review',
              key: 'quality_review',
              name: 'Quality review',
              category: 'in_progress',
              color: 'violet',
              position: 1,
              initial: false,
              row_version: 1,
              task_count: 0,
            },
            {
              id: 'done',
              key: 'done',
              name: 'Done',
              category: 'done',
              color: 'emerald',
              position: 2,
              initial: false,
              row_version: 1,
              task_count: 0,
            },
          ],
          transitions: [
            {
              id: 'send',
              name: 'Send to quality',
              from_status: 'todo',
              to_status: 'quality_review',
            },
          ],
        });
      return json({ items: url.includes('/task-filters') ? [] : [task, secondTask] });
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

    expect(
      await screen.findByRole('region', { name: 'Quality review, tasks: 0' }),
    ).toBeInTheDocument();
    const card = screen.getByRole('button', { name: 'Inspect release evidence, To do' });
    expect(
      screen.getByText('WIP limit 1 exceeded. Finish or unblock work before adding more.'),
    ).toBeInTheDocument();
    fireEvent.contextMenu(card, { clientX: 50, clientY: 50 });
    expect(screen.getByRole('menuitem', { name: 'Move to Quality review' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Move to Done' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Move to status top' })).toHaveTextContent('Alt+↑');
    expect(screen.getByRole('menuitem', { name: 'Move to status bottom' })).toHaveTextContent(
      'Alt+↓',
    );
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    const secondCard = screen.getByRole('button', {
      name: 'Verify inspection notes, To do',
    });
    expect(secondCard).toHaveAttribute(
      'aria-keyshortcuts',
      'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight',
    );
    fireEvent.contextMenu(secondCard, { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to status top' }));
    await waitFor(() =>
      expect(moveBodies[0]).toEqual({
        status: 'todo',
        beforeTaskId: null,
        placement: 'top',
        rowVersion: 1,
      }),
    );
    expect(await screen.findAllByText('Reordered Verify inspection notes.')).not.toHaveLength(0);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Verify inspection notes, To do' }), {
      key: 'ArrowDown',
      altKey: true,
    });
    await waitFor(() =>
      expect(moveBodies[1]).toEqual({
        status: 'todo',
        beforeTaskId: null,
        rowVersion: 2,
      }),
    );
  });

  it('uses the last-read row version when archiving and restoring a task', async () => {
    const task = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3798',
      task_number: 12,
      task_key: 'FORCE-12',
      title: 'Retire obsolete fixture check',
      description: '',
      status: 'todo',
      priority: 'medium',
      assignee_id: null,
      assignee_name: null,
      due_date: null,
      row_version: 7,
      archived_at: null,
      links: [],
    } as const;
    let archived = false;
    let archiveRequest: { method: string | undefined; body: Record<string, unknown> } | undefined;
    let restoreRequest: { method: string | undefined; body: Record<string, unknown> } | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith(`/tasks/${task.id}/archive`)) {
        archiveRequest = {
          method: init?.method,
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        };
        archived = true;
        return json({ ...task, row_version: 8, archived_at: '2026-08-11T12:00:00.000Z' });
      }
      if (url.endsWith(`/tasks/${task.id}/restore`)) {
        restoreRequest = {
          method: init?.method,
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        };
        archived = false;
        return json({ ...task, row_version: 9, archived_at: null });
      }
      if (url.includes('/tasks?')) {
        const wantsArchived =
          new URL(url, 'http://engrove.test').searchParams.get('archiveState') === 'archived';
        const current = archived
          ? { ...task, row_version: 8, archived_at: '2026-08-11T12:00:00.000Z' }
          : task;
        const items = wantsArchived === archived ? [current] : [];
        return json({
          items,
          pageInfo: { limit: 100, offset: 0, total: items.length, hasNext: false },
        });
      }
      return json({ items: [] });
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

    const card = await screen.findByRole('button', {
      name: 'Retire obsolete fixture check, To do',
    });
    fireEvent.contextMenu(card);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive task' }));
    await waitFor(() =>
      expect(archiveRequest).toEqual({
        method: 'PATCH',
        body: { reason: 'Archived from task context menu', rowVersion: 7 },
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    await waitFor(() =>
      expect(restoreRequest).toEqual({ method: 'POST', body: { rowVersion: 8 } }),
    );
  });

  it('opens project flow insights with aging, WIP, and cycle-time drill-downs', async () => {
    let insightsRequest = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/task-flow-insights')) {
        insightsRequest = url;
        return json({
          calculated_at: '2026-08-11T12:00:00.000Z',
          window_days: url.includes('windowDays=60') ? 60 : 30,
          stale_after_days: 7,
          summary: {
            active_count: 4,
            wip_count: 2,
            stale_count: 2,
            completed_count: 6,
            average_cycle_hours: 52,
            median_cycle_hours: 48,
            p85_cycle_hours: 72,
          },
          statuses: [
            {
              key: 'todo',
              name: 'To do',
              category: 'todo',
              color: 'slate',
              position: 0,
              current_count: 2,
              wip_limit: null,
              average_age_hours: 36,
              oldest_age_hours: 48,
              stale_count: 0,
            },
            {
              key: 'in_progress',
              name: 'In progress',
              category: 'in_progress',
              color: 'sky',
              position: 1,
              current_count: 2,
              wip_limit: 1,
              average_age_hours: 192,
              oldest_age_hours: 240,
              stale_count: 2,
            },
            {
              key: 'done',
              name: 'Done',
              category: 'done',
              color: 'emerald',
              position: 2,
              current_count: 6,
              wip_limit: null,
              average_age_hours: null,
              oldest_age_hours: null,
              stale_count: 0,
            },
          ],
          flow_statuses: [
            { key: 'todo', name: 'To do', color: 'slate', position: 0, archived: false },
            {
              key: 'in_progress',
              name: 'In progress',
              color: 'sky',
              position: 1,
              archived: false,
            },
            { key: 'done', name: 'Done', color: 'emerald', position: 2, archived: false },
          ],
          flow_series: [
            { date: '2026-08-09', counts: { todo: 2, in_progress: 0, done: 0 } },
            { date: '2026-08-10', counts: { todo: 1, in_progress: 2, done: 1 } },
            { date: '2026-08-11', counts: { todo: 2, in_progress: 2, done: 6 } },
          ],
          throughput_series: [
            { date: '2026-08-09', created_count: 3, completed_count: 1 },
            { date: '2026-08-10', created_count: 1, completed_count: 2 },
            { date: '2026-08-11', created_count: 4, completed_count: 3 },
          ],
          aging_tasks: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3701',
              task_key: 'FLOW-3',
              title: 'Unblock chamber calibration',
              status: 'in_progress',
              status_name: 'In progress',
              assignee_name: 'Owner',
              age_hours: 240,
            },
          ],
          completed_tasks: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3702',
              task_key: 'FLOW-2',
              title: 'Publish qualification result',
              completed_at: '2026-08-10T12:00:00.000Z',
              cycle_time_hours: 72,
            },
          ],
        });
      }
      if (url.endsWith('/task-workflow'))
        return json({
          statuses: [
            {
              id: 'todo',
              key: 'todo',
              name: 'To do',
              category: 'todo',
              color: 'slate',
              position: 0,
              wip_limit: null,
              initial: true,
              row_version: 1,
              task_count: 2,
            },
            {
              id: 'progress',
              key: 'in_progress',
              name: 'In progress',
              category: 'in_progress',
              color: 'sky',
              position: 1,
              wip_limit: 1,
              initial: false,
              row_version: 1,
              task_count: 2,
            },
            {
              id: 'done',
              key: 'done',
              name: 'Done',
              category: 'done',
              color: 'emerald',
              position: 2,
              wip_limit: null,
              initial: false,
              row_version: 1,
              task_count: 6,
            },
          ],
          transitions: [],
        });
      return json({ items: [], pageInfo: { limit: 100, offset: 0, total: 0, hasNext: false } });
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

    fireEvent.click(screen.getByRole('button', { name: 'Flow insights' }));
    const panel = await screen.findByRole('region', { name: 'Flow insights' });
    expect(within(panel).getByText('Median cycle time')).toBeInTheDocument();
    expect(within(panel).getByText('2d')).toBeInTheDocument();
    expect(within(panel).getByText('85th percentile')).toBeInTheDocument();
    expect(within(panel).getByText('3d')).toBeInTheDocument();
    expect(
      within(panel).getByRole('img', { name: 'Cumulative flow for the past 30 days' }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole('img', {
        name: 'Created versus completed over the past 30 days: 8 created and 6 completed',
      }),
    ).toBeInTheDocument();
    expect(within(panel).getByText('Net +2')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Done: 6 tasks on the latest day')).toBeInTheDocument();
    expect(
      within(panel).getByLabelText('In progress: 2 tasks, average age 8d'),
    ).toBeInTheDocument();
    expect(within(panel).getByText('Unblock chamber calibration')).toBeInTheDocument();
    expect(
      within(panel).getByRole('listitem', { name: 'FLOW-2, cycle time 3d' }),
    ).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText('Flow insight window'), {
      target: { value: '60' },
    });
    await waitFor(() => expect(insightsRequest).toContain('windowDays=60'));
  });

  it('selects a contiguous visible task range with Shift by pointer or keyboard', async () => {
    const rangeTasks = ['Prepare specimen', 'Run inspection', 'Review evidence'].map(
      (title, index) => ({
        id: `019fbcf9-e020-71da-935a-6a6a728b37${10 + index}`,
        task_number: 30 + index,
        task_key: `TEST-${30 + index}`,
        title,
        description: '',
        status: 'todo',
        priority: 'medium' as const,
        assignee_id: null,
        assignee_name: null,
        due_date: null,
        row_version: 1,
        archived_at: null,
        links: [],
      }),
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/task-workflow'))
        return json({
          statuses: [
            {
              id: 'todo',
              key: 'todo',
              name: 'To do',
              category: 'todo',
              color: 'slate',
              position: 0,
              wip_limit: null,
              initial: true,
              row_version: 1,
              task_count: rangeTasks.length,
            },
          ],
          transitions: [],
        });
      if (url.includes('/tasks?'))
        return json({
          items: url.includes('archiveState=archived') ? [] : rangeTasks,
          pageInfo: { limit: 100, offset: 0, total: rangeTasks.length, hasNext: false },
        });
      return json({ items: [] });
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

    await screen.findByRole('button', { name: 'Prepare specimen, To do' });
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select multiple tasks' }));
    const first = screen.getByRole('checkbox', { name: 'Prepare specimen, To do' });
    const third = screen.getByRole('checkbox', { name: 'Review evidence, To do' });
    fireEvent.click(first);
    fireEvent.click(third, { shiftKey: true });
    expect(screen.getByText('3 tasks selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear task selection' }));
    fireEvent.click(third);
    first.focus();
    fireEvent.keyDown(first, { key: ' ', shiftKey: true });
    expect(screen.getByText('3 tasks selected')).toBeInTheDocument();
  });

  it('offers a dense keyboard-navigable list that opens the existing task detail', async () => {
    const first = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3701',
      task_key: 'TEST-21',
      title: 'Review rotor evidence',
      description: 'Confirm traceability.',
      status: 'todo',
      priority: 'high' as const,
      labels: ['evidence'],
      parent_task_id: null,
      parent_task_key: null,
      parent_task_title: null,
      child_count: 1,
      child_done_count: 0,
      board_position: 10,
      assignee_id: null,
      assignee_name: null,
      due_date: '2026-08-12',
      row_version: 1,
      archived_at: null,
      links: [],
    };
    const second = {
      ...first,
      id: '019fbcf9-e020-71da-935a-6a6a728b3702',
      task_key: 'TEST-22',
      title: 'Attach inspection notes',
      priority: 'medium' as const,
      parent_task_id: first.id,
      parent_task_key: first.task_key,
      parent_task_title: first.title,
      child_count: 0,
      due_date: null,
    };
    const detailBase = {
      status_history: [],
      change_history: [],
      watchers: [],
      watcher_count: 0,
      watching: false,
      comments: [],
      relationships: [],
      link_history: [],
      children: [],
    };
    let activeTaskRequest = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith(`/tasks/${first.task_key}`)) return json({ ...first, ...detailBase });
      if (url.endsWith(`/tasks/${second.task_key}`)) return json({ ...second, ...detailBase });
      if (url.endsWith('/notifications/preferences')) return json({ autoWatchCommented: false });
      if (url.endsWith('/task-workflow'))
        return json({
          statuses: [
            {
              id: 'todo',
              key: 'todo',
              name: 'To do',
              category: 'todo',
              color: 'slate',
              position: 0,
              wip_limit: null,
              initial: true,
              row_version: 1,
              task_count: 2,
            },
          ],
          transitions: [],
        });
      if (url.includes('/tasks?')) {
        if (url.includes('archiveState=active')) activeTaskRequest = url;
        return json({ items: url.includes('archiveState=archived') ? [] : [first, second] });
      }
      return json({ items: [] });
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
          <LocationProbe />
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByRole('button', { name: 'Review rotor evidence, To do' });
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    await waitFor(() => {
      expect(activeTaskRequest).toContain('hasDueDate=true');
      expect(activeTaskRequest).toContain('sort=dueDate&direction=asc');
      expect(activeTaskRequest).toContain('limit=100');
    });
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => {
      expect(activeTaskRequest).toContain('limit=100');
      expect(activeTaskRequest).toContain('sort=rank&direction=asc');
    });
    const titleSort = screen.getByRole('button', { name: 'Sort by Task title' });
    fireEvent.click(titleSort);
    await waitFor(() => expect(activeTaskRequest).toContain('sort=title&direction=asc'));
    fireEvent.click(titleSort);
    await waitFor(() => expect(activeTaskRequest).toContain('sort=title&direction=desc'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore manual rank order' }));
    await waitFor(() => expect(activeTaskRequest).toContain('sort=rank&direction=asc'));
    fireEvent.click(screen.getByRole('button', { name: 'Configure list columns' }));
    const columnEditor = screen.getByRole('dialog', { name: 'List columns' });
    fireEvent.click(within(columnEditor).getByRole('checkbox', { name: 'Hide Assignee' }));
    expect(screen.queryByRole('button', { name: 'Sort by Assignee' })).not.toBeInTheDocument();
    fireEvent.click(within(columnEditor).getByRole('button', { name: 'Move Due date left' }));
    fireEvent.click(within(columnEditor).getByRole('button', { name: 'Move Due date left' }));
    expect(
      within(screen.getByRole('region', { name: 'List' }))
        .getAllByRole('button')
        .slice(0, 4)
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Sort by Task title', 'Sort by Due date', 'Sort by Status', 'Sort by Priority']);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'List columns' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Group tasks' }), {
      target: { value: 'status' },
    });
    const todoGroup = screen.getByRole('button', { name: 'To do, 2 tasks' });
    expect(todoGroup).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(todoGroup);
    expect(
      screen.queryByRole('button', { name: 'Review rotor evidence, To do' }),
    ).not.toBeInTheDocument();
    fireEvent.click(todoGroup);
    fireEvent.click(screen.getByRole('button', { name: 'Select multiple tasks' }));
    const firstSelection = screen.getByRole('checkbox', {
      name: 'Review rotor evidence, To do',
    });
    const secondSelection = screen.getByRole('checkbox', {
      name: 'Attach inspection notes, To do',
    });
    fireEvent.click(firstSelection);
    secondSelection.focus();
    fireEvent.keyDown(secondSelection, { key: ' ' });
    expect(screen.getByText('2 tasks selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Exit task selection' }));
    const firstRow = screen.getByRole('button', {
      name: 'Review rotor evidence, To do',
    });
    const secondRow = screen.getByRole('button', {
      name: 'Attach inspection notes, To do',
    });
    firstRow.focus();
    fireEvent.keyDown(firstRow, { key: 'j' });
    expect(secondRow).toHaveFocus();
    fireEvent.keyDown(secondRow, { key: 'Enter' });
    expect(
      await screen.findByRole('dialog', { name: 'Attach inspection notes' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(`?task=${second.task_key}`);
    const secondDialog = screen.getByRole('dialog', { name: 'Attach inspection notes' });
    expect(within(secondDialog).getByRole('button', { name: 'Previous' })).toBeEnabled();
    expect(within(secondDialog).getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.keyDown(window, { altKey: true, key: 'ArrowUp' });
    const firstDialog = await screen.findByRole('dialog', { name: first.title });
    expect(screen.getByTestId('location')).toHaveTextContent(`?task=${first.task_key}`);
    fireEvent.change(within(firstDialog).getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'Unsaved review note' },
    });
    const confirmNavigation = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.keyDown(window, { altKey: true, key: 'ArrowDown' });
    expect(confirmNavigation).toHaveBeenCalledWith(
      'Discard unsaved task changes and drafts? This cannot be undone.',
    );
    expect(screen.getByTestId('location')).toHaveTextContent(`?task=${first.task_key}`);
    confirmNavigation.mockReturnValue(true);
    fireEvent.keyDown(window, { altKey: true, key: 'ArrowDown' });
    expect(await screen.findByRole('dialog', { name: second.title })).toBeInTheDocument();
  });

  it('pages each board column independently and sends filters to the bounded task API', async () => {
    const task = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3798',
      title: 'Deep inspection',
      description: 'Evidence beyond the initial board window',
      status: 'todo',
      priority: 'high',
      visibility: 'project',
      labels: ['safety'],
      assignee_id: null,
      assignee_name: null,
      due_date: null,
      row_version: 1,
      archived_at: null,
      links: [],
    };
    let filteredRequest = '';
    let continuationRequest = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/task-workflow'))
        return json({
          statuses: [
            {
              id: 'todo',
              key: 'todo',
              name: 'To do',
              category: 'todo',
              color: 'slate',
              position: 0,
              wip_limit: null,
              initial: true,
              row_version: 1,
              task_count: 1,
            },
            {
              id: 'done',
              key: 'done',
              name: 'Done',
              category: 'done',
              color: 'emerald',
              position: 1,
              wip_limit: null,
              initial: false,
              row_version: 1,
              task_count: 0,
            },
          ],
          transitions: [],
        });
      if (url.endsWith('/task-filters') || url.includes('/task-assignees'))
        return json({ items: [] });
      if (url.endsWith('/task-labels')) return json({ items: [{ value: 'safety', count: 1 }] });
      if (url.includes('/tasks?')) {
        if (url.includes('archiveState=archived'))
          return json({
            items: [],
            pageInfo: { limit: 100, offset: 0, total: 0, hasNext: false },
          });
        if (url.includes('query=Deep') && url.includes('archiveState=active'))
          filteredRequest = url;
        if (url.includes('offset=1')) continuationRequest = url;
        const isTodo = url.includes('status=todo');
        const isContinuation = url.includes('offset=1');
        return json({
          items: isTodo && !isContinuation ? [task] : [],
          pageInfo: url.includes('query=Deep')
            ? { limit: 50, offset: 0, total: isTodo ? 1 : 0, hasNext: false }
            : {
                limit: 50,
                offset: isContinuation ? 1 : 0,
                total: isTodo ? 51 : 0,
                hasNext: isTodo && !isContinuation,
              },
        });
      }
      return json({ items: [] });
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

    fireEvent.click(await screen.findByRole('button', { name: 'Load more (1 of 51)' }));
    await waitFor(() => {
      expect(continuationRequest).toContain('limit=50');
      expect(continuationRequest).toContain('offset=1');
      expect(continuationRequest).toContain('status=todo');
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by label' }), {
      target: { value: 'safety' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by status' }), {
      target: { value: 'open' },
    });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), {
      target: { value: 'Deep' },
    });
    await waitFor(() => {
      expect(filteredRequest).toContain('query=Deep');
      expect(filteredRequest).toContain('archiveState=active');
      expect(filteredRequest).toContain('limit=50');
      expect(filteredRequest).toContain('label=safety');
      expect(filteredRequest).toContain('status=todo');
      expect(filteredRequest).not.toContain('status=done');
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load more (1 of 51)' })).not.toBeInTheDocument(),
    );
  });

  it('shows a recoverable error instead of an empty board when loading fails', async () => {
    let attempts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: { message: 'Tasks are unavailable.' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      return json({ items: [] });
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

    expect(await screen.findByText('Tasks are unavailable.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /To do, tasks/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'To do, tasks: 0' })).toBeInTheDocument();
  });

  it('preserves task form values when creation fails', async () => {
    const idempotencyKeys: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') {
        idempotencyKeys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
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
    expect(within(dialog).queryByText('Linked entity ID')).not.toBeInTheDocument();
    fireEvent.change(title, { target: { value: 'Inspect failed sample' } });
    fireEvent.change(description, { target: { value: 'Keep this context for retry' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));

    expect(await screen.findByText('Task was not saved.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Create task' })).toBeInTheDocument();
    await waitFor(() => expect(title).toHaveValue('Inspect failed sample'));
    expect(description).toHaveValue('Keep this context for retry');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(idempotencyKeys).toHaveLength(2));
    expect(idempotencyKeys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
  });

  it('opens an editable duplicate draft and atomically links the new task to its source', async () => {
    const sourceId = '019fbcf9-e020-71da-935a-6a6a728b3701';
    const cloneId = '019fbcf9-e020-71da-935a-6a6a728b3702';
    const assigneeId = '019fbcf9-e020-71da-935a-6a6a728b3703';
    const parentId = '019fbcf9-e020-71da-935a-6a6a728b3704';
    const source = {
      id: sourceId,
      task_number: 8,
      task_key: 'FORCE-8',
      title: 'Document cyclic response',
      description: 'Capture the acceptance criteria.',
      status: 'in_progress',
      priority: 'high',
      labels: ['safety', 'supplier'],
      parent_task_id: parentId,
      parent_task_key: 'FORCE-1',
      parent_task_title: 'Release readiness',
      child_count: 0,
      child_done_count: 0,
      board_position: 1024,
      assignee_id: assigneeId,
      assignee_name: 'Ada Engineer',
      due_date: '2026-08-20',
      original_estimate_minutes: 120,
      remaining_estimate_minutes: 90,
      time_spent_minutes: 30,
      row_version: 1,
      archived_at: null,
      links: [],
    };
    const clone = {
      ...source,
      id: cloneId,
      task_number: 9,
      task_key: 'FORCE-9',
      title: 'Copy of Document cyclic response',
      status: 'todo',
      row_version: 1,
      status_history: [],
      change_history: [],
      link_history: [],
      comments: [],
      watchers: [],
      watcher_count: 1,
      watching: true,
      relationships: [
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3705',
          related_task_id: sourceId,
          related_task_key: 'FORCE-8',
          related_task_title: source.title,
          related_task_status: source.status,
          related_task_archived_at: null,
          relation_type: 'relates_to',
          direction: 'outward',
        },
      ],
    };
    let createBody: Record<string, unknown> | undefined;
    let createKey = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/task-assignees'))
        return json({
          items: [{ id: assigneeId, displayName: 'Ada Engineer', email: 'ada@example.com' }],
        });
      if (url.endsWith(`/tasks/${source.task_key}`))
        return json({
          ...source,
          status_history: [],
          change_history: [],
          link_history: [],
          comments: [],
          watchers: [],
          watcher_count: 0,
          watching: false,
          relationships: [],
        });
      if (url.endsWith(`/tasks/${clone.task_key}`)) return json(clone);
      if (url.endsWith('/tasks') && init?.method === 'POST') {
        createBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        createKey = new Headers(init.headers).get('Idempotency-Key') ?? '';
        return json({ ...clone, idempotent_replay: false });
      }
      if (url.includes('/tasks?')) return json({ items: createBody ? [source, clone] : [source] });
      return json({ items: [] });
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

    const card = await screen.findByRole('button', {
      name: 'Document cyclic response, In progress',
    });
    fireEvent.contextMenu(card);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate task' }));
    const dialog = screen.getByRole('dialog', { name: 'Duplicate task' });
    expect(
      within(dialog).getByText('Based on FORCE-8 · Document cyclic response'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Task title' })).toHaveValue(
      'Copy of Document cyclic response',
    );
    expect(within(dialog).getByRole('textbox', { name: 'Description' })).toHaveValue(
      source.description,
    );
    expect(within(dialog).getByRole('textbox', { name: /^Labels/ })).toHaveValue(
      'safety, supplier',
    );
    expect(within(dialog).getByRole('combobox', { name: 'Priority' })).toHaveValue('high');
    expect(within(dialog).getByLabelText(/^Due date/)).toHaveValue('2026-08-20');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create duplicate' }));
    await waitFor(() => expect(createBody).toBeDefined());
    expect(createBody).toMatchObject({
      title: 'Copy of Document cyclic response',
      description: source.description,
      priority: 'high',
      labels: ['safety', 'supplier'],
      parentTaskId: parentId,
      assigneeId,
      dueDate: '2026-08-20',
      cloneSourceTaskId: sourceId,
      links: [],
    });
    expect(createBody).not.toHaveProperty('status');
    expect(createKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByRole('dialog', { name: clone.title })).toBeInTheDocument();
  });

  it('localizes task labels and due dates in Korean', async () => {
    window.localStorage.setItem('engrove-locale', 'ko');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json({
        items: [
          {
            id: '019fbcf9-e020-71da-935a-6a6a728b3799',
            task_number: 7,
            task_key: 'MOTOR-7',
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
    const card = screen.getByRole('button', { name: '시편 확인, 할 일' });
    expect(within(card).getByText('MOTOR-7')).toBeInTheDocument();
    expect(within(card).getByText('높음')).toBeInTheDocument();
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    fireEvent.contextMenu(card, { clientX: 120, clientY: 140 });
    expect(screen.getByRole('menu', { name: '시편 확인' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '작업 제목 복사' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '작업 키 복사' })).toBeInTheDocument();
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
    let resolveMove!: (response: Response) => void;
    let moved = false;
    let refreshedAfterMove = false;
    const moveResponse = new Promise<Response>((resolve) => {
      resolveMove = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (init?.method === 'POST') return moveResponse;
      const url = String(input);
      if (url.includes('/tasks?')) {
        const parameters = new URL(url, 'http://engrove.test').searchParams;
        if (parameters.get('archiveState') === 'archived')
          return json({
            items: [],
            pageInfo: { limit: 100, offset: 0, total: 0, hasNext: false },
          });
        const currentTask = moved
          ? { ...task, status: 'in_progress', board_position: 2048, row_version: 2 }
          : task;
        const requestedStatus = parameters.get('status');
        const items = requestedStatus === currentTask.status ? [currentTask] : [];
        if (moved && parameters.get('archiveState') === 'active') refreshedAfterMove = true;
        return json({
          items,
          pageInfo: {
            limit: 50,
            offset: 0,
            total: !moved && requestedStatus === 'todo' ? 51 : items.length,
            hasNext: !moved && requestedStatus === 'todo',
          },
        });
      }
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

    const card = await screen.findByRole('button', { name: 'Move motor review, To do' });
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
        expect.stringContaining(`/tasks/${task.id}/move`),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"status":"in_progress"'),
        }),
      ),
    );
    moved = true;
    resolveMove(json({ ...task, status: 'in_progress', board_position: 2048, row_version: 2 }));
    expect(await screen.findAllByText('Move motor review moved to In progress.')).toHaveLength(2);
    await waitFor(() => expect(refreshedAfterMove).toBe(true));
    expect(screen.getByRole('region', { name: 'In progress, tasks: 1' })).toBeInTheDocument();
  });

  it('persists a task rank when dropping a card before another card', async () => {
    const first = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3781',
      title: 'Review first',
      description: '',
      status: 'todo',
      priority: 'medium',
      board_position: 1024,
      assignee_id: null,
      assignee_name: null,
      due_date: null,
      row_version: 1,
      archived_at: null,
      links: [],
    } as const;
    const second = {
      ...first,
      id: '019fbcf9-e020-71da-935a-6a6a728b3782',
      title: 'Review second',
      board_position: 2048,
    } as const;
    let moveBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith(`/tasks/${second.id}/move`) && init?.method === 'POST') {
        moveBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({ ...second, board_position: 512, row_version: 2 });
      }
      if (url.includes('/tasks?')) return json({ items: [first, second] });
      return json({ items: [] });
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

    const firstCard = await screen.findByRole('button', { name: 'Review first, To do' });
    const secondCard = screen.getByRole('button', { name: 'Review second, To do' });
    const values = new Map<string, string>();
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      getData: vi.fn((type: string) => values.get(type) ?? ''),
      setData: vi.fn((type: string, value: string) => values.set(type, value)),
    };
    fireEvent.dragStart(secondCard, { dataTransfer });
    fireEvent.dragEnter(firstCard, { dataTransfer });
    fireEvent.drop(firstCard, { dataTransfer });

    await waitFor(() =>
      expect(moveBody).toEqual({
        status: 'todo',
        beforeTaskId: first.id,
        rowVersion: 1,
      }),
    );
    const cards = within(screen.getByRole('region', { name: 'To do, tasks: 2' })).getAllByRole(
      'button',
    );
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
      'Review second, To do',
      'Review first, To do',
    ]);
  });

  it('filters the board and assigns an active member when creating a task', async () => {
    const adaId = '019fbcf9-e020-71da-935a-6a6a728b3710';
    const createdTaskId = '019fbcf9-e020-71da-935a-6a6a728b3713';
    const assignedTask = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3711',
      title: 'Calibrate force rig',
      description: 'Prepare the calibration evidence.',
      status: 'todo',
      priority: 'high',
      assignee_id: adaId,
      assignee_name: 'Ada Engineer',
      due_date: null,
      row_version: 1,
      archived_at: null,
      links: [],
    } as const;
    const unassignedTask = {
      ...assignedTask,
      id: '019fbcf9-e020-71da-935a-6a6a728b3712',
      title: 'Write validation report',
      description: '',
      priority: 'low',
      assignee_id: null,
      assignee_name: null,
    } as const;
    let createBody: Record<string, unknown> | undefined;
    let createIdempotencyKey = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/tasks/FORCE-3'))
        return json({
          ...assignedTask,
          id: createdTaskId,
          task_key: 'FORCE-3',
          title: 'Review calibration result',
          parent_task_id: assignedTask.id,
          parent_task_key: 'FORCE-1',
          parent_task_title: assignedTask.title,
          status_history: [],
          change_history: [],
          watchers: [],
          watcher_count: 0,
          watching: false,
          comments: [],
          relationships: [],
          link_history: [],
          children: [],
        });
      if (url.includes('/task-candidates?')) {
        return json({
          items: [
            {
              id: assignedTask.id,
              task_key: 'FORCE-1',
              title: assignedTask.title,
              parent_task_id: null,
              child_count: 0,
            },
          ],
          pageInfo: { limit: 20, offset: 0, total: 1, hasNext: false },
        });
      }
      if (url.includes('/task-assignees')) {
        return json({
          items: [{ id: adaId, displayName: 'Ada Engineer', email: 'ada@example.com' }],
        });
      }
      if (init?.method === 'POST') {
        createBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        createIdempotencyKey = new Headers(init.headers).get('Idempotency-Key') ?? '';
        return json({
          ...assignedTask,
          id: createdTaskId,
          task_key: 'FORCE-3',
          title: 'Review calibration result',
        });
      }
      return json({ items: [assignedTask, unassignedTask] });
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

    const assignedCard = await screen.findByRole('button', {
      name: 'Calibrate force rig, To do',
    });
    expect(within(assignedCard).getByLabelText('Assigned to Ada Engineer')).toHaveAttribute(
      'title',
      'Assigned to Ada Engineer',
    );
    fireEvent.focus(screen.getByRole('combobox', { name: 'Filter by assignee' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Unassigned' }));
    expect(screen.queryByText('Calibrate force rig')).not.toBeInTheDocument();
    expect(screen.getByText('Write validation report')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear task filters' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), {
      target: { value: 'calibration evidence' },
    });
    expect(screen.getByText('Calibrate force rig')).toBeInTheDocument();
    expect(screen.queryByText('Write validation report')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    const dialog = screen.getByRole('dialog', { name: 'Create task' });
    const assignee = await within(dialog).findByRole('combobox', { name: 'Assignee' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'Review calibration result' },
    });
    expect(within(dialog).getByText('Unsaved draft')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task title' }), {
      target: { value: '' },
    });
    expect(within(dialog).queryByText('Unsaved draft')).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'Review calibration result' },
    });
    const discardCreator = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close task creator' }));
    expect(discardCreator).toHaveBeenCalledWith('Discard this unsaved task draft?');
    expect(screen.getByRole('dialog', { name: 'Create task' })).toBeInTheDocument();
    fireEvent.focus(assignee);
    fireEvent.click(await screen.findByRole('option', { name: /Ada Engineer/ }));
    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Search Parent task' }), {
      target: { value: 'Calibrate' },
    });
    fireEvent.click(await within(dialog).findByRole('button', { name: /FORCE-1.*Calibrate/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(createBody).toBeDefined());
    expect(createBody).toMatchObject({
      title: 'Review calibration result',
      assigneeId: adaId,
      parentTaskId: assignedTask.id,
    });
    expect(createIdempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      await screen.findByRole('dialog', { name: 'Review calibration result' }),
    ).toBeInTheDocument();
  });

  it('opens a task detail panel from the card and saves edits', async () => {
    const task = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3701',
      task_key: 'FORCE-1',
      title: 'Release readiness review',
      description: 'Review the release evidence.',
      status: 'todo',
      priority: 'high',
      labels: ['safety'],
      assignee_id: null,
      assignee_name: null,
      due_date: '2026-08-20',
      original_estimate_minutes: 120,
      remaining_estimate_minutes: 90,
      time_spent_minutes: 30,
      row_version: 1,
      archived_at: null,
      created_by_name: 'Owner',
      created_at: '2026-08-01T12:00:00.000Z',
      updated_at: '2026-08-03T15:30:00.000Z',
      links: [
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3716',
          entity_type: 'sample',
          entity_id: '019fbcf9-e020-71da-935a-6a6a728b3717',
          title: 'Qualification Sample 42',
          detail: 'Sample',
          object_type_public_id: 't00000000000001',
          archived_at: null,
        },
      ],
      status_history: [
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3702',
          from_status: null,
          to_status: 'todo',
          changed_at: '2026-08-01T12:00:00.000Z',
          changed_by_name: 'Owner',
        },
      ],
      change_history: [
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3704',
          action: 'task.automated',
          changed_by_name: 'Owner',
          changed_at: '2026-08-02T12:00:00.000Z',
          automation_rule_name: 'Escalate readiness',
          changes: [
            {
              field: 'priority',
              from: 'medium',
              to: 'high',
              changed: true,
            },
          ],
        },
      ],
      link_history: [],
      linked_key_dates: [
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3715',
          title: 'Production release',
          status: 'active',
          target_date: '2026-09-01',
          archived_at: null,
        },
      ],
      worklogs: [],
      worklog_page_info: { limit: 20, offset: 0, total: 0, hasNext: false },
    } as const;
    let patchBody: Record<string, unknown> | undefined;
    let worklogBody: Record<string, unknown> | undefined;
    let externalLinkBody: Record<string, unknown> | undefined;
    let fileLinkBody: Record<string, unknown> | undefined;
    const attachmentFileId = '019fbcf9-e020-71da-935a-6a6a728b3718';
    let watchRequested = false;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith(`/tasks/${task.task_key}/visibility`))
        return json({ visibility: 'project', rowVersion: 1, members: [], groups: [] });
      if (url.includes('/task-visibility-groups'))
        return json({
          items: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3721',
              name: 'Security reviewers',
              color: 'violet',
            },
          ],
        });
      if (url === 'https://storage.example/task-attachment' && init?.method === 'PUT')
        return new Response(null, { status: 200 });
      if (url.endsWith('/file-upload-sessions') && init?.method === 'POST')
        return json({
          uploadId: '019fbcf9-e020-71da-935a-6a6a728b3717',
          uploadUrl: 'https://storage.example/task-attachment',
          headers: { 'content-type': 'application/pdf' },
        });
      if (url.endsWith('/file-upload-sessions/019fbcf9-e020-71da-935a-6a6a728b3717/complete'))
        return json({ id: attachmentFileId });
      if (url.endsWith(`/tasks/${task.id}/file-links`) && init?.method === 'POST') {
        fileLinkBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({
          ...task,
          links: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3719',
              entity_type: 'file',
              entity_id: attachmentFileId,
              created_at: '2026-08-03T13:00:00.000Z',
              title: 'release-note.pdf',
              content_type: 'application/pdf',
              size_bytes: 6,
              file_series_name: 'release-note.pdf',
              file_version_number: 1,
              file_status: 'available',
              archived_at: null,
            },
          ],
        });
      }
      if (url.endsWith(`/tasks/${task.id}/watch`) && init?.method === 'POST') {
        watchRequested = true;
        return json({
          ...task,
          watchers: [],
          watcher_count: 1,
          watching: true,
          comments: [],
          relationships: [],
        });
      }
      if (url.endsWith(`/tasks/${task.id}/external-links`) && init?.method === 'POST') {
        externalLinkBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({
          ...task,
          links: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3705',
              entity_type: 'external_source',
              entity_id: '019fbcf9-e020-71da-935a-6a6a728b3706',
              created_at: '2026-08-03T12:00:00.000Z',
              title: 'Supplier release report',
              provider: 'supplier.example',
              url: 'https://supplier.example/reports/release',
              external_id: '',
              version: '',
              observed_on: '2026-08-03',
              archived_at: null,
            },
          ],
          link_history: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3707',
              action: 'task.link_added',
              changed_by_name: 'Owner',
              changed_at: '2026-08-03T12:00:00.000Z',
              link_id: '019fbcf9-e020-71da-935a-6a6a728b3705',
              entity_type: 'external_source',
              entity_id: '019fbcf9-e020-71da-935a-6a6a728b3706',
              title: 'Supplier release report',
              url: 'https://supplier.example/reports/release',
            },
          ],
        });
      }
      if (url.endsWith(`/tasks/${task.id}/worklogs`) && init?.method === 'POST') {
        worklogBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({
          ...task,
          title: 'Release decision',
          row_version: 3,
          remaining_estimate_minutes: 60,
          time_spent_minutes: 60,
          worklogs: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3720',
              duration_minutes: 30,
              started_at: '2026-08-11T14:00:00.000Z',
              note: 'Checked release evidence.',
              author_id: '019fbcf9-e020-71da-935a-6a6a728b3792',
              author_name: 'Owner',
              remaining_estimate_before: 90,
              remaining_estimate_after: 60,
              row_version: 1,
              created_at: '2026-08-11T14:30:00.000Z',
              updated_at: '2026-08-11T14:30:00.000Z',
              can_edit: true,
            },
          ],
          worklog_page_info: { limit: 20, offset: 0, total: 1, hasNext: false },
        });
      }
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
      if (url.includes('/task-assignees')) {
        return json({
          items: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3710',
              displayName: 'Lin Reviewer',
              email: 'lin@example.com',
            },
          ],
        });
      }
      if (url.endsWith(`/tasks/${task.task_key}`)) return json(task);
      return json({
        items: [
          patchBody
            ? { ...task, title: 'Release decision', status: 'in_progress', row_version: 2 }
            : task,
        ],
      });
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
          <LocationProbe />
        </MemoryRouter>
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByLabelText('Release readiness review, To do'));
    expect(screen.getByTestId('location')).toHaveTextContent(`?task=${task.task_key}`);
    const dialog = await screen.findByRole('dialog', { name: 'Release readiness review' });
    expect(within(dialog).getByText(/^Created by Owner · .* · Updated /)).toBeInTheDocument();
    expect(within(dialog).getByText('Owner created this task in To do.')).toBeInTheDocument();
    expect(
      within(dialog)
        .getByText('Owner created this task in To do.')
        .closest('div')
        ?.querySelector('time'),
    ).toHaveTextContent(
      new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(task.status_history[0].changed_at),
      ),
    );
    expect(within(dialog).getByRole('link', { name: 'Qualification Sample 42' })).toHaveAttribute(
      'href',
      `/workspaces/${workspaceId}/projects/${projectId}/data/t00000000000001/records/019fbcf9-e020-71da-935a-6a6a728b3717`,
    );
    expect(within(dialog).getByText('Sample')).toBeInTheDocument();
    expect(
      within(dialog).queryByText('019fbcf9-e020-71da-935a-6a6a728b3717'),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByText('Production release')).toBeInTheDocument();
    const keyDateLink = within(dialog).getByRole('link', {
      name: 'Open key date Production release',
    });
    expect(keyDateLink).toHaveAttribute(
      'href',
      `/workspaces/${workspaceId}/projects/${projectId}/milestones?milestone=019fbcf9-e020-71da-935a-6a6a728b3715`,
    );
    expect(within(dialog).getByText('Automation · Escalate readiness')).toBeInTheDocument();
    expect(within(dialog).getByText('Changed priority from Medium to High.')).toBeInTheDocument();
    expect(within(dialog).getByText('No work has been logged yet.')).toBeInTheDocument();
    expect(within(dialog).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Task access' }));
    expect(await within(dialog).findByRole('radio', { name: /Project members/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole('radio', { name: /^Restricted/ }));
    expect(within(dialog).getByRole('checkbox', { name: 'Lin Reviewer' })).toBeInTheDocument();
    expect(
      within(dialog).getByRole('checkbox', { name: 'Security reviewers' }),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy task link' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining(
          `/workspaces/${workspaceId}/projects/${projectId}/tasks?task=${task.task_key}`,
        ),
      ),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show comments only' }));
    expect(within(dialog).getByText('No loaded activity matches this filter.')).toBeInTheDocument();
    expect(within(dialog).queryByText('Automation · Escalate readiness')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show change history only' }));
    expect(within(dialog).getByText('Automation · Escalate readiness')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Newest activity first' }));
    expect(
      within(dialog).getByRole('button', { name: 'Oldest activity first' }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'w' });
    await waitFor(() => expect(watchRequested).toBe(true));
    expect(within(dialog).getByRole('button', { name: 'Stop watching task' })).toHaveAttribute(
      'aria-keyshortcuts',
      'W',
    );
    fireEvent.keyDown(window, { key: 'm' });
    expect(within(dialog).getByRole('textbox', { name: 'Comment' })).toHaveFocus();
    expect(within(dialog).getByRole('textbox', { name: 'Comment' })).toHaveAttribute(
      'aria-keyshortcuts',
      'M',
    );
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Link title' }), {
      target: { value: 'Supplier release report' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'URL' }), {
      target: { value: 'https://supplier.example/reports/release' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add external evidence link' }));
    await waitFor(() =>
      expect(externalLinkBody).toEqual({
        title: 'Supplier release report',
        url: 'https://supplier.example/reports/release',
      }),
    );
    expect(await within(dialog).findAllByText('Supplier release report')).not.toHaveLength(0);
    expect(
      within(dialog).getByRole('button', { name: 'Open Supplier release report' }),
    ).toHaveAttribute('title', 'Open Supplier release report');
    expect(within(dialog).getByText('Owner linked “Supplier release report”.')).toBeInTheDocument();
    const attachment = new File(['report'], 'release-note.pdf', { type: 'application/pdf' });
    Object.defineProperty(attachment, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('report').buffer,
    });
    fireEvent.change(within(dialog).getByLabelText('Choose a file to attach'), {
      target: { files: [attachment] },
    });
    await waitFor(() => expect(fileLinkBody).toEqual({ fileId: attachmentFileId }));
    expect(await within(dialog).findByText('release-note.pdf')).toBeInTheDocument();
    expect(within(dialog).getByText('release-note.pdf · v1 · 6 B')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Download release-note.pdf' }),
    ).toHaveAttribute('title', 'Download release-note.pdf');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'Release decision' },
    });
    expect(within(dialog).getByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'Release readiness review' },
    });
    expect(within(dialog).queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'Release decision' },
    });
    const discardDetail = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close task detail' }));
    expect(discardDetail).toHaveBeenCalledWith(
      'Discard unsaved task changes and drafts? This cannot be undone.',
    );
    expect(screen.getByRole('dialog', { name: 'Release readiness review' })).toBeInTheDocument();
    fireEvent.click(keyDateLink);
    expect(discardDetail).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('location')).toHaveTextContent(`?task=${task.task_key}`);
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Status' }), {
      target: { value: 'in_progress' },
    });
    fireEvent.focus(within(dialog).getByRole('combobox', { name: 'Assignee' }));
    fireEvent.click(await screen.findByRole('option', { name: /Lin Reviewer/ }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Labels\b/ }), {
      target: { value: 'Safety, Supplier' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(patchBody).toMatchObject({
        title: 'Release decision',
        status: 'in_progress',
        priority: 'high',
        labels: ['safety', 'supplier'],
        assigneeId: '019fbcf9-e020-71da-935a-6a6a728b3710',
        dueDate: '2026-08-20',
        rowVersion: 1,
      }),
    );
    expect(within(dialog).getByRole('heading', { name: 'Release decision' })).toBeInTheDocument();
    expect(within(dialog).queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'In progress, tasks: 1' })).getByText(
        'Release decision',
      ),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Time spent' }), {
      target: { value: '30m' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Work note' }), {
      target: { value: 'Checked release evidence.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log work' }));
    await waitFor(() =>
      expect(worklogBody).toMatchObject({
        durationMinutes: 30,
        note: 'Checked release evidence.',
        remainingEstimateMode: 'auto',
        taskRowVersion: 2,
      }),
    );
    expect(await within(dialog).findByText('30m · Owner')).toBeInTheDocument();
    expect(within(dialog).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('preserves a task draft when a concurrent edit wins and reloads latest state explicitly', async () => {
    const task = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3701',
      task_key: 'FORCE-9',
      title: 'Review release evidence',
      description: '',
      status: 'todo',
      priority: 'medium',
      labels: [],
      assignee_id: null,
      assignee_name: null,
      due_date: null,
      row_version: 1,
      archived_at: null,
      links: [],
      status_history: [],
      change_history: [],
      link_history: [],
      linked_key_dates: [],
      children: [],
      relationships: [],
      comments: [],
      watchers: [],
      watcher_count: 0,
      watching: false,
    } as const;
    const latest = {
      ...task,
      title: 'Server-updated release evidence',
      row_version: 2,
    } as const;
    let conflictRaised = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith(`/tasks/${task.id}`) && init?.method === 'PATCH') {
        conflictRaised = true;
        return new Response(
          JSON.stringify({
            error: {
              code: 'TASK_VERSION_CONFLICT',
              message: 'Task changed or is unavailable.',
              details: [],
              requestId: 'conflict-request',
            },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith(`/tasks/${task.id}`)) return json(latest);
      if (url.endsWith(`/tasks/${task.task_key}`)) return json(task);
      if (url.endsWith('/notifications/preferences')) return json({ autoWatchCommented: true });
      if (url.includes('/tasks?'))
        return json({
          items: [conflictRaised ? latest : task],
          pageInfo: { limit: 100, offset: 0, total: 1, hasNext: false },
        });
      return json({ items: [] });
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

    fireEvent.click(await screen.findByLabelText('Review release evidence, To do'));
    const dialog = await screen.findByRole('dialog', { name: 'Review release evidence' });
    const title = within(dialog).getByRole('textbox', { name: 'Task title' });
    fireEvent.change(title, { target: { value: 'My preserved release draft' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(
      await within(dialog).findByRole('heading', { name: 'Newer task changes are available' }),
    ).toBeInTheDocument();
    expect(title).toHaveValue('My preserved release draft');
    expect(within(dialog).getByText('Unsaved changes')).toBeInTheDocument();

    const confirmReload = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Load latest task' }));
    expect(confirmReload).toHaveBeenCalledWith(
      'Discard unsaved task changes and drafts? This cannot be undone.',
    );
    expect(title).toHaveValue('My preserved release draft');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Load latest task' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('textbox', { name: 'Task title' })).toHaveValue(
        'Server-updated release evidence',
      ),
    );
    expect(
      within(dialog).queryByRole('heading', { name: 'Newer task changes are available' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'This task changed elsewhere. The latest state was loaded; review it and try again.',
      ),
    ).toBeInTheDocument();
  });

  it('replaces a legacy UUID deep link with the stable task key without dropping query state', async () => {
    const task = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3701',
      task_key: 'FORCE-42',
      title: 'Review canonical task links',
      description: '',
      status: 'todo',
      priority: 'medium',
      labels: [],
      assignee_id: null,
      assignee_name: null,
      due_date: null,
      row_version: 1,
      archived_at: null,
      links: [],
      status_history: [],
      change_history: [],
      link_history: [],
      linked_key_dates: [],
      children: [],
      relationships: [],
      comments: [],
      watchers: [],
      watcher_count: 0,
      watching: false,
    } as const;
    const detailRequests: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith(`/tasks/${task.id}`) || url.endsWith(`/tasks/${task.task_key}`)) {
        detailRequests.push(url);
        return json(task);
      }
      if (url.endsWith('/notifications/preferences')) return json({ autoWatchCommented: true });
      return json({ items: [task] });
    });

    render(
      <I18nProvider>
        <MemoryRouter
          initialEntries={[
            `/workspaces/${workspaceId}/projects/${projectId}/tasks?task=${task.id}&query=release`,
          ]}
        >
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
          <LocationProbe />
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(
      await screen.findByRole('dialog', { name: 'Review canonical task links' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        `?task=${task.task_key}&query=release`,
      ),
    );
    expect(detailRequests).toEqual([
      expect.stringContaining(`/tasks/${task.id}`),
      expect.stringContaining(`/tasks/${task.task_key}`),
    ]);
  });

  it('posts a comment, mentions a teammate, and subscribes the author', async () => {
    const teammateId = '019fbcf9-e020-71da-935a-6a6a728b3710';
    const task = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3701',
      task_key: 'FORCE-2',
      title: 'Review force evidence',
      description: '',
      status: 'todo',
      priority: 'high',
      assignee_id: null,
      assignee_name: null,
      due_date: null,
      row_version: 1,
      archived_at: null,
      links: [],
      status_history: [],
      watchers: [],
      watcher_count: 0,
      watching: false,
      comments: [],
    } as const;
    let commentBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/task-assignees')) {
        return json({
          items: [{ id: teammateId, displayName: 'Lin Reviewer', email: 'lin@example.com' }],
        });
      }
      if (url.endsWith(`/tasks/${task.id}/comments`) && init?.method === 'POST') {
        commentBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({
          id: '019fbcf9-e020-71da-935a-6a6a728b3711',
          body: 'Please confirm the peak load.',
          author_id: '019fbcf9-e020-71da-935a-6a6a728b3792',
          author_name: 'Owner',
          mentions: [{ id: teammateId, displayName: 'Lin Reviewer' }],
          edited_at: null,
          created_at: '2026-08-08T12:00:00.000Z',
        });
      }
      if (url.endsWith(`/tasks/${task.task_key}`)) return json(task);
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

    fireEvent.click(await screen.findByRole('button', { name: 'Review force evidence, To do' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review force evidence' });
    fireEvent.click(await within(dialog).findByRole('button', { name: '@Lin Reviewer' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Comment' }), {
      target: { value: 'Please confirm the peak load.' },
    });
    expect(within(dialog).getByText('Unsaved changes')).toBeInTheDocument();
    const discardComment = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close task detail' }));
    expect(discardComment).toHaveBeenCalledWith(
      'Discard unsaved task changes and drafts? This cannot be undone.',
    );
    expect(screen.getByRole('dialog', { name: 'Review force evidence' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Post comment' }));

    await waitFor(() =>
      expect(commentBody).toEqual({
        body: 'Please confirm the peak load.',
        mentionedUserIds: [teammateId],
        watch: true,
      }),
    );
    expect(await within(dialog).findByText('Please confirm the peak load.')).toBeInTheDocument();
    expect(within(dialog).queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Stop watching task' })).toHaveTextContent(
      '1',
    );
  });

  it('loads earlier task activity on demand instead of expanding the initial detail payload', async () => {
    const task = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3701',
      task_key: 'FORCE-3',
      title: 'Long-running qualification',
      description: '',
      status: 'todo',
      priority: 'high',
      assignee_id: null,
      assignee_name: null,
      due_date: null,
      row_version: 1,
      archived_at: null,
      links: [],
      status_history: [
        {
          id: '019fbcf9-e020-71da-935a-6a6a728b3711',
          from_status: null,
          to_status: 'todo',
          changed_by_name: 'Current Owner',
          changed_at: '2026-08-09T12:00:00.000Z',
        },
      ],
      change_history: [],
      link_history: [],
      comments: [],
      relationships: [],
      watchers: [],
      watcher_count: 0,
      watching: false,
      activity_page_info: { limit: 1, offset: 0, total: 2, hasNext: true },
    } as const;
    let activityRequest = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes(`/tasks/${task.id}/activity?`)) {
        activityRequest = url;
        return json({
          status_history: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3710',
              from_status: null,
              to_status: 'todo',
              changed_by_name: 'Earlier Owner',
              changed_at: '2026-08-08T12:00:00.000Z',
            },
          ],
          change_history: [],
          link_history: [],
          comments: [],
          pageInfo: { limit: 50, offset: 1, total: 2, hasNext: false },
        });
      }
      if (url.endsWith(`/tasks/${task.task_key}`)) return json(task);
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

    fireEvent.click(
      await screen.findByRole('button', { name: 'Long-running qualification, To do' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Long-running qualification' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Load earlier activity' }));
    expect(await within(dialog).findByText(/Earlier Owner/)).toBeInTheDocument();
    expect(activityRequest).toContain('limit=50&offset=1');
    expect(within(dialog).queryByRole('button', { name: 'Load earlier activity' })).toBeNull();
  });

  it('edits an authored comment with icons, mentions, and visible revision history', async () => {
    const ownerId = '019fbcf9-e020-71da-935a-6a6a728b3792';
    const teammateId = '019fbcf9-e020-71da-935a-6a6a728b3710';
    const commentId = '019fbcf9-e020-71da-935a-6a6a728b3711';
    const task = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3701',
      task_key: 'FORCE-4',
      title: 'Record release decision',
      description: '',
      status: 'todo',
      priority: 'high',
      assignee_id: null,
      assignee_name: null,
      due_date: null,
      row_version: 1,
      archived_at: null,
      links: [],
      status_history: [],
      change_history: [],
      link_history: [],
      relationships: [],
      watchers: [],
      watcher_count: 0,
      watching: false,
      comments: [
        {
          id: commentId,
          body: 'Release is blocked.',
          author_id: ownerId,
          author_name: 'Owner',
          mentions: [],
          row_version: 1,
          revisions: [],
          edited_at: null,
          created_at: '2026-08-08T12:00:00.000Z',
        },
      ],
    } as const;
    let editBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/notifications/preferences')) {
        return json({ autoWatchCommented: true });
      }
      if (url.includes('/task-assignees')) {
        return json({
          items: [{ id: teammateId, displayName: 'Lin Reviewer', email: 'lin@example.com' }],
        });
      }
      if (url.endsWith(`/tasks/${task.id}/comments/${commentId}`) && init?.method === 'PATCH') {
        editBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({
          ...task.comments[0],
          body: 'Release is approved with monitoring.',
          mentions: [{ id: teammateId, displayName: 'Lin Reviewer' }],
          row_version: 2,
          revisions: [
            {
              revision: 1,
              body: 'Release is blocked.',
              mentions: [],
              edited_by_name: 'Owner',
              edited_at: '2026-08-08T13:00:00.000Z',
            },
          ],
          edited_at: '2026-08-08T13:00:00.000Z',
        });
      }
      if (url.endsWith(`/tasks/${task.task_key}`)) return json(task);
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
                    id: ownerId,
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

    fireEvent.click(await screen.findByRole('button', { name: 'Record release decision, To do' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record release decision' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Edit comment' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Edit comment' }), {
      target: { value: 'Release is approved with monitoring.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '@Lin Reviewer' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(editBody).toEqual({
        body: 'Release is approved with monitoring.',
        mentionedUserIds: [teammateId],
        rowVersion: 1,
      }),
    );
    expect(
      await within(dialog).findByText('Release is approved with monitoring.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Edited comment')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'View edit history' }));
    expect(within(dialog).getByText('Release is blocked.')).toBeInTheDocument();
    expect(within(dialog).getByText('v1')).toBeInTheDocument();
  });

  it('links a blocker from task detail and shows the unresolved dependency', async () => {
    const taskId = '019fbcf9-e020-71da-935a-6a6a728b3701';
    const blockerId = '019fbcf9-e020-71da-935a-6a6a728b3702';
    const baseTask = {
      description: '',
      status: 'todo',
      priority: 'medium',
      assignee_id: null,
      assignee_name: null,
      due_date: null,
      row_version: 1,
      archived_at: null,
      open_blocker_count: 0,
      links: [],
    } as const;
    const task = {
      ...baseTask,
      id: taskId,
      task_number: 1,
      task_key: 'TEST-1',
      title: 'Release test report',
    };
    const blocker = {
      ...baseTask,
      id: blockerId,
      task_number: 2,
      task_key: 'TEST-2',
      title: 'Resolve calibration drift',
      status: 'in_progress' as const,
    };
    const detail = {
      ...task,
      status_history: [],
      watchers: [],
      watcher_count: 0,
      watching: false,
      comments: [],
      relationships: [],
    };
    let relationshipBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/notifications/preferences')) {
        return json({ autoWatchCommented: true });
      }
      if (url.includes('/task-assignees')) return json({ items: [] });
      if (url.includes('/task-candidates?')) {
        return json({
          items: [
            {
              id: blocker.id,
              task_key: blocker.task_key,
              title: blocker.title,
              parent_task_id: null,
              child_count: 0,
            },
          ],
          pageInfo: { limit: 20, offset: 0, total: 1, hasNext: false },
        });
      }
      if (url.endsWith(`/tasks/${taskId}/relationships`) && init?.method === 'POST') {
        relationshipBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({
          ...detail,
          open_blocker_count: 1,
          relationships: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3703',
              relation_type: 'blocks',
              direction: 'inward',
              related_task_id: blockerId,
              related_task_key: blocker.task_key,
              related_task_title: blocker.title,
              related_task_status: blocker.status,
              related_task_archived_at: null,
              created_at: '2026-08-08T12:00:00.000Z',
            },
          ],
        });
      }
      if (url.endsWith(`/tasks/${task.task_key}`)) return json(detail);
      return json({ items: [task, blocker] });
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

    fireEvent.click(await screen.findByRole('button', { name: 'Release test report, To do' }));
    const dialog = await screen.findByRole('dialog', { name: 'Release test report' });
    expect(within(dialog).getByText('TEST-1')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Search Related task' }), {
      target: { value: 'calibration' },
    });
    fireEvent.click(
      await within(dialog).findByRole('button', { name: /^TEST-2.*Resolve calibration drift/ }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add task relationship' }));

    await waitFor(() =>
      expect(relationshipBody).toEqual({ relatedTaskId: blockerId, type: 'blocked_by' }),
    );
    expect(await within(dialog).findByText('1 unresolved blocker(s)')).toBeInTheDocument();
    expect(within(dialog).getByText(/Resolve calibration drift · In progress/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', {
        name: 'Remove relationship with Resolve calibration drift',
      }),
    ).toHaveAttribute('title', 'Remove relationship with Resolve calibration drift');
  });

  it('selects multiple cards explicitly and confirms one atomic bulk update', async () => {
    const tasks = [
      {
        id: '019fbcf9-e020-71da-935a-6a6a728b3701',
        task_key: 'TEST-11',
        title: 'Review motor data',
        description: '',
        status: 'todo',
        priority: 'medium',
        assignee_id: null,
        assignee_name: null,
        due_date: null,
        row_version: 1,
        archived_at: null,
        links: [],
      },
      {
        id: '019fbcf9-e020-71da-935a-6a6a728b3702',
        task_key: 'TEST-12',
        title: 'Check bearing report',
        description: '',
        status: 'todo',
        priority: 'high',
        assignee_id: null,
        assignee_name: null,
        due_date: null,
        row_version: 3,
        archived_at: null,
        links: [],
      },
    ] as const;
    let bulkBody: unknown;
    let bulkApplied = false;
    let refreshedAfterBulk = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/task-filters')) return json({ items: [] });
      if (url.endsWith('/tasks/bulk-update') && init?.method === 'POST') {
        bulkBody = JSON.parse(String(init.body));
        bulkApplied = true;
        return json({
          items: tasks.map((task) => ({
            ...task,
            status: 'in_progress',
            row_version: task.row_version + 1,
          })),
        });
      }
      if (bulkApplied && url.includes('/tasks?') && url.includes('archiveState=active')) {
        refreshedAfterBulk = true;
      }
      return json({
        items: bulkApplied
          ? tasks.map((task) => ({
              ...task,
              status: 'in_progress',
              row_version: task.row_version + 1,
            }))
          : tasks,
      });
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

    await screen.findByRole('button', { name: 'Review motor data, To do' });
    fireEvent.click(screen.getByRole('button', { name: 'Select multiple tasks' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Review motor data, To do' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Check bearing report, To do' }));
    expect(screen.getByText('2 tasks selected')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'New status' }), {
      target: { value: 'in_progress' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review bulk change' }));
    expect(bulkBody).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm update' }));

    await waitFor(() =>
      expect(bulkBody).toEqual({
        items: [
          { id: tasks[0].id, rowVersion: 1 },
          { id: tasks[1].id, rowVersion: 3 },
        ],
        changes: { status: 'in_progress' },
      }),
    );
    expect((await screen.findAllByText('2 tasks updated.')).length).toBeGreaterThan(0);
    expect(refreshedAfterBulk).toBe(true);
    expect(screen.getByRole('region', { name: 'In progress, tasks: 2' })).toBeInTheDocument();
  });

  it('applies, favorites, updates, and shares project filters through the server', async () => {
    const saved = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3710',
      owner_id: '019fbcf9-e020-71da-935a-6a6a728b3792',
      owner_name: 'Owner',
      name: 'My urgent work',
      visibility: 'project' as const,
      favorite: false,
      is_owner: true,
      config: {
        query: 'motor',
        assignee: 'mine',
        priority: 'high',
        statuses: ['todo'],
        labels: ['safety'],
        view: 'list' as const,
        sort: 'priority' as const,
        direction: 'desc' as const,
        group: 'assignee' as const,
        listColumns: ['title', 'priority', 'assignee'] as const,
      },
    };
    let savedBody: unknown;
    let favoriteBody: unknown;
    let updateBody: unknown;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith(`/task-filters/${saved.id}/favorite`) && init?.method === 'POST') {
        favoriteBody = JSON.parse(String(init.body));
        return json({ favorite: true });
      }
      if (url.endsWith(`/task-filters/${saved.id}`) && init?.method === 'PATCH') {
        updateBody = JSON.parse(String(init.body));
        return json({ ...saved, ...(updateBody as object), favorite: true });
      }
      if (url.endsWith('/task-filters') && init?.method === 'POST') {
        savedBody = JSON.parse(String(init.body));
        return json({
          id: '019fbcf9-e020-71da-935a-6a6a728b3711',
          owner_id: saved.owner_id,
          owner_name: saved.owner_name,
          favorite: true,
          is_owner: true,
          ...(savedBody as object),
        });
      }
      if (url.endsWith('/task-labels')) return json({ items: [{ value: 'safety', count: 2 }] });
      if (url.endsWith('/task-filters')) return json({ items: [saved] });
      return json({ items: [] });
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

    const savedFilters = await screen.findByRole('combobox', { name: 'Saved filters' });
    fireEvent.change(savedFilters, { target: { value: saved.id } });
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('motor');
    expect(screen.getByRole('combobox', { name: 'Filter by priority' })).toHaveValue('high');
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toHaveValue('todo');
    expect(screen.getByRole('combobox', { name: 'Filter by label' })).toHaveValue('safety');
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Group tasks' })).toHaveValue('assignee');
    expect(screen.queryByRole('button', { name: 'Sort by Status' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore manual rank order' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Favorite selected filter' }));
    await waitFor(() => expect(favoriteBody).toEqual({ favorite: true }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Update selected filter with current conditions' }),
    );
    await waitFor(() =>
      expect(updateBody).toEqual({
        name: 'My urgent work',
        visibility: 'project',
        config: {
          query: 'motor',
          assignee: 'mine',
          priority: 'high',
          statuses: ['todo'],
          labels: ['safety'],
          view: 'list',
          sort: 'priority',
          direction: 'desc',
          group: 'assignee',
          listColumns: ['title', 'priority', 'assignee'],
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save current filter' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Filter name/ }), {
      target: { value: 'Motor follow-up' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Visibility' }), {
      target: { value: 'project' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save filter' }));

    await waitFor(() =>
      expect(savedBody).toEqual({
        name: 'Motor follow-up',
        visibility: 'project',
        config: {
          query: 'motor',
          assignee: 'mine',
          priority: 'high',
          statuses: ['todo'],
          labels: ['safety'],
          view: 'list',
          sort: 'priority',
          direction: 'desc',
          group: 'assignee',
          listColumns: ['title', 'priority', 'assignee'],
        },
      }),
    );
    expect(await screen.findByText('Filter saved.')).toBeInTheDocument();
  });

  it('searches the full saved-filter directory and continues through older matches', async () => {
    const makeFilter = (id: string, name: string) => ({
      id,
      owner_id: '019fbcf9-e020-71da-935a-6a6a728b3792',
      owner_name: 'Owner',
      name,
      visibility: 'personal' as const,
      favorite: false,
      is_owner: true,
      config: {
        query: '',
        assignee: 'all',
        priority: 'all' as const,
        statuses: [],
        labels: [],
        view: 'board' as const,
        sort: 'rank' as const,
        direction: 'asc' as const,
        group: 'none' as const,
        listColumns: ['title', 'status', 'priority', 'assignee', 'dueDate'] as const,
      },
    });
    const first = makeFilter('019fbcf9-e020-71da-935a-6a6a728b3712', 'Safety review');
    const second = makeFilter('019fbcf9-e020-71da-935a-6a6a728b3713', 'Safety follow-up');
    const requestedUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes('/task-filters?query=safety&limit=50&offset=0'))
        return json({
          items: [first],
          pageInfo: { limit: 50, offset: 0, total: 2, hasNext: true },
        });
      if (url.includes('/task-filters?limit=50&offset=1&query=safety'))
        return json({
          items: [second],
          pageInfo: { limit: 50, offset: 1, total: 2, hasNext: false },
        });
      if (url.endsWith('/task-filters'))
        return json({
          items: [first],
          pageInfo: { limit: 50, offset: 0, total: 1, hasNext: false },
        });
      return json({ items: [] });
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

    await screen.findByRole('combobox', { name: 'Saved filters' });
    fireEvent.click(screen.getByRole('button', { name: 'Find saved filters' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search saved filters' }), {
      target: { value: 'safety' },
    });

    expect(await screen.findByText('Showing 1 of 2 matching filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more filters (1 of 2)' }));
    expect(await screen.findByText('Showing 2 of 2 matching filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Safety follow-up/ }));
    expect(screen.getByRole('combobox', { name: 'Saved filters' })).toHaveValue(second.id);
    expect(requestedUrls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/task-filters?query=safety&limit=50&offset=0'),
        expect.stringContaining('/task-filters?limit=50&offset=1&query=safety'),
      ]),
    );
  });

  it('restores a saved filter from its stable URL id and clears stale context after edits', async () => {
    const saved = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3714',
      owner_id: '019fbcf9-e020-71da-935a-6a6a728b3792',
      owner_name: 'Owner',
      name: 'Shared motor triage',
      visibility: 'project' as const,
      favorite: true,
      is_owner: true,
      config: {
        query: 'motor',
        assignee: 'mine',
        priority: 'high' as const,
        statuses: ['todo'],
        labels: ['safety'],
        view: 'list' as const,
        sort: 'priority' as const,
        direction: 'desc' as const,
        group: 'assignee' as const,
        listColumns: ['title', 'priority', 'assignee'] as const,
      },
    };
    const requestedUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith(`/task-filters/${saved.id}`)) return json(saved);
      if (url.endsWith('/task-filters'))
        return json({
          items: [],
          pageInfo: { limit: 50, offset: 0, total: 0, hasNext: false },
        });
      if (url.endsWith('/task-labels')) return json({ items: [{ value: 'safety', count: 1 }] });
      return json({ items: [] });
    });

    render(
      <I18nProvider>
        <MemoryRouter
          initialEntries={[
            `/workspaces/${workspaceId}/projects/${projectId}/tasks?filter=${saved.id}`,
          ]}
        >
          <Routes>
            <Route
              element={
                <>
                  <TasksPage
                    user={{
                      id: '019fbcf9-e020-71da-935a-6a6a728b3792',
                      email: 'owner@example.com',
                      displayName: 'Owner',
                      organizationId: '019fbcf9-e020-71da-935a-6a6a728b3793',
                      role: 'owner',
                    }}
                  />
                  <LocationProbe />
                </>
              }
              path="/workspaces/:workspaceId/projects/:projectId/tasks"
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('motor'),
    );
    expect(screen.getByRole('combobox', { name: 'Saved filters' })).toHaveValue(saved.id);
    expect(screen.getByTestId('location')).toHaveTextContent(`?filter=${saved.id}`);
    expect(requestedUrls).toEqual(
      expect.arrayContaining([expect.stringContaining(`/task-filters/${saved.id}`)]),
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by priority' }), {
      target: { value: 'low' },
    });
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('?filter='));
    expect(screen.getByRole('combobox', { name: 'Saved filters' })).toHaveValue('');

    fireEvent.change(screen.getByRole('combobox', { name: 'Saved filters' }), {
      target: { value: saved.id },
    });
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`?filter=${saved.id}`),
    );
    expect(screen.getByRole('combobox', { name: 'Filter by priority' })).toHaveValue('high');
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}
