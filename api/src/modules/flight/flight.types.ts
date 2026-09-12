/**
 * O vocabulário canônico do contrato, em tipos.
 *
 * A referência é `models/` — os objetos que atravessam a fronteira entre a nossa
 * camada de capability e a companhia. Onde o `models/` é explícito, ele manda;
 * onde ele mostra só `null` e não descreve o interior (é o caso de `benefits`),
 * a forma vem da especificação canônica das 17 rotas.
 *
 * Isto é o que a refatoração para TypeScript compra de verdade: a forma que sai
 * na resposta deixa de ser convenção e vira coisa que o compilador cobra. Um
 * campo que o contrato exige não pode ser esquecido em silêncio.
 */

export interface Coordinates {
  lat: number | null;
  lng: number | null;
}

/**
 * `Airport` — UM tipo só, em todos os níveis.
 *
 * O `models/` mostra o aeroporto do TRECHO com quatro chaves e o do SEGMENTO com
 * duas (`iata`, `terminal`). Publicar os dois formatos obrigaria quem consome a
 * saber em que nível está antes de ler o código IATA; publicar sempre as quatro,
 * com `null` onde a companhia não informa, satisfaz o modelo e é uma regra a
 * menos. Cidade e coordenadas são enriquecimento externo — nunca inventados.
 */
export interface Airport {
  iata: string | null;
  city: string | null;
  terminal: string | null;
  coordinates: Coordinates;
}

export interface FlightTime {
  /** Hora LOCAL do aeroporto, ISO-8601 com fuso. Nunca convertida para UTC. */
  departure: string | null;
  arrival: string | null;
  /** Minutos. `0` = não informada — ver `common/utils/duration.ts`. */
  duration: number;
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

export interface Equipment {
  code: string | null;
  name: string | null;
  description: string | null;
}

export interface Segment {
  origin: Airport | null;
  destination: Airport | null;
  time: FlightTime;
  company: SegmentCompany;
  number: string | null;
  segment: number;
  connection: boolean;
  /** 🔴 O código sobrevive ao lado do nome: trocar um pelo outro perde a chave. */
  equipment: Equipment | null;
  /** 🔴 `null` é comum e correto quando o voo oferece mais de uma cabine. */
  cabin: Cabin | null;
}

/**
 * 🔴 Os componentes são `null` quando a companhia não discrimina, e `total` é o
 * número que ela declarou. Somar os quatro para chegar no total, ou espalhar o
 * total em `boarding` porque é o único campo que existia, são as duas formas de
 * publicar uma discriminação que ninguém informou.
 */
export interface TaxBreakdown {
  boarding: number | null;
  service: number | null;
  fuel: number | null;
  baggage: number | null;
  total: number | null;
}

export interface PassengerPrice {
  base: number | null;
  taxes: TaxBreakdown;
  fees: number | null;
  total: number | null;
  currency: string;
}

/**
 * Preço da tarifa, sempre CRU do fornecedor.
 *
 * Margem, comissão, câmbio e `snapshot` são da plataforma que consome a API e
 * ficam fora — por isso não existe `exchange` aqui.
 */
export interface FarePrice {
  /** 🔴 Os três são "tudo ou nada": quando a companhia não separa, vêm null juntos. */
  adult: PassengerPrice | null;
  child: PassengerPrice | null;
  baby: PassengerPrice | null;
  total: PassengerPrice;
  perPassenger: number | null;
  net: { total: number; perPassenger: number } | null;
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

/**
 * Uma franquia, por tipo. `hand` é a de mão; `hold` é a despachada.
 *
 * 🔴 Cada nó tem o SEU `included` — não existe `included` no topo. Uma tarifa
 * LIGHT inclui bagagem de mão e não inclui despacho, e um booleano só não
 * consegue dizer isso.
 */
export interface BaggageAllowance {
  included: boolean | null;
  pieces: number | null;
  weight: number | null;
  unit: string | null;
  description: string | null;
  /** Só na despachada: `"checked"`. */
  type?: string | null;
}

export interface Baggage {
  hand: BaggageAllowance | null;
  hold: BaggageAllowance | null;
}

/**
 * Comodidades da tarifa. `null` = a companhia não descreveu nenhuma.
 *
 * 🔴 São QUATRO estados por comodidade, não dois: a chave ausente/`null` é "não
 * informado", e `not_offered` é "a companhia afirmou que não tem". Tratar o
 * primeiro como o segundo faz a tela dizer "este voo não tem wi-fi" quando a
 * verdade é "não sabemos".
 */
export type BenefitStatus = 'included' | 'chargeable' | 'not_offered';

export interface FareBenefit {
  status: BenefitStatus;
  /** Texto CRU da companhia, ou `null`. Nunca uma frase escrita por nós. */
  description: string | null;
  amount: number | null;
  currency: string | null;
}

export interface FareBenefits {
  wifi: FareBenefit | null;
  catering: FareBenefit | null;
  entertainment: FareBenefit | null;
  seatSelection: FareBenefit | null;
  extraSpaceSeat: FareBenefit | null;
  priorityBoarding: FareBenefit | null;
  loyalty: FareBenefit | null;
  lounge: FareBenefit | null;
}

export interface Fare {
  /**
   * 🔴 O identificador OPACO da oferta, e o campo mais importante do contrato.
   *
   * Ele carrega tudo que a companhia exige para retomar a venda — na LATAM,
   * `offerId`, `offerItemIds`, `journeyRefs` e `paxRefs`. Segue literalmente
   * para `/quote`, `/booking`, `/seat-map` e `/ancillaries`: nunca remontado,
   * nunca interpretado, nunca deduplicado por prefixo.
   */
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
  /** `null` quando a companhia não estrutura regra nenhuma nesta resposta. */
  rules: FareRulesInfo | null;
  /** `null` quando a oferta não descreve comodidade nenhuma. */
  benefits: FareBenefits | null;
}

export interface Leg {
  /**
   * A JOURNEY da companhia (`JOURNEY_1`), não a chave de venda.
   *
   * 🔴 Quem segue para tarifar e reservar é `fares[].fareId`. Os dois já foram a
   * mesma coisa aqui, e separá-los é o que o `models/` pede: uma journey tem
   * várias famílias tarifárias, e cada família é uma venda diferente do mesmo voo.
   */
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
  id: number;
  price: {
    total: number | null;
    perPassenger: number | null;
    currency: string | null;
  } | null;
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
 * As quatro caixas. Nenhuma busca usa as quatro ao mesmo tempo; qual conjunto
 * aparece depende do tipo de viagem.
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
