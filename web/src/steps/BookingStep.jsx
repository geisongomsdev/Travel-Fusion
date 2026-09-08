import { useState } from 'react';
import { Loader2, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CodeBlock } from '@/components/sandbox/CodeBlock';
import { Callout } from '@/components/sandbox/Callout';
import { Endpoint } from '@/components/sandbox/Endpoint';

export function BookingStep({ onBook, running, booking }) {
  const [passenger, setPassenger] = useState({
    title: 'Mr',
    firstName: 'Andy',
    lastName: 'Peterson',
    dateOfBirth: '1990-04-21',
  });

  const update = (key) => (event) => setPassenger((prev) => ({ ...prev, [key]: event.target.value }));

  if (booking) return <BookingResult booking={booking} />;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader>
          <CardTitle>Order Create</CardTitle>
          <CardDescription>Segura o assento e devolve o localizador. Não cobra nada.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Endpoint method="POST" path="https://sandbox.api.latam.com/ndc/v192/order/create" />

          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              onBook([passenger]);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="title">Tratamento</Label>
              <Input id="title" value={passenger.title} onChange={update('title')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dateOfBirth">Nascimento</Label>
              <Input id="dateOfBirth" type="date" value={passenger.dateOfBirth} onChange={update('dateOfBirth')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="firstName">Nome</Label>
              <Input id="firstName" value={passenger.firstName} onChange={update('firstName')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Sobrenome</Label>
              <Input id="lastName" value={passenger.lastName} onChange={update('lastName')} />
            </div>

            <div className="sm:col-span-2">
              <Callout tone="note" title="Note">
                O PTC sai da idade na <strong>data do voo</strong> — em ida-e-volta, na data da volta.
                A LATAM recusa a ordem quando o PTC não bate com o Birthdate.
              </Callout>
            </div>

            <div className="sm:col-span-2">
              <Button type="submit" size="lg" disabled={running} className="w-full sm:w-auto">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
                {running ? 'Reservando…' : 'Reservar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Advice</CardTitle>
          <CardDescription>Antes de apertar o botão.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Callout tone="advice" title="OrderCreate não é idempotente">
            Esta é a única mutação do fluxo, e ela roda <strong>sem retry</strong>. Se a resposta se
            perder, o caminho é o <code className="font-mono text-[12px]">OrderRetrieve</code> — nunca
            reservar de novo.
          </Callout>
          <Callout tone="note" title="Note">
            A ordem dos elementos do <code className="font-mono text-[12px]">Pax</code> é alfabética e
            obrigatória: ContactInfoRefID, IdentityDoc, Individual, PaxID, PTC.
          </Callout>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * `committed` e `confirmed` são coisas diferentes e a tela precisa mostrar as duas.
 * committed sem confirmed = a reserva pode existir do outro lado. A ação é ESPERAR,
 * nunca reservar de novo.
 */
function BookingResult({ booking }) {
  const pending = booking.committed && !booking.confirmed;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader>
          <CardTitle>Order View</CardTitle>
          <CardDescription>Localizador e estado devolvidos pelo provedor.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/50 px-4 py-3">
            <p className="text-xs text-muted-foreground">Localizador</p>
            <p className="font-mono text-2xl font-semibold text-primary">{booking.locator || '—'}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={booking.committed ? 'success' : 'secondary'}>
              committed: {String(booking.committed)}
            </Badge>
            <Badge variant={booking.confirmed ? 'success' : 'warning'}>
              confirmed: {String(booking.confirmed)}
            </Badge>
            <Badge variant="outline">{booking.status}</Badge>
          </div>

          {pending && (
            <Callout tone="advice" title="Aceita, ainda não confirmada">
              O polling continua. <strong>Não reserve de novo:</strong> ela pode já existir do lado do
              fornecedor. Consulte por <code className="font-mono text-[12px]">/retrieve</code>.
            </Callout>
          )}

          {booking.confirmed && (
            <Callout tone="success" title="Reserva confirmada">
              A emissão (<code className="font-mono text-[12px]">/issue</code>) responde 501 neste
              provedor: na Travelfusion o <code className="font-mono text-[12px]">StartBooking</code> já
              cobra, então não existe emissão separada.
            </Callout>
          )}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Resposta</CardTitle>
          <CardDescription>O corpo cru, como veio do contrato.</CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock code={JSON.stringify(booking, null, 2)} language="json" title="booking" maxHeight="20rem" />
        </CardContent>
      </Card>
    </div>
  );
}
