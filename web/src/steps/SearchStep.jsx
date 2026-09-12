import { useState } from 'react';
import { Loader2, Plane } from 'lucide-react';
import { SearchToolbar } from '@/components/toolbar/SearchToolbar';

/**
 * Busca.
 *
 * 🔴 O painel de eventos do SSE e o envelope NDC saíram daqui. Eram ferramenta
 * de quem integra — quem compra passagem não precisa saber que existe polling,
 * nem ver `provider_success` passar na tela. O contrato continua igual; o que
 * mudou é quem está sendo servido.
 */
export function SearchStep({ onSearch, running }) {
  const [form, setForm] = useState({
    type: 'oneway',
    origin: 'GRU',
    destination: 'SCL',
    date: '2026-11-20',
    returnDate: '2026-11-27',
    adults: 1,
    cabin: 'economy',
    provider: 'latam',
  });

  const change = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const swap = () => setForm((prev) => ({ ...prev, origin: prev.destination, destination: prev.origin }));

  const submit = (event) => {
    event.preventDefault();

    /**
     * 🔴 A viagem é descrita por PONTAS, não por uma lista de trechos: em ida e
     * volta o destino da ida é a origem da volta, e a data do retorno mora em
     * `arrival.date`. É o que deixa `type` ser explícito em vez de inferido pela
     * quantidade de datas — duas datas não provam ida-e-volta.
     */
    onSearch({
      type: form.type,
      departure: { iata: form.origin.toUpperCase(), date: form.date },
      arrival: {
        iata: form.destination.toUpperCase(),
        ...(form.type === 'roundtrip' ? { date: form.returnDate } : {}),
      },
      passengers: { adults: Number(form.adults) || 1, children: 0, infants: 0 },
      options: { provider: [form.provider], class: form.cabin },
    });
  };

  return (
    <div className="space-y-6">
      <SearchToolbar form={form} onChange={change} onSwap={swap} onSubmit={submit} running={running} />

      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-20 text-center">
        {running ? (
          <>
            <Loader2 className="size-8 animate-spin text-muted-foreground opacity-40" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">Consultando a companhia…</p>
          </>
        ) : (
          <>
            <Plane className="size-8 text-muted-foreground opacity-40" strokeWidth={1.5} />
            <div>
              <p className="text-sm font-medium">Para onde você vai?</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Escolha origem, destino e data para ver as opções.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
