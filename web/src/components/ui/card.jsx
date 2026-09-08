import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Cartão de conteúdo das páginas do sandbox: branco, borda de 1px, sombra
 * quase imperceptível.
 *
 * 🔴 O header NÃO é mais uma faixa índigo. Aquilo era o `home-page-card-header`
 * de três cartõezinhos de navegação da home do portal — como padrão de todo
 * cartão virava uma barra pesada em cima de cada formulário. A hierarquia aqui
 * é tipográfica, que é como as páginas de operação realmente se organizam.
 */
const Card = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('shadow-card overflow-hidden rounded-lg border border-border bg-card text-card-foreground', className)}
    {...props}
  />
));
Card.displayName = 'Card';

const CardHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex flex-col gap-1 px-5 pb-3 pt-4', className)} {...props} />
));
CardHeader.displayName = 'CardHeader';

/** `##` da página de operação: peso 600, sem caixa alta. */
const CardTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h2 ref={ref} className={cn('text-[15px] font-semibold leading-tight text-primary', className)} {...props} />
));
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-[13px] leading-relaxed text-muted-foreground', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('px-5 pb-5', className)} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center gap-2 border-t border-border px-5 py-3', className)} {...props} />
));
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
