/**
 * A fronteira entre o contrato e quem vende passagem.
 *
 * Tudo acima desta interface fala o vocabulário canônico das 17 rotas; tudo
 * abaixo fala XML de fornecedor. Foi essa separação que permitiu a LATAM entrar
 * sem reescrever caso de uso nenhum.
 */
import { OfferKey } from '../../common/utils/offer-key';
import { AvailabilityDto } from '../flight/dto/availability.dto';
import { CreateBookingDto, FareRulesDto, QuoteDto } from '../flight/dto/booking.dto';
import { Leg } from '../flight/flight.types';
import type { RequiredParameter as ProviderRequiredParameter } from './travelfusion/normalizers/luggage.normalizer';

export interface RequestContext {
  correlationId?: string;
  endUserIp?: string;
  endUserAgent?: string;
  pointOfSale?: string;
}

/**
 * 🔴 UMA oferta é o pacote INTEIRO, não uma perna.
 *
 * Os dois provedores declaram a combinabilidade — a Travelfusion pelo
 * `RoutingId`, a LATAM pelo `OfferID` — e por isso nenhum dos dois autoriza
 * parear ida com volta por conta própria (04-availability-formatos.md §2).
 * Modelar a oferta como par já fechado é o que torna essa regra impossível de
 * violar por engano lá em cima.
 */
export interface ProviderOffer {
  outbound: Leg;
  /** `null` numa ida avulsa. Pacote de ida-e-volta SEMPRE traz os dois. */
  inbound: Leg | null;
}

export interface ProviderProbe {
  method: 'auth' | 'catalog';
  scope: 'credential' | 'connection';
}

export interface QuotedPrice {
  base: number | null;
  taxes: { boarding: number | null; service: number; fuel: number; baggage: number };
  fees: number | null;
  total: number | null;
  currency: string;
}

/**
 * O shape ja publicado pelo contrato na resposta do /quote. Reaproveitado como
 * tipo da interface para que o campo nao mude de forma conforme o provedor —
 * quem consome monta UM formulario, nao dois.
 */
export type { RequiredParameter } from './travelfusion/normalizers/luggage.normalizer';

export interface ProviderQuote {
  price: QuotedPrice;
  requiredParameters: ProviderRequiredParameter[];
}

export interface ProviderBooking {
  locator: string | null;
  committed: boolean;
  /** 🔴 Só `true` no status final de sucesso. Nunca deduzido de `committed`. */
  confirmed: boolean;
  status: string;
}

/**
 * O que um provedor consegue contar sobre uma reserva existente.
 *
 * 🔴 Deliberadamente POBRE. Cada companhia informa um subconjunto diferente, e o
 * contrato exige que TODAS as chaves existam — com `null` onde não há dado.
 * Omitir chave significaria outra coisa para quem consome, então o provedor
 * devolve `null` e quem monta o envelope é o caso de uso, um lugar só.
 */
export interface ProviderRetrieval {
  status: 'confirmed' | 'pending' | 'cancelled' | null;
  /** Estado cru do provedor, para diagnostico. Nunca publicado como status. */
  rawStatus: string | null;
  locator: string;
  /** Localizador da COMPANHIA — num agregador difere do do provedor, e e o que
   * o passageiro usa no check-in. */
  supplierConfirmation: string | null;
  supplierName: string | null;
  currency: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  confirmationAt: string | null;
  people: Record<string, unknown>[];
  /**
   * Os trechos da reserva. `[]` quando a companhia não os devolve nesta leitura
   * — é o caso da Travelfusion, cujo `CheckBooking` não traz itinerário.
   *
   * 🔴 A LATAM traz: o `OrderRetrieve` devolve `PaxSegmentList` completo, com
   * voo, horários, duração e aeronave. Isso estava sendo jogado fora porque o
   * contrato foi escrito quando só existia a Travelfusion.
   */
  segments: ProviderSegment[];
  /** Total pago/a pagar, quando a companhia informa. */
  total: number | null;
}

export interface ProviderSegment {
  segmentId: string | null;
  origin: string | null;
  destination: string | null;
  departure: string | null;
  arrival: string | null;
  /** ISO-8601 (`PT4H5M`) — devolvido como veio, sem virar minutos. */
  duration: string | null;
  company: { code: string | null; number: string | null };
  cabin: string | null;
  aircraft: string | null;
}

export interface FareRuleSection {
  company: string | null;
  fareBasis: string | null;
  origin: string | null;
  destination: string | null;
  text: string;
}

/**
 * O que um provedor precisa saber fazer.
 *
 * `search` é async generator porque os provedores chegam por caminhos
 * diferentes: a Travelfusion entrega em pedaços (polling incremental) e a LATAM
 * de uma vez só. Quem consome trata os dois igual — itera até acabar.
 */
export interface FlightProvider {
  readonly name: string;

  /** O que este provedor NÃO faz. O contrato responde 501, não 500. */
  readonly supports: {
    fareRules: boolean;
    retrieve: boolean;
    multicity: boolean;
    cancelBooking: boolean;
    seatMap: boolean;
    ancillaries: boolean;
  };

  probe(context: RequestContext): Promise<ProviderProbe>;

  search(request: AvailabilityDto, context: RequestContext): AsyncGenerator<ProviderOffer[]>;

  quote(key: OfferKey, dto: QuoteDto, context: RequestContext): Promise<ProviderQuote>;

  book(key: OfferKey, dto: CreateBookingDto, context: RequestContext): Promise<ProviderBooking>;

  retrieve(locator: string, context: RequestContext): Promise<ProviderRetrieval>;

  fareRules(key: OfferKey, dto: FareRulesDto, context: RequestContext): Promise<FareRuleSection[]>;

  /**
   * Cancelar a reserva. OPCIONAL: só existe em provedor que declara
   * `supports.cancelBooking`, e o contrato responde 501 nos demais.
   */
  cancelBooking?(locator: string, context: RequestContext): Promise<ProviderCancellation>;

  /**
   * Mapa de assentos. Opcional, e endereçado pela CHAVE DA OFERTA — na LATAM a
   * escolha acontece antes de reservar, e o localizador ainda não existe.
   */
  seatMap?(key: OfferKey, context: RequestContext): Promise<ProviderSeatMap>;

  /** Opcionais vendidos à parte. Endereçado pela oferta, como o mapa. */
  ancillaries?(key: OfferKey, context: RequestContext): Promise<ProviderAncillary[]>;
}

export interface ProviderAncillary {
  /** Opacos: o PAR identifica o serviço na compra. Devolver intactos. */
  offerItemId: string | null;
  serviceId: string | null;
  name: string | null;
  description: string | null;
  price: { total: number; currency: string | null } | null;
  paxId: string | null;
  segmentId: string | null;
}

export interface ProviderSeat {
  seat: string | null;
  row: string | null;
  column: string | null;
  status: string;
  available: boolean;
  paid: boolean;
  price: { total: number; currency: string | null } | null;
  characteristic: string | null;
  /** Opacos: o PAR identifica o assento na compra. Devolver intactos. */
  offerItemId: string | null;
  serviceId: string | null;
}

export interface ProviderSeatMap {
  currency: string | null;
  segments: Array<{
    segmentId: string | null;
    cabins: Array<{
      cabinClass: string | null;
      rows: Array<{ number: string | null; exitRow: boolean; seats: ProviderSeat[] }>;
    }>;
  }>;
}

/** O que o contrato precisa saber de um cancelamento. */
export interface ProviderCancellation {
  locator: string;
  /** 🔴 `cancelled` só quando a companhia confirma. Pendente NÃO é cancelado. */
  status: 'cancelled' | 'pending';
  rawStatus: string | null;
  /** Quanto a companhia declarou que devolve. `null` = ela não disse. */
  refund: { total: number; currency: string | null } | null;
}

export const FLIGHT_PROVIDERS = Symbol('FLIGHT_PROVIDERS');
