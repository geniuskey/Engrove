import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n.js';
import { ProjectReferencePicker } from './ProjectReferencePicker.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ProjectReferencePicker', () => {
  it('searches, submits the selected id, closes, and reopens while focus stays in the picker', async () => {
    const project = {
      id: '019fbcf9-e020-71da-935a-6a6a728b3713',
      publicId: 'p1234567890abcd',
      name: 'Thermal qualification',
      key: 'THERMAL',
      archivedAt: null,
    };
    const requestedUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      requestedUrls.push(String(input));
      return json({ items: [project], pageInfo: { hasMore: false } });
    });

    render(
      <I18nProvider>
        <form aria-label="Record form">
          <ProjectReferencePicker
            ariaLabel="Project"
            name="contextProjectId"
            projects={[]}
            workspaceId="w1234567890abcd"
          />
        </form>
      </I18nProvider>,
    );

    const picker = screen.getByRole('combobox', { name: 'Project' });
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: 'Thermal' } });

    await waitFor(() =>
      expect(requestedUrls).toContain(
        'http://localhost:3000/api/v1/workspaces/w1234567890abcd/project-options?limit=20&query=Thermal',
      ),
    );
    fireEvent.click(
      within(await screen.findByRole('listbox')).getByRole('option', {
        name: 'Thermal qualification',
      }),
    );

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(picker).toHaveValue('Thermal qualification');
    expect(
      new FormData(screen.getByRole('form', { name: 'Record form' }) as HTMLFormElement).get(
        'contextProjectId',
      ),
    ).toBe(project.id);

    fireEvent.click(picker);
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Thermal qualification' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('opens above a near-bottom field instead of covering the input', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 740,
      height: 40,
      left: 100,
      right: 400,
      top: 700,
      width: 300,
      x: 100,
      y: 700,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ items: [], pageInfo: { hasMore: false } }),
    );

    render(
      <I18nProvider>
        <ProjectReferencePicker ariaLabel="Project" projects={[]} workspaceId="w1234567890abcd" />
      </I18nProvider>,
    );

    fireEvent.focus(screen.getByRole('combobox', { name: 'Project' }));
    const listbox = await screen.findByRole('listbox');
    expect(listbox).toHaveStyle({
      left: '100px',
      maxHeight: '256px',
      top: '696px',
      transform: 'translateY(-100%)',
      width: '300px',
    });
  });
});
