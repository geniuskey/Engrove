import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { twMerge } from 'tailwind-merge';

const button = cva(
  'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-sky-500 text-slate-950 hover:bg-sky-400 focus-visible:outline-sky-400',
        quiet: 'border border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800',
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
