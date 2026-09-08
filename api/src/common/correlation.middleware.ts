import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * O `correlationId` é a única ponte entre a resposta de erro e o log com o
 * detalhe cru. Por isso nasce cedo, antes de qualquer handler, e acompanha a
 * requisição inteira.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request & { correlationId?: string }, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-correlation-id'];
    req.correlationId = typeof incoming === 'string' && incoming ? incoming : randomUUID();
    res.setHeader('x-correlation-id', req.correlationId);
    next();
  }
}
