import { buildApp } from './src/interfaces/http/app.js';
import { env } from './src/config/env.js';

const app = await buildApp({ logger: { level: process.env.LOG_LEVEL || 'info' } });

try {
  await app.listen({ port: env.port, host: '0.0.0.0' });
  app.log.info(`Swagger em http://localhost:${env.port}/docs`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
