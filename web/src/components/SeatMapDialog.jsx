import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn, formatMoney } from '@/lib/utils';

/**
 * Mapa de assentos.
 *
 * 🔴 `available: false` NUNCA vira clicável. É a mesma regra do contrato para
 * marcar assento fora do mapa: melhor não oferecer do que oferecer e falhar
 * depois — o passageiro não tem como saber que o lugar já era de outro.
 */
export function SeatMapDialog({ open, onOpenChange, seatMap, loading, selected, onSelect }) {
  const cabin = seatMap?.segments?.[0]?.cabins?.[0] ?? null;
  const rows = cabin?.rows ?? [];

  // As colunas saem das próprias fileiras: cada aeronave tem a sua largura.
  const columns = [...new Set(rows.flatMap((row) => row.seats.map((seat) => seat.column)))]
    .filter(Boolean)
    .sort();

  const chosen = selected ? rows.flatMap((row) => row.seats).find((seat) => seat.seat === selected) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Escolha seu assento</DialogTitle>
          <DialogDescription>
            {cabin?.cabinClass ? `Cabine ${cabin.cabinClass.toLowerCase()}. ` : ''}
            Assentos em cinza já estão ocupados.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Carregando o mapa…
          </div>
        ) : rows.length === 0 ? (
          /* Mapa ilegível degrada: a API devolve `segments: []` e a tela diz isso. */
          <p className="py-16 text-center text-sm text-muted-foreground">
            Mapa de assentos indisponível para este voo.
          </p>
        ) : (
          <div className="max-h-[22rem] overflow-y-auto">
            <div className="mx-auto w-fit space-y-1">
              {/* Cabeçalho de colunas, para orientar quem lê. */}
              <div className="flex items-center gap-1 pb-1">
                <span className="w-7" />
                {columns.map((column) => (
                  <span key={column} className="w-8 text-center text-[11px] text-muted-foreground">
                    {column}
                  </span>
                ))}
              </div>

              {rows.map((row) => (
                <div key={row.number} className="flex items-center gap-1">
                  <span className="w-7 text-right text-[11px] tabular-nums text-muted-foreground">
                    {row.number}
                  </span>
                  {columns.map((column) => {
                    const seat = row.seats.find((candidate) => candidate.column === column);
                    if (!seat) return <span key={column} className="w-8" />;

                    const isSelected = seat.seat === selected;

                    return (
                      <button
                        key={column}
                        type="button"
                        disabled={!seat.available}
                        onClick={() => onSelect(seat)}
                        title={
                          seat.available
                            ? `${seat.seat}${seat.price ? ` · ${formatMoney(seat.price.total, seat.price.currency)}` : ''}`
                            : `${seat.seat} · ocupado`
                        }
                        className={cn(
                          'size-8 rounded-md border text-[10px] font-medium transition-colors',
                          !seat.available && 'cursor-not-allowed border-transparent bg-muted text-muted-foreground/40',
                          seat.available && !isSelected && 'border-border hover:border-primary hover:bg-accent',
                          isSelected && 'border-primary bg-primary text-primary-foreground',
                        )}
                      >
                        {column}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {chosen
              ? `Assento ${chosen.seat}${chosen.price ? ` · ${formatMoney(chosen.price.total, chosen.price.currency)}` : ''}`
              : 'Nenhum assento escolhido'}
          </p>
          <Button onClick={() => onOpenChange(false)}>Pronto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
