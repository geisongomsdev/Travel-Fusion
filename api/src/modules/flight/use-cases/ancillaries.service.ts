import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { decodeOfferKey } from '../../../common/utils/offer-key';
import { ProviderRegistry } from '../../providers/provider.registry';
import {
  CatalogPassenger, CatalogSegment, ProviderAncillary, RequestContext,
} from '../../providers/provider.types';
import { AncillariesDto } from '../dto/booking.dto';

export interface AncillariesResult {
  provider: string;
  /** `null` pela mesma razão do /seat-map: o catálogo é da OFERTA. */
  locator: string | null;
  fareId: string;
  currency: string | null;
  passengers: CatalogPassenger[];
  segments: CatalogSegment[];
  offers: ProviderAncillary[];
}

@Injectable()
export class AncillariesService {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * Os opcionais vendidos à parte da tarifa.
   *
   * 🔴 Mesma divergência do `/seat-map`, e pela mesma razão: na LATAM o
   * `/services/list` responde pela OFERTA, e o catálogo é anterior à reserva.
   *
   * A Travelfusion responde 501 — lá os opcionais já saem no `/quote`, dentro
   * de `requiredParameters`. Duplicá-los numa rota separada faria a mesma coisa
   * chegar por dois caminhos com formatos diferentes.
   */
  async execute(dto: AncillariesDto, context: RequestContext = {}): Promise<AncillariesResult> {
    const { fareId, type, passengers, segments } = dto.ancillaries;

    const key = decodeOfferKey(fareId);
    if (!key) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'ancillaries' },
        details: { errors: { 'ancillaries.fareId': ['Identificador de oferta inválido ou expirado.'] } },
      });
    }

    const provider = this.registry.get(key.p);

    if (!provider.supports.ancillaries || typeof provider.ancillaries !== 'function') {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'ancillaries' } });
    }

    const catalog = await provider.ancillaries(key, context);

    /**
     * Os filtros do pedido são aplicados AQUI, sobre o catálogo já normalizado.
     *
     * 🔴 Oferta sem `passengerId`/`segmentId` vale para TODOS — `null` ali
     * significa "a viagem inteira", não "nenhum". Filtrá-la fora esconderia a
     * bagagem que cobre o itinerário completo justamente de quem pediu um
     * trecho específico.
     */
    const offers = catalog.offers.filter((offer) => {
      if (type && offer.type !== null && offer.type !== type) return false;
      if (passengers?.length && offer.passengerId !== null && !passengers.includes(offer.passengerId)) return false;
      if (segments?.length && offer.segmentId !== null && !segments.includes(offer.segmentId)) return false;
      return true;
    });

    return {
      provider: provider.name,
      locator: null,
      fareId,
      currency: catalog.currency,
      passengers: catalog.passengers,
      segments: catalog.segments,
      // Lista vazia é resposta válida: o voo pode não ter opcional nenhum.
      offers,
    };
  }
}
