import { AppError, ProviderErrorWindow } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { PROVIDER } from '../../../config/env';
import { text } from '../../../common/xml/xml.util';

/**
 * Erros da Travelfusion → catálogo do contrato.
 *
 * A spec traz códigos no formato `N-NNNN` (Error Codes and Handling Guide, pág.
 * 73). Mapeamos por família; o que não casa cai em PROVIDER_INTEGRATION_ERROR
 * (502), nunca em UNEXPECTED_ERROR (500) — a falha veio do provedor, e quem
 * consome age diferente nos dois casos.
 */
const CODE_RULES: Array<{ match: RegExp; code: ErrorCode }> = [
  { match: /^4-3448$/, code: 'PROVIDER_AUTHENTICATION_FAILED' }, // Login ID not found (IP não whitelistado)
  { match: /^4-[123]\d{0,3}$/, code: 'PROVIDER_AUTHENTICATION_FAILED' },
  { match: /NoRoute|RouteNotFound/i, code: 'ROUTE_NOT_FOUND' },
  { match: /PriceChange/i, code: 'FARE_PRICE_CHANGED' },
  { match: /Unavailable|SoldOut/i, code: 'FARE_UNAVAILABLE' },
  { match: /RateLimit|TooMany/i, code: 'RATE_LIMITED' },
];

export interface ProviderFault {
  code: string | null;
  message: string | null;
}

export function buildProviderError(input: {
  operation: string | null;
  providerCode: string | null;
  providerMessage: string | null;
  httpStatus: number | null;
}): ProviderErrorWindow | null {
  if (!input.providerCode && !input.providerMessage) return null;
  return {
    provider: PROVIDER,
    operation: input.operation,
    providerCode: input.providerCode ? String(input.providerCode) : null,
    providerMessage: input.providerMessage,
    providerSeverity: null, // a Travelfusion não expõe severidade
    httpStatus: input.httpStatus,
  };
}

/**
 * 🔴 A Travelfusion sinaliza falha por ATRIBUTO — `ecode`/`etext` — e não por um
 * bloco `<Error>`. Além disso ela responde HTTP 200 nesses casos, e o atributo
 * vem aninhado:
 *
 *   <CommandList><CommandExecutionFailure>
 *     <StartRouting ecode="4-3448" etext="Login id not found"/>
 *   </CommandExecutionFailure></CommandList>
 *
 * Procurar só na raiz faz a resposta de erro passar por resposta vazia, e o
 * sintoma vira "nenhum voo encontrado" no lugar da causa real.
 */
const readAttrs = (node: unknown): ProviderFault | null => {
  const attrs = (node as { $?: Record<string, string> } | undefined)?.$;
  if (!attrs?.ecode && !attrs?.etext) return null;
  return { code: attrs.ecode ?? null, message: attrs.etext ?? null };
};

/** Primeiro filho que carrega `ecode`/`etext`. Um nível só, de propósito. */
const readChildren = (node: unknown): ProviderFault | null => {
  if (!node || typeof node !== 'object') return null;
  for (const child of Object.values(node as Record<string, unknown>)) {
    for (const item of Array.isArray(child) ? child : [child]) {
      const found = readAttrs(item);
      if (found) return found;
    }
  }
  return null;
};

/** Lê o erro de qualquer resposta. `null` quando a resposta está limpa. */
export function readError(parsed: Record<string, any>): ProviderFault | null {
  const root = parsed && (Object.values(parsed)[0] as Record<string, any> | undefined);
  if (!root || typeof root !== 'object') return null;

  // Nada de varredura profunda: uma resposta de CheckRouting traz centenas de
  // rotas, e olhamos exatamente os lugares que a spec define.
  const fromAttrs = readAttrs(root) ?? readChildren(root.CommandExecutionFailure) ?? readChildren(root);
  if (fromAttrs) return fromAttrs;

  // Formato `<Error>`: mantido porque parte da spec documenta assim.
  const node = root.Error ?? root.ErrorList?.Error;
  if (!node) return null;
  const first = Array.isArray(node) ? node[0] : node;
  return {
    code: text(first?.Code) ?? text(first?.ErrorCode),
    message: text(first?.Message) ?? text(first?.ErrorText) ?? text(first),
  };
}

export function mapProviderError(
  fault: ProviderFault | null,
  operation: string,
  httpStatus: number | null = null,
): AppError {
  const code = fault?.code ?? null;
  const message = fault?.message ?? null;
  const rule = CODE_RULES.find((r) => r.match.test(code ?? '') || r.match.test(message ?? ''));

  return new AppError(rule?.code ?? 'PROVIDER_INTEGRATION_ERROR', {
    providerError: buildProviderError({ operation, providerCode: code, providerMessage: message, httpStatus }),
    metadata: { operation },
  });
}
