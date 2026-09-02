import {
  ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppError, ProviderErrorWindow } from '../errors/app-error';

const MESSAGE_MAX_LENGTH = 400;
const CODE_MAX_LENGTH = 120;

// Defesa em profundidade: mensagem de provedor não deveria carregar segredo, mas
// fault serializado já vazou token em captura real. Redigir ANTES de truncar.
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/((?:authorization|x[-_]?api[-_]?key|api[-_]?key|secret|senha|password|token)\s*[=:]\s*)[^\s,;"'<>]+/gi, '$1[REDACTED]'],
  [/\bBasic\s+[A-Za-z0-9+/=]{8,}\b/g, '[REDACTED]'],
  [/\bBearer\s+[A-Za-z0-9._-]{8,}\b/g, '[REDACTED]'],
];

function sanitize(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  let out = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out.length > maxLength ? `${out.slice(0, maxLength)}…` : out;
}

function sanitizeProviderError(window: ProviderErrorWindow | null): ProviderErrorWindow | null {
  if (!window?.provider) return null;
  return {
    provider: window.provider,
    operation: window.operation ?? null,
    providerCode: sanitize(window.providerCode, CODE_MAX_LENGTH),
    providerMessage: sanitize(window.providerMessage, MESSAGE_MAX_LENGTH),
    providerSeverity: window.providerSeverity ?? null,
    httpStatus: window.httpStatus ?? null,
  };
}

/**
 * Traduz qualquer falha para o corpo de erro do contrato (02-erros.md §1).
 *
 * 🔴 O payload cru do provedor NUNCA entra no corpo da resposta — vai só para o
 * log, ligado pelo `correlationId`. Campos opcionais são OMITIDOS, não emitidos
 * como `null`.
 */
@Catch()
export class ContractExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ContractExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();
    const correlationId = request.correlationId ?? null;

    // O cru vai para o LOG, com o correlationId — e só para o log.
    this.logger.error({ err: exception, correlationId, url: request.url });

    const appError = this.normalize(exception);
    const providerError = sanitizeProviderError(appError.providerError);

    const body: Record<string, unknown> = {
      success: false,
      error: { code: appError.code, category: appError.category },
      message: appError.publicMessage,
      correlationId,
    };

    if (providerError) {
      body.provider = providerError.provider;
      body.providerError = providerError;
    }
    if (appError.details) body.details = appError.details;

    const metadata = Object.fromEntries(
      Object.entries(appError.metadata ?? {}).filter(([, value]) => value !== null && value !== undefined),
    );
    if (Object.keys(metadata).length > 0) body.metadata = metadata;

    // A resposta do /availability já pode ter começado a escrever no stream.
    if (response.headersSent) {
      response.end();
      return;
    }
    response.status(appError.statusCode).json(body);
  }

  private normalize(exception: unknown): AppError {
    if (exception instanceof AppError) return exception;

    // Falha do ValidationPipe: vira o formato details.errors do contrato.
    if (exception instanceof BadRequestException) {
      return new AppError('SEARCH_VALIDATION_ERROR', {
        details: { errors: this.extractValidationErrors(exception) },
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 404) return new AppError('ROUTE_NOT_FOUND');
      if (status === 400) return new AppError('SEARCH_VALIDATION_ERROR');
    }

    return new AppError('UNEXPECTED_ERROR', { cause: exception });
  }

  /**
   * O ValidationPipe devolve `message: string[]` com uma frase por violação. O
   * contrato quer `{campo: [msgs]}` — diagnóstico estruturado, nunca texto cru.
   */
  private extractValidationErrors(exception: BadRequestException): Record<string, string[]> {
    const payload = exception.getResponse() as { message?: unknown };
    const messages = Array.isArray(payload.message) ? (payload.message as string[]) : [];
    const errors: Record<string, string[]> = {};

    for (const message of messages) {
      // class-validator prefixa a mensagem com o caminho do campo.
      const field = message.split(' ')[0] || 'body';
      (errors[field] ??= []).push(message);
    }

    return Object.keys(errors).length > 0 ? errors : { body: ['The request payload is invalid.'] };
  }
}
