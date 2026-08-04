import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { twMerge } from 'tailwind-merge';

const button = cva(
  'engrove-button inline-flex min-h-9 items-center justify-center rounded-lg px-3.5 py-2 text-sm font-semibold shadow-sm transition duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:translate-y-px disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        primary:
          'bg-sky-400 text-slate-950 shadow-md shadow-sky-950/20 hover:-translate-y-px hover:bg-sky-300 hover:shadow-lg focus-visible:outline-sky-400',
        quiet:
          'border border-slate-700/80 bg-slate-900/80 text-slate-200 hover:border-slate-600 hover:bg-slate-800/90 hover:text-slate-100 focus-visible:outline-sky-400',
      },
    },
    defaultVariants: { variant: 'primary' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  asChild?: boolean;
}

export function Button({ asChild, className, variant, ...props }: PropsWithChildren<ButtonProps>) {
  const Component = asChild ? Slot : 'button';
  return <Component className={twMerge(clsx(button({ variant }), className))} {...props} />;
}
