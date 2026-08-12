import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useModalDialog } from './useModalDialog.js';

afterEach(cleanup);

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

function NestedDialogHarness() {
  const [outerOpen, setOuterOpen] = useState(true);
  const [innerOpen, setInnerOpen] = useState(false);
  const outerRef = useModalDialog<HTMLDivElement>(outerOpen, () => setOuterOpen(false));
  const innerRef = useModalDialog<HTMLDivElement>(innerOpen, () => setInnerOpen(false));
  return (
    <>
      {outerOpen && (
        <div aria-label="Outer dialog" aria-modal="true" ref={outerRef} role="dialog" tabIndex={-1}>
          <button data-dialog-initial-focus onClick={() => setInnerOpen(true)} type="button">
            Open confirmation
          </button>
        </div>
      )}
      {innerOpen && (
        <div
          aria-label="Inner confirmation"
          aria-modal="true"
          ref={innerRef}
          role="alertdialog"
          tabIndex={-1}
        >
          <button data-dialog-initial-focus type="button">
            Cancel
          </button>
        </div>
      )}
    </>
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

  it('lets only the topmost nested dialog handle Escape', async () => {
    render(<NestedDialogHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }));
    expect(screen.getByRole('alertdialog', { name: 'Inner confirmation' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(
      screen.queryByRole('alertdialog', { name: 'Inner confirmation' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Outer dialog' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open confirmation' })).toHaveFocus(),
    );
  });
});
