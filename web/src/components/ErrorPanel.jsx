import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/**
 * O contrato de erro renderizado como ele é. O `code` é o que a tela ramifica —
 * a `message` vem em inglês do catálogo e não é traduzida.
 */
export function ErrorPanel({ error }) {
  if (!error) return null;
  return (
    <div className="elevation-1 rounded-lg border-l-4 border-destructive bg-card p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="destructive">{error.code}</Badge>
            {error.status && <Badge variant="outline">HTTP {error.status}</Badge>}
          </div>
          <p className="text-sm">{error.message}</p>

          {error.details?.errors && (
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {Object.entries(error.details.errors).map(([field, messages]) => (
                <li key={field}>
                  <span className="font-medium text-foreground">{field}</span>: {messages.join(', ')}
                </li>
              ))}
            </ul>
          )}

          {error.providerError && (
            <p className="text-xs text-muted-foreground">
              Provedor: {error.providerError.providerCode || '—'} · {error.providerError.providerMessage || 'sem mensagem'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
