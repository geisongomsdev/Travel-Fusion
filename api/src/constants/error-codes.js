/**
 * Catálogo de erro do contrato — 02-erros.md §2.
 *
 * 🔴 SEM prefixo de serviço. É `FARE_UNAVAILABLE`, nunca `FLIGHT_FARE_UNAVAILABLE`.
 * A `message` é literal, em inglês, e vem daqui — nunca do erro interno e nunca
 * do texto da companhia.
 */
const DEFINITIONS = Object.freeze({
  SEARCH_VALIDATION_ERROR:        { status: 400, category: 'validation',              message: 'The request payload is invalid.' },
  PROVIDER_AUTHENTICATION_FAILED: { status: 401, category: 'provider_authentication', message: 'The provider rejected the configured credentials.' },
  RESOURCE_NOT_FOUND:             { status: 404, category: 'not_found',               message: 'The requested resource was not found.' },
  ROUTE_NOT_FOUND:                { status: 404, category: 'not_found',               message: 'The requested route does not exist.' },
  RESOURCE_CONFLICT:              { status: 409, category: 'conflict',                message: 'The request conflicts with the current resource state.' },
  FARE_UNAVAILABLE:               { status: 409, category: 'conflict',                message: 'The selected fare is no longer available.' },
  FARE_PRICE_CHANGED:             { status: 409, category: 'conflict',                message: 'The fare price changed since it was quoted.' },
  BOOKING_ALREADY_CANCELLED:      { status: 409, category: 'conflict',                message: 'The booking is already cancelled.' },
  BOOKING_PARTIAL_FAILURE:        { status: 409, category: 'conflict',                message: 'Booking partially failed and could not be rolled back.' },
  BUSINESS_RULE_VIOLATION:        { status: 422, category: 'business_rule',           message: 'The operation violates a provider or business rule.' },
  RATE_LIMITED:                   { status: 429, category: 'rate_limit',              message: 'Too many requests. Please retry later.' },
  UNEXPECTED_ERROR:               { status: 500, category: 'unexpected',              message: 'The request could not be completed.' },
  CAPABILITY_NOT_SUPPORTED:       { status: 501, category: 'not_supported',           message: 'This provider does not support the requested operation.' },
  PROVIDER_INTEGRATION_ERROR:     { status: 502, category: 'integration',             message: 'The request to the provider could not be completed.' },
  PRICING_ERROR:                  { status: 502, category: 'pricing',                 message: 'The price could not be calculated.' },
  PROVIDER_UNAVAILABLE:           { status: 503, category: 'integration',             message: 'The provider is temporarily unavailable. Please retry shortly.' },
  ENDPOINT_PROFILE_UNAVAILABLE:   { status: 503, category: 'endpoint_configuration',  message: 'The provider endpoint profile is unavailable for this operation.' },
  PROVIDER_TIMEOUT:               { status: 504, category: 'timeout',                 message: 'The provider did not respond in time.' },
});

export const ERROR_CODES = Object.freeze(Object.keys(DEFINITIONS).reduce((acc, k) => ({ ...acc, [k]: k }), {}));

/** Código desconhecido resolve para UNEXPECTED_ERROR. Nunca lança, nunca devolve undefined. */
export function lookupError(code) {
  const definition = DEFINITIONS[code];
  if (!definition) {
    return { code: 'UNEXPECTED_ERROR', ...DEFINITIONS.UNEXPECTED_ERROR };
  }
  return { code, ...definition };
}

export const ERROR_CATEGORIES = Object.freeze([
  'validation', 'not_found', 'conflict', 'business_rule', 'not_supported',
  'provider_authentication', 'integration', 'timeout', 'endpoint_configuration',
  'rate_limit', 'pricing', 'unexpected',
]);
