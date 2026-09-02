import { AppError } from '../../../domain/errors.js';

const PROVIDER = 'travelfusion';
const MESSAGE_MAX_LENGTH = 400;
const CODE_MAX_LENGTH = 120;

// Defesa em profundidade: mensagem de provedor não deveria carregar segredo, mas
// fault serializado já vazou token em captura real. Redigir ANTES de truncar.
const SECRET_PATTERNS = [
  /((?:authorization|x[-_]?api[-_]?key|api[-_]?key|secret|senha|password|token)\s*[=:]\s*)[^\s,;"'<>]+/gi,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/g,
];

function sanitizeText(value, maxLength) {
  if (typeof value !== 'string') return null;
  let out = value;
  out = out.replace(SECRET_PATTERNS[0], '$1[REDACTED]');
  out = out.replace(SECRET_PATTERNS[1], '[REDACTED]');
  out = out.replace(SECRET_PATTERNS[2], '[REDACTED]');
  return out.length > maxLength ? `${out.slice(0, maxLength)}…` : out;
}

/**
 * Janela sanitizada do erro do provedor — 02-erros.md §3.
 *
 * 🔴 O payload cru da Travelfusion NUNCA entra no corpo da resposta. Vai só para
 * o log, ligado pelo correlationId. Shape estável de 6 chaves.
 */
function buildSanitizedProviderError(providerError) {
  if (!providerError?.provider) return null;
  return {
    provider: providerError.provider,
    operation: providerError.operation ?? null,
    providerCode: sanitizeText(providerError.providerCode, CODE_MAX_LENGTH),
    providerMessage: sanitizeText(providerError.providerMessage, MESSAGE_MAX_LENGTH),
    providerSeverity: providerError.providerSeverity ?? null,
    httpStatus: providerError.httpStatus ?? null,
  };
}

export function presentError(error, { correlationId = null, durationMs = null } = {}) {
  const appError = error instanceof AppError ? error : new AppError('UNEXPECTED_ERROR', { cause: error });
  const providerError = buildSanitizedProviderError(appError.providerError);
  // Omitir chave de valor nulo: metadata vazio é AUSENTE, não {}.
  const metadata = Object.fromEntries(
    Object.entries({ ...(appError.metadata || {}), ...(durationMs !== null ? { duration: durationMs } : {}) })
      .filter(([, value]) => value !== null && value !== undefined),
  );

  // Campos opcionais são OMITIDOS, não emitidos como null.
  const body = {
    success: false,
    error: { code: appError.code, category: appError.category },
    message: appError.publicMessage,
    correlationId,
  };
  if (providerError) {
    body.provider = PROVIDER;
    body.providerError = providerError;
  }
  if (appError.details) body.details = appError.details;
  if (Object.keys(metadata).length > 0) body.metadata = metadata;

  return { statusCode: appError.statusCode, body };
}
