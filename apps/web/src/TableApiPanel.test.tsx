import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n.js';
import { TableApiPanel } from './TableApiPanel.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TableApiPanel', () => {
  it('exposes stable identifiers and token-safe record examples without leaving table context', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const close = vi.fn();

    render(
      <I18nProvider>
        <TableApiPanel
          fields={[
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3794',
              objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
              name: 'Serial',
              key: 'serial',
              description: '',
              fieldType: 'decimal',
              required: true,
              unique: true,
              position: 0,
              config: {},
              projectionStatus: 'ready',
            },
            {
              id: '019fbcf9-e020-71da-935a-6a6a728b3795',
              objectTypeId: '019fbcf9-e020-71da-935a-6a6a728b3792',
              name: 'State',
              key: 'state',
              description: '',
              fieldType: 'single_select',
              required: true,
              unique: false,
              position: 1,
              config: { options: [{ key: 'ready', label: 'Ready' }] },
              defaultValue: 'ready',
              projectionStatus: 'ready',
            },
          ]}
          onClose={close}
          projectId="pf3df0667cb3a75"
          table={{
            id: '019fbcf9-e020-71da-935a-6a6a728b3792',
            publicId: 't1234567890abcd',
            projectId: '019fbcf9-e020-71da-935a-6a6a728b3793',
            name: 'Sample',
            pluralName: 'Samples',
            key: 'sample',
            icon: 'flask',
            description: '',
            system: false,
          }}
          workspaceId="w8229121e5c82ae"
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Table API quickstart' })).toBeInTheDocument();
    expect(screen.getByText('t1234567890abcd')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OpenAPI docs ↗' })).toHaveAttribute(
      'href',
      'http://localhost:3000/api/docs#/Programmable%20data',
    );
    expect(screen.getByText(/curl --fail-with-body/)).toHaveTextContent(
      '/object-types/t1234567890abcd/records/query',
    );
    expect(screen.getByText(/curl --fail-with-body/)).toHaveTextContent(
      '"fields":["serial","state"]',
    );
    expect(screen.getByRole('button', { name: 'Copy API example' }).parentElement).toHaveClass(
      'absolute',
      'right-2',
      'top-2',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Get schema' }));
    expect(screen.getByText(/curl --fail-with-body/)).toHaveTextContent(
      '/object-types/t1234567890abcd/fields',
    );
    expect(screen.getByText(/curl --fail-with-body/)).toHaveTextContent('--request GET');

    fireEvent.click(screen.getByRole('button', { name: 'Copy Workspace ID' }));
    expect(writeText).toHaveBeenCalledWith('w8229121e5c82ae');
    expect(await screen.findByText('Workspace ID copied.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create template' }));
    expect(screen.getByText(/curl --fail-with-body/)).toHaveTextContent(
      '{"displayName":"New Sample","values":{"serial":"1","state":"ready"}}',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bulk create' }));
    expect(screen.getByText(/curl --fail-with-body/)).toHaveTextContent(
      '/object-types/t1234567890abcd/records/bulk',
    );
    expect(screen.getByText(/curl --fail-with-body/)).toHaveTextContent(
      'Idempotency-Key: replace-with-a-unique-key',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bulk update' }));
    expect(screen.getByText(/curl --fail-with-body/)).toHaveTextContent(
      '/object-types/t1234567890abcd/records/bulk/fields',
    );
    expect(screen.getByText(/curl --fail-with-body/)).toHaveTextContent(
      '"changes":[{"fieldKey":"serial","operation":"set","value":"1"}]',
    );
    fireEvent.click(screen.getByRole('button', { name: 'JavaScript' }));
    expect(screen.getByText(/const response = await fetch/)).toHaveTextContent(
      'process.env.ENGROVE_API_URL',
    );
    expect(screen.getByText(/const response = await fetch/)).toHaveTextContent("method: 'PATCH'");
    fireEvent.click(screen.getByRole('button', { name: 'SDK' }));
    expect(screen.getByText(/import \{ EngroveClient \}/)).toHaveTextContent("from '@engrove/sdk'");
    expect(screen.getByText(/import \{ EngroveClient \}/)).toHaveTextContent(
      'table.bulkUpdateFields',
    );
    expect(screen.getByText(/import \{ EngroveClient \}/)).toHaveTextContent(
      '"workspaceId": "w8229121e5c82ae"',
    );
    expect(screen.getByText(/dependency-free @engrove\/sdk client/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close table API quickstart' }));
    expect(close).toHaveBeenCalledOnce();
  });
});
