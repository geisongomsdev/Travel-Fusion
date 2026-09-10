/**
 * Cliente da API. Duas formas de falar com ela, porque o contrato tem duas:
 * as 16 rotas JSON e o /availability, que é stream.
 */
const BASE = '/api';

export async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    const error = new Error(payload?.message || 'Falha na requisição');
    error.code = payload?.error?.code || 'UNEXPECTED_ERROR';
    error.status = response.status;
    error.details = payload?.details || null;
    error.providerError = payload?.providerError || null;
    // A operação é o que deixa a tela dizer a frase certa: o mesmo código
    // significa coisas diferentes em rotas diferentes.
    error.metadata = payload?.metadata || null;
    throw error;
  }
  return payload;
}

/**
 * O /availability responde `text/event-stream`. Não dá para usar EventSource
 * (que só faz GET), então lemos o corpo em chunks e cortamos nos `\n\n`.
 */
export async function streamAvailability(body, onEvent) {
  const response = await fetch(`${BASE}/availability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = new Error(payload?.message || 'Falha na busca');
    error.code = payload?.error?.code || 'UNEXPECTED_ERROR';
    throw error;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch {
        // frame parcial ou malformado: ignora e segue o stream
      }
    }
  }
}
