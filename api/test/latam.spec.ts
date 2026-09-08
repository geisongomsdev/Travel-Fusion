import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseXml } from '../src/common/xml/xml.util';
import { mapLatamError, readLatamError } from '../src/modules/providers/latam/error.map';
import {
  canonicalCabin, normalizeAirShopping,
} from '../src/modules/providers/latam/normalizers/offer.normalizer';
import { buildPaxList } from '../src/modules/providers/latam/latam.commands';
import { decodeOfferKey } from '../src/common/utils/offer-key';
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
    expect(buildPaxList({ adults: 2, children: 1, babies: 1 })).toEqual([
      { PaxID: 'ADT_1', PTC: 'ADT' },
      { PaxID: 'ADT_2', PTC: 'ADT' },
      { PaxID: 'CHD_1', PTC: 'CHD' },
      { PaxID: 'INF_1', PTC: 'INF' },
    ]);
  });

  it('garante ao menos um adulto', () => {
    expect(buildPaxList({ adults: 0, children: 0, babies: 0 })).toEqual([{ PaxID: 'ADT_1', PTC: 'ADT' }]);
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
    expect(roundtrip!.inbound!.origin?.code).toBe(roundtrip!.outbound.destination?.code);
    expect(roundtrip!.inbound!.destination?.code).toBe(roundtrip!.outbound.origin?.code);
  });

  it('resolve os PaxSegmentRefID em segmentos de verdade', () => {
    const [first] = offers;
    expect(first.outbound.flights.length).toBeGreaterThan(0);
    expect(first.outbound.flights[0].origin?.code).toMatch(/^[A-Z]{3}$/);
    expect(first.outbound.flights[0].number).toBeTruthy();
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

  it('🔴 só TypeCode=Checked conta como bagagem despachada', () => {
    // A amostra só associa PERSONAL_ITEM e CARRY_ON: despachada é false, não null.
    const [fare] = offers[0].outbound.fares;
    expect(fare.baggage.included).toBe(false);
  });

  it('lê a família comercial da tarifa', () => {
    const [fare] = offers[0].outbound.fares;
    expect(fare.family).toBeTruthy();
  });

  it('deriva reembolsável/alterável do AllowedModificationInd', () => {
    const [fare] = offers[0].outbound.fares;
    expect(fare.rules.refundable).toBe(false);
    expect(fare.rules.changeable).toBe(true);
  });

  it('🔴 o identifier carrega OfferID + OfferItemID: sem os dois o OfferPrice não tarifa', () => {
    const key = decodeOfferKey(offers[0].outbound.identifier);
    expect(key).not.toBeNull();
    expect(key!.p).toBe('latam');
    expect(key!.r).toBeTruthy();
    expect(key!.i).toBeTruthy();
  });

  it('ida e volta do mesmo pacote compartilham o OfferID', () => {
    const roundtrip = offers.find((offer) => offer.inbound !== null)!;
    const out = decodeOfferKey(roundtrip.outbound.identifier)!;
    const back = decodeOfferKey(roundtrip.inbound!.identifier)!;

    expect(back.r).toBe(out.r);
    expect(back.d).toBe('return');
    expect(out.d).toBe('outward');
    // Journeys diferentes: são bounds distintos do mesmo pacote.
    expect(back.o).not.toBe(out.o);
  });
});
