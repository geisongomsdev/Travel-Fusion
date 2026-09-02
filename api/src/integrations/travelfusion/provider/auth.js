import { env } from '../../../config/env.js';
import { sendCommand } from './client.js';
import { text } from './xml.js';
import { AppError } from '../../../domain/errors.js';

/**
 * O LoginId é válido INDEFINIDAMENTE e o Login só pode ser chamado poucas vezes
 * por dia (Login Handling Guide, pág. 107).
 *
 * 🔴 Fazer Login por request derruba a conta. A regra da casa de resolver
 * credencial do banco a cada request vale para usuário/senha — não para refazer
 * o Login. Por isso o LoginId fica em cache de processo.
 */
let cached = null;

export function primeLoginId(loginId) {
  cached = { loginId, obtainedAt: Date.now() };
}

export function clearLoginId() {
  cached = null;
}

export async function getLoginId({ force = false } = {}) {
  if (cached && !force) return cached.loginId;

  const { parsed } = await sendCommand('Login', {
    Username: env.travelfusion.xmlLoginId,
    Password: env.travelfusion.password,
  });

  const loginId = text(parsed?.LoginResponse?.LoginId) || text(parsed?.Login?.LoginId);
  if (!loginId) {
    throw new AppError('PROVIDER_AUTHENTICATION_FAILED', { metadata: { operation: 'login' } });
  }

  cached = { loginId, obtainedAt: Date.now() };
  return loginId;
}

/**
 * Os dois identificadores que TODO comando carrega como filhos diretos.
 * `XmlLoginId` = a nossa conta XML; `LoginId` = o usuário final — no nosso caso,
 * o mesmo valor.
 */
export async function authFields() {
  const loginId = await getLoginId();
  return { XmlLoginId: env.travelfusion.xmlLoginId, LoginId: loginId };
}
