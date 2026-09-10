import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { roundMoney } from '../../../common/utils/money';
import { ProviderRegistry } from '../../providers/provider.registry';
import { FlightProvider, RequestContext } from '../../providers/provider.types';
import { OrderCatalogDto, SellAncillariesDto } from '../dto/booking.dto';

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
      currency: map.currency,
      segments: map.segments,
    };
  }

  /** O catálogo de opcionais da reserva emitida. */
  async ancillaries(dto: OrderCatalogDto, context: RequestContext = {}) {
    const provider = this.providerOf(dto);

    if (typeof provider.ancillariesForOrder !== 'function') {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'ancillaries' } });
    }

    const items = await provider.ancillariesForOrder(dto.booking.locator, context);

    return { provider: provider.name, locator: dto.booking.locator, ancillaries: items };
  }

  /**
   * Comprar o que foi escolhido.
   *
   * 🔴 O valor NÃO vem do corpo: é somado a partir do catálogo da própria
   * reserva, item por item. Aceitar um total de quem chama seria deixar o preço
   * da cobrança ser decidido fora da companhia.
   */
  async execute(dto: SellAncillariesDto, context: RequestContext = {}) {
    const provider = this.providerOf(dto);

    if (!provider.supports.sellAncillaries || typeof provider.sellAncillaries !== 'function') {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'sellAncillaries' } });
    }

    const catalog = await this.catalogOf(provider, dto.booking.locator, context);
    const unknown: string[] = [];
    let currency: string | null = null;
    let total = 0;

    for (const item of dto.items) {
      const priced = catalog.get(item.offerItemId);
      if (!priced) {
        unknown.push(item.offerItemId);
        continue;
      }

      total += priced.total;
      currency = currency ?? priced.currency;
    }

    /**
     * Um id fora do catálogo é recusado ANTES da rede. Mandá-lo assim mesmo
     * faria a LATAM rotear o pedido para o fluxo de TROCA DE VOO, que é outra
     * operação inteiramente sobre a mesma reserva — o roteamento é feito pelo
     * prefixo do id, não por um campo de intenção.
     */
    if (unknown.length > 0) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'sellAncillaries' },
        details: {
          errors: {
            items: [
              `Estes opcionais não estão no catálogo desta reserva: ${unknown.join(', ')}. `
              + 'Releia o catálogo antes de comprar — a lista muda a cada consulta.',
            ],
          },
        },
      });
    }

    // A soma é sempre finita — os preços do catálogo já vieram numéricos.
    total = roundMoney(total) ?? total;

    /**
     * Assento cortesia soma zero, e aí não há o que cobrar — a própria LATAM
     * liquida por BSP nesse caso. Fora disso o cartão é obrigatório, e dizer
     * isso aqui é melhor do que deixar a companhia recusar depois.
     */
    if (total > 0 && (!dto.card || !dto.payer)) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'sellAncillaries' },
        details: {
          errors: {
            card: [`Os opcionais escolhidos somam ${total}; cartão e titular são obrigatórios.`],
          },
        },
      });
    }

    const result = await provider.sellAncillaries(
      dto.booking.locator,
      {
        items: dto.items.map((item) => ({
          offerItemId: item.offerItemId,
          paxId: item.paxId,
          seat: item.row && item.column ? { row: item.row, column: item.column } : null,
        })),
        amount: { total, currency: currency ?? 'BRL' },
        card: total > 0 && dto.card
          ? {
              brand: dto.card.brand,
              holder: dto.card.holder,
              number: dto.card.number,
              securityCode: dto.card.securityCode,
              // A LATAM quer `MMAA` sem separador; a tela usa `MM/AA`.
              expiration: dto.card.expiration.replace('/', ''),
            }
          : null,
        payer: total > 0 && dto.payer ? dto.payer : null,
      },
      context,
    );

    // Localizador e correlação — nunca o meio de pagamento.
    this.logger.log({
      operation: 'sellAncillaries',
      locator: result.locator,
      items: dto.items.length,
      correlationId: context.correlationId,
    });

    return {
      provider: provider.name,
      locator: result.locator,
      confirmed: result.status === 'confirmed',
      status: result.status,
      rawStatus: result.rawStatus,
      charged: { total, currency: currency ?? 'BRL' },
      services: result.services,
      orderTotal: result.total,
    };
  }

  /**
   * Assentos e opcionais chegam por DUAS mensagens, e a compra aceita os dois
   * no mesmo pedido — então o preço precisa ser procurável num índice só.
   */
  private async catalogOf(
    provider: FlightProvider,
    locator: string,
    context: RequestContext,
  ): Promise<Map<string, { total: number; currency: string | null }>> {
    const index = new Map<string, { total: number; currency: string | null }>();

    const [seats, extras] = await Promise.all([
      typeof provider.seatMapForOrder === 'function'
        ? provider.seatMapForOrder(locator, context)
        : Promise.resolve(null),
      typeof provider.ancillariesForOrder === 'function'
        ? provider.ancillariesForOrder(locator, context)
        : Promise.resolve([]),
    ]);

    for (const segment of seats?.segments ?? []) {
      for (const cabin of segment.cabins) {
        for (const row of cabin.rows) {
          for (const seat of row.seats) {
            if (!seat.offerItemId) continue;
            // Assento sem preço é cortesia, e cortesia soma zero — não é falta de dado.
            index.set(seat.offerItemId, {
              total: seat.price?.total ?? 0,
              currency: seat.price?.currency ?? null,
            });
          }
        }
      }
    }

    for (const extra of extras) {
      if (!extra.offerItemId) continue;
      index.set(extra.offerItemId, {
        total: extra.price?.total ?? 0,
        currency: extra.price?.currency ?? null,
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
