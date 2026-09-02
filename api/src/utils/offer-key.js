/**
 * Identificadores opacos — 01-convencoes.md §4.
 *
 * Quem consome trata como caixa-preta e devolve intacto. Do NOSSO lado, o
 * identifier precisa carregar tudo que a Travelfusion exige para retomar a
 * oferta: RoutingId + os ids de ida/volta. Base64url mantém a chave URL-safe
 * e sinaliza que não é para ser lida.
 */
export function encodeOfferKey(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeOfferKey(key) {
  try {
    const decoded = JSON.parse(Buffer.from(String(key), 'base64url').toString('utf8'));
    return decoded && typeof decoded === 'object' ? decoded : null;
  } catch {
    return null;
  }
}
