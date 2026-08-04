import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceShell } from './ServiceSidebar.js';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  });
  window.localStorage.clear();
});

describe('ServiceShell mobile navigation', () => {
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
});
