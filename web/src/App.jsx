import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Steps } from '@/components/ui/steps';
import { ErrorPanel } from '@/components/ErrorPanel';
import { SearchStep } from '@/steps/SearchStep';
import { ResultsStep } from '@/steps/ResultsStep';
import { QuoteStep } from '@/steps/QuoteStep';
import { BookingStep } from '@/steps/BookingStep';
import { PaymentStep } from '@/steps/PaymentStep';
import { ExtrasStep } from '@/steps/ExtrasStep';
import { VoucherDialog } from '@/components/VoucherDialog';
import { post, streamAvailability } from '@/lib/api';

/**
 * O fluxo até a passagem na mão. Reservar e pagar são passos SEPARADOS porque
 * são separados na companhia: a ordem nasce sem pagamento e tem prazo.
 */
const STEPS = [
  { key: 'search', label: 'Buscar' },
  { key: 'results', label: 'Escolher' },
  { key: 'quote', label: 'Revisar' },
  { key: 'booking', label: 'Passageiro' },
  { key: 'payment', label: 'Pagar' },
];

export default function App() {
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const [events, setEvents] = useState([]);
  const [criteria, setCriteria] = useState(null);
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

  // Pós-reserva: pagamento, parcelas e a compra de extras sobre a ordem emitida.
  const [installments, setInstallments] = useState(null);
  const [loadingInstallments, setLoadingInstallments] = useState(false);
  const [issued, setIssued] = useState(null);
  const [orderSeatMap, setOrderSeatMap] = useState(null);
  const [orderAncillaries, setOrderAncillaries] = useState(null);
  const [loadingExtras, setLoadingExtras] = useState(false);
  const [purchase, setPurchase] = useState(null);
  const [showExtras, setShowExtras] = useState(false);
  const [voucherOpen, setVoucherOpen] = useState(false);

  /** O endereço da reserva, repetido em toda rota pós-venda. */
  const locator = booking?.booking?.locator ?? null;
  const provider = booking?.provider ?? undefined;
  const address = { booking: { locator }, options: { provider } };

  const reset = () => {
    setStep(0);
    setEvents([]);
    setCriteria(null);
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
    setInstallments(null);
    setIssued(null);
    setOrderSeatMap(null);
    setOrderAncillaries(null);
    setPurchase(null);
    setShowExtras(false);
    setVoucherOpen(false);
    setError(null);
  };

  async function handleSearch(body) {
    setRunning(true);
    setError(null);
    setEvents([]);
    setOffers(null);
    // O tipo da viagem volta no /quote: tarifar precisa saber se é ida ou pacote.
    setCriteria(body);

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

  /**
   * 🔴 O que segue para tarifar é o `fareId` da TARIFA, não o `identifier` do
   * trecho. Um voo tem várias famílias e cada uma é uma venda diferente; o
   * `identifier` é só a journey da companhia, e vai junto como contexto.
   */
  async function handleSelect(leg, fare) {
    setSelection({ leg, fare });
    setRunning(true);
    setError(null);
    try {
      const response = await post('/quote', {
        type: criteria?.type ?? 'oneway',
        offers: [{ fareId: fare.fareId, journeyKey: leg.identifier ?? undefined }],
      });
      setQuote(response.data);
      setStep(2);

      /**
       * Os opcionais são leitura independente e podem falhar sem derrubar a
       * tarifação — por isso ficam fora do try principal.
       */
      post('/ancillaries', { ancillaries: { fareId: fare.fareId } })
        .then((extra) => setAncillaries(extra.data?.offers ?? []))
        .catch(() => setAncillaries([]));
    } catch (quoteError) {
      setError(Object.assign(quoteError, { operation: 'quote' }));
    } finally {
      setRunning(false);
    }
  }

  /**
   * @param people mapa PaxID → passageiro. A chave não é decorativa: é ela que
   *   amarra tarifa, assento e bilhete ao passageiro certo, e a oferta foi
   *   tarifada com uma lista específica.
   * @param customer o contato da reserva — a LATAM recusa a ordem sem ele.
   */
  async function handleBook(people, customer) {
    setRunning(true);
    setError(null);
    try {
      // Os parâmetros que o /quote declarou entram onde ele disse que entram.
      const perPassenger = {};
      const perBooking = {};
      for (const parameter of quote?.requiredParameters || []) {
        const value = parameters[parameter.name];
        if (!value) continue;
        (parameter.perPassenger ? perPassenger : perBooking)[parameter.name] = value;
      }

      const response = await post('/booking', {
        customer,
        people: Object.fromEntries(
          Object.entries(people).map(([paxId, person]) => [
            paxId,
            // O que o formulário mandou vence o parâmetro genérico: é mais específico.
            { ...person, customParameters: { ...perPassenger, ...person.customParameters } },
          ]),
        ),
        fields: {
          selectedFareId: selection.fare.fareId,
          referenceDate: criteria?.arrival?.date ?? criteria?.departure?.date,
          customParameters: perBooking,
        },
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
      const response = await post('/seat-map', { fareId: selection.fare.fareId });
      setSeatMap(response.data);
    } catch (seatError) {
      setError(Object.assign(seatError, { operation: 'seatMap' }));
    } finally {
      setLoadingSeats(false);
    }
  }

  /**
   * 🔴 O `/retrieve` é a leitura INDEPENDENTE: ele não lê o que guardamos, ele
   * pergunta à companhia. É o que prova o efeito da reserva e do cancelamento,
   * e por isso a resposta dele substitui o estado local em vez de acumular.
   */
  async function handleRetrieve(target = locator) {
    setRunning(true);
    setError(null);
    try {
      const response = await post('/retrieve', {
        booking: { locator: target },
        options: { provider },
      });
      setRetrieved(response.data);
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
  async function handleCancel(target = locator) {
    setRunning(true);
    setError(null);
    try {
      const response = await post('/cancel-booking', {
        cancel: { booking: { locator: target } },
        options: { provider },
      });
      setCancellation(response.data);

      // Confirma na companhia, em vez de confiar na resposta da mutação.
      handleRetrieve(target);
    } catch (cancelError) {
      setError(Object.assign(cancelError, { operation: 'cancelBooking' }));
    } finally {
      setRunning(false);
    }
  }

  /**
   * Parcelas.
   *
   * 🔴 A consulta leva o número do cartão porque só a operadora sabe em quantas
   * vezes AQUELE cartão paga. O número não é guardado nem logado em lugar
   * nenhum — vai na chamada e morre com ela.
   */
  async function handleInstallments(pan) {
    setLoadingInstallments(true);
    setError(null);
    try {
      const response = await post('/financing-options', {
        ...address,
        payment: { creditCard: { number: pan } },
      });
      setInstallments(response.data?.options ?? []);
    } catch (installmentError) {
      setError(Object.assign(installmentError, { operation: 'financingOptions' }));
    } finally {
      setLoadingInstallments(false);
    }
  }

  /**
   * 🔴 COBRA O CARTÃO. Não é idempotente e não tem retry: se a resposta se
   * perder, o caminho é Atualizar a reserva, nunca pagar de novo.
   *
   * O valor não é mandado daqui de propósito — a API pergunta à companhia
   * quanto custa antes de cobrar.
   */
  async function handlePay({ creditCard, billing, installmentId }) {
    setRunning(true);
    setError(null);
    try {
      const response = await post('/issue', {
        options: { provider },
        issue: {
          booking: { locator },
          payment: { creditCard, billing, ...(installmentId ? { installmentId } : {}) },
        },
      });
      setIssued(response.data);
      /**
       * 🔴 Relê a reserva NA COMPANHIA logo depois de pagar. O bilhete é
       * montado a partir desta leitura, não do que a tela guardou — comprovante
       * que repete a própria anotação mostra o que a gente acha, não o que a
       * companhia registrou.
       */
      handleRetrieve();
    } catch (payError) {
      setError(Object.assign(payError, { operation: 'issue' }));
    } finally {
      setRunning(false);
    }
  }

  /** O catálogo da RESERVA — outro do que o da oferta, e o único que se compra. */
  async function handleLoadExtras() {
    setLoadingExtras(true);
    setError(null);
    try {
      const [map, extra] = await Promise.all([
        post('/order-seat-map', address),
        post('/order-ancillaries', address),
      ]);
      setOrderSeatMap(map.data);
      setOrderAncillaries(extra.data?.offers ?? []);
    } catch (extrasError) {
      setError(Object.assign(extrasError, { operation: 'seatMap' }));
    } finally {
      setLoadingExtras(false);
    }
  }

  /** 🔴 Também cobra o cartão, e também sem retry. */
  async function handleBuyExtras({ items, creditCard }) {
    setRunning(true);
    setError(null);
    try {
      const response = await post('/sell-ancillaries', {
        options: { provider },
        sellAncillaries: {
          booking: { locator },
          items,
          ...(creditCard ? { payment: { creditCard } } : {}),
        },
      });
      setPurchase(response.data);
    } catch (buyError) {
      setError(Object.assign(buyError, { operation: 'sellAncillaries' }));
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
            <PassMark />
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
              prev.some((x) => x.key === item.key)
                ? prev.filter((x) => x.key !== item.key)
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
            onPay={() => setStep(4)}
          />
        )}
        {step === 4 && (
          <PaymentStep
            locator={locator}
            amount={retrieved?.total ?? quote?.total}
            currency={retrieved?.booking?.currency ?? quote?.currency}
            running={running}
            installments={installments}
            loadingInstallments={loadingInstallments}
            onLoadInstallments={handleInstallments}
            issued={issued}
            onPay={handlePay}
            cancellation={cancellation}
            onVoucher={() => setVoucherOpen(true)}
            onCancel={() => handleCancel()}
            onShowExtras={() => {
              setShowExtras(true);
              // Só busca o catálogo quando alguém pede: são duas chamadas à companhia.
              if (!orderSeatMap) handleLoadExtras();
            }}
          >
            {showExtras && (
              <ExtrasStep
                locator={locator}
                currency={retrieved?.booking?.currency ?? quote?.currency}
                seatMap={orderSeatMap}
                ancillaries={orderAncillaries}
                loading={loadingExtras}
                running={running}
                purchase={purchase}
                onLoad={handleLoadExtras}
                onBuy={handleBuyExtras}
              />
            )}
          </PaymentStep>
        )}

        <VoucherDialog
          open={voucherOpen}
          onOpenChange={setVoucherOpen}
          locator={locator}
          retrieved={retrieved}
          paid={issued?.amount?.total}
          items={purchase?.items}
        />

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
function PassMark() {
  return (
    <div className="flex size-7 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">
      P
    </div>
  );
}
