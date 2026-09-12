/**
 * A chave opaca de um opcional — `offers[].key` no contrato.
 *
 * 🔴 A LATAM precisa de DOIS identificadores para vender um extra: o
 * `OfferItemID` e o `ServiceID`. Eles vivem em lugares diferentes da resposta
 * (o segundo só aparece no `ALaCarteOfferItem`) e a compra falha com
 * `400112165` quando falta o `SelectedServiceRefID`.
 *
 * O contrato publica UMA chave. Publicar as duas — como `offerItemId` e
 * `serviceId` soltos — obrigaria quem consome a carregar um par e a saber que
 * os dois andam juntos, virando detalhe da LATAM vazado para dentro do
 * vocabulário comum. O par viaja aqui dentro: é opaco, é copiado literalmente,
 * e quem consome nunca precisa saber que são dois.
 */
export interface ServiceKey {
  /** `OfferItemID` — `SEAT_…`/`BAG_…` na ordem, `SEI|…` na oferta. */
  o: string;
  /** `ServiceID`, quando a companhia o declara. */
  s?: string | null;
}

export function encodeServiceKey(key: ServiceKey): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

export function decodeServiceKey(value: unknown): ServiceKey | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object') return null;
    const candidate = decoded as ServiceKey;
    return typeof candidate.o === 'string' ? candidate : null;
  } catch {
    return null;
  }
}
