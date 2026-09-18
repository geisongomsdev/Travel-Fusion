import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { roundMoney } from '../../../common/utils/money';
import { decodeServiceKey } from '../../../common/utils/service-key';
import { ProviderRegistry } from '../../providers/provider.registry';
import {
  FlightProvider, ProviderAncillaryPurchaseResult, ProviderPurchasedService, RequestContext,
} from '../../providers/provider.types';
import { CreditCardDto, MarkSeatsDto, SellAncillariesDto } from '../dto/booking.dto';
import { payerOf, toProviderCard } from './payment.service';

/**
 * Assento e bagagem DEPOIS da emissão.
 *
 * 🔴 Os catálogos lidos aqui são os da RESERVA (`seatMapForOrder`,
 * `ancillariesForOrder`): os ids do catálogo da oferta morrem na emissão, e
 * misturar os dois é o erro que a LATAM recusa com `INVALID_OFFER_TYPES`.
 *
 * 🔴 DADO DE CARTÃO PASSA POR AQUI: nada logado, nada guardado, nada devolvido.
 */

type Money = { currency: string | null; total: number };

/** Um item do `/sell-ancillaries` — 10-ancillaries.md §3.2. */
export interface SoldAncillary {
  key: string;
  passengerId: string;
  segmentId: string | null;
  type: string | null;
  /** `booked` = pendurado; `issued` = documento emitido nesta chamada; `failed` = recusado. */
  status: 'booked' | 'issued' | 'failed';
  price: Money | null;
  documentNumber: string | null;
  message: string | null;
  /** Extensão declarada: o rótulo do catálogo. Sem ele, o comprovante mostra uma chave opaca. */
  name: string | null;
}

export interface SellAncillariesResult {
  provider: string;
  locator: string;
  committed: boolean;
  /** 🔴 `null` = a companhia respondeu "ok" e não devolveu prova do serviço. */
  confirmed: boolean | null;
  /** O que foi movimentado AGORA. */
  amount: Money | null;
  items: SoldAncillary[];
}

/** Um assento do `/mark-seats` — 09-assentos.md §2.2. */
export interface MarkedSeat {
  passengerId: string | null;
  /** 🔴 Eco do PEDIDO: é a chave que quem consome tem na tela. */
  segmentId: string | null;
  seat: string | null;
  status: 'assigned' | 'failed';
  price: Money | null;
  message: string | null;
}

export interface MarkSeatsResult {
  provider: string;
  locator: string | null;
  committed: boolean;
  confirmed: boolean | null;
  amount: Money | null;
  seats: MarkedSeat[];
}

/** O que o catálogo sabe de um item, indexado pela chave opaca. */
interface CatalogEntry {
  price: { total: number; currency: string | null } | null;
  type: string | null;
  name: string | null;
}

/** Um item pronto para a companhia: a chave do catálogo e, em assento, a poltrona. */
interface PurchaseItem {
  key: string;
  passengerId: string;
  row?: string;
  column?: string;
}

interface Purchase {
  provider: FlightProvider;
  result: ProviderAncillaryPurchaseResult;
  catalog: Map<string, CatalogEntry>;
  /** Por item pedido, na ordem do pedido: o que a companhia devolveu dele. */
  services: Array<ProviderPurchasedService | null>;
  amount: Money;
}

/** Designador de assento: fileira + coluna, sem separador. */
const DESIGNATOR = /^\d{1,3}[A-Z]$/;

const businessRule = (operation: string, errors: Record<string, string[]>): AppError =>
  new AppError('BUSINESS_RULE_VIOLATION', { metadata: { operation }, details: { errors } });

@Injectable()
export class SellAncillariesService {
  private readonly logger = new Logger(SellAncillariesService.name);

  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * Marcar assentos numa reserva emitida — 09-assentos.md §2.
   *
   * 🔴 Marcar e comprar são a MESMA operação na LATAM: o assento é confirmado
   * no mesmo pedido em que é cobrado, e não existe segurá-lo sem pagar.
   *
   * 🔴 O contrato endereça o assento pelo DESIGNADOR (`12A`) — o que a pessoa
   * escolheu na tela — e a companhia vende por `OfferItemID`. A tradução
   * acontece aqui, relendo o mapa da própria reserva.
   */
  async markSeats(dto: MarkSeatsDto, context: RequestContext = {}): Promise<MarkSeatsResult> {
    const provider = this.providerOf(dto);
    const { booking, seats, payment } = dto.markSeats;

    if (typeof provider.seatMapForOrder !== 'function' || typeof provider.sellAncillaries !== 'function') {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'assignSeats' } });
    }

    /** Designador malformado (`A12`, `""`) é recusado antes de chamar a companhia. */
    const malformed = seats.filter((choice) => !DESIGNATOR.test(String(choice.seat ?? '').toUpperCase()));
    if (malformed.length > 0) {
      throw businessRule('assignSeats', {
        'markSeats.seats': [`Designador inválido: ${malformed.map((choice) => JSON.stringify(choice.seat)).join(', ')}. Use o formato do mapa, como "24A".`],
      });
    }

    const map = await provider.seatMapForOrder(booking.locator, context);

    /** 🔴 Passageiro que a reserva não tem: verificado ANTES de gravar. */
    const known = new Set(map.passengers.map((passenger) => passenger.id));
    const strangers = seats.filter((choice) => known.size > 0 && !known.has(choice.passengerId));
    if (strangers.length > 0) {
      throw businessRule('assignSeats', {
        'markSeats.seats': [`Passageiro inexistente nesta reserva: ${strangers.map((choice) => choice.passengerId).join(', ')}. A reserva tem ${[...known].join(', ')}.`],
      });
    }

    /** `segmento|designador` → o assento do mapa, que carrega a chave de venda. */
    const byDesignator = new Map<string, { key: string; row: string | null; column: string | null }>();
    for (const segment of map.segments) {
      for (const cabin of segment.cabins) {
        for (const row of cabin.rows) {
          for (const seat of row.seats) {
            if (!seat.key || !seat.seat || !seat.available) continue;
            byDesignator.set(`${segment.segmentId ?? ''}|${seat.seat}`, { key: seat.key, row: seat.row, column: seat.column });
          }
        }
      }
    }

    /**
     * 🔴 Assento fora do mapa (ou já tomado) é 422 ANTES da rede: o preço dele
     * é desconhecido, e marcar "de graça" um lugar que pode ser pago é o que
     * isso evita.
     */
    const missing = seats.filter((choice) => !byDesignator.has(`${choice.segmentId}|${choice.seat.toUpperCase()}`));
    if (missing.length > 0) {
      throw businessRule('assignSeats', {
        'markSeats.seats': [
          `Estes assentos não estão disponíveis no mapa desta reserva: ${missing.map((choice) => `${choice.seat} (${choice.segmentId})`).join(', ')}.`,
        ],
      });
    }

    const items: PurchaseItem[] = seats.map((choice) => {
      const found = byDesignator.get(`${choice.segmentId}|${choice.seat.toUpperCase()}`)!;
      return {
        key: found.key,
        passengerId: choice.passengerId,
        row: found.row ?? undefined,
        column: found.column ?? undefined,
      };
    });

    const purchase = await this.purchase(provider, booking.locator, items, payment?.creditCard, 'assignSeats', context);

    return {
      provider: provider.name,
      locator: purchase.result.locator,
      committed: purchase.result.committed,
      confirmed: purchase.result.confirmed,
      amount: purchase.amount,
      seats: seats.map((choice, index) => {
        const service = purchase.services[index];
        const priced = purchase.catalog.get(items[index].key);
        const failed = service?.status === 'failed' || (!service && purchase.result.confirmed !== null);

        return {
          passengerId: choice.passengerId,
          segmentId: choice.segmentId,
          seat: choice.seat.toUpperCase(),
          status: failed ? 'failed' : 'assigned',
          price: priced?.price ? { currency: priced.price.currency, total: priced.price.total } : null,
          message: failed ? service?.message ?? 'A companhia não devolveu este assento.' : null,
        };
      }),
    };
  }

  /**
   * Vender opcionais — 10-ancillaries.md §3.
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

    const purchase = await this.purchase(
      provider,
      booking.locator,
      items.map((item) => ({ key: item.key, passengerId: item.passengerId, row: item.row, column: item.column })),
      payment?.creditCard,
      'sellAncillaries',
      context,
    );

    /**
     * A resposta é montada a partir do que foi PEDIDO, cruzada com o que a
     * companhia devolveu. Publicar só o que ela devolveu esconderia um item que
     * sumiu no caminho — e sumir em silêncio é o pior resultado possível numa
     * operação que já cobrou o cartão.
     */
    const sold: SoldAncillary[] = items.map((item, index) => {
      const service = purchase.services[index];
      const priced = purchase.catalog.get(item.key);
      /**
       * Item que a companhia devolveu sem estado declarado está na ordem: é
       * `booked`. Item que NÃO voltou numa resposta que ecoa os itens é falha;
       * numa que não ecoa nada (`confirmed: null`), não há como dizer — a
       * gravação foi aceita, e quem prova é o /retrieve.
       */
      const status = service
        ? service.status ?? 'booked'
        : purchase.result.confirmed === null ? 'booked' : 'failed';

      return {
        key: item.key,
        passengerId: item.passengerId,
        segmentId: item.segmentId ?? service?.segmentId ?? null,
        type: item.type ?? priced?.type ?? null,
        status,
        price: priced?.price ? { currency: priced.price.currency, total: priced.price.total } : null,
        documentNumber: service?.emdNumber ?? null,
        message: service?.message ?? (status === 'failed' ? 'A companhia não devolveu este item.' : null),
        name: service?.name ?? priced?.name ?? null,
      };
    });

    /**
     * 🔴 Nenhum item aceito é ERRO — um 200 em que nada aconteceu seria lido
     * como sucesso parcial. Mas só quando a companhia NÃO gravou: com
     * `committed: true` o cartão pode ter sido cobrado, e um erro aqui levaria
     * quem chama a repetir a compra e pagar duas vezes. Nesse caso a resposta é
     * 200 com cada item `failed`, e a verdade sai do /retrieve.
     */
    if (!purchase.result.committed && sold.every((item) => item.status === 'failed')) {
      throw businessRule('sellAncillaries', {
        'sellAncillaries.items': sold.map((item) => `${item.key}: ${item.message}`),
      });
    }

    return {
      provider: provider.name,
      locator: purchase.result.locator,
      committed: purchase.result.committed,
      confirmed: purchase.result.confirmed,
      amount: purchase.amount,
      items: sold,
    };
  }

  /**
   * A compra propriamente dita, comum às duas rotas: preço lido do catálogo da
   * reserva, cartão exigido quando a soma não é zero, uma chamada à companhia.
   */
  private async purchase(
    provider: FlightProvider,
    locator: string,
    items: PurchaseItem[],
    card: CreditCardDto | undefined,
    operation: string,
    context: RequestContext,
  ): Promise<Purchase> {
    const catalog = await this.catalogOf(provider, locator, context);
    const unknown = items.filter((item) => !catalog.has(item.key)).map((item) => item.key);

    /**
     * Uma chave fora do catálogo é recusada ANTES da rede. Mandá-la assim mesmo
     * faria a LATAM rotear o pedido para o fluxo de TROCA DE VOO — o roteamento
     * é feito pelo prefixo do id, não por um campo de intenção.
     */
    if (unknown.length > 0 || items.some((item) => !decodeServiceKey(item.key))) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation },
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

    let currency: string | null = null;
    let sum = 0;
    for (const item of items) {
      const priced = catalog.get(item.key)!;
      sum += priced.price?.total ?? 0;
      currency = currency ?? priced.price?.currency ?? null;
    }
    // A soma é sempre finita — os preços do catálogo já vieram numéricos.
    const total = roundMoney(sum) ?? sum;

    /**
     * Assento cortesia soma zero, e aí não há o que cobrar — a própria LATAM
     * liquida por BSP nesse caso. Fora disso a companhia cobra na hora e exige
     * o cartão: 422, porque o pedido é válido e é a regra dela que o recusa.
     */
    if (total > 0 && !card) {
      throw businessRule(operation, {
        [operation === 'assignSeats' ? 'markSeats.payment.creditCard' : 'sellAncillaries.payment.creditCard']: [
          `Os itens escolhidos somam ${total}; esta companhia cobra na hora e exige o cartão.`,
        ],
      });
    }

    const path = operation === 'assignSeats' ? 'markSeats.payment.creditCard' : 'sellAncillaries.payment.creditCard';
    const result = await provider.sellAncillaries!(
      locator,
      {
        items: items.map((item) => {
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
        payer: total > 0 && card ? payerOf(card, path) : null,
      },
      context,
    );

    // Localizador e correlação — nunca o meio de pagamento.
    this.logger.log({ operation, locator: result.locator, items: items.length, correlationId: context.correlationId });

    const byItem = new Map(result.services.map((service) => [service.offerItemId ?? '', service]));

    return {
      provider,
      result,
      catalog,
      services: items.map((item) => byItem.get(decodeServiceKey(item.key)!.o) ?? null),
      amount: { currency: currency ?? 'BRL', total },
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
