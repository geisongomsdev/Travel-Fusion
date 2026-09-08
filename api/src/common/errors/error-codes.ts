/**
 * Catálogo de erro do contrato — 02-erros.md §2.
 *
 * 🔴 SEM prefixo de serviço. É `FARE_UNAVAILABLE`, nunca `FLIGHT_FARE_UNAVAILABLE`.
 * A `message` é literal, em inglês, e vem daqui — nunca do erro interno, nunca do
 * texto da companhia.
 */
export type ErrorCategory =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'business_rule'
  | 'not_supported'
  | 'provider_authentication'
  | 'integration'
  | 'timeout'
  | 'endpoint_configuration'
  | 'rate_limit'
  | 'pricing'
  | 'unexpected';

export interface ErrorDefinition {
  status: number;
  category: ErrorCategory;
  message: string;
}

const DEFINITIONS = {
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
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof DEFINITIONS;

export const ERROR_CODES = Object.keys(DEFINITIONS) as ErrorCode[];

export const ERROR_CATEGORIES: ErrorCategory[] = [
  'validation', 'not_found', 'conflict', 'business_rule', 'not_supported',
  'provider_authentication', 'integration', 'timeout', 'endpoint_configuration',
  'rate_limit', 'pricing', 'unexpected',
];

/**
 * Código desconhecido resolve para UNEXPECTED_ERROR. Nunca lança, nunca devolve
 * `undefined` — quem chama depende disso para não ter caminho sem resposta.
 */
export function lookupError(code: string | undefined): ErrorDefinition & { code: ErrorCode } {
  const definition = (DEFINITIONS as Record<string, ErrorDefinition>)[code ?? ''];
  if (!definition) {
    return { code: 'UNEXPECTED_ERROR', ...DEFINITIONS.UNEXPECTED_ERROR };
  }
  return { code: code as ErrorCode, ...definition };
}
