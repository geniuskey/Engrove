import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n.js';
import { TaskAutomationSettings } from './TaskAutomationSettings.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TaskAutomationSettings', () => {
  it('creates an audited project rule from a compact trigger-condition-action form', async () => {
    let submitted: unknown;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/task-assignees'))
        return json({
          items: [
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3792',
              displayName: 'Ada Engineer',
            },
          ],
        });
      if (url.endsWith('/task-automations') && init?.method === 'POST') {
        submitted = JSON.parse(String(init.body));
        return json({
          id: '019fbcf9-e020-71da-935a-6a6a728b3793',
          ...(submitted as object),
          executionCount: 0,
          lastExecutedAt: null,
        });
      }
      if (url.endsWith('/task-automations')) return json({ items: [] });
      if (url.endsWith('/task-automations/executions')) return json({ items: [] });
      return json({ items: [] });
    });

    render(
      <I18nProvider>
        <TaskAutomationSettings projectId="project-1" workspaceId="workspace-1" />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByText('Task automation'));
    expect(await screen.findByText('No task automation rules yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New automation rule' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Rule name/ }), {
      target: { value: 'Escalate blockers' },
    });
    expect(screen.getByRole('combobox', { name: 'To status' })).toHaveValue('blocked');
    expect(screen.getByRole('combobox', { name: 'Set priority' })).toHaveValue('high');
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));

    await waitFor(() =>
      expect(submitted).toEqual({
        name: 'Escalate blockers',
        description: '',
        triggerType: 'task.status_changed',
        triggerConfig: { fromStatus: 'any', toStatus: 'blocked' },
        conditionConfig: {},
        actionConfig: { priority: 'high' },
        active: true,
      }),
    );
    expect(await screen.findByText('Automation rule created.')).toBeInTheDocument();
    expect(screen.getByText('Escalate blockers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Escalate blockers' })).toHaveAttribute(
      'title',
      'Edit Escalate blockers',
    );
    expect(screen.getByRole('button', { name: 'Pause Escalate blockers' })).toHaveAttribute(
      'title',
      'Pause Escalate blockers',
    );
    expect(screen.getByRole('button', { name: 'Archive Escalate blockers' })).toHaveAttribute(
      'title',
      'Archive Escalate blockers',
    );
  });

  it('filters exact execution totals and continues into older automation runs', async () => {
    const failed = {
      id: 'execution-1',
      ruleId: '019fbcf9-e020-71da-935a-6a6a728b3793',
      ruleName: 'Escalate blockers',
      triggerType: 'task.status_changed',
      triggerEvent: { type: 'task.status_changed', from: 'todo', to: 'blocked' },
      taskId: '019fbcf9-e020-71da-935a-6a6a728b3794',
      traceId: '019fbcf9-e020-71da-935a-6a6a728b3795',
      depth: 0,
      taskKey: 'OPS-17',
      taskTitle: 'Recover gateway',
      outcome: 'failed',
      changes: {},
      errorCode: 'ASSIGNEE_UNAVAILABLE',
      durationMs: 12,
      createdAt: '2026-08-10T00:00:00.000Z',
    };
    const succeeded = {
      ...failed,
      id: 'execution-2',
      taskKey: 'OPS-16',
      taskTitle: 'Publish evidence',
      outcome: 'succeeded',
      changes: { priority: { from: 'medium', to: 'high' } },
      errorCode: null,
      createdAt: '2026-08-09T00:00:00.000Z',
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/task-automations')) return json({ items: [] });
      if (url.endsWith('/task-assignees')) return json({ items: [] });
      if (url.endsWith('/task-workflow')) return json({ statuses: [] });
      if (url.includes('/task-automations/executions?')) {
        const parsed = new URL(url);
        const outcome = parsed.searchParams.get('outcome') ?? 'all';
        const offset = Number(parsed.searchParams.get('offset') ?? 0);
        const matching = outcome === 'failed' ? [failed] : [failed, succeeded];
        const items =
          outcome === 'all' && offset === 0 ? matching.slice(0, 1) : matching.slice(offset);
        return json({
          items,
          pageInfo: {
            limit: 25,
            offset,
            total: matching.length,
            hasNext: offset + items.length < matching.length,
          },
          summary: { succeeded: 1, no_change: 0, failed: 1 },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <I18nProvider>
        <TaskAutomationSettings projectId="project-1" workspaceId="workspace-1" />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByText('Task automation'));
    await screen.findByText('No task automation rules yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Automation execution history' }));
    expect(await screen.findByText(/ASSIGNEE_UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.getByText(/12 ms/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Escalate blockers'));
    expect(screen.getByText(/"from":"todo","to":"blocked"/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OPS-17 →' })).toHaveAttribute(
      'href',
      expect.stringContaining('/tasks?task=OPS-17'),
    );
    expect(screen.getByLabelText('Execution outcome totals')).toHaveTextContent('Succeeded 1');
    fireEvent.click(screen.getByRole('button', { name: 'Load more executions (1 of 2)' }));
    expect(await screen.findByText(/Publish evidence/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Execution outcome'), {
      target: { value: 'failed' },
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('outcome=failed&limit=25&offset=0'),
        expect.anything(),
      ),
    );
    expect(screen.queryByText(/Publish evidence/)).not.toBeInTheDocument();
  });

  it('appends older rule pages without replacing the visible rules', async () => {
    const rule = (id: string, name: string) => ({
      id,
      name,
      description: '',
      triggerType: 'task.created',
      triggerConfig: {},
      conditionConfig: {},
      actionConfig: { priority: 'high' },
      active: true,
      executionCount: 0,
      lastExecutedAt: null,
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/task-automations'))
        return json({
          items: [rule('rule-1', 'Current rules')],
          pageInfo: { limit: 50, offset: 0, total: 2, hasNext: true },
        });
      if (url.includes('/task-automations?limit=50&offset=1'))
        return json({
          items: [rule('rule-2', 'Older rule')],
          pageInfo: { limit: 50, offset: 1, total: 2, hasNext: false },
        });
      if (url.endsWith('/task-workflow')) return json({ statuses: [] });
      return json({ items: [] });
    });

    render(
      <I18nProvider>
        <TaskAutomationSettings projectId="project-1" workspaceId="workspace-1" />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByText('Task automation'));
    await screen.findByText('Current rules');
    fireEvent.click(screen.getByRole('button', { name: 'Load more rules (1 of 2)' }));
    expect(await screen.findByText('Older rule')).toBeInTheDocument();
    expect(screen.getByText('Current rules')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/task-automations?limit=50&offset=1'),
      expect.anything(),
    );
  });

  it('surfaces unhealthy rules and opens history already filtered to that rule', async () => {
    const ruleId = '019fbcf9-e020-71da-935a-6a6a728b3796';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/task-automations'))
        return json({
          items: [
            {
              id: ruleId,
              name: 'Escalate blockers',
              description: '',
              triggerType: 'task.status_changed',
              triggerConfig: { toStatus: 'blocked' },
              conditionConfig: {},
              actionConfig: { priority: 'critical' },
              active: true,
              executionCount: 8,
              failedCount: 3,
              lastOutcome: 'failed',
              lastErrorCode: 'TRANSITION_NOT_ALLOWED',
              lastExecutedAt: '2026-08-10T00:00:00.000Z',
            },
          ],
          pageInfo: { limit: 50, offset: 0, total: 1, hasNext: false },
        });
      if (url.endsWith('/task-assignees')) return json({ items: [] });
      if (url.endsWith('/task-workflow')) return json({ statuses: [] });
      if (url.includes('/task-automations/executions?'))
        return json({
          items: [],
          pageInfo: { limit: 25, offset: 0, total: 0, hasNext: false },
          summary: { succeeded: 5, no_change: 0, failed: 3 },
        });
      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <I18nProvider>
        <TaskAutomationSettings projectId="project-1" workspaceId="workspace-1" />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByText('Task automation'));
    expect(await screen.findByText(/⚠ 3/)).toHaveTextContent('Failed · ⚠ 3');
    expect(screen.getByText(/⚠ 3/)).toHaveAttribute('title', 'TRANSITION_NOT_ALLOWED');
    fireEvent.click(
      screen.getByRole('button', { name: 'Automation execution history: Escalate blockers' }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`ruleId=${ruleId}`),
        expect.anything(),
      ),
    );
    expect(screen.getByRole('combobox', { name: 'Automation rule' })).toHaveValue(ruleId);
    expect(screen.getByLabelText('Execution outcome totals')).toHaveTextContent('Failed 3');
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
