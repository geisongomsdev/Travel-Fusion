import { lookupError, ERROR_CODES } from '../src/common/errors/error-codes';
import { roundMoney, money } from '../src/common/utils/money';
import { encodeOfferKey, decodeOfferKey } from '../src/common/utils/offer-key';
import { parseLuggageOptions } from '../src/modules/providers/travelfusion/normalizers/luggage.normalizer';
import { canonicalCabin } from '../src/modules/providers/travelfusion/normalizers/routing.normalizer';
import { ageOnFlightDate } from '../src/modules/flight/use-cases/booking.service';
import { TRAVELFUSION_CAPABILITIES, FLIGHT_OPERATIONS } from '../src/common/capabilities';
import { buildCommand, parseXml, unwrapCommand } from '../src/common/xml/xml.util';
import { mapProviderError, readError } from '../src/modules/providers/travelfusion/error.map';

describe('dinheiro', () => {
  it('não erra onde Math.round(v*100)/100 erra', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(Math.round(1.005 * 100) / 100).toBe(1); // o jeito errado
    expect(roundMoney(1265.675)).toBe(1265.68);
  });

  it('devolve null em vez de NaN', () => {
    expect(roundMoney('não é número')).toBeNull();
    expect(roundMoney(undefined)).toBeNull();
  });

  it('exige moeda para formar o par do contrato', () => {
    expect(money(625, 'brl')).toEqual({ currency: 'BRL', total: 625 });
    expect(money(625, null)).toBeNull();
  });
});

describe('catálogo de erro', () => {
  it('resolve código desconhecido para UNEXPECTED_ERROR, sem lançar', () => {
    expect(lookupError('NAO_EXISTE').code).toBe('UNEXPECTED_ERROR');
    expect(lookupError(undefined).status).toBe(500);
  });

  it('não carrega prefixo de serviço', () => {
    expect(lookupError('FARE_UNAVAILABLE').code).toBe('FARE_UNAVAILABLE');
    expect(ERROR_CODES.some((code) => code.startsWith('FLIGHT_'))).toBe(false);
  });

  it('mantém as distinções que mudam a ação de quem consome', () => {
    // 401 = revise o cadastro, não retente. 502 = problema técnico, retente.
    expect(lookupError('PROVIDER_AUTHENTICATION_FAILED').status).toBe(401);
    expect(lookupError('PROVIDER_INTEGRATION_ERROR').status).toBe(502);
    // 409, não 502: existe reserva viva do outro lado, retentar cria a segunda.
    expect(lookupError('BOOKING_PARTIAL_FAILURE').status).toBe(409);
    expect(lookupError('CAPABILITY_NOT_SUPPORTED').status).toBe(501);
  });

  it('tem os 18 códigos do contrato', () => {
    expect(ERROR_CODES).toHaveLength(18);
  });
});

describe('bagagem', () => {
  it('lê quantidade, peso e preço do DisplayText em texto livre', () => {
    const options = parseLuggageOptions(
      'Please Select Luggage Option: 1 (1 bags - 15Kg total - 25.00 EUR), 2 (2 bags - 15Kg+15Kg - 50.00 EUR)',
    );
    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({ value: '1', quantity: 1, weightKg: 15, price: { currency: 'EUR', total: 25 } });
    expect(options[1].quantity).toBe(2);
  });

  it('devolve lista vazia sem texto, em vez de quebrar', () => {
    expect(parseLuggageOptions(null)).toEqual([]);
    expect(parseLuggageOptions('')).toEqual([]);
    expect(parseLuggageOptions('texto sem opções')).toEqual([]);
  });
});

describe('idade', () => {
  it('é calculada na data do voo, não hoje', () => {
    expect(ageOnFlightDate('1990-04-21', '2026-10-12')).toBe(36);
  });

  it('não conta aniversário posterior ao voo', () => {
    expect(ageOnFlightDate('1990-12-31', '2026-10-12')).toBe(35);
  });

  it('devolve null com data inválida, nunca NaN', () => {
    expect(ageOnFlightDate('data inválida', '2026-10-12')).toBeNull();
  });
});

describe('identificador opaco', () => {
  it('sobrevive ao round-trip', () => {
    const key = { p: 'travelfusion', r: 'Z1HF', o: 'OUT-001', i: null };
    expect(decodeOfferKey(encodeOfferKey(key))).toEqual(key);
  });

  it('devolve null com lixo, para virar 400 e não 500', () => {
    expect(decodeOfferKey('nao-e-base64-valido!!')).toBeNull();
    expect(decodeOfferKey('')).toBeNull();
    expect(decodeOfferKey(undefined)).toBeNull();
    // base64 válido, mas sem o RoutingId que a chave precisa carregar
    expect(decodeOfferKey(Buffer.from('{"x":1}').toString('base64url'))).toBeNull();
  });
});

describe('cabine canônica', () => {
  it('normaliza os rótulos conhecidos', () => {
    expect(canonicalCabin('Economy')).toBe('economy');
    expect(canonicalCabin('Premium Economy')).toBe('premium_economy');
    expect(canonicalCabin('BUSINESS')).toBe('business');
  });

  it('devolve null no desconhecido, nunca o rótulo cru do fornecedor', () => {
    expect(canonicalCabin('Classe Executiva do Fornecedor')).toBeNull();
    expect(canonicalCabin(null)).toBeNull();
  });
});

describe('capabilities', () => {
  it('declara todas as operações do contrato', () => {
    for (const operation of FLIGHT_OPERATIONS) {
      expect(TRAVELFUSION_CAPABILITIES).toHaveProperty(operation);
    }
  });

  it('não promete emissão: o StartBooking já cobra', () => {
    expect(TRAVELFUSION_CAPABILITIES.issue).toBe(false);
  });
});

describe('protocolo da Travelfusion', () => {
  it('envolve todo comando em <CommandList>', () => {
    // Sem o envelope a Travelfusion recusa com 400 `1-1043`, antes de olhar a
    // credencial — e o sintoma chega disfarçado de erro de login.
    const xml = buildCommand('Login', { Username: 'u' });
    expect(xml).toContain('<CommandList><Login><Username>u</Username></Login></CommandList>');
  });

  it('desembrulha a resposta pelo nome do comando', async () => {
    const parsed = await parseXml('<CommandList><Login><LoginId>ABC</LoginId></Login></CommandList>');
    expect(unwrapCommand(parsed, 'Login')).toEqual({ LoginId: 'ABC' });
  });

  it('lê o erro em atributo, aninhado, com HTTP 200', async () => {
    // O formato real de falha: nada de bloco <Error>, e o status é 200.
    const parsed = await parseXml(
      '<CommandList><CommandExecutionFailure>' +
        '<StartRouting ecode="4-3448" etext="Login id not found"/>' +
        '</CommandExecutionFailure></CommandList>',
    );
    expect(readError(parsed)).toEqual({ code: '4-3448', message: 'Login id not found' });
  });

  it('não inventa erro em resposta limpa', async () => {
    // <Login millis="115"> tem atributo, mas não é falha.
    const parsed = await parseXml('<CommandList><Login millis="115"><LoginId>ABC</LoginId></Login></CommandList>');
    expect(readError(parsed)).toBeNull();
  });

  it('classifica 4-3448 como recusa de credencial, não como falha técnica', () => {
    // 401 manda revisar o cadastro; 502 mandaria retentar para sempre.
    expect(mapProviderError({ code: '4-3448', message: 'Login id not found' }, 'StartRouting').code)
      .toBe('PROVIDER_AUTHENTICATION_FAILED');
  });
});
