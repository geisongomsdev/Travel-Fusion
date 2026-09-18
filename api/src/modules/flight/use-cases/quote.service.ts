import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { roundMoney } from '../../../common/utils/money';
import { decodeOfferKey, OfferKey } from '../../../common/utils/offer-key';
import { ProviderRegistry } from '../../providers/provider.registry';
import { RequestContext, RequiredParameter } from '../../providers/provider.types';
import { QuoteDto, QuoteOfferDto } from '../dto/booking.dto';

/**
 * O preço firme — 05-quote.md §4.
 *
 * 🔴 ESCALAR, para a viagem inteira e todos os passageiros: um `rawTotal`, um
 * `base`, um `taxes`. Vale também para trecho solto — o tarifar devolve o total
 * que a reserva vai cobrar, não um preço por perna.
 */
export interface QuoteResult {
  provider: string;
  /** 🔴 `true` = a cotação foi feita. Tarifa que sumiu é 409, nunca `false`. */
  available: boolean;
  currency: string | null;
  /** O total CRU da companhia — sem margem nenhuma por cima. */
  rawTotal: number | null;
  base: number | null;
  taxes: number | null;
  /** Nenhum provedor converte moeda: a companhia responde na dela, e isso é dito aqui. */
  exchange: { from: string; to: string; conversionFactor: number; applied: boolean } | null;
  /** Extensão declarada: a família confirmada pelo tarifar. */
  familyCode: string | null;
  family: string | null;
  /**
   * Extensão declarada: o que o provedor vai exigir na reserva. Num agregador o
   * `ProcessTerms` é ÚNICO e não haverá segunda chance de perguntar — publicar
   * aqui é o que permite montar o formulário certo.
   */
  requiredParameters: RequiredParameter[];
}

/** O identificador que abre a oferta: `fareId`, ou a forma aninhada `fare.fareId`. */
const fareIdOf = (offer: QuoteOfferDto): string | undefined => offer.fareId ?? offer.fare?.fareId;

@Injectable()
export class QuoteService {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * Tarifar. O provedor sai da PRÓPRIA chave da oferta (`p`), nunca de um
   * parâmetro à parte: tarifar no provedor errado devolveria preço de outra
   * companhia para a mesma oferta.
   */
  async execute(dto: QuoteDto, context: RequestContext = {}): Promise<QuoteResult> {
    const { quote } = dto;

    /**
     * Cenário pós-reserva (§3). Nenhum dos provedores devolve `base` e `taxes`
     * de uma ordem existente — só o total —, e o invariante `base + taxes ==
     * rawTotal` não fecha com metade dos números. É 501 declarado, não um
     * sucesso com `null` onde deveria haver preço.
     */
    if (quote.booking && !quote.offers?.length) {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'quote' } });
    }

    const offers = quote.offers ?? [];
    if (offers.length === 0) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'quote' },
        details: { errors: { 'quote.offers': ['Obrigatório: ao menos uma oferta, ou quote.booking no cenário pós-reserva.'] } },
      });
    }

    /**
     * 🔴 Sem `passengers` não há default: assumir `adults: 1` tarifa uma venda
     * de três adultos pelo preço de um.
     */
    if (!quote.passengers) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'quote' },
        details: { errors: { 'quote.passengers': ['Obrigatório: a contagem de passageiros que gerou a oferta.'] } },
      });
    }

    const keys: OfferKey[] = offers.map((offer, index) => {
      const fareId = fareIdOf(offer);
      if (!fareId) {
        throw new AppError('SEARCH_VALIDATION_ERROR', {
          metadata: { operation: 'quote' },
          details: {
            errors: {
              [`quote.offers.${index}.fareId`]: [
                offer.journeyKey
                  ? 'Falta o identificador da tarifa: nesta companhia o journeyKey sozinho não abre a oferta.'
                  : 'Falta o identificador da oferta: mande fareId ou fare.fareId.',
              ],
            },
          },
        });
      }

      const key = decodeOfferKey(fareId);
      if (!key) {
        throw new AppError('SEARCH_VALIDATION_ERROR', {
          metadata: { operation: 'quote' },
          details: { errors: { [`quote.offers.${index}.fareId`]: ['Identificador de oferta inválido ou expirado.'] } },
        });
      }
      return key;
    });

    /**
     * 🔴 Todas as ofertas têm que ser do MESMO provedor. Numa viagem montada com
     * ida de uma companhia e volta de outra, tarifar só a primeira devolveria um
     * preço que não cobre a viagem — e o erro só apareceria na cobrança.
     */
    const [key] = keys;
    if (keys.some((other) => other.p !== key.p) || (dto.provider && dto.provider !== key.p)) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'quote' },
        details: {
          errors: {
            'quote.offers': ['Todas as ofertas precisam ser do provedor informado: um pacote não se monta entre companhias.'],
          },
        },
      });
    }

    const provider = this.registry.get(key.p);
    const quoted = await provider.quote(key, context);

    /** 🔴 200 sem preço nenhum é o pior resultado possível: quem consome acha que deu certo. */
    if (quoted.price.total === null) {
      throw new AppError('PROVIDER_INTEGRATION_ERROR', { metadata: { operation: 'quote' } });
    }

    const rawTotal = quoted.price.total;
    const base = quoted.price.base;

    return {
      provider: provider.name,
      available: quoted.available,
      currency: quoted.price.currency ?? null,
      rawTotal,
      base,
      /**
       * 🔴 Invariante `base + taxes == rawTotal`. Quando a companhia devolve
       * números que não fecham — ou taxa de serviço à parte, como a Travelfusion —
       * `taxes` é DERIVADO do total, não repassado.
       */
      taxes: base === null ? quoted.price.taxes : roundMoney(rawTotal - base),
      exchange: null,
      familyCode: quoted.familyCode,
      family: quoted.family,
      requiredParameters: quoted.requiredParameters,
    };
  }
}
