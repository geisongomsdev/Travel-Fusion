import { useState } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Campo de data: gatilho no desenho do sistema + `Calendar` num popover.
 *
 * Entra e sai como `YYYY-MM-DD` — o formato que o contrato usa. Quem exibe
 * `dd MMM` é só a superfície; o valor nunca vira `Date` fora daqui.
 */
export function DatePicker({ value, onChange, placeholder = 'Escolha a data', className, disabled }) {
  const [open, setOpen] = useState(false);

  const parsed = value ? parseISO(value) : null;
  const selected = parsed && isValid(parsed) ? parsed : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn('justify-start gap-2 font-normal tabular-nums', !selected && 'text-muted-foreground', className)}
        >
          <CalendarIcon className="opacity-50" />
          {selected ? format(selected, "dd MMM yyyy", { locale: ptBR }) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={ptBR}
          selected={selected}
          defaultMonth={selected}
          // Data no passado não existe para uma busca de voo.
          disabled={{ before: new Date() }}
          onSelect={(date) => {
            if (!date) return;
            onChange(format(date, 'yyyy-MM-dd'));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
