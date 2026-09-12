/**
 * Validade do cartão.
 *
 * 🔴 O contrato publica `expiryDate` como `MM/YYYY` (`"12/2030"`) e a LATAM
 * espera `MMAA` (`"1230"`). A conversão existia como um `.replace('/', '')`
 * espalhado pelos casos de uso — que funciona em `03/30` e produz `122030` num
 * ano de quatro dígitos. Seis caracteres onde a companhia espera quatro é
 * recusa de pagamento, e o motivo não aparece na mensagem de erro.
 */
export function expiryToMMYY(value: string): string {
  const digits = value.replace(/\D/g, '');

  // MMYYYY → MMYY: o século não entra, e é o ano que sobra.
  if (digits.length === 6) return digits.slice(0, 2) + digits.slice(4);
  return digits;
}
