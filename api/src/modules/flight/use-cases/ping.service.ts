import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { ProviderRegistry } from '../../providers/provider.registry';
import { RequestContext } from '../../providers/provider.types';
import { PingDto, PingEnvironment } from '../dto/ping.dto';

export interface PingData {
  valid: true;
  provider: string;
  environment: PingEnvironment;
  verification: { method: 'auth' | 'catalog'; scope: 'credential' | 'connection' };
}

/** Teto do contrato: 10 tentativas por minuto, por conta + companhia (§B6). */
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60_000;

@Injectable()
export class PingService {
  /**
   * O teto é POR PROVEDOR: pingar a LATAM não pode consumir a cota da
   * Travelfusion, porque o que o teto protege é o limite de cada companhia.
   *
   * Estado de instância, como os caches de credencial: com várias réplicas isto
   * vira contador compartilhado.
   */
  private readonly attempts = new Map<string, number[]>();

  constructor(private readonly registry: ProviderRegistry) {}

  async execute(request: PingDto, context: RequestContext = {}): Promise<PingData> {
    const provider = request.options?.provider
      ? this.registry.get(request.options.provider)
      : this.registry.default();

    /**
     * 🔴 O teto vem ANTES da sonda e nada é enviado à companhia quando estoura:
     * cada tentativa é uma autenticação real, e falha acumulada bloqueia a conta
     * na companhia (seis senhas erradas desativam o usuário na Travelfusion).
     */
    this.assertUnderLimit(provider.name);

    const verification = await provider.probe(context);

    return {
      // 🔴 Não existe 200 com `valid: false` (§B5): credencial recusada sobe
      // como 401 PROVIDER_AUTHENTICATION_FAILED, vindo do mapa de erro.
      valid: true,
      provider: provider.name,
      environment: request.ping.environment,
      verification,
    };
  }

  private assertUnderLimit(provider: string): void {
    const now = Date.now();
    const window = this.attempts.get(provider) ?? [];
    while (window.length > 0 && now - window[0] >= WINDOW_MS) window.shift();

    if (window.length >= MAX_ATTEMPTS) {
      throw new AppError('RATE_LIMITED', { metadata: { operation: 'ping' } });
    }

    window.push(now);
    this.attempts.set(provider, window);
  }
}
