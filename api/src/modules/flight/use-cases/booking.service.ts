import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { decodeOfferKey } from '../../../common/utils/offer-key';
import { RequestContext } from '../../travelfusion/travelfusion.client';
import { TravelfusionCommands, sleep } from '../../travelfusion/travelfusion.commands';
import { BookingPassengerDto, CreateBookingDto } from '../dto/booking.dto';

const POLL_INTERVAL_MS = 5000;
const BOOKING_TIMEOUT_MS = 3 * 60 * 1000;

export interface BookingResult {
  locator: string | null;
  /** A reserva foi enviada e aceita pelo provedor. */
  committed: boolean;
  /** 🔴 Só `true` com o status final Succeeded. NUNCA deduzido de `committed`. */
  confirmed: boolean;
  status: string;
}

/**
 * Idade REAL na data do voo — em ida-e-volta, na data da VOLTA.
 * É requisito de go-live: a Travelfusion valida a idade contra a data do voo, e
 * usar "hoje" faz uma criança que aniversaria antes da viagem ser recusada.
 */
export function ageOnFlightDate(dateOfBirth: string, flightDate: string): number | null {
  const birth = new Date(dateOfBirth);
  const reference = new Date(flightDate);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(reference.getTime())) return null;

  let age = reference.getFullYear() - birth.getFullYear();
  const monthDelta = reference.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && reference.getDate() < birth.getDate())) age -= 1;
  return age;
}

@Injectable()
export class BookingService {
  constructor(private readonly commands: TravelfusionCommands) {}

  /**
   * Reservar = ProcessTerms (UM só) → StartBooking → polling do CheckBooking.
   *
   * 🔴 `committed` ≠ `confirmed` (01-convencoes.md §7). Status não-final
   * (BookingInProgress / Unconfirmed / UnconfirmedBySupplier) NÃO é falha e NÃO
   * autoriza re-reservar: a reserva pode existir do outro lado. Devolvemos
   * committed:true / confirmed:false e quem consome espera.
   */
  async execute(dto: CreateBookingDto, context: RequestContext = {}): Promise<BookingResult> {
    const key = decodeOfferKey(dto.identifier);
    if (!key) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        details: { errors: { identifier: ['Identificador de oferta inválido ou expirado.'] } },
      });
    }

    const referenceDate = dto.referenceDate ?? new Date().toISOString();
    const bookingParameters = this.toCustomParameters(dto.customParameters);

    await this.commands.processTerms(
      {
        Mode: 'plane',
        RoutingId: key.r,
        BookingProfile: {
          CustomSupplierParameterList: bookingParameters.length
            ? { CustomSupplierParameter: bookingParameters }
            : undefined,
          TravellerList: {
            Traveller: dto.passengers.map((passenger) => this.buildTraveller(passenger, referenceDate)),
          },
        },
      },
      context,
    );

    await this.commands.startBooking(key.r, context); // sem retry: não idempotente

    const startedAt = Date.now();
    let last = await this.commands.checkBooking(key.r, context);

    while (!last.isFinal && Date.now() - startedAt < BOOKING_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS);
      last = await this.commands.checkBooking(key.r, context);
    }

    if (last.status === 'Failed') {
      throw new AppError('BUSINESS_RULE_VIOLATION', { metadata: { operation: 'createBooking' } });
    }
    if (last.status === 'Duplicate') {
      throw new AppError('RESOURCE_CONFLICT', { metadata: { operation: 'createBooking' } });
    }

    return {
      locator: last.supplierReference,
      committed: true,
      confirmed: last.succeeded,
      status: last.status ?? 'BookingInProgress',
    };
  }

  private toCustomParameters(source: Record<string, string> | undefined): Array<{ Name: string; Value: string }> {
    return Object.entries(source ?? {}).map(([Name, Value]) => ({ Name, Value }));
  }

  private buildTraveller(passenger: BookingPassengerDto, referenceDate: string): Record<string, unknown> {
    const perPassenger = this.toCustomParameters(passenger.customParameters);

    return {
      Age: ageOnFlightDate(passenger.dateOfBirth, referenceDate),
      Name: {
        Title: passenger.title ?? 'Mr',
        NamePartList: { NamePart: [passenger.firstName, passenger.lastName].filter(Boolean) },
      },
      CustomSupplierParameterList: perPassenger.length
        ? { CustomSupplierParameter: perPassenger }
        : undefined,
    };
  }
}
