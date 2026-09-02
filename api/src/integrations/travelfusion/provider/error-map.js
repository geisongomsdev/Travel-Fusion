import { AppError } from '../../../domain/errors.js';
import { text } from './xml.js';

const PROVIDER = 'travelfusion';

/**
 * Erros da Travelfusion → catálogo do contrato (02-erros.md).
 *
 * A spec traz os códigos no formato `N-NNNN` (Error Codes and Handling Guide,
 * pág. 73). Mapeamos por família; o que não casa cai em PROVIDER_INTEGRATION_ERROR,
 * nunca em UNEXPECTED_ERROR — a falha veio do provedor e quem consome precisa saber.
 */
const CODE_RULES = [
  { match: /^4-3448$/,          code: 'PROVIDER_AUTHENTICATION_FAILED' }, // Login ID not found (IP não whitelistado)
  { match: /^4-(1|2|3)\d{0,3}$/, code: 'PROVIDER_AUTHENTICATION_FAILED' },
  { match: /NoRoute|RouteNotFound/i, code: 'ROUTE_NOT_FOUND' },
  { match: /PriceChange/i,      code: 'FARE_PRICE_CHANGED' },
  { match: /Unavailable|SoldOut/i, code: 'FARE_UNAVAILABLE' },
  { match: /RateLimit|TooMany/i, code: 'RATE_LIMITED' },
];

export function buildProviderError({ operation, providerCode, providerMessage, httpStatus }) {
  if (!providerCode && !providerMessage) return null;
  return {
    provider: PROVIDER,
    operation: operation || null,
    providerCode: providerCode ? String(providerCode) : null,
    providerMessage: providerMessage || null,
    providerSeverity: null, // a Travelfusion não expõe severidade
    httpStatus: httpStatus ?? null,
  };
}

/** Lê o bloco <Error> de qualquer resposta. Devolve null quando a resposta é limpa. */
export function readError(parsed) {
  const root = parsed && Object.values(parsed)[0];
  const node = root?.Error || root?.ErrorList?.Error;
  if (!node) return null;
  const first = Array.isArray(node) ? node[0] : node;
  return {
    code: text(first?.Code) || text(first?.ErrorCode),
    message: text(first?.Message) || text(first?.ErrorText) || text(first),
  };
}

export function mapProviderError(providerFault, operation, httpStatus = null) {
  const code = providerFault?.code || null;
  const message = providerFault?.message || null;
  const rule = CODE_RULES.find((r) => r.match.test(code || '') || r.match.test(message || ''));

  return new AppError(rule ? rule.code : 'PROVIDER_INTEGRATION_ERROR', {
    providerError: buildProviderError({ operation, providerCode: code, providerMessage: message, httpStatus }),
    metadata: { operation },
  });
}
