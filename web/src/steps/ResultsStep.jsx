import { useState } from 'react';
import { Plane, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatMoney, formatTime } from '@/lib/utils';

/**
 * A LATAM é provedor de PACOTE: num roundtrip as ofertas chegam em `groups[]`,
 * não em pernas soltas. Achatamos aqui só para exibir.
 */
function flatten(data) {
  return [
    ...(data?.departure || []),
    ...(data?.groups || []).flatMap((group) => group.departure || []),
    ...(data?.itineraries || []).flatMap((itinerary) => itinerary.legs.flat()),
  ];
}

/**
 * 🔴 A LATAM devolve UMA oferta por família tarifária, então o mesmo voo chega
 * repetido — BASIC, LIGHT, FULL, PREMIUM… cada uma com seu `fareId`. Listar cru
 * vira cinco cartões idênticos com preços diferentes.
 *
 * Agrupamos pelo voo (rota + horários) e mantemos as famílias como escolha
 * dentro do cartão. O que segue para tarifar é o `fareId` da família escolhida
 * — nunca o `identifier` do trecho, que é só a journey da companhia.
 */
function groupByFlight(legs) {
  const groups = new Map();

  for (const leg of legs) {
    const key = [
      leg.origin?.iata,
      leg.destination?.iata,
      leg.time?.departure,
      leg.time?.arrival,
      leg.company?.code,
    ].join('|');

    const fare = cheapestFare(leg);
    if (!groups.has(key)) groups.set(key, { leg, options: [] });
    groups.get(key).options.push({ leg, fare });
  }

  for (const group of groups.values()) {
    group.options.sort((a, b) => priceOf(a.fare) - priceOf(b.fare));
  }

  return [...groups.values()].sort(
    (a, b) => priceOf(a.options[0].fare) - priceOf(b.options[0].fare),
  );
}

const priceOf = (fare) => fare?.price?.total?.total ?? Infinity;

/** Ordenar/exibir pela família MAIS BARATA, nunca por fares[0]. */
const cheapestFare = (leg) => [...(leg.fares || [])].sort((a, b) => priceOf(a) - priceOf(b))[0];

/** `260` → `4h20`. A API publica minutos; ninguém lê minutos. */
function humanDuration(minutes) {
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h${rest ? String(rest).padStart(2, '0') : ''}` : `${rest}min`;
}

export function ResultsStep({ data, onSelect }) {
  const flights = groupByFlight(flatten(data));

  if (flights.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          Nenhum voo para esta rota nesta data. Tente outra data.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {flights.length} {flights.length === 1 ? 'voo encontrado' : 'voos encontrados'}
      </p>
      {flights.map((flight, index) => (
        <FlightCard key={index} flight={flight} onSelect={onSelect} />
      ))}
    </div>
  );
}

function FlightCard({ flight, onSelect }) {
  const [chosen, setChosen] = useState(0);
  const option = flight.options[chosen];
  const { leg } = flight;
  const duration = humanDuration(leg.time?.duration);

  return (
    <Card className="transition-colors hover:bg-muted/40">
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Plane className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <span>{formatTime(leg.time?.departure)}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span>{formatTime(leg.time?.arrival)}</span>
              {duration && <span className="text-xs font-normal text-muted-foreground">{duration}</span>}
            </div>
            <p className="text-xs text-muted-foreground">
              {leg.origin?.iata} → {leg.destination?.iata} · {leg.company?.name || leg.company?.code || '—'}
            </p>
          </div>
          <Badge variant={leg.stops === 0 ? 'success' : 'secondary'}>
            {leg.stops === 0 ? 'direto' : `${leg.stops ?? '?'} parada(s)`}
          </Badge>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-lg font-medium tabular-nums">
              {formatMoney(option.fare?.price?.total?.total, option.fare?.price?.total?.currency)}
            </p>
            <p className="text-xs text-muted-foreground">total</p>
          </div>
          <Button size="sm" onClick={() => onSelect(option.leg, option.fare)}>
            Selecionar
          </Button>
        </div>

        {/* Só aparece quando o voo tem mais de uma família — um voo com tarifa
            única não ganha uma linha de escolha inútil. */}
        {flight.options.length > 1 && (
          <div className="flex w-full flex-wrap gap-2 border-t border-border pt-3">
            {flight.options.map((candidate, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setChosen(index)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  index === chosen
                    ? 'border-primary bg-accent font-medium text-accent-foreground'
                    : 'border-border text-muted-foreground hover:border-foreground/40',
                )}
              >
                {candidate.fare?.family || candidate.fare?.cabin || 'tarifa'} ·{' '}
                {formatMoney(candidate.fare?.price?.total?.total, candidate.fare?.price?.total?.currency)}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
