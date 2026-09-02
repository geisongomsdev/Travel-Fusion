import { Plane, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatMoney, formatTime } from '@/lib/utils';

/**
 * A Travelfusion é provedor de PACOTE: num roundtrip as ofertas chegam em
 * `groups[]`, não em pernas soltas. Achatamos aqui só para exibir.
 */
export function ResultsStep({ data, onSelect }) {
  const legs = [
    ...(data?.departure || []),
    ...(data?.groups || []).flatMap((group) => group.departure || []),
    ...(data?.itineraries || []).flatMap((itinerary) => itinerary.legs.flat()),
  ];

  if (legs.length === 0) {
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
      {legs.map((leg) => {
        // Ordenar/exibir pela família MAIS BARATA, nunca por fares[0].
        const fare = [...(leg.fares || [])].sort(
          (a, b) => (a.price?.total?.total ?? Infinity) - (b.price?.total?.total ?? Infinity),
        )[0];

        return (
          <Card key={leg.identifier}>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="flex items-center gap-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
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
                  <p className="text-base font-semibold">
                    {formatMoney(fare?.price?.total?.total, fare?.price?.total?.currency)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fare?.family || fare?.cabin || 'tarifa'} · total da reserva
                  </p>
                </div>
                <Button size="sm" onClick={() => onSelect(leg, fare)}>Tarifar</Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
