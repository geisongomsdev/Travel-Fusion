import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { roundMoney } from '../../../common/utils/money';
import { ageOnFlightDate } from '../../../common/utils/age';
import { OfferKey } from '../../../common/utils/offer-key';
import { env, PROVIDER } from '../../../config/env';
import { AvailabilityDto, legsOf, passengersOf } from '../../flight/dto/availability.dto';
import { BookingPersonDto, CreateBookingDto, FareRulesDto, QuoteDto } from '../../flight/dto/booking.dto';
import {
  FareRuleSection, FlightProvider, ProviderBooking, ProviderOffer, ProviderProbe, ProviderQuote,
  ProviderRetrieval, RequestContext,
} from '../provider.types';
import { normalizeRequiredParameters } from './normalizers/luggage.normalizer';
import { hasReturnLeg, normalizeLeg } from './normalizers/routing.normalizer';
import { sleep, TravelfusionCommands } from './travelfusion.commands';
import { asList, num, text } from '../../../common/xml/xml.util';

/**
 * ⚠️ Provedor ARQUIVADO. A Travelfusion está bloqueada por liberação de IP e
 * fora do escopo atual. Este arquivo acompanha o vocabulário canônico para
 * continuar compilando e correto, mas não recebe trabalho novo — o foco é a
 * LATAM. Ver `docs/travelfusion/README.md`.
 */

const BOOKING_POLL_INTERVAL_MS = 5000;
const BOOKING_TIMEOUT_MS = 3 * 60 * 1000;

/** Estado de VENDA da reserva — vocabulário canônico, não o do fornecedor. */
const TF_STATUS_MAP: Record<string, 'confirmed' | 'pending' | 'cancelled'> = {
  Succeeded: 'confirmed',
  BookingInProgress: 'pending',
  Unconfirmed: 'pending',
  UnconfirmedBySupplier: 'pending',
  Cancelled: 'cancelled',
  Failed: 'cancelled',
};

@Injectable()
export class TravelfusionProvider implements FlightProvider {
  readonly name = PROVIDER;

  readonly supports = {
    fareRules: true,
    retrieve: true,
    // Um StartRouting cobre ida ou ida-e-volta; multidestino a Travelfusion não
    // declara como pacote único.
    multicity: false,
    // A Travelfusion não separa reservar de comprar: o `StartBooking` já cobra,
    // então cancelar seria estorno — coisa que o Direct Connect não expõe.
    cancelBooking: false,
    // Depende do fornecedor por trás do agregador; o Direct Connect não expõe.
    seatMap: false,
    // Os opcionais da Travelfusion saem no /quote, como requiredParameters.
    ancillaries: false,
    // O StartBooking já cobra: não há o que financiar nem o que emitir depois.
    financingOptions: false,
    issue: false,
    sellAncillaries: false,
  };

  constructor(private readonly commands: TravelfusionCommands) {}

  async probe(context: RequestContext): Promise<ProviderProbe> {
    // `force`: o ping PROVA a credencial — servir o LoginId do cache responderia
    // "ok" sem falar com a companhia.
    await this.commands.getLoginId(context, true);
    return { method: 'auth', scope: 'connection' };
  }

  /**
   * 🔴 O CheckRouting é INCREMENTAL: resultado já devolvido não volta. Cada poll
   * vira um lote no generator, e é isso que faz o stream do contrato entregar
   * voo antes da busca terminar.
   */
  async *search(request: AvailabilityDto, context: RequestContext): AsyncGenerator<ProviderOffer[]> {
    const passengers = passengersOf(request);
    const passengerCount = Math.max(1, passengers.adults + passengers.children + passengers.infants);

    const { routingId } = await this.commands.startRouting(this.buildRoutingRequest(request), context);
    if (!routingId) {
      throw new AppError('PROVIDER_INTEGRATION_ERROR', { metadata: { operation: 'availability' } });
    }

    const startedAt = Date.now();
    let complete = false;

    while (!complete && Date.now() - startedAt < env.routing.cutoffMs) {
      await sleep(env.routing.pollIntervalMs); // ≥ 2s é regra da Travelfusion
      const poll = await this.commands.checkRouting(routingId, context);
      complete = poll.complete;

      const offers = poll.routes.map((route) => {
        const outbound = normalizeLeg(route, { routingId, passengerCount, direction: 'outward' });
        // Pacote sem volta é meia viagem: quem decide o que fazer com isso é o
        // caso de uso, que conhece o tipo da viagem.
        const inbound = hasReturnLeg(route)
          ? normalizeLeg(route, { routingId, passengerCount, direction: 'return' })
          : null;
        return { outbound, inbound };
      });

      if (offers.length > 0) yield offers;
    }
  }

  async quote(key: OfferKey, dto: QuoteDto, context: RequestContext): Promise<ProviderQuote> {
    const { response } = await this.commands.processDetails(key.r, key.o, key.i, context);

    const total = num(response?.TotalPrice);
    if (total === null) {
      throw new AppError('PRICING_ERROR', { metadata: { operation: 'quote' } });
    }

    return {
      available: true,
      familyCode: text(response?.FareFamilyCode),
      family: text(response?.FareFamily),
      price: {
        base: roundMoney(num(response?.BaseFare) ?? 0),
        taxes: roundMoney(num(response?.Tax) ?? 0),
        fees: roundMoney(num(response?.Fee) ?? 0),
        total: roundMoney(total),
        currency: text(response?.Currency) ?? 'BRL',
      },
      // É aqui que a Travelfusion devolve o RequiredParameterList: o ProcessTerms
      // é ÚNICO, então não haverá segunda chance de perguntar o que ela exige.
      requiredParameters: normalizeRequiredParameters(
        asList(response?.RequiredParameterList?.RequiredParameter).map((parameter: any) => ({
          name: text(parameter?.Name),
          type: text(parameter?.Type),
          displayText: text(parameter?.DisplayText),
          perPassenger: text(parameter?.PerPassenger) === 'true',
          isOptional: text(parameter?.IsOptional) === 'true',
        })),
      ),
    };
  }

  async book(key: OfferKey, dto: CreateBookingDto, context: RequestContext): Promise<ProviderBooking> {
    const referenceDate = dto.fields.referenceDate ?? new Date().toISOString();
    const bookingParameters = this.toCustomParameters(dto.fields.customParameters);
    const people = Object.entries(dto.people);

    await this.commands.processTerms(
      {
        Mode: 'plane',
        RoutingId: key.r,
        BookingProfile: {
          CustomSupplierParameterList: bookingParameters.length
            ? { CustomSupplierParameter: bookingParameters }
            : undefined,
          TravellerList: {
            Traveller: people.map(([, person]) => this.buildTraveller(person, referenceDate)),
          },
        },
      },
      context,
    );

    await this.commands.startBooking(key.r, context); // sem retry: não idempotente

    const startedAt = Date.now();
    let last = await this.commands.checkBooking(key.r, context);

    while (!last.isFinal && Date.now() - startedAt < BOOKING_TIMEOUT_MS) {
      await sleep(BOOKING_POLL_INTERVAL_MS);
      last = await this.commands.checkBooking(key.r, context);
    }

    if (last.status === 'Failed') {
      throw new AppError('BUSINESS_RULE_VIOLATION', { metadata: { operation: 'createBooking' } });
    }
    if (last.status === 'Duplicate') {
      throw new AppError('RESOURCE_CONFLICT', { metadata: { operation: 'createBooking' } });
    }

    return {
      locator: last.supplierReference,
      committed: true,
      confirmed: last.succeeded,
      status: last.status ?? 'BookingInProgress',
      // O CheckBooking não declara moeda na confirmação.
      currency: null,
      passengers: people.map(([id, person]) => ({
        id,
        type: person.ageGroup,
        firstName: person.firstName,
        lastName: person.lastName,
      })),
    };
  }

  /**
   * A Travelfusion não tem um GetBooking rico: o CheckBooking é o que existe.
   * As chaves que ela não informa saem `null` — nunca omitidas.
   */
  async retrieve(locator: string, context: RequestContext): Promise<ProviderRetrieval> {
    const poll = await this.commands.checkBooking(locator, context);

    if (!poll.status) {
      throw new AppError('RESOURCE_NOT_FOUND', { metadata: { operation: 'retrieve' } });
    }

    const raw = poll.raw;

    return {
      status: TF_STATUS_MAP[poll.status] ?? null,
      rawStatus: poll.status,
      locator,
      supplierConfirmation: poll.supplierReference,
      // ⚠️ É o nome da COMPANHIA AÉREA, não o do provedor.
      supplierName: text(raw.SupplierName),
      currency: text(raw.Currency),
      createdAt: text(raw.BookingDateTime),
      // Prazo da reserva em espera: depois disso a companhia cancela sozinha.
      expiresAt: text(raw.TimeLimit),
      confirmationAt: text(raw.ConfirmationDateTime) ?? text(raw.BookingDateTime),
      people: asList(raw?.TravellerList?.Traveller).map((traveller: any) => ({
        firstName: text(traveller?.FirstName),
        lastName: text(traveller?.LastName),
        email: text(traveller?.Email),
        nationality: text(traveller?.Nationality),
        documentNumber: text(traveller?.DocumentNumber),
        dateOfBirth: text(traveller?.DateOfBirth),
        type: text(traveller?.Type),
      })),
      // 🔴 O CheckBooking NÃO devolve itinerário. `[]` aqui é limite do
      // provedor, não lacuna nossa — e o contrato distingue as duas coisas.
      segments: [],
      // Sem segmento não há journey para agrupar.
      journeys: [],
      total: null,
      // Idem: o agregador não expõe documento nesta leitura.
      tickets: [],
    };
  }

  async fareRules(key: OfferKey, dto: FareRulesDto, context: RequestContext): Promise<FareRuleSection[]> {
    const { response } = await this.commands.processDetails(key.r, key.o, null, context);

    const candidates = [
      ...asList(response?.FareRuleList?.FareRule),
      ...asList(response?.TermsAndConditionsList?.TermsAndConditions),
    ];

    const sections = candidates
      .map((node: any) => ({
        company: text(node?.Carrier) ?? text(node?.SupplierName),
        fareBasis: text(node?.FareBasis),
        origin: text(node?.Origin),
        destination: text(node?.Destination),
        text: text(node?.Text) ?? text(node?.Description) ?? text(node),
      }))
      .filter((section): section is FareRuleSection => Boolean(section.text));

    if (sections.length > 0) return sections;

    // Fallback: alguns fornecedores mandam um bloco único, sem lista.
    const single = text(response?.TermsAndConditions) ?? text(response?.FareRules);
    return single
      ? [{
          company: text(response?.SupplierName),
          fareBasis: text(response?.FareBasis),
          origin: text(response?.Origin),
          destination: text(response?.Destination),
          text: single,
        }]
      : [];
  }

  private buildRoutingRequest(request: AvailabilityDto): Record<string, unknown> {
    const [outward, inbound] = legsOf(request);
    const passengers = passengersOf(request);

    return {
      Mode: 'plane',
      OriginList: { Origin: outward.origin },
      DestinationList: { Destination: outward.destination },
      OutwardDates: { DepartureDate: outward.date },
      ReturnDates: inbound ? { DepartureDate: inbound.date } : undefined,
      Passengers: {
        Adults: passengers.adults,
        Children: passengers.children,
        Infants: passengers.infants,
      },
    };
  }

  private toCustomParameters(source: Record<string, string> | undefined): Array<{ Name: string; Value: string }> {
    return Object.entries(source ?? {}).map(([Name, Value]) => ({ Name, Value }));
  }

  private buildTraveller(person: BookingPersonDto, referenceDate: string): Record<string, unknown> {
    const perPassenger = this.toCustomParameters(person.customParameters);

    return {
      Age: ageOnFlightDate(person.birthDate, referenceDate),
      Name: {
        Title: person.title ?? 'Mr',
        NamePartList: { NamePart: [person.firstName, person.lastName].filter(Boolean) },
      },
      CustomSupplierParameterList: perPassenger.length
        ? { CustomSupplierParameter: perPassenger }
        : undefined,
    };
  }
}
