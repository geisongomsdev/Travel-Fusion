import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatMoney } from '@/lib/utils';

/**
 * O bilhete.
 *
 * 🔴 É um COMPROVANTE, não um documento de embarque. O que vale no aeroporto é
 * o registro na companhia — este papel só reúne, num lugar só, o que a pessoa
 * precisa ter à mão: localizador, voo, horário e o que foi pago.
 *
 * 🔴 Tudo aqui vem do `/retrieve`, que pergunta à companhia. Nada é montado a
 * partir do que a tela guardou: um comprovante que repete a nossa anotação
 * mostraria o que a gente acha, não o que a companhia registrou.
 *
 * Imprimir abre o diálogo do navegador — de onde também se salva em PDF. Não
 * geramos arquivo: o navegador já faz isso, e melhor.
 */
export function VoucherDialog({ open, onOpenChange, locator, retrieved, paid, items }) {
  const passenger = retrieved?.passengers?.[0];
  // Os trechos físicos de todas as pernas, na ordem da viagem.
  const flights = (retrieved?.segments?.journeys ?? []).flatMap((journey) => journey.flights ?? []);
  const currency = retrieved?.booking?.currency;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bilhete</DialogTitle>
          <DialogDescription>
            Guarde o localizador. É por ele que a companhia te encontra no aeroporto.
          </DialogDescription>
        </DialogHeader>

        {/* `id` usado pelo CSS de impressão: só este bloco vai para o papel. */}
        <div id="voucher" className="space-y-5 rounded-lg border p-5">
          <div className="flex items-start justify-between gap-4 border-b pb-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Localizador</p>
              <p className="font-mono text-2xl font-semibold tracking-wide">{locator}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Situação</p>
              <p className="text-sm font-medium">Emitido</p>
            </div>
          </div>

          {passenger && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Passageiro</p>
              <p className="font-medium">{passenger.name}</p>
              {passenger.document?.number && (
                <p className="text-sm text-muted-foreground">Documento {passenger.document.number}</p>
              )}
              {/* 🔴 `[]` é legítimo: reserva sem emissão não tem documento. */}
              {passenger.tickets?.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Bilhete {passenger.tickets.map((ticket) => ticket.ticketNumber).filter(Boolean).join(', ')}
                </p>
              )}
            </div>
          )}

          {flights.length > 0 && (
            <div className="space-y-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Voo</p>
              {flights.map((segment, index) => (
                <div key={segment.segmentId ?? index} className="rounded-md border px-3 py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium tabular-nums">
                      {segment.origin} {formatClock(segment.departure)} → {segment.destination}{' '}
                      {formatClock(segment.arrival)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {segment.company?.code}
                      {segment.company?.number}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatDay(segment.departure)}
                    {segment.cabin ? ` · ${segment.cabin.toLowerCase()}` : ''}
                    {segment.aircraft ? ` · ${segment.aircraft}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}

          {items?.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Extras</p>
              {items.map((item, index) => (
                <p key={item.key ?? index} className="text-sm">
                  {item.name ?? 'Serviço'}
                  {item.emdNumber ? ` · ${item.emdNumber}` : ''}
                </p>
              ))}
            </div>
          )}

          {paid != null && (
            <div className="flex items-baseline justify-between border-t pt-4">
              <p className="text-sm">Total pago</p>
              <p className="text-lg font-semibold tabular-nums">{formatMoney(paid, currency)}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => window.print()}>
            <Printer /> Imprimir ou salvar em PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** `2026-11-20T07:10:00` → `07:10`. Sem fuso: o horário do bilhete é o local. */
function formatClock(value) {
  const match = /T(\d{2}:\d{2})/.exec(value ?? '');
  return match ? match[1] : '—';
}

/** `2026-11-20T07:10:00` → `20 de nov.` */
function formatDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
