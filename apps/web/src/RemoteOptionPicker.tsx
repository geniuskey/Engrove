import { createPortal } from 'react-dom';
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { api } from './App.js';

export interface PickerSpecialOption {
  value: string;
  label: string;
}

interface RemoteOptionPickerProps<T extends { id: string }> {
  ariaLabel: string;
  className?: string;
  defaultValue?: string | undefined;
  disabled?: boolean;
  endpoint: (query: string, limit: number) => string;
  filterOption?: (option: T) => boolean;
  getLabel: (option: T) => string;
  initialOptions: T[];
  loadError: string;
  name?: string;
  noResults: string;
  refineMessage: string;
  renderMeta?: (option: T) => ReactNode;
  resolveUnknown?: boolean;
  specialOptions?: PickerSpecialOption[];
  value?: string | undefined;
  onChange?: ((value: string, option?: T) => void) | undefined;
  onOptionResolved?: ((option: T) => void) | undefined;
}

function unique<T extends { id: string }>(options: T[]): T[] {
  const seen = new Set<string>();
  return options.filter((option) => !seen.has(option.id) && Boolean(seen.add(option.id)));
}

export function RemoteOptionPicker<T extends { id: string }>({
  ariaLabel,
  className = '',
  defaultValue = '',
  disabled = false,
  endpoint,
  filterOption,
  getLabel,
  initialOptions,
  loadError,
  name,
  noResults,
  refineMessage,
  renderMeta,
  resolveUnknown = false,
  specialOptions = [],
  value,
  onChange,
  onOptionResolved,
}: RemoteOptionPickerProps<T>) {
  const id = useId().replace(/:/g, '');
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const ignoreNextFocus = useRef(false);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [resolved, setResolved] = useState<T>();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<T[]>(() =>
    initialOptions.filter((candidate) => filterOption?.(candidate) ?? true).slice(0, 20),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({
    left: 0,
    top: 0,
    width: 240,
    maxHeight: 256,
  });
  const selectedValue = value ?? internalValue;
  const option =
    resolved?.id === selectedValue
      ? resolved
      : initialOptions.find((candidate) => candidate.id === selectedValue);
  const special = specialOptions.find((candidate) => candidate.value === selectedValue);

  function close() {
    setOpen(false);
    setQuery('');
    setError('');
  }

  function openPicker() {
    if (disabled) return;
    const bounds = rootRef.current?.getBoundingClientRect();
    if (bounds) {
      const gutter = 8;
      const gap = 4;
      const maximumHeight = 256;
      const minimumUsefulHeight = 96;
      const availableBelow = Math.max(0, window.innerHeight - bounds.bottom - gutter);
      const availableAbove = Math.max(0, bounds.top - gutter);
      const openAbove =
        availableBelow < Math.min(maximumHeight, minimumUsefulHeight) &&
        availableAbove > availableBelow;
      const availableHeight = openAbove ? availableAbove : availableBelow;
      const width = Math.min(Math.max(bounds.width, 240), window.innerWidth - gutter * 2);
      setPosition({
        left: Math.max(gutter, Math.min(bounds.left, window.innerWidth - width - gutter)),
        top: openAbove ? bounds.top - gap : bounds.bottom + gap,
        width,
        maxHeight: Math.max(
          minimumUsefulHeight,
          Math.min(maximumHeight, availableHeight || minimumUsefulHeight),
        ),
        transform: openAbove ? 'translateY(-100%)' : undefined,
      });
    }
    setResults(
      unique([...(option ? [option] : []), ...initialOptions])
        .filter((candidate) => filterOption?.(candidate) ?? true)
        .slice(0, 20),
    );
    setQuery('');
    setOpen(true);
  }

  function choose(nextValue: string, nextOption?: T) {
    if (value === undefined) setInternalValue(nextValue);
    if (nextOption) {
      setResolved(nextOption);
      onOptionResolved?.(nextOption);
    }
    onChange?.(nextValue, nextOption);
    close();
    requestAnimationFrame(() => {
      const input = rootRef.current?.querySelector<HTMLInputElement>('[role="combobox"]');
      if (!input || document.activeElement === input) return;
      ignoreNextFocus.current = true;
      input.focus();
    });
  }

  useEffect(() => {
    if (!resolveUnknown || !selectedValue || special || option) return;
    const request = ++requestId.current;
    void api<{ items: T[] }>(endpoint(selectedValue, 1)).then(
      (response) => {
        if (request !== requestId.current) return;
        const match = response.items.find(
          (candidate) => candidate.id === selectedValue && (filterOption?.(candidate) ?? true),
        );
        if (!match) return;
        setResolved(match);
        onOptionResolved?.(match);
      },
      () => undefined,
    );
  }, [endpoint, filterOption, onOptionResolved, option, resolveUnknown, selectedValue, special]);

  useEffect(() => {
    if (!open) return;
    const request = ++requestId.current;
    const timeout = window.setTimeout(() => {
      const normalizedQuery = query.trim();
      setLoading(true);
      setError('');
      void api<{
        items: T[];
        pageInfo?: { hasMore?: boolean; hasNext?: boolean };
      }>(endpoint(normalizedQuery, 20))
        .then((response) => {
          if (request !== requestId.current) return;
          setResults(
            unique([...(option && !normalizedQuery ? [option] : []), ...response.items]).filter(
              (candidate) => filterOption?.(candidate) ?? true,
            ),
          );
          setHasMore(response.pageInfo?.hasMore ?? response.pageInfo?.hasNext ?? false);
        })
        .catch(() => {
          if (request !== requestId.current) return;
          setResults(option && !normalizedQuery ? [option] : []);
          setHasMore(false);
          setError(loadError);
        })
        .finally(() => {
          if (request === requestId.current) setLoading(false);
        });
    }, 200);
    return () => clearTimeout(timeout);
  }, [endpoint, filterOption, loadError, open, option, query]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      rootRef.current?.querySelector<HTMLInputElement>('[role="combobox"]')?.focus();
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', keyboard);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', keyboard);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  useEffect(() => {
    if (!name || value !== undefined) return;
    const form = rootRef.current?.closest('form');
    if (!form) return;
    const reset = () => {
      setInternalValue(defaultValue);
      setResolved(undefined);
      close();
    };
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, [defaultValue, name, value]);

  return (
    <div className="relative" ref={rootRef}>
      {name && <input name={name} type="hidden" value={selectedValue} />}
      <input
        aria-autocomplete="list"
        aria-controls={`remote-options-${id}`}
        aria-expanded={open}
        aria-label={ariaLabel}
        className={className}
        disabled={disabled}
        onClick={() => {
          if (!open) openPicker();
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          if (!open) openPicker();
        }}
        onFocus={() => {
          if (ignoreNextFocus.current) ignoreNextFocus.current = false;
          else openPicker();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' || !open) return;
          event.preventDefault();
          menuRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus();
        }}
        placeholder={ariaLabel}
        role="combobox"
        value={open ? query : (special?.label ?? (option ? getLabel(option) : selectedValue))}
      />
      {open &&
        createPortal(
          <div
            className="fixed z-[140] max-h-64 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 p-1 shadow-2xl shadow-black/50"
            id={`remote-options-${id}`}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              const options = [
                ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []),
              ];
              const index = options.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === 'ArrowDown'
                  ? options[(index + 1) % options.length]
                  : options[(index - 1 + options.length) % options.length];
              if (!next) return;
              event.preventDefault();
              next.focus();
            }}
            ref={menuRef}
            role="listbox"
            style={position}
          >
            {!query.trim() &&
              specialOptions.map((candidate) => (
                <button
                  aria-selected={selectedValue === candidate.value}
                  className={`flex min-h-8 w-full items-center rounded-md px-2 text-left text-xs hover:bg-slate-800 ${selectedValue === candidate.value ? 'bg-sky-400/10 text-sky-300' : 'text-slate-300'}`}
                  key={`special-${candidate.value || 'empty'}`}
                  onClick={() => choose(candidate.value)}
                  role="option"
                  type="button"
                >
                  {candidate.label}
                </button>
              ))}
            {results.map((candidate) => (
              <button
                aria-selected={selectedValue === candidate.id}
                className={`flex min-h-9 w-full items-center justify-between gap-3 rounded-md px-2 text-left hover:bg-slate-800 ${selectedValue === candidate.id ? 'bg-sky-400/10' : ''}`}
                key={candidate.id}
                onClick={() => choose(candidate.id, candidate)}
                role="option"
                type="button"
              >
                <span className="truncate text-xs text-slate-200">{getLabel(candidate)}</span>
                {renderMeta?.(candidate)}
              </button>
            ))}
            {!loading && results.length === 0 && !error && (
              <p className="px-2 py-3 text-center text-[10px] text-slate-500">{noResults}</p>
            )}
            {loading && <p className="px-2 py-2 text-center text-[10px] text-slate-500">…</p>}
            {error && <p className="px-2 py-2 text-center text-[10px] text-rose-300">{error}</p>}
            {hasMore && (
              <p className="border-t border-slate-800 px-2 py-2 text-[9px] text-slate-500">
                {refineMessage}
              </p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
