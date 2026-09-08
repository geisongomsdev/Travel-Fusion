import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { decodeOfferKey } from '../../../common/utils/offer-key';
import { ProviderRegistry } from '../../providers/provider.registry';
import { QuotedPrice, RequestContext, RequiredParameter } from '../../providers/provider.types';
import { QuoteDto } from '../dto/booking.dto';

export interface QuoteResult {
  identifier: string;
  provider: string;
  price: QuotedPrice;
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
    const key = decodeOfferKey(dto.identifier);
    if (!key) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        details: { errors: { identifier: ['Identificador de oferta inválido ou expirado.'] } },
      });
    }

    const provider = this.registry.get(key.p);
    const quote = await provider.quote(key, dto, context);

    return {
      identifier: dto.identifier,
      provider: provider.name,
      price: quote.price,
      requiredParameters: quote.requiredParameters,
    };
  }
}
