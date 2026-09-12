import { ApiResponseOptions } from '@nestjs/swagger';
import { ERROR_CATEGORIES } from '../../common/errors/error-codes';

/**
 * O corpo de erro do contrato, para o Swagger. Uma definição só, aplicada em
 * todas as rotas pelo `main.ts` — repetir por rota garantiria divergência.
 */
export const ERROR_SCHEMA = {
  type: 'object',
  description: 'Corpo de erro do contrato. Campos opcionais são OMITIDOS, não emitidos como null.',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Código do catálogo, SEM prefixo de serviço. É por ele que quem consome ramifica.',
          example: 'FARE_UNAVAILABLE',
        },
        category: { type: 'string', enum: ERROR_CATEGORIES },
      },
      required: ['code', 'category'],
    },
    message: {
      type: 'string',
      description: 'Em inglês, literal do catálogo. Nunca traduzida, nunca vinda da companhia.',
    },
    correlationId: {
      type: 'string',
      nullable: true,
      description: 'A única ponte entre esta resposta e o log com o detalhe cru.',
    },
    provider: { type: 'string', nullable: true },
    providerError: {
      type: 'object',
      nullable: true,
      description: 'Janela SANITIZADA do erro da companhia. O payload cru vai só para o log.',
      properties: {
        provider: { type: 'string' },
        operation: { type: 'string', nullable: true },
        providerCode: { type: 'string', nullable: true },
        providerMessage: { type: 'string', nullable: true },
        providerSeverity: { type: 'string', nullable: true },
        httpStatus: { type: 'integer', nullable: true },
      },
    },
    details: {
      type: 'object',
      nullable: true,
      description: 'Diagnóstico ESTRUTURADO, nunca texto cru. Na validação: {errors: {campo: [msgs]}}.',
    },
    metadata: { type: 'object', description: 'Contexto do erro. Omitido quando vazio.' },
  },
  required: ['success', 'error', 'message', 'correlationId'],
} as const;

const errorResponse = (status: number, description: string): ApiResponseOptions => ({
  status,
  description,
  schema: ERROR_SCHEMA as unknown as Record<string, unknown>,
});

/** As distinções que custam caro se quem consome errar. */
export const ERROR_RESPONSES: ApiResponseOptions[] = [
  errorResponse(400, 'SEARCH_VALIDATION_ERROR — o que você mandou está errado.'),
  errorResponse(401, 'PROVIDER_AUTHENTICATION_FAILED — a companhia olhou a credencial e recusou. Não retentar.'),
  errorResponse(404, 'RESOURCE_NOT_FOUND / ROUTE_NOT_FOUND.'),
  errorResponse(409, 'Conflito: FARE_UNAVAILABLE (a oferta sumiu, volte à busca) ou FARE_PRICE_CHANGED (existe, custa outro valor).'),
  errorResponse(422, 'BUSINESS_RULE_VIOLATION — o pedido estava correto; a companhia é que não permite.'),
  errorResponse(429, 'RATE_LIMITED.'),
  errorResponse(500, 'UNEXPECTED_ERROR.'),
  errorResponse(501, 'CAPABILITY_NOT_SUPPORTED — a operação existe no contrato, este provedor não faz.'),
  errorResponse(502, 'PROVIDER_INTEGRATION_ERROR — a companhia respondeu e a resposta estava quebrada. Retentar.'),
  errorResponse(503, 'PROVIDER_UNAVAILABLE — não chamamos a companhia (degradação deliberada).'),
  errorResponse(504, 'PROVIDER_TIMEOUT — chamamos e ela não respondeu no tempo.'),
];

const notSupportedDescription = (reason: string): string =>
  [
    `**501 \`CAPABILITY_NOT_SUPPORTED\`.** ${reason}`,
    '',
    'A checagem roda ANTES de validar o corpo — invertida, a resposta viraria',
    '"payload inválido", verdade acidental que esconde o motivo real.',
  ].join('\n');

/**
 * As rotas que existem no contrato e não são atendidas.
 *
 * 🔴 Registradas de propósito: 501 documentado é melhor do que 404, porque diz a
 * quem consome que a operação existe e o problema é este provedor.
 *
 * ⚠️ E a distinção que mais importa aqui: "a companhia não faz" é diferente de
 * "ainda não integramos". As quatro abaixo são do segundo tipo — dívida nossa —
 * e dizer o contrário no Swagger seria informação errada para quem decide se
 * pode contar com a rota.
 */
export const NOT_SUPPORTED_ROUTES = {
  removeSeats: {
    summary: 'Remover assento',
    description: notSupportedDescription(
      '⚠️ Não é limitação da companhia: no NDC a troca de assento pós-reserva existe, em '
      + '`OrderChange` com oferta `SEAT_`. Ainda não está ligada a esta rota — é dívida nossa. '
      + 'O método recomendado pelo contrato é `POST`; `DELETE` com corpo é compatibilidade deprecated.',
    ),
  },
  paymentOptions: {
    summary: 'Formas de pagamento da emissão',
    description: notSupportedDescription(
      'Esta rota é da plataforma, não da companhia: ela lista formas de pagamento de '
      + 'consolidadores. A LATAM não é exposta aqui, e criar um mapa paralelo para ela seria '
      + 'inventar um catálogo que a companhia não publica. Para parcelas, use /financing-options.',
    ),
  },
  retrieveEticket: {
    summary: 'Consultar o bilhete',
    description: notSupportedDescription(
      '⚠️ Dívida nossa, não ausência da companhia. Enquanto isso o `/retrieve` já devolve os '
      + 'documentos da reserva em `passengers[].tickets` — com `[]` legítimo numa reserva '
      + 'ainda não emitida.',
    ),
  },
  cancelEticket: {
    summary: 'Anular ou reembolsar o bilhete',
    description: notSupportedDescription(
      '⚠️ Dívida nossa. O NDC usa `IATA_OrderCancelRQ` no mesmo endpoint do cancelamento, com '
      + 'só o `OrderID` no cenário de void. Não confundir com /cancel-booking: void anula o '
      + 'bilhete, normalmente no mesmo dia; cancelar a order pode envolver reembolso.',
    ),
  },
} as const;
