import { AppError } from '../common/errors/app-error';
import { env } from './env';

/**
 * Valores que vêm do `.env.example` e não são credencial de verdade. Copiar o
 * exemplo sem preencher é o caminho mais comum de erro em quem clona o repo, e
 * sem esta lista o sintoma vira um 400 do provedor — que o contrato traduz para
 * 502 "retente", mandando a pessoa retentar uma coisa que nunca vai funcionar.
 */
const PLACEHOLDERS = new Set(['', 'troque-aqui', 'changeme', 'mock', 'xxx', 'senha']);

export interface CredentialsStatus {
  configured: boolean;
  reason: 'missing_username' | 'placeholder_password' | 'missing_password' | null;
}

export function credentialsStatus(): CredentialsStatus {
  const { xmlLoginId, password } = env.travelfusion;

  if (!xmlLoginId.trim()) return { configured: false, reason: 'missing_username' };
  if (!password.trim()) return { configured: false, reason: 'missing_password' };
  if (PLACEHOLDERS.has(password.trim().toLowerCase())) {
    // Contra o mock isso é aceitável: ele não valida senha.
    return { configured: isMockEndpoint(), reason: isMockEndpoint() ? null : 'placeholder_password' };
  }

  return { configured: true, reason: null };
}

export function isMockEndpoint(): boolean {
  return /localhost|127\.0\.0\.1/.test(env.travelfusion.endpoint);
}

/**
 * 🔴 Falha ANTES de sair para a rede.
 *
 * O código é 401 `PROVIDER_AUTHENTICATION_FAILED` de propósito: pelo catálogo,
 * 401 significa "revise o cadastro da credencial, NÃO retente", enquanto 502
 * significa "problema técnico, retente". Credencial em branco é a primeira
 * coisa, não a segunda — devolver 502 aqui manda alguém retentar para sempre.
 */
export function assertCredentialsConfigured(operation: string): void {
  const status = credentialsStatus();
  if (status.configured) return;

  const hint = status.reason === 'placeholder_password'
    ? 'TF_PASSWORD ainda está com o valor de exemplo. Preencha o .env, ou aponte TF_ENDPOINT para o mock local.'
    : 'Credencial da Travelfusion ausente. Defina TF_XML_LOGIN_ID e TF_PASSWORD no .env.';

  throw new AppError('PROVIDER_AUTHENTICATION_FAILED', {
    metadata: { operation },
    providerError: {
      provider: 'travelfusion',
      operation,
      providerCode: status.reason,
      providerMessage: hint,
      providerSeverity: null,
      httpStatus: null,
    },
  });
}
