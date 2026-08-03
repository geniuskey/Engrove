import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  ContextMenu,
  type ContextMenuModel,
  menuFromKeyboard,
  menuFromPointer,
} from './ContextMenu.js';

describe('ContextMenu', () => {
  it('supports pointer and keyboard invocation while preserving native input menus', () => {
    const first = vi.fn();
    const second = vi.fn();

    function Harness() {
      const [menu, setMenu] = useState<ContextMenuModel>();
      const items = [
        { label: 'First action', onSelect: first },
        { label: 'Second action', onSelect: second },
      ];
      return (
        <div onContextMenu={(event) => setMenu(menuFromPointer(event, 'Test target', items))}>
          <button
            onKeyDown={(event) => {
              const next = menuFromKeyboard(event, 'Test target', items);
              if (next) setMenu(next);
            }}
            type="button"
          >
            Target
          </button>
          <input aria-label="Editable value" />
          <ContextMenu menu={menu} onClose={() => setMenu(undefined)} />
        </div>
      );
    }

    render(<Harness />);
    const target = screen.getByRole('button', { name: 'Target' });
    fireEvent.contextMenu(target, { clientX: 40, clientY: 60 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'First action' }));
    expect(first).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.keyDown(target, { key: 'F10', shiftKey: true });
    const firstItem = screen.getByRole('menuitem', { name: 'First action' });
    const secondItem = screen.getByRole('menuitem', { name: 'Second action' });
    expect(firstItem).toHaveFocus();
    fireEvent.keyDown(firstItem, { key: 'ArrowDown' });
    expect(secondItem).toHaveFocus();
    fireEvent.keyDown(secondItem, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    expect(fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Editable value' }))).toBe(
      true,
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
