import { sendCommand } from './client.js';
import { authFields } from './auth.js';
import { asList, text, bool } from './xml.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fornecedores habilitados na nossa branch. */
export async function getBranchSupplierList(context) {
  const { parsed } = await sendCommand('GetBranchSupplierList', await authFields(), context);
  return asList(parsed?.GetBranchSupplierListResponse?.SupplierList?.Supplier)
    .map((s) => ({ name: text(s?.Name), enabled: bool(s?.Enabled) !== false }));
}

/**
 * Rotas atendidas por cada fornecedor.
 *
 * 🔴 Implementação OBRIGATÓRIA para o go-live: buscar rota que o fornecedor não
 * atende é motivo de reprova. O resultado é caro e muda pouco — cachear por horas.
 */
export async function listSupplierRoutes(supplier, context) {
  const { parsed } = await sendCommand('ListSupplierRoutes', {
    ...(await authFields()),
    Mode: 'plane',
    SupplierName: supplier,
  }, context);

  return asList(parsed?.ListSupplierRoutesResponse?.RouteList?.Route).map((route) => ({
    origin: text(route?.Origin),
    destination: text(route?.Destination),
  }));
}

export async function startRouting(request, context) {
  const { parsed } = await sendCommand('StartRouting', { ...(await authFields()), ...request }, context);
  const response = parsed?.StartRoutingResponse || {};
  return {
    routingId: text(response.RoutingId),
    routers: asList(response.RouterList?.Router).map((r) => text(r?.Name)).filter(Boolean),
  };
}

/**
 * Uma passada do polling.
 *
 * 🔴 Resultados já devolvidos NÃO voltam nas chamadas seguintes. Quem chama
 * acumula; tratar cada resposta como "o total" perde voo.
 */
export async function checkRouting(routingId, context) {
  const { parsed, durationMs } = await sendCommand('CheckRouting', {
    ...(await authFields()),
    RoutingId: routingId,
  }, context);

  const response = parsed?.CheckRoutingResponse || {};
  const routers = asList(response.RouterList?.Router).map((router) => ({
    name: text(router?.Name),
    complete: bool(router?.Complete) === true,
    error: text(router?.Error),
  }));

  return {
    durationMs,
    routers,
    complete: routers.length > 0 && routers.every((r) => r.complete),
    routes: asList(response.RouteList?.Route),
  };
}

export async function processDetails(routingId, outboundId, inboundId, context) {
  const { parsed, durationMs } = await sendCommand('ProcessDetails', {
    ...(await authFields()),
    Mode: 'plane',
    RoutingId: routingId,
    OutwardId: outboundId,
    ReturnId: inboundId || undefined,
  }, context);
  return { response: parsed?.ProcessDetailsResponse || {}, durationMs };
}

/**
 * 🔴 UM ÚNICO ProcessTerms por reserva. Múltiplos só são aceitos em caso de erro
 * de validação de dados — a Travelfusion audita a contagem.
 */
export async function processTerms(payload, context) {
  const { parsed, durationMs } = await sendCommand('ProcessTerms', {
    ...(await authFields()),
    ...payload,
  }, context);
  return { response: parsed?.ProcessTermsResponse || {}, durationMs };
}

/** Sem retry. Se falhar, o caminho é CheckBooking — nunca repetir. */
export async function startBooking(routingId, context) {
  const { parsed } = await sendCommand('StartBooking', {
    ...(await authFields()),
    Mode: 'plane',
    RoutingId: routingId,
  }, context);
  return { bookingId: text(parsed?.StartBookingResponse?.BookingId) || routingId };
}

const FINAL_STATUSES = new Set(['Succeeded', 'Failed', 'Duplicate']);

export async function checkBooking(routingId, context) {
  const { parsed, durationMs } = await sendCommand('CheckBooking', {
    ...(await authFields()),
    Mode: 'plane',
    RoutingId: routingId,
  }, context);

  const response = parsed?.CheckBookingResponse || {};
  const status = text(response.Status) || text(response.BookingStatus);

  return {
    durationMs,
    status,
    isFinal: FINAL_STATUSES.has(status),
    succeeded: status === 'Succeeded',
    supplierReference: text(response.SupplierReference) || text(response.BookingReference),
    raw: response,
  };
}

export { sleep, FINAL_STATUSES };
