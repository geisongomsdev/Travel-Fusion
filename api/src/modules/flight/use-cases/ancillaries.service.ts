import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { decodeOfferKey } from '../../../common/utils/offer-key';
import { ProviderRegistry } from '../../providers/provider.registry';
import {
  CatalogSegment, FlightProvider, ProviderAncillary, ProviderAncillaryCatalog, RequestContext,
} from '../../providers/provider.types';
import { AncillariesDto } from '../dto/booking.dto';

/** O PTC da companhia no vocabulário do contrato. O que não reconhece é `null`. */
const PASSENGER_TYPES: Record<string, 'adult' | 'child' | 'infant'> = {
  ADT: 'adult', ADULT: 'adult', CHD: 'child', CNN: 'child', CHILD: 'child', INF: 'infant', INFANT: 'infant',
};

/** A resposta do /ancillaries — 10-ancillaries.md §1.2. */
export interface AncillariesResult {
  provider: string;
  /** `null` no catálogo da OFERTA: a reserva ainda não existe. */
  locator: string | null;
  currency: string | null;
  passengers: Array<{ id: string; firstName: string | null; lastName: string | null; type: 'adult' | 'child' | 'infant' | null }>;
  segments: CatalogSegment[];
  offers: ProviderAncillary[];
}

@Injectable()
export class AncillariesService {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * Os opcionais vendidos à parte da tarifa, pela RESERVA (`booking`, o
   * contrato) ou pela OFERTA (`fareId`, extensão — a mesma do /seat-map).
   *
   * A Travelfusion responde 501 — lá os opcionais já saem no `/quote`, dentro
   * de `requiredParameters`.
   */
  async execute(dto: AncillariesDto, context: RequestContext = {}): Promise<AncillariesResult> {
    const { booking, fareId, type, passengers, segments } = dto.ancillaries;

    if (Boolean(booking) === Boolean(fareId)) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'ancillaries' },
        details: { errors: { ancillaries: ['Mande ancillaries.booking (reserva) ou ancillaries.fareId (oferta), um dos dois.'] } },
      });
    }

    let provider: FlightProvider;
    let catalog: ProviderAncillaryCatalog;

    if (booking) {
      provider = dto.options?.provider ? this.registry.get(dto.options.provider) : this.registry.default();
      if (!provider.supports.ancillaries || typeof provider.ancillariesForOrder !== 'function') {
        throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'ancillaries' } });
      }
      catalog = await provider.ancillariesForOrder(booking.locator, context);
    } else {
      const key = decodeOfferKey(fareId);
      if (!key) {
        throw new AppError('SEARCH_VALIDATION_ERROR', {
          metadata: { operation: 'ancillaries' },
          details: { errors: { 'ancillaries.fareId': ['Identificador de oferta inválido ou expirado.'] } },
        });
      }
      provider = this.registry.get(key.p);
      if (!provider.supports.ancillaries || typeof provider.ancillaries !== 'function') {
        throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'ancillaries' } });
      }
      catalog = await provider.ancillaries(key, context);
    }

    /**
     * Os filtros do pedido são aplicados AQUI, sobre o catálogo já normalizado.
     *
     * 🔴 `type` é ESTRITO: oferta que a companhia não classificou (`type: null`)
     * não casa com `baggage` e sai — consultar sem `type` vê mais ofertas.
     *
     * 🔴 Já `passengerId`/`segmentId` nulos valem para TODOS — ali `null`
     * significa "a viagem inteira", não "nenhum".
     */
    const offers = catalog.offers.filter((offer) => {
      if (type && offer.type !== type) return false;
      if (passengers?.length && offer.passengerId !== null && !passengers.includes(offer.passengerId)) return false;
      if (segments?.length && offer.segmentId !== null && !segments.includes(offer.segmentId)) return false;
      return true;
    });

    return {
      provider: provider.name,
      locator: booking?.locator ?? null,
      /** A moeda da primeira oferta com preço; senão a pedida; senão `null`. */
      currency: offers.find((offer) => offer.price?.currency)?.price?.currency
        ?? catalog.currency
        ?? dto.options?.currency
        ?? null,
      passengers: catalog.passengers.map((passenger) => ({
        id: passenger.id,
        firstName: passenger.firstName,
        lastName: passenger.lastName,
        type: PASSENGER_TYPES[String(passenger.type ?? '').toUpperCase()] ?? null,
      })),
      segments: catalog.segments,
      // Lista vazia é resposta válida: o voo pode não ter opcional nenhum.
      offers,
    };
  }
}
