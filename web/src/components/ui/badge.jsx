import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/** `sandbox/src/components/ui/badge.tsx`: rounded-md, não pílula. */
const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none transition-[color,box-shadow] overflow-hidden',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-white',
        outline: 'text-foreground',
        /**
         * Pílula de status do `ServiceDetailModal`: fundo /10, texto /600 e
         * borda /20 da mesma cor. É assim que status entra na tela lá.
         */
        success: 'rounded-full border-emerald-500/20 bg-emerald-500/10 text-emerald-600',
        warning: 'rounded-full border-amber-500/20 bg-amber-500/10 text-amber-600',
        info: 'rounded-full border-violet-500/20 bg-violet-500/10 text-violet-600',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Badge({ className, variant, ...props }) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
