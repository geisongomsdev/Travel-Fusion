import { useState } from 'react';
import { Plane, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatMoney, formatTime } from '@/lib/utils';

/**
 * A LATAM é provedor de PACOTE: uma oferta é a viagem INTEIRA. Por isso a tela
 * lista itinerários, não pernas soltas — num multidestino, achatar os trechos
 * em cartões avulsos deixava escolher "SCL → LIM" como se fosse vendido sozinho.
 *
 *   oneway    → `departure[]`, um trecho por oferta;
 *   roundtrip → `groups[]`, ida + volta;
 *   multicity → `itineraries[]`, todos os trechos, na ordem da viagem.
 */
function itinerariesOf(data) {
  return [
    ...(data?.departure || []).map((leg) => ({ legs: [leg], fares: leg.fares || [] })),
    ...(data?.groups || []).map((group) => ({
      legs: [group.departure?.[0], group.return?.[0]].filter(Boolean),
      fares: group.fares || [],
    })),
    ...(data?.itineraries || []).map((itinerary) => ({
      // O índice interno são opções pelo mesmo preço; a primeira representa o trecho.
      legs: itinerary.legs.map((options) => options[0]).filter(Boolean),
      fares: itinerary.fares || [],
    })),
  ].filter((itinerary) => itinerary.legs.length > 0);
}

/**
 * 🔴 A LATAM devolve UMA oferta por família tarifária, então a mesma viagem
 * chega repetida — BASIC, LIGHT, FULL, PREMIUM… cada uma com seu `fareId`.
 * Listar cru vira cinco cartões idênticos com preços diferentes.
 *
 * Agrupamos pela viagem (rota + horários de TODOS os trechos) e mantemos as
 * famílias como escolha dentro do cartão. O que segue para tarifar é o `fareId`
 * da família escolhida — nunca o `identifier` do trecho, que é só a journey.
 */
function groupByTrip(itineraries) {
  const groups = new Map();

  for (const itinerary of itineraries) {
    const key = itinerary.legs
      .map((leg) => [
        leg.origin?.iata,
        leg.destination?.iata,
        leg.time?.departure,
        leg.time?.arrival,
        leg.company?.code,
      ].join('|'))
      .join('>');

    const fare = cheapestFare(itinerary.fares);
    if (!groups.has(key)) groups.set(key, { legs: itinerary.legs, options: [] });
    groups.get(key).options.push({ legs: itinerary.legs, fare });
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
const cheapestFare = (fares = []) => [...fares].sort((a, b) => priceOf(a) - priceOf(b))[0];

/** `260` → `4h20`. A API publica minutos; ninguém lê minutos. */
function humanDuration(minutes) {
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h${rest ? String(rest).padStart(2, '0') : ''}` : `${rest}min`;
}

export function ResultsStep({ data, onSelect }) {
  const trips = groupByTrip(itinerariesOf(data));

  if (trips.length === 0) {
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
        {trips.length} {trips.length === 1 ? 'opção encontrada' : 'opções encontradas'}
      </p>
      {trips.map((trip, index) => (
        <TripCard key={index} trip={trip} onSelect={onSelect} />
      ))}
    </div>
  );
}

/** Um trecho da viagem: horários, rota, companhia e paradas. */
function LegRow({ leg, label }) {
  const duration = humanDuration(leg.time?.duration);

  return (
    <div className="flex items-center gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Plane className="h-4 w-4" />
      </div>
      <div>
        <div className="flex items-center gap-2 text-sm font-medium">
          {label && <span className="w-14 text-xs font-normal text-muted-foreground">{label}</span>}
          <span>{formatTime(leg.time?.departure)}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span>{formatTime(leg.time?.arrival)}</span>
          {duration && <span className="text-xs font-normal text-muted-foreground">{duration}</span>}
        </div>
        <p className={cn('text-xs text-muted-foreground', label && 'pl-16')}>
          {leg.origin?.iata} → {leg.destination?.iata} · {leg.company?.name || leg.company?.code || '—'}
        </p>
      </div>
      <Badge variant={leg.stops === 0 ? 'success' : 'secondary'}>
        {leg.stops === 0 ? 'direto' : `${leg.stops ?? '?'} parada(s)`}
      </Badge>
    </div>
  );
}

/** Rótulo do trecho: só aparece quando há mais de um. */
export function legLabel(index, total) {
  if (total < 2) return null;
  if (total === 2) return index === 0 ? 'Ida' : 'Volta';
  return `Trecho ${index + 1}`;
}

function TripCard({ trip, onSelect }) {
  const [chosen, setChosen] = useState(0);
  const option = trip.options[chosen];

  return (
    <Card className="transition-colors hover:bg-muted/40">
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-3">
          {trip.legs.map((leg, index) => (
            <LegRow key={index} leg={leg} label={legLabel(index, trip.legs.length)} />
          ))}
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-lg font-medium tabular-nums">
              {formatMoney(option.fare?.price?.total?.total, option.fare?.price?.total?.currency)}
            </p>
            <p className="text-xs text-muted-foreground">total</p>
          </div>
          <Button size="sm" disabled={!option.fare} onClick={() => onSelect(option.legs, option.fare)}>
            Selecionar
          </Button>
        </div>

        {/* Só aparece quando a viagem tem mais de uma família — tarifa única não
            ganha uma linha de escolha inútil. */}
        {trip.options.length > 1 && (
          <div className="flex w-full flex-wrap gap-2 border-t border-border pt-3">
            {trip.options.map((candidate, index) => (
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
