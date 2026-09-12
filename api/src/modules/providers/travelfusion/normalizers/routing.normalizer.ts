import { encodeOfferKey } from '../../../../common/utils/offer-key';
import { roundMoney } from '../../../../common/utils/money';
import { flightDuration } from '../../../../common/utils/duration';
import { PROVIDER } from '../../../../config/env';
import {
  Airport, Cabin, Equipment, Fare, FarePrice, FareRulesInfo, FlightTime, Leg, PassengerPrice, Segment,
} from '../../../flight/flight.types';
import { asList, bool, num, text, XmlNode } from '../../../../common/xml/xml.util';

/**
 * ⚠️ Provedor ARQUIVADO. A Travelfusion está bloqueada por liberação de IP e
 * fora do escopo atual — este arquivo acompanha o vocabulário canônico para
 * continuar compilando e correto, mas não recebe trabalho novo. O foco é a
 * LATAM; ver `docs/travelfusion/README.md`.
 */

/**
 * Cabine canônica.
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

/** Cidade e coordenadas são enriquecimento externo — `null`, nunca palpite. */
const airport = (code: string | null, city: string | null = null): Airport | null =>
  code
    ? { iata: code.toUpperCase(), city, terminal: null, coordinates: { lat: null, lng: null } }
    : null;

const flightTime = (departure: string | null, arrival: string | null): FlightTime => ({
  departure,
  arrival,
  // A Travelfusion não declara duração; só resta a diferença entre as pontas.
  duration: flightDuration(null, departure, arrival),
});

const equipmentOf = (code: string | null, name: string | null): Equipment | null =>
  code || name ? { code, name, description: null } : null;

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
    equipment: equipmentOf(text(source?.AircraftCode), text(source?.AircraftName)),
    cabin: canonicalCabin(text(source?.CabinClass)),
  };
}

function passengerPrice(node: XmlNode, currency: string): PassengerPrice | null {
  const source = node as Record<string, any>;
  const base = num(source?.BaseFare);
  if (base === null) return null;

  const tax = num(source?.Tax) ?? 0;
  const fees = num(source?.Fee) ?? 0;

  return {
    base: roundMoney(base),
    // A Travelfusion manda o total de impostos, sem discriminar a natureza.
    taxes: { boarding: null, service: null, fuel: null, baggage: null, total: roundMoney(tax) },
    fees: roundMoney(fees),
    total: roundMoney(base + tax + fees),
    currency,
  };
}

/**
 * FareRules. As duas formas da multa (lista e objetos por tipo) convivem de
 * propósito: a que vier preenchida alimenta a vazia. A Travelfusion não
 * estrutura multa, então as duas ficam vazias e o que sobra é a `key` — o texto
 * integral vem depois, pelo /fare-rules.
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
  returnId: string | null,
  direction: 'outward' | 'return',
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
      taxes: { boarding: null, service: null, fuel: null, baggage: null, total: roundMoney(tax) },
      fees: roundMoney(fee),
      total: roundMoney(total),
      currency,
    },
    perPassenger: roundMoney(total / Math.max(1, passengerCount)),
    net: null,
  };

  return {
    /**
     * 🔴 A chave de VENDA é da tarifa, não do trecho. A Travelfusion não
     * identifica a tarifa separadamente do routing, então a chave carrega o
     * `RoutingId` mais os ids de perna — que é o que o ProcessDetails exige.
     */
    fareId: encodeOfferKey({ p: PROVIDER, r: routingId, o: outwardId, i: returnId, d: direction }),
    code: text(route?.FareCode),
    familyCode: text(route?.FareFamilyCode),
    family: text(route?.FareFamily),
    fareCode: text(route?.FareBasis),
    bookingCode: text(route?.BookingClass),
    cabin: canonicalCabin(text(route?.CabinClass)),
    seats: num(route?.SeatsRemaining),
    price,
    fees: [],
    // O agregador não estrutura franquia na busca: ela sai no /quote, em
    // requiredParameters. `null` nos dois nós = não informado.
    baggage: { hand: null, hold: null },
    rules: buildFareRules(route, routingId, outwardId),
    benefits: null,
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
 * cobrem o itinerário inteiro. Isso a classifica como provedor de PACOTE —
 * nunca parear pernas por conta própria.
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

  const departure = first?.time.departure ?? null;
  const arrival = last?.time.arrival ?? null;

  return {
    // A perna da companhia. A chave de venda está em `fares[].fareId`.
    identifier: options.direction === 'return' ? returnId : outwardId,
    company: { code: first?.company.code ?? null, name: first?.company.name ?? null },
    origin: first?.origin ?? null,
    destination: last?.destination ?? null,
    time: {
      departure,
      arrival,
      duration: segments.every((segment) => segment.time.duration > 0)
        ? segments.reduce((sum, segment) => sum + segment.time.duration, 0)
        : flightDuration(null, departure, arrival),
    },
    stops: segments.length > 0 ? segments.length - 1 : null,
    flights: segments,
    fares: [normalizeFare(
      route, options.passengerCount, options.routingId, outwardId, returnId, options.direction,
    )],
    fees: [],
  };
}

/** `true` quando o `<Route>` traz a perna de volta — decide se o grupo é montável. */
export function hasReturnLeg(route: Record<string, any>): boolean {
  const source = route?.ReturnSegmentList?.Segment ?? route?.InboundSegmentList?.Segment;
  return asList(source).length > 0;
}
