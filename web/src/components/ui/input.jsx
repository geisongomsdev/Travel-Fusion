import * as React from 'react';
import { cn } from '@/lib/utils';

/** `sandbox/src/components/ui/input.tsx`: h-9, rounded-md, fundo transparente. */
const Input = React.forwardRef(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    data-slot="input"
    className={cn(
      'placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1.5 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
      'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px]',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

/** Mesmo desenho do `SelectTrigger` de lá, sem trazer o Radix junto. */
const Select = React.forwardRef(({ className, ...props }, ref) => (
  <select
    ref={ref}
    data-slot="select-trigger"
    className={cn(
      'border-input flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50',
      'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px]',
      className,
    )}
    {...props}
  />
));
Select.displayName = 'Select';

export { Input, Select };
