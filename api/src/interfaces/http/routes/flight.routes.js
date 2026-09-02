import { supportsOperation } from '../../../constants/capabilities.js';
import { notSupported } from '../../../domain/errors.js';
import { presentSuccess } from '../presenters/envelope.js';
import { presentError } from '../presenters/error.presenter.js';
import { searchAvailability } from '../../../application/use-cases/SearchAvailability.js';
import { quoteOffer } from '../../../application/use-cases/QuoteOffer.js';
import { createBooking } from '../../../application/use-cases/CreateBooking.js';
import { retrieveBooking } from '../../../application/use-cases/RetrieveBooking.js';
import { fareRules } from '../../../application/use-cases/FareRules.js';
import { getLoginId } from '../../../integrations/travelfusion/provider/auth.js';
import {
  availabilitySchema, quoteSchema, bookingSchema, pingSchema,
  retrieveSchema, fareRulesSchema, notSupportedSchema,
} from '../schemas/flight.schema.js';

const requestContext = (request) => ({
  correlationId: request.id,
  endUserIp: request.headers['x-forwarded-for'] || request.ip,
  endUserAgent: request.headers['user-agent'],
});

/**
 * 🔴 O guard de capability roda ANTES da validação de corpo — por isso ele é um
 * preHandler, e não um if dentro do handler.
 */
function capabilityGuard(operation) {
  return async (request, reply) => {
    if (supportsOperation(operation)) return;
    const { statusCode, body } = presentError(notSupported(operation), { correlationId: request.id });
    reply.code(statusCode).send(body);
  };
}

/** Rotas que o provedor não atende: registradas, documentadas e respondendo 501. */
const UNSUPPORTED = [
  ['/seat-map',          'seatMap',          'Ler o mapa de assentos',      'A seleção de assento na Travelfusion depende do fornecedor por trás do agregador e ainda não há suporte confirmado na branch.'],
  ['/mark-seats',        'markSeats',        'Marcar assento',              'Mesma dependência de fornecedor do /seat-map.'],
  ['/ancillaries',       'ancillaries',      'Listar bagagem e extras',     'Disponível via /quote: os extras vêm no requiredParameters do ProcessDetails.'],
  ['/sell-ancillaries',  'sellAncillaries',  'Vender o extra',              'Não existe venda avulsa: o extra escolhido entra como CustomSupplierParameter no ProcessTerms, dentro de /booking.'],
  ['/payment-options',   'paymentOptions',   'Formas de pagamento',         'A Travelfusion não expõe catálogo de formas de pagamento por oferta.'],
  ['/financing-options', 'financingOptions', 'Parcelamento',                'A Travelfusion não expõe parcelamento.'],
  ['/issue',             'issue',            'Emitir',                      'Não há emissão separada: o StartBooking já cobra. A separação reservar/emitir do contrato não tem equivalente no provedor.'],
  ['/retrieve-eticket',  'retrieveEticket',  'Consultar o bilhete',         'O agregador devolve a referência do fornecedor, não o bilhete.'],
  ['/cancel-eticket',    'cancelEticket',    'Anular ou reembolsar',        'Cancelamento de bilhete passa por bsm@travelfusion.com, sem comando XML equivalente.'],
  ['/cancel-booking',    'cancelBooking',    'Cancelar a reserva',          'Varia por fornecedor; sem suporte uniforme no agregador.'],
];

export default async function registerFlightRoutes(fastify) {
  fastify.post('/availability', { schema: availabilitySchema, preHandler: capabilityGuard('availability') }, async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    for await (const event of searchAvailability(request.body, requestContext(request))) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    reply.raw.end();
    return reply;
  });

  fastify.post('/quote', { schema: quoteSchema, preHandler: capabilityGuard('quote') }, async (request) => {
    const { data, durationMs } = await quoteOffer(request.body, requestContext(request));
    return presentSuccess(data, { durationMs, operation: 'quote', correlationId: request.id });
  });

  fastify.post('/booking', { schema: bookingSchema, preHandler: capabilityGuard('booking') }, async (request, reply) => {
    const startedAt = Date.now();
    const data = await createBooking(request.body, requestContext(request));
    // /booking devolve 201; todas as outras, 200.
    return reply.code(201).send(
      presentSuccess(data, { durationMs: Date.now() - startedAt, operation: 'createBooking', correlationId: request.id }),
    );
  });

  /**
   * 🔴 O /retrieve NÃO usa o envelope de três chaves. Ele tem chaves próprias
   * (connector, booking, status, message) e `status` só assume um valor: "found".
   * Qualquer outro cenário é erro, com o ErrorEnvelope.
   */
  fastify.post('/retrieve', { schema: retrieveSchema, preHandler: capabilityGuard('retrieve') }, async (request) => {
    const { locator, data } = await retrieveBooking(request.body, requestContext(request));
    return {
      success: true,
      connector: request.body?.options?.provider || 'travelfusion',
      booking: locator,
      status: 'found',
      message: 'Booking retrieved successfully',
      data,
    };
  });

  fastify.post('/fare-rules', { schema: fareRulesSchema, preHandler: capabilityGuard('fareRules') }, async (request) => {
    const { data, durationMs } = await fareRules(request.body, requestContext(request));
    return presentSuccess(data, { durationMs, operation: 'fareRules', correlationId: request.id });
  });

  fastify.post('/ping', { schema: pingSchema, preHandler: capabilityGuard('ping') }, async (request) => {
    const startedAt = Date.now();
    const loginId = await getLoginId();
    return presentSuccess({ ok: true, loginId }, { durationMs: Date.now() - startedAt, operation: 'ping', correlationId: request.id });
  });

  for (const [path, operation, summary, reason] of UNSUPPORTED) {
    fastify.post(path, { schema: notSupportedSchema(summary, reason), preHandler: capabilityGuard(operation) }, async () => {
      throw notSupported(operation);
    });
  }

  // DELETE com corpo — é assim no contrato.
  fastify.delete('/remove-seats', { schema: notSupportedSchema('Remover assento', 'Mesma dependência de fornecedor do /seat-map.'), preHandler: capabilityGuard('removeSeats') }, async () => {
    throw notSupported('removeSeats');
  });
}
