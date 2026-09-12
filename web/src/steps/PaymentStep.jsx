import { useState } from 'react';
import { Armchair, CheckCircle2, CreditCard, FileText, Loader2, Lock, XCircle } from 'lucide-react';
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
 * companhia. Foi de propósito: um total vindo do navegador é um total que dá
 * para mexer.
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
  onShowExtras,
  onVoucher,
  onCancel,
  cancellation,
  children,
}) {
  const [card, setCard] = useState({
    brand: 'VI',
    number: '4000000000002701',
    cvv: '737',
    expiryDate: '03/2030',
  });

  /** Quem PAGA pode não ser quem viaja — e no Brasil o CPF é do titular. */
  const [holder, setHolder] = useState({
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
  const updateHolder = update(setHolder);
  const updateBilling = update(setBilling);

  if (issued) {
    return (
      <PaymentResult
        issued={issued}
        running={running}
        cancellation={cancellation}
        onShowExtras={onShowExtras}
        onVoucher={onVoucher}
        onCancel={onCancel}
      >
        {children}
      </PaymentResult>
    );
  }

  const submit = (event) => {
    event.preventDefault();
    onPay({
      /**
       * O cartão no vocabulário do contrato. O titular viaja DENTRO dele:
       * a companhia exige CPF e nascimento do pagador, e a API recusa antes da
       * rede quando faltam.
       */
      creditCard: {
        ...card,
        holderName: `${holder.firstName} ${holder.lastName}`.trim(),
        holderDocument: holder.documentNumber,
        holderBirthDate: holder.dateOfBirth,
        holderEmail: billing.email,
      },
      billing,
      installmentId: chosen?.id ?? null,
    });
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
              <div className="space-y-1.5">
                <Label htmlFor="expiryDate">Validade</Label>
                <Input
                  id="expiryDate"
                  placeholder="MM/AAAA"
                  value={card.expiryDate}
                  onChange={updateCard('expiryDate')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cvv">Código de segurança</Label>
                <Input
                  id="cvv"
                  inputMode="numeric"
                  autoComplete="off"
                  value={card.cvv}
                  onChange={updateCard('cvv')}
                />
              </div>
            </div>

            <div className="space-y-4 border-t pt-6">
              <div>
                <p className="text-sm font-medium">Titular do cartão</p>
                <p className="text-sm text-muted-foreground">
                  Precisa bater com os dados cadastrados no banco.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="holderFirst">Nome</Label>
                  <Input id="holderFirst" value={holder.firstName} onChange={updateHolder('firstName')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="holderLast">Sobrenome</Label>
                  <Input id="holderLast" value={holder.lastName} onChange={updateHolder('lastName')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="holderDoc">CPF</Label>
                  <Input
                    id="holderDoc"
                    inputMode="numeric"
                    value={holder.documentNumber}
                    onChange={updateHolder('documentNumber')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="holderBirth">Data de nascimento</Label>
                  <Input
                    id="holderBirth"
                    type="date"
                    value={holder.dateOfBirth}
                    onChange={updateHolder('dateOfBirth')}
                  />
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
                  {option.interestRate ? 'com juros · ' : 'sem juros · '}
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

/**
 * Passagem paga.
 *
 * 🔴 A PROVA da emissão é o número do bilhete, não o status. `confirmed: null`
 * quer dizer que a companhia ainda não fechou e a prova não existe — a tela diz
 * "em processamento", e não promete passagem.
 *
 * 🔴 É AQUI que aparece cancelar, e não na tela da reserva. Antes de pagar não
 * há o que cancelar: a reserva não paga expira sozinha no prazo, e a companhia
 * recusa o cancelamento com "estado inválido". Oferecer um botão que sempre
 * falha é pior do que não oferecer.
 */
function PaymentResult({ issued, running, cancellation, onShowExtras, onVoucher, onCancel, children }) {
  const cancelled = cancellation?.status === 'CANCELLED';
  const done = issued.confirmed === true;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Card>
        <CardContent className="space-y-5 pt-2">
          <div className="flex items-start gap-3">
            {cancelled ? (
              <XCircle className="mt-0.5 size-5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            ) : (
              <CheckCircle2
                className={cn('mt-0.5 size-5 shrink-0', done ? 'text-emerald-600' : 'text-amber-500')}
                strokeWidth={1.5}
              />
            )}
            <div>
              <p className="font-medium">
                {cancelled
                  ? 'Passagem cancelada'
                  : done
                    ? 'Pagamento aprovado · passagem emitida'
                    : 'Pagamento em processamento'}
              </p>
              <p className="text-sm text-muted-foreground">
                {cancelled
                  ? cancellation?.refund
                    ? `A companhia confirmou o cancelamento e devolve ${formatMoney(cancellation.refund.amount, cancellation.refund.currency)}.`
                    : 'A companhia confirmou o cancelamento.'
                  : done
                    ? 'Está tudo certo. Dá para escolher assento e bagagem mesmo com a passagem já emitida.'
                    : 'A companhia ainda está fechando a cobrança. Atualize em instantes.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="min-w-[9rem] flex-1 rounded-lg border bg-muted/50 px-4 py-3">
              <p className="text-xs text-muted-foreground">Pago</p>
              <p className="text-2xl font-semibold tabular-nums">
                {formatMoney(issued.amount?.total, issued.amount?.currency)}
              </p>
            </div>
            {issued.tickets?.length > 0 && (
              <div className="min-w-[9rem] flex-1 rounded-lg border px-4 py-3">
                <p className="text-xs text-muted-foreground">Bilhete</p>
                {issued.tickets.map((ticket, index) => (
                  <p key={ticket.ticketNumber ?? index} className="font-mono text-sm">
                    {ticket.ticketNumber}
                  </p>
                ))}
              </div>
            )}
          </div>

          {!cancelled && (
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button onClick={onVoucher}>
                <FileText /> Ver bilhete
              </Button>
              {done && (
                <Button variant="outline" onClick={onShowExtras}>
                  <Armchair /> Assento e bagagem
                </Button>
              )}
              <Button variant="ghost" disabled={running} onClick={onCancel}>
                {running ? <Loader2 className="animate-spin" /> : null}
                Cancelar passagem
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Os extras entram embaixo, na mesma tela: não são outra etapa do fluxo,
          são o que dá para fazer com a passagem já na mão. */}
      {children}
    </div>
  );
}
