import { useEffect, useMemo, useRef, useState } from 'react';
import { Plane, Search, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { airportByIata, searchAirports } from '@/lib/airports';
import { cn } from '@/lib/utils';

/**
 * Escolha de aeroporto, no padrão do `AirportRow` / `AirportAutocomplete` do
 * design system:
 *
 *   - fechado, mostra `Cidade` com o IATA em monoespaçado do lado;
 *   - ao focar, vira campo de busca com a lista abaixo;
 *   - setas navegam, Enter escolhe, Esc fecha;
 *   - com valor preenchido, a lupa dá lugar ao botão de limpar — é o que se
 *     quer ali depois de escolher.
 *
 * Guarda os últimos escolhidos em `localStorage`, como o original, para a lista
 * já vir útil antes de digitar qualquer coisa.
 */
const RECENTS_KEY = 'pass_recent_airports';
const MAX_RECENTS = 5;

const readRecents = () => {
  try {
    const stored = localStorage.getItem(RECENTS_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((iata) => typeof iata === 'string') : [];
  } catch {
    // Janela anônima, storage bloqueado: seguir sem recentes é aceitável.
    return [];
  }
};

const pushRecent = (iata) => {
  try {
    const next = [iata, ...readRecents().filter((item) => item !== iata)].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // idem
  }
};

export function AirportCombobox({ value, onChange, label, className, id }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef(null);

  const airport = airportByIata(value);

  const results = useMemo(() => {
    if (query.trim().length > 0) return searchAirports(query);
    // Sem busca: os recentes, e o próprio selecionado no topo se não estiver lá.
    const recents = readRecents().map(airportByIata).filter(Boolean);
    if (airport && !recents.some((item) => item.iata === airport.iata)) return [airport, ...recents];
    return recents;
  }, [query, airport]);

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  const choose = (picked) => {
    if (!picked) return;
    onChange(picked.iata);
    pushRecent(picked.iata);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (results.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[highlighted]);
    }
  };

  return (
    <Popover
      open={open}
      // 🔴 Tem que ser `PopoverTrigger`, não `PopoverAnchor`: o Radix só isenta
      // o TRIGGER da detecção de clique-fora. Com âncora, o próprio clique que
      // abre o popover é lido como externo e o fecha no mesmo quadro.
      onOpenChange={(next) => {
        setOpen(next);
        if (next) requestAnimationFrame(() => inputRef.current?.focus());
        else setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <div
          role="combobox"
          aria-expanded={open}
          tabIndex={0}
          className={cn(
            'flex h-9 cursor-text items-center gap-2 rounded-md px-2.5 transition-colors',
            'bg-primary/5 hover:bg-primary/10',
            'data-[state=open]:bg-primary/10 data-[state=open]:ring-2 data-[state=open]:ring-ring/50',
            className,
          )}
        >
          <Plane className="size-4 shrink-0 text-muted-foreground opacity-50" strokeWidth={1.5} />

          {open ? (
            <input
              ref={inputRef}
              id={id}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              onClick={(event) => event.stopPropagation()}
              placeholder="Cidade ou IATA"
              aria-label={label}
              autoComplete="off"
              className="w-32 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
            />
          ) : (
            <span className="flex min-w-0 items-baseline gap-1.5 text-sm">
              {airport ? (
                <>
                  <span className="truncate font-medium text-foreground">{airport.city}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{airport.iata}</span>
                </>
              ) : (
                <span className="text-muted-foreground">{label}</span>
              )}
            </span>
          )}

          {/* Preenchido, o lugar da lupa passa a ser o de limpar. */}
          {airport && !open ? (
            <button
              type="button"
              aria-label={`Limpar ${label}`}
              onClick={(event) => {
                event.stopPropagation();
                onChange('');
              }}
              className="shrink-0 rounded-sm p-0.5 text-muted-foreground/60 hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <Search className="size-3.5 shrink-0 text-muted-foreground opacity-50" strokeWidth={1.5} />
          )}
        </div>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[320px] p-1"
        // O foco fica no input do gatilho: mover para o popover fecharia o teclado.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex items-center justify-between px-2 pb-1 pt-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {query.trim() ? 'Aeroportos' : 'Recentes'}
          </span>
          {results.length > 0 && (
            <span className="font-mono text-[10px] text-muted-foreground">{results.length}</span>
          )}
        </div>

        {results.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {query.trim() ? 'Nenhum aeroporto encontrado.' : 'Digite a cidade ou o código IATA.'}
          </p>
        ) : (
          <div role="listbox" className="max-h-72 overflow-y-auto">
            {results.map((item, index) => (
              <button
                key={item.iata}
                type="button"
                role="option"
                aria-selected={index === highlighted}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(item)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors',
                  index === highlighted && 'bg-accent text-accent-foreground',
                )}
              >
                <Plane className="size-4 shrink-0 text-muted-foreground opacity-50" strokeWidth={1.5} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.city}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.name} · {item.country}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.iata}</span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
