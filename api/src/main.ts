import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './modules/app.module';
import { ContractExceptionFilter } from './common/filters/contract-exception.filter';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';
import { credentialsStatus, isMockEndpoint } from './config/credentials';
import { env, LATAM, PROVIDER } from './config/env';

const DESCRIPTION = [
  'Contrato canônico de voo da Pass sobre o **NDC da LATAM**.',
  '',
  'Todas as rotas são `POST` na raiz, sem prefixo de versão, e falam `application/json` —',
  '**exceto** `/availability`, cuja resposta é um stream `text/event-stream`.',
  '',
  '### O fluxo',
  '```',
  '/availability → /quote → /booking → (extras) → /issue',
  '```',
  '',
  '### O dialeto do pedido',
  'Rota que **muta** carrega um bloco com o nome da operação (`cancel`, `issue`,',
  '`sellAncillaries`, `markSeats`). Não é enfeite: um `{booking:{locator}}` solto serve para',
  'cancelar, emitir e consultar, e quem erra a rota manda um corpo que o servidor aceita sem',
  'reclamar. Rota de **leitura** (`/retrieve`, `/financing-options`) fica sem o bloco.',
  '',
  '### A chave de venda',
  '🔴 É `fares[].fareId`, da TARIFA — não o `identifier` do trecho, que é a journey da',
  'companhia. Um voo tem várias famílias tarifárias e **cada uma é uma venda diferente**.',
  'A chave é opaca: copie e devolva intacta, nunca remonte nem interprete.',
  '',
  '### O que este provedor não faz',
  'O que a companhia não oferece responde **501 `CAPABILITY_NOT_SUPPORTED`** — nunca um',
  'formato alternativo, nunca o XML cru. A tag *Não suportado pelo provedor* distingue',
  '"a companhia não faz" de "ainda não integramos".',
  '',
  '### Erro',
  'Todo erro cai num código do catálogo, **sem prefixo de serviço** (`FARE_UNAVAILABLE`, não',
  '`FLIGHT_FARE_UNAVAILABLE`). O payload cru do provedor nunca entra no corpo — só o',
  '`providerError` sanitizado, de 6 chaves.',
].join('\n');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const logger = new Logger('bootstrap');

  app.enableCors({ origin: true });

  /**
   * `whitelist` remove campo não declarado, o que mantém o corpo previsível sem
   * recusar o superconjunto que cada companhia pede.
   *
   * 🔴 `forbidNonWhitelisted` fica FALSO de propósito: o bloco `booking` é
   * deliberadamente tolerante — cada provedor exige um conjunto diferente e quem
   * consome manda todos. A exceção mora no DTO, com campos opcionais, e não numa
   * configuração global mais frouxa.
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
    .setTitle('Pass — API de voo')
    .setDescription(DESCRIPTION)
    .setVersion('0.1.0')
    .addServer(`http://localhost:${env.port}`, 'Local')
    .addTag('Busca', 'A rota mais difícil: multi-provedor exposto como stream de eventos.')
    .addTag('Venda', 'Tarifar e reservar.')
    .addTag('Pós-venda', 'Consulta e cancelamento. Sem cache: o ponto é o estado agora.')
    .addTag('Assentos', 'Mapa e opcionais — da oferta (vitrine) e da reserva emitida (loja).')
    .addTag('Pagamento', 'Parcelas e emissão. O valor vem da companhia, nunca do corpo.')
    .addTag('Diagnóstico', 'Teste de credencial.')
    .addTag('Não suportado pelo provedor', 'Existem no contrato; este provedor não atende. Respondem 501.')
    .addTag('Health', 'Liveness do serviço.')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { docExpansion: 'list', deepLinking: true, tagsSorter: 'alpha' },
  });

  await app.listen(env.port, '0.0.0.0');

  logger.log(`Swagger em http://localhost:${env.port}/docs`);
  logger.log(`Provedores no ar: ${env.providers.join(', ') || 'nenhum'}`);

  /**
   * Aviso na subida, por provedor REALMENTE ligado.
   *
   * 🔴 Sem o recorte por `PROVIDERS`, uma instância só com LATAM reclamava de
   * credencial da Travelfusion — ruído que treina quem opera a ignorar o aviso.
   * Sem isto, o sintoma só apareceria na primeira busca, como falha de
   * integração: longe da causa, que é configuração.
   */
  if (env.providers.includes(LATAM) && !(env.latam.apiKey.trim() && env.latam.apiSecret.trim())) {
    logger.warn(
      'Credencial da LATAM não configurada (LATAM_API_KEY / LATAM_API_SECRET). '
      + 'As rotas responderão 401 até o .env ser preenchido.',
    );
  }

  if (env.providers.includes(PROVIDER)) {
    const credentials = credentialsStatus();
    if (isMockEndpoint()) {
      logger.warn(`Travelfusion apontando para o MOCK (${env.travelfusion.endpoint}) — nenhuma chamada real.`);
    } else if (!credentials.configured) {
      logger.warn(
        `Credencial da Travelfusion não configurada (${credentials.reason}). `
        + 'Ela está arquivada e bloqueada por liberação de IP: rode com `PROVIDERS=latam` para desligá-la.',
      );
    }
  }
}

void bootstrap();
