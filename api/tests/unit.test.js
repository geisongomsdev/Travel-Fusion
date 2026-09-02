import { test } from 'node:test';
import assert from 'node:assert/strict';

import { roundMoney, money } from '../src/domain/money.js';
import { lookupError } from '../src/constants/error-codes.js';
import { parseLuggageOptions } from '../src/integrations/travelfusion/normalizers/luggage.normalizer.js';
import { ageOnFlightDate } from '../src/application/use-cases/CreateBooking.js';
import { encodeOfferKey, decodeOfferKey } from '../src/utils/offer-key.js';
import { canonicalCabin } from '../src/integrations/travelfusion/normalizers/routing.normalizer.js';

test('roundMoney não erra onde Math.round(v*100)/100 erra', () => {
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(Math.round(1.005 * 100) / 100, 1); // o jeito errado
  assert.equal(roundMoney(1265.675), 1265.68);
  assert.equal(roundMoney('não é número'), null);
});

test('money exige moeda e devolve o par do contrato', () => {
  assert.deepEqual(money(625, 'brl'), { currency: 'BRL', total: 625 });
  assert.equal(money(625, null), null);
});

test('código de erro desconhecido resolve para UNEXPECTED_ERROR, nunca lança', () => {
  assert.equal(lookupError('FARE_UNAVAILABLE').status, 409);
  assert.equal(lookupError('NAO_EXISTE').code, 'UNEXPECTED_ERROR');
  assert.equal(lookupError(undefined).status, 500);
});

test('código de erro não carrega prefixo de serviço', () => {
  assert.equal(lookupError('FARE_UNAVAILABLE').code, 'FARE_UNAVAILABLE');
  assert.notEqual(lookupError('FARE_UNAVAILABLE').code, 'FLIGHT_FARE_UNAVAILABLE');
});

test('parseLuggageOptions lê quantidade, peso e preço do DisplayText', () => {
  const options = parseLuggageOptions(
    'Please Select Luggage Option: 1 (1 bags - 15Kg total - 25.00 EUR), 2 (2 bags - 15Kg+15Kg - 50.00 EUR)',
  );
  assert.equal(options.length, 2);
  assert.deepEqual(options[0].price, { currency: 'EUR', total: 25 });
  assert.equal(options[1].quantity, 2);
  assert.equal(options[0].value, '1');
});

test('parseLuggageOptions devolve lista vazia sem texto', () => {
  assert.deepEqual(parseLuggageOptions(null), []);
  assert.deepEqual(parseLuggageOptions(''), []);
});

test('idade é calculada na data do voo, não hoje', () => {
  assert.equal(ageOnFlightDate('1990-04-21', '2026-10-12'), 36);
  // aniversário DEPOIS do voo: ainda não fez
  assert.equal(ageOnFlightDate('1990-12-31', '2026-10-12'), 35);
  assert.equal(ageOnFlightDate('data inválida', '2026-10-12'), null);
});

test('identificador opaco sobrevive ao round-trip e não quebra com lixo', () => {
  const key = { p: 'travelfusion', r: 'Z1HF', o: 'OUT-001', i: null };
  assert.deepEqual(decodeOfferKey(encodeOfferKey(key)), key);
  assert.equal(decodeOfferKey('nao-e-base64-valido!!'), null);
});

test('cabine desconhecida vira null, nunca o rótulo cru do fornecedor', () => {
  assert.equal(canonicalCabin('Economy'), 'economy');
  assert.equal(canonicalCabin('Premium Economy'), 'premium_economy');
  assert.equal(canonicalCabin('Classe Executiva do Fornecedor'), null);
  assert.equal(canonicalCabin(null), null);
});
