import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error';
import { env, LATAM } from '../../../config/env';
import { CONNECT_TIMEOUT_MS } from '../../../config/timeouts';
import { RequestContext } from '../provider.types';
import { mapLatamError, readLatamError } from './error.map';
import { parseXml } from '../../../common/xml/xml.util';

export type LatamClientConfig = typeof env.latam;

/**
 * Token de override da configuracao. Ninguem o provê em producao — o
 * `@Optional()` faz o Nest passar `undefined` e o cliente cair no env.
 */
export const LATAM_CLIENT_CONFIG = Symbol('LATAM_CLIENT_CONFIG');

/** Timeouts por operação NDC. AirShopping é síncrono e pesado — daí o teto alto. */
const OPERATION_TIMEOUTS: Record<string, { readMs: number; retries: number }> = {
  Token: { readMs: 10000, retries: 1 },
  AirShopping: { readMs: 60000, retries: 1 },
  OfferPrice: { readMs: 45000, retries: 1 },
  // 🔴 OrderCreate é MUTAÇÃO não idempotente: retentar cria reserva duplicada.
  OrderCreate: { readMs: 90000, retries: 0 },
  OrderRetrieve: { readMs: 30000, retries: 1 },
  OrderCancel: { readMs: 45000, retries: 0 },
};

const timeoutFor = (operation: string) => OPERATION_TIMEOUTS[operation] ?? { readMs: 30000, retries: 0 };

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

export interface LatamResult {
  parsed: Record<string, any>;
  /** Nó `<Response>` da mensagem NDC — é o que os normalizadores consomem. */
  payload: Record<string, any>;
  durationMs: number;
}

/**
 * Ponto único de saída para a LATAM NDC.
 *
 * Diferença estrutural para a Travelfusion: aqui não existe LoginId eterno. O
 * OAuth2 devolve um Bearer que morre em 59 minutos, então o cache é por TEMPO e
 * não por sessão — e a renovação precisa acontecer sozinha, no meio de uma
 * busca, sem que o caso de uso saiba.
 */
@Injectable()
export class LatamClient {
  private readonly logger = new Logger(LatamClient.name);

  private token: { value: string; expiresAt: number } | null = null;
  /** Renovações concorrentes compartilham a MESMA promise: 10 buscas simultâneas
   * não podem virar 10 chamadas de token. */
  private inFlightToken: Promise<string> | null = null;

  private readonly config: LatamClientConfig;
  private readonly http: AxiosInstance;
  private readonly oauth: AxiosInstance;

  /**
   * 🔴 A configuracao entra por CONSTRUTOR, com o env so como padrao. Ler o
   * modulo de config aqui dentro tornaria o cliente impossivel de apontar para
   * outro lugar sem mexer em variavel de ambiente global — e e exatamente isso
   * que um duble de teste precisa fazer sem contaminar o resto do processo.
   */
  constructor(@Optional() @Inject(LATAM_CLIENT_CONFIG) config: Partial<LatamClientConfig> = {}) {
    this.config = { ...env.latam, ...(config ?? {}) };

    this.http = axios.create({
      baseURL: this.config.endpoint.replace(/\/+$/, ''),
      headers: { 'Content-Type': 'application/xml', Accept: 'application/xml' },
      responseType: 'text',
      transitional: { clarifyTimeoutError: true },
      // Como na Travelfusion: o corpo do erro E a informacao — deixar o axios
      // rejeitar por status jogaria fora o <Error> da NDC.
      validateStatus: () => true,
    });

    this.oauth = axios.create({
      baseURL: this.config.tokenEndpoint.replace(/\/+$/, ''),
      responseType: 'json',
      validateStatus: () => true,
    });
  }

  /** Credencial em branco falha ANTES da rede, com 401 acionável. */
  private assertConfigured(operation: string): void {
    if (this.config.apiKey.trim() && this.config.apiSecret.trim()) return;

    throw new AppError('PROVIDER_AUTHENTICATION_FAILED', {
      metadata: { operation },
      providerError: {
        provider: LATAM,
        operation,
        providerCode: 'missing_credentials',
        providerMessage:
          'Credencial da LATAM ausente. Defina LATAM_API_KEY e LATAM_API_SECRET no .env '
          + '(Key/Secret do app criado no portal Apigee).',
        providerSeverity: null,
        httpStatus: null,
      },
    });
  }

  async getToken(force = false): Promise<string> {
    this.assertConfigured('Token');

    if (!force && this.token && Date.now() < this.token.expiresAt) return this.token.value;
    if (this.inFlightToken) return this.inFlightToken;

    this.inFlightToken = this.requestToken().finally(() => {
      this.inFlightToken = null;
    });
    return this.inFlightToken;
  }

  private async requestToken(): Promise<string> {
    const { readMs } = timeoutFor('Token');
    const basic = Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`, 'utf8').toString('base64');

    const response = await this.oauth.post('', new URLSearchParams({ grant_type: 'client_credentials' }), {
      timeout: readMs + CONNECT_TIMEOUT_MS,
      headers: {
        Authorization: `Basic ${basic}`,
        'x-api-key': this.config.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const body = response.data as { access_token?: string; expires_in?: number; error?: string } | null;

    if (response.status < 200 || response.status >= 300 || !body?.access_token) {
      // 🔴 Key/Secret recusados NÃO é falha técnica: é 401 "revise o cadastro".
      throw new AppError('PROVIDER_AUTHENTICATION_FAILED', {
        metadata: { operation: 'Token' },
        providerError: {
          provider: LATAM,
          operation: 'Token',
          providerCode: body?.error ?? String(response.status),
          providerMessage: snippet(JSON.stringify(body ?? {})),
          providerSeverity: null,
          httpStatus: response.status,
        },
      });
    }

    // `expires_in` vem em segundos. Respeitamos o menor entre ele e o nosso teto.
    const ttl = Math.min(
      this.config.tokenTtlMs,
      body.expires_in ? body.expires_in * 1000 - 60_000 : this.config.tokenTtlMs,
    );

    this.token = { value: body.access_token, expiresAt: Date.now() + Math.max(ttl, 30_000) };
    return body.access_token;
  }

  clearToken(): void {
    this.token = null;
  }

  /**
   * Os headers obrigatórios são montados AQUI, não nos comandos — mesma razão
   * dos custom parameters da Travelfusion: operação nova nasce conforme.
   */
private headers(token: string, context: RequestContext): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'X-latam-client-name': this.config.clientName,
      'X-latam-Application-Name': this.config.applicationName,
      'X-latam-api-key': this.config.apiKey,
      'X-latam-Track-Id': context.correlationId ?? randomUUID(),
      'X-latam-Country': context.pointOfSale ?? this.config.country,
      'X-latam-Lang': this.config.lang,
      'x-latam-Api-Version': this.config.apiVersion,
    };
  }

  /**
   * @param operation nome NDC, usado para timeout, retry e mensagem de erro.
   * @param path rota relativa ao endpoint (ex.: `/airshopping`).
   */
  async send(
    operation: string,
    path: string,
    body: string,
    context: RequestContext = {},
  ): Promise<LatamResult> {
    this.assertConfigured(operation);

    const { readMs, retries } = timeoutFor(operation);
    let attempt = 0;
    let lastError: unknown = null;
    let forceToken = false;

    while (attempt <= retries) {
      const startedAt = Date.now();

      try {
        const token = await this.getToken(forceToken);

        const response = await this.http.post<string>(path, body, {
          timeout: readMs + CONNECT_TIMEOUT_MS,
          headers: this.headers(token, context),
        });

        /**
         * 🔴 401/403 = token morreu no meio do caminho. Renovar e repetir UMA vez
         * é correto porque a chamada não chegou a ser processada — mas só quando
         * a operação permite retry: OrderCreate tem retries 0 e o token expirado
         * lá sobe como erro, nunca como segunda tentativa de reservar.
         */
        if ((response.status === 401 || response.status === 403) && attempt < retries) {
          this.clearToken();
          forceToken = true;
          attempt += 1;
          continue;
        }

        const parsed = await parseXml(response.data).catch(() => null);
        const fault = parsed ? readLatamError(parsed) : null;
        if (fault) throw mapLatamError(fault, operation, response.status);

        if (response.status < 200 || response.status >= 300) {
          throw mapLatamError(
            { code: String(response.status), message: snippet(response.data) },
            operation,
            response.status,
          );
        }

        if (!parsed) {
          throw mapLatamError({ code: 'INVALID_XML', message: snippet(response.data) }, operation, response.status);
        }

        const root = Object.values(parsed)[0] as Record<string, any> | undefined;
        return {
          parsed,
          payload: (root?.Response ?? root ?? {}) as Record<string, any>,
          durationMs: Date.now() - startedAt,
        };
      } catch (error) {
        // Erro de negócio já mapeado é final: a resposta chegou.
        if (error instanceof AppError) throw error;
        lastError = error;
        attempt += 1;
      }
    }

    this.logger.error({ operation, correlationId: context.correlationId, err: lastError });

    throw new AppError(isTimeout(lastError) ? 'PROVIDER_TIMEOUT' : 'PROVIDER_INTEGRATION_ERROR', {
      metadata: { operation },
      providerError: {
        provider: LATAM,
        operation,
        providerCode: (lastError as { code?: string })?.code ?? null,
        providerMessage: (lastError as { message?: string })?.message ?? null,
        providerSeverity: null,
        httpStatus: (lastError as { response?: { status?: number } })?.response?.status ?? null,
      },
    });
  }
}
