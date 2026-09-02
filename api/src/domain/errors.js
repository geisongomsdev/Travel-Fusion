import { lookupError } from '../constants/error-codes.js';

/**
 * Erro de domínio já mapeado para o catálogo. O `providerError` é anexado no ponto
 * de detecção; só o presenter publica, e sempre sanitizado.
 */
export class AppError extends Error {
  constructor(code, { details = null, providerError = null, metadata = null, cause = null } = {}) {
    const resolved = lookupError(code);
    super(resolved.message);
    this.name = 'AppError';
    this.code = resolved.code;
    this.category = resolved.category;
    this.statusCode = resolved.status;
    this.publicMessage = resolved.message;
    this.details = details;
    this.providerError = providerError;
    this.metadata = metadata;
    this.cause = cause;
  }
}

export const notSupported = (operation) =>
  new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation } });
