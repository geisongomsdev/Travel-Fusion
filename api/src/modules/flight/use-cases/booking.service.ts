import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { ageOnFlightDate } from '../../../common/utils/age';
import { decodeOfferKey } from '../../../common/utils/offer-key';
import { ProviderRegistry } from '../../providers/provider.registry';
import { ProviderPassenger, RequestContext } from '../../providers/provider.types';
import { CreateBookingDto } from '../dto/booking.dto';

/** Reexportado: o helper virou util comum quando a LATAM passou a precisar dele. */
export { ageOnFlightDate };

export interface BookingResult {
  provider: string;
  booking: {
    locator: string | null;
    status: string;
    currency: string | null;
  };
  /**
   * 🔴 `committed` ≠ `confirmed`, e as duas respondem perguntas DIFERENTES:
   * "a companhia aceitou e gravou?" e "existe prova de que a reserva existe?".
   *
   * O modelo canônico não publica o par nesta rota, e publicamos: é a distinção
   * mais cara do contrato inteiro. Status não-final não é falha e NÃO autoriza
   * re-reservar — a reserva pode existir do outro lado.
   */
  committed: boolean;
  confirmed: boolean;
  passengers: ProviderPassenger[];
  segments: {
    departure: null;
    return: null;
    journeys: unknown[];
  };
  /** Estado CRU da companhia. Nunca publicado como status canônico. */
  providerStatus: string;
}

@Injectable()
export class BookingService {
  constructor(private readonly registry: ProviderRegistry) {}

  async execute(dto: CreateBookingDto, context: RequestContext = {}): Promise<BookingResult> {
    const key = decodeOfferKey(dto.fields.selectedFareId);
    if (!key) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'createBooking' },
        details: { errors: { 'fields.selectedFareId': ['Identificador de oferta inválido ou expirado.'] } },
      });
    }

    const provider = this.registry.get(key.p);
    const booking = await provider.book(key, dto, context);

    return {
      provider: provider.name,
      booking: {
        locator: booking.locator,
        status: booking.status,
        currency: booking.currency,
      },
      committed: booking.committed,
      confirmed: booking.confirmed,
      passengers: booking.passengers,
      /**
       * 🔴 O itinerário NÃO vem na resposta da criação: o `OrderViewRS` confirma
       * a ordem, não repete os trechos. Publicar `null` é dizer "a companhia não
       * informou aqui" — quem quer o voo chama o `/retrieve`, que é a leitura
       * independente e traz `PaxSegmentList` completo.
       */
      segments: { departure: null, return: null, journeys: [] },
      providerStatus: booking.status,
    };
  }
}
