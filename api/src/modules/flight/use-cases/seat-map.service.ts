import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { decodeOfferKey } from '../../../common/utils/offer-key';
import { ProviderRegistry } from '../../providers/provider.registry';
import {
  FlightProvider, ProviderSeatMap, ProviderSeatMapSegment, RequestContext,
} from '../../providers/provider.types';
import { SeatMapDto } from '../dto/booking.dto';

/** A resposta do /seat-map — 09-assentos.md §1.2. */
export interface SeatMapResult {
  provider: string;
  /** `null` no mapa da OFERTA: a reserva ainda não existe. */
  locator: string | null;
  currency: string | null;
  paymentRequired: boolean | null;
  passengers: ProviderSeatMap['passengers'];
  segments: ProviderSeatMapSegment[];
}

@Injectable()
export class SeatMapService {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * O mapa da RESERVA (`seatMap.booking`, o contrato) ou da OFERTA
   * (`seatMap.fareId`, extensão). Read-only: não marca nada.
   *
   * 🔴 São catálogos diferentes: as chaves do mapa da oferta morrem na
   * emissão, e só as do mapa da reserva servem para comprar depois dela.
   */
  async execute(dto: SeatMapDto, context: RequestContext = {}): Promise<SeatMapResult> {
    const { booking, fareId, segments, passengers } = dto.seatMap;

    if (Boolean(booking) === Boolean(fareId)) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'seatMap' },
        details: { errors: { seatMap: ['Mande seatMap.booking (mapa da reserva) ou seatMap.fareId (mapa da oferta), um dos dois.'] } },
      });
    }

    let provider: FlightProvider;
    let map: ProviderSeatMap;

    if (booking) {
      provider = this.providerOf(dto.options?.provider);
      if (!provider.supports.seatMap || typeof provider.seatMapForOrder !== 'function') {
        throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'seatMap' } });
      }
      map = await provider.seatMapForOrder(booking.locator, context);
    } else {
      const key = decodeOfferKey(fareId);
      if (!key) {
        throw new AppError('SEARCH_VALIDATION_ERROR', {
          metadata: { operation: 'seatMap' },
          details: { errors: { 'seatMap.fareId': ['Identificador de oferta inválido ou expirado.'] } },
        });
      }
      provider = this.registry.get(key.p);
      if (!provider.supports.seatMap || typeof provider.seatMap !== 'function') {
        throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'seatMap' } });
      }
      map = await provider.seatMap(key, context);
    }

    const segmentIds = segments?.map((segment) => segment.id);
    const passengerIds = passengers?.map((passenger) => passenger.id);

    return {
      provider: provider.name,
      locator: booking?.locator ?? null,
      currency: map.currency,
      paymentRequired: map.paymentRequired,
      passengers: passengerIds
        ? map.passengers.filter((passenger) => passengerIds.includes(passenger.id))
        : map.passengers,
      /**
       * `segments: []` é resposta VÁLIDA — o normalizador degrada em vez de
       * lançar quando o mapa vem ilegível, e a tela mostra "indisponível".
       */
      segments: segmentIds
        ? map.segments.filter((segment) => segmentIds.includes(segment.segmentId ?? ''))
        : map.segments,
    };
  }

  /** Sem chave de oferta, quem diz a companhia é `options.provider`; sem ele, o padrão. */
  private providerOf(name: string | undefined): FlightProvider {
    return name ? this.registry.get(name) : this.registry.default();
  }
}
