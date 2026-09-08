import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CodeBlock } from '@/components/sandbox/CodeBlock';
import { Callout } from '@/components/sandbox/Callout';
import { Endpoint } from '@/components/sandbox/Endpoint';
import { FieldTable } from '@/components/sandbox/FieldTable';
import { cn, formatMoney } from '@/lib/utils';

/**
 * Tarifar = OfferPrice na LATAM, ProcessDetails na Travelfusion. É aqui que os
 * `requiredParameters` aparecem — o que o provedor vai exigir na reserva.
 *
 * A tabela é a mesma das páginas de operação do sandbox
 * (`Field Name | Type | Accepted Values | Required`), porque descreve a mesma
 * coisa: os campos da próxima mensagem.
 */

/** Exemplos tirados da tabela de campos do `operations/order-create.md`. */
const EXAMPLE = {
  firstName: 'Andy — min 2 / max 28 letras',
  lastName: 'Peterson — min 2 / max 28 letras',
  dateOfBirth: '1990-04-21',
  documentNumber: 'AAB0302',
  email: 'test@mail.com',
  phone: '11999999999',
};

const TYPE_LABEL = {
  string: 'A-z Token',
  date: 'ISO Date',
  email: 'Email',
  number: '0-9 Token',
};

export function QuoteStep({ quote, selection, onContinue, onChangeParameter, parameters }) {
  if (!quote) return null;
  const { price, requiredParameters = [] } = quote;

  const rows = requiredParameters.map((parameter) => ({
    name: parameter.name,
    type: TYPE_LABEL[parameter.type] ?? parameter.type ?? 'A-z Token',
    example: EXAMPLE[parameter.name] ?? parameter.displayText ?? '—',
    required: !parameter.optional,
  }));

  // Parâmetros com opções de preço (a bagagem da Travelfusion) viram escolha.
  const selectable = requiredParameters.filter((parameter) => parameter.options?.length > 0);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Offer Price</CardTitle>
            <CardDescription>Confirma o preço da oferta escolhida, sem margem nem estimativa.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Endpoint
              method="POST"
              path="https://sandbox.api.latam.com/ndc/v192/offerPrice"
              note="Atenção ao camelCase: /offerprice responde 404 Invalid url."
            />
            <Callout tone="advice" title="Advice">
              Os valores do AirShopping são para <strong>1 ADT</strong>. Em ofertas multi-pax é o
              OfferPrice que devolve o preço real do total de passageiros.
            </Callout>
          </CardContent>
        </Card>

        {rows.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>O que o OrderCreate vai exigir</CardTitle>
              <CardDescription>Declarado pelo provedor nesta tarifação. Junte tudo antes de reservar.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldTable rows={rows} />
            </CardContent>
          </Card>
        )}

        {selectable.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Serviços opcionais</CardTitle>
              <CardDescription>
                O ProcessTerms é ÚNICO: o que não for escolhido agora não tem segunda chance.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectable.map((parameter) => (
                <div key={parameter.name} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{labelFor(parameter.name)}</span>
                    <code className="font-mono text-[11px] text-muted-foreground">{parameter.name}</code>
                    <Badge variant="outline">{parameter.perPassenger ? 'por passageiro' : 'por reserva'}</Badge>
                  </div>
                  {parameter.options.map((option) => {
                    const selected = parameters[parameter.name] === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onChangeParameter(parameter.name, selected ? null : option.value)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors',
                          selected
                            ? 'border-primary bg-accent font-medium text-accent-foreground'
                            : 'border-border hover:border-primary/40 hover:bg-accent/40',
                        )}
                      >
                        <span>
                          {option.quantity !== null && `${option.quantity} peça(s)`}
                          {option.weightKg !== null && ` · ${option.weightKg}kg`}
                          {option.quantity === null && option.weightKg === null && option.label}
                        </span>
                        <span className="font-semibold">
                          {option.price ? formatMoney(option.price.total, option.price.currency) : '—'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="h-fit lg:sticky lg:top-5">
        <CardHeader>
          <CardTitle>Preço firme</CardTitle>
          <CardDescription>
            {selection?.leg?.origin?.code} → {selection?.leg?.destination?.code}
            {selection?.fare?.family ? ` · ${selection.fare.family}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row label="Tarifa" value={formatMoney(price?.base, price?.currency)} />
          <Row label="Taxas" value={formatMoney(price?.taxes?.boarding, price?.currency)} />
          <Row label="Taxa de distribuição" value={formatMoney(price?.fees, price?.currency)} />
          <div className="border-t border-border pt-3">
            <Row label="Total" value={formatMoney(price?.total, price?.currency)} strong />
          </div>
          <Button variant="brand" size="lg" className="w-full" onClick={onContinue}>
            Reservar
          </Button>
          <CodeBlock code={JSON.stringify(price, null, 2)} language="json" title="price" maxHeight="13rem" />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, strong }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'text-lg font-semibold text-primary' : 'font-medium'}>{value}</span>
    </div>
  );
}

function labelFor(name) {
  if (/OutwardLuggage/i.test(name)) return 'Bagagem — ida';
  if (/ReturnLuggage/i.test(name)) return 'Bagagem — volta';
  if (/Luggage/i.test(name)) return 'Bagagem';
  return name;
}
