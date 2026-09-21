import { ArrowLeftRight, ArrowRight, Search, Users, Baby, Cable, Route, Armchair, Loader2, Plus, X } from 'lucide-react';
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
 * 🔴 Multidestino não cabe no par origem-destino: o contrato exige a lista
 * COMPLETA de trechos (`segments[]`, no mínimo dois). Por isso, quando ele é
 * escolhido, o par some da barra e os trechos ganham linhas próprias abaixo.
 */
const TRIP_TYPES = [
  { value: 'oneway', label: 'Ida' },
  { value: 'roundtrip', label: 'Ida e volta' },
  { value: 'multicity', label: 'Multidestino' },
];

const MIN_SEGMENTS = 2;
const MAX_SEGMENTS = 6;

const segmentsReady = (segments = []) =>
  segments.length >= MIN_SEGMENTS && segments.every((s) => s.origin && s.destination && s.date);

const CABINS = [
  { value: 'economy', label: 'Econômica' },
  { value: 'premium_economy', label: 'Premium Economy' },
  { value: 'business', label: 'Executiva' },
  { value: 'first', label: 'Primeira classe' },
];

const PASSENGERS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
// Criança tem assento próprio; bebê de colo, não. A companhia cobra e valida os dois pela
// idade NA DATA DO VOO, e por isso eles entram na busca — a tarifa muda.
const CHILDREN = [0, 1, 2, 3, 4];
const INFANTS = [0, 1, 2];

/** Gatilho de select no desenho de chip da barra. */
const chipTrigger = cn(
  'gap-1.5 border-0 shadow-none',
  'bg-primary/5 text-muted-foreground hover:bg-primary/10',
  'data-[state=open]:bg-primary/10',
  "[&_svg]:[stroke-width:1.5] [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:opacity-50",
);

export function SearchToolbar({ form, onChange, onSwap, onSubmit, running }) {
  const multicity = form.type === 'multicity';
  const ready = multicity ? segmentsReady(form.segments) : Boolean(form.origin && form.destination);

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
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
        {!multicity && (
          <>
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
          </>
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

        <Select value={String(form.children ?? 0)} onValueChange={(value) => onChange('children', Number(value))}>
          <SelectTrigger className={chipTrigger} aria-label="Crianças">
            <Users strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHILDREN.map((count) => (
              <SelectItem key={count} value={String(count)}>
                {count} {count === 1 ? 'criança' : 'crianças'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={String(form.infants ?? 0)} onValueChange={(value) => onChange('infants', Number(value))}>
          <SelectTrigger className={chipTrigger} aria-label="Bebês de colo">
            <Baby strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INFANTS.map((count) => (
              <SelectItem key={count} value={String(count)}>
                {count} {count === 1 ? 'bebê de colo' : 'bebês de colo'}
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
        <Button type="submit" disabled={running || !ready} className="ml-auto">
          {running ? <Loader2 className="animate-spin" /> : <Search />}
          {running ? 'Buscando…' : 'Buscar'}
        </Button>
      </div>

      {multicity && (
        <SegmentList segments={form.segments ?? []} onChange={(segments) => onChange('segments', segments)} />
      )}
    </form>
  );
}

/**
 * Os trechos do multidestino, na ordem da viagem. Cada linha é um
 * origin-destination completo — a lista vai inteira para `segments[]`, nunca
 * reduzida a ida e volta.
 */
function SegmentList({ segments, onChange }) {
  const update = (index, key, value) =>
    onChange(segments.map((segment, i) => (i === index ? { ...segment, [key]: value } : segment)));

  const remove = (index) => onChange(segments.filter((_, i) => i !== index));

  // O próximo trecho costuma sair de onde o anterior chegou: já vem preenchido.
  const add = () => {
    const last = segments[segments.length - 1];
    onChange([...segments, { origin: last?.destination ?? '', destination: '', date: last?.date ?? '' }]);
  };

  return (
    <div className="space-y-2">
      {segments.map((segment, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-xs text-muted-foreground">Trecho {index + 1}</span>
          <AirportCombobox
            id={`segment-${index}-origin`}
            label="Origem"
            value={segment.origin}
            onChange={(iata) => update(index, 'origin', iata)}
            className="min-w-[9.5rem]"
          />
          <ArrowRight className={cn('size-3.5', TOOLBAR_ICON)} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
          <AirportCombobox
            id={`segment-${index}-destination`}
            label="Destino"
            value={segment.destination}
            onChange={(iata) => update(index, 'destination', iata)}
            className="min-w-[9.5rem]"
          />
          <DatePicker
            value={segment.date}
            onChange={(date) => update(index, 'date', date)}
            className={cn('h-9', TOOLBAR_CHIP)}
          />
          {/* Abaixo de dois trechos não é multidestino: a API devolveria 400. */}
          {segments.length > MIN_SEGMENTS && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => remove(index)}
              title="Remover trecho"
              aria-label={`Remover trecho ${index + 1}`}
              className="size-9 shrink-0 hover:bg-primary/10"
            >
              <X className={cn('size-3.5', TOOLBAR_ICON)} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
            </Button>
          )}
        </div>
      ))}

      {segments.length < MAX_SEGMENTS && (
        <Button type="button" variant="ghost" size="sm" onClick={add} className="hover:bg-primary/10">
          <Plus className={TOOLBAR_ICON} strokeWidth={TOOLBAR_ICON_STROKE_WIDTH} />
          Adicionar trecho
        </Button>
      )}
    </div>
  );
}
