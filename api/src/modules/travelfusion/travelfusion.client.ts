import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { AppError } from '../../common/errors/app-error';
import { env } from '../../config/env';
import { assertCredentialsConfigured } from '../../config/credentials';
import { CONNECT_TIMEOUT_MS, timeoutFor } from '../../config/timeouts';
import { buildProviderError, mapProviderError, readError } from './error.map';
import { buildCommand, parseXml } from './xml.util';

export interface RequestContext {
  correlationId?: string;
  endUserIp?: string;
  endUserAgent?: string;
  pointOfSale?: string;
}

export interface CommandResult {
  parsed: Record<string, any>;
  durationMs: number;
}

const isTimeout = (error: unknown): boolean => {
  const code = (error as { code?: string })?.code;
  return code === 'ETIMEDOUT' || code === 'ECONNABORTED' || code === 'ERR_CANCELED';
};

/**
 * Ponto único de saída para a Travelfusion. Todo comando passa por aqui.
 */
@Injectable()
export class TravelfusionClient {
  private readonly logger = new Logger(TravelfusionClient.name);

  private readonly http: AxiosInstance = axios.create({
    baseURL: env.travelfusion.endpoint,
    // GZip DEVE ser solicitado em todos os requests (Connection Guide). A
    // resposta pode ou não vir comprimida — o axios descomprime sozinho.
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Accept-Encoding': 'gzip' },
    responseType: 'text',
    transitional: { clarifyTimeoutError: true },
  });

  /**
   * Os custom parameters obrigatórios são injetados AQUI, não nos comandos —
   * assim comando novo nasce conforme, sem depender de alguém lembrar.
   * A ausência deles reprova na auditoria mesmo com o fluxo funcionando.
   */
  private customParameters(context: RequestContext): Record<string, string> {
    return {
      EndUserIPAddress: context.endUserIp ?? '127.0.0.1',
      EndUserBrowserAgent: context.endUserAgent ?? 'pass-flight-api/0.1',
      UserData: env.customParameters.userData,
      RequestOrigin: env.customParameters.requestOrigin,
      PointOfSale: context.pointOfSale ?? env.customParameters.pointOfSale,
    };
  }

  /**
   * 🔴 `retries` vem da tabela da spec e é 0 para ProcessTerms/StartBooking.
   * Não aumentar: retentar mutação não idempotente cria reserva duplicada.
   */
  async send(command: string, body: Record<string, unknown>, context: RequestContext = {}): Promise<CommandResult> {
    // Credencial em branco falha aqui, antes da rede, com 401 acionável — e não
    // como um 400 do provedor que viraria "502, retente".
    assertCredentialsConfigured(command);

    const { readMs, retries, retryReadMs } = timeoutFor(command);
    const payload = buildCommand(command, { ...body, ...this.customParameters(context) });

    let attempt = 0;
    let lastError: unknown = null;

    while (attempt <= retries) {
      const timeout = (attempt === 0 ? readMs : (retryReadMs ?? readMs)) + CONNECT_TIMEOUT_MS;
      const startedAt = Date.now();

      try {
        const response = await this.http.post<string>('', payload, { timeout });
        const parsed = await parseXml(response.data);

        const fault = readError(parsed);
        if (fault) throw mapProviderError(fault, command, response.status);

        return { parsed, durationMs: Date.now() - startedAt };
      } catch (error) {
        // Erro de negócio do provedor não retenta: a resposta chegou e é final.
        if (error instanceof AppError) throw error;
        lastError = error;
        attempt += 1;
      }
    }

    this.logger.error({ command, correlationId: context.correlationId, err: lastError });

    const providerError = buildProviderError({
      operation: command,
      providerCode: (lastError as { code?: string })?.code ?? null,
      providerMessage: (lastError as { message?: string })?.message ?? null,
      httpStatus: (lastError as { response?: { status?: number } })?.response?.status ?? null,
    });

    throw new AppError(isTimeout(lastError) ? 'PROVIDER_TIMEOUT' : 'PROVIDER_INTEGRATION_ERROR', {
      providerError,
      metadata: { operation: command },
    });
  }
}
