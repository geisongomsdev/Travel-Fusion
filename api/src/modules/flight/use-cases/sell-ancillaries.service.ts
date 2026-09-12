import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { roundMoney } from '../../../common/utils/money';
import { decodeServiceKey } from '../../../common/utils/service-key';
import { ProviderRegistry } from '../../providers/provider.registry';
import {
  CatalogPassenger, CatalogSegment, FlightProvider, ProviderAncillary,
  ProviderSeatMapSegment, RequestContext,
} from '../../providers/provider.types';
import { MarkSeatsDto, OrderCatalogDto, SellAncillariesDto } from '../dto/booking.dto';
import { payerOf, toProviderCard } from './payment.service';

/**
 * Assento e bagagem DEPOIS da emissão.
 *
 * 🔴 Por que isto não vive junto do `/seat-map`: são catálogos diferentes. O
 * mapa da oferta serve para escolher antes de reservar e devolve ids que
 * morrem na emissão; este responde pela reserva e devolve os ids que a compra
 * pós-emissão exige. Misturar os dois é o erro que a LATAM recusa com
 * `INVALID_OFFER_TYPES: Mixed type offers are not supported`.
 *
 * 🔴 DADO DE CARTÃO PASSA POR AQUI: nada logado, nada guardado, nada devolvido.
 */

export interface SoldAncillary {
  key: string;
  passengerId: string;
  segmentId: string | null;
  type: string | null;
  /** O rótulo do catálogo. Sem ele, o comprovante mostra uma chave opaca. */
  name: string | null;
  /** `booked` = pendente; `issued` = EMD emitido; `failed` = recusado. */
  status: 'booked' | 'issued' | 'failed' | null;
  price: { currency: string | null; total: number } | null;
  emdNumber: string | null;
  message: string | null;
}

export interface SellAncillariesResult {
  provider: string;
  locator: string;
  committed: boolean;
  /** 🔴 `null` = a companhia respondeu "ok" e não devolveu prova do serviço. */
  confirmed: boolean | null;
  amount: { currency: string; total: number };
  items: SoldAncillary[];
  providerStatus: string | null;
}

/** O que o catálogo sabe de um item, indexado pela chave opaca. */
interface CatalogEntry {
  price: { total: number; currency: string | null } | null;
  type: string | null;
  name: string | null;
}

@Injectable()
export class SellAncillariesService {
  private readonly logger = new Logger(SellAncillariesService.name);

  constructor(private readonly registry: ProviderRegistry) {}

  /** O catálogo de assentos da reserva emitida. */
  async seatMap(dto: OrderCatalogDto, context: RequestContext = {}) {
    const provider = this.providerOf(dto);

    if (typeof provider.seatMapForOrder !== 'function') {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'seatMap' } });
    }

    const map = await provider.seatMapForOrder(dto.booking.locator, context);

    return {
      provider: provider.name,
      locator: dto.booking.locator,
      fareId: null,
      currency: map.currency,
      paymentRequired: map.paymentRequired,
      passengers: map.passengers,
      segments: map.segments as ProviderSeatMapSegment[],
    };
  }

  /** O catálogo de opcionais da reserva emitida. */
  async ancillaries(dto: OrderCatalogDto, context: RequestContext = {}) {
    const provider = this.providerOf(dto);

    if (typeof provider.ancillariesForOrder !== 'function') {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'ancillaries' } });
    }

    const catalog = await provider.ancillariesForOrder(dto.booking.locator, context);

    return {
      provider: provider.name,
      locator: dto.booking.locator,
      fareId: null,
      currency: catalog.currency,
      passengers: catalog.passengers as CatalogPassenger[],
      segments: catalog.segments as CatalogSegment[],
      offers: catalog.offers as ProviderAncillary[],
    };
  }

  /**
   * Marcar assentos numa reserva emitida.
   *
   * 🔴 Marcar e comprar são a MESMA operação na LATAM: o assento é confirmado
   * no mesmo pedido em que é cobrado, e não existe segurá-lo sem pagar.
   *
   * 🔴 O contrato endereça o assento pelo DESIGNADOR (`12A`) — que é o que a
   * pessoa escolheu na tela — e a companhia vende por `OfferItemID`. A tradução
   * acontece aqui, relendo o mapa da própria reserva: deixar quem consome
   * carregar a chave do catálogo transformaria "marcar o 12A" em duas chamadas
   * e um acoplamento ao formato interno da LATAM.
   */
  async markSeats(dto: MarkSeatsDto, context: RequestContext = {}): Promise<SellAncillariesResult> {
    const provider = this.providerOf(dto);
    const { booking, seats, payment } = dto.markSeats;

    if (typeof provider.seatMapForOrder !== 'function') {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'markSeats' } });
    }

    const map = await provider.seatMapForOrder(booking.locator, context);

    /** `segmento|designador` → o assento do mapa, que carrega a chave de venda. */
    const byDesignator = new Map<string, { key: string; row: string | null; column: string | null }>();
    for (const segment of map.segments) {
      for (const cabin of segment.cabins) {
        for (const row of cabin.rows) {
          for (const seat of row.seats) {
            if (!seat.key || !seat.seat) continue;
            byDesignator.set(`${segment.segmentId ?? ''}|${seat.seat}`, {
              key: seat.key,
              row: seat.row,
              column: seat.column,
            });
          }
        }
      }
    }

    const missing: string[] = [];
    const items = seats.map((choice) => {
      const found = byDesignator.get(`${choice.segmentId}|${choice.seat}`);
      if (!found) {
        missing.push(`${choice.seat} (${choice.segmentId})`);
        return null;
      }
      return {
        key: found.key,
        passengerId: choice.passengerId,
        segmentId: choice.segmentId,
        type: 'seat',
        row: found.row ?? undefined,
        column: found.column ?? undefined,
      };
    });

    /**
     * Assento fora do mapa é recusado ANTES da rede — é a mesma regra do
     * contrato para marcação: melhor não oferecer do que oferecer e falhar
     * depois, porque o passageiro não tem como saber que o lugar já era de outro.
     */
    if (missing.length > 0) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'markSeats' },
        details: {
          errors: {
            'markSeats.seats': [
              `Estes assentos não estão disponíveis no mapa desta reserva: ${missing.join(', ')}.`,
            ],
          },
        },
      });
    }

    return this.execute(
      {
        options: dto.options,
        sellAncillaries: {
          booking,
          items: items.filter((item): item is NonNullable<typeof item> => item !== null),
          payment: payment?.creditCard ? { creditCard: payment.creditCard } : undefined,
        },
      } as SellAncillariesDto,
      context,
    );
  }

  /**
   * Comprar o que foi escolhido.
   *
   * 🔴 O valor NÃO vem do corpo: é somado a partir do catálogo da própria
   * reserva, item por item. Aceitar um total de quem chama seria deixar o preço
   * da cobrança ser decidido fora da companhia.
   */
  async execute(dto: SellAncillariesDto, context: RequestContext = {}): Promise<SellAncillariesResult> {
    const provider = this.providerOf(dto);
    const { booking, items, payment } = dto.sellAncillaries;

    if (!provider.supports.sellAncillaries || typeof provider.sellAncillaries !== 'function') {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'sellAncillaries' } });
    }

    const catalog = await this.catalogOf(provider, booking.locator, context);
    const unknown: string[] = [];
    let currency: string | null = null;
    let total = 0;

    for (const item of items) {
      const priced = catalog.get(item.key);
      if (!priced) {
        unknown.push(item.key);
        continue;
      }

      total += priced.price?.total ?? 0;
      currency = currency ?? priced.price?.currency ?? null;
    }

    /**
     * Uma chave fora do catálogo é recusada ANTES da rede. Mandá-la assim mesmo
     * faria a LATAM rotear o pedido para o fluxo de TROCA DE VOO, que é outra
     * operação inteiramente sobre a mesma reserva — o roteamento é feito pelo
     * prefixo do id, não por um campo de intenção.
     */
    if (unknown.length > 0) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'sellAncillaries' },
        details: {
          errors: {
            'sellAncillaries.items': [
              `Estes opcionais não estão no catálogo desta reserva: ${unknown.join(', ')}. `
              + 'Releia o catálogo antes de comprar — a lista muda a cada consulta.',
            ],
          },
        },
      });
    }

    // A soma é sempre finita — os preços do catálogo já vieram numéricos.
    total = roundMoney(total) ?? total;
    const card = payment?.creditCard ?? null;

    /**
     * Assento cortesia soma zero, e aí não há o que cobrar — a própria LATAM
     * liquida por BSP nesse caso. Fora disso o cartão é obrigatório, e dizer
     * isso aqui é melhor do que deixar a companhia recusar depois.
     */
    if (total > 0 && !card) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'sellAncillaries' },
        details: {
          errors: {
            'sellAncillaries.payment.creditCard': [
              `Os opcionais escolhidos somam ${total}; o cartão é obrigatório.`,
            ],
          },
        },
      });
    }

    const result = await provider.sellAncillaries(
      booking.locator,
      {
        items: items.map((item) => {
          // A chave já foi validada contra o catálogo — decodificar não falha aqui.
          const decoded = decodeServiceKey(item.key)!;
          return {
            offerItemId: decoded.o,
            serviceId: decoded.s ?? null,
            paxId: item.passengerId,
            seat: item.row && item.column ? { row: item.row, column: item.column } : null,
          };
        }),
        amount: { total, currency: currency ?? 'BRL' },
        card: total > 0 && card ? toProviderCard(card) : null,
        payer: total > 0 && card ? payerOf(card, 'sellAncillaries.payment.creditCard') : null,
      },
      context,
    );

    // Localizador e correlação — nunca o meio de pagamento.
    this.logger.log({
      operation: 'sellAncillaries',
      locator: result.locator,
      items: items.length,
      correlationId: context.correlationId,
    });

    /**
     * A resposta é montada a partir do que foi PEDIDO, cruzada com o que a
     * companhia devolveu. Publicar só o que ela devolveu esconderia um item que
     * sumiu no caminho — e sumir em silêncio é o pior resultado possível numa
     * operação que já cobrou o cartão.
     */
    const sold = new Map(result.services.map((service) => [service.offerItemId ?? '', service]));

    return {
      provider: provider.name,
      locator: result.locator,
      committed: result.committed,
      confirmed: result.confirmed,
      amount: { currency: currency ?? 'BRL', total },
      items: items.map((item) => {
        const decoded = decodeServiceKey(item.key)!;
        const service = sold.get(decoded.o) ?? null;
        const priced = catalog.get(item.key);

        return {
          key: item.key,
          passengerId: item.passengerId,
          segmentId: service?.segmentId ?? item.segmentId ?? null,
          type: item.type ?? priced?.type ?? null,
          name: service?.name ?? priced?.name ?? null,
          // Item que não voltou na resposta não é sucesso: é falha.
          status: service?.status ?? (result.confirmed === null ? null : 'failed'),
          price: priced?.price
            ? { currency: priced.price.currency, total: priced.price.total }
            : null,
          emdNumber: service?.emdNumber ?? null,
          message: service?.message ?? null,
        };
      }),
      providerStatus: result.rawStatus,
    };
  }

  /**
   * Assentos e opcionais chegam por DUAS mensagens, e a compra aceita os dois
   * no mesmo pedido — então o preço precisa ser procurável num índice só,
   * pela mesma chave opaca que quem consome recebeu.
   */
  private async catalogOf(
    provider: FlightProvider,
    locator: string,
    context: RequestContext,
  ): Promise<Map<string, CatalogEntry>> {
    const index = new Map<string, CatalogEntry>();

    const [seats, extras] = await Promise.all([
      typeof provider.seatMapForOrder === 'function'
        ? provider.seatMapForOrder(locator, context)
        : Promise.resolve(null),
      typeof provider.ancillariesForOrder === 'function'
        ? provider.ancillariesForOrder(locator, context)
        : Promise.resolve(null),
    ]);

    for (const segment of seats?.segments ?? []) {
      for (const cabin of segment.cabins) {
        for (const row of cabin.rows) {
          for (const seat of row.seats) {
            if (!seat.key) continue;
            // Assento sem preço é cortesia, e cortesia soma zero — não é falta de dado.
            index.set(seat.key, {
              price: seat.price ?? { total: 0, currency: null },
              type: 'seat',
              name: seat.commercialName ?? (seat.seat ? `Assento ${seat.seat}` : null),
            });
          }
        }
      }
    }

    for (const offer of extras?.offers ?? []) {
      if (!offer.key) continue;
      index.set(offer.key, {
        price: offer.price ?? { total: 0, currency: null },
        type: offer.type,
        name: offer.name,
      });
    }

    return index;
  }

  private providerOf(dto: { options?: { provider?: string } }): FlightProvider {
    return dto.options?.provider
      ? this.registry.get(dto.options.provider)
      : this.registry.default();
  }
}
