/**
 * Dinheiro no contrato é sempre `{ currency, total }` — 01-convencoes.md §5.
 *
 * 🔴 Nunca `Math.round(v * 100) / 100`: em ponto flutuante isso erra em valores
 * comuns de tarifa (1.005 vira 1, não 1.01). Arredonda pela representação decimal.
 */
export function roundMoney(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(`${Math.round(Number(`${parsed}e2`))}e-2`);
}

export interface Money {
  currency: string;
  total: number;
}

export function money(total: unknown, currency: string | null | undefined): Money | null {
  const rounded = roundMoney(total);
  if (rounded === null || !currency) return null;
  return { currency: currency.toUpperCase(), total: rounded };
}
