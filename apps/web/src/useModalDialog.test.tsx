import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useModalDialog } from './useModalDialog.js';

function DialogHarness() {
  const [open, setOpen] = useState(false);
  const dialogRef = useModalDialog<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div>
      <button onClick={() => setOpen(true)} type="button">
        Open dialog
      </button>
      <p>Background content</p>
      {open && (
        <div aria-label="Test dialog" aria-modal="true" ref={dialogRef} role="dialog" tabIndex={-1}>
          <button data-dialog-initial-focus type="button">
            First action
          </button>
          <button onClick={() => setOpen(false)} type="button">
            Close dialog
          </button>
        </div>
      )}
    </div>
  );
}

describe('useModalDialog', () => {
  it('contains focus, dismisses with Escape, and restores the trigger', async () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    trigger.focus();
    fireEvent.click(trigger);

    const first = screen.getByRole('button', { name: 'First action' });
    const last = screen.getByRole('button', { name: 'Close dialog' });
    expect(first).toHaveFocus();
    expect(document.body).toHaveStyle({ overflow: 'hidden' });

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body).not.toHaveStyle({ overflow: 'hidden' });
  });
});
