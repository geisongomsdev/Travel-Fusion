import { asList, text, num, bool } from '../provider/xml.js';
import { money, roundMoney } from '../../../domain/money.js';
import { encodeOfferKey } from '../../../utils/offer-key.js';

const PROVIDER = 'travelfusion';

/** Cabine canônica — 01-convencoes.md §6. Nunca publicar o rótulo do fornecedor. */
const CABIN_MAP = {
  economy: 'economy', economic: 'economy', coach: 'economy',
  premiumeconomy: 'premium_economy', premium: 'premium_economy',
  business: 'business', club: 'business',
  first: 'first',
};

export function canonicalCabin(value) {
  if (!value) return null;
  return CABIN_MAP[String(value).toLowerCase().replace(/[\s_-]/g, '')] || null;
}

const airport = (code, name = null) => (code ? { code: String(code).toUpperCase(), name } : null);

function flightTime(departure, arrival) {
  return { departure: departure || null, arrival: arrival || null };
}

function normalizeSegment(node, index) {
  const marketing = text(node?.MarketingCarrier) || text(node?.Carrier);
  return {
    origin: airport(text(node?.Origin), text(node?.OriginName)),
    destination: airport(text(node?.Destination), text(node?.DestinationName)),
    time: flightTime(text(node?.DepartureDateTime), text(node?.ArrivalDateTime)),
    company: {
      code: marketing,
      name: text(node?.CarrierName),
      operating: text(node?.OperatingCarrier) || marketing,
    },
    number: text(node?.FlightNumber),
    segment: index,
    connection: index > 0,
    equipment: {
      code: text(node?.AircraftCode),
      name: text(node?.AircraftName),
      description: null,
    },
    // 🔴 Cabine do SEGMENTO. Quando o voo oferece mais de uma e não dá para dizer
    // qual é a deste segmento, é null — quem responde passa a ser fares[].cabin.
    cabin: canonicalCabin(text(node?.CabinClass)),
  };
}

/**
 * Preço por passageiro. Os três nós são "tudo ou nada": quando a Travelfusion
 * não separa os tipos, adult/child/baby vêm null JUNTOS.
 */
function passengerPrice(node, currency) {
  const base = num(node?.BaseFare);
  if (base === null) return null;
  const taxes = {
    boarding: num(node?.Tax) ?? 0,
    service: 0,
    fuel: 0,
    baggage: 0,
  };
  const fees = num(node?.Fee) ?? 0;
  return {
    base: roundMoney(base),
    taxes,
    fees: roundMoney(fees),
    total: roundMoney(base + taxes.boarding + fees),
    currency,
  };
}

/**
 * FareRules — 01-convencoes.md §6. As duas formas da multa (lista e objetos por
 * tipo) convivem de propósito: a que vier preenchida alimenta a vazia. A
 * Travelfusion não estrutura multa, então as duas ficam vazias e o que sobra é a
 * `key` — o texto integral vem depois, pelo /fare-rules.
 */
function buildFareRules(route, { routingId, outwardId }) {
  return {
    refundable: bool(route?.Refundable),
    changeable: bool(route?.Changeable),
    penalties: [],
    refund: null,
    change: null,
    cancellation: null,
    noShow: null,
    endorsable: null,
    transferable: null,
    // Chave OPACA para POST /fare-rules. Carrega tudo que precisamos para
    // reconstruir a consulta no provedor.
    key: encodeOfferKey({ p: PROVIDER, r: routingId, o: outwardId, k: 'rules' }),
  };
}

function normalizeFare(route, passengers, { routingId, outwardId } = {}) {
  const currency = text(route?.Currency) || 'BRL';
  const base = num(route?.BaseFare) ?? 0;
  const tax = num(route?.Tax) ?? 0;
  const fee = num(route?.Fee) ?? 0;
  const total = num(route?.TotalPrice) ?? roundMoney(base + tax + fee);
  const passengerCount = Math.max(1, passengers?.total || 1);

  const adult = passengerPrice(route?.AdultPrice, currency);
  const child = passengerPrice(route?.ChildPrice, currency);
  const baby = passengerPrice(route?.InfantPrice, currency);
  const hasBreakdown = Boolean(adult);

  return {
    // A Travelfusion não identifica a tarifa separadamente do routing —
    // quem endereça é o `identifier` do trecho.
    fareId: null,
    code: text(route?.FareCode),
    familyCode: text(route?.FareFamilyCode),
    family: text(route?.FareFamily),
    fareCode: text(route?.FareBasis),
    bookingCode: text(route?.BookingClass),
    cabin: canonicalCabin(text(route?.CabinClass)),
    seats: num(route?.SeatsRemaining),
    price: {
      adult: hasBreakdown ? adult : null,
      child: hasBreakdown ? child : null,
      baby: hasBreakdown ? baby : null,
      total: {
        base: roundMoney(base),
        taxes: { boarding: roundMoney(tax), service: 0, fuel: 0, baggage: 0 },
        fees: roundMoney(fee),
        total: roundMoney(total),
        currency,
      },
      perPassenger: roundMoney(total / passengerCount),
      net: null,
      exchange: null,
    },
    // Discriminação do que já está em price.total — mostrar, nunca somar de novo.
    fees: [],
    baggage: { included: null, quantity: null, weight: null, unit: null },
    rules: buildFareRules(route, { routingId, outwardId }),
    benefits: {
      seatSelection: null, checkedBaggage: null, carryOn: null, meal: null,
      loyaltyPoints: null, priorityBoarding: null, refund: null, change: null,
    },
  };
}

/**
 * Um <Route> da Travelfusion vira UM trecho canônico.
 *
 * 🔴 A Travelfusion DECLARA a combinabilidade: o RoutingId + OutwardId/ReturnId
 * cobre o itinerário inteiro. Isso a classifica como provedor de PACOTE
 * (04-availability-formatos.md §2) — nunca parear pernas por conta própria.
 */
export function normalizeLeg(route, { routingId, direction, passengers }) {
  const segments = asList(route?.SegmentList?.Segment).map(normalizeSegment);
  const first = segments[0];
  const last = segments[segments.length - 1];

  const identifier = encodeOfferKey({
    p: PROVIDER,
    r: routingId,
    o: text(route?.OutwardId) || text(route?.Id),
    i: text(route?.ReturnId) || null,
    d: direction,
  });

  return {
    identifier,
    company: {
      code: first?.company?.code || null,
      name: first?.company?.name || null,
    },
    origin: first?.origin || null,
    destination: last?.destination || null,
    time: flightTime(first?.time?.departure, last?.time?.arrival),
    stops: segments.length > 0 ? segments.length - 1 : null,
    flights: segments,
    fares: [normalizeFare(route, passengers, { routingId, outwardId: text(route?.OutwardId) || text(route?.Id) })],
    fees: [],
  };
}

export function normalizeRoutes(routes, options) {
  return routes.map((route) => normalizeLeg(route, options));
}
