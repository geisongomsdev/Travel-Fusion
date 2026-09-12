import { useState } from 'react';
import { CheckCircle2, Clock, CreditCard, Loader2, RefreshCw, Ticket, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatMoney, formatTime } from '@/lib/utils';

/**
 * 🔴 Os campos aqui não são escolha de tela: são os `requiredParameters` que o
 * `/quote` declarou. O documento vai por passageiro; e-mail e telefone são da
 * reserva, e a companhia recusa a ordem sem eles.
 *
 * O que NÃO aparece: nome de mensagem NDC, URL de endpoint e aviso de
 * idempotência. Isso é verdade da integração — vive no README e no código, não
 * na frente de quem está comprando.
 */
export function BookingStep({ onBook, running, booking, retrieved, cancellation, onRetrieve, onPay }) {
  const [passenger, setPassenger] = useState({
    title: 'Mr',
    firstName: 'Andy',
    lastName: 'Peterson',
    birthDate: '1990-04-21',
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
        onPay={onPay}
      />
    );
  }

  const submit = (event) => {
    event.preventDefault();
    const { documentNumber, ...individual } = passenger;

    /**
     * 🔴 `people` é um MAPA com o PaxID na chave. A oferta foi tarifada para
     * uma composição específica, e é o PaxID que amarra tarifa, assento e
     * bilhete ao passageiro certo.
     */
    onBook(
      {
        ADT_1: {
          ...individual,
          ageGroup: 'adult',
          document: { type: 'PASSPORT', number: documentNumber },
        },
      },
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
                <Label htmlFor="birthDate">Data de nascimento</Label>
                <Input
                  id="birthDate"
                  type="date"
                  value={passenger.birthDate}
                  onChange={updatePassenger('birthDate')}
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
function BookingResult({ booking, retrieved, cancellation, running, onRetrieve, onPay }) {
  const locator = booking.booking?.locator;
  const pending = booking.committed && !booking.confirmed;
  const status = retrieved?.booking?.status ?? (booking.confirmed ? 'confirmed' : 'pending');
  const cancelled = cancellation?.status === 'CANCELLED' || status === 'cancelled';

  // 🔴 A lista COMPLETA de pernas. Em multidestino `departure`/`return` vêm
  // `null` de propósito, e só `journeys` tem a viagem inteira.
  const journeys = retrieved?.segments?.journeys ?? [];

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
            <p className="font-mono text-2xl font-semibold tracking-wide">{locator || '—'}</p>
          </div>

          {/* O voo só aparece depois de Atualizar: é o /retrieve que traz o
              itinerário, e ele é leitura ao vivo, não cópia do que guardamos. */}
          {journeys.length > 0 && (
            <div className="space-y-3 rounded-lg border px-4 py-3">
              {journeys.map((journey, index) => (
                <div key={index} className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="font-medium tabular-nums">
                      {formatTime(journey.time?.departure)} → {formatTime(journey.time?.arrival)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {journey.origin?.iata} → {journey.destination?.iata}
                      {journey.flights?.[0]?.company?.code
                        ? ` · ${journey.flights[0].company.code}${journey.flights[0].company.number ?? ''}`
                        : ''}
                      {journey.stops > 0 ? ` · ${journey.stops} parada(s)` : ''}
                    </p>
                  </div>
                  {journey.time?.duration > 0 && (
                    <span className="text-sm text-muted-foreground">{humanDuration(journey.time.duration)}</span>
                  )}
                </div>
              ))}
              {retrieved?.total != null && (
                <p className="border-t pt-3 text-sm">
                  Total{' '}
                  <span className="font-medium">
                    {formatMoney(retrieved.total, retrieved.booking?.currency)}
                  </span>
                </p>
              )}
            </div>
          )}

          {retrieved?.booking?.timeLimit && !cancelled && (
            <p className="text-sm text-muted-foreground">
              Pague até{' '}
              <span className="font-medium text-foreground">{formatDeadline(retrieved.booking.timeLimit)}</span>{' '}
              ou a companhia libera o assento.
            </p>
          )}

          {/*
            🔴 Não existe "cancelar" aqui, e é de propósito. Reserva não paga não
            precisa de cancelamento: ela expira no prazo acima, e a companhia
            recusa o pedido com "estado inválido". O botão vive na tela de
            pagamento, depois que existe passagem para cancelar.
          */}
          {!cancelled && (
            <p className="text-sm text-muted-foreground">
              Ainda não é preciso cancelar nada: sem pagamento, a reserva expira sozinha no prazo.
            </p>
          )}

          {cancellation?.refund && (
            <p className="text-sm text-muted-foreground">
              Reembolso de{' '}
              <span className="font-medium text-foreground">
                {formatMoney(cancellation.refund.amount, cancellation.refund.currency)}
              </span>
              .
            </p>
          )}

          <div className="flex flex-wrap gap-2 border-t pt-4">
            {/* 🔴 Reservar não é pagar: a companhia segura o assento por um prazo
                e só o pagamento fecha a passagem. */}
            {!cancelled && (
              <Button disabled={running} onClick={onPay}>
                <CreditCard /> Pagar
              </Button>
            )}
            <Button variant="outline" disabled={running} onClick={() => onRetrieve(locator)}>
              {running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Atualizar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** `245` → `4h05`. A API publica minutos; ninguém lê minutos. */
function humanDuration(minutes) {
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h${rest ? String(rest).padStart(2, '0') : ''}` : `${rest}min`;
}

/** Data do prazo sem segundos nem fuso — o que importa é o dia e a hora. */
function formatDeadline(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
