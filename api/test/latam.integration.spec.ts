import { spawn, ChildProcess } from 'node:child_process';
import { join } from 'node:path';

const PORT = 3997;

/**
 * 🔴 O duble é injetado por CONSTRUÇÃO, não por configuração: montamos o
 * `LatamClient` apontado para ele aqui dentro. O `.env` da aplicação continua
 * apontando para o sandbox real da LATAM — um duble alcançável pelo runtime
 * viraria produção por acidente.
 *
 * Os testes de unidade cobrem a tradução; este cobre a FIAÇÃO, que é onde moram
 * os erros que nenhum deles pega: token não anexado, path errado, envelope com
 * namespace trocado.
 */
import { LatamClient } from '../src/modules/providers/latam/latam.client';
import { LatamCommands } from '../src/modules/providers/latam/latam.commands';
import { LatamProvider } from '../src/modules/providers/latam/latam.provider';
import { AvailabilityDto } from '../src/modules/flight/dto/availability.dto';
import { ProviderOffer } from '../src/modules/providers/provider.types';
import { decodeOfferKey, OfferKey } from '../src/common/utils/offer-key';

const DOUBLE = join(__dirname, 'fixtures', 'latam-ndc-double.mjs');

const endpoint = {
  endpoint: `http://localhost:${PORT}`,
  tokenEndpoint: `http://localhost:${PORT}/oauth/cc/token`,
  apiKey: 'test-key',
  apiSecret: 'test-secret',
};

let double: ChildProcess;

const waitForDouble = async (): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(endpoint.tokenEndpoint, { method: 'POST' });
      if (response.ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('duble do LATAM NDC não subiu');
};

beforeAll(async () => {
  double = spawn(process.execPath, [DOUBLE], {
    env: { ...process.env, MOCK_LATAM_PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitForDouble();
}, 20000);

afterAll(() => {
  double?.kill();
});

const provider = (): LatamProvider =>
  new LatamProvider(new LatamCommands(new LatamClient(endpoint)));

const requestFor = (type: 'oneway' | 'roundtrip'): AvailabilityDto => ({
  type,
  legs: type === 'roundtrip'
    ? [
        { origin: 'GRU', destination: 'REC', date: '2026-10-12' },
        { origin: 'REC', destination: 'GRU', date: '2026-10-19' },
      ]
    : [{ origin: 'GRU', destination: 'REC', date: '2026-10-12' }],
  passengers: { adults: 1 },
});

const search = async (type: 'oneway' | 'roundtrip'): Promise<ProviderOffer[]> => {
  const collected: ProviderOffer[] = [];
  for await (const batch of provider().search(requestFor(type), { correlationId: 'test' })) {
    collected.push(...batch);
  }
  return collected;
};

const keyOf = (offer: ProviderOffer): OfferKey => {
  const key = decodeOfferKey(offer.outbound.identifier);
  if (!key) throw new Error('identifier não decodificou');
  return key;
};

describe('LatamProvider ponta a ponta', () => {
  it('autentica e devolve ofertas normalizadas', async () => {
    expect(await search('roundtrip')).toHaveLength(3);
  });

  it('🔴 a busca é síncrona: um lote só, sem polling', async () => {
    const batches: number[] = [];
    for await (const batch of provider().search(requestFor('oneway'), {})) {
      batches.push(batch.length);
    }
    expect(batches).toHaveLength(1);
  });

  it('monta o pacote de ida-e-volta a partir dos dois PaxJourney', async () => {
    const roundtrip = (await search('roundtrip')).filter((offer) => offer.inbound !== null);

    expect(roundtrip).toHaveLength(2);
    expect(roundtrip[0].outbound.origin?.code).toBe('GRU');
    expect(roundtrip[0].inbound?.origin?.code).toBe('REC');
  });

  it('a oferta de ida avulsa não ganha volta inventada', async () => {
    const oneway = (await search('roundtrip')).filter((offer) => offer.inbound === null);
    expect(oneway).toHaveLength(1);
  });

  it('resolve conexão como dois segmentos e uma escala', async () => {
    const offers = await search('roundtrip');
    const comConexao = offers.find((offer) => offer.outbound.flights.length === 2);

    expect(comConexao).toBeDefined();
    expect(comConexao!.outbound.stops).toBe(1);
    expect(comConexao!.outbound.origin?.code).toBe('GRU');
    expect(comConexao!.outbound.destination?.code).toBe('REC');
    expect(comConexao!.outbound.flights[1].connection).toBe(true);
  });

  it('🔴 distingue tarifa com e sem bagagem despachada', async () => {
    const offers = await search('roundtrip');
    const light = offers.find((offer) => offer.outbound.fares[0].family === 'Light');
    const plus = offers.find((offer) => offer.outbound.fares[0].family === 'Plus');

    expect(light!.outbound.fares[0].baggage.included).toBe(false);
    expect(plus!.outbound.fares[0].baggage).toMatchObject({
      included: true, quantity: 1, weight: 23, unit: 'KG',
    });
  });

  it('preço total soma base e taxa, com moeda', async () => {
    const [fare] = (await search('roundtrip'))[0].outbound.fares;

    expect(fare.price.total).toMatchObject({ base: 520, total: 625, currency: 'BRL' });
    expect(fare.price.total.taxes.boarding).toBe(105);
  });

  it('tarifa a oferta pelo identifier que a busca devolveu', async () => {
    const [offer] = await search('roundtrip');
    const quote = await provider().quote(keyOf(offer), { identifier: offer.outbound.identifier! }, {});

    expect(quote.price.total).toBe(625);
    expect(quote.requiredParameters.length).toBeGreaterThan(0);
  });

  it('🔴 reserva devolve confirmed só no status final — CLOSED confirma', async () => {
    const [offer] = await search('roundtrip');

    const booking = await provider().book(
      keyOf(offer),
      {
        identifier: offer.outbound.identifier!,
        referenceDate: '2026-10-19',
        passengers: [{ firstName: 'Andy', lastName: 'Peterson', dateOfBirth: '1990-04-21' }],
      },
      {},
    );

    expect(booking).toMatchObject({
      locator: 'NW6PFQ', committed: true, confirmed: true, status: 'CLOSED',
    });
  });

  it('consulta a reserva com todas as chaves do contrato', async () => {
    const found = await provider().retrieve('ORD-77213', {});

    expect(found).toMatchObject({
      status: 'confirmed', rawStatus: 'CLOSED', supplierConfirmation: 'NW6PFQ',
    });
    expect(found.people[0]).toMatchObject({ firstName: 'Andy', type: 'ADT' });
  });

  it('🔴 erro do provedor vira código do catálogo, não 500', async () => {
    // O duble devolve 404122007 quando a origem é XXX.
    const impossible: AvailabilityDto = {
      type: 'oneway',
      legs: [{ origin: 'XXX', destination: 'REC', date: '2026-10-12' }],
      passengers: { adults: 1 },
    };

    await expect(provider().search(impossible, {}).next()).rejects.toMatchObject({
      code: 'ROUTE_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('fare-rules é 501 declarado, não erro genérico', async () => {
    await expect(provider().fareRules()).rejects.toMatchObject({
      code: 'CAPABILITY_NOT_SUPPORTED',
      statusCode: 501,
    });
  });
});
