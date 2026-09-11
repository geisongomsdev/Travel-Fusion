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

/** As distinções que custam caro se quem consome errar — 02-erros.md §2. */
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

export const NOT_SUPPORTED_ROUTES = {
  cancelBooking: {
    summary: 'Cancelar a reserva',
    description: notSupportedDescription(
      '⚠️ Não é limitação do provedor: a Travelfusion tem uma **Post Booking API** com spec separada. Ainda não integrada — é dívida nossa.',
    ),
  },
  seatMap: {
    summary: 'Ler o mapa de assentos',
    description: notSupportedDescription(
      'A seleção de assento depende do fornecedor por trás do agregador e ainda não há suporte confirmado na branch.',
    ),
  },
  markSeats: {
    summary: 'Marcar assento',
    description: notSupportedDescription('Mesma dependência de fornecedor do /seat-map.'),
  },
  removeSeats: {
    summary: 'Remover assento',
    description: notSupportedDescription('Mesma dependência de fornecedor do /seat-map.'),
  },
  ancillaries: {
    summary: 'Listar bagagem e extras à venda',
    description: notSupportedDescription(
      'Disponível via /quote: os extras vêm em requiredParameters, parseados do ProcessDetails.',
    ),
  },
  sellAncillaries: {
    summary: 'Vender ou pendurar o extra',
    description: notSupportedDescription(
      'Não existe venda avulsa: o extra escolhido entra como CustomSupplierParameter no ProcessTerms, dentro do /booking.',
    ),
  },
  paymentOptions: {
    summary: 'Formas de pagamento da emissão',
    description: notSupportedDescription('A Travelfusion não expõe catálogo de formas de pagamento por oferta.'),
  },
  financingOptions: {
    summary: 'Parcelamento',
    description: notSupportedDescription('A Travelfusion não expõe parcelamento.'),
  },
  issue: {
    summary: 'Emitir',
    description: notSupportedDescription(
      'Não há emissão separada: o StartBooking já cobra. A separação reservar/emitir do contrato não tem equivalente no provedor — ver docs/travelfusion/decisoes.md.',
    ),
  },
  retrieveEticket: {
    summary: 'Consultar o bilhete',
    description: notSupportedDescription(
      '⚠️ Não é limitação do provedor: coberto pela **Post Booking API** da Travelfusion, ainda não integrada. Dívida nossa.',
    ),
  },
  cancelEticket: {
    summary: 'Anular ou reembolsar o bilhete',
    description: notSupportedDescription(
      '⚠️ Não é limitação do provedor: coberto pela **Post Booking API**, mais a plataforma Manage Your Booking (credenciais só com a autorização de go-live). Ainda não integrada.',
    ),
  },
} as const;
