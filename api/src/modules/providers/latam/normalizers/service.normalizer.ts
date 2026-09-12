import { asList, attr, child, num, text, XmlValue } from '../../../../common/xml/xml.util';
import { roundMoney } from '../../../../common/utils/money';
import { encodeServiceKey } from '../../../../common/utils/service-key';
import { Baggage } from '../../../flight/flight.types';
import {
  CatalogPassenger, CatalogSegment, ProviderAncillary, ProviderAncillaryCatalog,
} from '../../provider.types';

/**
 * `IATA_ServiceListRS` → o catálogo canônico de opcionais.
 *
 * 🔴 Como o mapa de assentos, este normalizador NUNCA lança: leitura degrada
 * para um catálogo vazio e a tela diz "sem opcionais", em vez de derrubar a
 * venda por causa de um catálogo mal formado.
 *
 * O `ServiceList` devolve os MESMOS `ALaCarteOfferItem` do SeatAvailability —
 * inclusive os assentos. Filtramos o que é assento aqui: quem quer assento usa
 * o `/seat-map`, que devolve a grade com fileira e coluna. Repetir 279 assentos
 * numa lista plana de "opcionais" não ajudaria ninguém.
 */
const isSeat = (id: string | null, definition: string | null) =>
  (id ?? '').toUpperCase().startsWith('SEAT_') || (definition ?? '').toUpperCase().startsWith('SEAT_');

/**
 * 🔴 O tipo é DECLARADO, nunca inferido do nome.
 *
 * A LATAM nomeia os itens em SNAKE_CASE (`FIRST_ADDITIONAL_BAGGAGE`), e é
 * tentador classificar por substring. Mas o nome é texto comercial: muda de
 * idioma, muda de campanha, e `OVERWEIGHT` viraria bagagem enquanto
 * `PET_IN_CABIN` viraria "outro". O prefixo do `OfferItemID` é estrutural.
 */
function declaredType(offerItemId: string | null): string | null {
  const id = (offerItemId ?? '').toUpperCase();
  if (id.startsWith('BAG_')) return 'baggage';
  if (id.startsWith('SEAT_')) return 'seat';
  // Sem sinal estrutural o honesto é `null`: quem consome mostra o nome cru.
  return null;
}

/** Franquia estruturada, quando o `ServiceDefinition` a descreve. */
function baggageOf(definition: XmlValue): Baggage | null {
  const pieces = num(child(definition, 'BaggageAllowance', 'PieceAllowance', 'TotalQty'));
  const measure = child(definition, 'BaggageAllowance', 'WeightAllowance', 'MaximumWeightMeasure');
  const weight = num(measure);

  if (pieces === null && weight === null) return null;

  return {
    hand: null,
    hold: {
      included: true,
      pieces,
      weight,
      unit: measure ? attr(measure, 'UnitCode') : null,
      description: text(child(definition, 'Desc', 'DescText')),
      type: 'checked',
    },
  };
}

function readPassengers(payload: XmlValue): CatalogPassenger[] {
  return asList(child(payload, 'DataLists', 'PaxList', 'Pax')).map((pax) => ({
    id: text(child(pax, 'PaxID')) ?? '',
    firstName: text(child(pax, 'Individual', 'GivenName')),
    lastName: text(child(pax, 'Individual', 'Surname')),
    type: text(child(pax, 'PTC')),
  }));
}

function readSegments(payload: XmlValue): CatalogSegment[] {
  return asList(child(payload, 'DataLists', 'PaxSegmentList', 'PaxSegment')).map((segment) => {
    const departure = text(child(segment, 'Dep', 'AircraftScheduledDateTime'));

    return {
      segmentId: text(child(segment, 'PaxSegmentID')),
      origin: text(child(segment, 'Dep', 'IATA_LocationCode')),
      destination: text(child(segment, 'Arrival', 'IATA_LocationCode')),
      // Só a DATA: o modelo pede `departureDate`, e a hora pertence ao itinerário.
      departureDate: departure ? departure.slice(0, 10) : null,
      number: text(child(segment, 'MarketingCarrierInfo', 'MarketingCarrierFlightNumberText')),
      company: { code: text(child(segment, 'MarketingCarrierInfo', 'CarrierDesigCode')), name: null },
    };
  });
}

export function normalizeServiceList(payload: XmlValue): ProviderAncillaryCatalog {
  try {
    /** Nome, descrição e franquia vivem no `ServiceDefinitionList`, ligados por id. */
    const definitions = new Map<string, XmlValue>();

    for (const definition of asList(child(payload, 'DataLists', 'ServiceDefinitionList', 'ServiceDefinition'))) {
      const id = text(child(definition, 'ServiceDefinitionID'));
      if (id) definitions.set(id, definition);
    }

    const offers: ProviderAncillary[] = [];
    let currency: string | null = null;

    for (const item of asList(child(payload, 'ALaCarteOffer', 'ALaCarteOfferItem'))) {
      const offerItemId = text(child(item, 'OfferItemID'));
      const definitionId = text(child(item, 'Service', 'ServiceDefinitionRefID'));

      if (isSeat(offerItemId, definitionId)) continue;

      const amount = child(item, 'UnitPrice', 'TotalAmount');
      const value = num(amount);
      const definition = definitionId ? definitions.get(definitionId) ?? null : null;
      const rfisc = text(child(definition, 'ServiceCode')) ?? text(child(definition, 'RFISC'));

      const price = value === null
        ? null
        : { total: roundMoney(value) ?? value, currency: attr(amount, 'CurCode') };

      if (price?.currency && !currency) currency = price.currency;

      offers.push({
        // A chave opaca carrega o par OfferItemID + ServiceID — ver service-key.ts.
        key: offerItemId
          ? encodeServiceKey({ o: offerItemId, s: text(child(item, 'Service', 'ServiceID')) })
          : null,
        type: declaredType(offerItemId),
        code: rfisc,
        name: text(child(definition, 'Name')) ?? definitionId,
        description: text(child(definition, 'Desc', 'DescText')),
        price,
        passengerId: text(child(item, 'Eligibility', 'PaxRefID')),
        segmentId: text(child(item, 'Eligibility', 'FlightAssociations', 'PaxSegmentRefID')),
        baggage: baggageOf(definition),
      });
    }

    return {
      currency,
      passengers: readPassengers(payload),
      segments: readSegments(payload),
      offers,
    };
  } catch {
    return { currency: null, passengers: [], segments: [], offers: [] };
  }
}
