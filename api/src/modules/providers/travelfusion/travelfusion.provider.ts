import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { roundMoney } from '../../../common/utils/money';
import { ageOnFlightDate } from '../../../common/utils/age';
import { OfferKey } from '../../../common/utils/offer-key';
import { env, PROVIDER } from '../../../config/env';
import { AvailabilityDto } from '../../flight/dto/availability.dto';
import { BookingPassengerDto, CreateBookingDto, FareRulesDto, QuoteDto } from '../../flight/dto/booking.dto';
import {
  FareRuleSection, FlightProvider, ProviderBooking, ProviderOffer, ProviderProbe, ProviderQuote,
  ProviderRetrieval, RequestContext,
} from '../provider.types';
import { normalizeRequiredParameters } from './normalizers/luggage.normalizer';
import { hasReturnLeg, normalizeLeg } from './normalizers/routing.normalizer';
import { sleep, TravelfusionCommands } from './travelfusion.commands';
import { asList, num, text } from '../../../common/xml/xml.util';

const BOOKING_POLL_INTERVAL_MS = 5000;
const BOOKING_TIMEOUT_MS = 3 * 60 * 1000;

/** Estado de VENDA da reserva — vocabulario canonico, nao o do fornecedor. */
const TF_STATUS_MAP: Record<string, 'confirmed' | 'pending' | 'cancelled'> = {
  Succeeded: 'confirmed',
  BookingInProgress: 'pending',
  Unconfirmed: 'pending',
  UnconfirmedBySupplier: 'pending',
  Cancelled: 'cancelled',
  Failed: 'cancelled',
};

/**
 * A Travelfusion vestida com a interface de provedor.
 *
 * Não há lógica nova aqui: os comandos e normalizadores continuam sendo os
 * mesmos. O que este arquivo faz é traduzir o formato de entrega — polling
 * incremental — para o generator que o caso de uso consome, igual para os dois
 * provedores.
 */
@Injectable()
export class TravelfusionProvider implements FlightProvider {
  readonly name = PROVIDER;

  readonly supports = {
    fareRules: true,
    retrieve: true,
    // Um StartRouting cobre ida ou ida-e-volta; multidestino a Travelfusion não
    // declara como pacote único.
    multicity: false,
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
    const passengerCount = Math.max(
      1,
      request.passengers.adults + (request.passengers.children ?? 0) + (request.passengers.babies ?? 0),
    );

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
      price: {
        base: roundMoney(num(response?.BaseFare) ?? 0),
        taxes: { boarding: roundMoney(num(response?.Tax) ?? 0), service: 0, fuel: 0, baggage: 0 },
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
    const referenceDate = dto.referenceDate ?? new Date().toISOString();
    const bookingParameters = this.toCustomParameters(dto.customParameters);

    await this.commands.processTerms(
      {
        Mode: 'plane',
        RoutingId: key.r,
        BookingProfile: {
          CustomSupplierParameterList: bookingParameters.length
            ? { CustomSupplierParameter: bookingParameters }
            : undefined,
          TravellerList: {
            Traveller: dto.passengers.map((passenger) => this.buildTraveller(passenger, referenceDate)),
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
    };
  }

  /**
   * A Travelfusion nao tem um GetBooking rico: o CheckBooking e o que existe.
   * As chaves que ela nao informa saem `null` — nunca omitidas.
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
      // ⚠️ E o nome da COMPANHIA AEREA, nao o do provedor.
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
    const [outward, inbound] = request.legs;
    return {
      Mode: 'plane',
      OriginList: { Origin: outward.origin },
      DestinationList: { Destination: outward.destination },
      OutwardDates: { DepartureDate: outward.date },
      ReturnDates: inbound ? { DepartureDate: inbound.date } : undefined,
      Passengers: {
        Adults: request.passengers.adults,
        Children: request.passengers.children ?? 0,
        Infants: request.passengers.babies ?? 0,
      },
    };
  }

  private toCustomParameters(source: Record<string, string> | undefined): Array<{ Name: string; Value: string }> {
    return Object.entries(source ?? {}).map(([Name, Value]) => ({ Name, Value }));
  }

  private buildTraveller(passenger: BookingPassengerDto, referenceDate: string): Record<string, unknown> {
    const perPassenger = this.toCustomParameters(passenger.customParameters);

    return {
      Age: ageOnFlightDate(passenger.dateOfBirth, referenceDate),
      Name: {
        Title: passenger.title ?? 'Mr',
        NamePartList: { NamePart: [passenger.firstName, passenger.lastName].filter(Boolean) },
      },
      CustomSupplierParameterList: perPassenger.length
        ? { CustomSupplierParameter: perPassenger }
        : undefined,
    };
  }
}
