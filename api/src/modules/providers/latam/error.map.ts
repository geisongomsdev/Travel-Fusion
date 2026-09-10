import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { LATAM } from '../../../config/env';
import { ProviderFault } from '../travelfusion/error.map';
import { asList, text } from '../../../common/xml/xml.util';

/**
 * Erros da LATAM NDC → catálogo do contrato.
 *
 * 🔴 O código da LATAM CARREGA o status HTTP nos três primeiros dígitos:
 * `404122007` é um 404, `409107014` é um 409. Isso dá um mapeamento por família
 * que cobre código novo sem precisar catalogar um a um — o que importa, porque a
 * LATAM adiciona subcódigo sem avisar.
 *
 * A resposta vem com HTTP 200 mesmo no erro em vários casos, então quem manda é
 * o `<Error><Code>`, nunca o status da conexão.
 */
const CLASS_RULES: Record<string, ErrorCode> = {
  '400': 'SEARCH_VALIDATION_ERROR',
  '401': 'PROVIDER_AUTHENTICATION_FAILED',
  '403': 'PROVIDER_AUTHENTICATION_FAILED',
  '404': 'ROUTE_NOT_FOUND',
  '409': 'RESOURCE_CONFLICT',
  '422': 'BUSINESS_RULE_VIOLATION',
  '429': 'RATE_LIMITED',
  '500': 'PROVIDER_INTEGRATION_ERROR',
  '502': 'PROVIDER_INTEGRATION_ERROR',
  '503': 'PROVIDER_UNAVAILABLE',
  '504': 'PROVIDER_TIMEOUT',
};

/**
 * Onde o significado é mais específico que a família. Tem precedência.
 * `404122006/7` são "não voamos essa rota nessa data" — rota inexistente para o
 * contrato, e não recurso sumido.
 */
const CODE_RULES: Array<{ match: RegExp; code: ErrorCode }> = [
  { match: /^40412200[67]$/, code: 'ROUTE_NOT_FOUND' },
  // Preço mudou entre o AirShopping e o OfferPrice: o contrato tem código próprio.
  { match: /^409107014$/, code: 'FARE_PRICE_CHANGED' },
  { match: /^409140008$/, code: 'FARE_UNAVAILABLE' },
  /**
   * 🔴 "Estado da ordem não permite" é CONFLITO, não payload inválido — mesmo
   * quando o código começa em 400. A família diria `SEARCH_VALIDATION_ERROR` e
   * mandaria quem chamou conferir o corpo, que está certo; o problema é que a
   * ordem não está num estado cancelável (ex.: `OPENED`, ainda não paga).
   */
  { match: /^400107002$/, code: 'RESOURCE_CONFLICT' },
  { match: /^933$/, code: 'RESOURCE_CONFLICT' },
  /**
   * 🔴 `400300005` é o valor do opcional divergindo do que a companhia calculou.
   * Isso é preço mudado, não corpo malformado: o catálogo foi lido, o preço
   * mudou entre a leitura e a compra, e quem chamou precisa reler — é
   * exatamente o que `FARE_PRICE_CHANGED` significa no contrato.
   */
  { match: /^400300005$/, code: 'FARE_PRICE_CHANGED' },
  /**
   * 🔴 `409300032 Unsuccessful authorize` é a operadora RECUSANDO a cobrança do
   * opcional. Não é conflito de estado nem erro nosso: nada foi cobrado e nada
   * foi adicionado — a operação é tudo-ou-nada do lado da LATAM.
   */
  { match: /^409300032$/, code: 'PAYMENT_DECLINED' },
  /**
   * A ordem está sendo processada do lado da companhia. Transitório de verdade:
   * some sozinho, e a saída é reler pelo /retrieve, nunca repetir a mutação.
   */
  { match: /^409123018$/, code: 'RESOURCE_CONFLICT' },
];

/**
 * A NDC devolve `<Error>` na raiz da mensagem (irmão de `<Response>`), podendo
 * repetir. Pegamos o primeiro: é ele que descreve a causa; os demais costumam
 * ser detalhamento do mesmo problema.
 */
export function readLatamError(parsed: Record<string, any>): ProviderFault | null {
  const root = parsed && (Object.values(parsed)[0] as Record<string, any> | undefined);
  if (!root || typeof root !== 'object') return null;

  const nodes = [
    ...asList(root.Error),
    ...asList(root.Errors?.Error),
    ...asList(root.Response?.Error),
  ].filter(Boolean);

  if (nodes.length === 0) return null;

  const first = nodes[0] as Record<string, any>;
  return {
    code: text(first?.Code) ?? text(first?.ErrorCode),
    message: text(first?.DescText) ?? text(first?.ShortText) ?? text(first),
  };
}

/**
 * Onde o CÓDIGO não basta e é o TEXTO que diz o que houve.
 *
 * 🔴 A LATAM reaproveita o `933`: ele tanto significa "faltou o
 * ExpectedRefundAmount" quanto "esta ordem não está em estado de anular" — que
 * é o que ela responde quando a passagem JÁ FOI cancelada. O mesmo código com
 * dois sentidos vira, na tela, ou um pedido de corrigir o corpo (que está
 * certo) ou "ainda não dá para cancelar" (quando na verdade já cancelou).
 *
 * Casar no texto é frágil por natureza, então as regras são poucas e só
 * ESTREITAM o significado: sem casar, vale o código, como antes.
 */
const MESSAGE_RULES: Array<{ match: RegExp; code: ErrorCode }> = [
  { match: /not suitable for (the )?void|already (been )?(cancell?ed|voided)|order (is )?cancell?ed/i, code: 'BOOKING_ALREADY_CANCELLED' },
];

export function mapLatamError(
  fault: ProviderFault | null,
  operation: string,
  httpStatus: number | null = null,
): AppError {
  const code = fault?.code ?? null;
  const message = fault?.message ?? null;

  // O texto tem precedência sobre o código: ele é mais específico quando existe.
  const byMessage = message ? MESSAGE_RULES.find((rule) => rule.match.test(message))?.code : undefined;
  const explicit = byMessage ?? CODE_RULES.find((rule) => rule.match.test(code ?? ''))?.code;
  // Família pelo prefixo do próprio código; o status da conexão é só o plano B.
  const byClass = code && /^\d{9}$/.test(code)
    ? CLASS_RULES[code.slice(0, 3)]
    : httpStatus
      ? CLASS_RULES[String(httpStatus)]
      : undefined;

  return new AppError(explicit ?? byClass ?? 'PROVIDER_INTEGRATION_ERROR', {
    providerError: {
      provider: LATAM,
      operation,
      providerCode: code,
      providerMessage: message,
      providerSeverity: null,
      httpStatus,
    },
    metadata: { operation },
  });
}
