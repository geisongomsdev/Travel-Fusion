import { useState } from 'react';
import { Plane, ExternalLink, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Steps } from '@/components/ui/steps';
import { ErrorPanel } from '@/components/ErrorPanel';
import { SearchStep } from '@/steps/SearchStep';
import { ResultsStep } from '@/steps/ResultsStep';
import { QuoteStep } from '@/steps/QuoteStep';
import { BookingStep } from '@/steps/BookingStep';
import { FinalizarStep } from '@/steps/FinalizarStep';
import { post, streamAvailability } from '@/lib/api';

const STEPS = [
  { key: 'search', label: 'Buscar' },
  { key: 'results', label: 'Escolher' },
  { key: 'quote', label: 'Tarifar' },
  { key: 'booking', label: 'Reservar' },
  { key: 'finalizar', label: 'Finalizar' },
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
  const [finalizar, setFinalizar] = useState(null);

  const reset = () => {
    setStep(0);
    setEvents([]);
    setOffers(null);
    setSelection(null);
    setQuote(null);
    setParameters({});
    setBooking(null);
    setFinalizar(null);
    setError(null);
  };

  async function handleSearch(body) {
    setRunning(true);
    setError(null);
    setEvents([]);
    setOffers(null);

    try {
      await streamAvailability(body, (event) => {
        setEvents((prev) => [...prev, event]);

        // Preenche a tela progressivamente: é para isso que o provider_success existe.
        if (event.type === 'provider_success') setOffers(event.data);

        // fatal_error mata a busca inteira; provider_error com NO_FLIGHTS não é falha.
        if (event.type === 'fatal_error') {
          setError({ code: event.data?.error?.code, message: event.data?.message, providerError: event.data?.providerError });
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
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Plane className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-none">Travelfusion</h1>
              <p className="text-xs text-muted-foreground">fluxo de venda, ponta a ponta</p>
            </div>
            <Badge variant="outline">XML · polling</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" /> Reiniciar
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="http://localhost:3010/docs" target="_blank" rel="noreferrer">
                Swagger <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <Steps steps={STEPS} current={step} />

        <ErrorPanel error={error} />

        {step === 0 && <SearchStep onSearch={handleSearch} running={running} events={events} />}
        {step === 1 && <ResultsStep data={offers} onSelect={handleSelect} />}
        {step === 2 && (
          <QuoteStep
            quote={quote}
            selection={selection}
            parameters={parameters}
            onChangeParameter={(name, value) =>
              setParameters((prev) => ({ ...prev, [name]: value }))
            }
            onContinue={() => setStep(3)}
          />
        )}
        {step === 3 && <BookingStep onBook={handleBook} running={running} booking={booking} />}

        {step === 4 && <FinalizarStep onBook={handleBook} running={running} booking={finalizar} />}
        {step > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))}>
            Voltar
          </Button>
        )}
      </main>
    </div>
  );
}
