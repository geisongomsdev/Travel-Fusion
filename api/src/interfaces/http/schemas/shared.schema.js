import { ERROR_CATEGORIES } from '../../../constants/error-codes.js';

const nullable = (type) => ({ type: [type, 'null'] });

export const airportSchema = {
  type: 'object',
  properties: { code: { type: 'string', example: 'GRU' }, name: nullable('string') },
  required: ['code'],
};

export const flightTimeSchema = {
  type: 'object',
  properties: { departure: nullable('string'), arrival: nullable('string') },
};

export const moneySchema = {
  type: 'object',
  description: 'Dinheiro no contrato é sempre currency + total, já arredondado.',
  properties: { currency: { type: 'string', example: 'BRL' }, total: { type: 'number', example: 1565.0 } },
  required: ['currency', 'total'],
};

export const priceTotalSchema = {
  type: 'object',
  properties: {
    base: { type: 'number' },
    taxes: {
      type: 'object',
      properties: { boarding: { type: 'number' }, service: { type: 'number' }, fuel: { type: 'number' }, baggage: { type: 'number' } },
    },
    fees: { type: 'number', description: 'Taxa de distribuição. Está DENTRO de total e FORA de base.' },
    total: { type: 'number' },
    currency: { type: 'string' },
  },
};

export const segmentSchema = {
  type: 'object',
  properties: {
    origin: airportSchema,
    destination: airportSchema,
    time: flightTimeSchema,
    company: {
      type: 'object',
      description: '3 chaves neste nível — codeshare é do segmento.',
      properties: { code: nullable('string'), name: nullable('string'), operating: nullable('string') },
    },
    number: nullable('string'),
    segment: { type: 'integer' },
    connection: { type: 'boolean' },
    equipment: {
      type: 'object',
      properties: { code: nullable('string'), name: nullable('string'), description: nullable('string') },
    },
    cabin: { ...nullable('string'), description: 'Cabine canônica DESTE segmento. null é comum e correto quando o voo oferece mais de uma.' },
  },
};

export const fareSchema = {
  type: 'object',
  properties: {
    fareId: { ...nullable('string'), description: 'null na Travelfusion: quem endereça é o identifier do trecho.' },
    code: nullable('string'),
    familyCode: nullable('string'),
    family: nullable('string'),
    fareCode: nullable('string'),
    bookingCode: nullable('string'),
    cabin: nullable('string'),
    seats: nullable('integer'),
    price: {
      type: 'object',
      properties: {
        adult: { type: ['object', 'null'] },
        child: { type: ['object', 'null'] },
        baby: { type: ['object', 'null'] },
        total: priceTotalSchema,
        perPassenger: { type: 'number' },
        net: { type: ['object', 'null'] },
        exchange: { type: ['object', 'null'] },
      },
    },
    fees: { type: 'array', items: { type: 'object' }, description: 'Discriminação do que já está em price.total. Mostrar, nunca somar.' },
    baggage: { type: 'object' },
    rules: { type: 'object' },
    benefits: { type: 'object', description: '8 chaves fixas.' },
  },
};

export const legSchema = {
  type: 'object',
  description: 'Um trecho: o caminho de A até B, com ou sem conexão.',
  properties: {
    identifier: { ...nullable('string'), description: 'Identificador OPACO da oferta neste trecho. Devolva intacto para tarifar e reservar.' },
    company: { type: 'object', properties: { code: nullable('string'), name: nullable('string') }, description: '2 chaves neste nível.' },
    origin: airportSchema,
    destination: airportSchema,
    time: flightTimeSchema,
    stops: { ...nullable('integer'), description: '0 = direto. Conexões mais escalas técnicas.' },
    flights: { type: 'array', items: segmentSchema },
    fares: { type: 'array', items: fareSchema },
    fees: { type: 'array', items: { type: 'object' }, description: 'Lista LEGADA. Não somar com price.total.' },
  },
};

export const errorResponseSchema = {
  type: 'object',
  description: 'Corpo de erro do contrato. Campos opcionais são OMITIDOS, não emitidos como null.',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Código do catálogo, SEM prefixo de serviço.', example: 'FARE_UNAVAILABLE' },
        category: { type: 'string', enum: ERROR_CATEGORIES },
      },
      required: ['code', 'category'],
    },
    message: { type: 'string', description: 'Em inglês, literal do catálogo. Nunca traduzida, nunca vinda da companhia.' },
    correlationId: nullable('string'),
    provider: nullable('string'),
    providerError: {
      type: ['object', 'null'],
      description: 'Janela SANITIZADA do erro da companhia. O cru vai só para o log.',
      properties: {
        provider: { type: 'string' },
        operation: nullable('string'),
        providerCode: nullable('string'),
        providerMessage: nullable('string'),
        providerSeverity: nullable('string'),
        httpStatus: { type: ['integer', 'null'] },
      },
    },
    details: {
      type: ['object', 'null'],
      description: 'Diagnóstico ESTRUTURADO, nunca texto cru. Em erro de validação: {errors: {campo: [msgs]}}.',
      properties: {
        errors: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
      },
    },
    metadata: {
      type: 'object',
      description: 'Contexto do erro. Omitido quando vazio.',
      properties: { operation: nullable('string'), duration: { type: 'integer' } },
    },
  },
  required: ['success', 'error', 'message', 'correlationId'],
};

export function successEnvelope(dataSchema) {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: dataSchema,
      meta: {
        type: 'object',
        properties: {
          provider: { type: 'string', example: 'travelfusion' },
          duration: { type: 'integer', description: 'Milissegundos gastos na chamada à companhia.' },
          timestamp: { type: 'string' },
          operation: nullable('string'),
          correlationId: nullable('string'),
        },
        required: ['provider', 'duration', 'timestamp'],
      },
    },
    required: ['success', 'data', 'meta'],
  };
}

export const errorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  422: errorResponseSchema,
  500: errorResponseSchema,
  501: errorResponseSchema,
  502: errorResponseSchema,
  503: errorResponseSchema,
  504: errorResponseSchema,
};

export { nullable };
