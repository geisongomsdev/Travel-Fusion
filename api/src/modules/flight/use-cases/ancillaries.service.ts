import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { decodeOfferKey } from '../../../common/utils/offer-key';
import { ProviderRegistry } from '../../providers/provider.registry';
import { RequestContext } from '../../providers/provider.types';
import { SeatMapDto } from '../dto/booking.dto';

@Injectable()
export class AncillariesService {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * Os opcionais vendidos à parte da tarifa.
   *
   * 🔴 Mesma divergência do `/seat-map`, e pela mesma razão: na LATAM o
   * `/services/list` responde pela OFERTA, e o catálogo é anterior à reserva.
   * O `identifier` faz o papel do localizador.
   *
   * A Travelfusion responde 501 — lá os opcionais já saem no `/quote`, dentro
   * de `requiredParameters`. Duplicá-los numa rota separada faria a mesma coisa
   * chegar por dois caminhos com formatos diferentes.
   */
  async execute(dto: SeatMapDto, context: RequestContext = {}) {
    const key = decodeOfferKey(dto.identifier);
    if (!key) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        details: { errors: { identifier: ['Identificador de oferta inválido ou expirado.'] } },
        metadata: { operation: 'ancillaries' },
      });
    }

    const provider = this.registry.get(key.p);

    if (!provider.supports.ancillaries || typeof provider.ancillaries !== 'function') {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'ancillaries' } });
    }

    const items = await provider.ancillaries(key, context);

    return {
      provider: provider.name,
      // Lista vazia é resposta válida: o voo pode não ter opcional nenhum.
      ancillaries: items,
    };
  }
}
