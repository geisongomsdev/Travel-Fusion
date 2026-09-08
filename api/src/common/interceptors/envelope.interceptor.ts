import {
  CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, map } from 'rxjs';
import { env } from '../../config/env';

export const RAW_RESPONSE_KEY = 'flight:rawResponse';

/**
 * Marca a rota que NÃO usa o envelope de três chaves.
 *
 * Duas existem: `/availability` (stream de eventos) e `/retrieve` (envelope
 * próprio, com connector/booking/status/message).
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);

export const OPERATION_KEY = 'flight:operation';
export const Operation = (name: string) => SetMetadata(OPERATION_KEY, name);

/**
 * Envelope de sucesso — 01-convencoes.md §1. Exatamente três chaves no topo.
 *
 * `meta.duration` é o tempo gasto na chamada à companhia. Medimos a requisição
 * inteira porque, nestas rotas, ela é dominada pela chamada ao provedor — e o
 * contrato prefere um número honesto a um campo ausente.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean | undefined>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) return next.handle();

    const operation = this.reflector.getAllAndOverride<string | undefined>(OPERATION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request & { correlationId?: string }>();
    const startedAt = Date.now();

    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
        meta: {
          /**
           * 🔴 O provedor do meta é o que ATENDEU, não uma constante: a resposta
           * já diz de quem veio (o caso de uso devolve `provider`), e publicar
           * um nome fixo faria um /quote da LATAM se anunciar como Travelfusion.
           * Sem essa informação no corpo, cai no padrão da instância.
           */
          provider: (data as { provider?: string } | null)?.provider ?? env.providers[0] ?? null,
          duration: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
          ...(operation ? { operation } : {}),
          ...(request.correlationId ? { correlationId: request.correlationId } : {}),
        },
      })),
    );
  }
}
