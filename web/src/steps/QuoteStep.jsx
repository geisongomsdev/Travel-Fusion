import { useState } from 'react';
import { ArmchairIcon, ArrowRight, Plane } from 'lucide-react';
import { SeatMapDialog } from '@/components/SeatMapDialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn, formatMoney, formatTime } from '@/lib/utils';

/**
 * Tarifar = `OfferPrice` na LATAM.
 *
 * 🔴 Esta tela é de QUEM COMPRA. O nome da mensagem do provedor, a URL do
 * endpoint e os avisos de idempotência não entram: são verdade da integração,
 * não do passageiro. O que sobra aqui é o que muda a decisão de comprar —
 * o voo, o preço aberto e os opcionais.
 */
export function QuoteStep({
  quote, selection, onContinue, onChangeParameter, parameters,
  seatMap, seat, loadingSeats, onLoadSeatMap, onSelectSeat,
  ancillaries = [], extras = [], onToggleExtra,
}) {
  const [seatsOpen, setSeatsOpen] = useState(false);

  const openSeats = () => {
    setSeatsOpen(true);
    // Busca uma vez só: o mapa não muda enquanto a tela está aberta.
    if (!seatMap) onLoadSeatMap();
  };

  if (!quote) return null;
  const { requiredParameters = [] } = quote;

  // Só os que têm opção de escolha viram tela; os de texto livre são coletados
  // no passo seguinte, junto com o passageiro.
  const selectable = requiredParameters.filter((parameter) => parameter.options?.length > 0);
  const leg = selection?.leg;

  /**
   * 🔴 O total é SOMADO aqui, não lido do `/quote`.
   *
   * O `total` que a companhia devolve é o da TARIFA — assento e bagagem são
   * ofertas à-la-carte, com preço próprio, e não entram nele. Mostrar o preço de
   * cada extra na tela e deixar o total parado é a tela mentindo: o número que a
   * pessoa lê tem que ser o que ela vai pagar.
   *
   * A moeda vem do preço da tarifa e não é misturada — se um extra vier em
   * outra moeda, somar seria pior do que não somar, e por isso ele fica de fora
   * da conta em vez de virar um número errado.
   */
  const currency = quote.currency ?? null;
  const sameCurrency = (money) => money && (money.currency === null || money.currency === currency);

  const extrasTotal = [
    ...(seat?.price ? [seat.price] : []),
    ...extras.map((item) => item.price),
  ]
    .filter(sameCurrency)
    .reduce((sum, money) => sum + (money.total ?? 0), 0);

  const total = (quote.total ?? 0) + extrasTotal;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Seu voo</CardTitle>
            <CardDescription>Confira antes de continuar.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                <Plane className="size-4 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <div>
                <div className="flex items-center gap-2 font-medium tabular-nums">
                  <span>{formatTime(leg?.time?.departure)}</span>
                  <ArrowRight className="size-3 text-muted-foreground" />
                  <span>{formatTime(leg?.time?.arrival)}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {leg?.origin?.iata} → {leg?.destination?.iata}
                  {leg?.company?.name || leg?.company?.code ? ` · ${leg.company.name ?? leg.company.code}` : ''}
                  {quote.family ? ` · ${quote.family}` : ''}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assento</CardTitle>
            <CardDescription>Escolha onde sentar, ou deixe a companhia decidir no check-in.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                <ArmchairIcon className="size-4 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-medium">{seat ? `Assento ${seat.seat}` : 'Nenhum assento escolhido'}</p>
                {seat?.price && (
                  <p className="text-sm text-muted-foreground">
                    {formatMoney(seat.price.total, seat.price.currency)}
                  </p>
                )}
              </div>
            </div>
            <Button variant="outline" onClick={openSeats}>
              {seat ? 'Trocar assento' : 'Escolher assento'}
            </Button>
          </CardContent>
        </Card>

        {(selectable.length > 0 || ancillaries.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle>Bagagem e serviços</CardTitle>
              <CardDescription>
                Escolha agora — depois da reserva estes itens não podem mais ser adicionados.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Opcionais da companhia: catálogo próprio, vindo do /ancillaries. */}
              {ancillaries.map((item) => {
                const chosen = extras.some((x) => x.key === item.key);
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onToggleExtra(item)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors',
                      chosen
                        ? 'border-primary bg-accent font-medium text-accent-foreground'
                        : 'border-border hover:border-primary/40 hover:bg-accent/40',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{labelForAncillary(item)}</span>
                      {item.description && (
                        <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                      )}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {item.price ? formatMoney(item.price.total, item.price.currency) : '—'}
                    </span>
                  </button>
                );
              })}

              {selectable.map((parameter) => (
                <div key={parameter.name} className="space-y-2">
                  <p className="text-sm font-medium">{labelFor(parameter.name)}</p>
                  {parameter.options.map((option) => {
                    const selected = parameters[parameter.name] === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onChangeParameter(parameter.name, selected ? null : option.value)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors',
                          selected
                            ? 'border-primary bg-accent font-medium text-accent-foreground'
                            : 'border-border hover:border-primary/40 hover:bg-accent/40',
                        )}
                      >
                        <span>
                          {option.quantity !== null && `${option.quantity} peça(s)`}
                          {option.weightKg !== null && ` · ${option.weightKg}kg`}
                          {option.quantity === null && option.weightKg === null && option.label}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {option.price ? formatMoney(option.price.total, option.price.currency) : '—'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="h-fit lg:sticky lg:top-5">
        <CardHeader>
          <CardTitle>Resumo</CardTitle>
          <CardDescription>Preço confirmado pela companhia agora.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row label="Tarifa" value={formatMoney(quote.base, currency)} />
          <Row label="Taxas e impostos" value={formatMoney(quote.taxes, currency)} />

          {/* Cada opcional escolhido vira uma LINHA, não um número embutido:
              quem está comprando precisa ver de onde veio o acréscimo. */}
          {seat?.price && (
            <Row label={`Assento ${seat.seat}`} value={formatMoney(seat.price.total, seat.price.currency)} />
          )}
          {extras.map((item) => (
            <Row
              key={item.key}
              label={labelForAncillary(item)}
              value={item.price ? formatMoney(item.price.total, item.price.currency) : '—'}
            />
          ))}

          <div className="border-t pt-3">
            <Row label="Total" value={formatMoney(total, currency)} strong />
          </div>
          <Button size="lg" className="w-full" onClick={onContinue}>
            Continuar
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            A reserva segura o assento e não cobra nada agora.
          </p>
        </CardContent>
      </Card>

      <SeatMapDialog
        open={seatsOpen}
        onOpenChange={setSeatsOpen}
        seatMap={seatMap}
        loading={loadingSeats}
        selected={seat?.seat ?? null}
        onSelect={onSelectSeat}
      />
    </div>
  );
}

function Row({ label, value, strong }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('tabular-nums', strong ? 'text-lg font-semibold' : 'font-medium')}>{value}</span>
    </div>
  );
}

/** Os nomes vêm em SNAKE_CASE do catálogo da companhia. */
function labelForAncillary(item) {
  const map = {
    CARRY_ON: 'Bagagem de mão',
    FIRST_ADDITIONAL_BAGGAGE: '1ª bagagem despachada',
    SECOND_ADDITIONAL_BAGGAGE: '2ª bagagem despachada',
    OVERWEIGHT: 'Bagagem acima do peso',
  };
  return map[item.name] ?? (item.name ?? '').replace(/_/g, ' ').toLowerCase();
}

function labelFor(name) {
  if (/OutwardLuggage/i.test(name)) return 'Bagagem — ida';
  if (/ReturnLuggage/i.test(name)) return 'Bagagem — volta';
  if (/Luggage/i.test(name)) return 'Bagagem';
  return name;
}
