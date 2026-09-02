import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';

import { globalErrorHandler, notFoundHandler } from './global-error-handler.js';
import registerFlightRoutes from './routes/flight.routes.js';
import { env } from '../../config/env.js';

const SERVICE_NAME = 'travelfusion-flight-api';

const OPENAPI = {
  openapi: {
    info: {
      title: 'Travelfusion — API de voo',
      version: '0.1.0',
      description: [
        'Integração da **Travelfusion Direct Connect XML API** sobre o contrato canônico de voo.',
        '',
        'Todas as rotas são `POST` na raiz, sem prefixo de versão, e falam `application/json` —',
        '**exceto** `/availability`, cuja resposta é um stream `text/event-stream`.',
        '',
        '### O fluxo',
        '```',
        '/availability → /quote → /booking → (extras) → /issue',
        '```',
        '',
        '### O que este provedor não faz',
        'A Travelfusion é um agregador XML de polling. O que ela não oferece responde',
        '**501 `CAPABILITY_NOT_SUPPORTED`** — nunca um formato alternativo, nunca o XML cru.',
        'Veja a tag *Não suportado pelo provedor*.',
        '',
        '### Erro',
        'Todo erro cai em um dos 18 códigos do catálogo, **sem prefixo de serviço**',
        '(`FARE_UNAVAILABLE`, não `FLIGHT_FARE_UNAVAILABLE`). O payload cru do provedor',
        'nunca entra no corpo — só o `providerError` sanitizado, de 6 chaves.',
      ].join('\n'),
    },
    servers: [{ url: `http://localhost:${env.port}`, description: 'Local' }],
    tags: [
      { name: 'Busca', description: 'A rota mais difícil: polling do provedor exposto como stream.' },
      { name: 'Venda', description: 'Tarifar e reservar.' },
      { name: 'Pós-venda', description: 'Consulta avulsa, fora do funil. Sem cache: o ponto é o estado agora.' },
      { name: 'Diagnóstico', description: 'Teste de credencial.' },
      { name: 'Não suportado pelo provedor', description: 'Existem no contrato; a Travelfusion não faz. Respondem 501.' },
      { name: 'Health', description: 'Liveness do serviço.' },
    ],
  },
};

const healthSchema = {
  tags: ['Health'],
  summary: 'Health check',
  response: {
    200: {
      type: 'object',
      properties: { status: { type: 'string' }, service: { type: 'string' }, port: { type: 'integer' } },
    },
  },
};

export async function buildApp(options = {}) {
  const { logger = false } = options;
  const app = Fastify({
    logger,
    bodyLimit: 10 * 1024 * 1024,
    //  é keyword do OpenAPI, não do JSON Schema: o Ajv em strict mode
    // recusa o build da validação sem esta declaração.
    ajv: { customOptions: { keywords: ['example'] } },
  });

  app.setErrorHandler(globalErrorHandler);
  app.setNotFoundHandler(notFoundHandler);

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifySwagger, OPENAPI);
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true, tagsSorter: 'alpha' },
  });

  app.get('/health', { schema: healthSchema }, async () => ({
    status: 'ok',
    service: SERVICE_NAME,
    port: env.port,
  }));

  await app.register(registerFlightRoutes);
  await app.ready();
  return app;
}

export default buildApp;
