import { Injectable } from '@nestjs/common';
import { env } from '../../../config/env';
import { RequestContext } from '../provider.types';
import { toXml } from '../../../common/xml/xml.util';
import { LatamClient, LatamResult } from './latam.client';

const NS = 'http://www.iata.org/IATA/2015/00/2019.2';

/** Caminhos do Apigee. Só `/airshopping`, `/order/*` e as listas estão no YAML;
 * o OfferPrice é documentado à parte, por isso vem de env — assim uma mudança de
 * rota não exige recompilar. */
export const PATHS = {
  airShopping: process.env.LATAM_PATH_AIRSHOPPING ?? '/airshopping',
  offerPrice: process.env.LATAM_PATH_OFFERPRICE ?? '/offerprice',
  orderCreate: process.env.LATAM_PATH_ORDER_CREATE ?? '/order/create',
  orderRetrieve: process.env.LATAM_PATH_ORDER_RETRIEVE ?? '/order/retrieve',
  orderCancel: process.env.LATAM_PATH_ORDER_CANCEL ?? '/order/cancel',
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
   * OfferPrice = tarifar. Exige OfferRefID + OfferItemRefID (doc price-offer-v2,
   * tabela de campos obrigatórios) — por isso os dois viajam na chave da oferta.
   */
  async offerPrice(offerId: string, offerItemId: string | null, context: RequestContext): Promise<LatamResult> {
    const inner = partyAndPos(context)
      + toXml('Request', {
        PricedOffer: {
          SelectedOffer: {
            OfferRefID: offerId,
            SelectedOfferItem: offerItemId ? { OfferItemRefID: offerItemId } : undefined,
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
    context: RequestContext,
  ): Promise<LatamResult> {
    const inner = partyAndPos(context)
      + toXml('Request', {
        CreateOrder: {
          SelectedOffer: {
            OfferRefID: offerId,
            SelectedOfferItem: offerItemId ? { OfferItemRefID: offerItemId } : undefined,
          },
        },
        DataLists: { PaxList: { Pax: passengers } },
      });

    return this.client.send('OrderCreate', PATHS.orderCreate, envelope('IATA_OrderCreateRQ', inner), context);
  }

  async orderRetrieve(orderId: string, context: RequestContext): Promise<LatamResult> {
    const inner = partyAndPos(context)
      + toXml('Request', { Order: { OrderID: orderId } });

    return this.client.send('OrderRetrieve', PATHS.orderRetrieve, envelope('IATA_OrderRetrieveRQ', inner), context);
  }
}
