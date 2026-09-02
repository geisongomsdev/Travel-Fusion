import { AppError } from '../../domain/errors.js';
import { decodeOfferKey } from '../../utils/offer-key.js';
import { processDetails } from '../../integrations/travelfusion/provider/commands.js';
import { asList, text, num } from '../../integrations/travelfusion/provider/xml.js';
import { normalizeRequiredParameters } from '../../integrations/travelfusion/normalizers/luggage.normalizer.js';
import { roundMoney } from '../../domain/money.js';

/**
 * Tarifar = ProcessDetails.
 *
 * É aqui que a Travelfusion devolve o RequiredParameterList (bagagem e demais
 * CSPs). Guardamos junto do quote porque o ProcessTerms — que é ÚNICO — vai
 * precisar deles, e não haverá segunda chance de perguntar.
 */
export async function quoteOffer({ identifier }, context = {}) {
  const key = decodeOfferKey(identifier);
  if (!key?.r) {
    throw new AppError('SEARCH_VALIDATION_ERROR', {
      details: { errors: { identifier: ['Identificador de oferta inválido ou expirado.'] } },
    });
  }

  const { response, durationMs } = await processDetails(key.r, key.o, key.i, context);

  const currency = text(response?.Currency) || 'BRL';
  const total = num(response?.TotalPrice);
  if (total === null) {
    throw new AppError('PRICING_ERROR', { metadata: { operation: 'quote' } });
  }

  const requiredParameters = normalizeRequiredParameters(
    asList(response?.RequiredParameterList?.RequiredParameter).map((parameter) => ({
      name: text(parameter?.Name),
      type: text(parameter?.Type),
      displayText: text(parameter?.DisplayText),
      perPassenger: text(parameter?.PerPassenger) === 'true',
      isOptional: text(parameter?.IsOptional) === 'true',
    })),
  );

  return {
    data: {
      identifier,
      price: {
        base: roundMoney(num(response?.BaseFare) ?? 0),
        taxes: { boarding: roundMoney(num(response?.Tax) ?? 0), service: 0, fuel: 0, baggage: 0 },
        fees: roundMoney(num(response?.Fee) ?? 0),
        total: roundMoney(total),
        currency,
      },
      // Parâmetros que o ProcessTerms vai exigir. Nada hardcoded: vem do provedor.
      requiredParameters,
    },
    durationMs,
  };
}
