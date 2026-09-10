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
 * os únicos que a companhia aceita vender depois da emissão.
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
    holder: 'ANDY PETERSON',
    number: '4000000000002701',
    securityCode: '737',
    expiration: '03/30',
  });
  const [payer] = useState({
    firstName: 'Andy',
    lastName: 'Peterson',
    dateOfBirth: '1990-04-21',
    documentNumber: '52998224725',
  });

  const money = seatMap?.currency ?? currency ?? 'BRL';
  const total = (seat?.price?.total ?? 0) + bags.reduce((sum, bag) => sum + (bag.price?.total ?? 0), 0);

  const toggleBag = (item) =>
    setBags((prev) => (
      prev.some((x) => x.offerItemId === item.offerItemId)
        ? prev.filter((x) => x.offerItemId !== item.offerItemId)
        : [...prev, item]
    ));

  if (purchase) return <ExtrasResult purchase={purchase} currency={money} />;

  const buy = () => {
    const items = [];
    if (seat) items.push({ offerItemId: seat.offerItemId, paxId: seat.paxId ?? 'ADT_1', row: seat.row, column: seat.column });
    for (const bag of bags) items.push({ offerItemId: bag.offerItemId, paxId: bag.paxId ?? 'ADT_1' });
    onBuy({ items, card, payer });
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
                  const selected = bags.some((x) => x.offerItemId === item.offerItemId);
                  return (
                    <button
                      key={item.offerItemId}
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
                    placeholder="MM/AA"
                    value={card.expiration}
                    onChange={(event) => setCard((prev) => ({ ...prev, expiration: event.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="extraCvv">Código de segurança</Label>
                  <Input
                    id="extraCvv"
                    inputMode="numeric"
                    autoComplete="off"
                    value={card.securityCode}
                    onChange={(event) => setCard((prev) => ({ ...prev, securityCode: event.target.value }))}
                  />
                </div>
              </div>

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

function ExtrasResult({ purchase, currency }) {
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardContent className="space-y-5 pt-2">
          <div className="flex items-start gap-3">
            <Check className="mt-0.5 size-5 shrink-0 text-emerald-600" strokeWidth={1.5} />
            <div>
              <p className="font-medium">Extras confirmados</p>
              <p className="text-sm text-muted-foreground">
                Cobramos {formatMoney(purchase.charged?.total, purchase.charged?.currency ?? currency)}.
              </p>
            </div>
          </div>

          {purchase.services?.length > 0 && (
            <div className="space-y-2 rounded-lg border px-4 py-3">
              {purchase.services.map((service, index) => (
                <p key={service.serviceId ?? index} className="text-sm">
                  {service.seat ? `Assento ${service.seat}` : humanName(service.name)}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** `FIRST_ADDITIONAL_BAGGAGE` → `Primeira bagagem adicional`. */
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
