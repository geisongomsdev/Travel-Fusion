import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { PROVIDER } from '../../../config/env';
import { RequestContext } from '../../travelfusion/travelfusion.client';
import { TravelfusionCommands } from '../../travelfusion/travelfusion.commands';
import { asList, text } from '../../travelfusion/xml.util';
import { RetrieveDto } from '../dto/booking.dto';

/** Estado de VENDA da reserva — vocabulário canônico, não o do fornecedor. */
const STATUS_MAP: Record<string, 'confirmed' | 'pending' | 'cancelled'> = {
  Succeeded: 'confirmed',
  BookingInProgress: 'pending',
  Unconfirmed: 'pending',
  UnconfirmedBySupplier: 'pending',
  Cancelled: 'cancelled',
  Failed: 'cancelled',
};

/**
 * 🔴 O vocabulário de tipo de passageiro varia muito entre companhias. O que não
 * reconhece vira `null`, nunca um chute — um chute aqui vira preço errado.
 */
const PASSENGER_TYPE_MAP: Record<string, 'adult' | 'child' | 'infant'> = {
  ADT: 'adult', ADULT: 'adult', ADULTO: 'adult', SENIOR: 'adult',
  CHD: 'child', CNN: 'child', CHILD: 'child', 'CRIANÇA': 'child',
  INF: 'infant', INFANT: 'infant', 'BEBÊ': 'infant',
};

export interface RetrieveResult {
  locator: string;
  connector: string;
  data: Record<string, unknown>;
}

@Injectable()
export class RetrieveService {
  constructor(private readonly commands: TravelfusionCommands) {}

  /**
   * Consultar a reserva ao vivo — SEM cache. O ponto da rota é saber o estado
   * agora: é a leitura independente que prova o efeito das mutações.
   *
   * A Travelfusion não tem um GetBooking rico. Todas as chaves do contrato
   * existem mesmo assim, com `null` onde ela não informa — omitir chave
   * significaria outra coisa para quem consome.
   */
  async execute(dto: RetrieveDto, context: RequestContext = {}): Promise<RetrieveResult> {
    const locator = dto.booking.locator;
    const result = await this.commands.checkBooking(locator, context);

    if (!result.status) {
      throw new AppError('RESOURCE_NOT_FOUND', { metadata: { operation: 'retrieve' } });
    }

    const raw = result.raw;

    return {
      locator,
      connector: dto.options?.provider ?? PROVIDER,
      data: {
        status: STATUS_MAP[result.status] ?? null,
        type: 'flight',
        // O CheckBooking não devolve os trechos, então o tipo de viagem não é
        // derivável aqui. `null` é a resposta honesta — não um palpite.
        trip: null,
        grouping: null,
        title: null,
        destination: null,
        iata: null,
        departure: null,
        arrival: null,
        currency: text(raw.Currency),

        createdAt: text(raw.BookingDateTime),
        // Prazo da reserva em espera: depois disso a companhia cancela sozinha.
        expiresAt: text(raw.TimeLimit),
        confirmationAt: text(raw.ConfirmationDateTime) ?? text(raw.BookingDateTime),

        provider: {
          code: PROVIDER,
          // ⚠️ É o nome da COMPANHIA AÉREA, não o do provedor. O campo engana.
          name: text(raw.SupplierName),
          locator,
        },
        // Num agregador o localizador da companhia difere do do provedor, e é o
        // da companhia que o passageiro precisa no check-in.
        supplier: { confirmation: result.supplierReference },

        people: this.normalizePeople(raw),
        segments: null,
        itinerary: null,
      },
    };
  }

  private normalizePeople(raw: Record<string, any>): Record<string, unknown>[] {
    return asList(raw?.TravellerList?.Traveller).map((traveller: any, index: number) => {
      const birthdate = this.normalizeBirthdate(text(traveller?.DateOfBirth));
      const type = PASSENGER_TYPE_MAP[(text(traveller?.Type) ?? '').toUpperCase()] ?? null;

      return {
        // 🔴 Bebê de colo vira entrada PRÓPRIA, com main:false e email null —
        // as companhias costumam devolvê-lo aninhado no adulto acompanhante.
        main: index === 0 && type !== 'infant',
        name: [text(traveller?.FirstName), text(traveller?.LastName)].filter(Boolean).join(' ') || null,
        firstName: text(traveller?.FirstName),
        lastName: text(traveller?.LastName),
        email: type === 'infant' ? null : text(traveller?.Email),
        phone: { country: null, area: null, number: null, type: null },
        nationality: text(traveller?.Nationality),
        document: { type: null, number: text(traveller?.DocumentNumber) },
        birthdate,
        age: this.ageFrom(birthdate),
        type,
        ageGroup: type, // sempre igual a type
        gender: null,
        loyalty: null, // programa não reconhecido é null, nunca um palpite
      };
    });
  }

  /** Normalizada para YYYY-MM-DD mesmo quando a companhia manda data-hora. */
  private normalizeBirthdate(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }

  /** Derivada de birthdate no momento da consulta. `null` sem data. */
  private ageFrom(birthdate: string | null): number | null {
    if (!birthdate) return null;
    const birth = new Date(birthdate);
    if (Number.isNaN(birth.getTime())) return null;

    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const monthDelta = now.getMonth() - birth.getMonth();
    if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) age -= 1;
    return age;
  }
}
