import axios from 'axios';
import { env } from '../../../config/env.js';
import { timeoutFor, CONNECT_TIMEOUT_MS } from '../../../config/timeouts.js';
import { AppError } from '../../../domain/errors.js';
import { buildCommand, parseXml } from './xml.js';
import { buildCustomParameters } from './custom-parameters.js';
import { readError, mapProviderError, buildProviderError } from './error-map.js';

const http = axios.create({
  baseURL: env.travelfusion.endpoint,
  // GZip DEVE ser solicitado em todos os requests (Connection Guide). A resposta
  // pode ou não vir comprimida — o axios/undici descomprime sozinho.
  headers: {
    'Content-Type': 'text/xml; charset=utf-8',
    'Accept-Encoding': 'gzip',
  },
  responseType: 'text',
  transitional: { clarifyTimeoutError: true },
});

const isTimeout = (error) =>
  error?.code === 'ETIMEDOUT' || error?.code === 'ECONNABORTED' || error?.code === 'ERR_CANCELED';

/**
 * Envia um comando XML. Ponto único de saída para a Travelfusion.
 *
 * 🔴 `retries` vem da tabela da spec e é 0 para ProcessTerms/StartBooking. Não
 * aumentar: retentar mutação não idempotente cria reserva duplicada, e a
 * Travelfusion audita a quantidade de chamadas antes do go-live.
 */
export async function sendCommand(command, body, context = {}) {
  const { readMs, retries, retryReadMs } = timeoutFor(command);
  const payload = buildCommand(command, { ...body, ...buildCustomParameters(context) });

  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    const timeout = attempt === 0 ? readMs : (retryReadMs || readMs);
    const startedAt = Date.now();
    try {
      const response = await http.post('', payload, { timeout: timeout + CONNECT_TIMEOUT_MS });
      const parsed = await parseXml(response.data);
      const fault = readError(parsed);
      if (fault) throw mapProviderError(fault, command, response.status);
      return { parsed, durationMs: Date.now() - startedAt };
    } catch (error) {
      if (error instanceof AppError) throw error; // erro de negócio do provedor: não retenta
      lastError = error;
      attempt += 1;
      if (attempt > retries) break;
    }
  }

  const providerError = buildProviderError({
    operation: command,
    providerCode: lastError?.code || null,
    providerMessage: lastError?.message || null,
    httpStatus: lastError?.response?.status ?? null,
  });

  if (isTimeout(lastError)) {
    throw new AppError('PROVIDER_TIMEOUT', { providerError, metadata: { operation: command } });
  }
  throw new AppError('PROVIDER_INTEGRATION_ERROR', { providerError, metadata: { operation: command } });
}
