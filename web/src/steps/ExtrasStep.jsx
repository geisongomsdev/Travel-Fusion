import { useState } from 'react';
import { Armchair, Check, Loader2, Luggage, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SeatMapDialog } from '@/components/SeatMapDialog';
import { cn, formatMoney } from '@/lib/utils';

/**
 * Assento e bagagem DEPOIS da passagem paga.
 *
 * 🔴 Este catálogo não é o mesmo da tela de revisão. Lá os assentos são da
 * OFERTA e servem para escolher antes de reservar; aqui são da RESERVA, e são
 * os únicos que a companhia aceita vender depois da emissão. A chave (`key`)
 * de cada item vem deste catálogo e volta intacta na compra.
 *
 * 🔴 O total cobrado é somado pela API a partir do catálogo da companhia, não
 * por esta tela. O número abaixo é conferência para quem compra.
 */
export function ExtrasStep({
  locator,
  currency,
  seatMap,
  ancillaries,
  loading,
  running,
  purchase,
  onLoad,
  onBuy,
}) {
  const [mapOpen, setMapOpen] = useState(false);
  const [seat, setSeat] = useState(null);
  const [bags, setBags] = useState([]);
  const [card, setCard] = useState({
    brand: 'VI',
    holderName: 'ANDY PETERSON',
    number: '4000000000002701',
    cvv: '737',
    expiryDate: '03/2030',
    holderDocument: '52998224725',
    holderBirthDate: '1990-04-21',
  });

  const money = seatMap?.currency ?? currency ?? 'BRL';
  const total = (seat?.price?.total ?? 0) + bags.reduce((sum, bag) => sum + (bag.price?.total ?? 0), 0);

  const toggleBag = (item) =>
    setBags((prev) => (
      prev.some((x) => x.key === item.key)
        ? prev.filter((x) => x.key !== item.key)
        : [...prev, item]
    ));

  if (purchase) return <ExtrasResult purchase={purchase} currency={money} />;

  const buy = () => {
    const items = [];
    if (seat) {
      items.push({
        key: seat.key,
        passengerId: firstPassenger(seatMap),
        segmentId: firstSegment(seatMap),
        type: 'seat',
        row: seat.row,
        column: seat.column,
      });
    }
    for (const bag of bags) {
      items.push({
        key: bag.key,
        passengerId: bag.passengerId ?? firstPassenger(seatMap),
        ...(bag.segmentId ? { segmentId: bag.segmentId } : {}),
        ...(bag.type ? { type: bag.type } : {}),
      });
    }
    // Total zero é assento cortesia: a companhia liquida por BSP, sem cartão.
    onBuy({ items, creditCard: total > 0 ? card : undefined });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Assento e bagagem</CardTitle>
          <CardDescription>
            A passagem {locator} já está paga. O que você escolher aqui é cobrado à parte.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!seatMap && !ancillaries && (
            <Button variant="outline" disabled={loading} onClick={onLoad}>
              {loading ? <Loader2 className="animate-spin" /> : null}
              Ver o que está disponível
            </Button>
          )}

          {seatMap && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Armchair className="size-4 opacity-50" strokeWidth={1.5} /> Assento
                </p>
                <Button variant="outline" size="sm" onClick={() => setMapOpen(true)}>
                  {seat ? 'Trocar assento' : 'Escolher assento'}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {seat
                  ? `Assento ${seat.seat} · ${formatMoney(seat.price?.total, money)}`
                  : 'Nenhum assento escolhido.'}
              </p>
            </div>
          )}

          {ancillaries?.length > 0 && (
            <div className="space-y-2 border-t pt-6">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Luggage className="size-4 opacity-50" strokeWidth={1.5} /> Bagagem
              </p>
              <div className="grid gap-2">
                {ancillaries.map((item) => {
                  const selected = bags.some((x) => x.key === item.key);
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => toggleBag(item)}
                      className={cn(
                        'flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                        selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent',
                      )}
                    >
                      <span>
                        <span className="block text-sm font-medium">{humanName(item.name)}</span>
                        {item.description && (
                          <span className="block text-xs text-muted-foreground">{item.description}</span>
                        )}
                      </span>
                      <span className="flex items-center gap-2 text-sm tabular-nums">
                        {formatMoney(item.price?.total, item.price?.currency ?? money)}
                        {selected && <Check className="size-4" strokeWidth={1.5} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {(seat || bags.length > 0) && (
            <div className="space-y-4 border-t pt-6">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium">Total dos extras</p>
                <p className="text-xl font-semibold tabular-nums">{formatMoney(total, money)}</p>
              </div>

              {total > 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="extraCard">Número do cartão</Label>
                    <Input
                      id="extraCard"
                      inputMode="numeric"
                      autoComplete="off"
                      value={card.number}
                      onChange={(event) => setCard((prev) => ({ ...prev, number: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="extraExp">Validade</Label>
                    <Input
                      id="extraExp"
                      placeholder="MM/AAAA"
                      value={card.expiryDate}
                      onChange={(event) => setCard((prev) => ({ ...prev, expiryDate: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="extraCvv">Código de segurança</Label>
                    <Input
                      id="extraCvv"
                      inputMode="numeric"
                      autoComplete="off"
                      value={card.cvv}
                      onChange={(event) => setCard((prev) => ({ ...prev, cvv: event.target.value }))}
                    />
                  </div>
                </div>
              )}

              <Button size="lg" disabled={running} onClick={buy}>
                {running ? <Loader2 className="animate-spin" /> : <ShoppingCart />}
                {running ? 'Comprando…' : `Comprar por ${formatMoney(total, money)}`}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <SeatMapDialog
        open={mapOpen}
        onOpenChange={setMapOpen}
        seatMap={seatMap}
        loading={loading}
        selected={seat?.seat ?? null}
        onSelect={setSeat}
      />
    </div>
  );
}

/** O catálogo da reserva já diz de quem e de qual trecho ele é. */
const firstPassenger = (seatMap) => seatMap?.passengers?.[0]?.id ?? 'ADT_1';
const firstSegment = (seatMap) => seatMap?.segments?.[0]?.segmentId ?? undefined;

function ExtrasResult({ purchase, currency }) {
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardContent className="space-y-5 pt-2">
          <div className="flex items-start gap-3">
            <Check className="mt-0.5 size-5 shrink-0 text-emerald-600" strokeWidth={1.5} />
            <div>
              <p className="font-medium">
                {/* 🔴 `confirmed: null` NÃO é sucesso comprovado: a companhia
                    respondeu "ok" e não devolveu o serviço. */}
                {purchase.confirmed ? 'Extras confirmados' : 'Extras recebidos'}
              </p>
              <p className="text-sm text-muted-foreground">
                {purchase.confirmed
                  ? `Cobramos ${formatMoney(purchase.amount?.total, purchase.amount?.currency ?? currency)}.`
                  : 'A companhia aceitou e ainda não confirmou. Atualize a reserva em instantes.'}
              </p>
            </div>
          </div>

          {purchase.items?.length > 0 && (
            <div className="space-y-2 rounded-lg border px-4 py-3">
              {purchase.items.map((item, index) => (
                <div key={item.key ?? index} className="flex items-baseline justify-between gap-2 text-sm">
                  <span>{humanName(item.name)}</span>
                  <span className="text-muted-foreground">
                    {item.emdNumber ?? (item.status === 'booked' ? 'confirmado' : item.status ?? '—')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** `FIRST_ADDITIONAL_BAGGAGE` → `Primeira bagagem despachada`. */
function humanName(name) {
  if (!name) return 'Serviço';
  const dictionary = {
    CARRY_ON: 'Bagagem de mão',
    FIRST_ADDITIONAL_BAGGAGE: 'Primeira bagagem despachada',
    SECOND_ADDITIONAL_BAGGAGE: 'Segunda bagagem despachada',
    THIRD_ADDITIONAL_BAGGAGE: 'Terceira bagagem despachada',
    OVERWEIGHT: 'Bagagem acima do peso',
  };
  return dictionary[name] ?? name.toLowerCase().replace(/_/g, ' ');
}
