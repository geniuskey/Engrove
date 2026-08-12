import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n.js';
import { WebhookSettings } from './WebhookSettings.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('WebhookSettings', () => {
  it('creates a scoped webhook and reveals its signing secret once', async () => {
    const endpoint = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3795',
      name: 'Quality gateway',
      url: 'https://example.com/hooks/quality',
      objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3794',
      objectTypeName: 'Samples',
      eventTypes: ['record.created', 'record.updated', 'record.archived', 'record.restored'],
      secretVersion: 1,
      active: true,
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/webhooks') && (init?.method ?? 'GET') === 'GET')
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.endsWith('/object-types'))
        return new Response(
          JSON.stringify({
            items: [{ id: endpoint.objectTypeId, name: endpoint.objectTypeName }],
          }),
          { status: 200 },
        );
      if (url.endsWith('/webhooks') && init?.method === 'POST')
        return new Response(
          JSON.stringify({ ...endpoint, signingSecret: 'signed_secret_once_1234567890' }),
          { status: 201 },
        );
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <I18nProvider>
        <WebhookSettings projectId="p1234567890abcd" workspaceId="w1234567890abcd" />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByText('Project webhooks'));
    await screen.findByText('No webhooks configured.');
    expect(screen.getByLabelText('Task created')).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Endpoint name'), {
      target: { value: endpoint.name },
    });
    fireEvent.change(screen.getByLabelText('HTTPS endpoint URL'), {
      target: { value: endpoint.url },
    });
    fireEvent.change(screen.getByLabelText('Table scope'), {
      target: { value: endpoint.objectTypeId },
    });
    expect(screen.getByLabelText('Task created')).toBeDisabled();
    expect(screen.getByText('Task events require the project-wide scope.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create webhook' }));

    expect(await screen.findByDisplayValue('signed_secret_once_1234567890')).toBeInTheDocument();
    expect(screen.getByText(endpoint.name)).toBeInTheDocument();
    expect(screen.getByText(/Samples · Active/)).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/webhooks$/),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('allows task events on a project-wide endpoint without opting in by default', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/webhooks') && (init?.method ?? 'GET') === 'GET')
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.endsWith('/object-types'))
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.endsWith('/webhooks') && init?.method === 'POST')
        return new Response(
          JSON.stringify({
            id: 'endpoint-1',
            name: 'Task gateway',
            url: 'https://example.com/hooks/tasks',
            objectTypeId: null,
            objectTypeName: null,
            eventTypes: [
              'record.created',
              'record.updated',
              'record.archived',
              'record.restored',
              'task.created',
            ],
            secretVersion: 1,
            active: true,
            createdAt: '2026-08-08T00:00:00.000Z',
            updatedAt: '2026-08-08T00:00:00.000Z',
            signingSecret: 'signed_secret_once_1234567890',
          }),
          { status: 201 },
        );
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <I18nProvider>
        <WebhookSettings projectId="p1234567890abcd" workspaceId="w1234567890abcd" />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByText('Project webhooks'));
    await screen.findByText('No webhooks configured.');
    fireEvent.change(screen.getByLabelText('Endpoint name'), {
      target: { value: 'Task gateway' },
    });
    fireEvent.change(screen.getByLabelText('HTTPS endpoint URL'), {
      target: { value: 'https://example.com/hooks/tasks' },
    });
    fireEvent.click(screen.getByLabelText('Task created'));
    fireEvent.click(screen.getByRole('button', { name: 'Create webhook' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/webhooks$/),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'Task gateway',
            url: 'https://example.com/hooks/tasks',
            objectTypeId: null,
            eventTypes: [
              'record.created',
              'record.updated',
              'record.archived',
              'record.restored',
              'task.created',
            ],
          }),
        }),
      ),
    );
  });

  it('tests an endpoint, exposes failure diagnostics, and retries a terminal delivery', async () => {
    const endpointId = '019fbcf9-e020-71da-935a-6a6a728b3795';
    const deliveryId = '019fbcf9-e020-71da-935a-6a6a728b3796';
    const endpoint = {
      id: endpointId,
      name: 'Operations gateway',
      url: 'https://example.com/hooks/operations',
      objectTypeId: null,
      objectTypeName: null,
      eventTypes: ['task.updated'],
      secretVersion: 1,
      active: true,
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
    };
    const failedDelivery = {
      id: deliveryId,
      eventType: 'task.updated',
      status: 'failed',
      attemptCount: 5,
      responseStatus: 503,
      responseSnippet: 'upstream unavailable',
      lastError: 'WEBHOOK_HTTP_503',
      nextAttemptAt: '2026-08-08T01:00:00.000Z',
      deliveredAt: null,
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:30:00.000Z',
    };
    const delivered = {
      ...failedDelivery,
      id: '019fbcf9-e020-71da-935a-6a6a728b3798',
      status: 'succeeded',
      attemptCount: 1,
      responseStatus: 204,
      responseSnippet: null,
      lastError: null,
      deliveredAt: '2026-08-07T23:00:00.000Z',
      createdAt: '2026-08-07T23:00:00.000Z',
      updatedAt: '2026-08-07T23:00:00.000Z',
    };
    let retried = false;
    let testQueued = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/webhooks') && (init?.method ?? 'GET') === 'GET')
        return new Response(JSON.stringify({ items: [endpoint] }), { status: 200 });
      if (url.endsWith('/object-types'))
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.includes(`/${endpointId}/deliveries?`) && (init?.method ?? 'GET') === 'GET') {
        const parsed = new URL(url);
        const status = parsed.searchParams.get('status') ?? 'all';
        const offset = Number(parsed.searchParams.get('offset') ?? 0);
        const currentDelivery = retried
          ? { ...failedDelivery, status: 'queued', attemptCount: 0 }
          : failedDelivery;
        const testDelivery = {
          ...failedDelivery,
          id: '019fbcf9-e020-71da-935a-6a6a728b3797',
          eventType: 'webhook.test',
          status: 'queued',
          attemptCount: 0,
          responseStatus: null,
          responseSnippet: null,
          lastError: null,
        };
        const allDeliveries = [...(testQueued ? [testDelivery] : []), currentDelivery, delivered];
        const matching =
          status === 'all'
            ? allDeliveries
            : allDeliveries.filter((delivery) => delivery.status === status);
        const items =
          !retried && !testQueued && status === 'all' && offset === 0
            ? matching.slice(0, 1)
            : matching.slice(offset, offset + 25);
        return new Response(
          JSON.stringify({
            items,
            pageInfo: {
              limit: 25,
              offset,
              total: matching.length,
              hasNext: offset + items.length < matching.length,
            },
            summary: {
              queued: allDeliveries.filter((delivery) => delivery.status === 'queued').length,
              sending: 0,
              succeeded: 1,
              failed: allDeliveries.filter((delivery) => delivery.status === 'failed').length,
            },
          }),
          { status: 200 },
        );
      }
      if (
        url.endsWith(`/${endpointId}/deliveries/${deliveryId}/retry`) &&
        init?.method === 'POST'
      ) {
        retried = true;
        return new Response(
          JSON.stringify({ ...failedDelivery, status: 'queued', attemptCount: 0 }),
          { status: 202 },
        );
      }
      if (url.endsWith(`/${endpointId}/test`) && init?.method === 'POST') {
        testQueued = true;
        return new Response(
          JSON.stringify({
            ...failedDelivery,
            id: '019fbcf9-e020-71da-935a-6a6a728b3797',
            eventType: 'webhook.test',
            status: 'queued',
            attemptCount: 0,
            responseStatus: null,
            responseSnippet: null,
            lastError: null,
          }),
          { status: 202 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <I18nProvider>
        <WebhookSettings projectId="p1234567890abcd" workspaceId="w1234567890abcd" />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByText('Project webhooks'));
    await screen.findByText(endpoint.name);
    fireEvent.click(screen.getByRole('button', { name: `View deliveries for ${endpoint.name}` }));
    expect(await screen.findByText('WEBHOOK_HTTP_503')).toBeInTheDocument();
    expect(screen.getByText(/upstream unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/5 attempt/)).toBeInTheDocument();
    expect(screen.getByLabelText('Delivery status totals')).toHaveTextContent('Delivered1');
    expect(
      screen.getByRole('button', { name: 'Load more deliveries (1 of 2)' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more deliveries (1 of 2)' }));
    await screen.findByText(/204/);
    fireEvent.change(screen.getByLabelText('Delivery status'), { target: { value: 'failed' } });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('status=failed'),
        expect.anything(),
      ),
    );
    fireEvent.change(screen.getByLabelText('Delivery status'), { target: { value: 'all' } });
    await screen.findByText('WEBHOOK_HTTP_503');
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed delivery' }));
    expect(
      await screen.findByText('Failed delivery queued for a fresh retry cycle.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/0 attempt/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: `Send test event to ${endpoint.name}` }));
    expect(await screen.findByText('Signed test delivery queued.')).toBeInTheDocument();
    expect(screen.getByText(/Test event/)).toBeInTheDocument();
  });

  it('loads additional webhook endpoint pages on demand', async () => {
    const endpoint = (id: string, name: string) => ({
      id,
      name,
      url: `https://example.com/hooks/${id}`,
      objectTypeId: null,
      objectTypeName: null,
      eventTypes: ['record.created'],
      secretVersion: 1,
      active: true,
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/webhooks'))
        return new Response(
          JSON.stringify({
            items: [endpoint('endpoint-1', 'Current endpoint')],
            pageInfo: { limit: 50, offset: 0, total: 2, hasNext: true },
          }),
          { status: 200 },
        );
      if (url.includes('/webhooks?limit=50&offset=1'))
        return new Response(
          JSON.stringify({
            items: [endpoint('endpoint-2', 'Older endpoint')],
            pageInfo: { limit: 50, offset: 1, total: 2, hasNext: false },
          }),
          { status: 200 },
        );
      if (url.endsWith('/object-types'))
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <I18nProvider>
        <WebhookSettings projectId="project-1" workspaceId="workspace-1" />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByText('Project webhooks'));
    await screen.findByText('Current endpoint');
    fireEvent.click(screen.getByRole('button', { name: 'Load more webhooks (1 of 2)' }));
    expect(await screen.findByText('Older endpoint')).toBeInTheDocument();
    expect(screen.getByText('Current endpoint')).toBeInTheDocument();
  });
});
