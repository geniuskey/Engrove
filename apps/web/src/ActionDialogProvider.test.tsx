import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ActionDialogProvider, useActionDialog } from './ActionDialogProvider.js';

afterEach(cleanup);

function Harness() {
  const { confirmAction, promptText } = useActionDialog();
  const [result, setResult] = useState('none');
  return (
    <>
      <button
        onClick={() =>
          void confirmAction('Archive this task?', { tone: 'danger' }).then((confirmed) =>
            setResult(String(confirmed)),
          )
        }
        type="button"
      >
        Ask confirmation
      </button>
      <button
        onClick={() =>
          void promptText('Rename this view', 'Current name', {
            label: 'View name',
            required: true,
          }).then((value) => setResult(value ?? 'cancelled'))
        }
        type="button"
      >
        Ask value
      </button>
      <output>{result}</output>
    </>
  );
}

describe('ActionDialogProvider', () => {
  it('confirms destructive actions without using a browser-native dialog', async () => {
    render(
      <ActionDialogProvider>
        <Harness />
      </ActionDialogProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Ask confirmation' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('alertdialog', { name: 'Confirm action' })).toHaveTextContent(
      'Archive this task?',
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(screen.getByText('true')).toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('collects required text and cancels with Escape', async () => {
    render(
      <ActionDialogProvider>
        <Harness />
      </ActionDialogProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Ask value' });
    trigger.focus();
    fireEvent.click(trigger);

    const input = screen.getByRole('textbox', { name: 'View name' });
    expect(input).toHaveValue('Current name');
    fireEvent.change(input, { target: { value: 'Reviewed view' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText('Reviewed view')).toBeInTheDocument());

    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByText('cancelled')).toBeInTheDocument());
  });
});
