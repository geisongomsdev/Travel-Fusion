import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { decodeOfferKey } from '../../../common/utils/offer-key';
import { ProviderRegistry } from '../../providers/provider.registry';
import {
  ProviderSeatMapSegment, RequestContext,
} from '../../providers/provider.types';
import { OfferCatalogDto } from '../dto/booking.dto';

export interface SeatMapResult {
  provider: string;
  /**
   * 🔴 `null` aqui, e de propósito: este mapa é da OFERTA, e a reserva ainda
   * não existe. O modelo endereça pelo localizador porque assume escolha
   * pós-reserva; na LATAM a escolha é anterior. Quem quer o mapa da reserva
   * emitida usa o `/order-seat-map`, que preenche este campo.
   */
  locator: string | null;
  fareId: string;
  currency: string | null;
  paymentRequired: boolean | null;
  passengers: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    assignedSeats: Array<{ segmentId: string | null; seat: string | null }> | null;
  }>;
  segments: ProviderSeatMapSegment[];
}

@Injectable()
export class SeatMapService {
  constructor(private readonly registry: ProviderRegistry) {}

  async execute(dto: OfferCatalogDto, context: RequestContext = {}): Promise<SeatMapResult> {
    const key = decodeOfferKey(dto.fareId);
    if (!key) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'seatMap' },
        details: { errors: { fareId: ['Identificador de oferta inválido ou expirado.'] } },
      });
    }

    const provider = this.registry.get(key.p);

    if (!provider.supports.seatMap || typeof provider.seatMap !== 'function') {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'seatMap' } });
    }

    const map = await provider.seatMap(key, context);

    return {
      provider: provider.name,
      locator: null,
      fareId: dto.fareId,
      currency: map.currency,
      paymentRequired: map.paymentRequired,
      passengers: map.passengers,
      /**
       * `segments: []` é resposta VÁLIDA — o normalizador degrada em vez de
       * lançar quando o mapa vem ilegível, e a tela mostra "indisponível".
       */
      segments: map.segments,
    };
  }
}
