import { AppError } from '../../domain/errors.js';
import { checkBooking } from '../../integrations/travelfusion/provider/commands.js';
import { text } from '../../integrations/travelfusion/provider/xml.js';

const PROVIDER = 'travelfusion';

/** Estado de VENDA da reserva — vocabulário canônico, não o do fornecedor. */
const STATUS_MAP = {
  Succeeded: 'confirmed',
  BookingInProgress: 'pending',
  Unconfirmed: 'pending',
  UnconfirmedBySupplier: 'pending',
  Cancelled: 'cancelled',
  Failed: 'cancelled',
};

/** `type` do passageiro: o vocabulário das companhias varia muito. O que não reconhece é null, nunca um chute. */
const PASSENGER_TYPE_MAP = {
  ADT: 'adult', ADULT: 'adult', ADULTO: 'adult',
  CHD: 'child', CNN: 'child', CHILD: 'child', 'CRIANÇA': 'child',
  INF: 'infant', INFANT: 'infant', 'BEBÊ': 'infant',
};

function normalizeBirthdate(value) {
  if (!value) return null;
  const date = new Date(value);
  // Normalizada para YYYY-MM-DD mesmo quando a companhia manda data-hora.
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function ageFrom(birthdate) {
  if (!birthdate) return null;
  const birth = new Date(birthdate);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDelta = now.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

const emptyPhone = () => ({ country: null, area: null, number: null, type: null });

/**
 * Consultar a reserva ao vivo — SEM cache. O ponto da rota é saber o estado agora,
 * e é a leitura independente que prova o efeito das mutações (01-convencoes §7).
 *
 * A Travelfusion não tem um GetBooking rico: o CheckBooking devolve status e a
 * referência do fornecedor. Todas as chaves do contrato existem mesmo assim, com
 * `null` onde o provedor não informa — omitir chave significaria outra coisa.
 */
export async function retrieveBooking(request, context = {}) {
  const locator = request?.booking?.locator;
  if (!locator) {
    throw new AppError('SEARCH_VALIDATION_ERROR', {
      details: { errors: { 'booking.locator': ['Campo obrigatório.'] } },
    });
  }

  const result = await checkBooking(locator, context);

  if (!result.status) {
    throw new AppError('RESOURCE_NOT_FOUND', { metadata: { operation: 'retrieve' } });
  }

  const raw = result.raw || {};

  return {
    locator,
    durationMs: result.durationMs,
    data: {
      status: STATUS_MAP[result.status] ?? null,
      type: 'flight',
      // A Travelfusion não devolve os trechos no CheckBooking, então o tipo de
      // viagem não é derivável aqui. null é a resposta honesta.
      trip: null,
      grouping: null,
      title: null,
      destination: null,
      iata: null,
      departure: null,
      arrival: null,
      currency: text(raw.Currency),

      createdAt: text(raw.BookingDateTime) || null,
      expiresAt: text(raw.TimeLimit) || null,
      confirmationAt: text(raw.ConfirmationDateTime) || text(raw.BookingDateTime) || null,

      provider: {
        code: PROVIDER,
        // ⚠️ É o nome da COMPANHIA AÉREA, não o do provedor. O nome do campo engana.
        name: text(raw.SupplierName) || null,
        locator,
      },
      // Num agregador o localizador da companhia difere do do provedor, e é o da
      // companhia que o passageiro precisa no check-in.
      supplier: { confirmation: result.supplierReference || null },

      people: normalizePeople(raw),
      segments: null,
      itinerary: null,
    },
  };
}

function normalizePeople(raw) {
  const travellers = raw?.TravellerList?.Traveller;
  const list = Array.isArray(travellers) ? travellers : travellers ? [travellers] : [];

  return list.map((traveller, index) => {
    const birthdate = normalizeBirthdate(text(traveller?.DateOfBirth));
    const rawType = (text(traveller?.Type) || '').toUpperCase();
    const type = PASSENGER_TYPE_MAP[rawType] ?? null;

    return {
      // main é true SÓ no primeiro. Bebê de colo é sempre false.
      main: index === 0 && type !== 'infant',
      name: [text(traveller?.FirstName), text(traveller?.LastName)].filter(Boolean).join(' ') || null,
      firstName: text(traveller?.FirstName),
      lastName: text(traveller?.LastName),
      email: type === 'infant' ? null : text(traveller?.Email),
      phone: emptyPhone(),
      nationality: text(traveller?.Nationality),
      document: { type: null, number: text(traveller?.DocumentNumber) },
      birthdate,
      age: ageFrom(birthdate),
      type,
      ageGroup: type, // sempre igual a type
      gender: null,
      loyalty: null, // programa não reconhecido é null, nunca um palpite
    };
  });
}
