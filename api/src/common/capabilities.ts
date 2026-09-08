/**
 * O que a Travelfusion realmente faz — 01-convencoes.md §8.
 *
 * `false` significa "existe no contrato, o provedor não faz" → 501
 * CAPABILITY_NOT_SUPPORTED. Nunca devolver o XML cru como consolo.
 */
export const FLIGHT_OPERATIONS = [
  'availability', 'quote', 'booking', 'cancelBooking', 'retrieve',
  'seatMap', 'markSeats', 'removeSeats', 'ancillaries', 'sellAncillaries',
  'paymentOptions', 'financingOptions', 'issue', 'retrieveEticket',
  'cancelEticket', 'fareRules', 'ping',
] as const;

export type FlightOperation = (typeof FLIGHT_OPERATIONS)[number];

export const TRAVELFUSION_CAPABILITIES: Record<FlightOperation, boolean> = {
  availability:     true,  // StartRouting + CheckRouting
  quote:            true,  // ProcessDetails
  booking:          true,  // ProcessTerms + StartBooking + CheckBooking
  retrieve:         true,  // CheckBooking
  fareRules:        true,  // termos vêm no ProcessDetails
  ping:             true,  // Login

  // Sem equivalente no provedor — 501 é a resposta definitiva.
  issue:            false, // não há emissão separada: StartBooking já cobra
  paymentOptions:   false, // não expõe catálogo de formas de pagamento por oferta
  financingOptions: false, // não expõe parcelamento
  ancillaries:      false, // a listagem sai no /quote (requiredParameters)
  sellAncillaries:  false, // o extra entra como CSP no ProcessTerms, dentro do /booking

  // Dependentes do fornecedor por trás do agregador.
  seatMap:          false,
  markSeats:        false,
  removeSeats:      false,

  /**
   * ⚠️ Estas três NÃO são limitação do provedor: a Travelfusion tem uma
   * **Post Booking API** própria (Welcome Pack v1.9), com spec separada, mais a
   * plataforma "Manage Your Booking" — cujas credenciais só chegam junto com a
   * autorização de go-live e não operam sobre fake bookings.
   *
   * Ou seja: é dívida nossa, não capability ausente. Ficam `false` porque não
   * estão integradas, e a descrição no Swagger diz isso — prometer 501 como
   * "o provedor não faz" seria informação errada para quem consome.
   */
  cancelBooking:    false,
  retrieveEticket:  false,
  cancelEticket:    false,
};

export function supportsOperation(operation: FlightOperation): boolean {
  return TRAVELFUSION_CAPABILITIES[operation] === true;
}
