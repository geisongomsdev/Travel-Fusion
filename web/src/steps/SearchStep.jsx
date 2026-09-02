import { useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

export function SearchStep({ onSearch, running, events }) {
  const [form, setForm] = useState({
    type: 'oneway',
    origin: 'GRU',
    destination: 'REC',
    date: '2026-10-12',
    adults: 1,
  });

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = (event) => {
    event.preventDefault();
    onSearch({
      type: form.type,
      legs: [{ origin: form.origin.toUpperCase(), destination: form.destination.toUpperCase(), date: form.date }],
      passengers: { adults: Number(form.adults) || 1, children: 0, babies: 0 },
      options: { provider: ['travelfusion'] },
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle>Buscar voos</CardTitle>
          <CardDescription>
            <code className="text-xs">POST /availability</code> — resposta em stream, não no envelope padrão.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="type">Tipo</Label>
              <select
                id="type"
                value={form.type}
                onChange={update('type')}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="oneway">Ida</option>
                <option value="roundtrip">Ida e volta</option>
                <option value="multicity">Multidestino</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date">Data de ida</Label>
              <Input id="date" type="date" value={form.date} onChange={update('date')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="origin">Origem</Label>
              <Input id="origin" maxLength={3} value={form.origin} onChange={update('origin')} className="uppercase" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="destination">Destino</Label>
              <Input id="destination" maxLength={3} value={form.destination} onChange={update('destination')} className="uppercase" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adults">Adultos</Label>
              <Input id="adults" type="number" min={1} value={form.adults} onChange={update('adults')} />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={running} className="w-full">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {running ? 'Buscando…' : 'Buscar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Eventos do stream</CardTitle>
          <CardDescription>Cada quadro do SSE, na ordem em que chega.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.length === 0 && <p className="text-sm text-muted-foreground">Nenhum evento ainda.</p>}
          {events.map((event, index) => (
            <div key={index} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <Badge variant={eventVariant(event.type)}>{event.type}</Badge>
              <span className="truncate text-xs text-muted-foreground">{eventSummary(event)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function eventVariant(type) {
  if (type === 'provider_success' || type === 'complete') return 'success';
  if (type === 'fatal_error') return 'destructive';
  if (type === 'provider_error') return 'warning';
  return 'secondary';
}

function eventSummary(event) {
  if (event.type === 'start') return `${event.totalProviders} provedor(es)`;
  if (event.type === 'provider_success') return `${event.groups ?? 0} grupos · ${event.departure ?? 0} idas`;
  // "Sem voos" chega como provider_error, mas SEM canonicalCode — não é falha.
  if (event.type === 'provider_error') {
    return event.data?.error?.code === 'NO_FLIGHTS' ? 'sem voos (não é erro)' : event.data?.error?.code;
  }
  if (event.type === 'complete') return `${event.totalCount} ${event.countType} · ${event.duration}ms`;
  if (event.type === 'fatal_error') return event.data?.error?.code;
  return '';
}
