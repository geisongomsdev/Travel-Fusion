import { asList, attr, child, num, text, XmlValue } from '../../../../common/xml/xml.util';
import { roundMoney } from '../../../../common/utils/money';
import { ProviderSeatMap } from '../../provider.types';

/**
 * `IATA_SeatAvailabilityRS` → o mapa canônico do contrato (09-assentos.md §5.2).
 *
 * 🔴 Este normalizador NUNCA lança. Mapa ilegível degrada para `segments: []`,
 * e a tela mostra "indisponível" em vez de quebrar — a regra do contrato é
 * explícita: a leitura degrada, a mutação falha. Um mapa que não abre é
 * inconveniente; uma mutação que mente é defeito grave.
 */

/**
 * 🔴 A LATAM fala DOIS vocabulários no mesmo endpoint, e qual deles chega
 * depende do header `x-latam-Api-Version`: a V1 devolve `Available` /
 * `Unavailable` / `WINDOWS`, a V2 devolve `F` (free), `O` (occupied) e `W`.
 * Nada disso está na doc — foi medido chamando a MESMA oferta com e sem o
 * header, e é o que explicava 279 assentos voltarem todos como ocupados.
 *
 * Aceitar os dois é o certo: prender na V1 jogaria fora o resto do que a V2
 * traz, e prender na V2 quebra quem rodar sem o header.
 */
const AVAILABLE = new Set(['available', 'f']);

const isAvailable = (status: string | null) => AVAILABLE.has((status ?? '').toLowerCase());

/** Janela, corredor e meio nos dois vocabulários. O resto vira `null`. */
const CHARACTERISTIC: Record<string, string> = {
  WINDOWS: 'window', WINDOW: 'window', W: 'window',
  AISLE: 'aisle', A: 'aisle',
  MIDDLE: 'middle', M: 'middle',
};

export function normalizeSeatMap(payload: XmlValue): ProviderSeatMap {
  try {
    /**
     * O preço de cada assento vive no `ALaCarteOffer`, ligado ao `Seat` pelo
     * `OfferItemRefID`. Indexamos primeiro para não varrer a lista por assento.
     */
    const priceByItem = new Map<string, { total: number; currency: string | null }>();

    /**
     * 🔴 O `ServiceID` do item é OBRIGATÓRIO na compra: sem
     * `SelectedBundleServices/SelectedServiceRefID` o OrderCreate responde
     * `400112165`. Ele não aparece no `SeatRow` — só aqui, no ALaCarteOfferItem
     * — então é indexado junto com o preço.
     */
    const serviceByItem = new Map<string, string>();

    for (const item of asList(child(payload, 'ALaCarteOffer', 'ALaCarteOfferItem'))) {
      const id = text(child(item, 'OfferItemID'));
      if (!id) continue;

      const amount = child(item, 'UnitPrice', 'TotalAmount');
      const value = num(amount);
      if (value === null) continue;

      priceByItem.set(id, { total: roundMoney(value) ?? value, currency: attr(amount, 'CurCode') });

      const serviceId = text(child(item, 'Service', 'ServiceID'));
      if (serviceId) serviceByItem.set(id, serviceId);
    }

    let currency: string | null = null;

    const segments = asList(child(payload, 'SeatMap')).map((map) => {
      const segmentId = text(child(map, 'PaxSegmentRefID'));

      /**
       * 🔴 A LATAM emite UM `CabinCompartment` POR FILEIRA — 31 compartimentos
       * com um `SeatRow` cada, não um compartimento com 31 fileiras. Tratar
       * como um só devolve zero assentos, que foi exatamente o que aconteceu.
       */
      const compartments = asList(child(map, 'CabinCompartment'));
      const cabinClass = text(child(compartments[0], 'CabinType', 'CabinTypeName'));

      const rows = compartments.flatMap((compartment) => asList(child(compartment, 'SeatRow'))).map((row) => {
        const number = text(child(row, 'RowNumber'));

        const seats = asList(child(row, 'Seat')).map((seat) => {
          const column = text(child(seat, 'ColumnID'));
          const status = text(child(seat, 'OccupationStatusCode'));
          const itemId = text(child(seat, 'OfferItemRefID'));
          const price = itemId ? priceByItem.get(itemId) ?? null : null;

          if (price?.currency && !currency) currency = price.currency;

          const characteristic = text(child(seat, 'SeatCharacteristicCode'));

          return {
            seat: number && column ? `${number}${column}` : null,
            row: number,
            column,
            status: isAvailable(status) ? 'available' : 'occupied',
            available: isAvailable(status),
            /** `paid: false` só quando a companhia DISSE que é zero. */
            paid: price !== null && price.total > 0,
            price,
            characteristic: characteristic ? CHARACTERISTIC[characteristic.toUpperCase()] ?? null : null,
            /** Os dois voltam intactos: é o par que identifica o assento na compra. */
            offerItemId: itemId,
            serviceId: itemId ? serviceByItem.get(itemId) ?? null : null,
          };
        });

        return { number, exitRow: false, seats };
      });

      return { segmentId, cabins: [{ cabinClass, rows }] };
    });

    return { currency, segments };
  } catch {
    // Ver o comentário do topo: leitura degrada, nunca derruba a tela.
    return { currency: null, segments: [] };
  }
}
