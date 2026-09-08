import { lookupError, ErrorCategory, ErrorCode } from './error-codes';

/** Janela sanitizada do erro do provedor — shape estável de 6 chaves (02-erros §3). */
export interface ProviderErrorWindow {
  provider: string;
  operation: string | null;
  providerCode: string | null;
  providerMessage: string | null;
  providerSeverity: string | null;
  httpStatus: number | null;
}

export interface AppErrorOptions {
  details?: unknown;
  providerError?: ProviderErrorWindow | null;
  metadata?: Record<string, unknown> | null;
  cause?: unknown;
}

/**
 * Erro de domínio já mapeado para o catálogo.
 *
 * Não estende HttpException de propósito: o status vem do catálogo, não do
 * construtor, e é o filtro global que traduz para HTTP. Assim não existe caminho
 * em que alguém escolha um status que o contrato não prevê.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly category: ErrorCategory;
  readonly statusCode: number;
  readonly publicMessage: string;
  readonly details: unknown;
  readonly providerError: ProviderErrorWindow | null;
  readonly metadata: Record<string, unknown> | null;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    const resolved = lookupError(code);
    super(resolved.message);
    this.name = 'AppError';
    this.code = resolved.code;
    this.category = resolved.category;
    this.statusCode = resolved.status;
    this.publicMessage = resolved.message;
    this.details = options.details ?? null;
    this.providerError = options.providerError ?? null;
    this.metadata = options.metadata ?? null;
    this.cause = options.cause;
  }
}

export const notSupported = (operation: string): AppError =>
  new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation } });
