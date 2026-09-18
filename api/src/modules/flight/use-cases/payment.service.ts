import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { expiryToMMYY } from '../../../common/utils/card';
import { ProviderRegistry } from '../../providers/provider.registry';
import {
  ProviderCard, ProviderPayment, ProviderTicket, RequestContext,
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

type Money = { currency: string | null; total: number };

/** Um plano de parcelamento — 11-emissao.md §2.3. */
export interface FinancingPlan {
  installments: number | null;
  /** 🔴 O identificador que volta no /issue, em `creditCard.financingId`. */
  financingId: string | number | null;
  cardBrand: { code: string | null; name: string | null } | null;
  /** O único fato sobre juros que dá para afirmar sem adivinhar o período. */
  interestFree: boolean | null;
  interest: { monthlyPercent: number | null; amount: Money | null };
  installmentAmount: Money | null;
  firstInstallmentAmount: Money | null;
  totalAmount: Money | null;
}

export interface FinancingResult {
  provider: string;
  locator: string;
  currency: string | null;
  /** `provider` = cotação real da companhia; `static-rules` = tabela documentada. */
  source: 'provider' | 'static-rules';
  minInstallmentAmount: Money | null;
  plans: FinancingPlan[];
}

/** Um documento emitido — 11-emissao.md §3.7. */
export interface IssuedDocument {
  ticketNumber: string | null;
  type: ProviderTicket['type'];
  passengerId: string | null;
  passengerName: string | null;
  status: 'issued' | 'failed' | 'voided' | 'refunded' | 'unknown';
  providerStatus: string | null;
  issueDate: string | null;
  cancelToken: string | null;
  company: { code: string | null; name: string | null };
  amount: Money | null;
  message: string | null;
}

export interface IssueResult {
  provider: string;
  locator: string;
  /** A companhia aceitou e gravou. Nunca `null`. */
  committed: boolean;
  /** 🔴 A companhia DEVOLVEU o número do bilhete. `null` = a prova não existe ainda. */
  confirmed: boolean | null;
  queued: boolean;
  /** O que foi REALMENTE cobrado. */
  amount: Money | null;
  authorizationCode: string | null;
  tickets: IssuedDocument[];
  emds: IssuedDocument[];
  messages: Array<{ code: string | null; text: string }>;
}

/**
 * O status do documento no vocabulário do contrato.
 *
 * 🔴 Fora do mapa vira `unknown`, NUNCA `issued`: assumir emissão a partir de um
 * status que não se reconhece é reportar uma venda que não existe.
 */
const DOCUMENT_STATUS: Record<string, IssuedDocument['status']> = {
  issued: 'issued', failed: 'failed', voided: 'voided', cancelled: 'voided', refunded: 'refunded',
};

const toDocument = (ticket: ProviderTicket): IssuedDocument => ({
  ticketNumber: ticket.ticketNumber,
  type: ticket.type,
  passengerId: ticket.passengerId,
  passengerName: ticket.passengerName,
  status: DOCUMENT_STATUS[ticket.status ?? ''] ?? 'unknown',
  providerStatus: ticket.providerStatus,
  issueDate: ticket.issueDate,
  // A LATAM anula pelo próprio número do bilhete: não há token.
  cancelToken: null,
  company: { code: null, name: null },
  amount: ticket.amount,
  message: null,
});

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

    const { booking, payment } = dto.financingOptions;
    const financing = await provider.financingOptions(booking.locator, payment.creditCard.number, context);
    const currency = financing.currency ?? dto.options?.currency ?? null;
    const money = (total: number | null): Money | null => (total === null ? null : { currency, total });
    const brand = financing.cardBrand ? { code: financing.cardBrand, name: null } : null;

    return {
      provider: provider.name,
      locator: booking.locator,
      currency,
      // A LATAM cota ao vivo, na operadora — não é tabela.
      source: 'provider',
      minInstallmentAmount: null,
      // Lista vazia é resposta válida: o valor pode estar abaixo da parcela mínima.
      plans: financing.options.map((option) => ({
        installments: option.installments,
        financingId: option.id,
        cardBrand: brand,
        /**
         * 🔴 A LATAM informa uma taxa sem dizer de que PERÍODO. Publicá-la como
         * "mensal" seria um número errado na tela — o que dá para afirmar é
         * se há juros ou não.
         */
        interestFree: option.interestRate === null ? null : option.interestRate === 0,
        interest: {
          monthlyPercent: null,
          amount: option.total !== null && option.interestRate === 0 ? money(0) : null,
        },
        installmentAmount: money(option.installmentAmount),
        // A LATAM não distingue a primeira parcela: igualá-la às demais seria um palpite.
        firstInstallmentAmount: null,
        totalAmount: money(option.total),
      })),
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

    const currency = current.currency ?? 'BRL';

    const issued = await provider.issue(
      booking.locator,
      {
        card: toProviderCard(payment.creditCard),
        billing: billingOf(payment.creditCard, 'issue.payment.creditCard'),
        payer: payerOf(payment.creditCard, 'issue.payment.creditCard'),
        amount: { total: expected, currency },
        installmentId: payment.creditCard.financingId === undefined ? null : String(payment.creditCard.financingId),
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
      tickets: issued.tickets.map(toDocument),
      emds: issued.emds.map(toDocument),
      // Avisos crus da companhia, repassados sem tradução.
      messages: issued.messages,
    };
  }
}

/** O cartão do contrato no vocabulário da fronteira. */
export function toProviderCard(card: CreditCardDto): ProviderCard {
  return {
    brand: String(card.brand),
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
  if (!card.holderCpf || !card.holderBirthdate) {
    throw new AppError('SEARCH_VALIDATION_ERROR', {
      metadata: { operation: 'issue' },
      details: {
        errors: {
          [`${path}.holderCpf`]: ['Obrigatório: a companhia exige o CPF do titular para cobrar.'],
          [`${path}.holderBirthdate`]: ['Obrigatório: a companhia exige a data de nascimento do titular.'],
        },
      },
    });
  }

  const parts = card.holderName.trim().split(/\s+/);

  return {
    firstName: parts[0] ?? card.holderName,
    lastName: parts.slice(1).join(' ') || parts[0] || card.holderName,
    dateOfBirth: card.holderBirthdate,
    documentNumber: card.holderCpf,
  };
}

/**
 * O endereço de cobrança, a partir do cartão.
 *
 * 🔴 O `/order/change/payment` da LATAM exige `ContactInfo` de cobrança com
 * e-mail e endereço postal. A recusa acontece aqui, com os campos nomeados.
 */
export function billingOf(card: CreditCardDto, path: string): ProviderPayment['billing'] {
  const address = card.billingAddress;
  const missing = [
    !card.holderEmail && 'holderEmail',
    !address?.zipCode && 'billingAddress.zipCode',
    !address?.street && 'billingAddress.street',
    !address?.country && 'billingAddress.country',
  ].filter((field): field is string => Boolean(field));

  if (missing.length > 0) {
    throw new AppError('SEARCH_VALIDATION_ERROR', {
      metadata: { operation: 'issue' },
      details: {
        errors: Object.fromEntries(
          missing.map((field) => [`${path}.${field}`, ['Obrigatório: a companhia exige para cobrar no cartão.']]),
        ),
      },
    });
  }

  return {
    email: card.holderEmail!,
    countryCode: address!.country!,
    postalCode: address!.zipCode!,
    street: address!.street!,
  };
}
