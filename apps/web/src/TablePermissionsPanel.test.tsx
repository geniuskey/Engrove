import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n.js';
import { TablePermissionsPanel } from './TablePermissionsPanel.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const emptySubjects = () => ({
  visibility: { userIds: [], groupIds: [] },
  create: { userIds: [], groupIds: [] },
  update: { userIds: [], groupIds: [] },
  archive: { userIds: [], groupIds: [] },
});

describe('TablePermissionsPanel', () => {
  it('saves specific member access and preserves a later draft on conflict', async () => {
    const member = {
      userId: '019fbcf9-e020-71da-935a-6a6a728b3750',
      displayName: 'Quality Reviewer',
      email: 'quality@example.com',
    };
    const initial = {
      modes: {
        visibility: 'everyone',
        create: 'editors',
        update: 'editors',
        archive: 'editors',
      },
      subjects: emptySubjects(),
      subjectDirectory: { members: [], groups: [] },
      rowVersion: 1,
    };
    let patchCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/object-types/table-1/permissions') && (init?.method ?? 'GET') === 'GET')
        return new Response(JSON.stringify(initial), { status: 200 });
      if (url.includes('/members?'))
        return new Response(
          JSON.stringify({
            items: [member],
            pageInfo: { limit: 20, offset: 0, total: 1, hasNext: false },
          }),
          { status: 200 },
        );
      if (url.endsWith('/object-types/table-1/permissions') && init?.method === 'PATCH') {
        patchCount += 1;
        if (patchCount === 2)
          return new Response(
            JSON.stringify({
              error: {
                code: 'TABLE_PERMISSION_VERSION_CONFLICT',
                message: 'Permissions changed.',
              },
            }),
            { status: 409 },
          );
        const body = JSON.parse(String(init.body)) as typeof initial;
        return new Response(
          JSON.stringify({
            ...initial,
            modes: body.modes,
            subjects: body.subjects,
            subjectDirectory: {
              members: [
                { id: member.userId, displayName: member.displayName, email: member.email },
              ],
              groups: [],
            },
            rowVersion: 2,
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn();

    render(
      <I18nProvider>
        <TablePermissionsPanel
          base="/workspaces/workspace-1/projects/project-1"
          onClose={vi.fn()}
          onSaved={onSaved}
          tableId="table-1"
          tableName="Samples"
        />
      </I18nProvider>,
    );

    await screen.findByRole('heading', { name: 'Table permissions' });
    fireEvent.change(await screen.findByLabelText(/^Visibility/), {
      target: { value: 'specific' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByLabelText(/Quality Reviewer/));
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const firstPatch = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(JSON.parse(String((firstPatch?.[1] as RequestInit).body))).toMatchObject({
      modes: { visibility: 'specific' },
      subjects: { visibility: { userIds: [member.userId], groupIds: [] } },
      rowVersion: 1,
    });
    expect(await screen.findByText('Table permissions saved.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Create records/), { target: { value: 'nobody' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone changed these permissions. Your draft is preserved',
    );
    expect(screen.getByLabelText(/^Create records/)).toHaveValue('nobody');
    expect(screen.getByRole('button', { name: 'Reload permissions' })).toBeInTheDocument();
  });
});
