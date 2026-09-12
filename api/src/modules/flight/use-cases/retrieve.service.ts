import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { ProviderRegistry } from '../../providers/provider.registry';
import {
  ProviderRetrieval, ProviderSegment, ProviderTicket, RequestContext,
} from '../../providers/provider.types';
import { RetrieveDto } from '../dto/booking.dto';

/**
 * 🔴 O vocabulário de tipo de passageiro varia muito entre companhias. O que não
 * reconhece vira `null`, nunca um chute — um chute aqui vira preço errado.
 */
const PASSENGER_TYPE_MAP: Record<string, 'adult' | 'child' | 'infant'> = {
  ADT: 'adult', ADULT: 'adult', ADULTO: 'adult', SENIOR: 'adult',
  CHD: 'child', CNN: 'child', CHILD: 'child', 'CRIANÇA': 'child',
  INF: 'infant', INFANT: 'infant', 'BEBÊ': 'infant',
};

export interface RetrievedJourney {
  origin: { iata: string | null; city: null; terminal: null };
  destination: { iata: string | null; city: null; terminal: null };
  time: { departure: string | null; arrival: string | null; duration: number };
  stops: number;
  flights: ProviderSegment[];
  fare: {
    familyCode: null;
    familyName: null;
    cabin: string | null;
    cabinLabel: null;
    bookingClass: string | null;
    fareBasis: string | null;
  } | null;
}

export interface RetrieveResult {
  booking: {
    locator: string;
    status: string | null;
    provider: string;
    system: string | null;
    currency: string | null;
    createdAt: string | null;
    bookedAt: string | null;
    issueDate: string | null;
    timeLimit: string | null;
    /** Derivadas do status — nunca `true` por omissão. */
    permissions: {
      canIssue: boolean | null;
      canCancel: boolean | null;
      canRebook: boolean | null;
      canSelectSeats: boolean | null;
      canReissueCombined: boolean | null;
      canReissueWithFare: boolean | null;
    };
    /** Estado CRU. Nunca publicado como status canônico. */
    providerStatus: string | null;
  };
  trip: 'oneway' | 'roundtrip' | 'multicity' | null;
  passengers: Record<string, unknown>[];
  segments: {
    departure: RetrievedJourney | null;
    return: RetrievedJourney | null;
    /** 🔴 A lista COMPLETA. Nenhuma perna pode sumir por não caber em ida/volta. */
    journeys: RetrievedJourney[];
  };
  contacts: unknown[];
  total: number | null;
}

@Injectable()
export class RetrieveService {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * Consultar a reserva ao vivo — SEM cache. O ponto da rota é saber o estado
   * agora: é a leitura independente que prova o efeito das mutações.
   *
   * 🔴 O envelope é montado AQUI, um lugar só, e não em cada provedor: todas as
   * chaves existem sempre, com `null` onde a companhia não informa.
   */
  async execute(dto: RetrieveDto, context: RequestContext = {}): Promise<RetrieveResult> {
    // Sem chave de oferta para dizer de quem é a reserva, quem manda é
    // `options.provider`; sem ele, o padrão da instância.
    const provider = dto.options?.provider
      ? this.registry.get(dto.options.provider)
      : this.registry.default();

    if (!provider.supports.retrieve) {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'retrieve' } });
    }

    const found = await provider.retrieve(dto.booking.locator, context);
    const journeys = this.buildJourneys(found.segments, found.journeys);

    /**
     * 🔴 O tipo sai da contagem de JOURNEYS, não de segmentos. Uma ida com
     * conexão tem dois segmentos e continua sendo `oneway` — foi essa confusão
     * que fazia uma escala virar "ida e volta" na tela.
     */
    const trip = journeys.length === 0
      ? null
      : journeys.length === 1
        ? 'oneway'
        : journeys.length === 2
          ? 'roundtrip'
          : 'multicity';

    return {
      booking: {
        locator: found.locator,
        status: found.status,
        provider: provider.name,
        system: found.supplierName,
        currency: found.currency,
        createdAt: found.createdAt,
        bookedAt: found.confirmationAt,
        // Emissão é outra coisa de criação: só existe quando há bilhete.
        issueDate: found.tickets.find((ticket) => ticket.issueDate)?.issueDate ?? null,
        timeLimit: found.expiresAt,
        permissions: {
          // Pagar só faz sentido enquanto a ordem não fechou.
          canIssue: found.status === 'pending',
          canCancel: found.status === 'confirmed' || found.status === 'pending',
          // A companhia não declara estas; `null` é "não sabemos", não "não pode".
          canRebook: null,
          canSelectSeats: null,
          canReissueCombined: null,
          canReissueWithFare: null,
        },
        providerStatus: found.rawStatus,
      },
      trip,
      passengers: this.normalizePassengers(found.people, found.tickets),
      segments: {
        /**
         * 🔴 Em multidestino os dois são `null`, de propósito: escolher a
         * primeira perna como "ida" inventaria uma viagem de ida-e-volta que
         * ninguém comprou. A lista completa está em `journeys`.
         */
        departure: journeys.length <= 2 ? journeys[0] ?? null : null,
        return: journeys.length === 2 ? journeys[1] : null,
        journeys,
      },
      contacts: [],
      total: found.total,
    };
  }

  /**
   * Agrupa os segmentos físicos nas pernas da viagem.
   *
   * Sem agrupamento declarado pela companhia, a reserva é tratada como UMA
   * journey — o honesto quando não se sabe onde uma perna termina.
   */
  private buildJourneys(
    segments: ProviderSegment[],
    grouping: ProviderRetrieval['journeys'],
  ): RetrievedJourney[] {
    if (segments.length === 0) return [];

    const byId = new Map(segments.map((segment) => [segment.segmentId ?? '', segment]));

    const groups = grouping.length > 0
      ? grouping.map((journey) =>
          journey.segmentIds
            .map((id) => byId.get(id))
            .filter((segment): segment is ProviderSegment => segment !== undefined))
      : [segments];

    return groups.filter((group) => group.length > 0).map((group) => {
      const first = group[0];
      const last = group[group.length - 1];

      return {
        origin: { iata: first.origin, city: null, terminal: null },
        destination: { iata: last.destination, city: null, terminal: null },
        time: {
          departure: first.departure,
          arrival: last.arrival,
          // A duração da perna é a soma dos segmentos que a companhia declarou.
          duration: group.reduce((sum, segment) => sum + segment.duration, 0),
        },
        // Conexões dentro desta perna, não número de segmentos.
        stops: group.length - 1,
        flights: group,
        fare: first.fareBasis || first.bookingClass
          ? {
              familyCode: null,
              familyName: null,
              cabin: first.cabin,
              cabinLabel: null,
              bookingClass: first.bookingClass,
              fareBasis: first.fareBasis,
            }
          : null,
      };
    });
  }

  private normalizePassengers(
    people: Record<string, unknown>[],
    tickets: ProviderTicket[],
  ): Record<string, unknown>[] {
    return people.map((person, index) => {
      const birthdate = this.normalizeBirthdate((person.dateOfBirth as string) ?? null);
      const type = PASSENGER_TYPE_MAP[String(person.type ?? '').toUpperCase()] ?? null;
      const firstName = (person.firstName as string) ?? null;
      const lastName = (person.lastName as string) ?? null;
      const id = (person.id as string) ?? null;

      return {
        id,
        // 🔴 Bebê de colo vira entrada PRÓPRIA, com main:false — as companhias
        // costumam devolvê-lo aninhado no adulto acompanhante.
        main: index === 0 && type !== 'infant',
        name: [firstName, lastName].filter(Boolean).join(' ') || null,
        firstName,
        lastName,
        type,
        ageGroup: type,
        dateOfBirth: birthdate,
        age: this.ageFrom(birthdate),
        gender: null,
        email: type === 'infant' ? null : ((person.email as string) ?? null),
        nationality: (person.nationality as string) ?? null,
        document: { type: null, number: (person.documentNumber as string) ?? null },
        contact: null,
        // Programa não reconhecido é `null`, nunca um palpite.
        loyaltyProgram: null,
        /** `[]` é legítimo numa reserva ainda não emitida. */
        tickets: id ? tickets.filter((ticket) => ticket.passengerId === id) : [],
        infant: null,
      };
    });
  }

  /** Normalizada para YYYY-MM-DD mesmo quando a companhia manda data-hora. */
  private normalizeBirthdate(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }

  /** Derivada de dateOfBirth no momento da consulta. `null` sem data. */
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
