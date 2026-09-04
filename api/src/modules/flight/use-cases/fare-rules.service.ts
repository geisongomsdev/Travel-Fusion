import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { decodeOfferKey } from '../../../common/utils/offer-key';
import { ProviderRegistry } from '../../providers/provider.registry';
import { FareRuleSection, RequestContext } from '../../providers/provider.types';
import { FareRulesDto } from '../dto/booking.dto';

export type { FareRuleSection };

export interface FareRulesResult {
  provider: string;
  sections: FareRuleSection[];
}

@Injectable()
export class FareRulesService {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * Texto integral das condições da tarifa. Read-only: não tarifa, não reserva.
   *
   * 🔴 Chave que não abre é erro de QUEM CHAMOU: 400, e a chamada nem vai à
   * companhia. Chave corrompida não é falha de integração.
   */
  async execute(dto: FareRulesDto, context: RequestContext = {}): Promise<FareRulesResult> {
    const key = decodeOfferKey(dto.fareRules.key);
    if (!key) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        details: { errors: { 'fareRules.key': ['Chave inválida ou corrompida.'] } },
      });
    }

    const provider = this.registry.get(key.p);

    // 🔴 Provedor que não expõe o texto responde 501 ANTES de sair para a rede.
    // A LATAM devolve penalidade estruturada, não o texto da tarifa — inventar
    // uma seção a partir disso seria publicar como condição algo que não é.
    if (!provider.supports.fareRules) {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'fareRules' } });
    }

    const sections = await provider.fareRules(key, dto, context);

    if (sections.length === 0) {
      // sections[] tem mínimo 1 e o texto nunca é vazio. Sem texto, a resposta
      // honesta é dizer que o provedor não expõe — não devolver seção vazia.
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'fareRules' } });
    }

    return { provider: provider.name, sections };
  }
}
