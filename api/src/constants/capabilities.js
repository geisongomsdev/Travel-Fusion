/**
 * O que a Travelfusion realmente faz — 01-convencoes.md §8.
 *
 * 🔴 A checagem roda ANTES de validar o corpo. Invertida, a resposta vira
 * "payload inválido", que é verdade acidental e esconde o motivo real.
 *
 * `false` aqui significa "existe no contrato, o provedor não faz" → 501
 * CAPABILITY_NOT_SUPPORTED. Nunca devolver o XML cru como consolo.
 */
export const TRAVELFUSION_CAPABILITIES = Object.freeze({
  availability:      true,  // StartRouting + CheckRouting
  quote:             true,  // ProcessDetails
  booking:           true,  // ProcessTerms + StartBooking + CheckBooking
  retrieve:          true,  // CheckBooking
  fareRules:         true,  // termos vêm no ProcessDetails
  ping:              true,  // Login
  ancillaries:       true,  // RequiredParameterList (LuggageOptions)
  sellAncillaries:   true,  // CustomSupplierParameter no ProcessTerms

  // Dependentes do fornecedor por trás do agregador. Enquanto não houver
  // suporte confirmado por fornecedor, 501 é a resposta honesta.
  seatMap:           false,
  markSeats:         false,
  removeSeats:       false,
  cancelBooking:     false, // varia por fornecedor; muitos exigem bsm@travelfusion.com
  paymentOptions:    false,
  financingOptions:  false, // a Travelfusion não expõe parcelamento
  issue:             false, // não há emissão separada: StartBooking já cobra (ver docs/decisoes.md)
  retrieveEticket:   false,
  cancelEticket:     false,
});

export function supportsOperation(operation) {
  return TRAVELFUSION_CAPABILITIES[operation] === true;
}
