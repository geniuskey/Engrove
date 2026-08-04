import { type RefObject, useLayoutEffect, useRef } from 'react';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let scrollLockCount = 0;
let savedBodyOverflow = '';

/**
 * Supplies the interaction contract shared by modal dialogs and drawers:
 * initial focus, focus containment, Escape dismissal, background inertness,
 * body scroll locking, and focus restoration.
 */
export function useModalDialog<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  restoreFocusRef?: RefObject<HTMLElement | null>,
): RefObject<T | null> {
  const dialogRef = useRef<T>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const active = document.activeElement;
    previousFocusRef.current =
      restoreFocusRef?.current ??
      (active instanceof HTMLElement && !dialog.contains(active) ? active : null);

    const inerted: Array<{ element: HTMLElement; inert: boolean }> = [];
    let branch: HTMLElement = dialog;
    while (branch.parentElement && branch.parentElement !== document.body) {
      const parent = branch.parentElement;
      for (const sibling of parent.children) {
        if (
          sibling === branch ||
          !(sibling instanceof HTMLElement) ||
          sibling.hasAttribute('data-modal-backdrop')
        )
          continue;
        inerted.push({ element: sibling, inert: sibling.inert });
        sibling.inert = true;
      }
      branch = parent;
    }

    if (scrollLockCount++ === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    const candidates = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
      );
    const initial = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]');
    (initial ?? candidates()[0] ?? dialog).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = candidates();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0]!;
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      for (const { element, inert } of inerted) element.inert = inert;
      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount === 0) document.body.style.overflow = savedBodyOverflow;
      const restore = restoreFocusRef?.current ?? previousFocusRef.current;
      if (restore?.isConnected) window.requestAnimationFrame(() => restore.focus());
    };
  }, [open, restoreFocusRef]);

  return dialogRef;
}
