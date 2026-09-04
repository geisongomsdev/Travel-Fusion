import { useState } from 'react';
import { Loader2, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

export function FinalizarStep({ onBook, running, booking }) {
  const [passenger, setPassenger] = useState({
    title: 'Mr',
    firstName: 'Andy',
    lastName: 'Peterson',
    dateOfBirth: '1990-04-21',
  });

  const update = (key) => (event) => setPassenger((prev) => ({ ...prev, [key]: event.target.value }));

  if (booking) return <BookingResult booking={booking} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Passageiro</CardTitle>
        <CardDescription>
          <code className="text-xs">POST /booking</code> — segura o assento e devolve o localizador. Não cobra nada.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
          <p className="text-xs text-muted-foreground sm:col-span-2">
            A idade vai para o provedor calculada na data do voo — em ida-e-volta, na data da volta.
          </p>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={running} className="w-full">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
              {running ? 'Reservando…' : 'Reservar'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>Reserva</CardTitle>
        <CardDescription>Localizador e estado devolvidos pelo provedor.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={booking.committed ? 'success' : 'secondary'}>
            committed: {String(booking.committed)}
          </Badge>
          <Badge variant={booking.confirmed ? 'success' : 'warning'}>
            confirmed: {String(booking.confirmed)}
          </Badge>
          <Badge variant="outline">{booking.status}</Badge>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">Localizador</p>
          <p className="font-mono text-lg font-semibold">{booking.locator || '—'}</p>
        </div>

        {pending && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            A reserva foi aceita mas ainda não confirmou. Aguarde — o polling continua.
            <span className="font-medium"> Não reserve de novo:</span> ela pode já existir do lado do fornecedor.
          </div>
        )}

        {booking.confirmed && (
          <div className="rounded-md border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm">
            Reserva confirmada. A emissão (<code className="text-xs">/issue</code>) responde 501 neste provedor:
            na Travelfusion o <code className="text-xs">StartBooking</code> já cobra, então não existe emissão separada.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
