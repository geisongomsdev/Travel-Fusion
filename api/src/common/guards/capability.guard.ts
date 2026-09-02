import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FlightOperation, supportsOperation } from '../capabilities';
import { notSupported } from '../errors/app-error';

export const CAPABILITY_KEY = 'flight:capability';

/** Marca a operação do contrato que a rota implementa. */
export const Capability = (operation: FlightOperation) => SetMetadata(CAPABILITY_KEY, operation);

/**
 * 🔴 A checagem de capability roda ANTES de validar o corpo (01-convencoes §8).
 * Invertida, um /issue com body vazio responderia "payload inválido" — verdade
 * acidental que esconde o motivo real e manda quem chamou procurar no lugar errado.
 *
 * No Nest isso sai de graça: guards rodam antes dos pipes. É por isso que a
 * checagem é um guard e não um `if` dentro do handler.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const operation = this.reflector.getAllAndOverride<FlightOperation | undefined>(
      CAPABILITY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!operation) return true;
    if (supportsOperation(operation)) return true;

    throw notSupported(operation);
  }
}
