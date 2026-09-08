import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { AppError } from '../../../common/errors/app-error';
import { env } from '../../../config/env';
import { assertCredentialsConfigured } from '../../../config/credentials';
import { CONNECT_TIMEOUT_MS, timeoutFor } from '../../../config/timeouts';
import { RequestContext } from '../provider.types';
import { buildProviderError, mapProviderError, readError } from './error.map';
import { buildCommand, parseXml, unwrapCommand } from '../../../common/xml/xml.util';

/**
 * 🔴 O contexto agora e da FRONTEIRA de provedor, nao da Travelfusion: os dois
 * provedores propagam correlationId e ponto de venda. Reexportado daqui so para
 * nao quebrar quem ja importava.
 */
export type { RequestContext };

export interface CommandResult {
  /** Documento inteiro, `<CommandList>` incluído. */
  parsed: Record<string, any>;
  /** Nó do comando, já desembrulhado — é o que os casos de uso consomem. */
  payload: Record<string, any>;
  durationMs: number;
}

/** Corpo cru virando mensagem: sem quebra de linha e com teto de tamanho. */
const snippet = (body: unknown, max = 500): string | null => {
  if (typeof body !== 'string') return null;
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat === '') return null;
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

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
    // 🔴 A Travelfusion devolve o bloco <Error> COM status 4xx. Deixar o axios
    // rejeitar por status descartaria o corpo, e o erro real (ex.: `4-3448
    // Login ID not found`) viraria "Request failed with status code 400" — que
    // não diz nada a quem consome e ainda cai como falha de rede retentável.
    // Aceitamos qualquer status e decidimos abaixo, olhando o XML.
    validateStatus: () => true,
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
        const parsed = await parseXml(response.data).catch(() => null);

        const fault = parsed ? readError(parsed) : null;
        if (fault) throw mapProviderError(fault, command, response.status);

        // Status de erro sem <Error> legível: não há o que normalizar, mas o
        // corpo cru é a única pista — vai truncado no providerMessage.
        if (response.status < 200 || response.status >= 300) {
          throw mapProviderError({ code: `HTTP_`, message: snippet(response.data) }, command, response.status);
        }

        if (!parsed) {
          throw mapProviderError({ code: 'INVALID_XML', message: snippet(response.data) }, command, response.status);
        }

        return {
          parsed,
          payload: unwrapCommand(parsed, command),
          durationMs: Date.now() - startedAt,
        };
      } catch (error) {
        // Erro de negócio do provedor não retenta: a resposta chegou e é final.
        if (error instanceof AppError) throw error;
        lastError = error;
        attempt += 1;
      }
    }

    this.logger.error({
      command,
      correlationId: context.correlationId,
      err: lastError,
    });

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
