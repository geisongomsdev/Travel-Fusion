import { presentError } from './presenters/error.presenter.js';
import { AppError } from '../../domain/errors.js';

export function globalErrorHandler(error, request, reply) {
  const correlationId = request.id || null;

  // O cru vai para o LOG, com o correlationId — e só para o log.
  request.log?.error?.({ err: error, correlationId }, 'request failed');

  const normalized = error?.validation
    ? new AppError('SEARCH_VALIDATION_ERROR', {
        details: { errors: Object.fromEntries(error.validation.map((v) => [v.instancePath.replace(/^\//, '') || 'body', [v.message]])) },
      })
    : error;

  const { statusCode, body } = presentError(normalized, { correlationId });
  reply.code(statusCode).send(body);
}

export function notFoundHandler(request, reply) {
  const { statusCode, body } = presentError(new AppError('ROUTE_NOT_FOUND'), { correlationId: request.id || null });
  reply.code(statusCode).send(body);
}
