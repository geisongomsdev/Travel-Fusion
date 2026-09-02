import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RawResponse } from '../../common/interceptors/envelope.interceptor';
import { env } from '../../config/env';
import { credentialsStatus } from '../../config/credentials';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @RawResponse()
  @ApiOperation({
    summary: 'Liveness do serviço',
    description: 'Inclui o estado da configuração de credencial — sem chamar a Travelfusion.',
  })
  check() {
    const credentials = credentialsStatus();
    return {
      status: 'ok',
      service: 'travelfusion-flight-api',
      port: env.port,
      provider: {
        endpoint: env.travelfusion.endpoint,
        // Não expõe a senha: só diz se ela está utilizável.
        credentials: credentials.configured ? 'configured' : credentials.reason,
      },
    };
  }
}
