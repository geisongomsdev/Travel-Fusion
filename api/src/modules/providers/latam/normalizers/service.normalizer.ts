import { asList, attr, child, num, text, XmlValue } from '../../../../common/xml/xml.util';
import { roundMoney } from '../../../../common/utils/money';
import { ProviderAncillary } from '../../provider.types';

/**
 * `IATA_ServiceListRS` → a lista canônica de opcionais.
 *
 * 🔴 Como o mapa de assentos, este normalizador NUNCA lança: leitura degrada
 * para `[]` e a tela diz "sem opcionais", em vez de derrubar a venda por causa
 * de um catálogo mal formado.
 *
 * O `ServiceList` devolve os MESMOS `ALaCarteOfferItem` do SeatAvailability —
 * inclusive os assentos. Filtramos o que é assento aqui: quem quer assento usa
 * o `/seat-map`, que devolve a grade com fileira e coluna. Repetir 279 assentos
 * numa lista plana de "opcionais" não ajudaria ninguém.
 */
const isSeat = (id: string | null, definition: string | null) =>
  (id ?? '').toUpperCase().startsWith('SEAT_') || (definition ?? '').toUpperCase().startsWith('SEAT_');

export function normalizeServiceList(payload: XmlValue): ProviderAncillary[] {
  try {
    /** Nome e descrição vivem no `ServiceDefinitionList`, ligados por id. */
    const definitions = new Map<string, { name: string | null; description: string | null }>();

    for (const definition of asList(child(payload, 'DataLists', 'ServiceDefinitionList', 'ServiceDefinition'))) {
      const id = text(child(definition, 'ServiceDefinitionID'));
      if (!id) continue;

      definitions.set(id, {
        name: text(child(definition, 'Name')),
        description: text(child(definition, 'Desc', 'DescText')),
      });
    }

    const items: ProviderAncillary[] = [];

    for (const item of asList(child(payload, 'ALaCarteOffer', 'ALaCarteOfferItem'))) {
      const offerItemId = text(child(item, 'OfferItemID'));
      const definitionId = text(child(item, 'Service', 'ServiceDefinitionRefID'));

      if (isSeat(offerItemId, definitionId)) continue;

      const amount = child(item, 'UnitPrice', 'TotalAmount');
      const value = num(amount);
      const definition = definitionId ? definitions.get(definitionId) ?? null : null;

      items.push({
        // O par opaco que identifica o serviço na compra. Devolver intacto.
        offerItemId,
        serviceId: text(child(item, 'Service', 'ServiceID')),
        name: definition?.name ?? definitionId,
        description: definition?.description ?? null,
        price: value === null ? null : { total: roundMoney(value) ?? value, currency: attr(amount, 'CurCode') },
        paxId: text(child(item, 'Eligibility', 'PaxRefID')),
        segmentId: text(child(item, 'Eligibility', 'FlightAssociations', 'PaxSegmentRefID')),
      });
    }

    return items;
  } catch {
    return [];
  }
}
