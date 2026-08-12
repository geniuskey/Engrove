import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  separatorBefore?: boolean;
  onSelect: () => void;
}

export interface ContextMenuModel {
  label: string;
  x: number;
  y: number;
  items: ContextMenuItem[];
  returnFocus?: HTMLElement;
}

function preservesNativeMenu(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
  );
}

export function menuFromPointer(
  event: ReactMouseEvent<HTMLElement>,
  label: string,
  items: ContextMenuItem[],
): ContextMenuModel | undefined {
  if (preservesNativeMenu(event.target)) return undefined;
  event.preventDefault();
  event.stopPropagation();
  return { label, x: event.clientX, y: event.clientY, items, returnFocus: event.currentTarget };
}

export function menuFromKeyboard(
  event: ReactKeyboardEvent<HTMLElement>,
  label: string,
  items: ContextMenuItem[],
): ContextMenuModel | undefined {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return undefined;
  if (preservesNativeMenu(event.target)) return undefined;
  event.preventDefault();
  event.stopPropagation();
  const trigger = event.target instanceof HTMLElement ? event.target : event.currentTarget;
  const bounds = trigger.getBoundingClientRect();
  return {
    label,
    x: bounds.left + 16,
    y: bounds.top + 16,
    items,
    returnFocus: trigger,
  };
}

export function ContextMenu({
  menu,
  onClose,
}: {
  menu: ContextMenuModel | undefined;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!menu || !host.current) return;
    const bounds = host.current.getBoundingClientRect();
    const gutter = 8;
    setPosition({
      left: Math.max(gutter, Math.min(menu.x, window.innerWidth - bounds.width - gutter)),
      top: Math.max(gutter, Math.min(menu.y, window.innerHeight - bounds.height - gutter)),
    });
    host.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => onClose();
    const dismissOnPointer = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    document.addEventListener('pointerdown', dismissOnPointer);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      document.removeEventListener('pointerdown', dismissOnPointer);
    };
  }, [menu, onClose]);

  if (!menu) return null;
  return createPortal(
    <div
      aria-label={menu.label}
      className="fixed z-[100] min-w-52 rounded-lg border border-slate-700 bg-slate-950/95 p-1.5 text-xs shadow-2xl shadow-black/40 backdrop-blur-xl"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button'),
        ].filter((button) => !button.disabled);
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === 'Escape') {
          onClose();
          queueMicrotask(() => menu.returnFocus?.focus());
          return;
        }
        if (event.key === 'Tab') {
          onClose();
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        if (!buttons.length) return;
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : event.key === 'ArrowDown'
                ? (current + 1) % buttons.length
                : (current - 1 + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
      ref={host}
      role="menu"
      style={position}
    >
      <p className="max-w-64 truncate px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {menu.label}
      </p>
      {menu.items.map((item) => (
        <button
          className={`${item.separatorBefore ? 'mt-1 border-t border-slate-800 pt-2' : ''} flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left disabled:opacity-40 ${item.tone === 'danger' ? 'text-rose-300 hover:bg-rose-500/10' : 'text-slate-200 hover:bg-slate-800'}`}
          disabled={item.disabled}
          key={item.label}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          role="menuitem"
          type="button"
        >
          <span aria-hidden="true" className="w-4 text-center text-slate-500">
            {item.icon ?? ''}
          </span>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.shortcut && (
            <span aria-hidden="true" className="text-[10px] text-slate-600">
              {item.shortcut}
            </span>
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}
