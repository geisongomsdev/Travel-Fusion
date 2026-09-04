import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { ProviderRegistry } from '../../providers/provider.registry';
import { ProviderRetrieval, RequestContext } from '../../providers/provider.types';
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

export interface RetrieveResult {
  locator: string;
  connector: string;
  data: Record<string, unknown>;
}

@Injectable()
export class RetrieveService {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * Consultar a reserva ao vivo — SEM cache. O ponto da rota é saber o estado
   * agora: é a leitura independente que prova o efeito das mutações.
   *
   * 🔴 O envelope do contrato é montado AQUI, um lugar só, e não em cada
   * provedor: todas as chaves existem sempre, com `null` onde a companhia não
   * informa. Omitir chave significaria outra coisa para quem consome, e deixar
   * isso a cargo de cada provedor faria as duas respostas divergirem em silêncio.
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

    return {
      locator: found.locator,
      connector: provider.name,
      data: {
        status: found.status,
        type: 'flight',
        // Nenhum dos dois provedores devolve os trechos nesta leitura, então o
        // tipo de viagem não é derivável aqui. `null` é a resposta honesta.
        trip: null,
        grouping: null,
        title: null,
        destination: null,
        iata: null,
        departure: null,
        arrival: null,
        currency: found.currency,

        createdAt: found.createdAt,
        expiresAt: found.expiresAt,
        confirmationAt: found.confirmationAt,

        provider: {
          code: provider.name,
          // ⚠️ É o nome da COMPANHIA AÉREA, não o do provedor. O campo engana.
          name: found.supplierName,
          locator: found.locator,
        },
        supplier: { confirmation: found.supplierConfirmation },

        people: this.normalizePeople(found.people),
        segments: null,
        itinerary: null,
      },
    };
  }

  private normalizePeople(people: ProviderRetrieval['people']): Record<string, unknown>[] {
    return people.map((person, index) => {
      const birthdate = this.normalizeBirthdate((person.dateOfBirth as string) ?? null);
      const type = PASSENGER_TYPE_MAP[String(person.type ?? '').toUpperCase()] ?? null;
      const firstName = (person.firstName as string) ?? null;
      const lastName = (person.lastName as string) ?? null;

      return {
        // 🔴 Bebê de colo vira entrada PRÓPRIA, com main:false e email null —
        // as companhias costumam devolvê-lo aninhado no adulto acompanhante.
        main: index === 0 && type !== 'infant',
        name: [firstName, lastName].filter(Boolean).join(' ') || null,
        firstName,
        lastName,
        email: type === 'infant' ? null : ((person.email as string) ?? null),
        phone: { country: null, area: null, number: null, type: null },
        nationality: (person.nationality as string) ?? null,
        document: { type: null, number: (person.documentNumber as string) ?? null },
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
