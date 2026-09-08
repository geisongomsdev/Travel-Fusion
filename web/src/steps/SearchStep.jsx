import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SearchToolbar } from '@/components/toolbar/SearchToolbar';
import { CodeBlock } from '@/components/sandbox/CodeBlock';
import { Callout } from '@/components/sandbox/Callout';
import { Endpoint } from '@/components/sandbox/Endpoint';

/** Espelha o que o provedor monta, para o XML do painel não mentir. */
const CABIN_CODE = { economy: 'Y', premium_economy: 'W', business: 'C', first: 'F' };

function airShoppingRQ(form) {
  const pax = Array.from({ length: Math.max(1, Number(form.adults) || 1) }, (_, i) => `
      <Pax>
        <PaxID>ADT_${i + 1}</PaxID>
        <PTC>ADT</PTC>
      </Pax>`).join('');

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
    <Paxs>${pax}
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

  const change = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const swap = () => setForm((prev) => ({ ...prev, origin: prev.destination, destination: prev.origin }));

  const submit = (event) => {
    event.preventDefault();
    onSearch({
      type: form.type,
      legs: [{ origin: form.origin.toUpperCase(), destination: form.destination.toUpperCase(), date: form.date }],
      passengers: { adults: Number(form.adults) || 1, children: 0, babies: 0 },
      options: { provider: [form.provider], class: form.cabin },
    });
  };

  const isLatam = form.provider === 'latam';

  return (
    <div className="space-y-6">
      {/* A barra fica solta na página, sem cartão em volta: é o design flat. */}
      <SearchToolbar form={form} onChange={change} onSwap={swap} onSubmit={submit} running={running} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {isLatam ? (
          <Card>
            <CardHeader>
              <CardTitle>AirShoppingRQ</CardTitle>
              <CardDescription>A mensagem que sai daqui, montada com a barra acima.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Endpoint method="POST" path="https://sandbox.api.latam.com/ndc/v192/airshopping" />
              <CodeBlock code={airShoppingRQ(form)} language="xml" title="IATA_AirShoppingRQ" maxHeight="26rem" />
              <Callout tone="advice" title="Advice">
                Os valores em <code className="font-mono text-xs">{'{{chaves}}'}</code> vêm do{' '}
                <code className="font-mono text-xs">.env</code> e não trafegam pelo navegador. Sem{' '}
                <code className="font-mono text-xs">TravelAgentID</code> a LATAM responde{' '}
                <strong>403122009 Missing Agent Info</strong> antes de olhar o itinerário.
              </Callout>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>StartRouting</CardTitle>
              <CardDescription>A Travelfusion entrega por polling, em lotes incrementais.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Endpoint method="POST" path="https://api.travelfusion.com/Xml" />
              <Callout tone="advice" title="Advice">
                O IP precisa estar na whitelist. Sem isso o <code className="font-mono text-xs">Login</code>{' '}
                passa e o comando seguinte volta <strong>4-3448 Login id not found</strong>.
              </Callout>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Eventos do stream</CardTitle>
            <CardDescription>Cada quadro do SSE, na ordem em que chega.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {events.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">Nenhum evento ainda.</p>
            )}
            {events.map((event, index) => (
              <div key={index} className="flex items-center justify-between gap-2 rounded-md bg-primary/5 px-2.5 py-2">
                <Badge variant={eventVariant(event.type)}>{event.type}</Badge>
                <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">
                  {eventSummary(event)}
                </span>
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
