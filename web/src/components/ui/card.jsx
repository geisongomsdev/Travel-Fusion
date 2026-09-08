import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * `mat-card` do portal: branco, raio 4px, elevação 1. A borda some — no
 * Material a separação vem da sombra, não de um traço.
 */
const Card = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('elevation-1 overflow-hidden rounded-lg bg-card text-card-foreground', className)}
    {...props}
  />
));
Card.displayName = 'Card';

/**
 * `home-page-card-header`: faixa índigo com texto claro no topo do cartão.
 * É o componente que dá a cara do portal — por isso é o padrão aqui, com
 * `tone="plain"` para os cartões secundários que não devem competir.
 */
const CardHeader = React.forwardRef(({ className, tone = 'brand', ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex flex-col gap-1 px-4 py-3',
      tone === 'brand' && 'bg-primary text-primary-foreground',
      tone === 'plain' && 'border-b border-border',
      className,
    )}
    {...props}
  />
));
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h3 ref={ref} className={cn('text-base font-medium leading-tight tracking-tight', className)} {...props} />
));
CardTitle.displayName = 'CardTitle';

/** Herda a cor do header, por isso `opacity` no lugar de uma cor fixa. */
const CardDescription = React.forwardRef(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-xs opacity-80', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-4', className)} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center gap-2 border-t border-border px-4 py-3', className)} {...props} />
));
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
