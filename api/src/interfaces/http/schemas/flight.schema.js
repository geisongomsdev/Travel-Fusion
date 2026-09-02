import { legSchema, successEnvelope, errorResponses, nullable, priceTotalSchema } from './shared.schema.js';

export const availabilityBodySchema = {
  type: 'object',
  required: ['type', 'legs', 'passengers'],
  properties: {
    type: { type: 'string', enum: ['oneway', 'roundtrip', 'multicity'] },
    legs: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['origin', 'destination', 'date'],
        properties: {
          origin: { type: 'string', minLength: 3, maxLength: 3, example: 'GRU' },
          destination: { type: 'string', minLength: 3, maxLength: 3, example: 'REC' },
          date: { type: 'string', example: '2026-10-12' },
        },
      },
    },
    passengers: {
      type: 'object',
      required: ['adults'],
      properties: {
        adults: { type: 'integer', minimum: 1, example: 1 },
        children: { type: 'integer', minimum: 0, default: 0 },
        babies: { type: 'integer', minimum: 0, default: 0 },
      },
    },
    options: {
      type: 'object',
      properties: {
        provider: { type: 'array', items: { type: 'string' }, example: ['travelfusion'] },
        refundable: { type: 'boolean' },
        class: { type: 'string', enum: ['economy', 'premium_economy', 'business', 'first'] },
      },
    },
  },
};

export const quoteBodySchema = {
  type: 'object',
  required: ['identifier'],
  properties: {
    identifier: { type: 'string', description: 'O identifier opaco vindo da busca. Devolva intacto.' },
  },
};

export const bookingBodySchema = {
  type: 'object',
  required: ['identifier', 'passengers'],
  properties: {
    identifier: { type: 'string' },
    referenceDate: { type: 'string', description: 'Data usada para calcular a idade real. Em ida-e-volta, a data da VOLTA.' },
    passengers: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['firstName', 'lastName', 'dateOfBirth'],
        properties: {
          title: { type: 'string', example: 'Mr' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          dateOfBirth: { type: 'string', example: '1990-04-21' },
          customParameters: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'CSPs por passageiro (PerPassenger=true), ex.: OutwardLuggageOptions.',
          },
        },
      },
    },
    customParameters: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'CSPs do nível da reserva (PerPassenger=false).',
    },
  },
};

export const identifierOnlySchema = {
  type: 'object',
  required: ['locator'],
  properties: { locator: { type: 'string', description: 'O localizador devolvido pela reserva.' } },
};

export const availabilitySchema = {
  tags: ['Busca'],
  summary: 'Buscar voos',
  description: [
    'Resposta em **stream** (`text/event-stream`), não no envelope padrão.',
    '',
    'Eventos, em ordem: `start` → (`provider_success` | `provider_error`) → `filters` → `complete`.',
    'Se a busca inteira morrer: `fatal_error`. `complete` e `fatal_error` encerram a conexão.',
    '',
    '**"Sem voos" NÃO é erro**: chega como `provider_error` com `data.error.code = "NO_FLIGHTS"`',
    'e **sem** `canonicalCode`. Discrimine por `canonicalCode`, nunca por `type`.',
    '',
    'Por trás: `StartRouting` + polling de `CheckRouting` (≥ 2s). O polling é incremental —',
    'resultados já devolvidos não voltam, então a acumulação é nossa.',
  ].join('\n'),
  body: availabilityBodySchema,
  produces: ['text/event-stream'],
  response: {
    200: { type: 'string', description: 'Stream de eventos SSE.' },
    ...errorResponses,
  },
};

export const quoteSchema = {
  tags: ['Venda'],
  summary: 'Tarifar — confirmar o preço firme',
  description: [
    'Mapeia para `ProcessDetails`.',
    '',
    'Devolve também o `requiredParameters[]` — os CSPs que o provedor vai exigir',
    '(bagagem incluída). Guarde: o `ProcessTerms` é **único** e não haverá segunda',
    'chance de perguntar.',
  ].join('\n'),
  body: quoteBodySchema,
  response: {
    200: successEnvelope({
      type: 'object',
      properties: {
        identifier: { type: 'string' },
        price: priceTotalSchema,
        requiredParameters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', example: 'OutwardLuggageOptions' },
              type: nullable('string'),
              displayText: nullable('string'),
              perPassenger: { type: 'boolean' },
              optional: { type: 'boolean' },
              options: {
                type: 'array',
                description: 'Opções já parseadas do DisplayText do provedor.',
                items: {
                  type: 'object',
                  properties: {
                    value: { type: 'string', description: 'Volta cru no CustomSupplierParameter.' },
                    label: nullable('string'),
                    quantity: { type: ['integer', 'null'] },
                    weightKg: { type: ['number', 'null'] },
                    price: {
                      type: ['object', 'null'],
                      properties: { currency: { type: 'string' }, total: { type: 'number' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    ...errorResponses,
  },
};

export const bookingSchema = {
  tags: ['Venda'],
  summary: 'Reservar',
  description: [
    'Mapeia para `ProcessTerms` (**um só**) → `StartBooking` → polling de `CheckBooking`.',
    '',
    '🔴 `committed` ≠ `confirmed`. `committed:true` diz que a reserva foi aceita pelo',
    'provedor; `confirmed` só vira `true` quando o status final `Succeeded` chega, e',
    '**nunca é deduzido** de `committed`. Status não-final (`BookingInProgress`,',
    '`Unconfirmed`) não autoriza re-reservar.',
    '',
    'Devolve **HTTP 201**.',
  ].join('\n'),
  body: bookingBodySchema,
  response: {
    201: successEnvelope({
      type: 'object',
      properties: {
        locator: nullable('string'),
        committed: { type: 'boolean' },
        confirmed: { type: 'boolean' },
        status: { type: 'string', example: 'Succeeded' },
      },
    }),
    ...errorResponses,
  },
};

export const pingSchema = {
  tags: ['Diagnóstico'],
  summary: 'Testar a credencial',
  description: 'Mapeia para `Login`. O `LoginId` fica em cache — o Login só pode ser chamado poucas vezes por dia.',
  response: {
    200: successEnvelope({
      type: 'object',
      properties: { ok: { type: 'boolean' }, loginId: nullable('string') },
    }),
    ...errorResponses,
  },
};

const phoneSchema = {
  type: 'object',
  properties: { country: nullable('string'), area: nullable('string'), number: nullable('string'), type: nullable('string') },
};

export const retrieveSchema = {
  tags: ['Pós-venda'],
  summary: 'Consultar a reserva',
  description: [
    'Mapeia para `CheckBooking`. **Sem cache** — toda chamada vai à companhia, porque o',
    'ponto da rota é saber o estado *agora*.',
    '',
    '🔴 Esta rota **não usa o envelope de três chaves**. Ela tem chaves próprias, e',
    '`status` só assume um valor: `"found"`. Qualquer outro cenário é erro.',
    '',
    'Todas as chaves de `data` existem sempre, com `null` onde a Travelfusion não',
    'informa — o `CheckBooking` não devolve os trechos, então `trip`, `segments` e',
    '`itinerary` vêm `null`.',
    '',
    'O bloco `booking` é tolerante: campo desconhecido ali é **ignorado**, não recusado.',
  ].join('\n'),
  body: {
    type: 'object',
    required: ['booking'],
    properties: {
      options: { type: 'object', properties: { provider: { type: 'string', example: 'travelfusion' } } },
      booking: {
        type: 'object',
        required: ['locator'],
        additionalProperties: true,
        properties: {
          locator: { type: 'string', example: 'NW6PFQ' },
          lastName: { type: 'string' },
          language: { type: 'string' },
          history: { type: 'boolean' },
        },
      },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean', enum: [true] },
        connector: { type: 'string' },
        booking: { type: 'string', description: 'Eco do booking.locator do request.' },
        status: { type: 'string', enum: ['found'] },
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: {
            status: { ...nullable('string'), description: 'Estado de VENDA: confirmed | pending | cancelled | null' },
            type: { type: 'string', enum: ['flight'] },
            trip: nullable('string'),
            grouping: nullable('string'),
            title: nullable('string'),
            destination: { type: ['object', 'null'] },
            iata: { type: ['object', 'null'] },
            departure: nullable('string'),
            arrival: nullable('string'),
            currency: nullable('string'),
            createdAt: nullable('string'),
            expiresAt: { ...nullable('string'), description: 'Prazo da reserva em espera — depois disso a companhia cancela sozinha.' },
            confirmationAt: nullable('string'),
            provider: {
              type: 'object',
              properties: {
                code: nullable('string'),
                name: { ...nullable('string'), description: 'Nome da COMPANHIA AÉREA, não do provedor.' },
                locator: nullable('string'),
              },
            },
            supplier: {
              type: 'object',
              properties: {
                confirmation: { ...nullable('string'), description: 'Localizador NA COMPANHIA, quando difere do do provedor. Num agregador são dois códigos, e é este que o passageiro usa no check-in.' },
              },
            },
            people: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  main: { type: 'boolean', description: 'true só no primeiro. Bebê de colo é sempre false.' },
                  name: nullable('string'),
                  firstName: nullable('string'),
                  lastName: nullable('string'),
                  email: nullable('string'),
                  phone: phoneSchema,
                  nationality: nullable('string'),
                  document: { type: 'object', properties: { type: nullable('string'), number: nullable('string') } },
                  birthdate: { ...nullable('string'), description: 'Normalizada para YYYY-MM-DD.' },
                  age: { type: ['integer', 'null'] },
                  type: { ...nullable('string'), description: 'adult | child | infant | null. O que não reconhece é null, nunca um chute.' },
                  ageGroup: { ...nullable('string'), description: 'Sempre igual a type.' },
                  gender: nullable('string'),
                  loyalty: { type: ['object', 'null'] },
                },
              },
            },
            segments: { type: ['object', 'null'] },
            itinerary: { type: ['object', 'null'] },
          },
        },
      },
      required: ['success', 'connector', 'booking', 'status', 'message', 'data'],
    },
    ...errorResponses,
  },
};

export const fareRulesSchema = {
  tags: ['Pós-venda'],
  summary: 'Texto completo da regra tarifária',
  description: [
    'Read-only: não tarifa, não reserva, não altera nada.',
    '',
    'A `key` é **opaca** e vem de `fares[].rules.key` do `/availability`. Quem consome',
    'devolve exatamente como recebeu — nunca monta, nunca interpreta.',
    '',
    '🔴 Chave que não abre é erro de **quem chamou**: 400, e a chamada nem vai à',
    'companhia. Chave corrompida não é falha de integração.',
  ].join('\n'),
  body: {
    type: 'object',
    required: ['fareRules'],
    properties: {
      provider: { type: 'string', example: 'travelfusion' },
      fareRules: {
        type: 'object',
        required: ['key'],
        additionalProperties: false,
        properties: { key: { type: 'string', description: 'Vem de fares[].rules.key da busca.' } },
      },
    },
  },
  response: {
    200: successEnvelope({
      type: 'object',
      properties: {
        provider: { type: 'string' },
        sections: {
          type: 'array',
          minItems: 1,
          description: 'As 5 chaves existem sempre, na mesma ordem. Ausência é null, nunca "".',
          items: {
            type: 'object',
            properties: {
              company: nullable('string'),
              fareBasis: nullable('string'),
              origin: nullable('string'),
              destination: nullable('string'),
              text: { type: 'string', description: 'Texto da companhia, com \\n preservado. Nunca null, nunca vazio.' },
            },
          },
        },
      },
    }),
    ...errorResponses,
  },
};

/** Rotas ainda não suportadas pelo provedor: 501, com o contrato de erro intacto. */
export function notSupportedSchema(summary, reason) {
  return {
    tags: ['Não suportado pelo provedor'],
    summary,
    description: `**501 CAPABILITY_NOT_SUPPORTED.** ${reason}\n\nA checagem roda ANTES de validar o corpo — inverter faria a resposta virar "payload inválido", verdade acidental que esconde o motivo real.`,
    response: { ...errorResponses },
  };
}

export { legSchema };
