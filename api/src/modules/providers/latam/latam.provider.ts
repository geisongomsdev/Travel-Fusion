import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { roundMoney } from '../../../common/utils/money';
import { durationFromIso } from '../../../common/utils/duration';
import { OfferKey } from '../../../common/utils/offer-key';
import { LATAM } from '../../../config/env';
import { AvailabilityDto, legsOf, passengersOf } from '../../flight/dto/availability.dto';
import { BookingPersonDto, CreateBookingDto, QuoteDto } from '../../flight/dto/booking.dto';
import {
  FareRuleSection, FlightProvider, ProviderAncillaryCatalog, ProviderAncillaryPurchase,
  ProviderAncillaryPurchaseResult, ProviderBooking, ProviderCancellation, ProviderFinancing,
  ProviderIssue, ProviderOffer, ProviderPassenger, ProviderPayment, ProviderProbe, ProviderQuote,
  ProviderRetrieval, ProviderSeatMap, ProviderTicket, RequestContext,
} from '../provider.types';
import { asList, attr, child, num, text, XmlValue } from '../../../common/xml/xml.util';
import { buildPaxList, LatamCommands } from './latam.commands';
import { normalizeAirShopping } from './normalizers/offer.normalizer';
import { normalizeSeatMap } from './normalizers/seat.normalizer';
import { normalizeServiceList } from './normalizers/service.normalizer';

/**
 * Status de ordem da LATAM que são FINAIS. Só eles autorizam dizer `confirmed`.
 * `PENDING`/`IN_PROGRESS` são reserva viva, não falha — e não autorizam
 * re-reservar.
 */
const CONFIRMED_STATUSES = new Set(['CLOSED', 'CONFIRMED', 'TICKETED']);
const FAILED_STATUSES = new Set(['FAILED', 'REJECTED', 'CANCELLED']);

/**
 * 🔴 O cancelamento NÃO aparece no status da ordem: um bilhete anulado continua
 * com `Order/StatusCode: CLOSED`. Quem conta a verdade é o CUPOM — `VOID` ou
 * `REFUND`. Sem olhar aqui, o `/retrieve` publicava como confirmada uma
 * passagem que a companhia já tinha anulado.
 */
const VOIDED_COUPONS = new Set(['VOID', 'V', 'REFUND', 'REFUNDED']);

/** `<Amount CurCode="BRL">123</Amount>` → número + moeda. */
const amount = (node: XmlValue): { value: number | null; currency: string | null } => ({
  value: num(node),
  currency: attr(node, 'CurCode'),
});

/** O contrato só conhece `adult`/`child`/`infant`; a NDC fala PTC. */
const PTC_BY_AGE_GROUP: Record<string, string> = {
  adult: 'ADT', child: 'CHD', infant: 'INF',
};

/**
 * 🔴 `IdentityDocTypeCode` no Brasil é `I`, não `CPF`. A doc diz `CPF` e o
 * gateway responde `400300012 IdentityDocTypeCode value must be I for Brazil`.
 * Passaporte é `P`; o resto cai em `I`, que é o documento local.
 */
const DOC_TYPE_CODE: Record<string, string> = {
  PASSPORT: 'P', CPF: 'I', RG: 'I', RNE: 'I', RNM: 'I', MERCOSUR: 'I',
};

/**
 * Os nós de bilhete, venham de onde vierem.
 *
 * 🔴 A LATAM devolve `TicketDocInfo` em DOIS lugares e com DOIS nomes de campo:
 * solto na resposta (`Ticket/TicketNumber`, é o caso do pagamento e da leitura
 * da ordem) ou dentro de `DataLists/TicketDocInfoList` (`TicketDocNbr`). Ler só
 * o segundo, que é o que a amostra mostra, fazia o `/issue` devolver `[]` numa
 * emissão que tinha bilhete.
 */
function ticketNodes(payload: XmlValue): XmlValue[] {
  return [
    ...asList(child(payload, 'DataLists', 'TicketDocInfoList', 'TicketDocInfo')),
    ...asList(child(payload, 'TicketDocInfo')),
  ];
}

function couponStatus(node: XmlValue): string | null {
  const coupons = asList(child(node, 'Ticket', 'Coupon'));
  const statuses = coupons
    .map((coupon) => text(child(coupon, 'CouponStatusCode')))
    .filter((status): status is string => Boolean(status));

  return statuses[0] ?? null;
}

/**
 * Um `TicketDocInfo` no vocabulário do contrato.
 *
 * 🔴 `TicketDocTypeCode = J` é EMD, não bilhete de voo. Os dois têm ciclos de
 * vida diferentes — anular a passagem não anula a bagagem comprada — e o
 * contrato os publica em listas separadas justamente por isso.
 */
function normalizeTicket(node: XmlValue): ProviderTicket {
  const raw = couponStatus(node);
  const upper = (raw ?? '').toUpperCase();
  const typeCode = (text(child(node, 'TicketDocTypeCode')) ?? '').toUpperCase();

  const status: ProviderTicket['status'] = upper === ''
    ? null
    : VOIDED_COUPONS.has(upper)
      ? (upper.startsWith('REFUND') ? 'refunded' : 'voided')
      : 'issued';

  const value = amount(child(node, 'Ticket', 'TotalAmount') ?? child(node, 'TotalAmount'));

  return {
    ticketNumber: text(child(node, 'TicketDocNbr')) ?? text(child(node, 'Ticket', 'TicketNumber')),
    type: typeCode === 'J' ? 'other' : 'flight',
    passengerId: text(child(node, 'PaxRefID')),
    passengerName: null,
    status,
    providerStatus: raw,
    issueDate: text(child(node, 'IssueDate')) ?? text(child(node, 'Ticket', 'IssueDate')),
    amount: value.value === null
      ? null
      : { total: roundMoney(value.value) ?? value.value, currency: value.currency },
  };
}

const readTickets = (payload: XmlValue): ProviderTicket[] =>
  ticketNodes(payload).map(normalizeTicket).filter((ticket) => ticket.ticketNumber !== null);

function isVoided(payload: XmlValue): boolean {
  const coupons = ticketNodes(payload).flatMap((node) => asList(child(node, 'Ticket', 'Coupon')));
  if (coupons.length === 0) return false;

  // TODOS os cupons: um trecho anulado num bilhete de dois não cancela a viagem.
  return coupons.every((coupon) => VOIDED_COUPONS.has((text(child(coupon, 'CouponStatusCode')) ?? '').toUpperCase()));
}

/** Avisos crus da companhia — publicados como vieram, nunca reescritos. */
function readMessages(payload: XmlValue): string[] {
  return asList(child(payload, 'MarketingMessage'))
    .map((message) => text(child(message, 'Desc', 'DescText')))
    .filter((value): value is string => Boolean(value));
}

@Injectable()
export class LatamProvider implements FlightProvider {
  readonly name = LATAM;

  readonly supports = {
    // A NDC devolve penalidade estruturada, não o texto integral da tarifa que o
    // /fare-rules exige. Declarar `false` faz o contrato responder 501 — honesto
    // — em vez de inventar uma seção vazia.
    fareRules: false,
    retrieve: true,
    multicity: true,
    // OrderReshop calcula o reembolso, OrderCancel executa. As duas rotas existem.
    cancelBooking: true,
    // /seats/availability está no YAML publicado e responde pela oferta.
    seatMap: true,
    // /services/list, mesma forma do mapa de assentos.
    ancillaries: true,
    // /installments/options e /order/change/payment: a ordem nasce sem pagar.
    financingOptions: true,
    issue: true,
    sellAncillaries: true,
  };

  constructor(private readonly commands: LatamCommands) {}

  async probe(): Promise<ProviderProbe> {
    await this.commands.probeToken();
    return {
      // O OAuth2 é endpoint de autenticação dedicado: o token PROVA a credencial.
      method: 'auth',
      // Valida a credencial da INTEGRAÇÃO, não a que veio no corpo do ping —
      // credencial por request está fora do escopo.
      scope: 'connection',
    };
  }

  /**
   * Busca síncrona: um único lote, emitido assim que a LATAM responde.
   *
   * O generator existe para casar com a Travelfusion, que entrega em pedaços.
   * Aqui ele rende uma vez — e é justamente essa uniformidade que deixa o caso
   * de uso tratar os dois provedores sem saber qual é qual.
   */
  async *search(request: AvailabilityDto, context: RequestContext): AsyncGenerator<ProviderOffer[]> {
    const passengers = passengersOf(request);

    /**
     * 🔴 A cabine NÃO vai para o AirShopping, e isso é medido, não preferência:
     * com `PreferredCabinType C` a LATAM devolve 0 ofertas na mesma busca em
     * que, sem o filtro, devolve 424 — 12 delas business. Mandar o critério
     * para cima esconde oferta que existe.
     *
     * O filtro de cabine acontece na camada do contrato, que vê a tarifa já
     * normalizada e vale igual para os dois provedores.
     */
    const { payload } = await this.commands.airShopping(
      { legs: legsOf(request), passengers, cabin: null },
      context,
    );

    const passengerCount = Math.max(1, passengers.adults + passengers.children + passengers.infants);

    // A MESMA lista de PaxIDs que foi para o AirShopping entra na chave de cada
    // oferta: o OfferPrice exige recebê-la de volta, e o /quote só tem a chave.
    const paxIds = buildPaxList(passengers).map((pax) => pax.PaxID);

    yield normalizeAirShopping(payload, passengerCount, paxIds);
  }

  async quote(key: OfferKey, dto: QuoteDto, context: RequestContext): Promise<ProviderQuote> {
    const { payload } = await this.commands.offerPrice(key.r, key.i ?? null, key.x ?? [], context);

    const offer = asList(child(payload, 'PricedOffer', 'Offer'))[0]
      ?? asList(child(payload, 'OffersGroup', 'CarrierOffers', 'Offer'))[0]
      ?? child(payload, 'PricedOffer');

    const total = child(offer, 'TotalPrice');
    const value = amount(child(total, 'TotalAmount'));
    if (value.value === null) {
      throw new AppError('PRICING_ERROR', { metadata: { operation: 'quote' } });
    }

    const base = amount(child(total, 'BaseAmount'));
    const tax = amount(child(total, 'TaxSummary', 'TotalTaxAmount'));

    // A família confirmada pelo OfferPrice — é ela que vale, não a da busca.
    const priceClass = asList(child(payload, 'DataLists', 'PriceClassList', 'PriceClass'))[0];
    const familyText = asList(child(offer, 'OfferItem'))
      .flatMap((item) => asList(child(item, 'FareDetail')))
      .map((detail) => text(child(detail, 'FareRefText')))
      .find(Boolean) ?? null;

    return {
      /**
       * A LATAM tarifou e devolveu preço: a oferta existe. Recusa vem como erro
       * do gateway e vira 409 no catálogo — nunca um 200 com `available: false`.
       */
      available: true,
      familyCode: text(child(priceClass, 'Code')),
      family: text(child(priceClass, 'Name')) ?? familyText,
      price: {
        base: roundMoney(base.value ?? 0),
        // Escalar: a LATAM não discrimina imposto no tarifar, só soma.
        taxes: roundMoney(tax.value ?? 0),
        fees: 0,
        total: roundMoney(value.value),
        currency: value.currency ?? base.currency ?? 'BRL',
      },
      /**
       * A LATAM não devolve lista de parâmetros exigidos como a Travelfusion:
       * o que ela precisa está fixo no schema do OrderCreate (nome, nascimento,
       * documento, contato). Publicamos isso como requisito declarado, para que
       * quem consome saiba o que juntar antes de reservar.
       */
      requiredParameters: [
        { name: 'firstName', type: 'string', displayText: 'Nome', perPassenger: true, optional: false, options: [] },
        { name: 'lastName', type: 'string', displayText: 'Sobrenome', perPassenger: true, optional: false, options: [] },
        { name: 'birthDate', type: 'date', displayText: 'Data de nascimento', perPassenger: true, optional: false, options: [] },
        { name: 'document', type: 'string', displayText: 'Documento', perPassenger: true, optional: false, options: [] },
        { name: 'email', type: 'email', displayText: 'E-mail de contato', perPassenger: false, optional: false, options: [] },
        { name: 'phone', type: 'string', displayText: 'Telefone de contato', perPassenger: false, optional: false, options: [] },
      ],
    };
  }

  async book(key: OfferKey, dto: CreateBookingDto, context: RequestContext): Promise<ProviderBooking> {
    const email = dto.customer.email;
    const phone = dto.customer.phone;

    /**
     * 🔴 A LATAM EXIGE o contato: sem ele o OrderCreate volta
     * `912 ContactInfoList is null or empty`. E omitir só a referência para
     * fugir disso troca um erro por outro — vira
     * `cvc-identity-constraint.4.3: Key 'ContactInfoIDKeyRef13' not found`.
     *
     * Por isso a recusa acontece AQUI, antes da rede, com o campo que falta
     * nomeado — do mesmo jeito que a credencial em branco falha no client.
     */
    if (!email && !phone) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'createBooking' },
        details: { errors: { 'customer.email': ['Obrigatório: a LATAM exige contato para criar a ordem.'] } },
      });
    }

    const people = Object.entries(dto.people);
    if (people.length === 0) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'createBooking' },
        details: { errors: { people: ['Obrigatório: ao menos um passageiro.'] } },
      });
    }

    /**
     * 🔴 A ORDEM dos elementos é do XSD, não estética: `ContactInfoRefID`,
     * `IdentityDoc`, `Individual`, `PaxID`, `PTC` — e dentro do Individual,
     * `Birthdate` antes do nome. Fora dessa sequência a LATAM devolve
     * `cvc-complex-type.2.4.a` sem dizer qual campo está no lugar errado.
     *
     * 🔴 O PaxID é a CHAVE do mapa, não um contador nosso. A oferta foi tarifada
     * com uma lista específica de PaxIDs e o `SelectedOfferItem` referencia
     * exatamente ela — renumerar aqui produz `PaxIDKeyRef` não encontrada.
     */
    const paxList = people.map(([paxId, person]: [string, BookingPersonDto]) => {
      const ptc = PTC_BY_AGE_GROUP[person.ageGroup] ?? paxId.split('_')[0].toUpperCase();
      const document = person.document;

      return {
        ContactInfoRefID: `${paxId}_CNT`,
        IdentityDoc: document
          ? {
              IdentityDocID: document.number,
              IdentityDocTypeCode: DOC_TYPE_CODE[document.type.toUpperCase()] ?? 'I',
            }
          : undefined,
        Individual: {
          Birthdate: person.birthDate,
          GivenName: person.firstName,
          // Chave `IndividualIDKey` do XSD: sem ela a ordem é recusada.
          IndividualID: `IND_${paxId}`,
          Surname: person.lastName,
        },
        PaxID: paxId,
        PTC: ptc,
      };
    });

    /**
     * Um ContactInfo por PaxID, todos apontando para o mesmo contato da reserva.
     * E-mail e telefone são do nível da RESERVA (o /quote os declara com
     * `perPassenger: false`), mas a NDC quer um ContactInfo por passageiro.
     */
    const contacts = paxList.map((pax) => ({
      ContactInfoID: `${pax.PaxID}_CNT`,
      EmailAddress: email ? { EmailAddressText: email } : undefined,
      Phone: phone ? { ContactTypeText: 'MOBILE', PhoneNumber: phone.replace(/\D/g, '') } : undefined,
    }));

    const { payload } = await this.commands.orderCreate(key.r, key.i ?? null, paxList, contacts, context);
    return this.readOrder(payload, 'createBooking');
  }

  /**
   * Cancelar é DOIS passos na LATAM, e o primeiro não é opcional.
   *
   * 🔴 `OrderReshop` calcula quanto volta, e o `OrderCancel` exige esse valor em
   * `ExpectedRefundAmount`. É o jeito da companhia garantir que quem cancela
   * concorda com o reembolso — mandar um número inventado é pedir para a ordem
   * ser recusada, ou pior, aceita com um valor que ninguém conferiu.
   *
   * O reshop é read-only: se ele falhar, nada foi cancelado.
   */
  async cancelBooking(locator: string, context: RequestContext): Promise<ProviderCancellation> {
    /**
     * 🔴 `400107002 Invalid order current status` quer dizer DUAS coisas
     * opostas: "ainda não foi paga" e "já foi cancelada". A companhia usa o
     * mesmo código para as duas, e a diferença muda tudo para quem está na
     * tela — uma pede paciência, a outra diz que não há nada a fazer.
     *
     * Como o erro não distingue, PERGUNTAMOS. É uma chamada a mais só no
     * caminho de falha, e é o que evita o contrato afirmar o oposto do que
     * aconteceu.
     */
    const { payload: quote } = await this.commands.orderReshop(locator, context)
      .catch(async (error: unknown) => {
        if (await this.alreadyCancelled(locator, context)) {
          throw new AppError('BOOKING_ALREADY_CANCELLED', { metadata: { operation: 'cancelBooking' } });
        }
        throw error;
      });

    const refund = this.readRefund(quote);

    /**
     * 🔴 Existem DOIS cancelamentos, e a companhia é quem diz qual vale.
     *
     * Dentro da janela de arrependimento ela responde `Desc/DescText: VOID
     * permitted` e NÃO calcula reembolso — o bilhete é anulado, não devolvido.
     * Fora dela, calcula o valor e o cancelamento é reembolso.
     *
     * Tratar o primeiro caso como "sem valor de reembolso" fazia o
     * cancelamento parar justamente quando ele é mais simples.
     */
    const voidable = asList(child(quote, 'ReshopResults', 'ReshopOffers', 'Offer'))
      .some((offer) => (text(child(offer, 'Desc', 'DescText')) ?? '').toUpperCase().includes('VOID'));

    if (refund === null && !voidable) {
      /**
       * Sem valor não dá para seguir: o OrderCancel não aceita a mensagem sem
       * `ExpectedRefundAmount`, e chutar zero cancelaria abrindo mão do
       * reembolso. Melhor parar e devolver o motivo.
       */
      throw new AppError('PROVIDER_INTEGRATION_ERROR', {
        metadata: { operation: 'cancelBooking' },
        providerError: {
          provider: LATAM,
          operation: 'OrderReshop',
          providerCode: 'NO_REFUND_QUOTE',
          providerMessage: 'O OrderReshop não devolveu valor de reembolso; cancelamento não foi tentado.',
          providerSeverity: null,
          httpStatus: null,
        },
      });
    }

    const { payload } = await this.commands.orderCancel(locator, refund?.total ?? null, context);

    const status = (text(child(payload, 'Order', 'StatusCode'))
      ?? text(child(payload, 'Order', 'OrderStatusCode'))
      ?? '').toUpperCase();

    /**
     * 🔴 O VOID não devolve `StatusCode` nenhum: ele confirma em texto, num
     * `MarketingMessage` — `VOID completed successfully`. Sem ler isso, um
     * cancelamento que deu certo era publicado como "pendente", que é o
     * contrário do que aconteceu.
     *
     * A leitura é estrita de propósito: só `completed`/`success` contam. Um
     * texto que a companhia mude para outra coisa vira pendente, e pendente
     * manda consultar — nunca afirma o que não foi dito.
     */
    const message = (text(child(payload, 'OrderCancelProcessing', 'MarketingMessage', 'Desc', 'DescText')) ?? '')
      .toUpperCase();
    const voided = message.includes('COMPLETED') || message.includes('SUCCESS');

    /**
     * 🔴 No void o valor devolvido só aparece DEPOIS, na resposta do cancelamento
     * — o OrderReshop não calculou nada. A companhia declara
     * `PaymentStatusCode: REFUNDED` junto do `Amount`, e é esse número que vale
     * dizer a quem cancelou. Só publicamos com o status declarado: um `Amount`
     * sem `REFUNDED` é o que foi pago, não o que volta.
     */
    const payment = child(payload, 'TicketDocInfo', 'PaymentInfo');
    const refunded = (text(child(payment, 'PaymentStatusCode')) ?? '').toUpperCase() === 'REFUNDED'
      ? amount(child(payment, 'Amount'))
      : { value: null, currency: null };

    const declared = refund ?? (refunded.value === null
      ? null
      : { total: roundMoney(refunded.value) ?? refunded.value, currency: refunded.currency });

    const cancelled = FAILED_STATUSES.has(status) || voided;

    return {
      locator,
      // Só os status finais de falha significam cancelado de verdade.
      status: cancelled ? 'cancelled' : 'pending',
      /**
       * O EFEITO, que não é o status: quem anulou o bilhete não recebe dinheiro
       * de volta, e quem foi reembolsado não teve o documento anulado. Quem
       * atende o passageiro precisa dos dois para explicar o que aconteceu.
       */
      outcome: !cancelled
        ? 'UNKNOWN'
        : voidable || voided
          ? 'VOID'
          : declared !== null
            ? 'REFUND'
            : 'PROCESSED',
      rawStatus: status || message || null,
      /** `null` continua sendo resposta válida: a companhia pode não declarar valor. */
      refund: declared,
      /**
       * 🔴 Só o CUPOM prova que um e-ticket foi anulado. O `OrderCancelRS` de
       * sucesso não diz nada sobre documento, e publicar `true` a partir dele
       * afirmaria uma anulação que ninguém confirmou.
       */
      eticketsCancelled: isVoided(payload),
      tickets: readTickets(payload),
    };
  }

  /** O reembolso vem como `PriceDifferential` de tipo `Refund` no ReshopRS. */
  private readRefund(payload: XmlValue): { total: number; currency: string | null } | null {
    const offers = asList(child(payload, 'ReshopResults', 'ReshopOffers', 'Offer'));

    for (const offer of offers) {
      for (const item of asList(child(offer, 'DeleteOrderItem'))) {
        const differential = child(item, 'PriceDifferential');
        if ((text(child(differential, 'DifferentialTypeCode')) ?? '').toLowerCase() !== 'refund') continue;

        /**
         * O valor do reembolso aparece em TRÊS lugares diferentes conforme a
         * resposta, e é por isso que os três são tentados em ordem.
         *
         * 🔴 O que o sandbox devolve de verdade numa ordem PAGA é o terceiro:
         * `PriceDifferential/GrandTotalAmount`, irmão do `DiffPrice` — que ali
         * só traz o `Surcharge/Breakdown`. Procurar só dentro do `DiffPrice`,
         * como a amostra sugere, fazia o cancelamento parar com "sem valor de
         * reembolso" numa resposta que trazia o valor.
         */
        const nested = amount(child(differential, 'DiffPrice', 'Price', 'TotalAmount'));
        const flat = nested.value !== null
          ? nested
          : amount(child(differential, 'DiffPrice', 'TotalAmount'));
        const money = flat.value !== null
          ? flat
          : amount(child(differential, 'GrandTotalAmount'));

        const total = money.value;
        if (total !== null) return { total: roundMoney(total) ?? total, currency: money.currency };
      }
    }

    return null;
  }

  /**
   * Mapa de assentos da oferta.
   *
   * 🔴 Endereçado pela OFERTA, não pelo localizador: na LATAM a escolha de
   * assento é anterior à reserva. Os PaxIDs vêm da chave, pelo mesmo motivo do
   * OfferPrice — a companhia devolve o mapa por passageiro.
   */
  async seatMap(key: OfferKey, context: RequestContext): Promise<ProviderSeatMap> {
    /**
     * 🔴 Aqui o `OfferID` é o `SEI|…` do ITEM, não o UUID da oferta — a amostra
     * do portal usa esse formato e o gateway confirma: com o UUID ele responde
     * `911 Public flight offer not found in cache by id <uuid>`. É a mesma
     * palavra (`OfferID`) valendo coisas diferentes em duas mensagens.
     */
    const offerId = key.i ?? key.r;
    const { payload } = await this.commands.seatAvailability({ offerId }, key.x ?? [], context);
    return normalizeSeatMap(payload);
  }

  /** Opcionais da oferta. Mesmo endereçamento do mapa: pelo item, não pelo UUID. */
  async ancillaries(key: OfferKey, context: RequestContext): Promise<ProviderAncillaryCatalog> {
    const { payload } = await this.commands.serviceList({ offerId: key.i ?? key.r }, key.x ?? [], context);
    return normalizeServiceList(payload);
  }

  /**
   * Os mesmos catálogos, agora sobre a reserva emitida.
   *
   * 🔴 Os ids que voltam daqui (`SEAT_…`/`BAG_…`) NÃO são os mesmos do catálogo
   * por oferta (`SEI|…`), e só eles servem para comprar depois da emissão.
   * Trocar um pelo outro é o que fazia a LATAM responder `INVALID_OFFER_TYPES`.
   */
  async seatMapForOrder(locator: string, context: RequestContext): Promise<ProviderSeatMap> {
    const paxIds = await this.paxIdsOf(locator, context);
    const { payload } = await this.commands.seatAvailability({ orderId: locator }, paxIds, context);
    return normalizeSeatMap(payload);
  }

  async ancillariesForOrder(locator: string, context: RequestContext): Promise<ProviderAncillaryCatalog> {
    const paxIds = await this.paxIdsOf(locator, context);
    const { payload } = await this.commands.serviceList({ orderId: locator }, paxIds, context);
    return normalizeServiceList(payload);
  }

  /**
   * Comprar assento e/ou bagagem numa reserva já emitida.
   *
   * Total zero é caso real — assento cortesia — e aí a cobrança vai por BSP em
   * vez de cartão, que é o que a própria amostra da LATAM faz.
   */
  async sellAncillaries(
    locator: string,
    request: ProviderAncillaryPurchase,
    context: RequestContext,
  ): Promise<ProviderAncillaryPurchaseResult> {
    const payment = request.card && request.payer
      ? ({ method: 'card', card: request.card, payer: request.payer } as const)
      : ({ method: 'cash' } as const);

    const { payload } = await this.commands.orderChangeAddAncillaries(
      locator,
      request.items,
      request.amount,
      payment,
      context,
    );

    const order = child(payload, 'Order') ?? payload;
    const status = (text(child(order, 'StatusCode')) ?? '').toUpperCase();
    const emdByPax = new Map(
      readTickets(payload).map((ticket) => [ticket.passengerId ?? '', ticket.ticketNumber]),
    );

    /**
     * Os serviços recém-confirmados vêm espalhados pelos `OrderItem`; o que
     * interessa devolver é o que o passageiro vê: o quê, de quem, onde.
     */
    const services = asList(child(order, 'OrderItem')).flatMap((item) =>
      asList(child(item, 'Service')).map((service) => {
        const seat = child(service, 'OrderServiceAssociation', 'SeatOnLeg', 'Seat');
        const row = text(child(seat, 'RowNumber'));
        const column = text(child(seat, 'ColumnID'));
        const raw = text(child(service, 'StatusCode'));
        const paxId = text(child(service, 'PaxRefID'));
        const emdNumber = paxId ? emdByPax.get(paxId) ?? null : null;

        return {
          offerItemId: text(child(service, 'OfferItemRefID')) ?? null,
          serviceId: text(child(service, 'ServiceID')) ?? null,
          name: text(child(service, 'OrderServiceAssociation', 'ServiceDefinitionRef', 'ServiceDefinitionRefID')) ?? null,
          paxId,
          segmentId: text(child(service, 'OrderServiceAssociation', 'ServiceDefinitionRef', 'PaxSegmentRefID')) ?? null,
          seat: row && column ? `${row}${column}` : null,
          /**
           * 🔴 `booked` ≠ `issued`: o serviço confirmado na ordem ainda não tem
           * EMD. Quem vê `issued` sem número de documento está lendo uma
           * promessa como se fosse o bilhete.
           */
          status: emdNumber
            ? ('issued' as const)
            : (raw ?? '').toUpperCase() === 'CONFIRMED'
              ? ('booked' as const)
              : raw
                ? ('failed' as const)
                : null,
          providerStatus: raw,
          emdNumber,
          message: null,
        };
      }),
    );

    const total = num(child(order, 'TotalPrice', 'TotalAmount'));
    const confirmedStatus = CONFIRMED_STATUSES.has(status) || status === 'OPENED';

    return {
      locator,
      // A companhia respondeu sem erro: aceitou e gravou.
      committed: true,
      /**
       * 🔴 A PROVA é o serviço aparecer na resposta. Status "ok" sem nenhum
       * serviço de volta não confirma nada — e `null` diz exatamente isso, em
       * vez de deduzir sucesso do `committed`.
       */
      confirmed: services.length > 0 ? confirmedStatus : null,
      rawStatus: status || null,
      services,
      total: total === null
        ? null
        : { total, currency: attr(child(order, 'TotalPrice', 'TotalAmount'), 'CurCode') },
    };
  }

  /** O bilhete já está anulado? Só o cupom responde — ver `isVoided`. */
  private async alreadyCancelled(locator: string, context: RequestContext): Promise<boolean> {
    try {
      const { payload } = await this.commands.orderRetrieve(locator, context);
      return isVoided(payload);
    } catch {
      // Não deu para perguntar: seguimos com o erro original, que é o que sabemos.
      return false;
    }
  }

  /**
   * Os catálogos por ordem exigem a lista de passageiros, e ela não vem no
   * corpo do pedido — está na própria reserva. Perguntar é mais barato que
   * fazer quem chama repetir dado que a companhia já tem.
   */
  private async paxIdsOf(locator: string, context: RequestContext): Promise<string[]> {
    const { payload } = await this.commands.orderRetrieve(locator, context);
    const ids = asList(child(payload, 'DataLists', 'PaxList', 'Pax'))
      .map((pax) => text(child(pax, 'PaxID')))
      .filter((id): id is string => Boolean(id));

    return ids.length > 0 ? ids : ['ADT_1'];
  }

  /**
   * As parcelas que o cartão aceita para esta ordem.
   *
   * 🔴 A resposta NÃO é NDC: `<InstallmentOptionsRS>` na raiz, sem `<Response>`
   * dentro — por isso o payload é lido direto, sem descer um nível.
   */
  async financingOptions(locator: string, pan: string, context: RequestContext): Promise<ProviderFinancing> {
    const { parsed } = await this.commands.installmentOptions(pan, locator, context);
    const root = (Object.values(parsed)[0] ?? {}) as XmlValue;

    return {
      cardBrand: text(child(root, 'CardCode')),
      currency: text(child(root, 'Currency')),
      options: asList(child(root, 'InstallmentOptions'))
        .map((option) => ({
          id: text(child(option, 'InstallmentId')) ?? '',
          installments: num(child(option, 'NumberOfInstallments')) ?? 0,
          installmentAmount: num(child(option, 'InstallmentAmount')),
          total: num(child(option, 'TotalPaymentAmount')),
          interestRate: num(child(option, 'InterestRate')),
          promotional: text(child(option, 'PromotionalInd')) === 'true',
        }))
        // Opção sem id não serve: é ele que volta no pagamento, como TrxID.
        .filter((option) => option.id !== ''),
    };
  }

  /**
   * Pagar a reserva.
   *
   * 🔴 Mutação NÃO idempotente, e a mais cara de errar: o client força
   * `retries: 0` porque repetir aqui cobra duas vezes. Se a resposta se perder,
   * o caminho é o `/retrieve` — nunca pagar de novo.
   */
  async issue(locator: string, payment: ProviderPayment, context: RequestContext): Promise<ProviderIssue> {
    const { payload } = await this.commands.orderChangePayment(
      locator,
      payment.amount,
      payment.card,
      payment.billing,
      payment.payer,
      payment.installmentId,
      context,
    );

    const order = child(payload, 'Order') ?? payload;
    const status = (text(child(order, 'StatusCode')) ?? '').toUpperCase();
    const documents = readTickets(payload);

    // Bilhete de voo e EMD em listas separadas — ciclos de vida diferentes.
    const tickets = documents.filter((document) => document.type === 'flight');
    const emds = documents.filter((document) => document.type !== 'flight');
    const final = CONFIRMED_STATUSES.has(status);

    return {
      locator,
      committed: true,
      /**
       * 🔴 A prova de emissão é o NÚMERO DO BILHETE, não o status.
       *
       * `true` com documento na mão; `false` quando a ordem fechou e nenhum
       * documento veio — procuramos a prova e ela não estava lá; `null`
       * enquanto a companhia não fechou, porque aí a prova ainda não existe.
       */
      confirmed: tickets.length > 0 ? true : (final ? false : null),
      queued: !final,
      rawStatus: status || null,
      authorizationCode: text(child(payload, 'PaymentFunctions', 'PaymentProcessingDetails', 'AuthorizationCode')),
      tickets,
      emds,
      messages: readMessages(payload),
    };
  }

  async retrieve(locator: string, context: RequestContext): Promise<ProviderRetrieval> {
    const { payload } = await this.commands.orderRetrieve(locator, context);
    const order = child(payload, 'Order') ?? child(payload, 'OrderViewRS', 'Order') ?? payload;
    const status = (text(child(order, 'StatusCode')) ?? text(child(order, 'OrderStatusCode')) ?? '').toUpperCase();

    if (!status) {
      throw new AppError('RESOURCE_NOT_FOUND', { metadata: { operation: 'retrieve' } });
    }

    /**
     * 🔴 O cupom tem PRECEDÊNCIA sobre o status da ordem. A LATAM mantém
     * `CLOSED` num bilhete anulado — do ponto de vista dela a ordem existe e
     * está fechada —, mas quem comprou não vai voar. Publicar `confirmed` aí
     * seria dizer que a viagem está de pé.
     */
    const voided = isVoided(payload);

    /**
     * A tarifa da ordem vive no `OrderItem`, não no segmento. Numa tarifa de
     * PACOTE — que é o caso dos dois provedores — ela cobre a viagem inteira,
     * então o mesmo par vale para todos os trechos. Publicar por segmento um
     * dado que a companhia deu por ordem seria inventar granularidade.
     */
    const component = asList(child(order, 'OrderItem'))
      .flatMap((item) => asList(child(item, 'FareDetail')))
      .flatMap((detail) => asList(child(detail, 'FareComponent')))
      .find((entry) => entry !== undefined);

    const fareBasis = text(child(component, 'FareBasisCode'));
    const bookingClass = text(child(component, 'RBD', 'RBD_Code'));

    return {
      status: voided
        ? 'cancelled'
        : CONFIRMED_STATUSES.has(status)
          ? 'confirmed'
          : FAILED_STATUSES.has(status)
            ? 'cancelled'
            : 'pending',
      rawStatus: voided ? `${status} (cupom anulado)` : status,
      locator,
      supplierConfirmation: text(child(order, 'BookingRef', 'ID')) ?? text(child(order, 'BookingRefID')),
      // A LATAM é a própria companhia: não há um fornecedor atrás dela.
      supplierName: text(child(order, 'OwnerCode')) ?? 'LA',
      currency: attr(child(order, 'TotalPrice', 'TotalAmount'), 'CurCode'),
      createdAt: text(child(order, 'CreateDateTime')),
      /**
       * Prazo de pagamento: depois disso a companhia cancela sozinha.
       *
       * 🔴 Ele NÃO fica no `Order` — vive dentro do `OrderItem`, um por item.
       * Procurar só no nível de cima devolvia `null` numa ordem que tinha o
       * prazo declarado. O menor manda: é o primeiro que expira.
       */
      expiresAt: asList(child(order, 'OrderItem'))
        .map((item) => text(child(item, 'PaymentTimeLimitDateTime')))
        .filter((value): value is string => Boolean(value))
        .sort()[0]
        ?? text(child(order, 'PaymentTimeLimitDateTime'))
        ?? text(child(order, 'TimeLimitDateTime')),
      confirmationAt: text(child(order, 'CreateDateTime')),
      people: asList(child(payload, 'DataLists', 'PaxList', 'Pax')).map((pax) => ({
        id: text(child(pax, 'PaxID')),
        firstName: text(child(pax, 'Individual', 'GivenName')),
        lastName: text(child(pax, 'Individual', 'Surname')),
        email: text(child(pax, 'ContactInfo', 'EmailAddress', 'EmailAddressText')),
        nationality: text(child(pax, 'Individual', 'CitizenshipCountryCode')),
        documentNumber: text(child(pax, 'IdentityDoc', 'IdentityDocID')),
        dateOfBirth: text(child(pax, 'Birthdate')) ?? text(child(pax, 'Individual', 'Birthdate')),
        type: text(child(pax, 'PTC')),
      })),
      /**
       * 🔴 O `OrderRetrieve` da LATAM devolve o itinerário INTEIRO, e isso
       * estava sendo descartado: o contrato dizia `segments: null` porque foi
       * escrito quando só existia a Travelfusion, cujo `CheckBooking` de fato
       * não traz trecho nenhum.
       */
      segments: asList(child(payload, 'DataLists', 'PaxSegmentList', 'PaxSegment')).map((segment) => ({
        segmentId: text(child(segment, 'PaxSegmentID')),
        origin: text(child(segment, 'Dep', 'IATA_LocationCode')),
        destination: text(child(segment, 'Arrival', 'IATA_LocationCode')),
        departure: text(child(segment, 'Dep', 'AircraftScheduledDateTime')),
        arrival: text(child(segment, 'Arrival', 'AircraftScheduledDateTime')),
        // 🔴 Convertido AQUI: o contrato publica minutos, não `PT4H5M`. Deixar o
        // ISO passar obrigava cada tela a escrever o seu próprio parser.
        duration: durationFromIso(text(child(segment, 'Duration'))) ?? 0,
        company: {
          code: text(child(segment, 'MarketingCarrierInfo', 'CarrierDesigCode')),
          number: text(child(segment, 'MarketingCarrierInfo', 'MarketingCarrierFlightNumberText')),
        },
        cabin: text(child(segment, 'CabinType', 'CabinTypeName')),
        aircraft: text(child(segment, 'DatedOperatingLeg', 'CarrierAircraftType', 'CarrierAircraftTypeCode')),
        fareBasis,
        bookingClass,
      })),
      /**
       * 🔴 O `PaxJourneyList` diz quais segmentos formam cada perna, e estava
       * sendo descartado. Sem ele o contrato adivinhava ida e volta pela
       * CONTAGEM de segmentos — o que transforma uma conexão GRU→GRU→SCL em
       * "ida e volta" e faz a terceira perna de um multidestino sumir.
       */
      journeys: asList(child(payload, 'DataLists', 'PaxJourneyList', 'PaxJourney'))
        .map((journey) => ({
          id: text(child(journey, 'PaxJourneyID')) ?? '',
          segmentIds: asList(child(journey, 'PaxSegmentRefID'))
            .map((ref) => text(ref))
            .filter((ref): ref is string => ref !== null),
        }))
        .filter((journey) => journey.segmentIds.length > 0),
      total: num(child(order, 'TotalPrice', 'TotalAmount')),
      tickets: readTickets(payload),
    };
  }

  async fareRules(): Promise<FareRuleSection[]> {
    // Coerente com `supports.fareRules: false` — o caso de uso já barra antes,
    // e este lance é a rede de segurança.
    throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'fareRules' } });
  }

  /** `OrderViewRS` → resultado canônico de reserva. */
  private readOrder(payload: XmlValue, operation: string): ProviderBooking {
    const order = child(payload, 'Order') ?? child(payload, 'OrderViewRS', 'Order') ?? payload;
    const orderId = text(child(order, 'OrderID'));
    const status = (text(child(order, 'StatusCode')) ?? text(child(order, 'OrderStatusCode')) ?? 'PENDING').toUpperCase();

    if (FAILED_STATUSES.has(status)) {
      throw new AppError('BUSINESS_RULE_VIOLATION', { metadata: { operation } });
    }

    const passengers: ProviderPassenger[] = asList(child(payload, 'DataLists', 'PaxList', 'Pax')).map((pax) => ({
      id: text(child(pax, 'PaxID')) ?? '',
      type: text(child(pax, 'PTC')),
      firstName: text(child(pax, 'Individual', 'GivenName')),
      lastName: text(child(pax, 'Individual', 'Surname')),
    }));

    return {
      // O localizador que o passageiro usa é o PNR, quando a LATAM o devolve.
      locator: text(child(order, 'BookingRef', 'ID')) ?? text(child(order, 'BookingRefID')) ?? orderId,
      committed: true,
      // 🔴 Nunca deduzido de `committed`: só status final de sucesso confirma.
      confirmed: CONFIRMED_STATUSES.has(status),
      status,
      currency: attr(child(order, 'TotalPrice', 'TotalAmount'), 'CurCode'),
      passengers,
    };
  }
}
