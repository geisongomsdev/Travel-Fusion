import { cn } from '@/lib/utils';

/**
 * A faixa "### URL Endpoint" que abre toda página de operação do sandbox:
 * o método e a URL em destaque, monoespaçado, antes de qualquer explicação.
 */
const METHOD_TONE = {
  POST: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600',
  GET: 'border-sky-500/20 bg-sky-500/10 text-sky-600',
  DELETE: 'border-destructive/20 bg-destructive/10 text-destructive',
};

export function Endpoint({ method = 'POST', path, note, className }) {
  return (
    <div className={cn('rounded-lg bg-primary/5 px-3 py-2.5', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium',
            METHOD_TONE[method] ?? METHOD_TONE.POST,
          )}
        >
          {method}
        </span>
        <code className="break-all font-mono text-[13px] text-foreground">{path}</code>
      </div>
      {note && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{note}</p>}
    </div>
  );
}
