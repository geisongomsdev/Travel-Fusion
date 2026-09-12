import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RawResponse } from '../../common/interceptors/envelope.interceptor';
import { env, LATAM, PROVIDER } from '../../config/env';

/**
 * Liveness.
 *
 * 🔴 Diz se a CONFIGURAÇÃO está de pé, e só. Não chama provedor nenhum: um
 * health check que sai para a rede fica vermelho quando a companhia está lenta,
 * e aí não serve mais para dizer se o NOSSO serviço subiu. Para provar a
 * credencial de verdade existe o `/ping`.
 *
 * Nunca expõe segredo: responde se a chave está utilizável, nunca qual é.
 */
@Controller('health')
@ApiTags('Health')
export class HealthController {
  @Get()
  @RawResponse()
  @ApiOperation({
    summary: 'Liveness do serviço',
    description: [
      'Inclui o estado da configuração de cada provedor no ar — **sem chamar nenhum deles**.',
      '',
      'Credencial utilizável aqui não prova acesso: o gateway pode recusar o app por outro',
      'motivo. Quem prova é o `/ping`.',
    ].join('\n'),
  })
  check() {
    return {
      status: 'ok',
      service: 'pass-flight-api',
      port: env.port,
      /** Na ordem em que são consultados; o primeiro é o padrão de quem não escolhe. */
      providers: env.providers,
      credentials: Object.fromEntries(
        env.providers.map((provider) => [provider, credentialStateOf(provider)]),
      ),
    };
  }
}

type CredentialState = 'configured' | 'missing_credentials' | 'unknown_provider';

/**
 * O estado da credencial de um provedor, sem revelar nenhum valor.
 *
 * `unknown_provider` é um nome em `PROVIDERS` que não corresponde a integração
 * nenhuma — vale dizer, porque o sintoma normal seria um 400 na primeira busca,
 * longe da causa, que é configuração.
 */
function credentialStateOf(provider: string): CredentialState {
  if (provider === LATAM) {
    const { apiKey, apiSecret } = env.latam;
    return apiKey.trim() && apiSecret.trim() ? 'configured' : 'missing_credentials';
  }

  if (provider === PROVIDER) {
    const { xmlLoginId, password } = env.travelfusion;
    return xmlLoginId.trim() && password.trim() ? 'configured' : 'missing_credentials';
  }

  return 'unknown_provider';
}
