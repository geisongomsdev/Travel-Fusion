import { useState } from 'react';
import { Plane, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Endpoint } from '@/components/sandbox/Endpoint';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatMoney, formatTime } from '@/lib/utils';

/**
 * A Travelfusion é provedor de PACOTE: num roundtrip as ofertas chegam em
 * `groups[]`, não em pernas soltas. Achatamos aqui só para exibir.
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
 * repetido — BASIC, LIGHT, FULL, PREMIUM… cada uma com seu identifier. Listar
 * cru vira cinco cartões idênticos com preços diferentes.
 *
 * Agrupamos pelo voo (rota + horários) e mantemos as famílias como escolha
 * dentro do cartão. O identifier continua sendo o da família escolhida — é ele
 * que o /quote exige, e ele nunca é remontado aqui.
 */
function groupByFlight(legs) {
  const groups = new Map();

  for (const leg of legs) {
    const key = [
      leg.origin?.code,
      leg.destination?.code,
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

export function ResultsStep({ data, onSelect }) {
  const flights = groupByFlight(flatten(data));
  const fareCount = flights.reduce((sum, flight) => sum + flight.options.length, 0);

  if (flights.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          Nenhuma oferta. Isso é resposta válida — não é erro.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Endpoint
        method="POST"
        path="https://sandbox.api.latam.com/ndc/v192/airshopping"
        note={`${flights.length} voo(s) · ${fareCount} tarifa(s). A LATAM devolve uma oferta por família tarifária, então o mesmo voo chega repetido — agrupamos por voo aqui.`}
      />
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
            </div>
            <p className="text-xs text-muted-foreground">
              {leg.origin?.code} → {leg.destination?.code} · {leg.company?.name || leg.company?.code || '—'}
            </p>
          </div>
          <Badge variant={leg.stops === 0 ? 'success' : 'secondary'}>
            {leg.stops === 0 ? 'direto' : `${leg.stops ?? '?'} parada(s)`}
          </Badge>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-lg font-medium text-primary">
              {formatMoney(option.fare?.price?.total?.total, option.fare?.price?.total?.currency)}
            </p>
            <p className="text-xs text-muted-foreground">total da reserva</p>
          </div>
          <Button size="sm"  onClick={() => onSelect(option.leg, option.fare)}>
            Tarifar
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
