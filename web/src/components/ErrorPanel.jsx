import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/sandbox/Callout';
import { CodeBlock } from '@/components/sandbox/CodeBlock';

/**
 * O contrato de erro renderizado como ele é. O `code` é o que a tela ramifica —
 * a `message` vem em inglês do catálogo e não é traduzida.
 *
 * O erro do PROVEDOR aparece no bloco escuro: é lá que mora o
 * `cvc-complex-type` que diz qual campo do XSD faltou, e esconder isso atrás de
 * um resumo é justamente o que faz perder uma tarde de depuração.
 */
export function ErrorPanel({ error }) {
  if (!error) return null;

  return (
    <Callout tone="error" title={null}>
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="destructive">{error.code}</Badge>
          {error.status && <Badge variant="outline">HTTP {error.status}</Badge>}
          {error.providerError?.provider && <Badge variant="outline">{error.providerError.provider}</Badge>}
        </div>

        <p className="font-medium">{error.message}</p>

        {error.details?.errors && (
          <ul className="space-y-0.5 text-[13px] text-muted-foreground">
            {Object.entries(error.details.errors).map(([field, messages]) => (
              <li key={field}>
                <code className="font-mono text-[12px] text-foreground">{field}</code>: {messages.join(', ')}
              </li>
            ))}
          </ul>
        )}

        {error.providerError && (
          <CodeBlock
            code={JSON.stringify(error.providerError, null, 2)}
            language="json"
            title={`erro do provedor · ${error.providerError.operation ?? ''}`}
            maxHeight="16rem"
          />
        )}
      </div>
    </Callout>
  );
}
