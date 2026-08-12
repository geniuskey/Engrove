import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n.js';
import { TaskWorkflowSettings } from './TaskWorkflowSettings.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const workflow = {
  statuses: [
    {
      id: '019fbcf9-e020-71da-935a-6a6a728b3711',
      key: 'todo',
      name: 'To do',
      category: 'todo',
      color: 'slate',
      position: 0,
      wip_limit: 2,
      initial: true,
      row_version: 1,
      task_count: 2,
    },
    {
      id: '019fbcf9-e020-71da-935a-6a6a728b3712',
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
  transitions: [
    {
      id: '019fbcf9-e020-71da-935a-6a6a728b3713',
      name: 'Complete',
      from_status: 'todo',
      to_status: 'done',
    },
  ],
};

describe('TaskWorkflowSettings', () => {
  it('shows the status axis and saves an edited project status', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'PATCH')
        return new Response(JSON.stringify(workflow), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      return new Response(JSON.stringify(workflow), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    render(
      <I18nProvider>
        <TaskWorkflowSettings projectId="project" workspaceId="workspace" />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByText('Task workflow'));
    const axis = await screen.findByLabelText('Workflow status axis');
    expect(axis).toHaveTextContent('To do');
    expect(axis).toHaveTextContent('Done');
    expect(screen.getAllByLabelText('WIP limit')[0]).toHaveValue(2);
    const name = screen.getAllByLabelText('Name')[0]!;
    fireEvent.change(name, { target: { value: 'Ready' } });
    const form = name.closest('form')!;
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/statuses/${workflow.statuses[0]!.id}`),
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringMatching(/"name":"Ready".*"wipLimit":2/),
        }),
      ),
    );
    expect(within(form).getByRole('button', { name: 'Archive' })).toBeDisabled();
  });
});
