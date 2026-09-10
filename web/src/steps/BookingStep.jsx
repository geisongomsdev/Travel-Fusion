import { useState } from 'react';
import { CheckCircle2, Clock, Loader2, RefreshCw, Ticket, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatMoney, formatTime } from '@/lib/utils';

/**
 * 🔴 Os campos aqui não são escolha de tela: são os `requiredParameters` que o
 * `/quote` declarou. `documentNumber` vai por passageiro; `email` e `phone` são
 * da reserva, e a LATAM recusa a ordem sem eles.
 *
 * O que NÃO aparece: nome de mensagem NDC, URL de endpoint e aviso de
 * idempotência. Isso é verdade da integração — vive no README e no código, não
 * na frente de quem está comprando.
 */
export function BookingStep({ onBook, running, booking, retrieved, cancellation, onRetrieve, onCancel }) {
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

  if (booking) {
    return (
      <BookingResult
        booking={booking}
        retrieved={retrieved}
        cancellation={cancellation}
        running={running}
        onRetrieve={onRetrieve}
        onCancel={onCancel}
      />
    );
  }

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
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Quem vai viajar</CardTitle>
          <CardDescription>
            O nome precisa ser igual ao do documento apresentado no embarque.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={submit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">Nome</Label>
                <Input id="firstName" value={passenger.firstName} onChange={updatePassenger('firstName')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Sobrenome</Label>
                <Input id="lastName" value={passenger.lastName} onChange={updatePassenger('lastName')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="title">Tratamento</Label>
                <Input id="title" value={passenger.title} onChange={updatePassenger('title')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dateOfBirth">Data de nascimento</Label>
                <Input
                  id="dateOfBirth"
                  type="date"
                  value={passenger.dateOfBirth}
                  onChange={updatePassenger('dateOfBirth')}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="documentNumber">Documento</Label>
                <Input
                  id="documentNumber"
                  value={passenger.documentNumber}
                  onChange={updatePassenger('documentNumber')}
                  placeholder="Passaporte ou RG"
                />
              </div>
            </div>

            <div className="space-y-4 border-t pt-6">
              <div>
                <p className="text-sm font-medium">Contato</p>
                <p className="text-sm text-muted-foreground">
                  A companhia usa estes dados para avisar sobre mudanças no voo.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="email">E-mail</Label>
                  <Input id="email" type="email" value={contact.email} onChange={updateContact('email')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Telefone</Label>
                  <Input id="phone" value={contact.phone} onChange={updateContact('phone')} />
                </div>
              </div>
            </div>

            <Button type="submit" size="lg" disabled={running || incomplete} className="w-full sm:w-auto">
              {running ? <Loader2 className="animate-spin" /> : <Ticket />}
              {running ? 'Reservando…' : 'Confirmar reserva'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * 🔴 `committed` e `confirmed` são coisas diferentes, e a distinção IMPORTA
 * para quem comprou — só o vocabulário muda. "Aguardando confirmação" diz a
 * mesma coisa que `committed && !confirmed` sem exigir que o passageiro saiba
 * o que é polling.
 */
function BookingResult({ booking, retrieved, cancellation, running, onRetrieve, onCancel }) {
  const pending = booking.committed && !booking.confirmed;
  const status = retrieved?.status ?? (booking.confirmed ? 'confirmed' : 'pending');
  const cancelled = cancellation?.cancelled || status === 'cancelled';

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Card>
        <CardContent className="space-y-5 pt-2">
          <div className="flex items-start gap-3">
            {cancelled ? (
              <XCircle className="mt-0.5 size-5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            ) : pending ? (
              <Clock className="mt-0.5 size-5 shrink-0 text-amber-500" strokeWidth={1.5} />
            ) : (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" strokeWidth={1.5} />
            )}
            <div>
              <p className="font-medium">
                {cancelled
                  ? 'Reserva cancelada'
                  : pending
                    ? 'Reserva recebida'
                    : 'Reserva confirmada'}
              </p>
              <p className="text-sm text-muted-foreground">
                {cancelled
                  ? 'O assento foi liberado.'
                  : pending
                    ? 'A companhia está confirmando. Você pode acompanhar por aqui.'
                    : 'Tudo certo. Guarde o localizador.'}
              </p>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/50 px-4 py-3">
            <p className="text-xs text-muted-foreground">Localizador</p>
            <p className="font-mono text-2xl font-semibold tracking-wide">{booking.locator || '—'}</p>
          </div>

          {/* O voo só aparece depois de Atualizar: é o /retrieve que traz o
              itinerário, e ele é leitura ao vivo, não cópia do que guardamos. */}
          {retrieved?.segments?.length > 0 && (
            <div className="space-y-3 rounded-lg border px-4 py-3">
              {retrieved.segments.map((segment) => (
                <div key={segment.segmentId} className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="font-medium tabular-nums">
                      {formatTime(segment.departure)} → {formatTime(segment.arrival)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {segment.origin} → {segment.destination}
                      {segment.company.code ? ` · ${segment.company.code}${segment.company.number ?? ''}` : ''}
                      {segment.cabin ? ` · ${segment.cabin.toLowerCase()}` : ''}
                    </p>
                  </div>
                  {segment.duration && (
                    <span className="text-sm text-muted-foreground">{humanDuration(segment.duration)}</span>
                  )}
                </div>
              ))}
              {retrieved.total !== null && retrieved.total !== undefined && (
                <p className="border-t pt-3 text-sm">
                  Total <span className="font-medium">{formatMoney(retrieved.total, retrieved.currency)}</span>
                </p>
              )}
            </div>
          )}

          {retrieved?.expiresAt && !cancelled && (
            <p className="text-sm text-muted-foreground">
              Pague até <span className="font-medium text-foreground">{formatDeadline(retrieved.expiresAt)}</span>{' '}
              ou a companhia libera o assento.
            </p>
          )}

          {cancellation?.refund && (
            <p className="text-sm text-muted-foreground">
              Reembolso de{' '}
              <span className="font-medium text-foreground">
                {formatMoney(cancellation.refund.total, cancellation.refund.currency)}
              </span>
              .
            </p>
          )}

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button variant="outline" disabled={running} onClick={() => onRetrieve(booking.locator)}>
              {running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Atualizar
            </Button>
            {!cancelled && (
              <Button variant="ghost" disabled={running} onClick={() => onCancel(booking.locator)}>
                Cancelar reserva
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** `PT4H5M` → `4h05`. A companhia manda ISO-8601; ninguém lê ISO-8601. */
function humanDuration(iso) {
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(iso ?? '');
  if (!match) return null;

  const [, hours, minutes] = match;
  if (!hours) return `${minutes ?? 0}min`;

  return `${hours}h${minutes ? String(minutes).padStart(2, '0') : ''}`;
}

/** Data do prazo sem segundos nem fuso — o que importa é o dia e a hora. */
function formatDeadline(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
