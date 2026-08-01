import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiStatus } from './App.js';

afterEach(() => vi.restoreAllMocks());

describe('App', () => {
  it('renders an actionable unavailable state and recovers', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            service: 'api',
            status: 'ok',
            version: '0.1.0',
            timestamp: '',
            requestId: 'r1',
          }),
          { status: 200 },
        ),
      );

    render(<ApiStatus />);
    expect(await screen.findByText('API unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/API ready/)).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
