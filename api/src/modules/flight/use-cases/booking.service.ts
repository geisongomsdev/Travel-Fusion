import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { ageOnFlightDate } from '../../../common/utils/age';
import { decodeOfferKey } from '../../../common/utils/offer-key';
import { ProviderRegistry } from '../../providers/provider.registry';
import { ProviderBooking, RequestContext } from '../../providers/provider.types';
import { CreateBookingDto } from '../dto/booking.dto';

/** Reexportado: o helper virou util comum quando a LATAM passou a precisar dele. */
export { ageOnFlightDate };

export interface BookingResult extends ProviderBooking {
  provider: string;
}

@Injectable()
export class BookingService {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * Reservar.
   *
   * 🔴 `committed` ≠ `confirmed` (01-convencoes.md §7). Status não-final NÃO é
   * falha e NÃO autoriza re-reservar: a reserva pode existir do outro lado.
   * Devolvemos committed:true / confirmed:false e quem consome espera. Isso vale
   * igual nos dois provedores — Travelfusion (CheckBooking) e LATAM (status da
   * ordem) — e é por isso que a decisão mora aqui, não no provedor.
   */
  async execute(dto: CreateBookingDto, context: RequestContext = {}): Promise<BookingResult> {
    const key = decodeOfferKey(dto.identifier);
    if (!key) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        details: { errors: { identifier: ['Identificador de oferta inválido ou expirado.'] } },
      });
    }

    const provider = this.registry.get(key.p);
    const booking = await provider.book(key, dto, context);

    return { ...booking, provider: provider.name };
  }
}
