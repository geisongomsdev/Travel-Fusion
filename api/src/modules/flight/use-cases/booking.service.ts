import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { ageOnFlightDate } from '../../../common/utils/age';
import { decodeOfferKey, OfferKey } from '../../../common/utils/offer-key';
import { ProviderRegistry } from '../../providers/provider.registry';
import {
  BookingInput, BookingPersonInput, ProviderPassenger, RequestContext,
} from '../../providers/provider.types';
import { BookingLegDto, BookingPersonDto, ContactPhoneDto, CreateBookingDto } from '../dto/booking.dto';

/** Reexportado: o helper virou util comum quando a LATAM passou a precisar dele. */
export { ageOnFlightDate };

/**
 * A resposta do /booking — 06-booking.md §5.
 *
 * 🔴 Os quatro valores que endereçam todas as rotas seguintes ficam no TOPO,
 * com estes nomes: `locator`, `status`, `bookingToken`, `orderIdentifier`. Um
 * localizador num caminho diferente por companhia obriga quem consome a
 * escrever um caso por integração.
 */
export interface BookingResult {
  locator: string | null;
  /** Estado da reserva NA COMPANHIA, como ela o nomeia. */
  status: string;
  provider: string;
  bookingToken: string | null;
  orderIdentifier: string | null;
  /**
   * 🔴 `committed` ≠ `confirmed`: "a companhia aceitou e gravou?" e "existe
   * prova de que a reserva existe?". Status não-final não é falha e NÃO
   * autoriza re-reservar — a reserva pode existir do outro lado.
   */
  committed: boolean;
  confirmed: boolean;
  currency: string | null;
  passengers: ProviderPassenger[];
}

type Fare = Record<string, unknown>;

const AGE_GROUPS: Record<string, BookingPersonInput['ageGroup']> = {
  adult: 'adult', senior: 'adult', child: 'child', infant: 'infant',
};

const invalid = (errors: Record<string, string[]>): AppError =>
  new AppError('SEARCH_VALIDATION_ERROR', { metadata: { operation: 'createBooking' }, details: { errors } });

@Injectable()
export class BookingService {
  constructor(private readonly registry: ProviderRegistry) {}

  async execute(dto: CreateBookingDto, context: RequestContext = {}): Promise<BookingResult> {
    const legs = this.validateTrip(dto);
    const fareId = this.selectedFareId(dto);

    const key = decodeOfferKey(fareId);
    if (!key) {
      throw invalid({ selectedFareId: ['Identificador de tarifa inválido ou expirado.'] });
    }
    if (dto.provider && dto.provider !== key.p) {
      throw invalid({ provider: [`A tarifa escolhida é do provedor ${key.p}, não de ${dto.provider}.`] });
    }

    const provider = this.registry.get(key.p);
    const people = this.toPeople(dto.people, key);

    /**
     * Gate de re-tarifa — 06-booking.md §4. Sem `displayedTotal` não há âncora
     * e a reserva segue pelo preço atual.
     *
     * 🔴 Só o AUMENTO barra: o cliente veria um valor e pagaria outro. Preço
     * que caiu reserva normalmente, e tarifa que sumiu já chega da companhia
     * como 409 `FARE_UNAVAILABLE`.
     */
    if (dto.displayedTotal !== undefined) {
      const current = await provider.quote(key, context);
      const total = current.price.total;
      if (total !== null && total - dto.displayedTotal > 0.01) {
        throw new AppError('FARE_PRICE_CHANGED', {
          metadata: { operation: 'createBooking' },
          details: {
            errors: { displayedTotal: [`A companhia cobra ${total}; o total exibido foi ${dto.displayedTotal}.`] },
          },
        });
      }
    }

    const input: BookingInput = {
      customer: {
        email: dto.customer.email || null,
        phone: phoneText(dto.customer.phone),
      },
      people,
      referenceDate: this.referenceDate(legs),
      customParameters: dto.options?.customParameters,
    };

    const booking = await provider.book(key, input, context);

    return {
      locator: booking.locator,
      status: booking.status,
      provider: provider.name,
      bookingToken: booking.bookingToken ?? null,
      orderIdentifier: booking.orderIdentifier ?? null,
      committed: booking.committed,
      confirmed: booking.confirmed,
      currency: booking.currency,
      passengers: booking.passengers,
    };
  }

  /**
   * Validação cruzada de `trip` × trechos × tarifa — 06-booking.md §3. Devolve
   * os trechos na ordem da viagem.
   */
  private validateTrip(dto: CreateBookingDto): BookingLegDto[] {
    const departure = dto.segments?.departure ?? [];
    const back = dto.segments?.return ?? [];
    const itinerary = dto.itinerary?.legs ?? [];

    if (departure.length === 0 && itinerary.length === 0) {
      throw invalid({ segments: ['Obrigatório: segments.departure (ida, ida-e-volta) ou itinerary.legs (multidestino).'] });
    }
    if (dto.trip === 'multicity' && itinerary.length === 0) {
      throw invalid({ 'itinerary.legs': ['Obrigatório em multicity: um item por trecho, na ordem.'] });
    }
    if (dto.trip !== 'multicity' && departure.length === 0) {
      throw invalid({ 'segments.departure': [`Obrigatório em ${dto.trip}.`] });
    }
    if (dto.trip === 'oneway' && back.length > 0) {
      throw invalid({ 'segments.return': ['Uma viagem só de ida não tem volta: envie vazio ou omita.'] });
    }
    if (dto.trip === 'roundtrip' && back.length === 0) {
      throw invalid({ 'segments.return': ['Obrigatório em roundtrip.'] });
    }

    const legs = dto.trip === 'multicity' ? itinerary : [...departure, ...back];
    const atRoot = (dto.fares?.length ?? 0) > 0 || (dto.itinerary?.fares?.length ?? 0) > 0;
    const inLegs = legs.some((leg) => (leg.fares?.length ?? 0) > 0);

    /** 🔴 A POSIÇÃO do `fares[]` é a resposta — nunca os dois lugares ao mesmo tempo. */
    if (atRoot && inLegs) {
      throw invalid({ fares: ['A tarifa vai na raiz (pacote) OU dentro dos trechos (trecho solto), nunca nos dois.'] });
    }

    return legs;
  }

  /**
   * A tarifa que decide a venda. `selectedFareId` vence; sem ele, a tarifa
   * única enviada.
   *
   * 🔴 `selectedFareId` que não casa com `fares[]` é FALHA, nunca cai numa
   * outra tarifa da lista.
   */
  private selectedFareId(dto: CreateBookingDto): string {
    const legs = [
      ...(dto.segments?.departure ?? []),
      ...(dto.segments?.return ?? []),
      ...(dto.itinerary?.legs ?? []),
    ];
    const fares: Fare[] = [
      ...(dto.fares ?? []),
      ...(dto.itinerary?.fares ?? []),
      ...legs.flatMap((leg) => leg.fares ?? []),
    ];
    const ids = fares.map((fare) => fare.fareId).filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (dto.selectedFareId) {
      if (fares.length > 0 && !ids.includes(dto.selectedFareId)) {
        throw invalid({ selectedFareId: ['Não existe em fares[]: a tarifa escolhida tem que estar na lista enviada.'] });
      }
      return dto.selectedFareId;
    }

    if (ids.length === 0) {
      throw invalid({ selectedFareId: ['Obrigatório: selectedFareId, ou fares[].fareId da tarifa escolhida.'] });
    }
    if (new Set(ids).size > 1) {
      throw invalid({ selectedFareId: ['Há mais de uma tarifa em fares[]: diga qual foi escolhida.'] });
    }
    return ids[0];
  }

  /**
   * `people[]` do contrato → viajantes do provedor.
   *
   * 🔴 O `identifier` chega à companhia como veio. Quando a oferta carrega a
   * lista de PaxIDs com que foi tarifada, cada viajante tem que ser um deles:
   * recusar aqui, nomeando os esperados, é melhor que o `PaxIDKeyRef` da LATAM.
   */
  private toPeople(people: BookingPersonDto[], key: OfferKey): BookingPersonInput[] {
    const errors: Record<string, string[]> = {};
    const expected = key.x ?? null;
    const seen = new Set<string>();

    const travellers: BookingPersonInput[] = people.map((person, index) => {
      const path = `people.${index}`;
      const ageGroup = AGE_GROUPS[person.ageGroup ?? person.type ?? ''];
      const birthDate = person.birthdate ?? person.birthDate;

      if (!ageGroup) (errors[`${path}.ageGroup`] ??= []).push('Obrigatório: ageGroup ou type.');
      /** 🔴 O contrato marca como opcional; os dois provedores conferem idade e recusam sem. */
      if (!birthDate) (errors[`${path}.birthdate`] ??= []).push('Obrigatório nesta companhia.');
      if (seen.has(person.identifier)) (errors[`${path}.identifier`] ??= []).push('Repetido: cada viajante tem o seu.');
      if (expected && !expected.includes(person.identifier)) {
        (errors[`${path}.identifier`] ??= []).push(`A oferta foi tarifada para ${expected.join(', ')}.`);
      }
      seen.add(person.identifier);

      return {
        id: person.identifier,
        title: person.title,
        firstName: person.firstName,
        lastName: person.lastName,
        ageGroup: ageGroup ?? 'adult',
        birthDate: birthDate ?? '',
        gender: person.gender,
        document: person.document,
        email: person.email,
        customParameters: person.customParameters,
      };
    });

    /**
     * Bebê de colo aninhado no adulto (`infantInfo`) vira viajante próprio. O
     * PaxID dele é o próximo `INF_*` da oferta que ninguém usou; quando a oferta
     * não carrega a lista (Travelfusion), o próximo `INF_<n>` livre.
     */
    const nextInfantId = (): string | undefined => {
      if (expected) return expected.find((pax) => pax.startsWith('INF') && !seen.has(pax));
      let n = 1;
      while (seen.has(`INF_${n}`)) n += 1;
      return `INF_${n}`;
    };

    people.forEach((person, index) => {
      const infant = person.infantInfo;
      if (!infant) return;

      const path = `people.${index}.infantInfo`;
      const id = nextInfantId();
      const birthDate = (infant.birthdate ?? infant.birthDate) as string | undefined;

      if (!id) (errors[path] ??= []).push('A oferta não foi tarifada com bebê de colo.');
      if (!birthDate) (errors[`${path}.birthdate`] ??= []).push('Obrigatório nesta companhia.');
      if (!id || !birthDate) return;

      seen.add(id);
      travellers.push({
        id,
        firstName: String(infant.firstName ?? ''),
        lastName: String(infant.lastName ?? ''),
        ageGroup: 'infant',
        birthDate,
        gender: infant.gender as string | undefined,
        document: infant.document as BookingPersonInput['document'],
      });
    });

    /**
     * 🔴 A viagem inteira tem que vir. A oferta foi tarifada para uma composição
     * específica, e reservar com menos gente usa um preço que cobre mais: a
     * companhia recusa a referência que sobra, e quando aceita, aceita pelo
     * valor errado. Recusar aqui nomeia quem falta; deixar passar vira
     * `PaxIDKeyRef` na LATAM, ou uma venda barata demais.
     */
    const missing = (expected ?? []).filter((paxId) => !seen.has(paxId));
    if (missing.length > 0) {
      (errors.people ??= []).push(
        `Faltam passageiros da oferta: ${missing.join(', ')}. Ela foi tarifada para ${expected!.join(', ')}.`,
      );
    }

    if (Object.keys(errors).length > 0) throw invalid(errors);
    return travellers;
  }

  /** A data do último trecho — é nela que a idade conta. */
  private referenceDate(legs: BookingLegDto[]): string | null {
    const departure = legs[legs.length - 1]?.time?.departure;
    return typeof departure === 'string' && departure.length >= 10 ? departure.slice(0, 10) : null;
  }
}

/** `ContactPhone` → o número inteiro, como a companhia o recebe. */
function phoneText(phone: ContactPhoneDto | undefined): string | null {
  if (!phone) return null;
  const digits = [phone.country, phone.area, phone.number].filter(Boolean).join('').replace(/\D/g, '');
  return digits || null;
}
