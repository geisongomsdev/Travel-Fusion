import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { LATAM } from '../../../config/env';
import { ProviderFault } from '../travelfusion/error.map';
import { asList, text } from '../../../common/xml/xml.util';

/**
 * Erros da LATAM NDC → catálogo do contrato.
 *
 * 🔴 O código da LATAM CARREGA o status HTTP nos três primeiros dígitos:
 * `404122007` é um 404, `409107014` é um 409. Isso dá um mapeamento por família
 * que cobre código novo sem precisar catalogar um a um — o que importa, porque a
 * LATAM adiciona subcódigo sem avisar.
 *
 * A resposta vem com HTTP 200 mesmo no erro em vários casos, então quem manda é
 * o `<Error><Code>`, nunca o status da conexão.
 */
const CLASS_RULES: Record<string, ErrorCode> = {
  '400': 'SEARCH_VALIDATION_ERROR',
  '401': 'PROVIDER_AUTHENTICATION_FAILED',
  '403': 'PROVIDER_AUTHENTICATION_FAILED',
  '404': 'ROUTE_NOT_FOUND',
  '409': 'RESOURCE_CONFLICT',
  '422': 'BUSINESS_RULE_VIOLATION',
  '429': 'RATE_LIMITED',
  '500': 'PROVIDER_INTEGRATION_ERROR',
  '502': 'PROVIDER_INTEGRATION_ERROR',
  '503': 'PROVIDER_UNAVAILABLE',
  '504': 'PROVIDER_TIMEOUT',
};

/**
 * Onde o significado é mais específico que a família. Tem precedência.
 * `404122006/7` são "não voamos essa rota nessa data" — rota inexistente para o
 * contrato, e não recurso sumido.
 */
const CODE_RULES: Array<{ match: RegExp; code: ErrorCode }> = [
  { match: /^40412200[67]$/, code: 'ROUTE_NOT_FOUND' },
  // Preço mudou entre o AirShopping e o OfferPrice: o contrato tem código próprio.
  { match: /^409107014$/, code: 'FARE_PRICE_CHANGED' },
  { match: /^409140008$/, code: 'FARE_UNAVAILABLE' },
];

/**
 * A NDC devolve `<Error>` na raiz da mensagem (irmão de `<Response>`), podendo
 * repetir. Pegamos o primeiro: é ele que descreve a causa; os demais costumam
 * ser detalhamento do mesmo problema.
 */
export function readLatamError(parsed: Record<string, any>): ProviderFault | null {
  const root = parsed && (Object.values(parsed)[0] as Record<string, any> | undefined);
  if (!root || typeof root !== 'object') return null;

  const nodes = [
    ...asList(root.Error),
    ...asList(root.Errors?.Error),
    ...asList(root.Response?.Error),
  ].filter(Boolean);

  if (nodes.length === 0) return null;

  const first = nodes[0] as Record<string, any>;
  return {
    code: text(first?.Code) ?? text(first?.ErrorCode),
    message: text(first?.DescText) ?? text(first?.ShortText) ?? text(first),
  };
}

export function mapLatamError(
  fault: ProviderFault | null,
  operation: string,
  httpStatus: number | null = null,
): AppError {
  const code = fault?.code ?? null;
  const message = fault?.message ?? null;

  const explicit = CODE_RULES.find((rule) => rule.match.test(code ?? ''))?.code;
  // Família pelo prefixo do próprio código; o status da conexão é só o plano B.
  const byClass = code && /^\d{9}$/.test(code)
    ? CLASS_RULES[code.slice(0, 3)]
    : httpStatus
      ? CLASS_RULES[String(httpStatus)]
      : undefined;

  return new AppError(explicit ?? byClass ?? 'PROVIDER_INTEGRATION_ERROR', {
    providerError: {
      provider: LATAM,
      operation,
      providerCode: code,
      providerMessage: message,
      providerSeverity: null,
      httpStatus,
    },
    metadata: { operation },
  });
}
