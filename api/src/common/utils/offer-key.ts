/**
 * Identificadores opacos — 01-convencoes.md §4.
 *
 * Quem consome trata como caixa-preta e devolve intacto. Do NOSSO lado, a chave
 * precisa carregar tudo que a Travelfusion exige para retomar a oferta:
 * RoutingId + ids de perna. Base64url mantém a chave URL-safe e sinaliza que não
 * é para ser lida.
 */
export interface OfferKey {
  p: string;
  r: string;
  o?: string | null;
  i?: string | null;
  d?: string | null;
  k?: string | null;
}

export function encodeOfferKey(payload: OfferKey): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeOfferKey(key: unknown): OfferKey | null {
  if (typeof key !== 'string' || key.length === 0) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(key, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object') return null;
    const candidate = decoded as OfferKey;
    return typeof candidate.r === 'string' ? candidate : null;
  } catch {
    return null;
  }
}
