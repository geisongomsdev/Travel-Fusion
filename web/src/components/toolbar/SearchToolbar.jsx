import { ArrowLeftRight, Plane, Search, Users, CalendarDays, Cable, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  TOOLBAR_CHIP,
  TOOLBAR_CONTROL,
  TOOLBAR_ICON,
  TOOLBAR_ICON_BUTTON,
  TOOLBAR_ICON_STROKE_WIDTH,
  TOOLBAR_SEARCH,
  TOOLBAR_SELECTED,
} from './toolbar-styles';

/**
 * A barra de busca no padrão do `TravelsToolbar`: a barra não tem moldura, e
 * cada controle é um chip. O ícone entra ANTES do controle, esmaecido e com
 * traço 1.5 — é o que dá a leitura de "campo etiquetado" sem precisar de label.
 */

const PROVIDERS = [
  { value: 'latam', label: 'LATAM NDC', hint: 'síncrono' },
  { value: 'travelfusion', label: 'Travelfusion', hint: 'polling' },
];

const TRIP_TYPES = [
  { value: 'oneway', label: 'Ida' },
  { value: 'roundtrip', label: 'Ida e volta' },
  { value: 'multicity', label: 'Multidestino' },
];

const CABINS = [
  { value: 'economy', label: 'Economy' },
  { value: 'premium_economy', label: 'Premium Economy' },
  { value: 'business', label: 'Business' },
  { value: 'first', label: 'First' },
];

/** Rótulo esmaecido + controle, o agrupamento que a barra usa. */
function Field({ icon: Icon, children, className }) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Icon className={cn('size-4 shrink-0', TOOLBAR_ICON)} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
      {children}
    </div>
  );
}

export function SearchToolbar({ form, onChange, onSwap, onSubmit, running }) {
  const update = (key) => (event) => onChange(key, event.target.value);

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-center gap-2"
    >
      <Field icon={Cable}>
        <Select
          value={form.provider}
          onChange={update('provider')}
          aria-label="Provedor"
          className={cn('w-auto pr-8', TOOLBAR_CONTROL)}
        >
          {PROVIDERS.map((provider) => (
            <option key={provider.value} value={provider.value}>
              {provider.label} · {provider.hint}
            </option>
          ))}
        </Select>
      </Field>

      <Field icon={Plane}>
        <Select
          value={form.type}
          onChange={update('type')}
          aria-label="Tipo de viagem"
          className={cn('w-auto pr-8', TOOLBAR_CONTROL)}
        >
          {TRIP_TYPES.map((type) => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </Select>
      </Field>

      {/* Origem → destino formam UM chip, com o inversor no meio: são um par,
          e separá-los em dois controles perderia essa leitura. */}
      <div className={cn('flex h-9 items-center rounded-md px-1', TOOLBAR_CHIP)}>
        <input
          value={form.origin}
          onChange={update('origin')}
          maxLength={3}
          aria-label="Origem"
          className={cn(
            'h-7 w-14 rounded-sm bg-transparent px-2 text-center text-sm font-medium uppercase text-foreground outline-none',
            'focus-visible:bg-background/70',
          )}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onSwap}
          title="Inverter origem e destino"
          aria-label="Inverter origem e destino"
          className="size-7 hover:bg-primary/10"
        >
          <ArrowLeftRight className={cn('size-3.5', TOOLBAR_ICON)} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
        </Button>
        <input
          value={form.destination}
          onChange={update('destination')}
          maxLength={3}
          aria-label="Destino"
          className={cn(
            'h-7 w-14 rounded-sm bg-transparent px-2 text-center text-sm font-medium uppercase text-foreground outline-none',
            'focus-visible:bg-background/70',
          )}
        />
      </div>

      <Field icon={CalendarDays}>
        <Input
          type="date"
          value={form.date}
          onChange={update('date')}
          aria-label="Data de ida"
          className={cn('w-auto tabular-nums', TOOLBAR_SEARCH, 'h-9')}
        />
      </Field>

      <Field icon={Users}>
        <Input
          type="number"
          min={1}
          max={9}
          value={form.adults}
          onChange={update('adults')}
          aria-label="Adultos"
          className={cn('w-16 tabular-nums', TOOLBAR_SEARCH, 'h-9')}
        />
      </Field>

      <Select
        value={form.cabin}
        onChange={update('cabin')}
        aria-label="Cabine"
        className={cn('w-auto pr-8', TOOLBAR_CONTROL)}
      >
        {CABINS.map((cabin) => (
          <option key={cabin.value} value={cabin.value}>{cabin.label}</option>
        ))}
      </Select>

      {/* A ação é o único elemento sólido da barra — tudo mais é chip. */}
      <Button type="submit" disabled={running} className="ml-auto h-9">
        {running ? <Loader2 className="animate-spin" /> : <Search />}
        {running ? 'Buscando…' : 'Buscar'}
      </Button>
    </form>
  );
}

export { TOOLBAR_SELECTED };
