import { encodeOfferKey } from '../../../../common/utils/offer-key';
import { roundMoney } from '../../../../common/utils/money';
import { LATAM } from '../../../../config/env';
import {
  asList, attr, child, num, text, XmlElement, XmlValue,
} from '../../../../common/xml/xml.util';
import {
  Airport, Baggage, Cabin, Fare, FarePrice, FareRulesInfo, Leg, PassengerPrice, Segment,
} from '../../../flight/flight.types';
import { ProviderOffer } from '../../provider.types';

/**
 * `CabinTypeCode` da LATAM é o RBD de cabine da IATA, não texto livre.
 * 🔴 Código desconhecido vira `null` — publicar o rótulo cru faria uma busca por
 * econômica casar com oferta de outra cabine.
 */
const CABIN_BY_CODE: Record<string, Cabin> = {
  Y: 'economy', M: 'economy',
  W: 'premium_economy', S: 'premium_economy',
  C: 'business', J: 'business',
  F: 'first',
};

const CABIN_BY_NAME: Record<string, Cabin> = {
  economy: 'economy',
  premiumeconomy: 'premium_economy', premiumbusiness: 'business',
  business: 'business', first: 'first',
};

export function canonicalCabin(code: string | null, name: string | null): Cabin | null {
  if (code && CABIN_BY_CODE[code.toUpperCase()]) return CABIN_BY_CODE[code.toUpperCase()];
  if (name) return CABIN_BY_NAME[name.toLowerCase().replace(/[\s_-]/g, '')] ?? null;
  return null;
}

const airport = (code: string | null): Airport | null =>
  code ? { code: code.toUpperCase(), name: null } : null;

/**
 * `AircraftScheduledDateTime` vem SEM offset no texto e com o fuso no atributo
 * `TimeZoneCode`. Juntar os dois é obrigatório: sem o offset, um voo que sai
 * 23:00 em Lima vira outro dia em quem consome.
 */
function localDateTime(node: XmlValue): string | null {
  const stamp = child(node, 'AircraftScheduledDateTime');
  const raw = text(stamp);
  if (!raw) return null;

  const zone = attr(stamp, 'TimeZoneCode');
  if (!zone || /[Zz]|[+-]\d{2}:\d{2}$/.test(raw)) return raw;
  return `${raw}${zone}`;
}

/** `<Amount CurCode="BRL">123</Amount>` → número + moeda. */
function amount(node: XmlValue): { value: number | null; currency: string | null } {
  return { value: num(node), currency: attr(node, 'CurCode') };
}

/** Índice genérico `id → elemento`, que é como toda DataList da NDC funciona. */
function indexBy(list: XmlValue, idField: string): Map<string, XmlElement> {
  const index = new Map<string, XmlElement>();
  for (const entry of asList(list)) {
    const id = text(child(entry, idField));
    if (id && typeof entry === 'object') index.set(id, entry as XmlElement);
  }
  return index;
}

export const indexSegments = (dataLists: XmlValue): Map<string, XmlElement> =>
  indexBy(child(dataLists, 'PaxSegmentList', 'PaxSegment'), 'PaxSegmentID');

export const indexBaggage = (dataLists: XmlValue): Map<string, XmlElement> =>
  indexBy(child(dataLists, 'BaggageAllowanceList', 'BaggageAllowance'), 'BaggageAllowanceID');

export const indexPriceClasses = (dataLists: XmlValue): Map<string, XmlElement> =>
  indexBy(child(dataLists, 'PriceClassList', 'PriceClass'), 'PriceClassID');

/** `PaxJourneyID → [PaxSegmentRefID]`, na ordem do itinerário. */
export function indexJourneys(dataLists: XmlValue): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const journey of asList(child(dataLists, 'PaxJourneyList', 'PaxJourney'))) {
    const id = text(child(journey, 'PaxJourneyID'));
    if (!id) continue;

    index.set(
      id,
      asList(child(journey, 'PaxSegmentRefID'))
        .map((ref) => text(ref))
        .filter((ref): ref is string => ref !== null),
    );
  }
  return index;
}

function normalizeSegment(node: XmlValue, index: number): Segment {
  const marketing = text(child(node, 'MarketingCarrierInfo', 'CarrierDesigCode'));
  const operating = text(child(node, 'OperatingCarrierInfo', 'CarrierDesigCode'));

  return {
    origin: airport(text(child(node, 'Dep', 'IATA_LocationCode'))),
    destination: airport(text(child(node, 'Arrival', 'IATA_LocationCode'))),
    time: {
      departure: localDateTime(child(node, 'Dep')),
      arrival: localDateTime(child(node, 'Arrival')),
    },
    company: {
      code: marketing,
      name: null,
      // 🔴 Codeshare é do SEGMENTO: quando a LATAM não repete o operador, quem
      // opera é quem comercializa — não `null`, que quem consome leria como
      // "desconhecido" e esconderia um voo operado por parceira.
      operating: operating ?? marketing,
    },
    number: text(child(node, 'MarketingCarrierInfo', 'MarketingCarrierFlightNumberText')),
    segment: index,
    connection: index > 0,
    equipment: {
      code: text(child(node, 'DatedOperatingLeg', 'CarrierAircraftType', 'CarrierAircraftTypeCode')),
      name: null,
      description: null,
    },
    cabin: canonicalCabin(
      text(child(node, 'CabinType', 'CabinTypeCode')),
      text(child(node, 'CabinType', 'CabinTypeName')),
    ),
  };
}

/**
 * O `FareDetail` é POR TIPO DE PASSAGEIRO (`PaxRefID` = ADT_1 / CHD_1 / INF_1),
 * e é dele que sai a discriminação adult/child/baby do contrato.
 */
function passengerPrice(fareDetail: XmlValue, fallbackCurrency: string): PassengerPrice | null {
  const price = child(fareDetail, 'FarePriceType', 'Price') ?? child(fareDetail, 'Price');
  if (!price) return null;

  const base = amount(child(price, 'BaseAmount'));
  const total = amount(child(price, 'TotalAmount'));
  const tax = amount(child(price, 'TaxSummary', 'TotalTaxAmount'));
  if (base.value === null && total.value === null) return null;

  return {
    base: roundMoney(base.value ?? 0),
    taxes: { boarding: roundMoney(tax.value ?? 0) ?? 0, service: 0, fuel: 0, baggage: 0 },
    fees: 0,
    total: roundMoney(total.value ?? (base.value ?? 0) + (tax.value ?? 0)),
    currency: base.currency ?? total.currency ?? fallbackCurrency,
  };
}

/** `PaxRefID` é `ADT_1`, `CHD_2`… — o prefixo é o tipo. */
const ptcOf = (fareDetail: XmlValue): string => {
  const first = asList(child(fareDetail, 'PaxRefID')).map((ref) => text(ref)).find(Boolean) ?? '';
  return first.split('_')[0].toUpperCase();
};

/**
 * Bagagem do contrato a partir do `BaggageAllowance` da oferta.
 *
 * 🔴 Só `TypeCode=Checked` conta como despachada. `CarryOn` e item pessoal são
 * outra coisa, e somá-los faria uma tarifa LIGHT (sem despacho) parecer que
 * inclui mala.
 */
function normalizeBaggage(offer: XmlValue, baggageIndex: Map<string, XmlElement>): Baggage {
  const refs = asList(child(offer, 'BaggageAllowance'))
    .map((entry) => text(child(entry, 'BaggageAllowanceRefID')))
    .filter((id): id is string => id !== null);

  const checked = refs
    .map((id) => baggageIndex.get(id))
    .filter((bag): bag is XmlElement => bag !== undefined && text(child(bag, 'TypeCode')) === 'Checked');

  if (checked.length === 0) {
    // Ausência de nó `Checked` numa resposta que TRAZ bagagem de mão é sinal
    // real de "não inclui", não de desconhecido.
    return { included: refs.length > 0 ? false : null, quantity: null, weight: null, unit: null };
  }

  const [first] = checked;

  // A LATAM repete WeightAllowance em KG e POUNDS. KG é o que o contrato publica.
  const measures = asList(child(first, 'WeightAllowance'))
    .map((entry) => child(entry, 'MaximumWeightMeasure'))
    .filter((measure): measure is XmlValue => measure !== undefined);

  const kilos = measures.find((measure) => attr(measure, 'UnitCode') === 'KG');
  const measured = kilos ?? measures[0];

  return {
    included: true,
    quantity: num(child(first, 'PieceAllowance', 'TotalQty')) ?? checked.length,
    weight: num(measured),
    unit: measured ? attr(measured, 'UnitCode') : null,
  };
}

/**
 * `AllowedModificationInd` responde reembolsável/alterável direto — melhor sinal
 * que a Travelfusion dá, que não estrutura isso.
 */
function buildFareRules(offer: XmlValue, offerId: string, journeyId: string | null): FareRulesInfo {
  const offerItems = asList(child(offer, 'OfferItem'));

  const indicator = (field: string): boolean | null => {
    const values = offerItems
      .flatMap((item) => asList(child(item, field)))
      .map((node) => text(child(node, 'AllowedModificationInd')))
      .filter((value): value is string => value !== null);

    if (values.length === 0) return null;
    // Basta um passageiro não poder para a oferta inteira não poder.
    return values.every((value) => value.toLowerCase() === 'true');
  };

  return {
    refundable: indicator('CancelRestrictions'),
    changeable: indicator('ChangeRestrictions'),
    penalties: [],
    refund: null,
    change: null,
    cancellation: null,
    noShow: null,
    endorsable: null,
    transferable: null,
    key: encodeOfferKey({ p: LATAM, r: offerId, o: journeyId, k: 'rules' }),
  };
}

function normalizeFare(
  offer: XmlValue,
  passengerCount: number,
  offerId: string,
  journeyId: string | null,
  priceClasses: Map<string, XmlElement>,
  baggageIndex: Map<string, XmlElement>,
): Fare {
  const totalPrice = child(offer, 'TotalPrice');
  const base = amount(child(totalPrice, 'BaseAmount'));
  const total = amount(child(totalPrice, 'TotalAmount'));
  const tax = amount(child(totalPrice, 'TaxSummary', 'TotalTaxAmount'));
  const currency = total.currency ?? base.currency ?? 'BRL';

  const offerItems = asList(child(offer, 'OfferItem'));
  const fareDetails = offerItems.flatMap((item) => asList(child(item, 'FareDetail')));

  const byPtc = (ptc: string): PassengerPrice | null => {
    const match = fareDetails.find((detail) => ptcOf(detail) === ptc);
    return match ? passengerPrice(match, currency) : null;
  };

  const adult = byPtc('ADT');
  // 🔴 Tudo-ou-nada: sem o adulto, publicar só criança não explicaria o total.
  const hasBreakdown = adult !== null;

  const firstComponent = fareDetails
    .flatMap((detail) => asList(child(detail, 'FareComponent')))
    .find((component) => component !== undefined);

  const priceClass = priceClasses.get(text(child(firstComponent, 'PriceClassRefID')) ?? '');

  // `FareRefText` é o nome comercial da família (LIGHT, PLUS, TOP).
  const familyText = fareDetails.map((detail) => text(child(detail, 'FareRefText'))).find(Boolean) ?? null;

  const price: FarePrice = {
    adult: hasBreakdown ? adult : null,
    child: hasBreakdown ? byPtc('CHD') : null,
    baby: hasBreakdown ? byPtc('INF') : null,
    total: {
      base: roundMoney(base.value ?? 0),
      taxes: { boarding: roundMoney(tax.value ?? 0) ?? 0, service: 0, fuel: 0, baggage: 0 },
      fees: 0,
      total: roundMoney(total.value ?? 0),
      currency,
    },
    perPassenger: roundMoney((total.value ?? 0) / Math.max(1, passengerCount)),
    net: null,
    exchange: null,
  };

  return {
    // Diferente da Travelfusion, a LATAM identifica o item tarifário.
    fareId: text(child(offerItems[0], 'OfferItemID')),
    code: text(child(priceClass, 'Code')) ?? familyText,
    familyCode: text(child(priceClass, 'Code')),
    family: text(child(priceClass, 'Name')) ?? familyText,
    fareCode: text(child(firstComponent, 'FareBasisCode')),
    bookingCode: text(child(firstComponent, 'RBD', 'RBD_Code')),
    cabin: null,
    seats: null,
    price,
    fees: [],
    baggage: normalizeBaggage(offer, baggageIndex),
    rules: buildFareRules(offer, offerId, journeyId),
    benefits: {
      seatSelection: null, checkedBaggage: null, carryOn: null, meal: null,
      loyaltyPoints: null, priorityBoarding: null, refund: null, change: null,
    },
  };
}

function buildLeg(
  segments: Segment[],
  fare: Fare,
  offerId: string,
  journeyId: string | null,
  offerItemId: string | null,
  paxIds: string[],
  direction: 'outward' | 'return',
): Leg {
  const first = segments[0];
  const last = segments[segments.length - 1];
  const sameCabin = segments.every((segment) => segment.cabin === first?.cabin);

  return {
    // `i` carrega o OfferItemID: o OfferPrice exige OfferRefID + OfferItemRefID,
    // e sem ele a chave não conseguiria tarifar a própria oferta que representa.
    identifier: encodeOfferKey({ p: LATAM, r: offerId, o: journeyId, i: offerItemId, d: direction, x: paxIds }),
    company: { code: first?.company.code ?? null, name: first?.company.name ?? null },
    origin: first?.origin ?? null,
    destination: last?.destination ?? null,
    time: { departure: first?.time.departure ?? null, arrival: last?.time.arrival ?? null },
    stops: segments.length > 0 ? segments.length - 1 : null,
    flights: segments,
    // A cabine do trecho é a do primeiro segmento quando todos concordam.
    fares: [{ ...fare, cabin: sameCabin ? (first?.cabin ?? null) : null }],
    fees: [],
  };
}

/**
 * Um `<Offer>` da LATAM vira UMA oferta canônica — ida + volta juntas.
 *
 * 🔴 A LATAM DECLARA a combinabilidade: o `OfferID` cobre o itinerário inteiro e
 * o `Service/ServiceAssociations/PaxJourneyRefID` diz quais bounds ele contém.
 * Exatamente como o `RoutingId` da Travelfusion, isso a classifica como provedor
 * de PACOTE (04-availability-formatos.md §2) — a ordem dos journeys é a ordem
 * dos bounds, e parear por conta própria está proibido.
 */
export function normalizeOffer(
  offer: XmlValue,
  dataLists: XmlValue,
  passengerCount: number,
  paxIds: string[],
): ProviderOffer | null {
  const offerId = text(child(offer, 'OfferID'));
  if (!offerId) return null;

  const segmentIndex = indexSegments(dataLists);
  const journeyIndex = indexJourneys(dataLists);
  const baggageIndex = indexBaggage(dataLists);
  const priceClasses = indexPriceClasses(dataLists);

  // Ordem preservada e duplicatas removidas: o mesmo journey aparece repetido
  // em vários Service (um por passageiro), mas o bound é um só.
  const journeyIds: string[] = [];
  for (const item of asList(child(offer, 'OfferItem'))) {
    for (const service of asList(child(item, 'Service'))) {
      for (const ref of asList(child(service, 'ServiceAssociations', 'PaxJourneyRefID'))) {
        const id = text(ref);
        if (id && !journeyIds.includes(id)) journeyIds.push(id);
      }
    }
  }

  if (journeyIds.length === 0) return null;

  const legFor = (journeyId: string, direction: 'outward' | 'return'): Leg | null => {
    const segmentIds = journeyIndex.get(journeyId);
    if (!segmentIds || segmentIds.length === 0) return null;

    const segments = segmentIds
      .map((id) => segmentIndex.get(id))
      .filter((node): node is XmlElement => node !== undefined)
      .map((node, index) => normalizeSegment(node, index));

    if (segments.length === 0) return null;

    const fare = normalizeFare(offer, passengerCount, offerId, journeyId, priceClasses, baggageIndex);
    return buildLeg(segments, fare, offerId, journeyId, fare.fareId, paxIds, direction);
  };

  const outbound = legFor(journeyIds[0], 'outward');
  if (!outbound) return null;

  return { outbound, inbound: journeyIds.length > 1 ? legFor(journeyIds[1], 'return') : null };
}

/** Todas as ofertas de um `IATA_AirShoppingRS` já normalizadas. */
export function normalizeAirShopping(payload: XmlValue, passengerCount: number, paxIds: string[]): ProviderOffer[] {
  const dataLists = child(payload, 'DataLists');

  const offers = [
    // A LATAM usa `CarrierOffers`; a NDC padrão documenta `AirlineOffers`.
    ...asList(child(payload, 'OffersGroup', 'CarrierOffers', 'Offer')),
    ...asList(child(payload, 'OffersGroup', 'AirlineOffers', 'Offer')),
  ];

  return offers
    .map((offer) => normalizeOffer(offer, dataLists, passengerCount, paxIds))
    .filter((offer): offer is ProviderOffer => offer !== null);
}
