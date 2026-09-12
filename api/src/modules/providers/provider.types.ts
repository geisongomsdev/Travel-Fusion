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
import { Baggage, Leg } from '../flight/flight.types';
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
 * parear ida com volta por conta própria. Modelar a oferta como par já fechado
 * é o que torna essa regra impossível de violar por engano lá em cima.
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

/**
 * O preço firme do `/quote`.
 *
 * 🔴 `taxes` é um ESCALAR aqui, ao contrário da busca, onde é a discriminação
 * por natureza. É o que o modelo publica, e é honesto: nenhum dos dois
 * provedores discrimina imposto no tarifar — só devolve o total.
 */
export interface QuotedPrice {
  base: number | null;
  taxes: number | null;
  fees: number | null;
  total: number | null;
  currency: string;
}

/**
 * O shape já publicado pelo contrato na resposta do /quote. Reaproveitado como
 * tipo da interface para que o campo não mude de forma conforme o provedor —
 * quem consome monta UM formulário, não dois.
 */
export type { RequiredParameter } from './travelfusion/normalizers/luggage.normalizer';

export interface ProviderQuote {
  /** 🔴 `false` = a oferta não pode mais ser confirmada. Não é erro: é resposta. */
  available: boolean;
  familyCode: string | null;
  family: string | null;
  price: QuotedPrice;
  requiredParameters: ProviderRequiredParameter[];
}

export interface ProviderPassenger {
  id: string;
  type: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface ProviderBooking {
  locator: string | null;
  committed: boolean;
  /** 🔴 Só `true` no status final de sucesso. Nunca deduzido de `committed`. */
  confirmed: boolean;
  status: string;
  currency: string | null;
  passengers: ProviderPassenger[];
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
  /** Estado cru do provedor, para diagnóstico. Nunca publicado como status. */
  rawStatus: string | null;
  locator: string;
  /** Localizador da COMPANHIA — num agregador difere do do provedor, e é o que
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
   * voo, horários, duração e aeronave.
   */
  segments: ProviderSegment[];
  /**
   * O agrupamento dos segmentos em JOURNEYS, na ordem da viagem.
   *
   * 🔴 Sem isto não dá para dizer o que é ida e o que é volta: dois segmentos
   * podem ser uma conexão de uma perna só ou duas pernas distintas, e a
   * diferença não está no segmento. `[]` quando a companhia não agrupa — aí o
   * caso de uso trata a reserva como uma journey só, em vez de inventar uma
   * volta que talvez seja escala.
   */
  journeys: Array<{ id: string; segmentIds: string[] }>;
  /** Total pago/a pagar, quando a companhia informa. */
  total: number | null;
  /** Documentos da reserva. `[]` é legítimo numa reserva não emitida. */
  tickets: ProviderTicket[];
}

export interface ProviderSegment {
  segmentId: string | null;
  origin: string | null;
  destination: string | null;
  departure: string | null;
  arrival: string | null;
  /** Minutos — convertido na fronteira, para o contrato não publicar ISO cru. */
  duration: number;
  company: { code: string | null; number: string | null };
  cabin: string | null;
  aircraft: string | null;
  fareBasis: string | null;
  bookingClass: string | null;
}

/**
 * Um bilhete ou EMD.
 *
 * 🔴 `tickets[]` e `emds[]` são listas SEPARADAS no contrato: o documento de voo
 * e o de serviço têm ciclos de vida diferentes, e cancelar um não cancela o
 * outro. `type` diz qual é — `flight` vive em tickets, o resto em emds.
 */
export interface ProviderTicket {
  ticketNumber: string | null;
  type: 'flight' | 'baggage' | 'seat' | 'other';
  passengerId: string | null;
  passengerName: string | null;
  status: 'issued' | 'voided' | 'refunded' | 'cancelled' | 'failed' | 'unknown' | null;
  providerStatus: string | null;
  issueDate: string | null;
  amount: { total: number; currency: string | null } | null;
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
    financingOptions: boolean;
    issue: boolean;
    /** Comprar assento/bagagem DEPOIS da emissão. Não é o mesmo que `seatMap`. */
    sellAncillaries: boolean;
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
  ancillaries?(key: OfferKey, context: RequestContext): Promise<ProviderAncillaryCatalog>;

  /**
   * Os mesmos dois catálogos, endereçados pela RESERVA já emitida.
   *
   * 🔴 Não são um atalho do de cima: o catálogo pós-emissão devolve outros
   * identificadores, e são os únicos que a compra pós-emissão aceita. Ler pela
   * oferta e comprar pela ordem não combina.
   */
  seatMapForOrder?(locator: string, context: RequestContext): Promise<ProviderSeatMap>;

  ancillariesForOrder?(locator: string, context: RequestContext): Promise<ProviderAncillaryCatalog>;

  /** Comprar os opcionais escolhidos. Mutação não idempotente: cobra o cartão. */
  sellAncillaries?(
    locator: string,
    request: ProviderAncillaryPurchase,
    context: RequestContext,
  ): Promise<ProviderAncillaryPurchaseResult>;

  /**
   * Parcelas do cartão para uma reserva. O PAN é dado de pagamento: existe na
   * chamada porque a operadora precisa dele, e não é logado nem guardado.
   */
  financingOptions?(locator: string, pan: string, context: RequestContext): Promise<ProviderFinancing>;

  /** Pagar a reserva. Mutação não idempotente, sem retry. */
  issue?(locator: string, payment: ProviderPayment, context: RequestContext): Promise<ProviderIssue>;
}

export interface ProviderFinancing {
  cardBrand: string | null;
  currency: string | null;
  options: Array<{
    id: string;
    installments: number;
    installmentAmount: number | null;
    total: number | null;
    interestRate: number | null;
    /** `true` quando a companhia marcou como promocional. */
    promotional: boolean;
  }>;
}

/** Cartão no vocabulário da fronteira: já convertido do que o contrato recebe. */
export interface ProviderCard {
  brand: string;
  holder: string;
  number: string;
  securityCode: string;
  /** `MMAA` — a conversão de `MM/YYYY` acontece no caso de uso. */
  expiration: string;
}

export interface ProviderPayer {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  documentNumber: string;
}

export interface ProviderPayment {
  card: ProviderCard;
  billing: { email: string; countryCode: string; postalCode: string; street: string };
  /** Quem paga — obrigatório na LATAM, e nem sempre é o passageiro. */
  payer: ProviderPayer;
  amount: { total: number; currency: string };
  installmentId: string | null;
}

export interface ProviderAncillaryPurchase {
  items: Array<{
    offerItemId: string;
    serviceId: string | null;
    paxId: string;
    /** Obrigatório para assento: a LATAM quer a poltrona além do id. */
    seat?: { row: string; column: string } | null;
  }>;
  amount: { total: number; currency: string };
  /** `null` cobra por BSP (`PaymentTypeCode CA`) — usado quando o total é zero. */
  card: ProviderCard | null;
  payer: ProviderPayer | null;
}

export interface ProviderPurchasedService {
  /** O `OfferItemID` de volta, para o caso de uso reencontrar o item pedido. */
  offerItemId: string | null;
  serviceId: string | null;
  name: string | null;
  paxId: string | null;
  segmentId: string | null;
  seat: string | null;
  /** `booked` = pendente; `issued` = EMD emitido; `failed` = recusado. */
  status: 'booked' | 'issued' | 'failed' | null;
  providerStatus: string | null;
  emdNumber: string | null;
  message: string | null;
}

export interface ProviderAncillaryPurchaseResult {
  locator: string;
  /** A companhia aceitou e gravou. NUNCA `null`. */
  committed: boolean;
  /**
   * 🔴 Existe PROVA do efeito? `null` quando a companhia responde "ok" e não
   * devolve o serviço — e `null` não é sucesso comprovado.
   */
  confirmed: boolean | null;
  rawStatus: string | null;
  services: ProviderPurchasedService[];
  total: { total: number; currency: string | null } | null;
}

export interface ProviderIssue {
  locator: string;
  committed: boolean;
  /** 🔴 Só `true` com prova estruturada de documento emitido. */
  confirmed: boolean | null;
  /** Ficou aguardando processamento assíncrono da companhia. */
  queued: boolean;
  rawStatus: string | null;
  authorizationCode: string | null;
  tickets: ProviderTicket[];
  /** EMDs de bagagem/assento materializados junto, quando existirem. */
  emds: ProviderTicket[];
  /** Avisos CRUS da companhia. */
  messages: string[];
}

/**
 * Passageiro e trecho de um CATÁLOGO — o mapa de assentos e a lista de
 * opcionais publicam os dois, e é o mesmo dado.
 *
 * 🔴 Sem eles, quem consome recebe ofertas amarradas a `passengerId` e
 * `segmentId` que não sabe traduzir: o id existe, mas não há como dizer de quem
 * nem de qual voo ele é. Os dois catálogos trazem isso em `DataLists` e estava
 * sendo descartado.
 */
export interface CatalogPassenger {
  id: string;
  firstName: string | null;
  lastName: string | null;
  type: string | null;
}

export interface CatalogSegment {
  segmentId: string | null;
  origin: string | null;
  destination: string | null;
  departureDate: string | null;
  number: string | null;
  company: { code: string | null; name: string | null };
}

export interface ProviderAncillaryCatalog {
  currency: string | null;
  passengers: CatalogPassenger[];
  segments: CatalogSegment[];
  offers: ProviderAncillary[];
}

/** Uma oferta de opcional — `offers[]` do contrato. */
export interface ProviderAncillary {
  /** Opaca: carrega o par `OfferItemID` + `ServiceID`. Devolver intacta. */
  key: string | null;
  /** Tipo DECLARADO pela companhia, nunca inferido do nome. */
  type: string | null;
  /** RFISC/SSR cru, quando existir. */
  code: string | null;
  name: string | null;
  description: string | null;
  price: { total: number; currency: string | null } | null;
  passengerId: string | null;
  segmentId: string | null;
  /** Franquia estruturada, quando a companhia a descreve. */
  baggage: Baggage | null;
}

export interface ProviderSeat {
  seat: string | null;
  row: string | null;
  column: string | null;
  status: 'available' | 'occupied' | 'blocked' | 'unavailable';
  available: boolean;
  paid: boolean;
  price: { total: number; currency: string | null } | null;
  /** Canônicas (`window`/`aisle`/`middle`) e as cruas, lado a lado. */
  characteristics: string[];
  providerCharacteristics: string[];
  commercialName: string | null;
  accessible: boolean | null;
  recline: boolean | null;
  /** Opaca: mesmo par do opcional. */
  key: string | null;
}

export interface ProviderSeatMapSegment extends CatalogSegment {
  equipment: { code: string | null; name: string | null };
  cabins: Array<{
    cabinClass: string | null;
    rows: Array<{ number: string | null; exitRow: boolean; seats: ProviderSeat[] }>;
  }>;
}

export interface ProviderSeatMap {
  currency: string | null;
  /** Se a companhia exige pagamento para marcar. `null` = não declarou. */
  paymentRequired: boolean | null;
  /**
   * 🔴 `assignedSeats` é `null` quando a companhia não informa quais assentos o
   * passageiro já tem, e `[]` quando informa que não há nenhum. As duas coisas
   * acontecem, e confundi-las mostra "sem assento" para quem já escolheu um.
   */
  passengers: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    assignedSeats: Array<{ segmentId: string | null; seat: string | null }> | null;
  }>;
  segments: ProviderSeatMapSegment[];
}

/** O que o contrato precisa saber de um cancelamento. */
export interface ProviderCancellation {
  locator: string;
  /** 🔴 `cancelled` só quando a companhia confirma. Pendente NÃO é cancelado. */
  status: 'cancelled' | 'pending';
  /**
   * O EFEITO observado, que não é o mesmo que o status: `VOID` anula o bilhete,
   * `REFUND` devolve dinheiro. A companhia decide qual, e quem consome precisa
   * saber para explicar ao passageiro.
   */
  outcome: 'VOID' | 'REFUND' | 'PROCESSED' | 'UNKNOWN';
  rawStatus: string | null;
  /** Quanto a companhia declarou que devolve. `null` = ela não disse. */
  refund: { total: number; currency: string | null } | null;
  /**
   * 🔴 `false` por padrão, e de propósito: o `OrderCancelRS` NÃO prova que um
   * e-ticket foi anulado. Só vira `true` com o cupom lido como VOID/REFUND.
   */
  eticketsCancelled: boolean;
  tickets: ProviderTicket[];
}

export const FLIGHT_PROVIDERS = Symbol('FLIGHT_PROVIDERS');
