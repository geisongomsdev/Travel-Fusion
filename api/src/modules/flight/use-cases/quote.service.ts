import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { roundMoney } from '../../../common/utils/money';
import { decodeOfferKey } from '../../../common/utils/offer-key';
import { RequestContext } from '../../travelfusion/travelfusion.client';
import { TravelfusionCommands } from '../../travelfusion/travelfusion.commands';
import {
  normalizeRequiredParameters, RequiredParameter,
} from '../../travelfusion/normalizers/luggage.normalizer';
import { asList, num, text } from '../../travelfusion/xml.util';
import { QuoteDto } from '../dto/booking.dto';

export interface QuoteResult {
  identifier: string;
  price: {
    base: number | null;
    taxes: { boarding: number | null; service: number; fuel: number; baggage: number };
    fees: number | null;
    total: number | null;
    currency: string;
  };
  requiredParameters: RequiredParameter[];
}

@Injectable()
export class QuoteService {
  constructor(private readonly commands: TravelfusionCommands) {}

  /**
   * Tarifar = ProcessDetails.
   *
   * É aqui que a Travelfusion devolve o RequiredParameterList (bagagem e demais
   * CSPs). Devolvemos junto do preço porque o ProcessTerms é ÚNICO — não haverá
   * segunda chance de perguntar ao provedor o que ele exige.
   */
  async execute(dto: QuoteDto, context: RequestContext = {}): Promise<QuoteResult> {
    const key = decodeOfferKey(dto.identifier);
    if (!key) {
      throw new AppError('SEARCH_VALIDATION_ERROR', {
        details: { errors: { identifier: ['Identificador de oferta inválido ou expirado.'] } },
      });
    }

    const { response } = await this.commands.processDetails(key.r, key.o, key.i, context);

    const currency = text(response?.Currency) ?? 'BRL';
    const total = num(response?.TotalPrice);
    if (total === null) {
      throw new AppError('PRICING_ERROR', { metadata: { operation: 'quote' } });
    }

    const requiredParameters = normalizeRequiredParameters(
      asList(response?.RequiredParameterList?.RequiredParameter).map((parameter: any) => ({
        name: text(parameter?.Name),
        type: text(parameter?.Type),
        displayText: text(parameter?.DisplayText),
        perPassenger: text(parameter?.PerPassenger) === 'true',
        isOptional: text(parameter?.IsOptional) === 'true',
      })),
    );

    return {
      identifier: dto.identifier,
      price: {
        base: roundMoney(num(response?.BaseFare) ?? 0),
        taxes: { boarding: roundMoney(num(response?.Tax) ?? 0), service: 0, fuel: 0, baggage: 0 },
        fees: roundMoney(num(response?.Fee) ?? 0),
        total: roundMoney(total),
        currency,
      },
      requiredParameters,
    };
  }
}
