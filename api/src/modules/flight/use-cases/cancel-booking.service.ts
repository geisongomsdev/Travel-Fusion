import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { ProviderRegistry } from '../../providers/provider.registry';
import { ProviderTicket, RequestContext } from '../../providers/provider.types';
import { CancelBookingDto } from '../dto/booking.dto';

export interface CancelBookingResult {
  locator: string;
  /**
   * Vocabulário do modelo, em maiúsculas. `CANCELLED` é o sucesso canônico;
   * `PENDING` é aceito-e-ainda-não-fechado — não é falha, e não autoriza
   * tentar de novo. Recusa de verdade vira erro HTTP, não um status aqui.
   */
  status: 'CANCELLED' | 'PENDING';
  /**
   * 🔴 O EFEITO observado, que NÃO é o status. `VOID` anula o bilhete e não
   * devolve dinheiro; `REFUND` devolve. Quem atende o passageiro precisa dos
   * dois para explicar o que aconteceu com a passagem dele.
   */
  outcome: 'VOID' | 'REFUND' | 'PROCESSED' | 'UNKNOWN';
  provider: string;
  /** Instante em que reconhecemos a resposta da companhia. */
  cancelledAt: string;
  message: string | null;
  /**
   * 🔴 `false` até o CUPOM provar o contrário. O `OrderCancelRS` de sucesso não
   * diz nada sobre documento — publicar `true` a partir dele afirmaria uma
   * anulação que ninguém confirmou.
   */
  eticketsCancelled: boolean;
  /** `amount`, não `total`: é o vocabulário do modelo nesta rota. */
  refund: { amount: number; currency: string | null; status: string } | null;
  tickets: ProviderTicket[];
  /** Estado CRU, para reconciliação. Extensão declarada. */
  providerStatus: string | null;
}

@Injectable()
export class CancelBookingService {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * Cancelar a reserva.
   *
   * 🔴 Mutação não idempotente. O provedor roda sem retry: se a resposta se
   * perder, o caminho é o `/retrieve`, nunca cancelar de novo — a primeira
   * chamada pode ter valido.
   *
   * O envelope é montado AQUI, num lugar só: toda chave existe sempre, com
   * `null` onde a companhia não informa.
   */
  async execute(dto: CancelBookingDto, context: RequestContext = {}): Promise<CancelBookingResult> {
    // Sem chave de oferta para dizer de quem é a reserva, quem manda é
    // `options.provider`; sem ele, o padrão da instância.
    const provider = dto.options?.provider
      ? this.registry.get(dto.options.provider)
      : this.registry.default();

    /**
     * Duas condições, e as duas importam: o provedor pode DECLARAR que cancela
     * e ainda assim não ter o método. Checar só a capability deixaria passar um
     * `undefined is not a function` disfarçado de erro de provedor.
     */
    if (!provider.supports.cancelBooking || typeof provider.cancelBooking !== 'function') {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'cancelBooking' } });
    }

    const cancelled = await provider.cancelBooking(dto.cancel.booking.locator, context);

    return {
      locator: cancelled.locator,
      status: cancelled.status === 'cancelled' ? 'CANCELLED' : 'PENDING',
      outcome: cancelled.outcome,
      provider: provider.name,
      cancelledAt: new Date().toISOString(),
      // O RS de sucesso não fornece mensagem canônica.
      message: null,
      eticketsCancelled: cancelled.eticketsCancelled,
      refund: cancelled.refund
        ? {
            amount: cancelled.refund.total,
            currency: cancelled.refund.currency,
            /**
             * 🔴 `REQUESTED` — pedido aceito, NÃO liquidação financeira. A
             * companhia confirma o cancelamento muito antes de o dinheiro
             * voltar, e chamar isso de `REFUNDED` faria a tela prometer um
             * estorno que ainda não aconteceu.
             */
            status: 'REQUESTED',
          }
        : null,
      tickets: cancelled.tickets,
      providerStatus: cancelled.rawStatus,
    };
  }
}
