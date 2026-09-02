import { AppError } from '../../domain/errors.js';
import { decodeOfferKey } from '../../utils/offer-key.js';
import { processDetails } from '../../integrations/travelfusion/provider/commands.js';
import { asList, text } from '../../integrations/travelfusion/provider/xml.js';

const PROVIDER = 'travelfusion';

/**
 * Texto integral das condições da tarifa.
 *
 * 🔴 Chave que não abre é erro de QUEM CHAMOU: 400, e a chamada nem vai à
 * companhia. Chave corrompida não é falha de integração.
 */
export async function fareRules(request, context = {}) {
  const key = decodeOfferKey(request?.fareRules?.key);
  if (!key?.r) {
    throw new AppError('SEARCH_VALIDATION_ERROR', {
      details: { errors: { 'fareRules.key': ['Chave inválida ou corrompida.'] } },
    });
  }

  const { response, durationMs } = await processDetails(key.r, key.o, null, context);

  const sections = buildSections(response);
  if (sections.length === 0) {
    // sections[] tem mínimo 1 e o texto nunca é vazio. Sem texto, a resposta
    // honesta é dizer que este provedor não expõe — não devolver seção vazia.
    throw new AppError('CAPABILITY_NOT_SUPPORTED', { metadata: { operation: 'fareRules' } });
  }

  return { data: { provider: PROVIDER, sections }, durationMs };
}

/**
 * As 5 chaves existem sempre, na mesma ordem. Ausência é `null`, nunca `""`.
 * O `\n` do texto da companhia é preservado.
 */
function buildSections(response) {
  const candidates = [
    ...asList(response?.FareRuleList?.FareRule),
    ...asList(response?.TermsAndConditionsList?.TermsAndConditions),
  ];

  const sections = candidates
    .map((node) => ({
      company: text(node?.Carrier) || text(node?.SupplierName),
      fareBasis: text(node?.FareBasis),
      origin: text(node?.Origin),
      destination: text(node?.Destination),
      text: text(node?.Text) || text(node?.Description) || text(node),
    }))
    .filter((section) => Boolean(section.text));

  if (sections.length > 0) return sections;

  // Fallback: alguns fornecedores mandam um bloco único, sem lista.
  const single = text(response?.TermsAndConditions) || text(response?.FareRules);
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
