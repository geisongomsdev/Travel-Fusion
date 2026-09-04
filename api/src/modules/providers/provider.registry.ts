import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { env } from '../../config/env';
import { LatamProvider } from './latam/latam.provider';
import { TravelfusionProvider } from './travelfusion/travelfusion.provider';
import { FlightProvider } from './provider.types';

/**
 * Quem está no ar e em que ordem.
 *
 * A lista vem do env (`PROVIDERS`), não de constante: ligar ou desligar um
 * provedor em produção — por exemplo, tirar a Travelfusion do ar enquanto o IP
 * não é whitelistado — não pode exigir deploy.
 */
@Injectable()
export class ProviderRegistry {
  private readonly byName = new Map<string, FlightProvider>();

  constructor(travelfusion: TravelfusionProvider, latam: LatamProvider) {
    for (const provider of [travelfusion, latam]) {
      this.byName.set(provider.name, provider);
    }
  }

  /** Habilitados, na ordem declarada em `PROVIDERS`. */
  enabled(): FlightProvider[] {
    return env.providers
      .map((name) => this.byName.get(name))
      .filter((provider): provider is FlightProvider => provider !== undefined);
  }

  /**
   * Os provedores que atendem esta requisição.
   *
   * 🔴 Pedir provedor que não existe é erro de QUEM CHAMOU (400), não busca
   * vazia: devolver zero resultado faria parecer que não há voo, quando o que
   * houve foi um nome errado.
   */
  resolve(requested?: string[] | null): FlightProvider[] {
    const enabled = this.enabled();
    if (!requested || requested.length === 0) return enabled;

    const wanted = requested.map((name) => name.trim().toLowerCase());
    const unknown = wanted.filter((name) => !this.byName.has(name));

    if (unknown.length > 0) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        details: {
          errors: {
            'options.provider': [
              `Provedor desconhecido: ${unknown.join(', ')}. Disponíveis: ${[...this.byName.keys()].join(', ')}.`,
            ],
          },
        },
      });
    }

    const selected = enabled.filter((provider) => wanted.includes(provider.name));
    if (selected.length === 0) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        details: {
          errors: {
            'options.provider': [`Provedor não habilitado nesta instância: ${wanted.join(', ')}.`],
          },
        },
      });
    }
    return selected;
  }

  /** Um provedor pelo nome — o caminho de quem chega com chave de oferta. */
  get(name: string | null | undefined): FlightProvider {
    const provider = name ? this.byName.get(name.trim().toLowerCase()) : undefined;
    if (provider) return provider;

    throw new AppError('SEARCH_VALIDATION_ERROR', {
      details: {
        errors: {
          identifier: ['O identificador não aponta para um provedor conhecido. Refaça a busca.'],
        },
      },
    });
  }

  /** O padrão de quem não escolheu: o primeiro da lista. */
  default(): FlightProvider {
    const [first] = this.enabled();
    if (first) return first;

    throw new AppError('PROVIDER_UNAVAILABLE', { metadata: { operation: 'providers' } });
  }
}
