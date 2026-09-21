import { useState } from 'react';
import { CheckCircle2, Clock, CreditCard, Loader2, RefreshCw, Ticket, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn, formatMoney, formatTime } from '@/lib/utils';

/**
 * Os viajantes que a oferta espera, na MESMA ordem em que ela foi tarifada:
 * `ADT_1…`, depois `CHD_1…`, depois `INF_1…`.
 *
 * 🔴 O `identifier` não é numeração da tela: é o PaxID com que a companhia tarifou a
 * oferta. A API recusa a reserva que não traz todos eles, e recusa um id que não esteja na
 * oferta — reservar com menos gente pagaria um preço que cobre mais.
 */
function travellersOf({ adults = 1, children = 0, infants = 0 } = {}) {
  const build = (prefix, count, ageGroup, label) =>
    Array.from({ length: count }, (_, index) => ({
      identifier: `${prefix}_${index + 1}`,
      ageGroup,
      label: count > 1 ? `${label} ${index + 1}` : label,
      firstName: '',
      lastName: '',
      birthdate: '',
      documentNumber: '',
    }));

  return [
    ...build('ADT', Math.max(1, adults), 'adult', 'Adulto'),
    ...build('CHD', children, 'child', 'Criança'),
    ...build('INF', infants, 'infant', 'Bebê de colo'),
  ];
}

/**
 * 🔴 Os campos aqui não são escolha de tela: são os `requiredParameters` que o
 * `/quote` declarou. Nome, nascimento e documento vão POR PASSAGEIRO; e-mail e
 * telefone são da reserva, e a companhia recusa a ordem sem eles.
 *
 * O que NÃO aparece: nome de mensagem NDC, URL de endpoint e aviso de
 * idempotência. Isso é verdade da integração — vive no README e no código, não
 * na frente de quem está comprando.
 */
export function BookingStep({ onBook, running, booking, retrieved, cancellation, onRetrieve, onPay, passengers }) {
  const [travellers, setTravellers] = useState(() => travellersOf(passengers));

  const [contact, setContact] = useState({
    email: 'andy@example.com',
    phone: '11999999999',
  });

  const updateTraveller = (index, key) => (event) => setTravellers((prev) => prev.map((traveller, position) => (
    position === index ? { ...traveller, [key]: event.target.value } : traveller
  )));

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

    onBook(
      travellers.map(({ label, documentNumber, ...traveller }) => ({
        ...traveller,
        main: traveller.identifier === 'ADT_1',
        ...(traveller.ageGroup === 'adult' ? { title: 'Mr' } : {}),
        ...(documentNumber ? { document: { type: 'PASSPORT', number: documentNumber } } : {}),
      })),
      {
        email: contact.email,
        ...(contact.phone ? { phone: { number: contact.phone } } : {}),
      },
    );
  };

  // A companhia recusa a ordem sem contato, e sem nome e nascimento de cada viajante.
  const incomplete = (!contact.email && !contact.phone)
    || travellers.some((traveller) => !traveller.firstName || !traveller.lastName || !traveller.birthdate);

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>
            {travellers.length === 1 ? 'Quem vai viajar' : `Quem vai viajar · ${travellers.length} passageiros`}
          </CardTitle>
          <CardDescription>
            O nome precisa ser igual ao do documento apresentado no embarque.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={submit}>
            {travellers.map((traveller, index) => (
              <div key={traveller.identifier} className={cn('space-y-4', index > 0 && 'border-t pt-6')}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{traveller.label}</p>
                  {traveller.ageGroup === 'infant' && (
                    <p className="text-xs text-muted-foreground">Viaja no colo, sem assento próprio.</p>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`firstName-${traveller.identifier}`}>Nome</Label>
                    <Input
                      id={`firstName-${traveller.identifier}`}
                      value={traveller.firstName}
                      onChange={updateTraveller(index, 'firstName')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`lastName-${traveller.identifier}`}>Sobrenome</Label>
                    <Input
                      id={`lastName-${traveller.identifier}`}
                      value={traveller.lastName}
                      onChange={updateTraveller(index, 'lastName')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`birthdate-${traveller.identifier}`}>Data de nascimento</Label>
                    <Input
                      id={`birthdate-${traveller.identifier}`}
                      type="date"
                      value={traveller.birthdate}
                      onChange={updateTraveller(index, 'birthdate')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`document-${traveller.identifier}`}>Documento</Label>
                    <Input
                      id={`document-${traveller.identifier}`}
                      value={traveller.documentNumber}
                      onChange={updateTraveller(index, 'documentNumber')}
                      placeholder="Passaporte ou RG"
                    />
                  </div>
                </div>
              </div>
            ))}

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
  const locator = booking.locator;
  const pending = booking.committed && !booking.confirmed;
  const status = retrieved?.status ?? (booking.confirmed ? 'confirmed' : 'pending');
  const cancelled = cancellation?.status === 'CANCELLED' || status === 'cancelled';

  // 🔴 `segments` (ida, ida-e-volta) e `itinerary` (multidestino) são
  // exclusivos: a viagem inteira está em um dos dois.
  const journeys = legsOf(retrieved);
  const total = retrieved?.fields?.pricing?.total;

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
                        ? ` · ${journey.flights[0].company.code}${journey.flights[0].number ?? ''}`
                        : ''}
                      {journey.stops > 0 ? ` · ${journey.stops} parada(s)` : ''}
                    </p>
                  </div>
                  {journey.time?.duration > 0 && (
                    <span className="text-sm text-muted-foreground">{humanDuration(journey.time.duration)}</span>
                  )}
                </div>
              ))}
              {total != null && (
                <p className="border-t pt-3 text-sm">
                  Total{' '}
                  <span className="font-medium">
                    {formatMoney(total, retrieved.currency)}
                  </span>
                </p>
              )}
            </div>
          )}

          {retrieved?.expiresAt && !cancelled && (
            <p className="text-sm text-muted-foreground">
              Pague até{' '}
              <span className="font-medium text-foreground">{formatDeadline(retrieved.expiresAt)}</span>{' '}
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

/** As pernas da reserva, de `segments` ou de `itinerary` — 08-retrieve.md §3.5. */
export function legsOf(retrieved) {
  if (retrieved?.segments) return [...(retrieved.segments.departure ?? []), ...(retrieved.segments.return ?? [])];
  return retrieved?.itinerary?.legs ?? [];
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
