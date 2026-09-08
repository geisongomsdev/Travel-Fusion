/**
 * O vocabulário canônico do contrato, em tipos — 01-convencoes.md §6.
 *
 * Isto é o que a refatoração para TypeScript compra de verdade: a forma que sai
 * na resposta deixa de ser convenção e vira coisa que o compilador cobra. Um
 * campo que o contrato exige não pode ser esquecido em silêncio.
 */

export interface Airport {
  code: string;
  name: string | null;
}

export interface FlightTime {
  departure: string | null;
  arrival: string | null;
}

/** 3 chaves no SEGMENTO — codeshare é do segmento. */
export interface SegmentCompany {
  code: string | null;
  name: string | null;
  operating: string | null;
}

/** 2 chaves no TRECHO. */
export interface LegCompany {
  code: string | null;
  name: string | null;
}

export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';

export interface Segment {
  origin: Airport | null;
  destination: Airport | null;
  time: FlightTime;
  company: SegmentCompany;
  number: string | null;
  segment: number;
  connection: boolean;
  equipment: { code: string | null; name: string | null; description: string | null };
  /** 🔴 `null` é comum e correto quando o voo oferece mais de uma cabine. */
  cabin: Cabin | null;
}

export interface TaxBreakdown {
  boarding: number;
  service: number;
  fuel: number;
  baggage: number;
}

export interface PassengerPrice {
  base: number | null;
  taxes: TaxBreakdown;
  fees: number | null;
  total: number | null;
  currency: string;
}

export interface FarePrice {
  /** 🔴 Os três são "tudo ou nada": quando a companhia não separa, vêm null juntos. */
  adult: PassengerPrice | null;
  child: PassengerPrice | null;
  baby: PassengerPrice | null;
  total: PassengerPrice;
  perPassenger: number | null;
  net: { total: number; perPassenger: number } | null;
  exchange: Record<string, unknown> | null;
}

export interface FareRulesInfo {
  refundable: boolean | null;
  changeable: boolean | null;
  penalties: unknown[];
  refund: unknown | null;
  change: unknown | null;
  cancellation: unknown | null;
  noShow: unknown | null;
  endorsable: boolean | null;
  transferable: boolean | null;
  /** Chave opaca para POST /fare-rules. `null` = a companhia não expõe o texto. */
  key: string | null;
}

/** 8 chaves fixas, todas sempre presentes. */
export interface FareBenefits {
  seatSelection: boolean | null;
  checkedBaggage: boolean | null;
  carryOn: boolean | null;
  meal: boolean | null;
  loyaltyPoints: boolean | null;
  priorityBoarding: boolean | null;
  refund: boolean | null;
  change: boolean | null;
}

export interface Baggage {
  included: boolean | null;
  quantity: number | null;
  weight: number | null;
  unit: string | null;
}

export interface Fare {
  fareId: string | null;
  code: string | null;
  familyCode: string | null;
  family: string | null;
  fareCode: string | null;
  bookingCode: string | null;
  cabin: Cabin | null;
  seats: number | null;
  price: FarePrice;
  /** Discriminação do que já está em price.total. Mostrar, nunca somar de novo. */
  fees: unknown[];
  baggage: Baggage;
  rules: FareRulesInfo;
  benefits: FareBenefits;
}

export interface Leg {
  /** 🔴 Identificador OPACO da oferta neste trecho. Segue para tarifar e reservar. */
  identifier: string | null;
  company: LegCompany;
  origin: Airport | null;
  destination: Airport | null;
  time: FlightTime;
  /** Conexões mais escalas técnicas. `0` = direto. */
  stops: number | null;
  flights: Segment[];
  fares: Fare[];
  /** Lista LEGADA. Não somar com price.total — é o mesmo dinheiro. */
  fees: unknown[];
}

export interface RoundtripGroup {
  departure: Leg[];
  return: Leg[];
  fares: Fare[];
}

export interface MulticityItinerary {
  /** Lista de listas: o índice externo é o trecho, o interno são opções de horário. */
  legs: Leg[][];
  fares: Fare[];
}

/**
 * As quatro caixas — 04-availability-formatos.md §1. Nenhuma busca usa as quatro
 * ao mesmo tempo; qual conjunto aparece depende do tipo de viagem.
 *
 * 🔴 Chave AUSENTE ≠ `[]`. A presença da chave carrega informação, por isso os
 * campos são opcionais no tipo em vez de sempre presentes.
 */
export interface AvailabilityData {
  groups?: RoundtripGroup[];
  departure?: Leg[];
  return?: Leg[];
  itineraries?: MulticityItinerary[];
}

export type StreamEventType =
  | 'start' | 'provider_success' | 'provider_error' | 'filters' | 'complete' | 'fatal_error';

export interface StreamEvent {
  type: StreamEventType;
  timestamp: string;
  [key: string]: unknown;
}
