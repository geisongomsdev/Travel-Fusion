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

/**
 * 🔴 Estes campos não são enfeite: são os `requiredParameters` que o `/quote`
 * declarou. `documentNumber` vai por passageiro; `email` e `phone` são do
 * nível da reserva, e a LATAM recusa o OrderCreate sem eles
 * (`912 ContactInfoList is null or empty`).
 */
export function BookingStep({ onBook, running, booking }) {
  const [passenger, setPassenger] = useState({
    title: 'Mr',
    firstName: 'Andy',
    lastName: 'Peterson',
    dateOfBirth: '1990-04-21',
    documentNumber: 'AAB0302',
  });

  const [contact, setContact] = useState({
    email: 'andy@example.com',
    phone: '11999999999',
  });

  const updatePassenger = (key) => (event) =>
    setPassenger((prev) => ({ ...prev, [key]: event.target.value }));

  const updateContact = (key) => (event) =>
    setContact((prev) => ({ ...prev, [key]: event.target.value }));

  if (booking) return <BookingResult booking={booking} />;

  const submit = (event) => {
    event.preventDefault();

    const { documentNumber, ...individual } = passenger;

    onBook(
      [{ ...individual, customParameters: { documentNumber } }],
      { email: contact.email, phone: contact.phone },
    );
  };

  const incomplete = !contact.email && !contact.phone;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader>
          <CardTitle>Order Create</CardTitle>
          <CardDescription>Segura o assento e devolve o localizador. Não cobra nada.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Endpoint method="POST" path="https://sandbox.api.latam.com/ndc/v192/order/create" />

          <form className="space-y-5" onSubmit={submit}>
            <fieldset className="space-y-4">
              <legend className="text-sm font-medium">Passageiro</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="title">Tratamento</Label>
                  <Input id="title" value={passenger.title} onChange={updatePassenger('title')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dateOfBirth">Nascimento</Label>
                  <Input
                    id="dateOfBirth"
                    type="date"
                    value={passenger.dateOfBirth}
                    onChange={updatePassenger('dateOfBirth')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">Nome</Label>
                  <Input id="firstName" value={passenger.firstName} onChange={updatePassenger('firstName')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">Sobrenome</Label>
                  <Input id="lastName" value={passenger.lastName} onChange={updatePassenger('lastName')} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="documentNumber">
                    Documento
                    <code className="font-mono text-xs font-normal text-muted-foreground">IdentityDoc</code>
                  </Label>
                  <Input
                    id="documentNumber"
                    value={passenger.documentNumber}
                    onChange={updatePassenger('documentNumber')}
                    placeholder="AAB0302"
                  />
                </div>
              </div>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="text-sm font-medium">Contato da reserva</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    value={contact.email}
                    onChange={updateContact('email')}
                    placeholder="test@mail.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Telefone</Label>
                  <Input
                    id="phone"
                    value={contact.phone}
                    onChange={updateContact('phone')}
                    placeholder="11999999999"
                  />
                </div>
              </div>
            </fieldset>

            <Callout tone="note" title="Note">
              O PTC sai da idade na <strong>data do voo</strong> — em ida-e-volta, na data da volta.
              A LATAM recusa a ordem quando o PTC não bate com o Birthdate.
            </Callout>

            <Button type="submit" size="lg" disabled={running || incomplete}>
              {running ? <Loader2 className="animate-spin" /> : <Ticket />}
              {running ? 'Reservando…' : 'Reservar'}
            </Button>
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
            perder, o caminho é o <code className="font-mono text-xs">OrderRetrieve</code> — nunca
            reservar de novo.
          </Callout>
          <Callout tone="note" title="Note">
            Contato é obrigatório: sem <code className="font-mono text-xs">ContactInfoList</code> a
            LATAM responde <strong>912</strong>. A API recusa antes de sair para a rede.
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
          <div className="rounded-lg border bg-muted/50 px-4 py-3">
            <p className="text-xs text-muted-foreground">Localizador</p>
            <p className="font-mono text-2xl font-semibold">{booking.locator || '—'}</p>
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
              fornecedor. Consulte por <code className="font-mono text-xs">/retrieve</code>.
            </Callout>
          )}

          {booking.confirmed && (
            <Callout tone="success" title="Reserva confirmada">
              A emissão (<code className="font-mono text-xs">/issue</code>) responde 501 neste
              provedor: na Travelfusion o <code className="font-mono text-xs">StartBooking</code> já
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
