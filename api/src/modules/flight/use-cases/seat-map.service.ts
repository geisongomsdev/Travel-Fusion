import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { decodeOfferKey } from '../../../common/utils/offer-key';
import { ProviderRegistry } from '../../providers/provider.registry';
import { RequestContext } from '../../providers/provider.types';
import { SeatMapDto } from '../dto/booking.dto';

export interface SeatMapResult {
  provider: string;
  currency: string | null;
  segments: unknown[];
}

@Injectable()
export class SeatMapService {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * O mapa de assentos da oferta.
   *
   * 🔴 DIVERGÊNCIA CONSCIENTE do contrato canônico, e ela está no README: o
   * `09-assentos.md` endereça o mapa pelo LOCALIZADOR, porque assume que a
   * escolha é pós-reserva. Na LATAM o `/seats/availability` responde pela
   * OFERTA — a escolha é anterior, e o localizador ainda não existe.
   *
   * Endereçar pelo identifier é o que torna a operação utilizável de verdade;
   * inventar um localizador para caber no formato seria pior.
   */
  async execute(dto: SeatMapDto, context: RequestContext = {}): Promise<SeatMapResult> {
    const key = decodeOfferKey(dto.identifier);
    if (!key) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        details: { errors: { identifier: ['Identificador de oferta inválido ou expirado.'] } },
        metadata: { operation: 'seatMap' },
      });
    }

    const provider = this.registry.get(key.p);

    if (!provider.supports.seatMap || typeof provider.seatMap !== 'function') {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'seatMap' } });
    }

    const map = await provider.seatMap(key, context);

    return {
      provider: provider.name,
      currency: map.currency,
      /**
       * `segments: []` é resposta VÁLIDA — o normalizador degrada em vez de
       * lançar quando o mapa vem ilegível, e a tela mostra "indisponível".
       * O envelope do contrato já embrulha isto em `data`; embrulhar aqui
       * também produzia `data.data`.
       */
      segments: map.segments,
    };
  }
}
