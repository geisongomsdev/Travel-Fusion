import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { roundMoney } from '../../../common/utils/money';
import { passengerTypeCode } from '../../../common/utils/age';
import { OfferKey } from '../../../common/utils/offer-key';
import { LATAM } from '../../../config/env';
import { AvailabilityDto } from '../../flight/dto/availability.dto';
import { CreateBookingDto, FareRulesDto, QuoteDto } from '../../flight/dto/booking.dto';
import {
  FareRuleSection, FlightProvider, ProviderBooking, ProviderOffer, ProviderProbe, ProviderQuote,
  ProviderRetrieval, RequestContext,
} from '../provider.types';
import { asList, attr, child, num, text, XmlValue } from '../../../common/xml/xml.util';
import { buildPaxList, LatamCommands } from './latam.commands';
import { normalizeAirShopping } from './normalizers/offer.normalizer';

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

    const { payload } = await this.commands.airShopping(
      { legs: request.legs, passengers, cabin: request.options?.class ?? null },
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
      // Prazo do time limit: depois disso a companhia cancela sozinha.
      expiresAt: text(child(order, 'PaymentTimeLimitDateTime')) ?? text(child(order, 'TimeLimitDateTime')),
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
