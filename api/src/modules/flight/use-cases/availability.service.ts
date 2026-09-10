import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { ProviderRegistry } from '../../providers/provider.registry';
import { FlightProvider, ProviderOffer, RequestContext } from '../../providers/provider.types';
import { AvailabilityDto } from '../dto/availability.dto';
import { AvailabilityData, Leg, StreamEvent } from '../flight.types';

@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * A ponte provedores → stream.
   *
   * 🔴 Cada provedor emite o SEU `provider_success` (ou `provider_error`) assim
   * que termina — não esperamos o mais lento para responder pelo mais rápido.
   * `fatal_error` fica reservado para o que derruba a busca inteira; um provedor
   * que falha enquanto outro responde é `provider_error`, e o stream segue.
   *
   * É async generator para que o controller escreva cada evento quando ele
   * existe; montar tudo antes de responder perderia o propósito do stream.
   */
  async *search(request: AvailabilityDto, context: RequestContext = {}): AsyncGenerator<StreamEvent> {
    const startedAt = Date.now();
    const now = () => new Date().toISOString();

    let providers: FlightProvider[];
    try {
      providers = this.registry.resolve(request.options?.provider);
    } catch (error) {
      yield this.fatal(error, context, null, now());
      return;
    }

    yield {
      type: 'start',
      message: 'Iniciando busca de voos',
      providers: providers.map((provider) => ({ provider: provider.name })),
      totalProviders: providers.length,
      international: this.isInternational(request),
      timestamp: now(),
    };

    // Consulta em PARALELO: o tempo da busca é o do provedor mais lento, não a
    // soma. Cada resultado entra na fila e é emitido na ordem em que chega.
    const queue: StreamEvent[] = [];
    let notify: (() => void) | null = null;
    const wake = () => { notify?.(); notify = null; };

    const perProvider: Record<string, AvailabilityData> = {};
    let pending = providers.length;

    const runs = providers.map(async (provider) => {
      try {
        const offers = this.applyOptionFilters(
          await this.collect(provider, request, context),
          request,
        );
        const data = this.buildData(offers, request);
        perProvider[provider.name] = data;

        if (this.countOffers(data) === 0) {
          // 🔴 "Sem voos" NÃO é erro da API: é provider_error com code NO_FLIGHTS
          // e SEM canonicalCode. O stream segue e termina em complete.
          queue.push({
            type: 'provider_error',
            provider: provider.name,
            data: { error: { code: 'NO_FLIGHTS', message: 'No flights found for the requested route.' } },
            timestamp: now(),
          });
        } else {
          queue.push({
            type: 'provider_success',
            provider: provider.name,
            data,
            ...this.buildCounters(request.type, data),
            payment: { acceptedTypes: ['credit-card'] },
            timestamp: now(),
          });
        }
      } catch (error) {
        const appError = error instanceof AppError ? error : new AppError('UNEXPECTED_ERROR', { cause: error });
        this.logger.error({ err: error, provider: provider.name, correlationId: context.correlationId });

        // Falha de UM provedor não derruba a busca: vira provider_error com o
        // canonicalCode do catálogo, e os demais continuam.
        queue.push({
          type: 'provider_error',
          provider: provider.name,
          data: {
            error: {
              code: appError.code,
              canonicalCode: appError.code,
              category: appError.category,
              message: appError.publicMessage,
              ...(appError.providerError ? { providerError: appError.providerError } : {}),
            },
          },
          timestamp: now(),
        });
      } finally {
        pending -= 1;
        wake();
      }
    });

    while (pending > 0 || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => { notify = resolve; });
        continue;
      }
      yield queue.shift()!;
    }

    await Promise.allSettled(runs);

    const merged = this.merge(Object.values(perProvider), request.type);

    yield {
      type: 'filters',
      trip_type: request.type,
      data: { filters: this.buildFilters(perProvider) },
      timestamp: now(),
    };
    yield {
      type: 'complete',
      ...this.buildCompletion(request.type, merged),
      duration: Date.now() - startedAt,
      providers: providers.map((provider) => ({ provider: provider.name })),
      timestamp: now(),
    };
  }

  private fatal(error: unknown, context: RequestContext, provider: string | null, timestamp: string): StreamEvent {
    const appError = error instanceof AppError ? error : new AppError('UNEXPECTED_ERROR', { cause: error });
    this.logger.error({ err: error, correlationId: context.correlationId });

    return {
      type: 'fatal_error',
      data: {
        success: false,
        error: { code: appError.code, category: appError.category },
        message: appError.publicMessage,
        correlationId: context.correlationId ?? null,
        ...(provider ? { provider } : {}),
        ...(appError.providerError ? { providerError: appError.providerError } : {}),
      },
      timestamp,
    };
  }

  /** Drena o generator do provedor. Os lotes são acumulados, nunca substituídos. */
  private async collect(
    provider: FlightProvider,
    request: AvailabilityDto,
    context: RequestContext,
  ): Promise<ProviderOffer[]> {
    if (request.type === 'multicity' && !provider.supports.multicity) {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'availability' } });
    }

    const accumulated: ProviderOffer[] = [];
    for await (const batch of provider.search(request, context)) {
      accumulated.push(...batch);
    }
    return accumulated;
  }

  /**
   * `options.refundable` e `options.class` aplicados sobre o resultado.
   *
   * 🔴 Ficam AQUI, na camada do contrato, e não no provedor, porque só assim
   * valem igual para os dois: a LATAM já filtra cabine no AirShopping
   * (`PreferredCabinType`) e a Travelfusion não filtra nada. Antes disso, os
   * dois campos chegavam no pedido e não faziam efeito nenhum — pior que não
   * existir, porque quem chama acredita que filtrou.
   *
   * Para a LATAM o filtro de cabine é redundante e não custa nada; para a
   * Travelfusion é o que faz a opção existir.
   */
  private applyOptionFilters(offers: ProviderOffer[], request: AvailabilityDto): ProviderOffer[] {
    const wantRefundable = request.options?.refundable === true;
    const wantCabin = request.options?.class ?? null;

    if (!wantRefundable && !wantCabin) return offers;

    return offers.filter((offer) => {
      const fares = [
        ...offer.outbound.fares,
        ...(offer.inbound?.fares ?? []),
      ];
      if (fares.length === 0) return false;

      /**
       * 🔴 `refundable: null` é DESCONHECIDO, não "sim". Quem pediu só
       * reembolsável não pode receber uma tarifa cuja regra não sabemos —
       * devolver na dúvida é afirmar o que o provedor não afirmou.
       */
      if (wantRefundable && !fares.some((fare) => fare.rules?.refundable === true)) return false;

      // `cabin: null` é a oferta com MAIS DE UMA cabine — cabe em qualquer pedido.
      if (wantCabin && !fares.some((fare) => fare.cabin === null || fare.cabin === wantCabin)) {
        return false;
      }

      return true;
    });
  }

  /** Rota internacional = algum trecho cruza país. Sem tabela de IATA→país,
   * o honesto é declarar `false` e não adivinhar. */
  private isInternational(_request: AvailabilityDto): boolean {
    return false;
  }

  /**
   * Os dois provedores são de PACOTE (a combinabilidade vem declarada).
   * Logo: oneway → departure[]; roundtrip → groups[]; multicity → itineraries[].
   */
  private buildData(offers: ProviderOffer[], request: AvailabilityDto): AvailabilityData {
    if (request.type === 'oneway') {
      // 🔴 Chave AUSENTE ≠ []. Numa ida não existe volta, então a chave não existe.
      return { departure: offers.map((offer) => offer.outbound), groups: [] };
    }

    if (request.type === 'multicity') {
      // O índice externo é o trecho; o interno são opções pelo MESMO preço.
      return {
        itineraries: offers.map((offer) => ({
          legs: [offer.outbound, offer.inbound].filter((leg): leg is Leg => leg !== null).map((leg) => [leg]),
          fares: offer.outbound.fares,
        })),
      };
    }

    /**
     * 🔴 Meia viagem é suprimida (04-availability-formatos.md §4): um pacote de
     * ida-e-volta sem a perna de volta não pode ser ofertado — o cliente
     * escolheria algo que a companhia não vende. Fica fora dos grupos E fora das
     * pernas soltas, porque provedor de pacote não vende perna avulsa.
     */
    const groups = offers
      .filter((offer) => offer.inbound !== null)
      .map((offer) => ({
        departure: [offer.outbound],
        return: [offer.inbound!],
        fares: offer.outbound.fares,
      }));

    return { groups, departure: [], return: [] };
  }

  /** Junta o que veio de cada provedor numa visão só, para contar e concluir. */
  private merge(parts: AvailabilityData[], tripType: string): AvailabilityData {
    if (tripType === 'multicity') {
      return { itineraries: parts.flatMap((part) => part.itineraries ?? []) };
    }
    if (tripType === 'oneway') {
      return { departure: parts.flatMap((part) => part.departure ?? []), groups: [] };
    }
    return {
      groups: parts.flatMap((part) => part.groups ?? []),
      departure: [],
      return: [],
    };
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

  /**
   * Filtros são do CONJUNTO, somando todos os provedores — mas `providers{}`
   * discrimina de quem veio cada trecho, que é o que permite a quem consome
   * filtrar por provedor sem refazer a busca.
   */
  private buildFilters(perProvider: Record<string, AvailabilityData>): Record<string, unknown> {
    const airlines = new Map<string, { code: string; name: string | null; count: number }>();
    const stops: Record<string, number> = {};
    const providers: Record<string, number> = {};
    let min: number | null = null;
    let max: number | null = null;
    let refundable = 0;
    let nonRefundable = 0;

    for (const [name, data] of Object.entries(perProvider)) {
      const legs: Leg[] = [
        ...(data.departure ?? []),
        ...(data.groups ?? []).flatMap((group) => group.departure),
        ...(data.itineraries ?? []).flatMap((itinerary) => itinerary.legs.flat()),
      ];
      providers[name] = legs.length;

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
    }

    return {
      airlines: [...airlines.values()],
      stops: { departure: stops },
      currency: { min, max },
      providers,
      // `refundable` só aparece quando ALGUMA oferta tem sinal de reembolsabilidade.
      ...(refundable + nonRefundable > 0 ? { refundable: { refundable, nonRefundable } } : {}),
    };
  }
}
