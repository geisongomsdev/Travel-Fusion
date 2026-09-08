import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * `mat-stepper` horizontal: o fluxo do contrato na ordem
 * buscar → escolher → tarifar → reservar → finalizar.
 *
 * O traço entre os passos preenche até onde a venda chegou — é o que dá a
 * noção de progresso sem uma barra separada.
 */
export function Steps({ steps, current }) {
  return (
    <ol className="flex flex-wrap items-center gap-y-3 text-sm">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors',
                done && 'border-primary bg-primary text-primary-foreground',
                active && 'border-brand bg-brand text-brand-foreground',
                !done && !active && 'border-border bg-card text-muted-foreground',
              )}
            >
              {done ? <Check className="h-4 w-4" /> : index + 1}
            </span>
            <span
              className={cn(
                'whitespace-nowrap',
                active && 'font-medium text-foreground',
                done && 'text-foreground',
                !done && !active && 'text-muted-foreground',
              )}
            >
              {step.label}
            </span>
            {index < steps.length - 1 && (
              <span
                className={cn('mx-2 h-0.5 w-8 rounded-full transition-colors', done ? 'bg-primary' : 'bg-border')}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
