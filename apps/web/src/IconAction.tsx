import { type ButtonHTMLAttributes, type ReactNode, useId } from 'react';

type IconTone = 'default' | 'accent' | 'success' | 'danger';

const toneClass: Record<IconTone, string> = {
  default: 'text-slate-500 hover:bg-slate-800 hover:text-slate-200',
  accent: 'text-sky-400 hover:bg-sky-500/10 hover:text-sky-300',
  success: 'text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200',
  danger: 'text-slate-500 hover:bg-rose-500/10 hover:text-rose-300',
};

export function IconAction({
  className = '',
  icon,
  label,
  tone = 'default',
  type = 'button',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: ReactNode;
  label: string;
  tone?: IconTone;
}) {
  const tooltipId = useId();
  return (
    <button
      {...props}
      aria-describedby={tooltipId}
      aria-label={label}
      className={`group/icon relative grid size-7 shrink-0 place-items-center rounded-md text-sm transition disabled:pointer-events-none disabled:opacity-45 ${toneClass[tone]} ${className}`}
      title={label}
      type={type}
    >
      <span aria-hidden="true" className="leading-none">
        {icon}
      </span>
      <span
        className="pointer-events-none absolute bottom-[calc(100%+0.4rem)] left-1/2 z-[80] -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-medium leading-none text-slate-200 opacity-0 shadow-xl transition-opacity group-hover/icon:opacity-100 group-focus-visible/icon:opacity-100"
        id={tooltipId}
        role="tooltip"
      >
        {label}
      </span>
    </button>
  );
}
