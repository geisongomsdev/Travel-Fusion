import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { env, PROVIDER } from '../../../config/env';
import { RequestContext } from '../../travelfusion/travelfusion.client';
import { TravelfusionCommands, sleep } from '../../travelfusion/travelfusion.commands';
import { hasReturnLeg, normalizeLeg } from '../../travelfusion/normalizers/routing.normalizer';
import { AvailabilityDto } from '../dto/availability.dto';
import { AvailabilityData, Leg, StreamEvent } from '../flight.types';

@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  constructor(private readonly commands: TravelfusionCommands) {}

  /**
   * A ponte polling → stream.
   *
   * 🔴 O CheckRouting é INCREMENTAL: resultados já devolvidos não voltam.
   * Acumular aqui e emitir progressivamente é o que faz o contrato de stream
   * funcionar em cima de um provedor de polling.
   *
   * É um async generator para que o controller escreva cada evento assim que ele
   * existe — se a busca inteira fosse montada antes de responder, o stream
   * perderia o propósito.
   */
  async *search(request: AvailabilityDto, context: RequestContext = {}): AsyncGenerator<StreamEvent> {
    const startedAt = Date.now();
    const now = () => new Date().toISOString();

    yield {
      type: 'start',
      message: 'Iniciando busca de voos',
      providers: [{ provider: PROVIDER }],
      totalProviders: 1,
      international: false,
      timestamp: now(),
    };

    try {
      const { routingId } = await this.commands.startRouting(this.buildRoutingRequest(request), context);
      if (!routingId) throw new AppError('PROVIDER_INTEGRATION_ERROR', { metadata: { operation: 'availability' } });

      const accumulated: Record<string, any>[] = [];
      let complete = false;

      while (!complete && Date.now() - startedAt < env.routing.cutoffMs) {
        await sleep(env.routing.pollIntervalMs); // ≥ 2s é regra da Travelfusion
        const poll = await this.commands.checkRouting(routingId, context);
        accumulated.push(...poll.routes);
        complete = poll.complete;
      }

      const data = this.buildData(accumulated, routingId, request);

      if (this.countOffers(data) === 0) {
        // 🔴 "Sem voos" NÃO é erro da API: é provider_error com code NO_FLIGHTS e
        // SEM canonicalCode. O stream segue e termina em complete.
        yield {
          type: 'provider_error',
          provider: PROVIDER,
          data: { error: { code: 'NO_FLIGHTS', message: 'No flights found for the requested route.' } },
          timestamp: now(),
        };
      } else {
        yield {
          type: 'provider_success',
          provider: PROVIDER,
          data,
          ...this.buildCounters(request.type, data),
          payment: { acceptedTypes: ['credit-card'] },
          timestamp: now(),
        };
      }

      yield { type: 'filters', trip_type: request.type, data: { filters: this.buildFilters(data) }, timestamp: now() };
      yield {
        type: 'complete',
        ...this.buildCompletion(request.type, data),
        duration: Date.now() - startedAt,
        providers: [{ provider: PROVIDER }],
        timestamp: now(),
      };
    } catch (error) {
      const appError = error instanceof AppError
        ? error
        : new AppError('UNEXPECTED_ERROR', { cause: error });

      this.logger.error({ err: error, correlationId: context.correlationId });

      yield {
        type: 'fatal_error',
        data: {
          success: false,
          error: { code: appError.code, category: appError.category },
          message: appError.publicMessage,
          correlationId: context.correlationId ?? null,
          provider: PROVIDER,
          ...(appError.providerError ? { providerError: appError.providerError } : {}),
        },
        timestamp: now(),
      };
    }
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

  private passengerCount(request: AvailabilityDto): number {
    const { adults, children = 0, babies = 0 } = request.passengers;
    return Math.max(1, adults + children + babies);
  }

  /**
   * A Travelfusion é provedor de PACOTE (declara a combinabilidade via RoutingId).
   * Logo: oneway → departure[]; roundtrip → groups[]; multicity → itineraries[].
   */
  private buildData(routes: Record<string, any>[], routingId: string, request: AvailabilityDto): AvailabilityData {
    const passengerCount = this.passengerCount(request);
    const outwardLegs = routes.map((route) =>
      normalizeLeg(route, { routingId, passengerCount, direction: 'outward' }));

    if (request.type === 'oneway') {
      // 🔴 Chave AUSENTE ≠ []. Numa ida não existe volta, então a chave não existe.
      return { departure: outwardLegs, groups: [] };
    }

    if (request.type === 'multicity') {
      // O índice externo é o trecho; o interno são opções pelo MESMO preço.
      return { itineraries: outwardLegs.map((leg) => ({ legs: [[leg]], fares: leg.fares })) };
    }

    return this.buildRoundtrip(routes, outwardLegs, routingId, passengerCount);
  }

  /**
   * 🔴 Meia viagem é suprimida (04-availability-formatos.md §4): um grupo de
   * ida-e-volta sem a perna de volta não pode ser ofertado — o cliente
   * escolheria algo que a companhia não vende.
   *
   * As três chaves sempre existem num roundtrip; `groups` e as pernas soltas
   * convivem, não é ou-um-ou-outro.
   */
  private buildRoundtrip(
    routes: Record<string, any>[],
    outwardLegs: Leg[],
    routingId: string,
    passengerCount: number,
  ): AvailabilityData {
    const groups = routes
      .map((route, index) => {
        if (!hasReturnLeg(route)) return null;
        const inbound = normalizeLeg(route, { routingId, passengerCount, direction: 'return' });
        const outbound = outwardLegs[index];
        return { departure: [outbound], return: [inbound], fares: outbound.fares };
      })
      .filter((group): group is NonNullable<typeof group> => group !== null);

    // Pacote sem volta é meia viagem: fica fora dos grupos E fora das pernas
    // soltas, porque a Travelfusion não vende perna avulsa.
    return { groups, departure: [], return: [] };
  }

  private countOffers(data: AvailabilityData): number {
    return (data.groups?.length ?? 0) + (data.departure?.length ?? 0) + (data.itineraries?.length ?? 0);
  }

  /** Quais contadores existem depende do tipo de viagem (03-availability §3). */
  private buildCounters(tripType: string, data: AvailabilityData): Record<string, number> {
    const groups = data.groups?.length ?? 0;
    const departure = data.departure?.length ?? 0;
    const returned = data.return?.length ?? 0;

    if (tripType === 'multicity') {
      const itineraries = data.itineraries?.length ?? 0;
      // 🔴 `flights` é IGUAL a itineraries — não é contagem de voos.
      return { itineraries, flights: itineraries };
    }
    if (tripType === 'roundtrip') return { groups, departure, return: returned };

    return { groups, departure, return: returned, flights: groups > 0 ? groups : departure + returned };
  }

  private buildCompletion(tripType: string, data: AvailabilityData): Record<string, unknown> {
    if (tripType === 'multicity') {
      const total = data.itineraries?.length ?? 0;
      return { totalCount: total, countType: 'itineraries', totalFlights: total, message: `Busca concluída: ${total} itinerários encontrados` };
    }

    const groups = data.groups?.length ?? 0;
    if (groups > 0) {
      return { totalCount: groups, countType: 'groups', totalFlights: groups, message: `Busca concluída: ${groups} grupos de preço encontrados` };
    }

    const flights = (data.departure?.length ?? 0) + (data.return?.length ?? 0);
    return { totalCount: flights, countType: 'flights', totalFlights: flights, message: `Busca concluída: ${flights} voos encontrados` };
  }

  private buildFilters(data: AvailabilityData): Record<string, unknown> {
    const legs: Leg[] = [
      ...(data.departure ?? []),
      ...(data.groups ?? []).flatMap((group) => group.departure),
      ...(data.itineraries ?? []).flatMap((itinerary) => itinerary.legs.flat()),
    ];

    const airlines = new Map<string, { code: string; name: string | null; count: number }>();
    const stops: Record<string, number> = {};
    let min: number | null = null;
    let max: number | null = null;
    let refundable = 0;
    let nonRefundable = 0;

    for (const leg of legs) {
      const code = leg.company.code;
      if (code) {
        const entry = airlines.get(code) ?? { code, name: leg.company.name, count: 0 };
        entry.count += 1;
        airlines.set(code, entry);
      }

      const key = leg.stops === 0 ? 'direct' : String(leg.stops ?? 1);
      stops[key] = (stops[key] ?? 0) + 1;

      // 🔴 Ordene/agregue pela família MAIS BARATA, nunca por fares[0].
      const cheapest = [...leg.fares].sort(
        (a, b) => (a.price.total.total ?? Infinity) - (b.price.total.total ?? Infinity),
      )[0];

      const total = cheapest?.price.total.total;
      if (typeof total === 'number') {
        min = min === null ? total : Math.min(min, total);
        max = max === null ? total : Math.max(max, total);
      }

      if (cheapest?.rules.refundable === true) refundable += 1;
      if (cheapest?.rules.refundable === false) nonRefundable += 1;
    }

    return {
      airlines: [...airlines.values()],
      stops: { departure: stops },
      currency: { min, max },
      providers: { [PROVIDER]: legs.length },
      // `refundable` só aparece quando ALGUMA oferta tem sinal de reembolsabilidade.
      ...(refundable + nonRefundable > 0 ? { refundable: { refundable, nonRefundable } } : {}),
    };
  }
}
