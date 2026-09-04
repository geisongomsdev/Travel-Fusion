/**
 * Idade REAL na data do voo — em ida-e-volta, na data da VOLTA.
 *
 * 🔴 Requisito de go-live nos dois provedores: eles validam a idade contra a
 * data do voo, e usar "hoje" faz uma criança que aniversaria antes da viagem ser
 * recusada na reserva — depois de já ter sido tarifada como criança.
 */
export function ageOnFlightDate(dateOfBirth: string, flightDate: string): number | null {
  const birth = new Date(dateOfBirth);
  const reference = new Date(flightDate);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(reference.getTime())) return null;

  let age = reference.getFullYear() - birth.getFullYear();
  const monthDelta = reference.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && reference.getDate() < birth.getDate())) age -= 1;
  return age;
}

export type PassengerTypeCode = 'ADT' | 'CHD' | 'INF';

/**
 * Faixas da IATA, usadas pela NDC da LATAM no `PTC`: bebê de colo até 2 anos
 * incompletos, criança até 12 incompletos, adulto daí em diante.
 *
 * Idade indeterminada cai em ADT de propósito: é a categoria sem restrição de
 * acompanhante, então um erro aqui não gera reserva que a companhia recusa no
 * embarque.
 */
export function passengerTypeCode(dateOfBirth: string, flightDate: string): PassengerTypeCode {
  const age = ageOnFlightDate(dateOfBirth, flightDate);
  if (age === null) return 'ADT';
  if (age < 2) return 'INF';
  if (age < 12) return 'CHD';
  return 'ADT';
}
