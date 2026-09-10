import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { ProviderRegistry } from '../../providers/provider.registry';
import { RequestContext } from '../../providers/provider.types';
import { CancelBookingDto } from '../dto/booking.dto';

export interface CancelBookingResult {
  locator: string;
  connector: string;
  data: Record<string, unknown>;
}

@Injectable()
export class CancelBookingService {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * Cancelar a reserva.
   *
   * 🔴 Mutação não idempotente, e a única do contrato além do `/booking`. O
   * provedor roda sem retry: se a resposta se perder, o caminho é o `/retrieve`,
   * nunca cancelar de novo — a primeira chamada pode ter valido.
   *
   * O envelope é montado AQUI, num lugar só, pela mesma razão do `/retrieve`:
   * toda chave existe sempre, com `null` onde a companhia não informa.
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

    const cancelled = await provider.cancelBooking(dto.booking.locator, context);

    return {
      locator: cancelled.locator,
      connector: provider.name,
      data: {
        status: cancelled.status,
        rawStatus: cancelled.rawStatus,
        /**
         * 🔴 `pending` NÃO é cancelado. A companhia aceitou o pedido e ainda não
         * fechou — quem consome tem que consultar o `/retrieve`, e não assumir
         * que o assento voltou.
         */
        cancelled: cancelled.status === 'cancelled',
        refund: cancelled.refund
          ? { total: cancelled.refund.total, currency: cancelled.refund.currency }
          : null,
        provider: { code: provider.name, locator: cancelled.locator },
      },
    };
  }
}
