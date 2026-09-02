import { env } from '../../config/env.js';
import { AppError } from '../../domain/errors.js';
import { startRouting, checkRouting, sleep } from '../../integrations/travelfusion/provider/commands.js';
import { normalizeRoutes } from '../../integrations/travelfusion/normalizers/routing.normalizer.js';
import { asList, text } from '../../integrations/travelfusion/provider/xml.js';

const PROVIDER = 'travelfusion';

/**
 * A ponte polling → stream.
 *
 * 🔴 O CheckRouting é INCREMENTAL: resultados já devolvidos não voltam. Acumular
 * aqui e emitir progressivamente é o que faz o contrato de stream funcionar em
 * cima de um provedor de polling.
 */
export async function* searchAvailability(request, context = {}) {
  const startedAt = Date.now();
  const tripType = request.type;

  yield {
    type: 'start',
    message: 'Iniciando busca de voos',
    providers: [{ provider: PROVIDER }],
    totalProviders: 1,
    international: isInternational(request),
    timestamp: new Date().toISOString(),
  };

  const accumulated = [];

  try {
    const { routingId } = await startRouting(buildRoutingRequest(request), context);

    let complete = false;
    while (!complete && Date.now() - startedAt < env.routing.cutoffMs) {
      await sleep(env.routing.pollIntervalMs); // ≥ 2s é regra da Travelfusion
      const poll = await checkRouting(routingId, context);
      accumulated.push(...poll.routes);
      complete = poll.complete;
    }

    const data = buildData(accumulated, { routingId, request });

    if (countOffers(data) === 0) {
      // 🔴 "Sem voos" NÃO é erro da API — é provider_error com code NO_FLIGHTS e
      // SEM canonicalCode. O stream segue e termina em complete.
      yield {
        type: 'provider_error',
        provider: PROVIDER,
        data: { error: { code: 'NO_FLIGHTS', message: 'No flights found for the requested route.' } },
        timestamp: new Date().toISOString(),
      };
    } else {
      yield {
        type: 'provider_success',
        provider: PROVIDER,
        data,
        ...buildCounters(tripType, data),
        payment: { acceptedTypes: ['credit-card'] },
        timestamp: new Date().toISOString(),
      };
    }

    yield { type: 'filters', trip_type: tripType, data: { filters: buildFilters(data) }, timestamp: new Date().toISOString() };
    yield { type: 'complete', ...buildCompletion(tripType, data), duration: Date.now() - startedAt, providers: [{ provider: PROVIDER }], timestamp: new Date().toISOString() };
  } catch (error) {
    const appError = error instanceof AppError ? error : new AppError('UNEXPECTED_ERROR', { cause: error });
    yield {
      type: 'fatal_error',
      data: {
        success: false,
        error: { code: appError.code, category: appError.category },
        message: appError.publicMessage,
        correlationId: context.correlationId || null,
        provider: PROVIDER,
        ...(appError.providerError ? { providerError: appError.providerError } : {}),
      },
      timestamp: new Date().toISOString(),
    };
  }
}

function isInternational(request) {
  const codes = (request.legs || []).flatMap((leg) => [leg.origin, leg.destination]);
  return codes.some((code) => !/^[A-Z]{3}$/.test(code || '')) ? false : false;
}

function buildRoutingRequest(request) {
  const first = request.legs[0];
  return {
    Mode: 'plane',
    OriginList: { Origin: first.origin },
    DestinationList: { Destination: first.destination },
    OutwardDates: { DepartureDate: first.date },
    ReturnDates: request.legs[1] ? { DepartureDate: request.legs[1].date } : undefined,
    Passengers: {
      Adults: request.passengers.adults,
      Children: request.passengers.children || 0,
      Infants: request.passengers.babies || 0,
    },
  };
}

/**
 * A Travelfusion é provedor de PACOTE (declara a combinabilidade via RoutingId).
 * Logo: oneway → departure[]; roundtrip → groups[]; multicity → itineraries[].
 */
function buildData(routes, { routingId, request }) {
  const legs = normalizeRoutes(routes, { routingId, direction: 'outward', passengers: totalPassengers(request) });

  if (request.type === 'oneway') return { departure: legs, return: [], groups: [] };
  if (request.type === 'multicity') return { itineraries: legs.map((leg) => ({ legs: [[leg]], fares: leg.fares })) };

  // 🔴 Num roundtrip as três chaves sempre existem — meia viagem é suprimida.
  return {
    groups: legs.map((leg) => ({ departure: [leg], return: [], fares: leg.fares })),
    departure: [],
    return: [],
  };
}

function totalPassengers(request) {
  const p = request.passengers || {};
  return { total: (p.adults || 0) + (p.children || 0) + (p.babies || 0) };
}

function countOffers(data) {
  return (data.groups?.length || 0) + (data.departure?.length || 0) + (data.itineraries?.length || 0);
}

function buildCounters(tripType, data) {
  const groups = data.groups?.length || 0;
  const departure = data.departure?.length || 0;
  const ret = data.return?.length || 0;

  if (tripType === 'multicity') {
    const itineraries = data.itineraries?.length || 0;
    return { itineraries, flights: itineraries }; // 🔴 flights == itineraries, não contagem de voos
  }
  if (tripType === 'roundtrip') return { groups, departure, return: ret };
  return { groups, departure, return: ret, flights: groups > 0 ? groups : departure + ret };
}

function buildCompletion(tripType, data) {
  if (tripType === 'multicity') {
    const total = data.itineraries?.length || 0;
    return { totalCount: total, countType: 'itineraries', totalFlights: total, message: `Busca concluída: ${total} itinerários encontrados` };
  }
  const groups = data.groups?.length || 0;
  if (groups > 0) return { totalCount: groups, countType: 'groups', totalFlights: groups, message: `Busca concluída: ${groups} grupos de preço encontrados` };
  const flights = (data.departure?.length || 0) + (data.return?.length || 0);
  return { totalCount: flights, countType: 'flights', totalFlights: flights, message: `Busca concluída: ${flights} voos encontrados` };
}

function buildFilters(data) {
  const legs = [
    ...(data.departure || []),
    ...(data.groups || []).flatMap((g) => g.departure || []),
    ...(data.itineraries || []).flatMap((i) => i.legs.flat()),
  ];

  const airlines = new Map();
  const stops = {};
  let min = null;
  let max = null;

  for (const leg of legs) {
    const code = leg.company?.code;
    if (code) {
      const entry = airlines.get(code) || { code, name: leg.company.name, count: 0 };
      entry.count += 1;
      airlines.set(code, entry);
    }
    const key = leg.stops === 0 ? 'direct' : String(leg.stops ?? '1');
    stops[key] = (stops[key] || 0) + 1;

    const total = leg.fares?.[0]?.price?.total?.total;
    if (typeof total === 'number') {
      min = min === null ? total : Math.min(min, total);
      max = max === null ? total : Math.max(max, total);
    }
  }

  return {
    airlines: [...airlines.values()],
    stops: { departure: stops },
    currency: { min, max },
    providers: { [PROVIDER]: legs.length },
  };
}

export { asList, text };
