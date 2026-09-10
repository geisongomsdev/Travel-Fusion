import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { ProviderRegistry } from '../../providers/provider.registry';
import { RequestContext } from '../../providers/provider.types';
import { FinancingOptionsDto, IssueDto } from '../dto/booking.dto';

/**
 * Parcelamento e pagamento.
 *
 * 🔴 DADO DE CARTÃO PASSA POR AQUI. Três regras que valem para todo este
 * arquivo, e é por isso que ele é um só:
 *
 *   1. nada de cartão é logado — nem PAN, nem CVV, nem mascarado;
 *   2. nada é guardado: o dado existe na variável e morre com a requisição;
 *   3. nada de cartão volta na resposta.
 *
 * Se um dia precisar de log de auditoria, o que se registra é o
 * `correlationId` e o localizador, nunca o meio de pagamento.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(private readonly registry: ProviderRegistry) {}

  async financingOptions(dto: FinancingOptionsDto, context: RequestContext = {}) {
    const provider = dto.options?.provider
      ? this.registry.get(dto.options.provider)
      : this.registry.default();

    if (!provider.supports.financingOptions || typeof provider.financingOptions !== 'function') {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'financingOptions' } });
    }

    const financing = await provider.financingOptions(dto.booking.locator, dto.card, context);

    return {
      provider: provider.name,
      locator: dto.booking.locator,
      cardBrand: financing.cardBrand,
      currency: financing.currency,
      // Lista vazia é resposta válida: o cartão pode não aceitar parcelamento.
      options: financing.options,
    };
  }

  /**
   * Pagar. Esta é a operação mais cara de errar do contrato inteiro.
   */
  async issue(dto: IssueDto, context: RequestContext = {}) {
    const provider = dto.options?.provider
      ? this.registry.get(dto.options.provider)
      : this.registry.default();

    if (!provider.supports.issue || typeof provider.issue !== 'function') {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'issue' } });
    }

    /**
     * 🔴 O valor a cobrar é PERGUNTADO à companhia, não aceito de quem chamou.
     * Confiar no número do corpo é a maneira mais fácil de cobrar errado — e o
     * erro só aparece no extrato do passageiro. Quem manda um `amount` está
     * declarando o que espera; se divergir do que a companhia diz, a cobrança
     * não acontece.
     */
    const current = await provider.retrieve(dto.booking.locator, context);
    const expected = current.total;

    if (expected === null) {
      throw new AppError('PROVIDER_INTEGRATION_ERROR', {
        metadata: { operation: 'issue' },
        providerError: {
          provider: provider.name,
          operation: 'issue',
          providerCode: 'NO_TOTAL',
          providerMessage: 'A companhia não informou o total da ordem; o pagamento não foi tentado.',
          providerSeverity: null,
          httpStatus: null,
        },
      });
    }

    if (dto.amount && Math.abs(dto.amount.total - expected) > 0.01) {
      throw new AppError('FARE_PRICE_CHANGED', {
        metadata: { operation: 'issue' },
        details: {
          errors: {
            amount: [`A companhia cobra ${expected}; o pedido declarou ${dto.amount.total}.`],
          },
        },
      });
    }

    const issued = await provider.issue(
      dto.booking.locator,
      {
        card: {
          brand: dto.card.brand,
          holder: dto.card.holder,
          number: dto.card.number,
          securityCode: dto.card.securityCode,
          // A LATAM quer `MMAA` sem separador; a tela usa `MM/AA`.
          expiration: dto.card.expiration.replace('/', ''),
        },
        billing: dto.billing,
        payer: dto.payer,
        amount: { total: expected, currency: current.currency ?? 'BRL' },
        installmentId: dto.installmentId ?? null,
      },
      context,
    );

    // Só o localizador e a correlação — nunca o meio de pagamento.
    this.logger.log({ operation: 'issue', locator: issued.locator, correlationId: context.correlationId });

    return {
      provider: provider.name,
      locator: issued.locator,
      /** 🔴 `pending` NÃO é emitido: consulte o `/retrieve` antes de reemitir. */
      issued: issued.status === 'issued',
      status: issued.status,
      rawStatus: issued.rawStatus,
      amount: { total: expected, currency: current.currency ?? 'BRL' },
      tickets: issued.tickets,
    };
  }
}
