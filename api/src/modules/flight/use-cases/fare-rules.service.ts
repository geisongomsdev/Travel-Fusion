import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { decodeOfferKey } from '../../../common/utils/offer-key';
import { PROVIDER } from '../../../config/env';
import { RequestContext } from '../../travelfusion/travelfusion.client';
import { TravelfusionCommands } from '../../travelfusion/travelfusion.commands';
import { asList, text } from '../../travelfusion/xml.util';
import { FareRulesDto } from '../dto/booking.dto';

/** As 5 chaves existem sempre, na mesma ordem. Ausência é `null`, nunca `""`. */
export interface FareRuleSection {
  company: string | null;
  fareBasis: string | null;
  origin: string | null;
  destination: string | null;
  /** O texto da companhia, com `\n` preservado. Nunca null, nunca vazio. */
  text: string;
}

export interface FareRulesResult {
  provider: string;
  sections: FareRuleSection[];
}

@Injectable()
export class FareRulesService {
  constructor(private readonly commands: TravelfusionCommands) {}

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

    const { response } = await this.commands.processDetails(key.r, key.o, null, context);
    const sections = this.buildSections(response);

    if (sections.length === 0) {
      // sections[] tem mínimo 1 e o texto nunca é vazio. Sem texto, a resposta
      // honesta é dizer que o provedor não expõe — não devolver seção vazia.
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'fareRules' } });
    }

    return { provider: PROVIDER, sections };
  }

  private buildSections(response: Record<string, any>): FareRuleSection[] {
    const candidates = [
      ...asList(response?.FareRuleList?.FareRule),
      ...asList(response?.TermsAndConditionsList?.TermsAndConditions),
    ];

    const sections = candidates
      .map((node: any) => ({
        company: text(node?.Carrier) ?? text(node?.SupplierName),
        fareBasis: text(node?.FareBasis),
        origin: text(node?.Origin),
        destination: text(node?.Destination),
        text: text(node?.Text) ?? text(node?.Description) ?? text(node),
      }))
      .filter((section): section is FareRuleSection => Boolean(section.text));

    if (sections.length > 0) return sections;

    // Fallback: alguns fornecedores mandam um bloco único, sem lista.
    const single = text(response?.TermsAndConditions) ?? text(response?.FareRules);
    return single
      ? [{
          company: text(response?.SupplierName),
          fareBasis: text(response?.FareBasis),
          origin: text(response?.Origin),
          destination: text(response?.Destination),
          text: single,
        }]
      : [];
  }
}
