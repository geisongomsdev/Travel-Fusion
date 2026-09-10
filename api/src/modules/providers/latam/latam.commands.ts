import { Injectable } from '@nestjs/common';
import { env } from '../../../config/env';
import { RequestContext } from '../provider.types';
import { toXml } from '../../../common/xml/xml.util';
import { LatamClient, LatamResult } from './latam.client';

const NS = 'http://www.iata.org/IATA/2015/00/2019.2';

/** Dono da oferta. Sempre LA: este provedor é a LATAM. */
const OWNER_CODE = 'LA';

/**
 * Caminhos do Apigee, conferidos um a um contra o sandbox.
 *
 * 🔴 `offerPrice` é o único em camelCase: `/ndc/v192/offerprice` responde
 * `404 Invalid url or Method Not Allowed`. O YAML publicado não lista essa
 * rota — descobri o casing sondando o gateway — e é por isso que todas
 * continuam sobreponíveis por env, sem recompilar.
 */
export const PATHS = {
  airShopping: process.env.LATAM_PATH_AIRSHOPPING ?? '/ndc/v192/airshopping',
  offerPrice: process.env.LATAM_PATH_OFFERPRICE ?? '/ndc/v192/offerPrice',
  orderCreate: process.env.LATAM_PATH_ORDER_CREATE ?? '/ndc/v192/order/create',
  orderRetrieve: process.env.LATAM_PATH_ORDER_RETRIEVE ?? '/ndc/v192/order/retrieve',
  orderCancel: process.env.LATAM_PATH_ORDER_CANCEL ?? '/ndc/v192/order/cancel',
  orderReshop: process.env.LATAM_PATH_ORDER_RESHOP ?? '/ndc/v192/order/reshop',
  seatAvailability: process.env.LATAM_PATH_SEATS ?? '/ndc/v192/seats/availability',
  serviceList: process.env.LATAM_PATH_SERVICES ?? '/ndc/v192/services/list',
};

/** Envelope NDC: cada mensagem tem o SEU namespace, derivado do nome. */
function envelope(message: string, inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<${message} xmlns="${NS}/${message}">${inner}</${message}>`;
}

/**
 * `Party` + `POS` vão em toda mensagem e identificam a agência.
 * Montados aqui, não nos casos de uso — mesma razão dos headers.
 */
function partyAndPos(context: RequestContext): string {
  const party = toXml('Party', {
    Sender: {
      TravelAgency: {
        AgencyID: env.latam.agencyId || undefined,
        IATA_Number: env.latam.agencyIata || undefined,
        Name: env.latam.agencyName,
        TravelAgent: env.latam.travelAgentId
          ? { TravelAgentID: env.latam.travelAgentId }
          : undefined,
      },
    },
  });

  const pos = toXml('POS', {
    Country: { CountryCode: context.pointOfSale ?? env.latam.country },
  });

  return `${toXml('MessageDoc', { RefVersionNumber: '1.0' })}${party}${pos}`;
}

export interface AirShoppingRequest {
  legs: Array<{ origin: string; destination: string; date: string }>;
  passengers: { adults: number; children: number; babies: number };
  cabin?: string | null;
}

/** `Pax` da NDC é UM elemento por passageiro, com id estável (ADT_1, CHD_2…). */
export function buildPaxList(passengers: AirShoppingRequest['passengers']): Array<{ PaxID: string; PTC: string }> {
  const list: Array<{ PaxID: string; PTC: string }> = [];
  const push = (ptc: string, count: number) => {
    for (let i = 1; i <= count; i += 1) list.push({ PaxID: `${ptc}_${i}`, PTC: ptc });
  };

  push('ADT', Math.max(1, passengers.adults));
  push('CHD', passengers.children);
  push('INF', passengers.babies);
  return list;
}

const CABIN_CODE: Record<string, string> = {
  economy: 'Y', premium_economy: 'W', business: 'C', first: 'F',
};

@Injectable()
export class LatamCommands {
  constructor(private readonly client: LatamClient) {}

  /** Sonda de credencial: um token novo prova Key/Secret sem gastar busca. */
  async probeToken(): Promise<void> {
    await this.client.getToken(true);
  }

  /**
   * AirShopping — busca SÍNCRONA.
   *
   * 🔴 Aqui não existe polling: a resposta única já traz todas as ofertas. Isso
   * é diferença de fundo para a Travelfusion, e é o que permite ao contrato de
   * stream emitir um `provider_success` só, imediatamente.
   */
  async airShopping(request: AirShoppingRequest, context: RequestContext): Promise<LatamResult> {
    const criteria = request.legs.map((leg) => toXml('OriginDestCriteria', {
      DestArrivalCriteria: { IATA_LocationCode: leg.destination.toUpperCase() },
      OriginDepCriteria: { Date: leg.date, IATA_LocationCode: leg.origin.toUpperCase() },
      PreferredCabinType: request.cabin && CABIN_CODE[request.cabin]
        ? { CabinTypeCode: CABIN_CODE[request.cabin] }
        : undefined,
    })).join('');

    // `OriginDestCriteria` repete uma vez por trecho e a ORDEM é o itinerário —
    // por isso é montado como string, e não por um objeto (chave repetida se
    // perderia). Multidestino cai aqui naturalmente: N trechos, N critérios.
    const request_ = `<Request><FlightCriteria>${criteria}</FlightCriteria>`
      + toXml('Paxs', { Pax: buildPaxList(request.passengers) })
      + toXml('ResponseParameters', { LangUsage: { LangCode: env.latam.lang } })
      + '</Request>';

    return this.client.send(
      'AirShopping',
      PATHS.airShopping,
      envelope('IATA_AirShoppingRQ', partyAndPos(context) + request_),
      context,
    );
  }

  /**
   * OfferPrice = tarifar.
   *
   * 🔴 O XSD cobra três coisas que a doc não destaca, e o gateway rejeita cada
   * uma com um erro diferente:
   *   - `OwnerCode` depois do OfferRefID (`cvc-complex-type.2.4.a`);
   *   - `PaxRefID` dentro do SelectedOfferItem;
   *   - a `PaxList` de volta em `DataLists` — sem ela o PaxRefID vira
   *     `cvc-identity-constraint.4.3: Key 'PaxIDKeyRef4' not found`.
   *
   * Por isso os PaxIDs da busca viajam na chave da oferta: o `/quote` recebe só
   * o identifier e precisa reconstruir a mesma lista que o AirShopping usou.
   */
  async offerPrice(
    offerId: string,
    offerItemId: string | null,
    paxIds: string[],
    context: RequestContext,
  ): Promise<LatamResult> {
    const pax = paxIds.length > 0 ? paxIds : ['ADT_1'];

    const inner = partyAndPos(context)
      + toXml('Request', {
        DataLists: {
          PaxList: { Pax: pax.map((paxId) => ({ PaxID: paxId, PTC: paxId.split('_')[0] })) },
        },
        PricedOffer: {
          SelectedOffer: {
            OfferRefID: offerId,
            OwnerCode: OWNER_CODE,
            SelectedOfferItem: offerItemId
              ? { OfferItemRefID: offerItemId, PaxRefID: pax }
              : undefined,
          },
        },
      });

    return this.client.send('OfferPrice', PATHS.offerPrice, envelope('IATA_OfferPriceRQ', inner), context);
  }

  /**
   * OrderCreate = reservar.
   *
   * 🔴 Sem retry (o client já força retries 0 nesta operação): recriar ordem
   * gera reserva duplicada. Se a resposta se perder, o caminho é OrderRetrieve.
   */
  async orderCreate(
    offerId: string,
    offerItemId: string | null,
    passengers: Array<Record<string, unknown>>,
    contacts: Array<Record<string, unknown>>,
    context: RequestContext,
  ): Promise<LatamResult> {
    // Os PaxIDs saem da própria PaxList: o SelectedOfferItem tem que referenciar
    // exatamente quem está declarado, ou o XSD reclama de chave não encontrada.
    const paxIds = passengers.map((pax) => String(pax.PaxID));

    const inner = partyAndPos(context)
      + toXml('Request', {
        CreateOrder: {
          SelectedOffer: {
            OfferRefID: offerId,
            // Mesma exigência do OfferPrice — ver o comentário lá em cima.
            OwnerCode: OWNER_CODE,
            SelectedOfferItem: offerItemId
              ? { OfferItemRefID: offerItemId, PaxRefID: paxIds }
              : undefined,
          },
        },
        DataLists: {
          ContactInfoList: contacts.length > 0 ? { ContactInfo: contacts } : undefined,
          PaxList: { Pax: passengers },
        },
      });

    return this.client.send('OrderCreate', PATHS.orderCreate, envelope('IATA_OrderCreateRQ', inner), context);
  }

  /**
   * 🔴 O `Order` não fica solto no Request: ele vive dentro de
   * `OrderFilterCriteria`. Sem esse nível o gateway responde 911
   * `cvc-complex-type.2.4.a` apontando o próprio `Order` como inesperado.
   */
  async orderRetrieve(orderId: string, context: RequestContext): Promise<LatamResult> {
    const inner = partyAndPos(context)
      + toXml('Request', {
        OrderFilterCriteria: { Order: { OrderID: orderId, OwnerCode: OWNER_CODE } },
      });

    return this.client.send('OrderRetrieve', PATHS.orderRetrieve, envelope('IATA_OrderRetrieveRQ', inner), context);
  }

  /**
   * SeatAvailability = o mapa de assentos.
   *
   * 🔴 É endereçado pela OFERTA, não pelo localizador: na LATAM a escolha de
   * assento acontece ANTES de reservar. O contrato canônico modela `/seat-map`
   * sobre a reserva, e essa divergência está documentada no README — aqui o
   * `identifier` da oferta faz o papel do localizador.
   */
  async seatAvailability(offerId: string, paxIds: string[], context: RequestContext): Promise<LatamResult> {
    const pax = paxIds.length > 0 ? paxIds : ['ADT_1'];

    const inner = partyAndPos(context)
      + `<Request>${toXml('CoreRequest', { Offer: { OfferID: offerId } })}`
      + toXml('Pax', pax.map((paxId) => ({ PaxID: paxId, PTC: paxId.split('_')[0] })))
      + '</Request>';

    return this.client.send(
      'SeatAvailability',
      PATHS.seatAvailability,
      envelope('IATA_SeatAvailabilityRQ', inner),
      context,
    );
  }

  /**
   * ServiceList = os opcionais vendidos à parte (bagagem extra, etc).
   *
   * Mesma forma do SeatAvailability, e endereçado do mesmo jeito: pela OFERTA.
   * O fluxo publicado é AirShopping → SeatAvailability → ServiceList →
   * OfferPrice → OrderCreate.
   */
  async serviceList(offerId: string, paxIds: string[], context: RequestContext): Promise<LatamResult> {
    const pax = paxIds.length > 0 ? paxIds : ['ADT_1'];

    const inner = partyAndPos(context)
      + `<Request>${toXml('CoreRequest', { Offer: { OfferID: offerId } })}`
      + toXml('Pax', pax.map((paxId) => ({ PaxID: paxId, PTC: paxId.split('_')[0] })))
      + '</Request>';

    return this.client.send('ServiceList', PATHS.serviceList, envelope('IATA_ServiceListRQ', inner), context);
  }

  /**
   * OrderReshop = calcular o reembolso do cancelamento.
   *
   * 🔴 É o PRIMEIRO passo do cancelamento, não uma consulta opcional: o
   * OrderCancel exige `ExpectedRefundAmount`, e o valor sai daqui. Cancelar
   * sem passar por ele é chutar quanto a companhia vai devolver.
   *
   * Read-only: calcula, não cancela nada.
   */
  async orderReshop(orderId: string, context: RequestContext): Promise<LatamResult> {
    const inner = partyAndPos(context)
      + toXml('Request', {
        OrderRefID: orderId,
        UpdateOrder: { CancelOrder: { OrderRefID: orderId } },
      });

    return this.client.send('OrderReshop', PATHS.orderReshop, envelope('IATA_OrderReshopRQ', inner), context);
  }

  /**
   * OrderCancel = cancelar de verdade.
   *
   * 🔴 Mutação não idempotente, como o OrderCreate: o client força `retries: 0`.
   * Se a resposta se perder, o caminho é o OrderRetrieve — nunca cancelar de
   * novo, porque a primeira pode ter valido.
   */
  async orderCancel(orderId: string, refundAmount: number, context: RequestContext): Promise<LatamResult> {
    const inner = partyAndPos(context)
      + toXml('Request', {
        ExpectedRefundAmount: { TotalAmount: refundAmount },
        Order: { OrderID: orderId, OwnerCode: OWNER_CODE },
      });

    return this.client.send('OrderCancel', PATHS.orderCancel, envelope('IATA_OrderCancelRQ', inner), context);
  }
}
