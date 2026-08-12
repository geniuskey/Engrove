import {
  createContext,
  type FormEvent,
  type PropsWithChildren,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
} from 'react';
import { Button } from '@engrove/ui';
import { useI18n } from './i18n.js';
import { useModalDialog } from './useModalDialog.js';

export interface ConfirmActionOptions {
  confirmLabel?: string;
  title?: string;
  tone?: 'default' | 'danger';
}

export interface PromptTextOptions {
  confirmLabel?: string;
  label?: string;
  maxLength?: number;
  required?: boolean;
  title?: string;
}

interface ActionDialogValue {
  confirmAction: (message: string, options?: ConfirmActionOptions) => Promise<boolean>;
  promptText: (
    message: string,
    initialValue?: string,
    options?: PromptTextOptions,
  ) => Promise<string | null>;
}

type ActionRequest =
  | {
      id: number;
      kind: 'confirm';
      message: string;
      options: ConfirmActionOptions;
      resolve: (value: boolean) => void;
    }
  | {
      id: number;
      kind: 'prompt';
      initialValue: string;
      message: string;
      options: PromptTextOptions;
      resolve: (value: string | null) => void;
    };

const fallbackValue: ActionDialogValue = {
  confirmAction: async (message) => window.confirm(message),
  promptText: async (message, initialValue) => window.prompt(message, initialValue ?? ''),
};

const ActionDialogContext = createContext<ActionDialogValue>(fallbackValue);

export function ActionDialogProvider({ children }: PropsWithChildren) {
  const [current, setCurrent] = useState<ActionRequest | null>(null);
  const currentRef = useRef<ActionRequest | null>(null);
  const queueRef = useRef<ActionRequest[]>([]);
  const nextIdRef = useRef(1);

  const enqueue = useCallback((request: ActionRequest) => {
    if (currentRef.current) queueRef.current.push(request);
    else {
      currentRef.current = request;
      setCurrent(request);
    }
  }, []);

  const confirmAction = useCallback<ActionDialogValue['confirmAction']>(
    (message, options = {}) =>
      new Promise<boolean>((resolve) => {
        enqueue({
          id: nextIdRef.current++,
          kind: 'confirm',
          message,
          options,
          resolve,
        });
      }),
    [enqueue],
  );

  const promptText = useCallback<ActionDialogValue['promptText']>(
    (message, initialValue = '', options = {}) =>
      new Promise<string | null>((resolve) => {
        enqueue({
          id: nextIdRef.current++,
          kind: 'prompt',
          initialValue,
          message,
          options,
          resolve,
        });
      }),
    [enqueue],
  );

  const settle = useCallback((value: boolean | string | null) => {
    const active = currentRef.current;
    if (!active) return;
    if (active.kind === 'confirm') active.resolve(value === true);
    else active.resolve(typeof value === 'string' ? value : null);
    const next = queueRef.current.shift() ?? null;
    currentRef.current = next;
    setCurrent(next);
  }, []);

  return (
    <ActionDialogContext.Provider value={{ confirmAction, promptText }}>
      {children}
      {current && <ActionDialog key={current.id} request={current} settle={settle} />}
    </ActionDialogContext.Provider>
  );
}

function ActionDialog({
  request,
  settle,
}: {
  request: ActionRequest;
  settle: (value: boolean | string | null) => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const [value, setValue] = useState(request.kind === 'prompt' ? request.initialValue : '');
  const close = () => settle(request.kind === 'confirm' ? false : null);
  const dialogRef = useModalDialog<HTMLDivElement>(true, close);
  const title =
    request.options.title ??
    t(request.kind === 'confirm' ? 'dialog.confirmTitle' : 'dialog.promptTitle');
  const confirmLabel = request.options.confirmLabel ?? t('dialog.confirm');
  const danger = request.kind === 'confirm' && request.options.tone === 'danger';

  function submit(event: FormEvent) {
    event.preventDefault();
    if (request.kind === 'confirm') settle(true);
    else if (!request.options.required || value.trim()) settle(value);
  }

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/75 p-4 backdrop-blur-sm"
      data-modal-backdrop
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-950 p-5 text-slate-100 shadow-2xl shadow-black/40 sm:p-6"
        ref={dialogRef}
        role={request.kind === 'confirm' ? 'alertdialog' : 'dialog'}
        tabIndex={-1}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${danger ? 'bg-rose-400/15 text-rose-300' : 'bg-sky-400/15 text-sky-300'}`}
          >
            {danger ? '!' : request.kind === 'prompt' ? '✎' : '?'}
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold" id={titleId}>
              {title}
            </h2>
            <p
              className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-400"
              id={descriptionId}
            >
              {request.message}
            </p>
          </div>
        </div>
        <form className="mt-5" onSubmit={submit}>
          {request.kind === 'prompt' && (
            <label className="grid gap-1.5 text-xs text-slate-300">
              <span>{request.options.label ?? t('dialog.value')}</span>
              <input
                className="min-h-10 w-full rounded-lg border border-slate-700/80 bg-slate-900/85 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400 focus:ring-3 focus:ring-sky-400/15"
                data-dialog-initial-focus
                maxLength={request.options.maxLength ?? 120}
                onChange={(event) => setValue(event.target.value)}
                required={request.options.required}
                value={value}
              />
            </label>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              data-dialog-initial-focus={request.kind === 'confirm' ? true : undefined}
              onClick={close}
              type="button"
              variant="quiet"
            >
              {t('common.cancel')}
            </Button>
            <Button
              className={
                danger
                  ? 'border border-rose-400/50 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'
                  : undefined
              }
              disabled={request.kind === 'prompt' && request.options.required && !value.trim()}
              type="submit"
              variant={danger ? 'quiet' : 'primary'}
            >
              {confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function useActionDialog(): ActionDialogValue {
  return useContext(ActionDialogContext);
}
