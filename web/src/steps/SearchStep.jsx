import { useState } from 'react';
import { Loader2, Plane, MapPin, Compass, Calendar, Search, ArrowRight } from 'lucide-react';
import { SearchToolbar } from '@/components/toolbar/SearchToolbar';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (custom) => ({
    opacity: 1,
    y: 0,
    transition: { delay: custom * 0.1, duration: 0.5, ease: 'easeOut' },
  }),
};

/**
 * Busca.
 *
 * 🔴 O painel de eventos do SSE e o envelope NDC saíram daqui. Eram ferramenta
 * de quem integra — quem compra passagem não precisa saber que existe polling,
 * nem ver `provider_success` passar na tela. O contrato continua igual; o que
 * mudou é quem está sendo servido.
 */
export function SearchStep({ onSearch, running }) {
  const [form, setForm] = useState({
    type: 'oneway',
    origin: 'GRU',
    destination: 'SCL',
    date: '2026-11-20',
    returnDate: '2026-11-27',
    segments: [
      { origin: 'GRU', destination: 'SCL', date: '2026-11-20' },
      { origin: 'SCL', destination: 'LIM', date: '2026-11-24' },
    ],
    adults: 1,
    cabin: 'economy',
    provider: 'latam',
  });

  const change = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const swap = () => setForm((prev) => ({ ...prev, origin: prev.destination, destination: prev.origin }));

  const submit = (event) => {
    event.preventDefault();

    const passengers = { adults: Number(form.adults) || 1, children: 0, infants: 0 };
    const options = { provider: [form.provider], class: form.cabin };

    // Multidestino não tem pontas: vai a lista COMPLETA de trechos, e só ela.
    if (form.type === 'multicity') {
      onSearch({
        type: 'multicity',
        segments: form.segments.map((segment) => ({
          origin: segment.origin.toUpperCase(),
          destination: segment.destination.toUpperCase(),
          date: segment.date,
        })),
        passengers,
        options,
      });
      return;
    }

    /**
     * 🔴 A viagem é descrita por PONTAS, não por uma lista de trechos: em ida e
     * volta o destino da ida é a origem da volta, e a data do retorno mora em
     * `arrival.date`. É o que deixa `type` ser explícito em vez de inferido pela
     * quantidade de datas — duas datas não provam ida-e-volta.
     */
    onSearch({
      type: form.type,
      departure: { iata: form.origin.toUpperCase(), date: form.date },
      arrival: {
        iata: form.destination.toUpperCase(),
        ...(form.type === 'roundtrip' ? { date: form.returnDate } : {}),
      },
      passengers,
      options,
    });
  };

  return (
    <div className="space-y-6">
      <SearchToolbar form={form} onChange={change} onSwap={swap} onSubmit={submit} running={running} />

      <div className={cn('w-full relative bg-background overflow-hidden rounded-xl border border-dashed', running ? 'py-20' : '')}>
        {running ? (
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            <Loader2 className="size-8 animate-spin text-muted-foreground opacity-40" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">Consultando a companhia…</p>
          </div>
        ) : (
          <>
            <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-[480px] rounded-full blur-3xl opacity-[0.08] " />

            <div className="relative flex flex-col items-center text-center px-6 py-14 gap-8 max-w-xl mx-auto">
              <motion.div
                custom={0}
                variants={fadeUp}
                initial="hidden"
                animate="visible"
                className="relative flex items-center justify-center"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                  className="absolute size-32 rounded-full"
                >
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 size-2 rounded-full bg-muted-foreground/40 shadow-sm" />
                </motion.div>
                <motion.div
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="relative flex items-center justify-center size-[72px] rounded-full bg-gradient-to-br from-muted-foreground/10 to-muted-foreground/5"
                >
                  <div className="absolute inset-0 rounded-full bg-muted-foreground/5" />
                  <Plane className="relative size-7 text-muted-foreground" strokeWidth={1.5} />
                </motion.div>
              </motion.div>

              <motion.div custom={1} variants={fadeUp} initial="hidden" animate="visible" className="-mt-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-muted/60 text-muted-foreground">
                  Busca de Viagens
                </span>
              </motion.div>

              <motion.div custom={2} variants={fadeUp} initial="hidden" animate="visible" className="space-y-2 -mt-2">
                <h3 className="text-xl font-medium text-foreground tracking-tight">
                  Para onde você vai?
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
                  Preencha os dados da sua viagem acima para buscar os melhores voos.
                </p>
              </motion.div>

              <motion.div
                custom={3}
                variants={fadeUp}
                initial="hidden"
                animate="visible"
                className="w-full grid grid-cols-2 gap-2.5"
              >
                {[
                  { icon: MapPin, text: 'Escolha a origem' },
                  { icon: Compass, text: 'Defina o destino' },
                  { icon: Calendar, text: 'Selecione a data' },
                  { icon: Search, text: 'Encontre opções' },
                ].map(({ icon: Icon, text }, i) => (
                  <motion.div
                    key={i}
                    whileHover={{ y: -3, transition: { duration: 0.18, ease: 'easeOut' } }}
                    className="group flex items-start gap-2.5 rounded-xl bg-muted/40 hover:bg-muted/60 px-3.5 py-3 text-left transition-colors duration-200 cursor-default"
                  >
                    <div className="mt-0.5 shrink-0 size-6 rounded-md bg-background flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform duration-200">
                      <Icon className="size-3.5 text-muted-foreground" />
                    </div>
                    <span className="text-xs text-muted-foreground leading-snug">{text}</span>
                    <ArrowRight className="ml-auto mt-0.5 size-3 shrink-0 opacity-0 group-hover:opacity-30 -translate-x-1 group-hover:translate-x-0 transition-all duration-200 text-muted-foreground" />
                  </motion.div>
                ))}
              </motion.div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
