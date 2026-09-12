import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { expiryToMMYY } from '../../../common/utils/card';
import { ProviderRegistry } from '../../providers/provider.registry';
import {
  ProviderCard, ProviderFinancing, ProviderTicket, RequestContext,
} from '../../providers/provider.types';
import { CreditCardDto, FinancingOptionsDto, IssueDto } from '../dto/booking.dto';

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

export interface FinancingResult {
  provider: string;
  locator: string;
  cardBrand: string | null;
  currency: string | null;
  options: ProviderFinancing['options'];
}

export interface IssueResult {
  provider: string;
  locator: string;
  /** A companhia aceitou e gravou. Nunca `null`. */
  committed: boolean;
  /** 🔴 Prova estruturada de documento emitido. `null` = a prova não existe ainda. */
  confirmed: boolean | null;
  queued: boolean;
  amount: { currency: string; total: number };
  authorizationCode: string | null;
  tickets: ProviderTicket[];
  emds: ProviderTicket[];
  messages: string[];
  providerStatus: string | null;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(private readonly registry: ProviderRegistry) {}

  async financingOptions(dto: FinancingOptionsDto, context: RequestContext = {}): Promise<FinancingResult> {
    const provider = dto.options?.provider
      ? this.registry.get(dto.options.provider)
      : this.registry.default();

    if (!provider.supports.financingOptions || typeof provider.financingOptions !== 'function') {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'financingOptions' } });
    }

    const financing = await provider.financingOptions(
      dto.booking.locator,
      dto.payment.creditCard.number,
      context,
    );

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
  async issue(dto: IssueDto, context: RequestContext = {}): Promise<IssueResult> {
    const provider = dto.options?.provider
      ? this.registry.get(dto.options.provider)
      : this.registry.default();

    if (!provider.supports.issue || typeof provider.issue !== 'function') {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'issue' } });
    }

    const { booking, payment } = dto.issue;

    /**
     * 🔴 O valor a cobrar é PERGUNTADO à companhia, não aceito de quem chamou.
     * Confiar no número do corpo é a maneira mais fácil de cobrar errado — e o
     * erro só aparece no extrato do passageiro. Quem manda `billedAmount` está
     * declarando o que espera; se divergir do que a companhia diz, a cobrança
     * não acontece.
     */
    const current = await provider.retrieve(booking.locator, context);
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

    if (payment.billedAmount !== undefined && Math.abs(payment.billedAmount - expected) > 0.01) {
      throw new AppError('FARE_PRICE_CHANGED', {
        metadata: { operation: 'issue' },
        details: {
          errors: {
            'issue.payment.billedAmount': [
              `A companhia cobra ${expected}; o pedido declarou ${payment.billedAmount}.`,
            ],
          },
        },
      });
    }

    const currency = current.currency ?? payment.currency ?? 'BRL';

    const issued = await provider.issue(
      booking.locator,
      {
        card: toProviderCard(payment.creditCard),
        billing: payment.billing,
        payer: payerOf(payment.creditCard, 'issue.payment.creditCard'),
        amount: { total: expected, currency },
        installmentId: payment.installmentId ?? null,
      },
      context,
    );

    // Só o localizador e a correlação — nunca o meio de pagamento.
    this.logger.log({ operation: 'issue', locator: issued.locator, correlationId: context.correlationId });

    return {
      provider: provider.name,
      locator: issued.locator,
      committed: issued.committed,
      confirmed: issued.confirmed,
      queued: issued.queued,
      amount: { currency, total: expected },
      authorizationCode: issued.authorizationCode,
      tickets: issued.tickets,
      emds: issued.emds,
      messages: issued.messages,
      providerStatus: issued.rawStatus,
    };
  }
}

/** O cartão do contrato no vocabulário da fronteira. */
export function toProviderCard(card: CreditCardDto): ProviderCard {
  return {
    brand: card.brand,
    holder: card.holderName,
    number: card.number,
    securityCode: card.cvv,
    // 🔴 `MM/YYYY` → `MMAA`: seis dígitos onde a companhia espera quatro é
    // recusa de pagamento, e o motivo não aparece na mensagem de erro.
    expiration: expiryToMMYY(card.expiryDate),
  };
}

/**
 * Quem PAGA, a partir dos dados do titular.
 *
 * 🔴 A LATAM exige `Payer` com CPF e data de nascimento — sem eles devolve
 * `400113007 PaymentProcessingDetails.Payer is mandatory`. A recusa acontece
 * aqui, antes da rede, com o campo que falta nomeado: deixar a companhia
 * recusar transformaria um corpo incompleto num erro de integração.
 */
export function payerOf(card: CreditCardDto, path: string) {
  if (!card.holderDocument || !card.holderBirthDate) {
    throw new AppError('SEARCH_VALIDATION_ERROR', {
      metadata: { operation: 'issue' },
      details: {
        errors: {
          [`${path}.holderDocument`]: ['Obrigatório: a companhia exige o documento do titular para cobrar.'],
          [`${path}.holderBirthDate`]: ['Obrigatório: a companhia exige a data de nascimento do titular.'],
        },
      },
    });
  }

  const parts = card.holderName.trim().split(/\s+/);

  return {
    firstName: parts[0] ?? card.holderName,
    lastName: parts.slice(1).join(' ') || parts[0] || card.holderName,
    dateOfBirth: card.holderBirthDate,
    documentNumber: card.holderDocument,
  };
}
