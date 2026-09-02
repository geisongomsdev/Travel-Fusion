/**
 * Bagagem da Travelfusion — Key Integration Highlights §6.1.
 *
 * O `RequiredParameter` de nome LuggageOptions / OutwardLuggageOptions /
 * ReturnLuggageOptions descreve as opções em TEXTO LIVRE no DisplayText:
 *
 *   "Please Select Luggage Option: 1 (1 bags - 15Kg total - 25.00 EUR), 2 (...)"
 *
 * 🔴 Nada de hardcode: o conjunto muda por fornecedor e por rota. Parsear é
 * requisito de go-live.
 */
const OPTION_PATTERN = /(\d+)\s*\(([^)]*)\)/g;
const BAGS_PATTERN = /(\d+)\s*bags?/i;
const WEIGHT_PATTERN = /(\d+(?:\.\d+)?)\s*Kg/i;
const PRICE_PATTERN = /(\d+(?:[.,]\d{1,2})?)\s*([A-Z]{3})/;

export function parseLuggageOptions(displayText) {
  if (!displayText) return [];

  const options = [];
  for (const [, value, description] of displayText.matchAll(OPTION_PATTERN)) {
    const bags = description.match(BAGS_PATTERN);
    const weight = description.match(WEIGHT_PATTERN);
    const price = description.match(PRICE_PATTERN);

    options.push({
      value,                                        // volta cru no CustomSupplierParameter
      label: description.trim(),
      quantity: bags ? Number(bags[1]) : null,
      weightKg: weight ? Number(weight[1]) : null,
      price: price
        ? { currency: price[2], total: Number(price[1].replace(',', '.')) }
        : null,
    });
  }
  return options;
}

/** Onde a opção escolhida entra no ProcessTerms depende do PerPassenger. */
export function luggageScope(requiredParameter) {
  return requiredParameter?.perPassenger ? 'traveller' : 'booking';
}

export function normalizeRequiredParameters(list) {
  return list.map((parameter) => ({
    name: parameter.name,
    type: parameter.type,
    displayText: parameter.displayText,
    perPassenger: parameter.perPassenger === true,
    optional: parameter.isOptional === true,
    options: /LuggageOptions$/i.test(parameter.name || '')
      ? parseLuggageOptions(parameter.displayText)
      : [],
  }));
}
