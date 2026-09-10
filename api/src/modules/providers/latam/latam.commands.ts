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
  orderChangePayment: process.env.LATAM_PATH_PAY ?? '/ndc/v192/order/change/payment',
  installments: process.env.LATAM_PATH_INSTALLMENTS ?? '/ndc/v192/installments/options',
  /** 🔴 v241, não v192: comprar opcional sobre ordem emitida só existe no 24.1. */
  orderChange241: process.env.LATAM_PATH_ORDER_CHANGE_241 ?? '/ndc/v241/order/change',
};

/** Envelope NDC: cada mensagem tem o SEU namespace, derivado do nome. */
function envelope(message: string, inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<${message} xmlns="${NS}/${message}">${inner}</${message}>`;
}

const EASD_MSG = 'http://www.iata.org/IATA/2015/EASD/00/IATA_OffersAndOrdersMessage';
const EASD_COMMON = 'http://www.iata.org/IATA/2015/EASD/00/IATA_OffersAndOrdersCommonTypes';

/**
 * Envelope do 24.1. NÃO é o `envelope()` acima com outra versão: o EASD usa
 * DOIS namespaces — o da mensagem, prefixado `easd:` nos filhos diretos, e o
 * dos tipos comuns, que é o default e cobre todo o resto da árvore.
 */
function easdEnvelope(message: string, inner: string): string {
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + `<easd:${message} xmlns:easd="${EASD_MSG}" xmlns="${EASD_COMMON}">${inner}</easd:${message}>`;
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

/**
 * O catálogo de opcionais é endereçável de dois jeitos, e a diferença NÃO é
 * cosmética — muda o id que volta:
 *
 *   • por OFERTA (antes de reservar) → `OfferItemID` no formato `SEI|...`,
 *     que só serve para o OrderCreate v192;
 *   • por ORDEM (depois de emitida)  → `OfferItemID` no formato `SEAT_<hash>`
 *     / `BAG_<hash>`, os ÚNICOS que o OrderChange 24.1 aceita.
 *
 * Comprar assento sobre uma reserva já emitida exige o segundo. Foi por isso
 * que a tentativa pela oferta batia em `INVALID_OFFER_TYPES`.
 */
export type CatalogTarget = { offerId: string } | { orderId: string };

function catalogRequest(
  target: CatalogTarget,
  paxIds: string[],
  context: RequestContext,
  /**
   * 🔴 O ServiceList por ordem exige `OrderItem` dentro de `Order` — sem ele a
   * LATAM responde `911 The content of element 'Order' is not complete`. O
   * `GrandTotalAmount 0` é o que a própria amostra manda: aqui não se está
   * cotando nada, só pedindo o catálogo. O SeatAvailability não pede isso.
   */
  orderItem = false,
): string {
  const pax = paxIds.length > 0 ? paxIds : ['ADT_1'];
  const core = 'offerId' in target
    ? toXml('CoreRequest', { Offer: { OfferID: target.offerId } })
    : toXml('CoreRequest', {
        Order: {
          OrderID: target.orderId,
          OrderItem: orderItem ? { GrandTotalAmount: 0 } : undefined,
        },
      });

  return partyAndPos(context)
    + `<Request>${core}`
    + toXml('Pax', pax.map((paxId) => ({ PaxID: paxId, PTC: paxId.split('_')[0] })))
    + '</Request>';
}

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
  async seatAvailability(target: CatalogTarget, paxIds: string[], context: RequestContext): Promise<LatamResult> {
    return this.client.send(
      'SeatAvailability',
      PATHS.seatAvailability,
      envelope('IATA_SeatAvailabilityRQ', catalogRequest(target, paxIds, context)),
      context,
    );
  }

  /**
   * ServiceList = os opcionais vendidos à parte (bagagem extra, etc).
   *
   * Mesma forma e mesmo endereçamento do SeatAvailability.
   */
  async serviceList(target: CatalogTarget, paxIds: string[], context: RequestContext): Promise<LatamResult> {
    return this.client.send(
      'ServiceList',
      PATHS.serviceList,
      envelope('IATA_ServiceListRQ', catalogRequest(target, paxIds, context, true)),
      context,
    );
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
  /**
   * @param refundAmount `null` é o caso do **VOID**: quando o OrderReshop
   *   responde "VOID permitted" em vez de calcular reembolso, a mensagem vai só
   *   com o `OrderID` — é a mesma rota, e mandar um `ExpectedRefundAmount`
   *   inventado seria afirmar um valor que a companhia não disse.
   */
  async orderCancel(
    orderId: string,
    refundAmount: number | null,
    context: RequestContext,
  ): Promise<LatamResult> {
    const inner = partyAndPos(context)
      + toXml('Request', {
        ExpectedRefundAmount: refundAmount === null ? undefined : { TotalAmount: refundAmount },
        Order: { OrderID: orderId, OwnerCode: OWNER_CODE },
      });

    return this.client.send('OrderCancel', PATHS.orderCancel, envelope('IATA_OrderCancelRQ', inner), context);
  }

  /**
   * InstallmentOptions = as opções de parcelamento do cartão para uma ordem.
   *
   * 🔴 Esta mensagem NÃO é NDC: a raiz é `<InstallmentOptionsRQ>` sem
   * namespace nenhum, então ela não pode usar o `envelope()`. Foi assim que a
   * LATAM publicou, e forçá-la no molde das outras quebraria o parse do lado
   * deles.
   *
   * 🔴 O `Pan` é o NÚMERO DO CARTÃO. Ele existe aqui porque a operadora precisa
   * dele para dizer as parcelas — mas não é logado, não é guardado e não sai
   * desta chamada. O mesmo vale para tudo em `PaymentCard` mais abaixo.
   */
  async installmentOptions(pan: string, orderId: string, context: RequestContext): Promise<LatamResult> {
    const body = '<?xml version="1.0" encoding="UTF-8"?>'
      + '<InstallmentOptionsRQ>'
      + toXml('Party', {
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
      })
      + toXml('Pan', pan)
      + toXml('OrderId', orderId)
      // PAYLATER = ordem já criada, pagamento em separado. É o nosso caso.
      + toXml('ExecutionFlow', 'PAYLATER')
      + '</InstallmentOptionsRQ>';

    return this.client.send('InstallmentOptions', PATHS.installments, body, context);
  }

  /**
   * OrderChange com pagamento = PAGAR uma ordem que já existe.
   *
   * 🔴 Não confundir com `/order/create/payment`, que CRIA e paga de uma vez.
   * O contrato separa reservar de emitir, e é este endpoint que casa com essa
   * separação: o `/booking` segura o assento, o `/issue` cobra.
   *
   * 🔴 Mutação não idempotente e sem retry — cobrar duas vezes é o pior erro
   * possível aqui. Se a resposta se perder, o caminho é o OrderRetrieve.
   *
   * @param installmentId opcional; vem do `InstallmentOptions` e vai no `TrxID`.
   */
  async orderChangePayment(
    orderId: string,
    amount: { total: number; currency: string },
    card: {
      brand: string;
      holder: string;
      number: string;
      securityCode: string;
      /** `MMAA`, como a LATAM espera — quem converte é o caso de uso. */
      expiration: string;
    },
    billing: { email: string; countryCode: string; postalCode: string; street: string },
    payer: { firstName: string; lastName: string; dateOfBirth: string; documentNumber: string },
    installmentId: string | null,
    context: RequestContext,
  ): Promise<LatamResult> {
    const inner = toXml('MessageDoc', { RefVersionNumber: '1.0' })
      + toXml('Party', {
        Sender: {
          TravelAgency: {
            AgencyID: env.latam.agencyId || undefined,
            ContactInfoRefID: 'AGENCY_1_CNT',
            IATA_Number: env.latam.agencyIata || undefined,
            Name: env.latam.agencyName,
            TravelAgent: env.latam.travelAgentId
              ? { TravelAgentID: env.latam.travelAgentId }
              : undefined,
          },
        },
      })
      + toXml('Request', {
        DataLists: {
          /**
           * 🔴 `ContactPurposeText: BILLING` e o `PostalAddress` completo são
           * obrigatórios no pagamento — não são os mesmos contatos do
           * OrderCreate, que descrevem o passageiro. Aqui é quem paga.
           */
          ContactInfoList: {
            ContactInfo: {
              ContactInfoID: 'AGENCY_1_CNT',
              ContactPurposeText: 'BILLING',
              EmailAddress: { EmailAddressText: billing.email },
              PostalAddress: {
                CountryCode: billing.countryCode,
                PostalCode: billing.postalCode,
                StreetText: billing.street,
              },
            },
          },
        },
        Order: { OrderID: orderId, OwnerCode: OWNER_CODE },
        PaymentFunctions: {
          PaymentProcessingDetails: {
            Amount: { '@_CurCode': amount.currency, '#text': amount.total },
            ContactInfoRefID: 'AGENCY_1_CNT',
            /**
             * 🔴 `Payer` é OBRIGATÓRIO — sem ele a LATAM devolve
             * `400113007 PaymentProcessingDetails.Payer is mandatory`. E não é
             * o passageiro: é QUEM PAGA, e no Brasil o `IndividualID` é o CPF
             * do titular. Os dois coincidem no caso comum e divergem quando
             * alguém compra para outra pessoa.
             */
            Payer: {
              Individual: {
                Birthdate: payer.dateOfBirth,
                GivenName: payer.firstName,
                IndividualID: payer.documentNumber,
                Surname: payer.lastName,
              },
            },
            PaymentMethod: {
              PaymentCard: {
                CardBrandCode: card.brand,
                CardHolderName: card.holder,
                CardNumber: card.number,
                CardSecurityCode: card.securityCode,
                ExpirationDate: card.expiration,
              },
            },
            // O id da parcela escolhida viaja no TrxID — é o que a doc manda.
            PaymentTrx: installmentId ? { TrxID: installmentId } : undefined,
            TypeCode: 'Credit Card',
          },
        },
      });

    return this.client.send(
      'OrderChangePayment',
      PATHS.orderChangePayment,
      envelope('IATA_OrderChangeRQ', inner),
      context,
    );
  }

  /**
   * OrderChange 24.1 = COMPRAR assento e/ou bagagem numa ordem já emitida.
   *
   * 🔴 Por que não dá para fazer isso no v192: lá o opcional entra junto com a
   * reserva, e tentar adicioná-lo depois devolve `INVALID_OFFER_TYPES: Mixed
   * type offers are not supported`. A compra pós-emissão é uma capacidade
   * separada, com envelope, versão e catálogo próprios.
   *
   * 🔴 Os ids TÊM que vir do catálogo endereçado pela ORDEM (`SEAT_`/`BAG_`).
   * É o prefixo que faz a LATAM rotear para este fluxo: um id fora desse
   * formato cai no fluxo de troca de voo, que é outra coisa inteiramente.
   *
   * 🔴 Mutação não idempotente: cobra o cartão. Sem retry.
   */
  async orderChangeAddAncillaries(
    orderId: string,
    items: Array<{
      offerItemId: string;
      paxId: string;
      /** Só para `SEAT_`: a LATAM exige a poltrona explícita, além do id. */
      seat?: { row: string; column: string } | null;
    }>,
    amount: { total: number; currency: string },
    payment:
      | { method: 'cash' }
      | {
          method: 'card';
          card: { brand: string; holder: string; number: string; securityCode: string; expiration: string };
          payer: { firstName: string; lastName: string; dateOfBirth: string; documentNumber: string };
        },
    context: RequestContext,
  ): Promise<LatamResult> {
    const distribution = toXml('easd:DistributionChain', {
      DistributionChainLink: {
        Ordinal: 1,
        OrgRole: 'Seller',
        SalesAgent: env.latam.travelAgentId ? { SalesAgentID: env.latam.travelAgentId } : undefined,
        ParticipatingOrg: { OrgID: env.latam.agencyIata || env.latam.agencyId },
      },
    });

    const paymentMethod = payment.method === 'cash'
      ? { SettlementPlan: { PaymentTypeCode: 'CA' } }
      : {
          PaymentCard: {
            CardBrandCode: payment.card.brand,
            CardHolderName: payment.card.holder,
            CardNumber: payment.card.number,
            CardSecurityCode: payment.card.securityCode,
            ExpirationDate: payment.card.expiration,
          },
        };

    /**
     * 🔴 O CPF do titular vai na RAIZ da mensagem, prefixado `easd:`, e antes
     * de tudo. Não é detalhe de estilo: a LATAM procura exatamente aí. Provei
     * uma a uma — dentro do `PaymentCard` (que é onde a doc sugere), dentro do
     * `PaymentMethod`, dentro do `PaymentProcessingDetails`, no fim do
     * `Request` e na raiz sem prefixo: todas devolvem
     * `400300011 Required field is missing in the request: AugmentationPoint`.
     *
     * 🔴 E o tipo do documento é `I`, não `CPF`: a doc diz `CPF` e o gateway
     * responde `400300012 IdentityDocTypeCode value must be I for Brazil`.
     *
     * Pagamento por BSP é isento — daí o bloco só existir no caminho do cartão.
     */
    const cardholder = payment.method === 'card'
      ? toXml('easd:AugmentationPoint', {
          CardholderIdentityDoc: {
            Birthdate: payment.payer.dateOfBirth,
            IdentityDocID: payment.payer.documentNumber,
            IdentityDocTypeCode: 'I',
          },
        })
      : '';

    const inner = cardholder
      + distribution
      + toXml('easd:PayloadAttributes', { VersionNumber: '24.1' })
      + toXml('easd:Request', {
        Order: { OrderID: orderId, OwnerCode: OWNER_CODE },
        ChangeOrderChoice: {
          AcceptSelectedQuotedOfferList: {
            SelectedPricedOffer: {
              OfferRefID: orderId,
              OwnerCode: OWNER_CODE,
              SelectedOfferItem: items.map((item) => ({
                OfferItemRefID: item.offerItemId,
                PaxRefID: item.paxId,
                SelectedSeat: item.seat
                  ? { ColumnID: item.seat.column, SeatRowNumber: item.seat.row }
                  : undefined,
              })),
            },
          },
        },
        PaymentFunctions: {
          PaymentProcessingDetails: {
            Amount: { '@_CurCode': amount.currency, '#text': amount.total },
            PaymentMethod: paymentMethod,
          },
        },
      });

    return this.client.send(
      'OrderChangeAncillaries',
      PATHS.orderChange241,
      easdEnvelope('IATA_OrderChangeRQ', inner),
      context,
    );
  }
}
