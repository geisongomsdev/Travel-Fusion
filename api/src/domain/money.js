/**
 * Dinheiro no contrato é sempre `{ currency, total }` — 01-convencoes.md §5.
 *
 * 🔴 Nunca `Math.round(v * 100) / 100`: em ponto flutuante isso erra em valores
 * comuns de tarifa (ex.: 1.005). Arredonda pela representação decimal.
 */
export function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(`${Math.round(Number(`${number}e2`))}e-2`);
}

export function money(total, currency) {
  const rounded = roundMoney(total);
  if (rounded === null || !currency) return null;
  return { currency: String(currency).toUpperCase(), total: rounded };
}

export function sumMoney(parts, currency) {
  const total = parts.reduce((acc, part) => acc + (Number(part) || 0), 0);
  return money(total, currency);
}
