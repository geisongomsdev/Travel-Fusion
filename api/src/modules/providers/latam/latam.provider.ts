import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { roundMoney } from '../../../common/utils/money';
import { passengerTypeCode } from '../../../common/utils/age';
import { OfferKey } from '../../../common/utils/offer-key';
import { LATAM } from '../../../config/env';
import { AvailabilityDto } from '../../flight/dto/availability.dto';
import { CreateBookingDto, QuoteDto } from '../../flight/dto/booking.dto';
import {
  FareRuleSection, FlightProvider, ProviderBooking, ProviderOffer, ProviderProbe, ProviderQuote,
  ProviderAncillary,
  ProviderAncillaryPurchase,
  ProviderAncillaryPurchaseResult, ProviderCancellation, ProviderFinancing, ProviderIssue, ProviderPayment,
  ProviderRetrieval, ProviderSeatMap, RequestContext,
} from '../provider.types';
import { asList, attr, child, num, text, XmlValue } from '../../../common/xml/xml.util';
import { buildPaxList, LatamCommands } from './latam.commands';
import { normalizeAirShopping } from './normalizers/offer.normalizer';
import { normalizeSeatMap } from './normalizers/seat.normalizer';
import { normalizeServiceList } from './normalizers/service.normalizer';

/**
 * Status de ordem da LATAM que são FINAIS. Só eles autorizam dizer `confirmed`.
 * `PENDING`/`IN_PROGRESS` são reserva viva, não falha — e não autorizam
 * re-reservar (01-convencoes.md §7).
 */
const CONFIRMED_STATUSES = new Set(['CLOSED', 'CONFIRMED', 'TICKETED']);
const FAILED_STATUSES = new Set(['FAILED', 'REJECTED', 'CANCELLED']);

/** `<Amount CurCode="BRL">123</Amount>` → número + moeda. */
const amount = (node: XmlValue): { value: number | null; currency: string | null } => ({
  value: num(node),
  currency: attr(node, 'CurCode'),
});

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
      // Como na Travelfusion: valida a credencial da INTEGRAÇÃO, não a que veio
      // no corpo do ping — credencial por request está fora do escopo.
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
    const passengers = {
      adults: request.passengers.adults,
      children: request.passengers.children ?? 0,
      babies: request.passengers.babies ?? 0,
    };

    /**
     * 🔴 A cabine NÃO vai para o AirShopping, e isso é medido, não preferência:
     * com `PreferredCabinType C` a LATAM devolve 0 ofertas na mesma busca em
     * que, sem o filtro, devolve 424 — 12 delas business. Mandar o critério
     * para cima esconde oferta que existe.
     *
     * O filtro de cabine acontece na camada do contrato
     * (`AvailabilityService.applyOptionFilters`), que vê a tarifa já normalizada
     * e vale igual para os dois provedores.
     */
    const { payload } = await this.commands.airShopping(
      { legs: request.legs, passengers, cabin: null },
      context,
    );

    const passengerCount = Math.max(1, passengers.adults + passengers.children + passengers.babies);

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

    return {
      price: {
        base: roundMoney(base.value ?? 0),
        taxes: { boarding: roundMoney(tax.value ?? 0), service: 0, fuel: 0, baggage: 0 },
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
        { name: 'dateOfBirth', type: 'date', displayText: 'Data de nascimento', perPassenger: true, optional: false, options: [] },
        { name: 'documentNumber', type: 'string', displayText: 'Documento', perPassenger: true, optional: false, options: [] },
        { name: 'email', type: 'email', displayText: 'E-mail de contato', perPassenger: false, optional: false, options: [] },
        { name: 'phone', type: 'string', displayText: 'Telefone de contato', perPassenger: false, optional: false, options: [] },
      ],
    };
  }

  async book(key: OfferKey, dto: CreateBookingDto, context: RequestContext): Promise<ProviderBooking> {
    // 🔴 O PTC sai da idade na data do VOO, nao de um campo que o cliente manda:
    // a LATAM recusa a ordem quando o PTC nao bate com o Birthdate, e a oferta ja
    // foi tarifada com uma contagem especifica de ADT/CHD/INF.
    const referenceDate = dto.referenceDate ?? new Date().toISOString();
    const counters: Record<string, number> = { ADT: 0, CHD: 0, INF: 0 };

    /**
     * E-mail e telefone são CSPs do nível da RESERVA (o /quote os declara com
     * `perPassenger: false`), mas a NDC quer um ContactInfo por passageiro —
     * então o mesmo contato é replicado, um por PaxID.
     *
     * 🔴 A LATAM EXIGE o contato: sem ele o OrderCreate volta
     * `912 ContactInfoList is null or empty`. E omitir só a referência para
     * fugir disso troca um erro por outro — vira
     * `cvc-identity-constraint.4.3: Key 'ContactInfoIDKeyRef13' not found`.
     * Os dois são a mesma coisa dita de dois jeitos: contato é obrigatório.
     *
     * Por isso a recusa acontece AQUI, antes da rede, com o campo que falta
     * nomeado — do mesmo jeito que a credencial em branco falha no client.
     */
    const email = dto.customParameters?.email;
    const phone = dto.customParameters?.phone;

    if (!email && !phone) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'createBooking' },
        details: {
          errors: {
            'customParameters.email': ['Obrigatório: a LATAM exige contato para criar a ordem.'],
            'customParameters.phone': ['Obrigatório: a LATAM exige contato para criar a ordem.'],
          },
        },
      });
    }

    /**
     * 🔴 A ORDEM dos elementos é do XSD, não estética: `ContactInfoRefID`,
     * `IdentityDoc`, `Individual`, `PaxID`, `PTC` — e dentro do Individual,
     * `Birthdate` antes do nome. Fora dessa sequência a LATAM devolve
     * `cvc-complex-type.2.4.a` sem dizer qual campo está no lugar errado.
     */
    const paxList = dto.passengers.map((passenger) => {
      const ptc = passengerTypeCode(passenger.dateOfBirth, referenceDate);
      counters[ptc] += 1;
      const paxId = `${ptc}_${counters[ptc]}`;
      const document = passenger.customParameters?.documentNumber;

      return {
        ContactInfoRefID: `${paxId}_CNT`,
        IdentityDoc: document
          ? { IdentityDocID: document, IdentityDocTypeCode: 'P' }
          : undefined,
        Individual: {
          Birthdate: passenger.dateOfBirth,
          GivenName: passenger.firstName,
          // Chave `IndividualIDKey` do XSD: sem ela a ordem é recusada.
          IndividualID: `IND_${paxId}`,
          Surname: passenger.lastName,
        },
        PaxID: paxId,
        PTC: ptc,
      };
    });

    // Um ContactInfo por PaxID, todos apontando para o mesmo contato da reserva.
    const contacts = paxList.map((pax) => ({
      ContactInfoID: `${pax.PaxID}_CNT`,
      EmailAddress: email ? { EmailAddressText: email } : undefined,
      Phone: phone
        ? { ContactTypeText: 'MOBILE', PhoneNumber: phone.replace(/\D/g, '') }
        : undefined,
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
    const { payload: quote } = await this.commands.orderReshop(locator, context);

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

    return {
      locator,
      // Só os status finais de falha significam cancelado de verdade.
      status: FAILED_STATUSES.has(status) ? 'cancelled' : 'pending',
      rawStatus: status || null,
      /**
       * `null` no void é DELIBERADO: a companhia anulou o bilhete sem declarar
       * valor, e publicar o total pago como se fosse reembolso confirmado seria
       * afirmar o que ela não afirmou.
       */
      refund,
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
         * só traz o `Surcharge/Breakdown` (tarifa, taxa de embarque,
         * opcionais). Procurar só dentro do `DiffPrice`, como a amostra sugere,
         * fazia o cancelamento parar com "sem valor de reembolso" numa resposta
         * que trazia o valor.
         */
        const nested = amount(child(differential, 'DiffPrice', 'Price', 'TotalAmount'));
        const flat = nested.value !== null
          ? nested
          : amount(child(differential, 'DiffPrice', 'TotalAmount'));
        const money = flat.value !== null
          ? flat
          : amount(child(differential, 'GrandTotalAmount'));

        // `roundMoney` devolve `null` para valor não-finito; aqui já sabemos que
        // é número, então o fallback é o próprio valor, nunca um zero inventado.
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
  async ancillaries(key: OfferKey, context: RequestContext): Promise<ProviderAncillary[]> {
    const { payload } = await this.commands.serviceList({ offerId: key.i ?? key.r }, key.x ?? [], context);
    return normalizeServiceList(payload);
  }

  /**
   * Os mesmos catálogos, agora sobre a reserva emitida.
   *
   * 🔴 Os `offerItemId` que voltam daqui (`SEAT_…`/`BAG_…`) NÃO são os mesmos
   * do catálogo por oferta (`SEI|…`), e só eles servem para comprar depois da
   * emissão. Trocar um pelo outro é o que fazia a LATAM responder
   * `INVALID_OFFER_TYPES`.
   */
  async seatMapForOrder(locator: string, context: RequestContext): Promise<ProviderSeatMap> {
    const paxIds = await this.paxIdsOf(locator, context);
    const { payload } = await this.commands.seatAvailability({ orderId: locator }, paxIds, context);
    return normalizeSeatMap(payload);
  }

  async ancillariesForOrder(locator: string, context: RequestContext): Promise<ProviderAncillary[]> {
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

    /**
     * Os serviços recém-confirmados vêm espalhados pelos `OrderItem`; o que
     * interessa devolver é o que o passageiro vê: o quê, de quem, onde.
     */
    const services = asList(child(order, 'OrderItem')).flatMap((item) =>
      asList(child(item, 'Service')).map((service) => {
        const seat = child(service, 'OrderServiceAssociation', 'SeatOnLeg', 'Seat');
        const row = text(child(seat, 'RowNumber'));
        const column = text(child(seat, 'ColumnID'));

        return {
          serviceId: text(child(service, 'ServiceID')) ?? null,
          name: text(child(service, 'OrderServiceAssociation', 'ServiceDefinitionRef', 'ServiceDefinitionRefID')) ?? null,
          paxId: text(child(service, 'PaxRefID')) ?? null,
          segmentId: text(child(service, 'OrderServiceAssociation', 'ServiceDefinitionRef', 'PaxSegmentRefID')) ?? null,
          seat: row && column ? `${row}${column}` : null,
          status: text(child(service, 'StatusCode')) ?? null,
        };
      }),
    );

    const total = num(child(order, 'TotalPrice', 'TotalAmount'));

    return {
      locator,
      status: CONFIRMED_STATUSES.has(status) || status === 'OPENED' ? 'confirmed' : 'pending',
      rawStatus: status || null,
      services,
      total: total === null
        ? null
        : { total, currency: attr(child(order, 'TotalPrice', 'TotalAmount'), 'CurCode') },
    };
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
  async financingOptions(
    locator: string,
    pan: string,
    context: RequestContext,
  ): Promise<ProviderFinancing> {
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

    return {
      locator,
      // Emitido é status FINAL. `OPENED` continua pendente, mesmo com o pagamento aceito.
      status: CONFIRMED_STATUSES.has(status) ? 'issued' : 'pending',
      rawStatus: status || null,
      // Os bilhetes aparecem na ordem depois da emissão; antes disso, `[]`.
      tickets: asList(child(payload, 'DataLists', 'TicketDocInfoList', 'TicketDocInfo'))
        .map((ticket) => text(child(ticket, 'TicketDocNbr')))
        .filter((number): number is string => Boolean(number)),
    };
  }

  async retrieve(locator: string, context: RequestContext): Promise<ProviderRetrieval> {
    const { payload } = await this.commands.orderRetrieve(locator, context);
    const order = child(payload, 'Order') ?? child(payload, 'OrderViewRS', 'Order') ?? payload;
    const status = (text(child(order, 'StatusCode')) ?? text(child(order, 'OrderStatusCode')) ?? '').toUpperCase();

    if (!status) {
      throw new AppError('RESOURCE_NOT_FOUND', { metadata: { operation: 'retrieve' } });
    }

    return {
      status: CONFIRMED_STATUSES.has(status)
        ? 'confirmed'
        : FAILED_STATUSES.has(status)
          ? 'cancelled'
          : 'pending',
      rawStatus: status,
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
       * não traz trecho nenhum. Aqui os dados existem — voo, horários, duração
       * e aeronave — e são o que a pessoa quer ver depois de reservar.
       */
      segments: asList(child(payload, 'DataLists', 'PaxSegmentList', 'PaxSegment')).map((segment) => ({
        segmentId: text(child(segment, 'PaxSegmentID')),
        origin: text(child(segment, 'Dep', 'IATA_LocationCode')),
        destination: text(child(segment, 'Arrival', 'IATA_LocationCode')),
        departure: text(child(segment, 'Dep', 'AircraftScheduledDateTime')),
        arrival: text(child(segment, 'Arrival', 'AircraftScheduledDateTime')),
        duration: text(child(segment, 'Duration')),
        company: {
          code: text(child(segment, 'MarketingCarrierInfo', 'CarrierDesigCode')),
          number: text(child(segment, 'MarketingCarrierInfo', 'MarketingCarrierFlightNumberText')),
        },
        cabin: text(child(segment, 'CabinType', 'CabinTypeName')),
        aircraft: text(
          child(segment, 'DatedOperatingLeg', 'CarrierAircraftType', 'CarrierAircraftTypeCode'),
        ),
      })),
      total: num(child(order, 'TotalPrice', 'TotalAmount')),
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

    return {
      // O localizador que o passageiro usa é o PNR, quando a LATAM o devolve.
      locator: text(child(order, 'BookingRef', 'ID')) ?? text(child(order, 'BookingRefID')) ?? orderId,
      committed: true,
      // 🔴 Nunca deduzido de `committed`: só status final de sucesso confirma.
      confirmed: CONFIRMED_STATUSES.has(status),
      status,
    };
  }
}
