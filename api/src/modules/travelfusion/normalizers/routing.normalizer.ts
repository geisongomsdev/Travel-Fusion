import { encodeOfferKey } from '../../../common/utils/offer-key';
import { roundMoney } from '../../../common/utils/money';
import { PROVIDER } from '../../../config/env';
import {
  Airport, Cabin, Fare, FarePrice, FareRulesInfo, FlightTime, Leg, PassengerPrice, Segment,
} from '../../flight/flight.types';
import { asList, bool, num, text, XmlNode } from '../xml.util';

/**
 * Cabine canônica — 01-convencoes.md §6.
 *
 * 🔴 Rótulo desconhecido vira `null`, nunca o texto cru do fornecedor. Publicar
 * o rótulo dele faria uma busca por econômica casar com oferta de outra cabine.
 */
const CABIN_MAP: Record<string, Cabin> = {
  economy: 'economy', economic: 'economy', coach: 'economy',
  premiumeconomy: 'premium_economy', premium: 'premium_economy',
  business: 'business', club: 'business',
  first: 'first',
};

export function canonicalCabin(value: string | null | undefined): Cabin | null {
  if (!value) return null;
  return CABIN_MAP[value.toLowerCase().replace(/[\s_-]/g, '')] ?? null;
}

const airport = (code: string | null, name: string | null = null): Airport | null =>
  code ? { code: code.toUpperCase(), name } : null;

const flightTime = (departure: string | null, arrival: string | null): FlightTime => ({ departure, arrival });

function normalizeSegment(node: XmlNode, index: number): Segment {
  const source = node as Record<string, any>;
  const marketing = text(source?.MarketingCarrier) ?? text(source?.Carrier);

  return {
    origin: airport(text(source?.Origin), text(source?.OriginName)),
    destination: airport(text(source?.Destination), text(source?.DestinationName)),
    time: flightTime(text(source?.DepartureDateTime), text(source?.ArrivalDateTime)),
    company: {
      code: marketing,
      name: text(source?.CarrierName),
      operating: text(source?.OperatingCarrier) ?? marketing,
    },
    number: text(source?.FlightNumber),
    segment: index,
    connection: index > 0,
    equipment: {
      code: text(source?.AircraftCode),
      name: text(source?.AircraftName),
      description: null,
    },
    cabin: canonicalCabin(text(source?.CabinClass)),
  };
}

function passengerPrice(node: XmlNode, currency: string): PassengerPrice | null {
  const source = node as Record<string, any>;
  const base = num(source?.BaseFare);
  if (base === null) return null;

  const taxes = { boarding: num(source?.Tax) ?? 0, service: 0, fuel: 0, baggage: 0 };
  const fees = num(source?.Fee) ?? 0;

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
function buildFareRules(route: Record<string, any>, routingId: string, outwardId: string | null): FareRulesInfo {
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
    key: encodeOfferKey({ p: PROVIDER, r: routingId, o: outwardId, k: 'rules' }),
  };
}

function normalizeFare(
  route: Record<string, any>,
  passengerCount: number,
  routingId: string,
  outwardId: string | null,
): Fare {
  const currency = text(route?.Currency) ?? 'BRL';
  const base = num(route?.BaseFare) ?? 0;
  const tax = num(route?.Tax) ?? 0;
  const fee = num(route?.Fee) ?? 0;
  const total = num(route?.TotalPrice) ?? roundMoney(base + tax + fee) ?? 0;

  const adult = passengerPrice(route?.AdultPrice, currency);
  const child = passengerPrice(route?.ChildPrice, currency);
  const baby = passengerPrice(route?.InfantPrice, currency);
  // Os nós por passageiro são tudo-ou-nada: publicar só um não explicaria o total.
  const hasBreakdown = adult !== null;

  const price: FarePrice = {
    adult: hasBreakdown ? adult : null,
    child: hasBreakdown ? child : null,
    baby: hasBreakdown ? baby : null,
    total: {
      base: roundMoney(base),
      taxes: { boarding: roundMoney(tax) ?? 0, service: 0, fuel: 0, baggage: 0 },
      fees: roundMoney(fee),
      total: roundMoney(total),
      currency,
    },
    perPassenger: roundMoney(total / Math.max(1, passengerCount)),
    net: null,
    exchange: null,
  };

  return {
    // A Travelfusion não identifica a tarifa separadamente do routing — quem
    // endereça é o `identifier` do trecho.
    fareId: null,
    code: text(route?.FareCode),
    familyCode: text(route?.FareFamilyCode),
    family: text(route?.FareFamily),
    fareCode: text(route?.FareBasis),
    bookingCode: text(route?.BookingClass),
    cabin: canonicalCabin(text(route?.CabinClass)),
    seats: num(route?.SeatsRemaining),
    price,
    fees: [],
    baggage: { included: null, quantity: null, weight: null, unit: null },
    rules: buildFareRules(route, routingId, outwardId),
    benefits: {
      seatSelection: null, checkedBaggage: null, carryOn: null, meal: null,
      loyaltyPoints: null, priorityBoarding: null, refund: null, change: null,
    },
  };
}

export interface NormalizeOptions {
  routingId: string;
  passengerCount: number;
  /** Qual perna deste routing estamos montando. */
  direction: 'outward' | 'return';
}

/**
 * Um `<Route>` da Travelfusion vira UM trecho canônico.
 *
 * 🔴 A Travelfusion DECLARA a combinabilidade: `RoutingId` + `OutwardId`/`ReturnId`
 * cobrem o itinerário inteiro. Isso a classifica como provedor de PACOTE
 * (04-availability-formatos.md §2) — nunca parear pernas por conta própria.
 */
export function normalizeLeg(route: Record<string, any>, options: NormalizeOptions): Leg {
  const segmentSource = options.direction === 'return'
    ? (route?.ReturnSegmentList?.Segment ?? route?.InboundSegmentList?.Segment)
    : (route?.SegmentList?.Segment ?? route?.OutwardSegmentList?.Segment);

  const segments = asList(segmentSource).map(normalizeSegment);
  const first = segments[0];
  const last = segments[segments.length - 1];

  const outwardId = text(route?.OutwardId) ?? text(route?.Id);
  const returnId = text(route?.ReturnId);

  const identifier = encodeOfferKey({
    p: PROVIDER,
    r: options.routingId,
    o: outwardId,
    i: returnId,
    d: options.direction,
  });

  return {
    identifier,
    company: { code: first?.company.code ?? null, name: first?.company.name ?? null },
    origin: first?.origin ?? null,
    destination: last?.destination ?? null,
    time: flightTime(first?.time.departure ?? null, last?.time.arrival ?? null),
    stops: segments.length > 0 ? segments.length - 1 : null,
    flights: segments,
    fares: [normalizeFare(route, options.passengerCount, options.routingId, outwardId)],
    fees: [],
  };
}

/** `true` quando o `<Route>` traz a perna de volta — decide se o grupo é montável. */
export function hasReturnLeg(route: Record<string, any>): boolean {
  const source = route?.ReturnSegmentList?.Segment ?? route?.InboundSegmentList?.Segment;
  return asList(source).length > 0;
}
