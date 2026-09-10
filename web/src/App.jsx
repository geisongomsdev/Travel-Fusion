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
  { key: 'quote', label: 'Revisar' },
  { key: 'booking', label: 'Passageiro' },
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
  const [retrieved, setRetrieved] = useState(null);
  const [cancellation, setCancellation] = useState(null);
  const [seatMap, setSeatMap] = useState(null);
  const [ancillaries, setAncillaries] = useState([]);
  const [extras, setExtras] = useState([]);
  const [seat, setSeat] = useState(null);
  const [loadingSeats, setLoadingSeats] = useState(false);

  const reset = () => {
    setStep(0);
    setEvents([]);
    setOffers(null);
    setSelection(null);
    setQuote(null);
    setParameters({});
    setBooking(null);
    setRetrieved(null);
    setCancellation(null);
    setSeatMap(null);
    setSeat(null);
    setAncillaries([]);
    setExtras([]);
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
      setError(Object.assign(streamError, { operation: 'availability' }));
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

      /**
       * Os opcionais são leitura independente e podem falhar sem derrubar a
       * tarifação — por isso ficam fora do try principal.
       */
      post('/ancillaries', { identifier: leg.identifier })
        .then((extra) => setAncillaries(extra.data?.ancillaries ?? []))
        .catch(() => setAncillaries([]));
    } catch (quoteError) {
      setError(Object.assign(quoteError, { operation: 'quote' }));
    } finally {
      setRunning(false);
    }
  }

  /**
   * @param passengers já vêm do formulário com o seu `customParameters`
   *   (documento), porque isso é dado do passageiro, não da reserva.
   * @param bookingParameters e-mail e telefone — o contato da reserva.
   */
  async function handleBook(passengers, bookingParameters = {}) {
    setRunning(true);
    setError(null);
    try {
      // Os CSPs escolhidos no /quote (bagagem da Travelfusion) entram aqui.
      const perPassenger = {};
      const perBooking = {};
      for (const parameter of quote?.requiredParameters || []) {
        const value = parameters[parameter.name];
        if (!value) continue;
        (parameter.perPassenger ? perPassenger : perBooking)[parameter.name] = value;
      }

      const response = await post('/booking', {
        identifier: selection.leg.identifier,
        // O que o formulário mandou vence o CSP genérico: é mais específico.
        passengers: passengers.map((passenger) => ({
          ...passenger,
          customParameters: { ...perPassenger, ...passenger.customParameters },
        })),
        customParameters: { ...perBooking, ...bookingParameters },
      });
      setBooking(response.data);
    } catch (bookingError) {
      setError(Object.assign(bookingError, { operation: 'createBooking' }));
    } finally {
      setRunning(false);
    }
  }

  /**
   * O mapa de assentos é endereçado pela OFERTA, não pelo localizador: na
   * LATAM a escolha acontece antes de reservar. Por isso ele vive no passo de
   * revisão, e não depois da reserva.
   */
  async function handleSeatMap() {
    setLoadingSeats(true);
    setError(null);
    try {
      const response = await post('/seat-map', { identifier: selection.leg.identifier });
      setSeatMap(response.data);
    } catch (seatError) {
      setError(Object.assign(seatError, { operation: 'seatMap' }));
    } finally {
      setLoadingSeats(false);
    }
  }

  /**
   * Pós-venda. As duas rotas existem no contrato e funcionavam sem ter como
   * serem chamadas daqui — o fluxo terminava no localizador.
   *
   * 🔴 O `/retrieve` é a leitura INDEPENDENTE: ele não lê o que guardamos, ele
   * pergunta à companhia. É o que prova o efeito da reserva e do cancelamento,
   * e por isso a resposta dele substitui o estado local em vez de acumular.
   */
  async function handleRetrieve(locator) {
    setRunning(true);
    setError(null);
    try {
      const response = await post('/retrieve', {
        booking: { locator },
        options: { provider: booking?.provider },
      });
      setRetrieved(response.data ?? response);
    } catch (retrieveError) {
      setError(Object.assign(retrieveError, { operation: 'retrieve' }));
    } finally {
      setRunning(false);
    }
  }

  /**
   * 🔴 Mutação não idempotente, e sem retry. Se a resposta se perder, o caminho
   * é o `/retrieve` — nunca cancelar de novo, porque a primeira pode ter valido.
   */
  async function handleCancel(locator) {
    setRunning(true);
    setError(null);
    try {
      const response = await post('/cancel-booking', {
        booking: { locator },
        options: { provider: booking?.provider },
      });
      setCancellation(response.data ?? response);
    } catch (cancelError) {
      setError(Object.assign(cancelError, { operation: 'cancelBooking' }));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Uma faixa índigo só, no topo. Era esse empilhamento de barras que
          deixava a tela pesada. */}
      <header className="h-14 shrink-0 border-b bg-background">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-6">
          <a href="/" className="flex items-center gap-3">
            <LatamMark />
            <span className="text-sm font-medium">Pass · Motor de voos</span>
          </a>
          <nav className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="h-4 w-4" /> Reiniciar
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-6 py-6">
        {/* Título de página em texto, não em faixa colorida. */}
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Passagens aéreas</h1>
        </div>

        <Steps steps={STEPS} current={step} />

        <ErrorPanel error={error} />

        {step === 0 && <SearchStep onSearch={handleSearch} running={running} />}
        {step === 1 && <ResultsStep data={offers} onSelect={handleSelect} />}
        {step === 2 && (
          <QuoteStep
            quote={quote}
            selection={selection}
            parameters={parameters}
            onChangeParameter={(name, value) => setParameters((prev) => ({ ...prev, [name]: value }))}
            ancillaries={ancillaries}
            extras={extras}
            onToggleExtra={(item) => setExtras((prev) => (
              prev.some((x) => x.offerItemId === item.offerItemId)
                ? prev.filter((x) => x.offerItemId !== item.offerItemId)
                : [...prev, item]
            ))}
            seatMap={seatMap}
            seat={seat}
            loadingSeats={loadingSeats}
            onLoadSeatMap={handleSeatMap}
            onSelectSeat={setSeat}
            onContinue={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <BookingStep
            onBook={handleBook}
            running={running}
            booking={booking}
            retrieved={retrieved}
            cancellation={cancellation}
            onRetrieve={handleRetrieve}
            onCancel={handleCancel}
          />
        )}

        {step > 0 && (
          <Button variant="outline" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))}>
            Voltar
          </Button>
        )}
      </main>

      <footer className="shrink-0 border-t border-border py-4 text-center text-xs text-muted-foreground">
        Pass · passagens aéreas
      </footer>
    </div>
  );
}

/** Monograma neutro: na paleta da Pass, cor no chrome é ruído. */
function LatamMark() {
  return (
    <div className="flex size-7 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">
      P
    </div>
  );
}
