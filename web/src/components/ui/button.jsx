import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * `mat-raised-button` do portal: caixa alta, peso 500, raio 4px e elevação que
 * sobe no hover. `brand` é o vermelho LATAM e fica só na ação que avança o
 * fluxo (buscar, tarifar, reservar); `default` é o índigo estrutural.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium uppercase tracking-wide transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default: 'elevation-1 bg-primary text-primary-foreground hover:elevation-2 hover:bg-primary/90',
        brand: 'elevation-1 bg-brand text-brand-foreground hover:elevation-2 hover:bg-brand/90',
        outline: 'border border-input bg-transparent hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'elevation-1 bg-destructive text-destructive-foreground hover:bg-destructive/90',
        // Botão dentro do toolbar índigo: só o hover translúcido, como no Material.
        toolbar: 'text-primary-foreground hover:bg-white/15',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-8',
        icon: 'h-9 w-9 px-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = 'Button';

export { Button, buttonVariants };
