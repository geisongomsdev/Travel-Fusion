# Mapeamento: contrato ↔ Travelfusion

As 17 rotas do contrato e o que cada uma faz no provedor.

---

## Implementadas

| Rota | Comando Travelfusion | Observação |
|---|---|---|
| `POST /availability` | `StartRouting` + N× `CheckRouting` | Polling ≥ 2s exposto como `text/event-stream` |
| `POST /quote` | `ProcessDetails` | Traz também o `RequiredParameterList` (bagagem e CSPs) |
| `POST /booking` | `ProcessTerms` → `StartBooking` → N× `CheckBooking` | **HTTP 201.** Um único `ProcessTerms` |
| `POST /retrieve` | `CheckBooking` | Envelope próprio, `status` sempre `"found"` |
| `POST /fare-rules` | `ProcessDetails` (bloco de termos) | Chave opaca vinda de `fares[].rules.key` |
| `POST /ping` | `Login` | `LoginId` cacheado — Login é raro por desenho |

## 501 `CAPABILITY_NOT_SUPPORTED`

| Rota | Por quê |
|---|---|
| `POST /seat-map` · `POST /mark-seats` · `DELETE /remove-seats` | Depende do fornecedor por trás do agregador; sem suporte confirmado na branch |
| `POST /ancillaries` · `POST /sell-ancillaries` | Não há venda avulsa: o extra entra como CSP no `ProcessTerms`, dentro do `/booking`. Listagem vem no `/quote` |
| `POST /payment-options` | A Travelfusion não expõe catálogo de formas de pagamento por oferta |
| `POST /financing-options` | Não expõe parcelamento |
| `POST /issue` | **Não existe emissão separada** — o `StartBooking` já cobra |
| `POST /retrieve-eticket` · `POST /cancel-eticket` | O agregador devolve a referência do fornecedor, não o bilhete. Cancelamento passa por `bsm@travelfusion.com` |
| `POST /cancel-booking` | Varia por fornecedor; sem suporte uniforme |

---

## Comandos sem rota no contrato

Dois comandos da Travelfusion não têm equivalente e existem só internamente:

| Comando | Para quê |
|---|---|
| `GetBranchSupplierList` | Quais fornecedores estão habilitados na nossa branch |
| `ListSupplierRoutes` | Quais rotas cada fornecedor atende — **obrigatório para o go-live** |

`ListSupplierRoutes` filtra a busca **antes** de disparar o `StartRouting`. Rota não atendida não
vira erro: vira `provider_error` com `NO_FLIGHTS`, que é resposta válida.

> Estão implementados em `provider/commands.js` mas ainda não ligados ao fluxo da busca — é o
> próximo passo, e é bloqueante para a certificação.

---

## Timeouts por comando

Da spec v1.3, pág. 43–44. A coluna *retry* não é sugestão.

| Comando | Read timeout | Retry |
|---|---|---|
| `StartRouting` | 4s | 1, com timeout de 15s |
| `CheckRouting` | 7s | segue o polling |
| `ProcessDetails` | 150s | **nenhum** |
| `ProcessTerms` | 150s | **nenhum** |
| `StartBooking` | 20s | **nenhum** — ir direto para `CheckBooking` |
| `CheckBooking` | 10s | segue o polling |

`ProcessTerms` e `StartBooking` são mutações **não idempotentes**: retentar cria reserva duplicada.

---

## Erro: Travelfusion → catálogo

| Origem | Código do contrato | HTTP |
|---|---|---|
| `4-3448` (Login ID not found — IP não whitelistado) | `PROVIDER_AUTHENTICATION_FAILED` | 401 |
| Família `4-1xxx` / `4-2xxx` / `4-3xxx` | `PROVIDER_AUTHENTICATION_FAILED` | 401 |
| `NoRoute`, `RouteNotFound` | `ROUTE_NOT_FOUND` | 404 |
| `PriceChange` | `FARE_PRICE_CHANGED` | 409 |
| `Unavailable`, `SoldOut` | `FARE_UNAVAILABLE` | 409 |
| `RateLimit`, `TooMany` | `RATE_LIMITED` | 429 |
| Timeout de leitura | `PROVIDER_TIMEOUT` | 504 |
| Qualquer outro | `PROVIDER_INTEGRATION_ERROR` | 502 |

O que não casa vai para **502**, nunca para `UNEXPECTED_ERROR` (500): a falha veio do provedor e quem
consome age diferente nos dois casos.

### Status de reserva

| `CheckBooking` | Resultado |
|---|---|
| `Succeeded` | `committed: true`, `confirmed: true` |
| `BookingInProgress` · `Unconfirmed` · `UnconfirmedBySupplier` | `committed: true`, `confirmed: false` — **continuar o polling, nunca re-reservar** |
| `Failed` | 422 `BUSINESS_RULE_VIOLATION` |
| `Duplicate` | 409 `RESOURCE_CONFLICT` |
