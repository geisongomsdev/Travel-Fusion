import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { decodeOfferKey } from '../../../common/utils/offer-key';
import { ProviderRegistry } from '../../providers/provider.registry';
import { RequestContext, RequiredParameter } from '../../providers/provider.types';
import { QuoteDto } from '../dto/booking.dto';

/**
 * O preço firme, no formato canônico.
 *
 * 🔴 PLANO, não aninhado em `price`. É o que o modelo publica, e a razão é que
 * o tarifar devolve UM preço — o da oferta escolhida —, enquanto a busca
 * devolve muitos e precisa da discriminação por passageiro. Repetir a estrutura
 * da busca aqui faria quem consome descer dois níveis para ler um número.
 */
export interface QuoteResult {
  provider: string;
  /** 🔴 `true` = a oferta ainda pode ser confirmada. Recusa vira erro, não `false`. */
  available: boolean;
  familyCode: string | null;
  family: string | null;
  currency: string;
  base: number | null;
  taxes: number | null;
  total: number | null;
  /**
   * O que o provedor vai exigir na reserva, já parseado.
   *
   * Extensão declarada: não está no modelo porque a LATAM tem os campos fixos
   * no schema, mas num agregador o `ProcessTerms` é ÚNICO e não haverá segunda
   * chance de perguntar. Publicar aqui é o que permite montar o formulário certo.
   */
  requiredParameters: RequiredParameter[];
}

@Injectable()
export class QuoteService {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * Tarifar. O provedor sai da PRÓPRIA chave da oferta (`p`), nunca de um
   * parâmetro à parte: tarifar no provedor errado devolveria preço de outra
   * companhia para a mesma oferta.
   */
  async execute(dto: QuoteDto, context: RequestContext = {}): Promise<QuoteResult> {
    const [first] = dto.offers;
    const key = decodeOfferKey(first?.fareId);
    if (!key) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'quote' },
        details: { errors: { 'offers.0.fareId': ['Identificador de oferta inválido ou expirado.'] } },
      });
    }

    /**
     * 🔴 Todas as ofertas têm que ser do MESMO provedor. Numa viagem montada com
     * ida de uma companhia e volta de outra, tarifar só a primeira devolveria um
     * preço que não cobre a viagem — e o erro só apareceria na cobrança.
     */
    const foreign = dto.offers.find((offer) => decodeOfferKey(offer.fareId)?.p !== key.p);
    if (foreign) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        metadata: { operation: 'quote' },
        details: {
          errors: {
            offers: ['Todas as ofertas precisam ser do mesmo provedor: um pacote não se monta entre companhias.'],
          },
        },
      });
    }

    const provider = this.registry.get(key.p);
    const quote = await provider.quote(key, dto, context);

    return {
      provider: provider.name,
      available: quote.available,
      familyCode: quote.familyCode,
      family: quote.family,
      currency: quote.price.currency,
      base: quote.price.base,
      taxes: quote.price.taxes,
      total: quote.price.total,
      requiredParameters: quote.requiredParameters,
    };
  }
}
