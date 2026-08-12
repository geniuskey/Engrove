import type { ReactNode } from 'react';
import { useI18n } from './i18n.js';

export function FormFieldLabel({
  children,
  required = false,
}: {
  children: ReactNode;
  required?: boolean;
}) {
  const { t } = useI18n();
  return (
    <span className="flex items-center justify-between gap-2">
      <span>{children}</span>
      <span
        aria-hidden="true"
        className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${required ? 'border-rose-400/30 bg-rose-400/10 text-rose-300' : 'border-slate-700 bg-slate-800/70 text-slate-400'}`}
      >
        {t(required ? 'common.required' : 'common.optional')}
      </span>
    </span>
  );
}

export function FormField({
  children,
  className = 'grid gap-1 text-xs text-slate-400',
  label,
  required = false,
}: {
  children: ReactNode;
  className?: string;
  label: ReactNode;
  required?: boolean;
}) {
  return (
    <label className={className}>
      <FormFieldLabel required={required}>{label}</FormFieldLabel>
      {children}
    </label>
  );
}
