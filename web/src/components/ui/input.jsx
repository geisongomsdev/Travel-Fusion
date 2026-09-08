import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Campo do Material em modo `outline`: borda de 1px que engrossa e vira índigo
 * no foco. Sem sombra — no Material a elevação é do cartão, não do campo.
 */
const Input = React.forwardRef(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      'flex h-11 w-full rounded-lg border border-input bg-card px-3.5 text-sm transition-colors',
      'placeholder:text-muted-foreground hover:border-foreground/40',
      'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

/** Mesmo desenho do Input, para os `<select>` do formulário não destoarem. */
const Select = React.forwardRef(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'flex h-11 w-full rounded-lg border border-input bg-card px-3.5 text-sm transition-colors',
      'hover:border-foreground/40',
      'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Select.displayName = 'Select';

export { Input, Select };
