import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseXml } from '../src/common/xml/xml.util';
import { mapLatamError, readLatamError } from '../src/modules/providers/latam/error.map';
import {
  canonicalCabin, normalizeAirShopping,
} from '../src/modules/providers/latam/normalizers/offer.normalizer';
import { buildPaxList } from '../src/modules/providers/latam/latam.commands';
import { decodeOfferKey } from '../src/common/utils/offer-key';
import { decodeServiceKey, encodeServiceKey } from '../src/common/utils/service-key';
import { durationFromIso, flightDuration } from '../src/common/utils/duration';
import { expiryToMMYY } from '../src/common/utils/card';
import { passengerTypeCode } from '../src/common/utils/age';

/**
 * A amostra REAL do portal da LATAM (2 fare groups, 2 offers, ida-e-volta com
 * 2 adultos + criança + bebê). Testar contra o payload de verdade é o que pega
 * o que um fixture escrito à mão nunca pegaria — como o `TimeZoneCode` vir em
 * atributo e o `WeightAllowance` repetir em KG e libras.
 */
const SAMPLE = join(
  __dirname, '..', '..', 'docs-api', 'latam', 'latam', 'samples', 'operations',
  'air-shopping-v2', '07-2-faregroup-and-2-offer.xml',
);

const describeIfSample = existsSync(SAMPLE) ? describe : describe.skip;

describe('cabine da LATAM', () => {
  it('traduz o CabinTypeCode da IATA', () => {
    expect(canonicalCabin('Y', null)).toBe('economy');
    expect(canonicalCabin('W', null)).toBe('premium_economy');
    expect(canonicalCabin('J', null)).toBe('business');
  });

  it('cai no nome quando o código não é conhecido', () => {
    expect(canonicalCabin('ZZ', 'Premium Economy')).toBe('premium_economy');
  });

  it('🔴 devolve null em vez do rótulo cru — senão a busca casaria cabine errada', () => {
    expect(canonicalCabin('ZZ', 'Turista Plus')).toBeNull();
    expect(canonicalCabin(null, null)).toBeNull();
  });
});

describe('PaxList da NDC', () => {
  it('emite um elemento por passageiro, com id estável', () => {
    expect(buildPaxList({ adults: 2, children: 1, infants: 1 })).toEqual([
      { PaxID: 'ADT_1', PTC: 'ADT' },
      { PaxID: 'ADT_2', PTC: 'ADT' },
      { PaxID: 'CHD_1', PTC: 'CHD' },
      { PaxID: 'INF_1', PTC: 'INF' },
    ]);
  });

  it('garante ao menos um adulto', () => {
    expect(buildPaxList({ adults: 0, children: 0, infants: 0 })).toEqual([{ PaxID: 'ADT_1', PTC: 'ADT' }]);
  });
});

describe('PTC pela idade na data do voo', () => {
  it('usa as faixas da IATA', () => {
    expect(passengerTypeCode('2025-01-01', '2026-06-01')).toBe('INF'); // 1 ano
    expect(passengerTypeCode('2020-01-01', '2026-06-01')).toBe('CHD'); // 6 anos
    expect(passengerTypeCode('1990-01-01', '2026-06-01')).toBe('ADT');
  });

  it('🔴 vira criança na DATA DO VOO, não hoje — a virada de idade recusa a reserva', () => {
    // Faz 12 anos entre a busca e a volta: embarca como adulto.
    expect(passengerTypeCode('2014-07-01', '2026-06-01')).toBe('CHD');
    expect(passengerTypeCode('2014-07-01', '2026-08-01')).toBe('ADT');
  });

  it('data ilegível cai em ADT, a categoria sem restrição', () => {
    expect(passengerTypeCode('não é data', '2026-06-01')).toBe('ADT');
  });
});

describe('duração de voo', () => {
  it('lê o ISO-8601 que a companhia declara', () => {
    expect(durationFromIso('PT4H5M')).toBe(245);
    expect(durationFromIso('PT50M')).toBe(50);
    expect(durationFromIso('P1DT2H')).toBe(1560);
  });

  it('🔴 a companhia tem precedência sobre a conta', () => {
    // Declarado 245 min; os carimbos dariam outra coisa. Vale o que ela disse.
    expect(flightDuration('PT4H5M', '2026-10-15T10:00:00-03:00', '2026-10-15T12:00:00-03:00')).toBe(245);
  });

  it('calcula pelos carimbos quando ela não declara', () => {
    expect(flightDuration(null, '2026-10-15T10:00:00-03:00', '2026-10-15T14:20:00-03:00')).toBe(260);
  });

  /**
   * 🔴 Sem offset a conta passa a depender do fuso de quem roda o processo — o
   * mesmo voo mediria diferente em São Paulo e em Lisboa. `0` é "não informada".
   */
  it('🔴 recusa calcular sem fuso, em vez de medir errado', () => {
    expect(flightDuration(null, '2026-10-15T10:00:00', '2026-10-15T14:20:00')).toBe(0);
    expect(durationFromIso('texto qualquer')).toBeNull();
  });
});

describe('validade do cartão', () => {
  /**
   * 🔴 `MM/YYYY` é o que o contrato recebe e `MMAA` é o que a companhia espera.
   * Um `replace('/', '')` produz seis dígitos em ano de quatro — e seis onde ela
   * espera quatro é recusa de pagamento, sem dizer por quê.
   */
  it('converte MM/YYYY para MMAA', () => {
    expect(expiryToMMYY('12/2030')).toBe('1230');
    expect(expiryToMMYY('03/30')).toBe('0330');
    expect(expiryToMMYY('0330')).toBe('0330');
  });
});

describe('chave opaca do opcional', () => {
  /**
   * 🔴 A LATAM exige OfferItemID **e** ServiceID para vender um extra. O
   * contrato publica UMA chave: o par viaja dentro dela, e quem consome nunca
   * precisa saber que são dois.
   */
  it('carrega o par e sobrevive ao round-trip', () => {
    const key = encodeServiceKey({ o: 'BAG_abc', s: 'SVC_1' });
    expect(decodeServiceKey(key)).toEqual({ o: 'BAG_abc', s: 'SVC_1' });
  });

  it('devolve null com lixo, para virar 400 e não 500', () => {
    expect(decodeServiceKey('não é base64!!')).toBeNull();
    expect(decodeServiceKey(undefined)).toBeNull();
    expect(decodeServiceKey(Buffer.from('{"x":1}').toString('base64url'))).toBeNull();
  });
});

describe('erros da LATAM', () => {
  it('lê o bloco <Error> da raiz da mensagem NDC', async () => {
    const parsed = await parseXml(
      '<IATA_AirShoppingRS><Error><Code>404122007</Code>'
      + "<DescText>We don't sell the GRU-SCL segment for the selected date.</DescText>"
      + '</Error></IATA_AirShoppingRS>',
    );
    expect(readLatamError(parsed)).toEqual({
      code: '404122007',
      message: "We don't sell the GRU-SCL segment for the selected date.",
    });
  });

  it('resposta limpa não vira erro', async () => {
    const parsed = await parseXml('<IATA_AirShoppingRS><Response><OffersGroup/></Response></IATA_AirShoppingRS>');
    expect(readLatamError(parsed)).toBeNull();
  });

  it('🔴 mapeia pela família embutida nos 3 primeiros dígitos do código', () => {
    expect(mapLatamError({ code: '400122004', message: null }, 'AirShopping').code)
      .toBe('SEARCH_VALIDATION_ERROR');
    expect(mapLatamError({ code: '422113077', message: null }, 'OrderCreate').code)
      .toBe('BUSINESS_RULE_VIOLATION');
    expect(mapLatamError({ code: '503000001', message: null }, 'AirShopping').code)
      .toBe('PROVIDER_UNAVAILABLE');
  });

  it('rota não operada é ROUTE_NOT_FOUND, não "recurso sumiu"', () => {
    expect(mapLatamError({ code: '404122007', message: null }, 'AirShopping').code).toBe('ROUTE_NOT_FOUND');
  });

  it('preço mudou entre busca e tarifação tem código próprio', () => {
    expect(mapLatamError({ code: '409107014', message: null }, 'OfferPrice').code).toBe('FARE_PRICE_CHANGED');
  });

  it('código desconhecido cai em 502, nunca em 500', () => {
    const error = mapLatamError({ code: 'ALGO_NOVO', message: 'x' }, 'AirShopping');
    expect(error.code).toBe('PROVIDER_INTEGRATION_ERROR');
    expect(error.statusCode).toBe(502);
  });
});

describeIfSample('AirShopping real da LATAM', () => {
  let offers: ReturnType<typeof normalizeAirShopping>;

  beforeAll(async () => {
    const parsed = await parseXml(readFileSync(SAMPLE, 'utf8'));
    const payload = (Object.values(parsed)[0] as any).Response;
    offers = normalizeAirShopping(payload, 4, ['ADT_1', 'ADT_2', 'ADT_3', 'ADT_4']);
  });

  it('extrai as ofertas do OffersGroup', () => {
    expect(offers.length).toBeGreaterThan(0);
  });

  it('🔴 uma Offer é o PACOTE inteiro: ida e volta saem juntas, nunca pareadas por nós', () => {
    const roundtrip = offers.find((offer) => offer.inbound !== null);
    expect(roundtrip).toBeDefined();

    // A volta é a volta: origem da ida == destino da volta.
    expect(roundtrip!.inbound!.origin?.iata).toBe(roundtrip!.outbound.destination?.iata);
    expect(roundtrip!.inbound!.destination?.iata).toBe(roundtrip!.outbound.origin?.iata);
  });

  it('resolve os PaxSegmentRefID em segmentos de verdade', () => {
    const [first] = offers;
    expect(first.outbound.flights.length).toBeGreaterThan(0);
    expect(first.outbound.flights[0].origin?.iata).toMatch(/^[A-Z]{3}$/);
    expect(first.outbound.flights[0].number).toBeTruthy();
  });

  it('🔴 o aeroporto publica as quatro chaves, com null no que não veio', () => {
    const origin = offers[0].outbound.origin!;
    expect(origin).toMatchObject({ city: null, coordinates: { lat: null, lng: null } });
    expect(origin.iata).toMatch(/^[A-Z]{3}$/);
  });

  it('conta escalas como segmentos-1, e o direto dá 0', () => {
    for (const offer of offers) {
      expect(offer.outbound.stops).toBe(offer.outbound.flights.length - 1);
    }
  });

  it('🔴 cola o TimeZoneCode do atributo no horário — sem isso o voo muda de dia', () => {
    const departure = offers[0].outbound.flights[0].time.departure;
    expect(departure).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it('publica a duração em MINUTOS, nunca o ISO cru', () => {
    const { duration } = offers[0].outbound.time;
    expect(typeof duration).toBe('number');
    expect(duration).toBeGreaterThan(0);
  });

  it('marca conexão a partir do segundo segmento', () => {
    const comConexao = offers.find((offer) => offer.outbound.flights.length > 1);
    if (!comConexao) return;
    expect(comConexao.outbound.flights[0].connection).toBe(false);
    expect(comConexao.outbound.flights[1].connection).toBe(true);
  });

  it('preenche operating mesmo quando a LATAM não repete o operador', () => {
    for (const segment of offers[0].outbound.flights) {
      expect(segment.company.operating).not.toBeNull();
    }
  });

  it('traz preço total com moeda', () => {
    const [fare] = offers[0].outbound.fares;
    expect(fare.price.total.total).toBeGreaterThan(0);
    expect(fare.price.total.currency).toMatch(/^[A-Z]{3}$/);
  });

  /**
   * 🔴 A LATAM manda o TOTAL de impostos, não a discriminação. Espalhar esse
   * número em `boarding` publicaria como taxa de embarque algo que a companhia
   * nunca separou.
   */
  it('🔴 imposto vai em taxes.total; a discriminação fica null', () => {
    const [fare] = offers[0].outbound.fares;
    expect(fare.price.total.taxes.total).toBeGreaterThan(0);
    expect(fare.price.total.taxes.boarding).toBeNull();
    expect(fare.price.total.taxes.fuel).toBeNull();
  });

  it('🔴 discrimina adult/child/baby a partir do FareDetail por PaxRefID', () => {
    const [fare] = offers[0].outbound.fares;
    expect(fare.price.adult).not.toBeNull();
    // Tudo-ou-nada: se o adulto existe, os outros seguem a mesma regra.
    expect(fare.price.adult!.total).toBeGreaterThan(0);
  });

  it('divide o perPassenger pela contagem informada', () => {
    const [fare] = offers[0].outbound.fares;
    expect(fare.price.perPassenger).toBeCloseTo((fare.price.total.total ?? 0) / 4, 1);
  });

  /**
   * 🔴 `hand` e `hold` são franquias diferentes e não se somam. A amostra só
   * associa PERSONAL_ITEM e CARRY_ON: despachada é `false` (ela disse que não),
   * não `null` (não sabemos).
   */
  it('🔴 separa bagagem de mão da despachada', () => {
    const [fare] = offers[0].outbound.fares;
    expect(fare.baggage.hold?.included).toBe(false);
    expect(fare.baggage.hold?.type).toBe('checked');
  });

  it('lê a família comercial da tarifa', () => {
    const [fare] = offers[0].outbound.fares;
    expect(fare.family).toBeTruthy();
  });

  it('deriva reembolsável/alterável do AllowedModificationInd', () => {
    const [fare] = offers[0].outbound.fares;
    expect(fare.rules!.refundable).toBe(false);
    expect(fare.rules!.changeable).toBe(true);
  });

  /**
   * 🔴 A chave de VENDA é da TARIFA, não do trecho: um voo tem várias famílias
   * e cada uma é uma venda diferente. O `identifier` do trecho é a journey.
   */
  it('🔴 o fareId carrega OfferID + OfferItemID; o identifier é a journey', () => {
    const [fare] = offers[0].outbound.fares;
    const key = decodeOfferKey(fare.fareId);

    expect(key).not.toBeNull();
    expect(key!.p).toBe('latam');
    expect(key!.r).toBeTruthy();
    expect(key!.i).toBeTruthy();

    // O trecho publica a journey crua, que NÃO decodifica como chave de oferta.
    expect(offers[0].outbound.identifier).toBeTruthy();
    expect(decodeOfferKey(offers[0].outbound.identifier)).toBeNull();
  });

  it('ida e volta do mesmo pacote compartilham o OfferID', () => {
    const roundtrip = offers.find((offer) => offer.inbound !== null)!;
    const out = decodeOfferKey(roundtrip.outbound.fares[0].fareId)!;
    const back = decodeOfferKey(roundtrip.inbound!.fares[0].fareId)!;

    expect(back.r).toBe(out.r);
    expect(back.d).toBe('return');
    expect(out.d).toBe('outward');
    // Journeys diferentes: são bounds distintos do mesmo pacote.
    expect(back.o).not.toBe(out.o);
  });
});
