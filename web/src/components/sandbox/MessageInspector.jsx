import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { CodeBlock } from '@/components/sandbox/CodeBlock';
import { Callout } from '@/components/sandbox/Callout';
import { Endpoint } from '@/components/sandbox/Endpoint';
import { cn } from '@/lib/utils';

/**
 * A mensagem que a busca vai gerar, atrás de um disclosure.
 *
 * 🔴 Ela é útil de verdade — foi lendo o envelope que os 403 da LATAM caíram
 * um a um — mas é ferramenta de quem INTEGRA, não de quem vende. Antes isso
 * abria o passo de busca num cartão de tela cheia, com o XML inteiro e um
 * Advice, antes de existir qualquer resultado: documentação ocupando o lugar
 * do conteúdo. Aqui vive fechada, no rodapé.
 */
export function MessageInspector({ isLatam, xml }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          className={cn('size-4 shrink-0 transition-transform duration-200', open && 'rotate-90')}
          strokeWidth={1.5}
        />
        Ver a mensagem que sai daqui
        <span className="ml-auto font-mono text-xs">{isLatam ? 'IATA_AirShoppingRQ' : 'StartRouting'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t px-4 py-4">
          <Endpoint
            method="POST"
            path={
              isLatam
                ? 'https://sandbox.api.latam.com/ndc/v192/airshopping'
                : 'https://api.travelfusion.com/Xml'
            }
          />

          {isLatam ? (
            <>
              <CodeBlock code={xml} language="xml" title="IATA_AirShoppingRQ" maxHeight="26rem" />
              <Callout tone="advice" title="Advice">
                Os valores em <code className="font-mono text-xs">{'{{chaves}}'}</code> vêm do{' '}
                <code className="font-mono text-xs">.env</code> e não trafegam pelo navegador. Sem{' '}
                <code className="font-mono text-xs">TravelAgentID</code> a LATAM responde{' '}
                <strong>403122009 Missing Agent Info</strong> antes de olhar o itinerário.
              </Callout>
            </>
          ) : (
            <Callout tone="advice" title="Advice">
              O IP precisa estar na whitelist. Sem isso o{' '}
              <code className="font-mono text-xs">Login</code> passa e o comando seguinte volta{' '}
              <strong>4-3448 Login id not found</strong>.
            </Callout>
          )}
        </div>
      )}
    </div>
  );
}
