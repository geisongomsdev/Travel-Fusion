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

/** Sinônimos do estado fino — 08-retrieve.md §4.1. O que não reconhece passa CRU. */
const PROVIDER_STATUS_MAP: Record<string, string> = {
  BOOKED: 'CONFIRMED', CONFIRMED: 'CONFIRMED',
  HELD: 'HOLD', PENDING: 'HOLD', OPEN: 'HOLD', OPENED: 'HOLD', HOLD: 'HOLD',
  ISSUED: 'TICKETED', TICKETED: 'TICKETED',
  CANCELED: 'CANCELLED', CANCELLED: 'CANCELLED',
  ERROR: 'ERROR',
};

/** Cabine canônica, lida do campo que a companhia documenta como cabine — nunca da classe. */
const cabinOf = (value: string | null): string | null => {
  const label = (value ?? '').toLowerCase();
  if (!label) return null;
  if (label.includes('premium')) return 'premium_economy';
  if (label.includes('business') || label.includes('execut')) return 'business';
  if (label.includes('first') || label.includes('primeira')) return 'first';
  if (label.includes('econ')) return 'economy';
  return null;
};

const airport = (iata: string | null) => (iata
  ? { iata, code: iata, name: null, city: null, country: null, coordinates: { lat: null, lng: null } }
  : null);

const minutesBetween = (from: string | null, to: string | null): number | null => {
  if (!from || !to) return null;
  const delta = new Date(to).getTime() - new Date(from).getTime();
  return Number.isNaN(delta) ? null : Math.round(delta / 60000);
};

/** `true` se a chegada é num dia local posterior à partida; `null` sem as duas datas. */
const nextDayOf = (departure: string | null, arrival: string | null): boolean | null =>
  departure && arrival ? arrival.slice(0, 10) > departure.slice(0, 10) : null;

export interface RetrievedLeg {
  /** Sempre `null` aqui: é o token de OFERTA da busca, e numa consulta ele não existe mais. */
  identifier: null;
  provider: string;
  company: { code: string | null; name: string | null };
  origin: ReturnType<typeof airport>;
  destination: ReturnType<typeof airport>;
  time: { departure: string | null; arrival: string | null; duration: number | null; nextDay: boolean | null };
  stops: number | null;
  flights: Array<{
    number: string | null;
    connection: boolean;
    origin: { iata: string | null };
    destination: { iata: string | null };
    company: { code: string | null; name: string | null };
    time: { departure: string | null; arrival: string | null; duration: number };
    equipment: { code: string | null; name: string | null; description: string | null };
  }>;
}

/** O conteúdo da reserva — 08-retrieve.md §3. Todas as chaves existem sempre. */
export interface RetrieveData {
  status: 'confirmed' | 'pending' | 'cancelled' | null;
  type: 'flight';
  trip: 'oneway' | 'roundtrip' | 'multicity' | null;
  grouping: 'segmented' | 'provider-group' | 'multicity' | null;
  title: string | null;
  destination: ReturnType<typeof airport>;
  iata: { from: string | null; to: string | null } | null;
  departure: string | null;
  arrival: string | null;
  currency: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  confirmationAt: string | null;
  people: Record<string, unknown>[];
  segments: { departure: RetrievedLeg[]; return: RetrievedLeg[] } | null;
  itinerary: { id: null; airline: string | null; legs: RetrievedLeg[] } | null;
  fares: Record<string, unknown>[] | null;
  provider: { code: string; name: string | null; locator: string | null };
  supplier: { confirmation: string | null };
  fields: {
    providerStatus: string | null;
    system: string | null;
    issueDate: string | null;
    balanceDue: number | null;
    permissions: Record<
      'canIssue' | 'canCancel' | 'canRebook' | 'canSelectSeats' | 'canReissueCombined' | 'canReissueWithFare',
      boolean | null
    >;
    contacts: Array<{ type: string; name: string | null; email: string | null; phone: string | null }>;
    tickets: Array<{
      passengerId: string | null;
      ticketNumber: string | null;
      status: string | null;
      issueDate: string | null;
      cancelToken: string | null;
    }>;
    ancillaries: Array<Record<string, unknown>>;
    pricing: { currency: string | null; total: number | null; breakdown: unknown[] };
  };
}

/**
 * O envelope do /retrieve — 08-retrieve.md §2. É a ÚNICA rota com chaves a
 * mais no topo, e é assim no contrato: `connector`, `booking`, `status`,
 * `message` ao lado de `data`, sem `meta`.
 */
export interface RetrieveResult {
  success: true;
  connector: string;
  booking: string;
  status: 'found';
  message: 'Booking retrieved successfully';
  data: RetrieveData;
}

@Injectable()
export class RetrieveService {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * Consultar a reserva ao vivo — SEM cache. O ponto da rota é saber o estado
   * agora: é a leitura independente que prova o efeito das mutações.
   *
   * 🔴 Localizador inexistente é 404, nunca 200 com status chutado. Reserva
   * cancelada é 200 — "não existe" e "existe e está cancelada" são fatos
   * diferentes.
   */
  async execute(dto: RetrieveDto, context: RequestContext = {}): Promise<RetrieveResult> {
    const provider = dto.options?.provider
      ? this.registry.get(dto.options.provider)
      : this.registry.default();

    if (!provider.supports.retrieve) {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'retrieve' } });
    }

    const found = await provider.retrieve(dto.booking.locator, context);

    return {
      success: true,
      connector: dto.options?.provider ?? provider.name,
      booking: dto.booking.locator,
      status: 'found',
      message: 'Booking retrieved successfully',
      data: this.toData(found, provider.name),
    };
  }

  private toData(found: ProviderRetrieval, providerName: string): RetrieveData {
    const legs = this.buildLegs(found, providerName);
    const trip = this.tripOf(legs);
    const first = legs[0];
    const last = legs[legs.length - 1];

    /** Ida-e-volta: o destino é o da IDA. Multidestino: o do último trecho. */
    const destination = trip === 'roundtrip' ? first.destination : last?.destination ?? null;
    const people = this.normalizePassengers(found.people);
    const flightTickets = found.tickets.filter((ticket) => ticket.type === 'flight');
    const emds = found.tickets.filter((ticket) => ticket.type !== 'flight');
    const cancelled = found.status === 'cancelled';

    return {
      status: found.status,
      type: 'flight',
      trip,
      grouping: trip === 'oneway' ? 'segmented' : trip === 'roundtrip' ? 'provider-group' : trip === 'multicity' ? 'multicity' : null,
      title: legs.length
        ? legs.map((leg) => `${leg.origin?.iata ?? '?'} - ${leg.destination?.iata ?? '?'}`).join(' / ')
        : null,
      destination,
      iata: legs.length ? { from: first.origin?.iata ?? null, to: destination?.iata ?? null } : null,
      departure: first?.time.departure ?? null,
      arrival: last?.time.arrival ?? null,
      currency: found.currency,
      createdAt: found.createdAt,
      expiresAt: found.expiresAt,
      // Cai em `createdAt` quando a companhia não distingue.
      confirmationAt: found.confirmationAt ?? found.createdAt,
      people,
      /** 🔴 `segments` e `itinerary` são mutuamente exclusivos. Num `oneway`, `return` é `[]`. */
      segments: trip === 'oneway' || trip === 'roundtrip'
        ? { departure: [first], return: trip === 'roundtrip' ? [last] : [] }
        : null,
      itinerary: trip === 'multicity'
        ? { id: null, airline: first.company.code, legs }
        : null,
      fares: this.faresOf(found),
      provider: {
        code: providerName,
        // ⚠️ O nome da COMPANHIA do primeiro trecho, não o do provedor.
        name: null,
        locator: found.locator,
      },
      supplier: { confirmation: found.supplierConfirmation },
      fields: {
        providerStatus: found.rawStatus ? PROVIDER_STATUS_MAP[found.rawStatus.toUpperCase()] ?? found.rawStatus : null,
        system: found.supplierName,
        // Emissão da RESERVA: a LATAM não a distingue da criação.
        issueDate: null,
        /** `0` = quitado; `null` = a companhia não informa. Não se deduz. */
        balanceDue: null,
        permissions: {
          // Pagar só faz sentido enquanto a ordem não fechou.
          canIssue: cancelled ? false : found.status === 'pending',
          canCancel: cancelled ? false : found.status === 'confirmed' || found.status === 'pending',
          // A companhia não declara estas; `null` é "não sabemos", não "não pode".
          canRebook: cancelled ? false : null,
          canSelectSeats: cancelled ? false : null,
          canReissueCombined: null,
          canReissueWithFare: null,
        },
        contacts: this.contactsOf(people),
        tickets: flightTickets.map((ticket) => ({
          passengerId: ticket.passengerId,
          ticketNumber: ticket.ticketNumber,
          status: ticket.providerStatus,
          issueDate: ticket.issueDate,
          cancelToken: null,
        })),
        ancillaries: emds.map((emd) => this.ancillaryOf(emd)),
        pricing: { currency: found.currency, total: found.total, breakdown: [] },
      },
    };
  }

  /**
   * Agrupa os segmentos físicos nas pernas da viagem.
   *
   * Sem agrupamento declarado pela companhia, a reserva é tratada como UMA
   * perna — o honesto quando não se sabe onde uma perna termina.
   */
  private buildLegs(found: ProviderRetrieval, providerName: string): RetrievedLeg[] {
    if (found.segments.length === 0) return [];

    const byId = new Map(found.segments.map((segment) => [segment.segmentId ?? '', segment]));
    const groups = found.journeys.length > 0
      ? found.journeys.map((journey) =>
          journey.segmentIds
            .map((id) => byId.get(id))
            .filter((segment): segment is ProviderSegment => segment !== undefined))
      : [found.segments];

    return groups.filter((group) => group.length > 0).map((group) => {
      const head = group[0];
      const tail = group[group.length - 1];

      return {
        identifier: null,
        provider: providerName,
        company: { code: head.company.code, name: null },
        origin: airport(head.origin),
        destination: airport(tail.destination),
        time: {
          departure: head.departure,
          arrival: tail.arrival,
          // Ponta a ponta, conexões incluídas; a soma dos voos esconderia a espera.
          duration: minutesBetween(head.departure, tail.arrival)
            ?? group.reduce((sum, segment) => sum + segment.duration, 0),
          nextDay: nextDayOf(head.departure, tail.arrival),
        },
        stops: group.length - 1,
        flights: group.map((segment, index) => ({
          number: segment.company.number,
          connection: index > 0,
          origin: { iata: segment.origin },
          destination: { iata: segment.destination },
          company: { code: segment.company.code, name: null },
          time: { departure: segment.departure, arrival: segment.arrival, duration: segment.duration },
          equipment: { code: segment.aircraft, name: null, description: null },
        })),
      };
    });
  }

  /**
   * 1 trecho → `oneway`; 2 espelhados (A→B e B→A) → `roundtrip`; qualquer
   * outra combinação de 2+ → `multicity`. A companhia raramente diz o tipo.
   */
  private tripOf(legs: RetrievedLeg[]): RetrieveData['trip'] {
    if (legs.length === 0) return null;
    if (legs.length === 1) return 'oneway';
    const [a, b] = legs;
    const mirrored = legs.length === 2
      && a.origin?.iata === b.destination?.iata
      && a.destination?.iata === b.origin?.iata;
    return mirrored ? 'roundtrip' : 'multicity';
  }

  /**
   * A tarifa da ordem. Os dois provedores vendem PACOTE: uma tarifa na raiz,
   * `appliesTo: "all"`, com o total da reserva.
   */
  private faresOf(found: ProviderRetrieval): Record<string, unknown>[] | null {
    const head = found.segments[0];
    if (!head || (!head.fareBasis && !head.bookingClass)) return null;

    return [{
      fareId: null,
      code: null,
      appliesTo: 'all',
      name: null,
      fareCode: head.fareBasis,
      bookingCode: head.bookingClass,
      familyCode: null,
      cabin: cabinOf(head.cabin),
      refundable: null,
      changeable: null,
      baggage: null,
      price: { adult: null, child: null, baby: null, total: found.total },
    }];
  }

  private normalizePassengers(people: Record<string, unknown>[]): Record<string, unknown>[] {
    let mainAssigned = false;

    return people.map((person) => {
      const birthdate = this.normalizeBirthdate((person.dateOfBirth as string) ?? null);
      const type = PASSENGER_TYPE_MAP[String(person.type ?? '').toUpperCase()] ?? null;
      const firstName = (person.firstName as string) ?? null;
      const lastName = (person.lastName as string) ?? null;
      // `true` só no primeiro — e bebê de colo nunca é o principal.
      const main = !mainAssigned && type !== 'infant';
      if (main) mainAssigned = true;
      const infant = type === 'infant';

      return {
        /** Extensão declarada: o id que `fields.tickets[].passengerId` e as rotas de assento usam. */
        id: (person.id as string) ?? null,
        main,
        name: [firstName, lastName].filter(Boolean).join(' ') || null,
        firstName,
        lastName,
        email: infant ? null : ((person.email as string) ?? null),
        phone: { country: null, area: null, number: null, type: null },
        nationality: (person.nationality as string) ?? null,
        document: { type: null, number: (person.documentNumber as string) ?? null },
        birthdate,
        age: this.ageFrom(birthdate),
        type,
        ageGroup: type,
        gender: null,
        // Programa não reconhecido é `null`, nunca um palpite.
        loyalty: null,
      };
    });
  }

  /** Contatos derivados dos passageiros, sem repetição. */
  private contactsOf(people: Record<string, unknown>[]): RetrieveData['fields']['contacts'] {
    const seen = new Set<string>();
    return people
      .filter((person) => person.type !== 'infant')
      .map((person) => ({
        type: 'passenger',
        name: (person.name as string) ?? null,
        email: (person.email as string) ?? null,
        phone: null,
      }))
      .filter((contact) => {
        const key = `${contact.name}|${contact.email}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  /** Um EMD da reserva — 08-retrieve.md §3.9. `type` e `status` crus da companhia. */
  private ancillaryOf(emd: ProviderTicket): Record<string, unknown> {
    return {
      documentNumber: emd.ticketNumber,
      type: emd.type,
      description: null,
      status: emd.providerStatus,
      amount: emd.amount?.total ?? null,
      currency: emd.amount?.currency ?? null,
      issueDate: emd.issueDate,
      passengerId: emd.passengerId,
      segmentIds: [],
      seat: null,
    };
  }

  /** Normalizada para YYYY-MM-DD mesmo quando a companhia manda data-hora. */
  private normalizeBirthdate(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }

  /** Derivada de `birthdate` no momento da consulta. `null` sem data. */
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
