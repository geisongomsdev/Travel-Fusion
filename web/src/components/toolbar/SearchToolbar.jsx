import { ArrowLeftRight, Search, Users, Cable, Route, Armchair, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AirportCombobox } from '@/components/ui/airport-combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { TOOLBAR_CHIP, TOOLBAR_ICON, TOOLBAR_ICON_STROKE_WIDTH } from './toolbar-styles';

/**
 * A barra de busca no padrão do `TravelsToolbar`: a barra não tem moldura e
 * cada controle é um chip. Nenhum controle é nativo — `select` e data usam os
 * componentes do design system, porque o `<select>` e o `input[type=date]` do
 * navegador não aceitam estilo no menu e ficavam com cara de sistema.
 */

const PROVIDERS = [
  { value: 'latam', label: 'LATAM' },
  { value: 'travelfusion', label: 'Travelfusion' },
];

/**
 * 🔴 Multidestino ficou de fora, e é honestidade, não esquecimento: o contrato
 * exige a lista COMPLETA de trechos (`segments[]`, no mínimo dois) e esta barra
 * só sabe descrever um par origem-destino. Oferecer a opção deixaria a pessoa
 * escolher algo que sempre volta 400. A API atende multidestino; falta a tela.
 */
const TRIP_TYPES = [
  { value: 'oneway', label: 'Ida' },
  { value: 'roundtrip', label: 'Ida e volta' },
];

const CABINS = [
  { value: 'economy', label: 'Econômica' },
  { value: 'premium_economy', label: 'Premium Economy' },
  { value: 'business', label: 'Executiva' },
  { value: 'first', label: 'Primeira classe' },
];

const PASSENGERS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Gatilho de select no desenho de chip da barra. */
const chipTrigger = cn(
  'gap-1.5 border-0 shadow-none',
  'bg-primary/5 text-muted-foreground hover:bg-primary/10',
  'data-[state=open]:bg-primary/10',
  "[&_svg]:[stroke-width:1.5] [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:opacity-50",
);

export function SearchToolbar({ form, onChange, onSwap, onSubmit, running }) {
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <Select value={form.provider} onValueChange={(value) => onChange('provider', value)}>
        <SelectTrigger className={chipTrigger} aria-label="Provedor">
          <Cable strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROVIDERS.map((provider) => (
            <SelectItem key={provider.value} value={provider.value}>
              {provider.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={form.type} onValueChange={(value) => onChange('type', value)}>
        <SelectTrigger className={chipTrigger} aria-label="Tipo de viagem">
          <Route strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TRIP_TYPES.map((type) => (
            <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Origem e destino formam um par: o inversor mora entre os dois. */}
      <div className="flex items-center gap-1">
        <AirportCombobox
          id="origin"
          label="Origem"
          value={form.origin}
          onChange={(iata) => onChange('origin', iata)}
          className="min-w-[9.5rem]"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onSwap}
          title="Inverter origem e destino"
          aria-label="Inverter origem e destino"
          className="size-9 shrink-0 transition-transform duration-300 hover:rotate-180 hover:bg-primary/10"
        >
          <ArrowLeftRight className={cn('size-3.5', TOOLBAR_ICON)} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
        </Button>
        <AirportCombobox
          id="destination"
          label="Destino"
          value={form.destination}
          onChange={(iata) => onChange('destination', iata)}
          className="min-w-[9.5rem]"
        />
      </div>

      <DatePicker
        value={form.date}
        onChange={(date) => onChange('date', date)}
        className={cn('h-9', TOOLBAR_CHIP)}
      />

      {/* A volta só existe quando há volta: um campo de data sempre visível
          sugeriria que a ida-e-volta é o padrão. */}
      {form.type === 'roundtrip' && (
        <DatePicker
          value={form.returnDate}
          onChange={(date) => onChange('returnDate', date)}
          className={cn('h-9', TOOLBAR_CHIP)}
        />
      )}

      <Select value={String(form.adults)} onValueChange={(value) => onChange('adults', Number(value))}>
        <SelectTrigger className={chipTrigger} aria-label="Adultos">
          <Users strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PASSENGERS.map((count) => (
            <SelectItem key={count} value={String(count)}>
              {count} {count === 1 ? 'adulto' : 'adultos'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={form.cabin} onValueChange={(value) => onChange('cabin', value)}>
        <SelectTrigger className={chipTrigger} aria-label="Cabine">
          <Armchair strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CABINS.map((cabin) => (
            <SelectItem key={cabin.value} value={cabin.value}>
              {cabin.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* A ação é o único elemento sólido da barra — todo o resto é chip. */}
      <Button type="submit" disabled={running || !form.origin || !form.destination} className="ml-auto">
        {running ? <Loader2 className="animate-spin" /> : <Search />}
        {running ? 'Buscando…' : 'Buscar'}
      </Button>
    </form>
  );
}
