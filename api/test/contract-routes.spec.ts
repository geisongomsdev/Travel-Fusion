import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { encodeOfferKey } from '../src/common/utils/offer-key';
import { encodeServiceKey } from '../src/common/utils/service-key';
import {
  AncillariesDto, CreateBookingDto, CreditCardDto, FinancingOptionsDto, IssueDto, MarkSeatsDto, QuoteDto, RetrieveDto,
  SellAncillariesDto,
} from '../src/modules/flight/dto/booking.dto';
import { AncillariesService } from '../src/modules/flight/use-cases/ancillaries.service';
import { BookingService } from '../src/modules/flight/use-cases/booking.service';
import { PaymentService } from '../src/modules/flight/use-cases/payment.service';
import { QuoteService } from '../src/modules/flight/use-cases/quote.service';
import { RetrieveService } from '../src/modules/flight/use-cases/retrieve.service';
import { SellAncillariesService } from '../src/modules/flight/use-cases/sell-ancillaries.service';
import { ProviderRegistry } from '../src/modules/providers/provider.registry';
import {
  BookingInput, FlightProvider, ProviderRetrieval, ProviderSeatMap,
} from '../src/modules/providers/provider.types';

/**
 * Os FORMATOS do contrato da Pass (`docs-api/`), rota por rota, com um provedor
 * falso por baixo. A tradução para a LATAM é coberta nos outros arquivos; aqui
 * o que se prova é o que quem consome recebe e manda.
 */

const FARE_ID = encodeOfferKey({ p: 'fake', r: 'OFFER-1', i: 'ITEM-1', x: ['ADT_1'] });
const SEAT_KEY = encodeServiceKey({ o: 'SEAT_12A', s: 'SRV_SEAT' });
const BAG_KEY = encodeServiceKey({ o: 'BAG_1', s: 'SRV_BAG' });

const seatMap: ProviderSeatMap = {
  currency: 'BRL',
  paymentRequired: true,
  passengers: [{ id: 'ADT_1', firstName: 'ANDY', lastName: 'PETERSON', assignedSeats: [] }],
  segments: [{
    segmentId: 'SEG_1', origin: 'GRU', destination: 'REC', departureDate: '2026-10-12', number: '3000',
    company: { code: 'LA', name: null },
    equipment: { code: '320', name: null },
    cabins: [{
      cabinClass: 'Economy',
      rows: [{
        number: '12', exitRow: false,
        seats: [{
          seat: '12A', row: '12', column: 'A', status: 'available', available: true, paid: true,
          price: { total: 79, currency: 'BRL' }, characteristics: ['window'], providerCharacteristics: [],
          commercialName: 'Assento +', accessible: null, recline: null, key: SEAT_KEY,
        }],
      }],
    }],
  }],
};

const retrieval = (overrides: Partial<ProviderRetrieval> = {}): ProviderRetrieval => ({
  status: 'confirmed',
  rawStatus: 'CLOSED',
  locator: 'NW6PFQ',
  supplierConfirmation: 'NW6PFQ',
  supplierName: 'LA',
  currency: 'BRL',
  createdAt: '2026-09-01T12:00:00',
  expiresAt: null,
  confirmationAt: null,
  people: [{ id: 'ADT_1', firstName: 'ANDY', lastName: 'PETERSON', type: 'ADT', dateOfBirth: '1990-04-21' }],
  segments: [{
    segmentId: 'SEG_1', origin: 'GRU', destination: 'REC',
    departure: '2026-10-12T08:00:00', arrival: '2026-10-12T11:05:00', duration: 185,
    company: { code: 'LA', number: '3000' }, cabin: 'Economy', aircraft: '320',
    fareBasis: 'SLSE0P5', bookingClass: 'S',
  }],
  journeys: [{ id: 'J1', segmentIds: ['SEG_1'] }],
  total: 625,
  tickets: [],
  ...overrides,
});

const fakeProvider = (overrides: Partial<FlightProvider> = {}) => {
  const booked: BookingInput[] = [];
  const provider = {
    name: 'fake',
    supports: {
      fareRules: false, retrieve: true, multicity: true, cancelBooking: true, seatMap: true,
      ancillaries: true, financingOptions: true, issue: true, sellAncillaries: true,
    },
    probe: jest.fn(),
    search: jest.fn(),
    quote: jest.fn(async () => ({
      available: true, familyCode: 'LIGHT', family: 'Light',
      // `base + taxes` não fecha com o total: o contrato manda derivar `taxes`.
      price: { base: 520, taxes: 100, fees: 5, total: 625, currency: 'BRL' },
      requiredParameters: [],
    })),
    book: jest.fn(async (_key, input: BookingInput) => {
      booked.push(input);
      return {
        locator: 'NW6PFQ', orderIdentifier: 'ORD-77213', bookingToken: null,
        committed: true, confirmed: false, status: 'OPENED', currency: 'BRL', passengers: [],
      };
    }),
    retrieve: jest.fn(async () => retrieval()),
    fareRules: jest.fn(),
    seatMapForOrder: jest.fn(async () => seatMap),
    ancillariesForOrder: jest.fn(async () => ({
      currency: 'BRL',
      passengers: [{ id: 'ADT_1', firstName: 'ANDY', lastName: 'PETERSON', type: 'ADT' }],
      segments: [],
      offers: [
        {
          key: BAG_KEY, type: 'baggage', code: '0C3', name: '1ª BAGAGEM', description: null,
          price: { total: 175, currency: 'BRL' }, passengerId: null, segmentId: null,
          baggage: { pieces: 1, weight: 23, unit: 'KG' },
        },
        {
          key: 'SEM-TIPO', type: null, code: 'X', name: 'SEM TIPO', description: null,
          price: null, passengerId: null, segmentId: null, baggage: null,
        },
      ],
    })),
    sellAncillaries: jest.fn(async (locator: string) => ({
      locator, committed: true, confirmed: true, rawStatus: 'OK', total: null,
      services: [
        { offerItemId: 'SEAT_12A', serviceId: 'SRV_SEAT', name: null, paxId: 'ADT_1', segmentId: 'SEG_1',
          seat: '12A', status: 'issued' as const, providerStatus: 'OK', emdNumber: '0452100000001', message: null },
        { offerItemId: 'BAG_1', serviceId: 'SRV_BAG', name: null, paxId: 'ADT_1', segmentId: null,
          seat: null, status: 'issued' as const, providerStatus: 'OK', emdNumber: '0452100000002', message: null },
      ],
    })),
    financingOptions: jest.fn(async () => ({
      cardBrand: 'VI', currency: 'BRL',
      options: [{ id: 'TRX-1', installments: 1, installmentAmount: 625, total: 625, interestRate: 0, promotional: false }],
    })),
    ...overrides,
  } as unknown as FlightProvider;

  const registry = { get: () => provider, default: () => provider } as unknown as ProviderRegistry;
  return { provider, registry, booked };
};

const card: CreditCardDto = {
  brand: 'VI', holderName: 'ANDY PETERSON', number: '4000000000002701', cvv: '737', expiryDate: '12/2030',
  holderCpf: '52998224725', holderBirthdate: '1990-04-21', holderEmail: 'andy@example.com',
  billingAddress: { zipCode: '01310-100', street: 'Av. Paulista, 1000', country: 'BR' },
};

describe('/quote — 05-quote.md', () => {
  const body = (quote: Partial<QuoteDto['quote']> = {}): QuoteDto => ({
    provider: 'fake',
    options: {},
    quote: { type: 'oneway', offers: [{ fareId: FARE_ID }], passengers: { adults: 1 }, ...quote },
  });

  it('responde escalar, com rawTotal e o invariante base + taxes == rawTotal', async () => {
    const { registry } = fakeProvider();
    const data = await new QuoteService(registry).execute(body());

    expect(data).toMatchObject({ provider: 'fake', available: true, currency: 'BRL', rawTotal: 625, base: 520, exchange: null });
    expect(data.base! + data.taxes!).toBe(data.rawTotal);
    expect(data).not.toHaveProperty('total');
  });

  it('aceita a terceira forma do identificador, fare.fareId', async () => {
    const { registry } = fakeProvider();
    await expect(new QuoteService(registry).execute(body({ offers: [{ fare: { fareId: FARE_ID } }] })))
      .resolves.toMatchObject({ rawTotal: 625 });
  });

  it('🔴 sem passengers é 400: não há default de um adulto', async () => {
    const { registry } = fakeProvider();
    await expect(new QuoteService(registry).execute(body({ passengers: undefined })))
      .rejects.toMatchObject({ code: 'SEARCH_VALIDATION_ERROR', statusCode: 400 });
  });

  it('só journeyKey não abre a oferta: 400 nomeando o campo', async () => {
    const { registry } = fakeProvider();
    await expect(new QuoteService(registry).execute(body({ offers: [{ journeyKey: 'J1' }] })))
      .rejects.toMatchObject({ details: { errors: { 'quote.offers.0.fareId': expect.any(Array) } } });
  });

  it('cenário pós-reserva é 501 declarado', async () => {
    const { registry } = fakeProvider();
    await expect(new QuoteService(registry).execute(body({ offers: undefined, booking: { locator: 'NW6PFQ' } })))
      .rejects.toMatchObject({ code: 'CAPABILITY_NOT_SUPPORTED', statusCode: 501 });
  });
});

describe('/booking — 06-booking.md', () => {
  const leg = { identifier: 'J1', time: { departure: '2026-10-12T08:00:00-03:00' } };
  const body = (overrides: Partial<CreateBookingDto> = {}): CreateBookingDto => ({
    provider: 'fake',
    trip: 'oneway',
    customer: { email: 'andy@example.com', phone: { country: '55', area: '11', number: '999999999' } },
    people: [{ identifier: 'ADT_1', firstName: 'Andy', lastName: 'Peterson', ageGroup: 'adult', birthdate: '1990-04-21' }],
    segments: { departure: [leg], return: [] },
    fares: [{ fareId: FARE_ID, appliesTo: 'all' }],
    selectedFareId: FARE_ID,
    ...overrides,
  });

  it('🔴 publica locator, status, bookingToken e orderIdentifier no TOPO do data', async () => {
    const { registry } = fakeProvider();
    const data = await new BookingService(registry).execute(body());

    expect(data).toMatchObject({
      locator: 'NW6PFQ', status: 'OPENED', provider: 'fake', bookingToken: null, orderIdentifier: 'ORD-77213',
    });
  });

  it('traduz people[] e ContactPhone para o que o provedor consome', async () => {
    const { registry, booked } = fakeProvider();
    await new BookingService(registry).execute(body());

    expect(booked[0]).toMatchObject({
      customer: { email: 'andy@example.com', phone: '5511999999999' },
      people: [{ id: 'ADT_1', ageGroup: 'adult', birthDate: '1990-04-21' }],
      referenceDate: '2026-10-12',
    });
  });

  it.each([
    ['oneway com volta', { segments: { departure: [leg], return: [leg] } }, 'segments.return'],
    ['roundtrip sem volta', { trip: 'roundtrip' as const }, 'segments.return'],
    ['multicity sem legs', { trip: 'multicity' as const }, 'itinerary.legs'],
    ['sem trecho nenhum', { segments: undefined }, 'segments'],
    ['tarifa nos dois lugares', { segments: { departure: [{ ...leg, fares: [{ fareId: FARE_ID }] }] } }, 'fares'],
  ])('🔴 validação cruzada: %s é 400', async (_, overrides, field) => {
    const { registry, provider } = fakeProvider();
    await expect(new BookingService(registry).execute(body(overrides)))
      .rejects.toMatchObject({ code: 'SEARCH_VALIDATION_ERROR', details: { errors: { [field]: expect.any(Array) } } });
    expect(provider.book).not.toHaveBeenCalled();
  });

  it('🔴 selectedFareId fora de fares[] é falha, nunca cai numa outra tarifa', async () => {
    const other = encodeOfferKey({ p: 'fake', r: 'OUTRA' });
    const { registry } = fakeProvider();
    await expect(new BookingService(registry).execute(body({ selectedFareId: other })))
      .rejects.toMatchObject({ details: { errors: { selectedFareId: expect.any(Array) } } });
  });

  it('🔴 identifier fora dos PaxIDs tarifados é 400 antes da companhia', async () => {
    const { registry, provider } = fakeProvider();
    const people = [{ identifier: 'PAX-1', firstName: 'Andy', lastName: 'Peterson', ageGroup: 'adult', birthdate: '1990-04-21' }];

    await expect(new BookingService(registry).execute(body({ people })))
      .rejects.toMatchObject({ details: { errors: { 'people.0.identifier': expect.any(Array) } } });
    expect(provider.book).not.toHaveBeenCalled();
  });

  it('bebê em infantInfo vira viajante com o INF_* da oferta', async () => {
    const withInfant = encodeOfferKey({ p: 'fake', r: 'OFFER-1', x: ['ADT_1', 'INF_1'] });
    const { registry, booked } = fakeProvider();
    await new BookingService(registry).execute(body({
      fares: [{ fareId: withInfant, appliesTo: 'all' }],
      selectedFareId: withInfant,
      people: [{
        identifier: 'ADT_1', firstName: 'Andy', lastName: 'Peterson', ageGroup: 'adult', birthdate: '1990-04-21',
        infantInfo: { firstName: 'Bia', lastName: 'Peterson', birthdate: '2026-01-10' },
      }],
    }));

    expect(booked[0].people.map((person) => person.id)).toEqual(['ADT_1', 'INF_1']);
  });

  it('🔴 sem lista de PaxIDs na oferta (Travelfusion), o bebê ganha o próximo INF_<n>', async () => {
    const noList = encodeOfferKey({ p: 'fake', r: 'OFFER-TF' });
    const { registry, booked } = fakeProvider();
    await new BookingService(registry).execute(body({
      fares: [{ fareId: noList, appliesTo: 'all' }],
      selectedFareId: noList,
      people: [{
        identifier: 'ADT_1', firstName: 'Andy', lastName: 'Peterson', ageGroup: 'adult', birthdate: '1990-04-21',
        infantInfo: { firstName: 'Bia', lastName: 'Peterson', birthdate: '2026-01-10' },
      }],
    }));

    expect(booked[0].people[1]).toMatchObject({ id: 'INF_1', ageGroup: 'infant' });
  });

  it('reserva com a composição inteira: 2 adultos e 1 criança chegam ao provedor', async () => {
    const family = encodeOfferKey({ p: 'fake', r: 'OFFER-1', x: ['ADT_1', 'ADT_2', 'CHD_1'] });
    const { registry, booked } = fakeProvider();
    const person = (identifier: string, ageGroup: string, birthdate: string) => ({
      identifier, firstName: 'Andy', lastName: 'Peterson', ageGroup, birthdate,
    });

    await new BookingService(registry).execute(body({
      fares: [{ fareId: family, appliesTo: 'all' }],
      selectedFareId: family,
      people: [
        person('ADT_1', 'adult', '1990-04-21'),
        person('ADT_2', 'adult', '1992-02-02'),
        person('CHD_1', 'child', '2018-05-05'),
      ],
    }));

    expect(booked[0].people.map((traveller) => `${traveller.id}/${traveller.ageGroup}`))
      .toEqual(['ADT_1/adult', 'ADT_2/adult', 'CHD_1/child']);
  });

  it('🔴 reservar com MENOS gente que a oferta tarifou é 400, nomeando quem falta', async () => {
    const family = encodeOfferKey({ p: 'fake', r: 'OFFER-1', x: ['ADT_1', 'ADT_2', 'CHD_1'] });
    const { registry, provider } = fakeProvider();

    await expect(new BookingService(registry).execute(body({
      fares: [{ fareId: family, appliesTo: 'all' }],
      selectedFareId: family,
      people: [{ identifier: 'ADT_1', firstName: 'Andy', lastName: 'Peterson', ageGroup: 'adult', birthdate: '1990-04-21' }],
    }))).rejects.toMatchObject({
      code: 'SEARCH_VALIDATION_ERROR',
      details: { errors: { people: [expect.stringContaining('ADT_2, CHD_1')] } },
    });
    expect(provider.book).not.toHaveBeenCalled();
  });

  it('🔴 gate de re-tarifa: preço maior que o exibido é 409 e nada é reservado', async () => {
    const { registry, provider } = fakeProvider();
    await expect(new BookingService(registry).execute(body({ displayedTotal: 600 })))
      .rejects.toMatchObject({ code: 'FARE_PRICE_CHANGED', statusCode: 409 });
    expect(provider.book).not.toHaveBeenCalled();
  });

  it('preço que caiu reserva normalmente', async () => {
    const { registry } = fakeProvider();
    await expect(new BookingService(registry).execute(body({ displayedTotal: 700 })))
      .resolves.toMatchObject({ locator: 'NW6PFQ' });
  });
});

describe('/retrieve — 08-retrieve.md', () => {
  const body: RetrieveDto = { options: { provider: 'fake' }, booking: { locator: 'NW6PFQ' } };

  it('usa o envelope PRÓPRIO: connector, booking, status "found", message', async () => {
    const { registry } = fakeProvider();
    const result = await new RetrieveService(registry).execute(body);

    expect(result).toMatchObject({
      success: true, connector: 'fake', booking: 'NW6PFQ', status: 'found',
      message: 'Booking retrieved successfully',
    });
    expect(result).not.toHaveProperty('meta');
  });

  it('🔴 oneway: segments.return é [] e itinerary é null', async () => {
    const { registry } = fakeProvider();
    const { data } = await new RetrieveService(registry).execute(body);

    expect(data).toMatchObject({ status: 'confirmed', type: 'flight', trip: 'oneway', grouping: 'segmented', title: 'GRU - REC', itinerary: null });
    expect(data.segments?.return).toEqual([]);
    expect(data.segments?.departure[0]).toMatchObject({ identifier: null, stops: 0, time: { duration: 185, nextDay: false } });
    expect(data.fares).toEqual([expect.objectContaining({ appliesTo: 'all', fareCode: 'SLSE0P5', bookingCode: 'S', cabin: 'economy', fareId: null })]);
    expect(data.fields).toMatchObject({ providerStatus: 'CLOSED', tickets: [], ancillaries: [], pricing: { currency: 'BRL', total: 625, breakdown: [] } });
    expect(data.people[0]).toMatchObject({ main: true, name: 'ANDY PETERSON', birthdate: '1990-04-21', type: 'adult', ageGroup: 'adult' });
  });

  it('dois trechos espelhados são roundtrip; o resto é multicity, em itinerary', async () => {
    const back = { ...retrieval().segments[0], segmentId: 'SEG_2', origin: 'REC', destination: 'GRU' };
    const third = { ...back, segmentId: 'SEG_3', origin: 'GRU', destination: 'SCL' };

    const roundtrip = fakeProvider({
      retrieve: jest.fn(async () => retrieval({
        segments: [retrieval().segments[0], back],
        journeys: [{ id: 'J1', segmentIds: ['SEG_1'] }, { id: 'J2', segmentIds: ['SEG_2'] }],
      })),
    });
    const { data: rt } = await new RetrieveService(roundtrip.registry).execute(body);
    expect(rt).toMatchObject({ trip: 'roundtrip', grouping: 'provider-group', itinerary: null });
    expect(rt.segments?.return).toHaveLength(1);

    const multicity = fakeProvider({
      retrieve: jest.fn(async () => retrieval({
        segments: [retrieval().segments[0], back, third],
        journeys: [
          { id: 'J1', segmentIds: ['SEG_1'] }, { id: 'J2', segmentIds: ['SEG_2'] }, { id: 'J3', segmentIds: ['SEG_3'] },
        ],
      })),
    });
    const { data: mc } = await new RetrieveService(multicity.registry).execute(body);
    expect(mc).toMatchObject({ trip: 'multicity', segments: null });
    expect(mc.itinerary?.legs).toHaveLength(3);
  });

  it('🔴 reserva cancelada é 200, pelo caminho pobre', async () => {
    const { registry } = fakeProvider({
      retrieve: jest.fn(async () => retrieval({ status: 'cancelled', rawStatus: 'CANCELED', segments: [], journeys: [] })),
    });
    const { data } = await new RetrieveService(registry).execute(body);

    expect(data).toMatchObject({ status: 'cancelled', trip: null, segments: null, itinerary: null, fares: null });
    expect(data.fields.providerStatus).toBe('CANCELLED');
    expect(data.fields.permissions).toMatchObject({ canIssue: false, canCancel: false });
  });
});

describe('/ancillaries — 10-ancillaries.md §1', () => {
  it('endereça pela reserva e o filtro type é ESTRITO', async () => {
    const { registry } = fakeProvider();
    const dto: AncillariesDto = { options: { provider: 'fake' }, ancillaries: { booking: { locator: 'NW6PFQ' }, type: 'baggage' } };
    const data = await new AncillariesService(registry).execute(dto);

    expect(data).toMatchObject({ provider: 'fake', locator: 'NW6PFQ', currency: 'BRL' });
    expect(data.offers.map((offer) => offer.key)).toEqual([BAG_KEY]);
    expect(data.offers[0].baggage).toEqual({ pieces: 1, weight: 23, unit: 'KG' });
    expect(data.passengers[0].type).toBe('adult');
    expect(data).not.toHaveProperty('fareId');
  });
});

describe('/mark-seats — 09-assentos.md §2', () => {
  const body = (seat = '12A'): MarkSeatsDto => ({
    options: { provider: 'fake' },
    markSeats: {
      booking: { locator: 'NW6PFQ' },
      seats: [{ passengerId: 'ADT_1', segmentId: 'SEG_1', seat }],
      payment: { method: 2, creditCard: card },
    },
  });

  it('responde seats[] — um item por assento PEDIDO, com o segmentId do pedido', async () => {
    const { registry } = fakeProvider();
    const data = await new SellAncillariesService(registry).markSeats(body());

    expect(data).toMatchObject({ provider: 'fake', locator: 'NW6PFQ', committed: true, confirmed: true, amount: { currency: 'BRL', total: 79 } });
    expect(data.seats).toEqual([
      { passengerId: 'ADT_1', segmentId: 'SEG_1', seat: '12A', status: 'assigned', price: { currency: 'BRL', total: 79 }, message: null },
    ]);
    expect(data).not.toHaveProperty('items');
  });

  it.each([
    ['assento fora do mapa', '30F'],
    ['designador malformado', 'A12'],
  ])('🔴 %s é 422 BUSINESS_RULE_VIOLATION, antes da companhia', async (_, seat) => {
    const { registry, provider } = fakeProvider();
    await expect(new SellAncillariesService(registry).markSeats(body(seat)))
      .rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION', statusCode: 422 });
    expect(provider.sellAncillaries).not.toHaveBeenCalled();
  });
});

describe('/sell-ancillaries — 10-ancillaries.md §3', () => {
  const body = (creditCard?: CreditCardDto): SellAncillariesDto => ({
    options: { provider: 'fake' },
    sellAncillaries: {
      booking: { locator: 'NW6PFQ' },
      items: [{ key: BAG_KEY, passengerId: 'ADT_1', type: 'baggage' }],
      ...(creditCard ? { payment: { creditCard } } : {}),
    },
  });

  it('cada item traz documentNumber, não emdNumber', async () => {
    const { registry } = fakeProvider();
    const data = await new SellAncillariesService(registry).execute(body(card));

    expect(data.items[0]).toMatchObject({ key: BAG_KEY, status: 'issued', documentNumber: '0452100000002', price: { currency: 'BRL', total: 175 } });
    expect(data.items[0]).not.toHaveProperty('emdNumber');
  });

  it('🔴 depois de gravar, nunca responde erro — mesmo com todo item falho', async () => {
    // A companhia gravou (e pode ter cobrado), mas não ecoou o item pedido.
    const { registry } = fakeProvider({
      sellAncillaries: jest.fn(async (locator: string) => ({
        locator, committed: true, confirmed: true, rawStatus: 'OK', total: null,
        services: [{ offerItemId: 'OUTRO', serviceId: null, name: null, paxId: 'ADT_1', segmentId: null,
          seat: null, status: null, providerStatus: null, emdNumber: null, message: null }],
      })),
    });
    const data = await new SellAncillariesService(registry).execute(body(card));

    expect(data.committed).toBe(true);
    expect(data.items[0].status).toBe('failed');
  });

  it('serviço devolvido sem StatusCode está na ordem: booked, não failed', async () => {
    const { registry } = fakeProvider({
      sellAncillaries: jest.fn(async (locator: string) => ({
        locator, committed: true, confirmed: true, rawStatus: 'OK', total: null,
        services: [{ offerItemId: 'BAG_1', serviceId: 'SRV_BAG', name: null, paxId: 'ADT_1', segmentId: null,
          seat: null, status: null, providerStatus: null, emdNumber: null, message: null }],
      })),
    });
    const data = await new SellAncillariesService(registry).execute(body(card));
    expect(data.items[0]).toMatchObject({ status: 'booked', message: null });
  });

  it('🔴 extra pago sem cartão, onde a companhia cobra na hora, é 422', async () => {
    const { registry } = fakeProvider();
    await expect(new SellAncillariesService(registry).execute(body()))
      .rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION', statusCode: 422 });
  });
});

describe('/financing-options — 11-emissao.md §2', () => {
  it('responde plans[], source e o financingId que volta no /issue', async () => {
    const { registry } = fakeProvider();
    const dto: FinancingOptionsDto = {
      options: { provider: 'fake' },
      financingOptions: { booking: { locator: 'NW6PFQ' }, payment: { creditCard: { number: '400000' } } },
    };
    const data = await new PaymentService(registry).financingOptions(dto);

    expect(data).toMatchObject({ provider: 'fake', locator: 'NW6PFQ', currency: 'BRL', source: 'provider', minInstallmentAmount: null });
    expect(data.plans[0]).toMatchObject({
      installments: 1, financingId: 'TRX-1', interestFree: true,
      interest: { monthlyPercent: null }, installmentAmount: { currency: 'BRL', total: 625 },
      totalAmount: { currency: 'BRL', total: 625 },
    });
  });
});

/**
 * 🔴 O `ValidationPipe` roda com `whitelist`: campo sem decorator SOME do corpo
 * antes de chegar ao caso de uso. Estes são os que já sumiram uma vez, ou que
 * sumiriam — o trecho copiado da busca, e os campos `string | number`.
 */
describe('o corpo sobrevive ao ValidationPipe do main.ts', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true, transformOptions: { enableImplicitConversion: false } });
  const through = <T>(metatype: new () => T, value: unknown): Promise<T> =>
    pipe.transform(value, { type: 'body', metatype }) as Promise<T>;

  it('/booking mantém o trecho da busca e a tarifa da raiz', async () => {
    const dto = await through(CreateBookingDto, {
      trip: 'oneway',
      customer: { email: 'andy@example.com' },
      people: [{ identifier: 'ADT_1', firstName: 'A', lastName: 'B', ageGroup: 'adult', birthdate: '1990-04-21' }],
      segments: { departure: [{ identifier: 'J1', time: { departure: '2026-10-12T08:00:00-03:00' }, flights: [{ number: '3000' }] }] },
      fares: [{ fareId: FARE_ID, appliesTo: 'all', price: { total: { total: 625 } } }],
      selectedFareId: FARE_ID,
    });

    expect(dto.segments?.departure?.[0]).toMatchObject({ identifier: 'J1', time: { departure: '2026-10-12T08:00:00-03:00' }, flights: [{ number: '3000' }] });
    expect(dto.fares?.[0]).toMatchObject({ fareId: FARE_ID, price: { total: { total: 625 } } });
  });

  it('/issue mantém bandeira numérica, financingId e endereço de cobrança', async () => {
    const dto = await through(IssueDto, {
      issue: {
        booking: { locator: 'NW6PFQ' },
        payment: { paymentMethod: 2, creditCard: { ...card, brand: 1, financingId: 26 } },
      },
    });

    expect(dto.issue.payment).toMatchObject({ paymentMethod: 2, creditCard: { brand: 1, financingId: 26, billingAddress: { zipCode: '01310-100' } } });
  });

  it('/quote sem o bloco quote é 400', async () => {
    await expect(through(QuoteDto, { type: 'oneway', offers: [{ fareId: FARE_ID }] })).rejects.toBeInstanceOf(BadRequestException);
  });
});
