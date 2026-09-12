/**
 * Duração de voo em MINUTOS — é assim que o contrato publica (`FlightTime.duration`).
 *
 * 🔴 A companhia tem precedência: quando ela declara a duração, é ela que vale.
 * Recalcular a partir dos horários parece inofensivo e não é — origem e destino
 * costumam estar em fusos diferentes, e a subtração só dá certo quando os dois
 * carimbos trazem offset. Onde a LATAM diz `PT4H5M`, publicar 245 é repetir a
 * companhia; derivar 185 porque um dos lados veio sem fuso é inventar.
 */

const ISO_DURATION = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i;

/** `PT4H5M` / `P1DT2H` → minutos. `null` no que não casa. */
export function durationFromIso(value: string | null | undefined): number | null {
  if (!value) return null;

  const match = ISO_DURATION.exec(value.trim());
  if (!match) return null;

  const [, days, hours, minutes] = match;
  if (!days && !hours && !minutes) return null;

  return Number(days ?? 0) * 1440 + Number(hours ?? 0) * 60 + Number(minutes ?? 0);
}

/**
 * Minutos entre dois carimbos ISO-8601.
 *
 * 🔴 Exige offset nos DOIS lados. Sem ele, `new Date()` assume o fuso de quem
 * está rodando o processo, e a conta passa a depender de onde o servidor mora —
 * um voo GRU→SCL mediria diferente em São Paulo e em Lisboa.
 */
export function durationBetween(departure: string | null, arrival: string | null): number | null {
  if (!departure || !arrival) return null;

  const zoned = /([Zz]|[+-]\d{2}:?\d{2})$/;
  if (!zoned.test(departure) || !zoned.test(arrival)) return null;

  const from = new Date(departure).getTime();
  const to = new Date(arrival).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;

  return Math.round((to - from) / 60_000);
}

/**
 * A duração que vai para a resposta: a declarada, senão a calculada, senão `0`.
 *
 * `0` é o que o contrato pede para "não informada" — e é diferente de `null`,
 * que aqui não existe: o campo é sempre um inteiro.
 */
export function flightDuration(
  declared: string | null | undefined,
  departure: string | null,
  arrival: string | null,
): number {
  return durationFromIso(declared) ?? durationBetween(departure, arrival) ?? 0;
}
