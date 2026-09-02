import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/lib/utils';

/**
 * Tarifar = ProcessDetails. É aqui que os `requiredParameters` aparecem — os CSPs
 * que o provedor vai exigir na reserva, bagagem incluída.
 *
 * O ProcessTerms é ÚNICO: o que não for escolhido agora não tem segunda chance.
 */
export function QuoteStep({ quote, selection, onContinue, onChangeParameter, parameters }) {
  if (!quote) return null;
  const { price, requiredParameters = [] } = quote;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        {requiredParameters.length === 0 && (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              O provedor não pediu nenhum parâmetro adicional para esta oferta.
            </CardContent>
          </Card>
        )}

        {requiredParameters.map((parameter) => (
          <Card key={parameter.name}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>{labelFor(parameter.name)}</CardTitle>
                <Badge variant="outline">{parameter.perPassenger ? 'por passageiro' : 'por reserva'}</Badge>
                {parameter.optional && <Badge variant="secondary">opcional</Badge>}
              </div>
              <CardDescription className="font-mono text-xs">{parameter.name}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {parameter.options.length === 0 && (
                <p className="text-sm text-muted-foreground">{parameter.displayText || 'Sem opções parseáveis.'}</p>
              )}
              {parameter.options.map((option) => {
                const selected = parameters[parameter.name] === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onChangeParameter(parameter.name, selected ? null : option.value)}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      selected ? 'border-primary bg-accent' : 'hover:bg-accent/50'
                    }`}
                  >
                    <span>
                      {option.quantity !== null && `${option.quantity} peça(s)`}
                      {option.weightKg !== null && ` · ${option.weightKg}kg`}
                      {option.quantity === null && option.weightKg === null && option.label}
                    </span>
                    <span className="font-medium">
                      {option.price ? formatMoney(option.price.total, option.price.currency) : '—'}
                    </span>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Preço firme</CardTitle>
          <CardDescription>
            <code className="text-xs">POST /quote</code> — valor confirmado agora, sem margem.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row label="Tarifa" value={formatMoney(price?.base, price?.currency)} />
          <Row label="Taxas" value={formatMoney(price?.taxes?.boarding, price?.currency)} />
          <Row label="Taxa de distribuição" value={formatMoney(price?.fees, price?.currency)} />
          <div className="border-t pt-3">
            <Row label="Total" value={formatMoney(price?.total, price?.currency)} strong />
          </div>
          <p className="text-xs text-muted-foreground">
            {selection?.leg?.origin?.code} → {selection?.leg?.destination?.code}
          </p>
          <Button className="w-full" onClick={onContinue}>Reservar</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, strong }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'text-base font-semibold' : ''}>{value}</span>
    </div>
  );
}

function labelFor(name) {
  if (/OutwardLuggage/i.test(name)) return 'Bagagem — ida';
  if (/ReturnLuggage/i.test(name)) return 'Bagagem — volta';
  if (/Luggage/i.test(name)) return 'Bagagem';
  return name;
}
