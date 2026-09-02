import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './modules/app.module';
import { ContractExceptionFilter } from './common/filters/contract-exception.filter';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';
import { credentialsStatus, isMockEndpoint } from './config/credentials';
import { env } from './config/env';

const DESCRIPTION = [
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
].join('\n');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const logger = new Logger('bootstrap');

  app.enableCors({ origin: true });

  /**
   * `whitelist` remove campo não declarado; `forbidNonWhitelisted` recusa a raiz
   * com chave desconhecida (400), como o contrato pede.
   *
   * 🔴 `forbidNonWhitelisted` NÃO se aplica ao bloco `booking` do /retrieve, que
   * é deliberadamente tolerante: cada companhia pede um conjunto diferente e
   * quem consome manda o superconjunto. Por isso a exceção mora no DTO, com
   * campos opcionais, e não numa configuração global mais frouxa.
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new ContractExceptionFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor(app.get(Reflector)));

  const config = new DocumentBuilder()
    .setTitle('Travelfusion — API de voo')
    .setDescription(DESCRIPTION)
    .setVersion('0.1.0')
    .addServer(`http://localhost:${env.port}`, 'Local')
    .addTag('Busca', 'A rota mais difícil: polling do provedor exposto como stream.')
    .addTag('Venda', 'Tarifar e reservar.')
    .addTag('Pós-venda', 'Consulta avulsa, fora do funil. Sem cache: o ponto é o estado agora.')
    .addTag('Diagnóstico', 'Teste de credencial.')
    .addTag('Não suportado pelo provedor', 'Existem no contrato; a Travelfusion não faz. Respondem 501.')
    .addTag('Health', 'Liveness do serviço.')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { docExpansion: 'list', deepLinking: true, tagsSorter: 'alpha' },
  });

  await app.listen(env.port, '0.0.0.0');

  logger.log(`Swagger em http://localhost:${env.port}/docs`);

  // Aviso na subida: sem isto o sintoma só aparece na primeira busca, como falha
  // de integração — longe da causa, que é configuração.
  const credentials = credentialsStatus();
  if (isMockEndpoint()) {
    logger.warn(`Apontando para o MOCK (${env.travelfusion.endpoint}) — nenhuma chamada real à Travelfusion.`);
  } else if (!credentials.configured) {
    logger.warn(
      `Credencial da Travelfusion não configurada (${credentials.reason}). ` +
      'As rotas responderão 401 até o .env ser preenchido, ou use `npm run dev:mock`.',
    );
  }
}

void bootstrap();
