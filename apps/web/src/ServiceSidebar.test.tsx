import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceShell } from './ServiceSidebar.js';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  });
  window.localStorage.clear();
});

describe('ServiceShell mobile navigation', () => {
  it('keeps language, theme, and account actions in one settings dialog', async () => {
    const onToggleTheme = vi.fn();
    render(
      <MemoryRouter initialEntries={['/workspaces']}>
        <ServiceShell
          can={() => false}
          onSignedOut={() => undefined}
          onToggleTheme={onToggleTheme}
          request={async <T,>() => ({ items: [] }) as T}
          theme="dark"
          user={{
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'owner@example.com',
            displayName: 'Owner',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'owner',
          }}
        >
          <p>Page content</p>
        </ServiceShell>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'Open user menu' })).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveFocus();
    expect(within(dialog).getByText('owner@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'light' }));
    expect(onToggleTheme).toHaveBeenCalledOnce();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('opens as a modal drawer and restores focus when dismissed', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        media: '(max-width: 767px)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    render(
      <MemoryRouter initialEntries={['/workspaces']}>
        <ServiceShell
          can={() => false}
          onSignedOut={() => undefined}
          onToggleTheme={() => undefined}
          request={async <T,>() => ({ items: [] }) as T}
          theme="dark"
          user={{
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'owner@example.com',
            displayName: 'Owner',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'owner',
          }}
        >
          <p>Page content</p>
        </ServiceShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Engrove home' })).toHaveAttribute('href', '/');
    const trigger = screen.getByRole('button', { name: 'Open navigation menu' });
    fireEvent.click(trigger);
    expect(await screen.findByRole('dialog', { name: 'Service sidebar' })).toBeInTheDocument();
    expect(document.body).toHaveStyle({ overflow: 'hidden' });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Service sidebar' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body).not.toHaveStyle({ overflow: 'hidden' });
  });

  it('supports arrow-key selection in the command palette', async () => {
    const onToggleTheme = vi.fn();
    render(
      <MemoryRouter initialEntries={['/workspaces']}>
        <ServiceShell
          can={() => false}
          onSignedOut={() => undefined}
          onToggleTheme={onToggleTheme}
          request={async <T,>() => ({ items: [] }) as T}
          theme="dark"
          user={{
            id: '019fbcf9-e020-71da-935a-6a6a728b3790',
            email: 'owner@example.com',
            displayName: 'Owner',
            organizationId: '019fbcf9-e020-71da-935a-6a6a728b3791',
            role: 'owner',
          }}
        >
          <p>Page content</p>
        </ServiceShell>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    const search = screen.getByRole('searchbox', { name: 'Search commands' });
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: /Use light theme/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(onToggleTheme).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });
});
