const PROVIDER = 'travelfusion';

/** Envelope de sucesso — 01-convencoes.md §1. Exatamente três chaves no topo. */
export function presentSuccess(data, { durationMs = 0, operation = null, correlationId = null } = {}) {
  return {
    success: true,
    data,
    meta: {
      provider: PROVIDER,
      duration: durationMs,
      timestamp: new Date().toISOString(),
      ...(operation ? { operation } : {}),
      ...(correlationId ? { correlationId } : {}),
    },
  };
}
