import { useState } from 'react';
import { ExternalLink, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Steps } from '@/components/ui/steps';
import { ErrorPanel } from '@/components/ErrorPanel';
import { SearchStep } from '@/steps/SearchStep';
import { ResultsStep } from '@/steps/ResultsStep';
import { QuoteStep } from '@/steps/QuoteStep';
import { BookingStep } from '@/steps/BookingStep';
import { post, streamAvailability } from '@/lib/api';

/** O fluxo do contrato. A emissão não entra: é 501 nos dois provedores. */
const STEPS = [
  { key: 'search', label: 'Buscar' },
  { key: 'results', label: 'Escolher' },
  { key: 'quote', label: 'Tarifar' },
  { key: 'booking', label: 'Reservar' },
];

export default function App() {
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const [events, setEvents] = useState([]);
  const [offers, setOffers] = useState(null);
  const [selection, setSelection] = useState(null);
  const [quote, setQuote] = useState(null);
  const [parameters, setParameters] = useState({});
  const [booking, setBooking] = useState(null);

  const reset = () => {
    setStep(0);
    setEvents([]);
    setOffers(null);
    setSelection(null);
    setQuote(null);
    setParameters({});
    setBooking(null);
    setError(null);
  };

  async function handleSearch(body) {
    setRunning(true);
    setError(null);
    setEvents([]);
    setOffers(null);

    try {
      // O provedor vem do formulário. Fixá-lo aqui esconderia a fronteira
      // multi-provedor, que é justamente o que esta tela existe para mostrar.
      await streamAvailability(body, (event) => {
        setEvents((prev) => [...prev, event]);

        if (event.type === 'provider_success') setOffers(event.data);

        if (event.type === 'fatal_error') {
          setError({
            code: event.data?.error?.code,
            message: event.data?.message,
            providerError: event.data?.providerError,
          });
        }
        if (event.type === 'complete') setStep(1);
      });
    } catch (streamError) {
      setError(streamError);
    } finally {
      setRunning(false);
    }
  }

  async function handleSelect(leg, fare) {
    setSelection({ leg, fare });
    setRunning(true);
    setError(null);
    try {
      const response = await post('/quote', { identifier: leg.identifier });
      setQuote(response.data);
      setStep(2);
    } catch (quoteError) {
      setError(quoteError);
    } finally {
      setRunning(false);
    }
  }

  async function handleBook(passengers) {
    setRunning(true);
    setError(null);
    try {
      // Os CSPs por passageiro e por reserva saem daqui e entram no ProcessTerms.
      const perPassenger = {};
      const perBooking = {};
      for (const parameter of quote?.requiredParameters || []) {
        const value = parameters[parameter.name];
        if (!value) continue;
        (parameter.perPassenger ? perPassenger : perBooking)[parameter.name] = value;
      }

      const response = await post('/booking', {
        identifier: selection.leg.identifier,
        passengers: passengers.map((passenger) => ({ ...passenger, customParameters: perPassenger })),
        customParameters: perBooking,
      });
      setBooking(response.data);
    } catch (bookingError) {
      setError(bookingError);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* `mat-toolbar` do portal: 64px, índigo, conteúdo alinhado ao container. */}
      <header className="h-toolbar shrink-0 bg-primary text-primary-foreground elevation-2">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-4 px-6">
          <a href="/" className="flex items-center gap-3">
            <LatamMark />
            <span className="text-lg font-normal tracking-wide">Pass · Motor de voos</span>
          </a>
          <nav className="flex items-center gap-1">
            <Button variant="toolbar" size="sm" onClick={reset}>
              <RotateCcw className="h-4 w-4" /> Reiniciar
            </Button>
            <Button variant="toolbar" size="sm" asChild>
              <a href="http://localhost:3010/docs" target="_blank" rel="noreferrer">
                Swagger <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </nav>
        </div>
      </header>

      {/* Faixa de título de página, o segundo nível do portal. */}
      <div className="shrink-0 bg-primary/95 text-primary-foreground">
        <div className="mx-auto max-w-6xl px-6 py-3">
          <h1 className="text-xl font-normal">Fluxo de venda, ponta a ponta</h1>
          <p className="text-xs opacity-80">
            LATAM NDC v19.2 (síncrono) e Travelfusion Direct Connect (polling) atrás do mesmo contrato.
          </p>
        </div>
      </div>

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-6 py-6">
        <Steps steps={STEPS} current={step} />

        <ErrorPanel error={error} />

        {step === 0 && <SearchStep onSearch={handleSearch} running={running} events={events} />}
        {step === 1 && <ResultsStep data={offers} onSelect={handleSelect} />}
        {step === 2 && (
          <QuoteStep
            quote={quote}
            selection={selection}
            parameters={parameters}
            onChangeParameter={(name, value) => setParameters((prev) => ({ ...prev, [name]: value }))}
            onContinue={() => setStep(3)}
          />
        )}
        {step === 3 && <BookingStep onBook={handleBook} running={running} booking={booking} />}

        {step > 0 && (
          <Button variant="outline" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))}>
            Voltar
          </Button>
        )}
      </main>

      <footer className="shrink-0 bg-primary py-3 text-center text-xs text-primary-foreground/80">
        Pass · integração LATAM NDC + Travelfusion
      </footer>
    </div>
  );
}

/** Marca de asa da LATAM, redesenhada em SVG para não depender de asset externo. */
function LatamMark() {
  return (
    <svg viewBox="0 0 32 24" className="h-6 w-8" aria-label="LATAM" role="img">
      <path d="M2 16 L20 4 L18 11 L30 8 L12 20 L14 13 Z" fill="hsl(var(--brand))" />
      <path d="M2 16 L20 4 L18 11 Z" fill="currentColor" opacity="0.9" />
    </svg>
  );
}
