import { useState } from 'react';
import { Search, Loader2, ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CodeBlock } from '@/components/sandbox/CodeBlock';
import { Callout } from '@/components/sandbox/Callout';
import { Endpoint } from '@/components/sandbox/Endpoint';

/**
 * Os dois provedores por trás da mesma rota. A escolha é do formulário, não do
 * código: `latam` responde síncrono, `travelfusion` responde por polling, e é
 * exatamente essa diferença que a coluna de eventos deixa ver.
 */
const PROVIDERS = [
  { value: 'latam', label: 'LATAM NDC', hint: 'síncrono' },
  { value: 'travelfusion', label: 'Travelfusion', hint: 'polling' },
];

/** Espelha o que o provedor vai montar, para o XML do painel não mentir. */
const CABIN_CODE = { economy: 'Y', premium_economy: 'W', business: 'C', first: 'F' };

function airShoppingRQ(form) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<IATA_AirShoppingRQ xmlns="http://www.iata.org/IATA/2015/00/2019.2/IATA_AirShoppingRQ">
  <MessageDoc>
    <RefVersionNumber>1.0</RefVersionNumber>
  </MessageDoc>
  <Party>
    <Sender>
      <TravelAgency>
        <AgencyID>{{AGENCY_ID}}</AgencyID>
        <IATA_Number>{{AGENCY_IATA}}</IATA_Number>
        <Name>{{AGENCY_NAME}}</Name>
        <TravelAgent>
          <TravelAgentID>{{AGENT_EMAIL}}</TravelAgentID>
        </TravelAgent>
      </TravelAgency>
    </Sender>
  </Party>
  <POS>
    <Country>
      <CountryCode>BR</CountryCode>
    </Country>
  </POS>
  <Request>
    <FlightCriteria>
      <OriginDestCriteria>
        <DestArrivalCriteria>
          <IATA_LocationCode>${form.destination.toUpperCase()}</IATA_LocationCode>
        </DestArrivalCriteria>
        <OriginDepCriteria>
          <Date>${form.date}</Date>
          <IATA_LocationCode>${form.origin.toUpperCase()}</IATA_LocationCode>
        </OriginDepCriteria>
        <PreferredCabinType>
          <CabinTypeCode>${CABIN_CODE[form.cabin] ?? 'Y'}</CabinTypeCode>
        </PreferredCabinType>
      </OriginDestCriteria>
    </FlightCriteria>
    <Paxs>${Array.from({ length: Math.max(1, Number(form.adults) || 1) }, (_, i) => `
      <Pax>
        <PaxID>ADT_${i + 1}</PaxID>
        <PTC>ADT</PTC>
      </Pax>`).join('')}
    </Paxs>
    <ResponseParameters>
      <LangUsage>
        <LangCode>PT</LangCode>
      </LangUsage>
    </ResponseParameters>
  </Request>
</IATA_AirShoppingRQ>`;
}

export function SearchStep({ onSearch, running, events }) {
  const [form, setForm] = useState({
    type: 'oneway',
    origin: 'GRU',
    destination: 'SCL',
    date: '2026-11-20',
    adults: 1,
    cabin: 'economy',
    provider: 'latam',
  });

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const swap = () => setForm((prev) => ({ ...prev, origin: prev.destination, destination: prev.origin }));

  const submit = (event) => {
    event.preventDefault();
    onSearch({
      type: form.type,
      legs: [
        { origin: form.origin.toUpperCase(), destination: form.destination.toUpperCase(), date: form.date },
      ],
      passengers: { adults: Number(form.adults) || 1, children: 0, babies: 0 },
      options: { provider: [form.provider], class: form.cabin },
    });
  };

  const isLatam = form.provider === 'latam';

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Air Shopping</CardTitle>
            <CardDescription>
              Encontra ofertas de voo a partir do itinerário e dos filtros.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Endpoint
              method="POST"
              path={isLatam ? 'https://sandbox.api.latam.com/ndc/v192/airshopping' : 'https://api.travelfusion.com/Xml'}
              note={
                isLatam
                  ? 'Resposta síncrona: uma chamada traz todas as ofertas.'
                  : 'StartRouting + polling de CheckRouting a cada 2s, incremental.'
              }
            />

            <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="provider">Provedor</Label>
                <Select id="provider" value={form.provider} onChange={update('provider')}>
                  {PROVIDERS.map((provider) => (
                    <option key={provider.value} value={provider.value}>
                      {provider.label} · {provider.hint}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="type">Tipo</Label>
                <Select id="type" value={form.type} onChange={update('type')}>
                  <option value="oneway">Ida</option>
                  <option value="roundtrip">Ida e volta</option>
                  <option value="multicity">Multidestino</option>
                </Select>
              </div>

              <div className="flex items-end gap-2 sm:col-span-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="origin">Origem</Label>
                  <Input id="origin" maxLength={3} value={form.origin} onChange={update('origin')} className="uppercase" />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={swap}
                  title="Inverter origem e destino"
                  aria-label="Inverter origem e destino"
                  className="mb-0.5 h-11 w-11"
                >
                  <ArrowRightLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="destination">Destino</Label>
                  <Input
                    id="destination"
                    maxLength={3}
                    value={form.destination}
                    onChange={update('destination')}
                    className="uppercase"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="date">Data de ida</Label>
                <Input id="date" type="date" value={form.date} onChange={update('date')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adults">Adultos</Label>
                <Input id="adults" type="number" min={1} max={9} value={form.adults} onChange={update('adults')} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cabin">Cabine</Label>
                <Select id="cabin" value={form.cabin} onChange={update('cabin')}>
                  <option value="economy">Economy (Y)</option>
                  <option value="premium_economy">Premium Economy (W)</option>
                  <option value="business">Business (C)</option>
                  <option value="first">First (F)</option>
                </Select>
              </div>

              <div className="sm:col-span-2">
                <Button type="submit" variant="brand" size="lg" disabled={running} className="w-full sm:w-auto">
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {running ? 'Buscando…' : 'Buscar voos'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {isLatam && (
          <Card>
            <CardHeader>
              <CardTitle>AirShoppingRQ</CardTitle>
              <CardDescription>A mensagem que sai daqui, montada com o formulário acima.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <CodeBlock code={airShoppingRQ(form)} language="xml" title="IATA_AirShoppingRQ" maxHeight="24rem" />
              <Callout tone="advice" title="Advice">
                Os valores em <code className="font-mono text-[12px]">{'{{chaves}}'}</code> vêm do{' '}
                <code className="font-mono text-[12px]">.env</code> e não trafegam pelo navegador. Sem{' '}
                <code className="font-mono text-[12px]">TravelAgentID</code> a LATAM responde{' '}
                <strong>403122009 Missing Agent Info</strong> antes de olhar o itinerário.
              </Callout>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="h-fit lg:sticky lg:top-5">
        <CardHeader>
          <CardTitle>Eventos do stream</CardTitle>
          <CardDescription>Cada quadro do SSE, na ordem em que chega.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum evento ainda.</p>
          )}
          {events.map((event, index) => (
            <div key={index} className="rounded-lg border border-border px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <Badge variant={eventVariant(event.type)}>{event.type}</Badge>
                <span className="truncate font-mono text-[11px] text-muted-foreground">{eventSummary(event)}</span>
              </div>
            </div>
          ))}

          {events.length > 0 && (
            <CodeBlock
              code={JSON.stringify(events[events.length - 1], null, 2)}
              language="json"
              title="último evento"
              maxHeight="14rem"
              className="mt-3"
            />
          )}
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
