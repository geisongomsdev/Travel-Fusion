import { spawn, ChildProcess } from 'node:child_process';
import { join } from 'node:path';

const PORT = 3997;

/**
 * 🔴 O duble é injetado por CONSTRUÇÃO, não por configuração: montamos o
 * `LatamClient` apontado para ele aqui dentro. O `.env` da aplicação continua
 * apontando para o sandbox real da LATAM — um duble alcançável pelo runtime
 * viraria produção por acidente.
 *
 * Os testes de unidade cobrem a tradução; este cobre a FIAÇÃO, que é onde moram
 * os erros que nenhum deles pega: token não anexado, path errado, envelope com
 * namespace trocado.
 */
import { LatamClient } from '../src/modules/providers/latam/latam.client';
import { LatamCommands } from '../src/modules/providers/latam/latam.commands';
import { LatamProvider } from '../src/modules/providers/latam/latam.provider';
import { AvailabilityDto } from '../src/modules/flight/dto/availability.dto';
import { CreateBookingDto, QuoteDto } from '../src/modules/flight/dto/booking.dto';
import { ProviderOffer } from '../src/modules/providers/provider.types';
import { decodeOfferKey, OfferKey } from '../src/common/utils/offer-key';

const DOUBLE = join(__dirname, 'fixtures', 'latam-ndc-double.mjs');

const endpoint = {
  endpoint: `http://localhost:${PORT}`,
  tokenEndpoint: `http://localhost:${PORT}/oauth/cc/token`,
  apiKey: 'test-key',
  apiSecret: 'test-secret',
};

let double: ChildProcess;

const waitForDouble = async (): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(endpoint.tokenEndpoint, { method: 'POST' });
      if (response.ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('duble do LATAM NDC não subiu');
};

beforeAll(async () => {
  double = spawn(process.execPath, [DOUBLE], {
    env: { ...process.env, MOCK_LATAM_PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitForDouble();
}, 20000);

afterAll(() => {
  double?.kill();
});

const provider = (): LatamProvider =>
  new LatamProvider(new LatamCommands(new LatamClient(endpoint)));

/**
 * O pedido no dialeto canônico: `departure`/`arrival`, com a data da volta em
 * `arrival.date`. Em ida-e-volta o destino da ida é a origem da volta, e é por
 * isso que o modelo publica UMA ponta em vez de uma lista de trechos.
 */
const requestFor = (type: 'oneway' | 'roundtrip'): AvailabilityDto => ({
  type,
  departure: { iata: 'GRU', date: '2026-10-12' },
  arrival: { iata: 'REC', ...(type === 'roundtrip' ? { date: '2026-10-19' } : {}) },
  passengers: { adults: 1 },
});

const search = async (type: 'oneway' | 'roundtrip'): Promise<ProviderOffer[]> => {
  const collected: ProviderOffer[] = [];
  for await (const batch of provider().search(requestFor(type), { correlationId: 'test' })) {
    collected.push(...batch);
  }
  return collected;
};

/** A chave de venda mora na TARIFA — o `identifier` do trecho é a journey. */
const fareIdOf = (offer: ProviderOffer): string => {
  const { fareId } = offer.outbound.fares[0];
  if (!fareId) throw new Error('a tarifa não trouxe fareId');
  return fareId;
};

const keyOf = (offer: ProviderOffer): OfferKey => {
  const key = decodeOfferKey(fareIdOf(offer));
  if (!key) throw new Error('fareId não decodificou');
  return key;
};

const quoteFor = (offer: ProviderOffer): QuoteDto => ({
  type: 'roundtrip',
  offers: [{ fareId: fareIdOf(offer) }],
});

const bookingFor = (offer: ProviderOffer, overrides: Partial<CreateBookingDto> = {}): CreateBookingDto => ({
  customer: { email: 'andy@example.com', phone: '11999999999' },
  people: {
    ADT_1: {
      firstName: 'Andy',
      lastName: 'Peterson',
      ageGroup: 'adult',
      birthDate: '1990-04-21',
    },
  },
  fields: { selectedFareId: fareIdOf(offer), referenceDate: '2026-10-19' },
  ...overrides,
});

describe('LatamProvider ponta a ponta', () => {
  it('autentica e devolve ofertas normalizadas', async () => {
    expect(await search('roundtrip')).toHaveLength(3);
  });

  it('🔴 a busca é síncrona: um lote só, sem polling', async () => {
    const batches: number[] = [];
    for await (const batch of provider().search(requestFor('oneway'), {})) {
      batches.push(batch.length);
    }
    expect(batches).toHaveLength(1);
  });

  it('monta o pacote de ida-e-volta a partir dos dois PaxJourney', async () => {
    const roundtrip = (await search('roundtrip')).filter((offer) => offer.inbound !== null);

    expect(roundtrip).toHaveLength(2);
    expect(roundtrip[0].outbound.origin?.iata).toBe('GRU');
    expect(roundtrip[0].inbound?.origin?.iata).toBe('REC');
  });

  it('a oferta de ida avulsa não ganha volta inventada', async () => {
    const oneway = (await search('roundtrip')).filter((offer) => offer.inbound === null);
    expect(oneway).toHaveLength(1);
  });

  it('resolve conexão como dois segmentos e uma escala', async () => {
    const offers = await search('roundtrip');
    const comConexao = offers.find((offer) => offer.outbound.flights.length === 2);

    expect(comConexao).toBeDefined();
    expect(comConexao!.outbound.stops).toBe(1);
    expect(comConexao!.outbound.origin?.iata).toBe('GRU');
    expect(comConexao!.outbound.destination?.iata).toBe('REC');
    expect(comConexao!.outbound.flights[1].connection).toBe(true);
  });

  /**
   * 🔴 `hand` e `hold` são franquias diferentes: uma tarifa LIGHT inclui
   * bagagem de mão e não inclui despacho, e o booleano único de antes fazia uma
   * LIGHT parecer que levava mala.
   */
  it('🔴 distingue tarifa com e sem bagagem despachada', async () => {
    const offers = await search('roundtrip');
    const light = offers.find((offer) => offer.outbound.fares[0].family === 'Light');
    const plus = offers.find((offer) => offer.outbound.fares[0].family === 'Plus');

    expect(light!.outbound.fares[0].baggage.hold?.included).toBe(false);
    expect(plus!.outbound.fares[0].baggage.hold).toMatchObject({
      included: true, pieces: 1, weight: 23, unit: 'KG', type: 'checked',
    });
  });

  it('preço total soma base e taxa, com moeda', async () => {
    const [fare] = (await search('roundtrip'))[0].outbound.fares;

    expect(fare.price.total).toMatchObject({ base: 520, total: 625, currency: 'BRL' });
    // O imposto é o TOTAL que a companhia declarou, não uma taxa de embarque.
    expect(fare.price.total.taxes.total).toBe(105);
    expect(fare.price.total.taxes.boarding).toBeNull();
  });

  it('tarifa a oferta pelo fareId que a busca devolveu', async () => {
    const [offer] = await search('roundtrip');
    const quote = await provider().quote(keyOf(offer), quoteFor(offer), {});

    expect(quote.price.total).toBe(625);
    expect(quote.available).toBe(true);
    expect(quote.requiredParameters.length).toBeGreaterThan(0);
  });

  it('🔴 reserva devolve confirmed só no status final — CLOSED confirma', async () => {
    const [offer] = await search('roundtrip');
    const booking = await provider().book(keyOf(offer), bookingFor(offer), {});

    expect(booking).toMatchObject({
      locator: 'NW6PFQ', committed: true, confirmed: true, status: 'CLOSED',
    });
  });

  /**
   * 🔴 Reservar sem contato quebrava em produção com uma mensagem que não ajuda
   * ninguém: ora `912 ContactInfoList is null or empty`, ora
   * `cvc-identity-constraint.4.3: Key 'ContactInfoIDKeyRef13' not found`,
   * dependendo de qual metade da dupla faltava. A recusa acontece ANTES da
   * rede, nomeando o campo.
   */
  it('🔴 recusa reservar sem contato antes de sair para a rede', async () => {
    const [offer] = await search('roundtrip');

    await expect(
      provider().book(keyOf(offer), bookingFor(offer, { customer: { email: '' } }), {}),
    ).rejects.toMatchObject({
      code: 'SEARCH_VALIDATION_ERROR',
      details: { errors: expect.objectContaining({ 'customer.email': expect.any(Array) }) },
    });
  });

  /**
   * 🔴 O caso acima reserva SEM contato, e é exatamente o que quebrou: o Pax
   * saía com `ContactInfoRefID` apontando para uma `ContactInfoList` que não
   * era emitida. Este cobre o outro ramo — com contato, a lista vai junto.
   */
  it('com e-mail e telefone, ContactInfoRefID e ContactInfoList andam juntos', async () => {
    const [offer] = await search('roundtrip');

    const booking = await provider().book(
      keyOf(offer),
      bookingFor(offer, {
        people: {
          ADT_1: {
            firstName: 'Andy',
            lastName: 'Peterson',
            ageGroup: 'adult',
            birthDate: '1990-04-21',
            document: { type: 'PASSPORT', number: 'AAB0302' },
          },
        },
      }),
      {},
    );

    expect(booking.locator).toBe('NW6PFQ');
  });

  /**
   * 🔴 O PaxID é a CHAVE do mapa `people`, não um contador nosso: a oferta foi
   * tarifada com uma lista específica e o `SelectedOfferItem` referencia
   * exatamente ela. Renumerar produz `PaxIDKeyRef` não encontrada.
   */
  it('🔴 o PaxID do pedido chega à companhia como veio', async () => {
    const [offer] = await search('roundtrip');
    const booking = await provider().book(keyOf(offer), bookingFor(offer), {});

    expect(booking.passengers.map((passenger) => passenger.id)).toContain('ADT_1');
  });

  /**
   * 🔴 Cancelar é DOIS passos, e o teste existe para provar que o primeiro
   * acontece: o `OrderCancel` exige `ExpectedRefundAmount`, e esse número vem
   * do `OrderReshop`. Se alguém "simplificar" mandando zero, o duble recusa.
   */
  it('cancela em dois passos: o reshop calcula o reembolso, o cancel executa', async () => {
    const cancelled = await provider().cancelBooking!('NW6PFQ', {});

    expect(cancelled).toMatchObject({
      locator: 'NW6PFQ',
      status: 'cancelled',
      rawStatus: 'CANCELLED',
      refund: { total: 625, currency: 'BRL' },
    });
  });

  /**
   * 🔴 O `OrderCancelRS` não prova anulação de e-ticket: só o CUPOM prova.
   * Publicar `true` a partir do sucesso do cancelamento afirmaria uma anulação
   * que ninguém confirmou.
   */
  it('🔴 não afirma e-ticket anulado sem o cupom dizer', async () => {
    const cancelled = await provider().cancelBooking!('NW6PFQ', {});
    expect(cancelled.eticketsCancelled).toBe(false);
    expect(cancelled.outcome).toBe('REFUND');
  });

  it('consulta a reserva com todas as chaves do contrato', async () => {
    const found = await provider().retrieve('ORD-77213', {});

    expect(found).toMatchObject({
      status: 'confirmed', rawStatus: 'CLOSED', supplierConfirmation: 'NW6PFQ',
    });
    expect(found.people[0]).toMatchObject({ firstName: 'Andy', type: 'ADT' });
  });

  /**
   * 🔴 Sem o `PaxJourneyList` o contrato adivinhava ida e volta pela CONTAGEM
   * de segmentos — o que transforma uma conexão em "ida e volta" e faz a
   * terceira perna de um multidestino sumir.
   */
  it('🔴 traz o agrupamento em journeys, não só os segmentos soltos', async () => {
    const found = await provider().retrieve('ORD-77213', {});

    expect(Array.isArray(found.journeys)).toBe(true);
    for (const journey of found.journeys) {
      expect(journey.segmentIds.length).toBeGreaterThan(0);
    }
  });

  it('🔴 erro do provedor vira código do catálogo, não 500', async () => {
    // O duble devolve 404122007 quando a origem é XXX.
    const impossible: AvailabilityDto = {
      type: 'oneway',
      departure: { iata: 'XXX', date: '2026-10-12' },
      arrival: { iata: 'REC' },
      passengers: { adults: 1 },
    };

    await expect(provider().search(impossible, {}).next()).rejects.toMatchObject({
      code: 'ROUTE_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('fare-rules é 501 declarado, não erro genérico', async () => {
    await expect(provider().fareRules()).rejects.toMatchObject({
      code: 'CAPABILITY_NOT_SUPPORTED',
      statusCode: 501,
    });
  });
});
