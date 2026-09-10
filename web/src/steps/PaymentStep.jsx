import { useState } from 'react';
import { CheckCircle2, CreditCard, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn, formatMoney } from '@/lib/utils';

/**
 * Pagar a reserva.
 *
 * 🔴 O TOTAL NÃO É DIGITADO NEM ESCOLHIDO AQUI. Ele vem do `/retrieve`, que
 * pergunta à companhia quanto custa. A tela mostra o número; quem decide é a
 * LATAM. Foi de propósito: um total vindo do navegador é um total que dá para
 * mexer.
 *
 * 🔴 Nada de cartão fica nesta tela depois do envio, e nada volta na resposta.
 */
export function PaymentStep({
  locator,
  amount,
  currency,
  running,
  installments,
  loadingInstallments,
  onLoadInstallments,
  issued,
  onPay,
  onDone,
}) {
  const [card, setCard] = useState({
    brand: 'VI',
    holder: 'ANDY PETERSON',
    number: '4000000000002701',
    securityCode: '737',
    expiration: '03/30',
  });

  const [payer, setPayer] = useState({
    firstName: 'Andy',
    lastName: 'Peterson',
    dateOfBirth: '1990-04-21',
    documentNumber: '52998224725',
  });

  const [billing, setBilling] = useState({
    email: 'andy@example.com',
    countryCode: 'BR',
    postalCode: '01310-100',
    street: 'Av. Paulista, 1000',
  });

  const [chosen, setChosen] = useState(null);

  const update = (setter) => (key) => (event) =>
    setter((prev) => ({ ...prev, [key]: event.target.value }));

  const updateCard = update(setCard);
  const updatePayer = update(setPayer);
  const updateBilling = update(setBilling);

  if (issued) return <PaymentResult issued={issued} onDone={onDone} />;

  const submit = (event) => {
    event.preventDefault();
    onPay({ card, payer, billing, installmentId: chosen?.id ?? null });
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Pagamento</CardTitle>
          <CardDescription>
            Reserva {locator}
            {amount != null && <> · total de <strong>{formatMoney(amount, currency)}</strong></>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={submit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="number">Número do cartão</Label>
                <Input
                  id="number"
                  inputMode="numeric"
                  autoComplete="off"
                  value={card.number}
                  onChange={updateCard('number')}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="holder">Nome impresso no cartão</Label>
                <Input id="holder" autoComplete="off" value={card.holder} onChange={updateCard('holder')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="expiration">Validade</Label>
                <Input id="expiration" placeholder="MM/AA" value={card.expiration} onChange={updateCard('expiration')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="securityCode">Código de segurança</Label>
                <Input
                  id="securityCode"
                  inputMode="numeric"
                  autoComplete="off"
                  value={card.securityCode}
                  onChange={updateCard('securityCode')}
                />
              </div>
            </div>

            {/* Quem paga pode não ser quem viaja — e no Brasil o CPF é do titular. */}
            <div className="space-y-4 border-t pt-6">
              <div>
                <p className="text-sm font-medium">Titular do cartão</p>
                <p className="text-sm text-muted-foreground">
                  Precisa bater com os dados cadastrados no banco.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="payerFirst">Nome</Label>
                  <Input id="payerFirst" value={payer.firstName} onChange={updatePayer('firstName')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payerLast">Sobrenome</Label>
                  <Input id="payerLast" value={payer.lastName} onChange={updatePayer('lastName')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payerDoc">CPF</Label>
                  <Input id="payerDoc" inputMode="numeric" value={payer.documentNumber} onChange={updatePayer('documentNumber')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payerBirth">Data de nascimento</Label>
                  <Input id="payerBirth" type="date" value={payer.dateOfBirth} onChange={updatePayer('dateOfBirth')} />
                </div>
              </div>
            </div>

            <div className="space-y-4 border-t pt-6">
              <p className="text-sm font-medium">Endereço de cobrança</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="street">Endereço</Label>
                  <Input id="street" value={billing.street} onChange={updateBilling('street')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="postalCode">CEP</Label>
                  <Input id="postalCode" value={billing.postalCode} onChange={updateBilling('postalCode')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="billingEmail">E-mail</Label>
                  <Input id="billingEmail" type="email" value={billing.email} onChange={updateBilling('email')} />
                </div>
              </div>
            </div>

            <Installments
              options={installments}
              loading={loadingInstallments}
              chosen={chosen}
              amount={amount}
              currency={currency}
              onLoad={() => onLoadInstallments(card.number)}
              onChoose={setChosen}
            />

            <div className="flex flex-wrap items-center gap-3 border-t pt-6">
              <Button type="submit" size="lg" disabled={running}>
                {running ? <Loader2 className="animate-spin" /> : <CreditCard />}
                {running ? 'Pagando…' : `Pagar ${amount != null ? formatMoney(amount, currency) : ''}`}
              </Button>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3.5" strokeWidth={1.5} />
                Os dados do cartão não são guardados.
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Parcelas.
 *
 * 🔴 Só a companhia sabe em quantas vezes ESTE cartão pode pagar — depende da
 * bandeira e do emissor, e por isso a consulta leva o número. Lista vazia é
 * resposta válida: quer dizer "só à vista".
 */
function Installments({ options, loading, chosen, amount, currency, onLoad, onChoose }) {
  return (
    <div className="space-y-3 border-t pt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Parcelamento</p>
          <p className="text-sm text-muted-foreground">Consulte em quantas vezes este cartão pode pagar.</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={onLoad}>
          {loading ? <Loader2 className="animate-spin" /> : null}
          {options ? 'Consultar de novo' : 'Ver parcelas'}
        </Button>
      </div>

      {options?.length === 0 && (
        <p className="text-sm text-muted-foreground">Este cartão só aceita pagamento à vista.</p>
      )}

      {options?.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => {
            const selected = chosen?.id === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onChoose(selected ? null : option)}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-left transition-colors',
                  selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent',
                )}
              >
                <p className="text-sm font-medium tabular-nums">
                  {option.installments}x de {formatMoney(option.installmentAmount, currency)}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {/* Juros zero é o caso comum aqui, e vale dizer com todas as letras. */}
                  {option.interestRate ? `com juros · ` : 'sem juros · '}
                  {formatMoney(option.total ?? amount, currency)}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 🔴 `pending` NÃO é emitido: o bilhete só existe no status final. */
function PaymentResult({ issued, onDone }) {
  const done = issued.issued;

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardContent className="space-y-5 pt-2">
          <div className="flex items-start gap-3">
            <CheckCircle2
              className={cn('mt-0.5 size-5 shrink-0', done ? 'text-emerald-600' : 'text-amber-500')}
              strokeWidth={1.5}
            />
            <div>
              <p className="font-medium">{done ? 'Pagamento aprovado' : 'Pagamento em processamento'}</p>
              <p className="text-sm text-muted-foreground">
                {done
                  ? 'A passagem está paga. Agora dá para escolher assento e bagagem.'
                  : 'A companhia ainda está fechando a cobrança. Atualize a reserva em instantes.'}
              </p>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/50 px-4 py-3">
            <p className="text-xs text-muted-foreground">Pago</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatMoney(issued.amount?.total, issued.amount?.currency)}
            </p>
          </div>

          {issued.tickets?.length > 0 && (
            <div className="rounded-lg border px-4 py-3">
              <p className="text-xs text-muted-foreground">Bilhete</p>
              {issued.tickets.map((ticket) => (
                <p key={ticket} className="font-mono text-sm">{ticket}</p>
              ))}
            </div>
          )}

          <Button className="w-full sm:w-auto" onClick={onDone}>
            Escolher assento e bagagem
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
