import { asList, attr, child, num, text, XmlElement, XmlValue } from '../../../../common/xml/xml.util';
import { roundMoney } from '../../../../common/utils/money';
import { encodeServiceKey } from '../../../../common/utils/service-key';
import { ProviderSeat, ProviderSeatMap, ProviderSeatMapSegment } from '../../provider.types';

/**
 * `IATA_SeatAvailabilityRS` → o mapa canônico do contrato.
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
const BLOCKED = new Set(['blocked', 'b']);

const isAvailable = (status: string | null) => AVAILABLE.has((status ?? '').toLowerCase());

function seatStatus(status: string | null): ProviderSeat['status'] {
  const value = (status ?? '').toLowerCase();
  if (AVAILABLE.has(value)) return 'available';
  if (BLOCKED.has(value)) return 'blocked';
  // `occupied` é o que a companhia diz de quem já tem dono; o resto é
  // "não dá para vender", que é diferente de "alguém está sentado ali".
  return value ? 'occupied' : 'unavailable';
}

/** Janela, corredor e meio nos dois vocabulários. O resto fica só no cru. */
const CHARACTERISTIC: Record<string, string> = {
  WINDOWS: 'window', WINDOW: 'window', W: 'window',
  AISLE: 'aisle', A: 'aisle',
  MIDDLE: 'middle', M: 'middle',
};

/** Características que a companhia declara sobre conforto/acesso. */
const ACCESSIBLE = new Set(['1', 'WCHR', 'H']);
const NO_RECLINE = new Set(['NRC', '9']);

function indexSegments(payload: XmlValue): Map<string, XmlElement> {
  const index = new Map<string, XmlElement>();
  for (const segment of asList(child(payload, 'DataLists', 'PaxSegmentList', 'PaxSegment'))) {
    const id = text(child(segment, 'PaxSegmentID'));
    if (id && typeof segment === 'object') index.set(id, segment as XmlElement);
  }
  return index;
}

/** O voo por trás do `PaxSegmentRefID` — o modelo publica o trecho, não só o id. */
function segmentMeta(node: XmlElement | undefined): Omit<ProviderSeatMapSegment, 'segmentId' | 'cabins'> {
  const departure = text(child(node, 'Dep', 'AircraftScheduledDateTime'));

  return {
    origin: text(child(node, 'Dep', 'IATA_LocationCode')),
    destination: text(child(node, 'Arrival', 'IATA_LocationCode')),
    // Só a DATA: o modelo pede `departureDate`, e a hora pertence ao itinerário.
    departureDate: departure ? departure.slice(0, 10) : null,
    number: text(child(node, 'MarketingCarrierInfo', 'MarketingCarrierFlightNumberText')),
    company: { code: text(child(node, 'MarketingCarrierInfo', 'CarrierDesigCode')), name: null },
    equipment: {
      code: text(child(node, 'DatedOperatingLeg', 'CarrierAircraftType', 'CarrierAircraftTypeCode')),
      name: null,
    },
  };
}

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
     * — então é indexado junto com o preço e viaja dentro da chave opaca.
     */
    const serviceByItem = new Map<string, string>();
    const nameByItem = new Map<string, string>();

    for (const item of asList(child(payload, 'ALaCarteOffer', 'ALaCarteOfferItem'))) {
      const id = text(child(item, 'OfferItemID'));
      if (!id) continue;

      const amount = child(item, 'UnitPrice', 'TotalAmount');
      const value = num(amount);
      if (value !== null) {
        priceByItem.set(id, { total: roundMoney(value) ?? value, currency: attr(amount, 'CurCode') });
      }

      const serviceId = text(child(item, 'Service', 'ServiceID'));
      if (serviceId) serviceByItem.set(id, serviceId);

      const name = text(child(item, 'Service', 'ServiceDefinitionRefID'));
      if (name) nameByItem.set(id, name);
    }

    let currency: string | null = null;

    /**
     * Assentos que um passageiro JÁ tem. `null` enquanto a companhia não deu
     * sinal nenhum; `[]` quando ela mostrou os assentos e nenhum é dele.
     */
    const assignedByPax = new Map<string, Array<{ segmentId: string | null; seat: string | null }>>();
    let sawAssignment = false;

    const segmentIndex = indexSegments(payload);

    const segments: ProviderSeatMapSegment[] = asList(child(payload, 'SeatMap')).map((map) => {
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

        const seats: ProviderSeat[] = asList(child(row, 'Seat')).map((seat) => {
          const column = text(child(seat, 'ColumnID'));
          const status = text(child(seat, 'OccupationStatusCode'));
          const itemId = text(child(seat, 'OfferItemRefID'));
          const price = itemId ? priceByItem.get(itemId) ?? null : null;

          if (price?.currency && !currency) currency = price.currency;

          const designator = number && column ? `${number}${column}` : null;

          const raw = asList(child(seat, 'SeatCharacteristicCode'))
            .map((code) => text(code))
            .filter((code): code is string => Boolean(code));

          // Um assento já atribuído traz o dono; é daí que sai `assignedSeats`.
          const paxRef = text(child(seat, 'PaxRefID'));
          if (paxRef) {
            sawAssignment = true;
            const list = assignedByPax.get(paxRef) ?? [];
            list.push({ segmentId, seat: designator });
            assignedByPax.set(paxRef, list);
          }

          return {
            seat: designator,
            row: number,
            column,
            status: seatStatus(status),
            available: isAvailable(status),
            /** `paid: false` só quando a companhia DISSE que é zero. */
            paid: price !== null && price.total > 0,
            price,
            characteristics: raw
              .map((code) => CHARACTERISTIC[code.toUpperCase()])
              .filter((value): value is string => Boolean(value)),
            // O código cru sobrevive ao lado do canônico: é a chave estável.
            providerCharacteristics: raw,
            commercialName: itemId ? nameByItem.get(itemId) ?? null : null,
            accessible: raw.some((code) => ACCESSIBLE.has(code.toUpperCase())) ? true : null,
            recline: raw.some((code) => NO_RECLINE.has(code.toUpperCase())) ? false : null,
            // O par opaco que identifica o assento na compra.
            key: itemId
              ? encodeServiceKey({ o: itemId, s: serviceByItem.get(itemId) ?? null })
              : null,
          };
        });

        return { number, exitRow: false, seats };
      });

      return {
        segmentId,
        ...segmentMeta(segmentId ? segmentIndex.get(segmentId) : undefined),
        cabins: [{ cabinClass, rows }],
      };
    });

    const passengers = asList(child(payload, 'DataLists', 'PaxList', 'Pax')).map((pax) => {
      const id = text(child(pax, 'PaxID')) ?? '';
      return {
        id,
        firstName: text(child(pax, 'Individual', 'GivenName')),
        lastName: text(child(pax, 'Individual', 'Surname')),
        assignedSeats: sawAssignment ? assignedByPax.get(id) ?? [] : null,
      };
    });

    return {
      currency,
      // A LATAM não declara se a marcação exige pagamento; o preço por assento diz
      // o que custa, não se é obrigatório pagar para marcar.
      paymentRequired: null,
      passengers,
      segments,
    };
  } catch {
    // Ver o comentário do topo: leitura degrada, nunca derruba a tela.
    return { currency: null, paymentRequired: null, passengers: [], segments: [] };
  }
}
