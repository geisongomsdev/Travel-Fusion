/**
 * O que cada provedor realmente faz — 01-convencoes.md §8.
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

/**
 * O que a LATAM NDC faz. As rotas foram conferidas uma a uma contra o sandbox.
 */
export const LATAM_CAPABILITIES: Record<FlightOperation, boolean> = {
  availability:     true,  // AirShopping
  quote:            true,  // OfferPrice
  booking:          true,  // OrderCreate
  retrieve:         true,  // OrderRetrieve
  cancelBooking:    true,  // OrderReshop + OrderCancel
  ping:             true,  // o proprio OAuth2 prova a credencial

  /**
   * A NDC devolve penalidade ESTRUTURADA, nao o texto integral da tarifa que o
   * /fare-rules exige. Publicar aquilo como "condicoes" seria dizer que e o que
   * nao e.
   */
  fareRules:        false,

  seatMap:          true,   // /seats/availability, pela oferta
  ancillaries:      true,   // /services/list, pela oferta
  financingOptions: true,   // /installments/options
  issue:            true,   // /order/change/payment — a ordem nasce sem pagar

  /**
   * Comprar assento/bagagem sobre reserva EMITIDA — /ndc/v241/order/change.
   * Marcar e comprar sao a mesma operacao aqui: a LATAM cobra o assento no
   * mesmo pedido em que o confirma, e nao existe reservar sem pagar.
   */
  sellAncillaries:  true,
  markSeats:        true,

  // Existem na NDC, ainda nao integrados aqui — divida nossa, nao ausencia deles.
  removeSeats:      false,
  paymentOptions:   false,
  retrieveEticket:  false,
  cancelEticket:    false,
};

const CAPABILITIES_BY_PROVIDER: Record<string, Record<FlightOperation, boolean>> = {
  travelfusion: TRAVELFUSION_CAPABILITIES,
  latam:        LATAM_CAPABILITIES,
};

/**
 * 🔴 O guard roda ANTES de validar o corpo, e o provedor vem NO corpo — logo,
 * aqui ainda nao da para saber de quem e a requisicao. Por isso a pergunta e
 * "ALGUM provedor no ar faz isso?": operacao que ninguem implementa morre cedo,
 * com 501 e sem confundir o motivo; operacao que so um faz passa e o caso de uso
 * decide, olhando o `supports` do provedor escolhido.
 *
 * Antes disso o mapa era so o da Travelfusion, e o /cancel-booking respondia 501
 * mesmo com a LATAM — que cancela.
 */
export function supportsOperation(operation: FlightOperation, providers?: string[]): boolean {
  const enabled = providers?.length
    ? providers
    : Object.keys(CAPABILITIES_BY_PROVIDER);

  return enabled.some((name) => CAPABILITIES_BY_PROVIDER[name.toLowerCase()]?.[operation] === true);
}
