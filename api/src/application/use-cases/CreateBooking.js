import { AppError } from '../../domain/errors.js';
import { decodeOfferKey } from '../../utils/offer-key.js';
import { processTerms, startBooking, checkBooking, sleep } from '../../integrations/travelfusion/provider/commands.js';

const POLL_INTERVAL_MS = 5000;
const BOOKING_TIMEOUT_MS = 3 * 60 * 1000;

/** Idade REAL na data do voo — em ida-e-volta, na data da VOLTA (requisito de go-live). */
export function ageOnFlightDate(dateOfBirth, flightDate) {
  const birth = new Date(dateOfBirth);
  const reference = new Date(flightDate);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(reference.getTime())) return null;

  let age = reference.getFullYear() - birth.getFullYear();
  const monthDelta = reference.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && reference.getDate() < birth.getDate())) age -= 1;
  return age;
}

function buildTraveller(passenger, referenceDate) {
  const perPassengerParameters = Object.entries(passenger.customParameters || {})
    .map(([Name, Value]) => ({ Name, Value }));

  return {
    Age: ageOnFlightDate(passenger.dateOfBirth, referenceDate),
    Name: {
      Title: passenger.title || 'Mr',
      NamePartList: { NamePart: [passenger.firstName, passenger.lastName].filter(Boolean) },
    },
    CustomSupplierParameterList: perPassengerParameters.length
      ? { CustomSupplierParameter: perPassengerParameters }
      : undefined,
  };
}

/**
 * Reservar = ProcessTerms (UM só) → StartBooking → polling do CheckBooking.
 *
 * 🔴 `committed` ≠ `confirmed` (01-convencoes.md §7). Status não-final
 * (BookingInProgress / Unconfirmed / UnconfirmedBySupplier) NÃO é falha e NÃO
 * autoriza re-reservar: a reserva pode existir do outro lado. Devolvemos
 * committed:true / confirmed:false e seguimos o polling.
 */
export async function createBooking(request, context = {}) {
  const key = decodeOfferKey(request.identifier);
  if (!key?.r) {
    throw new AppError('SEARCH_VALIDATION_ERROR', {
      details: { errors: { identifier: ['Identificador de oferta inválido ou expirado.'] } },
    });
  }

  const bookingParameters = Object.entries(request.customParameters || {})
    .map(([Name, Value]) => ({ Name, Value }));

  await processTerms({
    Mode: 'plane',
    RoutingId: key.r,
    BookingProfile: {
      CustomSupplierParameterList: bookingParameters.length
        ? { CustomSupplierParameter: bookingParameters }
        : undefined,
      TravellerList: {
        Traveller: request.passengers.map((passenger) =>
          buildTraveller(passenger, request.referenceDate || new Date().toISOString())),
      },
    },
  }, context);

  await startBooking(key.r, context); // sem retry: mutação não idempotente

  const startedAt = Date.now();
  let last = null;

  while (Date.now() - startedAt < BOOKING_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    last = await checkBooking(key.r, context);
    if (last.isFinal) break;
  }

  if (last?.status === 'Failed') {
    throw new AppError('BUSINESS_RULE_VIOLATION', { metadata: { operation: 'createBooking' } });
  }
  if (last?.status === 'Duplicate') {
    throw new AppError('RESOURCE_CONFLICT', { metadata: { operation: 'createBooking' } });
  }

  return {
    locator: last?.supplierReference || null,
    // A reserva foi enviada e aceita pelo provedor…
    committed: true,
    // …mas só é `true` quando o status final Succeeded chegou. Nunca deduzido.
    confirmed: last?.succeeded === true,
    status: last?.status || 'BookingInProgress',
  };
}
