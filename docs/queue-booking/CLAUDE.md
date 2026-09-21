# LATAM no `queue-booking` — guia de implementação

Guia para implementar as **mutações** da LATAM no `queue-booking.pass-connect/flight`: reservar,
emitir, cancelar, marcar assento e vender extra. As leituras já estão no `flight.pass-connect.com`
(busca, tarifar, consultar, mapa de assentos, opcionais e parcelamento — as três últimas entraram
em 18/09/2026).

> **De onde vem este documento.** Tudo aqui foi medido contra o sandbox real da LATAM, com a
> credencial do tenant `sandbox`, ou lido das amostras oficiais do portal
> (`docs/Provedores/latam/samples/`, no repo do flight). Onde a fonte é uma amostra e não uma
> medição, está dito. **Nunca vimos o `queue-booking` por dentro** — a estrutura descrita abaixo
> foi inferida do `scripts/mirror-manifest.json`, que lista 82 arquivos espelhados entre os dois
> repositórios. Confira antes de seguir ao pé da letra.

---

## 1. Onde o código entra

O manifesto de espelho mostra que a LATAM já existe na fila, com os mesmos arquivos de base do
flight:

```
src/integrations/latam/provider/latam/
  auth.js               OAuth2 client_credentials          ← espelhado (idêntico)
  url.js                monta a URL pelo ambiente          ← espelhado
  request.js            headers X-latam-*, POST XML/JSON   ← espelhado
  credentials-mapper.js snake_case do TenantDB → camelCase ← espelhado
  retrieve.js / retrieve-raw.js / retrieve-mapper.js       ← espelhado
  offer-selection.js    decodifica o fareId opaco          ← espelhado
```

As mutações entram **ao lado desses**, sem tocar nos espelhados:

| Rota pública | Arquivo novo sugerido | Mensagem NDC |
|---|---|---|
| `/booking` | `order-create.js` | `IATA_OrderCreateRQ` v19.2 |
| `/issue` | `order-change-payment.js` | `OrderRetrieve` + `IATA_OrderChangeRQ` v19.2 |
| `/cancel-booking` | `order-cancel.js` | `IATA_OrderReshopRQ` + `IATA_OrderCancelRQ` |
| `/mark-seats` | `order-change-seats.js` | `SeatAvailability` + `OrderChange` **24.1** |
| `/sell-ancillary` | `order-change-ancillaries.js` | `ServiceList` + `OrderChange` **24.1** |

🔴 **Arquivo espelhado se edita nos DOIS repos, no MESMO commit** (`npm run mirror:check`). Isso
inclui `shared-flight-error-codes.js`, `booking-address.schema.js`, `money.math.js`,
`static-endpoints.js` e o próprio manifesto.

---

## 2. As armadilhas, por rota

Cada uma abaixo custou horas. O código de referência (TypeScript) está no Travel-Fusion, em
`api/src/modules/providers/latam/`.

### 2.1 `/booking` — `OrderCreate`

- 🔴 **A ordem dos elementos é do XSD, não estética:** `ContactInfoRefID`, `IdentityDoc`,
  `Individual`, `PaxID`, `PTC` — e dentro de `Individual`, `Birthdate` **antes** do nome. Fora
  dessa sequência a LATAM responde `cvc-complex-type.2.4.a` sem dizer qual campo está errado.
- 🔴 **CPF é obrigatório no ponto de venda Brasil.** Medido em 21/09/2026: com passaporte, a
  resposta é `400109023 CPF is mandatory`. Com `IdentityDocTypeCode` de documento local, passa.
- 🔴 **Contato: ou vão os dois, ou nenhum.** Sem `ContactInfoList` → `912 ContactInfoList is null
  or empty`. Só tirar a referência troca o erro por
  `cvc-identity-constraint.4.3: Key 'ContactInfoIDKeyRef13' not found`. A regra que funciona é um
  `ContactInfo` por PaxID (`ADT_1_CNT`), cada `Pax` apontando para o seu.
- 🔴 **O PaxID vem da OFERTA**, não de um contador. A oferta foi tarifada com uma lista específica
  (`ADT_1`, `CHD_1`, `INF_1`), e o `SelectedOfferItem` referencia exatamente ela. Renumerar produz
  `PaxIDKeyRef` não encontrada.
- 🔴 **A viagem inteira tem que vir.** Reservar com menos passageiros do que a oferta cobre usa um
  preço que cobre mais. Recuse antes da rede, nomeando quem falta.
- **Sem retry.** A ordem nasce `OPENED`, sem pagamento e com prazo
  (`PaymentTimeLimitDateTime` por `OrderItem` — o menor manda). Resposta perdida → `/retrieve`,
  nunca repetir.
- `committed` ≠ `confirmed`: `committed` é "a companhia aceitou e gravou"; `confirmed` só em
  status final. Nunca deduza um do outro.

### 2.2 `/issue` — `OrderChange` com `PaymentFunctions`

- 🔴 **O valor cobrado é PERGUNTADO à companhia** (`OrderRetrieve`), nunca aceito do corpo. Um
  `billedAmount` no pedido é declaração de expectativa: se divergir, responda `FARE_PRICE_CHANGED`
  e **não cobre**.
- 🔴 **`Payer` exige CPF e data de nascimento** do titular, que pode não ser o passageiro. Sem
  eles: `400113007 PaymentProcessingDetails.Payer is mandatory`. Recuse antes da rede.
- 🔴 **Validade do cartão vai em `MMAA`**, quatro dígitos. Um `replace('/')` ingênuo manda seis e
  a recusa não explica o motivo.
- **Parcelamento:** o `financingId` do `/financing-options` entra em
  `PaymentFunctions/PaymentProcessingDetails/PaymentTrx/TrxID`. É o caminho documentado do fluxo
  Pay Later.
- **Endereço de cobrança** vai como `ContactInfo` com `ContactPurposeText: BILLING` e
  `PostalAddress` completo.
- 🔴 **A prova da emissão é o NÚMERO DO BILHETE, não o status.** `confirmed: true` só com
  documento; `false` quando a ordem fechou e nada veio; `null` enquanto a companhia não fechou.
- **Sem retry.** Cobrar duas vezes é o pior erro possível.
- Validado em 21/09/2026: ordem `LA9577671UFWD` paga com o cartão de teste
  `4000000000002701` (CVV 737, validade 03/2030), bilhete `9572300224293`, ordem `OPENED → CLOSED`.

### 2.3 `/cancel-booking` — `OrderReshop` + `OrderCancel`

- 🔴 **O reshop não é opcional:** o `OrderCancel` exige `ExpectedRefundAmount`, e o valor sai dele.
  Sem valor e sem void → 502, **sem tentar cancelar**. Mandar zero é abrir mão do reembolso.
- **Dois cancelamentos diferentes:** `Desc/DescText: VOID permitted` (dentro da janela, sem
  devolução de dinheiro) ou `PriceDifferential` com `DifferentialTypeCode: Refund`. O contrato
  publica isso em `outcome` (`VOID`/`REFUND`), que **não** é o status.
- 🔴 **`400107002` significa duas coisas opostas:** "ainda não paga" e "já cancelada". Desempate
  lendo o cupom antes de responder.
- 🔴 **`eticketsCancelled` é `false` até o CUPOM provar o contrário.** O `OrderCancelRS` de sucesso
  não diz nada sobre documento.
- Depois do void a ordem continua `CLOSED`; quem diz a verdade é o cupom.

### 2.4 `/mark-seats` e `/sell-ancillary` — `OrderChange` **24.1**

- 🔴 **Só funciona em ordem PAGA.** Medido: com a ordem `OPENED`, tanto `SeatAvailability` quanto
  `ServiceList` pela ordem respondem `409 Order is not ready for this Flow`.
- 🔴 **Dois catálogos, e só um compra.** Pela oferta os ids são `SEI|…` e morrem na emissão; pela
  ordem são `SEAT_<hash>` / `BAG_<hash>`, os únicos que o 24.1 aceita. Misturar →
  `INVALID_OFFER_TYPES: Mixed type offers are not supported`. E o prefixo é o que roteia: id fora
  do formato cai no fluxo de **troca de voo**.
- 🔴 **A chave carrega DOIS ids.** Sem `SelectedBundleServices/SelectedServiceRefID` a companhia
  recusa com `400112165`, e o `ServiceID` não aparece no mapa de assentos — só no
  `ALaCarteOfferItem`. No flight a chave pública já vai como `<OfferItemID>|<ServiceID>`: a fila
  recebe isso em `items[].key` e só precisa separar no `|`.
- 🔴 **O envelope do 24.1 não é o do 19.2:** EASD com dois namespaces (`easd:` nos filhos diretos,
  os tipos comuns como default), nesta ordem: `easd:AugmentationPoint` (com o CPF do titular,
  `IdentityDocTypeCode: I` — e não `CPF`, apesar da doc), `easd:DistributionChain`,
  `easd:PayloadAttributes` (`24.1`) e `easd:Request`.
- **Assento:** o contrato endereça pelo designador (`12A`) + trecho; a tradução para `OfferItemID`
  é lendo o mapa da própria reserva. Assento fora do mapa, designador malformado ou passageiro que
  a reserva não tem → **422**, antes da rede.
- **Total zero é caso real** (assento cortesia): aí a liquidação vai por BSP
  (`SettlementPlan/PaymentTypeCode: CA`), sem cartão.
- ⚠️ **Onde paramos:** com valor errado de propósito, a LATAM responde `400300005 Payment amount
  does not match order total` (leu e conferiu); com o valor certo, `409300032 Unsuccessful
  authorize`. Por BSP, idem. O pedido está correto — **o sandbox não autoriza cobrança de
  opcional**. Só dá para fechar isso com a LATAM ou em produção.
- ⚠️ **Rede de idempotência não implementada** (contrato 10-ancillaries.md §3.4): antes de
  pendurar, ler o que já está na reserva. Medido em outras companhias: a mesma chave duas vezes
  gera dois documentos e cobra duas vezes.

---

## 3. Erros: traduzir o código da LATAM

🔴 O código de erro dela **carrega o status HTTP nos três primeiros dígitos**: `404122007` é 404,
`409107014` é 409. Isso dá um mapeamento por família que cobre código novo sem catalogar um a um.
Já existe no flight, em `src/providers/latam/xml-message.js` (`sharedCodeForLatamError`) — vale
espelhar em vez de reescrever.

| Família | Código canônico |
|---|---|
| 401 / 403 | `PROVIDER_AUTHENTICATION_FAILED` |
| 404 | `RESOURCE_NOT_FOUND` |
| 409 | `RESOURCE_CONFLICT` |
| 422 | `BUSINESS_RULE_VIOLATION` |
| 429 | `RATE_LIMITED` |
| 503 / 504 | `PROVIDER_UNAVAILABLE` / `PROVIDER_TIMEOUT` |

O `400` fica de fora: ali quem errou foi o XML que **nós** montamos, e isso é falha de integração.

Casos que merecem código próprio, por serem decisão de quem consome:
`409107014` → `FARE_PRICE_CHANGED` · `409140008` → `FARE_UNAVAILABLE` ·
`400300005` → `FARE_PRICE_CHANGED` (preço do opcional mudou) ·
`409300032` → `PAYMENT_DECLINED` · texto "not suitable for the void" → `BOOKING_ALREADY_CANCELLED`.

🔴 A LATAM responde erro de negócio **dentro de um HTTP 200**, com `<Error>` na raiz. Tratar isso
como resposta vazia publica "não há nada" quando a verdade é "a companhia recusou".

---

## 4. Segredo e dado de cartão

- **Credencial nunca em env nem no código:** vem do TenantDB, por requisição, via
  `credentials-mapper.js`. A LATAM exige `api_key`, `key_secret`, `agency_id`, `iata`,
  `travel_agent_id`, `agency_name`, `country` e `language`.
- 🔴 **Dump de debug não pode levar PAN.** No flight isso já mordeu: o `/financing-options`
  gravava o XML com `<Pan>` inteiro em disco. Qualquer mensagem nova que carregue cartão
  (`OrderChange` de pagamento, 24.1 com cartão) precisa redigir antes de gravar.
- Nada de cartão volta em resposta, e o log de mutação registra só `operation`, `locator` e
  `correlationId`.

---

## 5. Como testar

- **Unidade:** `node --test`, sem Jest. Fixtures reais: as amostras do portal em
  `docs/Provedores/latam/` (no repo do flight) cobrem `OrderCreate`, `OrderView`, `OrderChange`
  (pagamento e 24.1), `OrderReshop`, `OrderCancel`, `SeatAvailability` e `ServiceList`.
- **Sandbox:** a credencial LATAM está cadastrada no tenant `sandbox` (id 158, ambiente
  `sandbox`), e o serviço de leitura já a resolve. Ordem de exemplo já paga:
  `LA9577671UFWD` (GRU→REC, 20/11/2026, 1 adulto, bilhete `9572300224293`).
- **Fluxo mínimo para exercitar uma mutação:** busca → tarifar → `/booking` → `/issue` → a rota em
  teste. As três primeiras já funcionam no flight; a reserva precisa estar paga para assento e
  extra.
- O Travel-Fusion tem um duble do NDC (`api/test/fixtures/latam-ndc-double.mjs`) que valida as
  armadilhas de schema sem gastar sandbox — útil para o caminho de erro, mas ele **não** confere
  lista de passageiros nem estado da ordem.

---

## 6. Antes de abrir o PR

- [ ] `npm run mirror:check` — arquivo espelhado editado nos dois repos, no mesmo commit.
- [ ] Contrato de rota alterado? Atualizar a documentação, rodar `api:check` e, na aprovação,
      `api:snapshot` + entrada no `docs/api-changelog-history.json`.
- [ ] Mensagem de erro da API em inglês; comentário de código em português.
- [ ] Conventional Commits, **sem rodapé de atribuição a IA**.
- [ ] Branch + PR. Nunca push direto na `main`.

---

## 7. O que ainda não se sabe

- Se a chave do sandbox também autentica em produção (não testado, e não se testa por curiosidade).
- Se o sandbox chega a autorizar cobrança de opcional — hoje ele recusa em todos os caminhos.
- Se o `SeatAvailability` da LATAM publica código de fileira de emergência: na captura de
  21/09/2026 (A320 3-3, 204 assentos) só vieram `W` (janela, colunas A/F), `A` (corredor, C/D) e
  `MS` (meio, B/E). Sem código de saída, `exitRow` fica `false`.
