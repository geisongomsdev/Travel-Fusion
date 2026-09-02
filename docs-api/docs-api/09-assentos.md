# 09 — Assentos: `/seat-map`, `/mark-seats`, `/remove-seats`

Três rotas, um vocabulário só.

| Método | Rota | O que faz | Quando |
|---|---|---|---|
| `POST` | `/seat-map` | Lê o mapa de assentos da reserva. **Leitura pura, sem efeito** | Depois da reserva criada |
| `POST` | `/mark-seats` | Marca assentos | Depois do `/seat-map`, antes da emissão |
| `DELETE` | `/remove-seats` | Remove assentos marcados | Para liberar ou trocar |

> ⚠️ **`/remove-seats` é `DELETE` COM CORPO.** O corpo é obrigatório e é lido igual ao das rotas
> `POST`. Alguns clientes HTTP e proxies descartam corpo em `DELETE` — se o seu ambiente for um
> deles, você vai precisar de um cliente que permita.

**O `/seat-map` é a fonte dos identificadores.** `passengers[].id`, `segments[].segmentId` e
`seats[].seat` saem de lá e são copiados para as duas mutações. Nunca monte esses valores.

**Trocar de assento = remover e marcar de novo.** Não existe rota de troca.

> Termo novo? Está no [`00-glossario.md`](00-glossario.md).

---

## 1. `POST /seat-map`

### 1.1 Request

```json
{
  "options": { "provider": "acme-air", "currency": "BRL" },
  "seatMap": {
    "booking": { "locator": "ABC123" },
    "segments": [ { "id": "1" } ],
    "passengers": [ { "id": "1.1" } ]
  }
}
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `options.provider` | `string` | **sim** | |
| `options.currency` | `string(3)` | não (default `BRL`) | Moeda dos preços do mapa. Fica em `options` porque é preferência da **chamada**, não da reserva |
| `seatMap.booking` | `object` | **sim** | Endereço da reserva. `locator` basta na maioria das companhias |
| `seatMap.booking.locator` | `string` | **sim** | |
| `seatMap.booking.bookingToken` / `.orderIdentifier` / `.source` | `string` | condicional | Conforme a sua companhia |
| `seatMap.segments[]` | `array` | não | Filtro de trecho: `[{id}]`. **Ausente = mapa de TODOS os trechos** |
| `seatMap.passengers[]` | `array` | não | Filtro de passageiro: `[{id}]`. Algumas companhias montam o mapa **para um passageiro** — nesse caso é obrigatório do lado delas |

`options` é **fechado**: chave desconhecida ali → **400**.

### 1.2 Response

```json
{
  "success": true,
  "data": {
    "provider": "acme-air",
    "locator": "ABC123",
    "currency": "BRL",
    "paymentRequired": false,
    "passengers": [
      { "id": "1.1", "firstName": "JOÃO", "lastName": "SILVA", "assignedSeats": [] }
    ],
    "segments": [
      {
        "segmentId": "1",
        "origin": "GRU", "destination": "REC",
        "departureDate": "2026-09-15",
        "number": "4232",
        "company":   { "code": "G3", "name": null },
        "equipment": { "code": "32Q", "name": null },
        "cabins": [
          {
            "cabinClass": "Economy",
            "rows": [
              {
                "number": "1", "exitRow": false,
                "seats": [
                  { "seat": "1A", "row": "1", "column": "A",
                    "status": "available", "available": true,
                    "paid": true, "price": { "currency": "BRL", "total": 88.00 },
                    "characteristics": ["chargeable", "window", "extra-legroom"],
                    "providerCharacteristics": [],
                    "commercialName": "Conforto", "accessible": null, "recline": null }
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  "meta": { "provider": "acme-air", "duration": 1840, "timestamp": "2026-09-01T12:00:00.000Z" }
}
```

#### Raiz

| Campo | Tipo | Descrição |
|---|---|---|
| `provider` | `string` | |
| `locator` | `string` \| `null` | |
| `currency` | `string` \| `null` | Moeda dos preços do mapa. `null` quando a companhia não precifica assento |
| `paymentRequired` | `boolean` \| `null` | A companhia declara que marcar exige pagamento. **`null` = ela não informa** — nesse caso o `paid` de cada assento é a fonte confiável |
| `passengers[]` | `array` | §1.3 |
| `segments[]` | `array` | §1.4 |

#### 1.3 `passengers[]`

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | `string` \| `null` | 🔴 **O valor que vai em `seats[].passengerId` das mutações.** Copie, nunca monte. O formato varia muito entre companhias (`"1"`, `"1.1"`, `"01.01"`, uma string opaca) |
| `firstName` / `lastName` | `string` \| `null` | |
| `assignedSeats` | `array` \| **`null`** | O que este passageiro **já tem**. §1.5 |

`assignedSeats[]` item: `{ segmentId, seat }` — ambos `string` \| `null`. O `seat` vem no **mesmo
formato** do mapa, para comparar direto.

#### 1.4 `segments[]`

| Campo | Tipo | Descrição |
|---|---|---|
| `segmentId` | `string` \| `null` | 🔴 **O valor que vai em `seats[].segmentId` das mutações** |
| `origin` / `destination` | `string` \| `null` | IATA |
| `departureDate` | `string` \| `null` | `YYYY-MM-DD` |
| `number` | `string` \| `null` | Número do voo (o campo se chama `number`, não `flightNumber`) |
| `company` | `object` | `{code, name}` — o mapa geralmente só traz o código, então `name` costuma ser `null` |
| `equipment` | `object` | `{code, name}` — idem |
| `cabins[]` | `array` | **Sempre ≥1**, mesmo sem inventário. Um trecho sem assento disponível emite uma cabine vazia — assim quem consome sabe que o trecho existe e não tem mapa |

`cabins[]` item: `{ cabinClass, rows[] }`.

- `cabinClass`: `string` \| `null`. **Cru da companhia**, não canonizado (`"Economy"`, `"ECONOMY"`,
  `"Y"`). Diferente do resto do contrato, e é deliberado: o rótulo da cabine no mapa é comercial, não
  a cabine tarifária.

`rows[]` item: `{ number, exitRow, seats[] }`.

- `number`: `string`. `"24"`.
- `exitRow`: `boolean`. Fileira de emergência. Quando a companhia não distingue, `false` — e o
  código de saída fica em `providerCharacteristics` do assento.
- Fileira sem nenhum assento é descartada.

#### 1.5 🔴 `assignedSeats`: `null` ≠ `[]`

| Valor | Significa |
|---|---|
| `null` | **A companhia não informa** quais assentos o passageiro já tem |
| `[]` | Ela informa, e **não há nenhum** |

Emitir `[]` quando a verdade é `null` faz a interface afirmar "sem assento" numa reserva que pode ter
assento marcado.

#### 1.6 O assento — 12 chaves, sempre todas presentes

| Campo | Tipo | Descrição | Valores |
|---|---|---|---|
| `seat` | `string` \| `null` | **Designator normalizado**: fileira + coluna, sem separador | `"24A"` |
| `row` | `string` | Fileira | `"24"` |
| `column` | `string` \| `null` | Coluna | `"A"` |
| `status` | `string` | Estado do assento | `available` \| `occupied` \| `blocked` \| `unavailable` |
| `available` | `boolean` | **Derivado**: `status === "available"` | |
| `paid` | `boolean` | Marcar este assento exige pagamento | |
| `price` | `{currency, total}` \| `null` | `null` quando não há preço, ou ele é ≤ 0 | |
| `characteristics[]` | `string[]` | **Vocabulário canônico**, minúsculo com hífen. §1.7 | |
| `providerCharacteristics[]` | `string[]` | Códigos **crus** da companhia que não têm equivalente canônico. §1.7 | |
| `commercialName` | `string` \| `null` | Nome comercial da categoria, **cru da companhia** | `"Conforto"` |
| `accessible` | `boolean` \| `null` | Assento para pessoa com deficiência. **`null` = não informado** | |
| `recline` | `string` \| `null` | Restrição de reclinação | `"restricted"` \| `null` |

**Os quatro `status`:**

| Valor | Significa |
|---|---|
| `available` | Livre |
| `occupied` | **Tomado por outro passageiro** |
| `blocked` | **Bloqueado pela companhia** (fora de serviço, tripulação, reservado) |
| `unavailable` | Indisponível por outro motivo |

🔴 **Normalize o designator.** Companhias mandam `"15-A"`, `"15 A"`, `"15A"` — e às vezes formatos
diferentes no mapa e na confirmação da marcação. Emita **sempre** `"15A"`; sem isso, a comparação
entre o que foi pedido e o que foi confirmado nunca casa.

#### 1.7 Características: canônicas × cruas

O vocabulário canônico é fechado:

```
window · aisle · middle · exit · chargeable · extra-legroom · premium ·
overwing · restricted-recline · no-infant · accessible · preferred · restricted
```

**Tudo que não mapeia para um desses vai para `providerCharacteristics[]`, cru.**

A separação existe para que quem consome possa filtrar e traduzir pelo vocabulário fixo, **sem**
perder a informação que a companhia deu. Um código como `"ch"` ou `"leftsideofaircraft"`, que não
tem equivalente, sobrevive — mas não polui a lista canônica.

🔴 **`paid` segue o PREÇO, não o rótulo.** Uma companhia pode mandar a característica "cobrável" em
um assento cujo valor volta nulo. A característica diz o que ela **declara**; `paid` e `price` dizem
o que ela **cobrou nesta consulta**.

---

## 2. `POST /mark-seats` e `DELETE /remove-seats`

### 2.1 Request

```json
{
  "options": { "provider": "acme-air" },
  "markSeats": {
    "booking": { "locator": "ABC123" },
    "seats": [
      { "passengerId": "1.1", "segmentId": "1", "seat": "24A" }
    ],
    "payment": {
      "method": 2, "amount": 88.00, "currency": "BRL",
      "creditCard": { "brand": 1, "number": "4444333322221111", "cvv": "737",
                      "expiryDate": "03/2030", "installments": 1, "holderName": "JOAO SILVA" }
    }
  }
}
```

O bloco se chama `markSeats` numa rota e `removeSeats` na outra; o conteúdo é o mesmo.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `options.provider` | `string` | **sim** | |
| `<bloco>.booking` | `object` | **sim** | Endereço da reserva. `locator` basta na maioria |
| `<bloco>.seats[]` | `array` | **sim**, ≥1 | Os assentos a marcar/remover |
| `<bloco>.seats[].passengerId` | `string` \| `number` | **sim** | Copiado de `passengers[].id` do `/seat-map` |
| `<bloco>.seats[].segmentId` | `string` \| `number` | **sim** | Copiado de `segments[].segmentId` |
| `<bloco>.seats[].seat` | `string` | **sim** ao marcar; **não** ao remover | O designator, no formato do `/seat-map`. Na remoção é dispensável: o assento é único por passageiro+trecho |
| `<bloco>.payment` | `object` | condicional | Cartão, quando o assento é pago e a companhia cobra na marcação. §2.3 |
| `<bloco>.options.waiveRestrictedSeat` | `boolean` | não | Dispensa de restrição, quando a companhia permite |
| `<bloco>.options.waiveSeatFee` | `boolean` | não | Dispensa de taxa, quando a companhia permite |

**A referência de remoção é `passengerId` + `segmentId`.** É por isso que `seat` é opcional lá.

### 2.2 Response — o mesmo shape nas duas rotas

```json
{
  "success": true,
  "data": {
    "provider": "acme-air",
    "locator": "ABC123",
    "committed": true,
    "confirmed": null,
    "amount": null,
    "seats": [
      { "passengerId": "1.1", "segmentId": "1", "seat": "24A",
        "status": "assigned", "price": null, "message": null }
    ]
  },
  "meta": { "provider": "acme-air", "operation": "assignSeats",
            "correlationId": "req-seat-001", "timestamp": "2026-09-01T12:03:00.000Z" }
}
```

| Campo | Tipo | Significado exato |
|---|---|---|
| `provider` | `string` | |
| `locator` | `string` \| `null` | |
| `committed` | **`boolean`** | **A companhia aceitou o comando e gravou.** Nunca `null` |
| `confirmed` | **`boolean`** \| **`null`** | **Existe prova independente do efeito.** §2.4 |
| `amount` | `{currency, total}` \| `null` | **O valor efetivamente MOVIMENTADO**: cobrado ao marcar, devolvido ao remover. **`null` = a companhia não movimenta dinheiro nesta rota** |
| `seats[]` | `array` | **Um item por assento PEDIDO** — a espinha é o request, não a resposta da companhia |

`seats[]` item:

| Campo | Tipo | Descrição |
|---|---|---|
| `passengerId` | `string` \| `null` | Eco do pedido |
| `segmentId` | `string` \| `null` | Eco **do pedido**. §2.5 |
| `seat` | `string` \| `null` | Designator, maiúsculo |
| `status` | `string` | `assigned` (só ao marcar) \| `removed` (só ao remover) \| `failed` |
| `price` | `{currency, total}` \| `null` | Preço daquele assento, quando a companhia informa |
| `message` | `string` \| `null` | Motivo, quando `failed` |

🔴 **`amount` NÃO é o `payment.amount` do request.** O valor pedido é intenção; `amount` é o que
**aconteceu**. Se a companhia cobrou zero (assento grátis, ou já pago), `amount` é
`{currency, total: 0}` — objeto, não `null`. `null` é "não houve movimentação nenhuma nesta rota".

### 2.3 `payment` — assento pago

| Campo | Tipo | Descrição |
|---|---|---|
| `method` | `string` \| `number` | Forma de pagamento |
| `amount` / `currency` | `number` / `string` | Valor pretendido |
| `creditCard.brand` | `string` \| `number` | Bandeira |
| `creditCard.number` / `.cvv` / `.expiryDate` / `.holderName` | `string` | `expiryDate` no formato `MM/AAAA` |
| `creditCard.installments` | `integer` | |
| `creditCard.holderCpf` / `.holderEmail` / `.holderPhone` / `.holderBirthdate` | `string` | Conforme a companhia exige |
| `creditCard.address` | `object` | `{zipCode, city, street, country}` |

🔴 **Se a sua companhia NÃO cobra assento na marcação, recuse `payment` com 422
`BUSINESS_RULE_VIOLATION`** — não aceite e ignore. Nesse modelo, o assento pago fica **pendurado** e
é cobrado na emissão ([`11-emissao.md`](11-emissao.md)); aceitar o cartão aqui e não cobrar cria a
expectativa errada.

> **`payment: {}` vazio não é pagamento.** Formulários mandam objeto vazio por default. Só trate
> como pagamento um bloco com conteúdo de verdade.

### 2.4 🔴 `committed` × `confirmed` — o caso que originou a regra

Ver [`01-convencoes.md`](01-convencoes.md) §7 para a regra geral. Aqui está o caso concreto:

Uma companhia respondia `status="Complete"`, HTTP 200, sem nenhum erro — **e não gravava o
assento**. O detalhe estava num atributo de fim de transação que vinha `false`. O bug ficou
invisível por meses porque essa companhia **não ecoa o assento de volta**: se o código tivesse
carimbado `confirmed: true` a partir do `committed`, teria ficado invisível para sempre.

**Como derivar `confirmed` no seu provedor:**

| Situação | `confirmed` |
|---|---|
| A companhia **ecoa** o assento na resposta (devolve a lista, ou a reserva atualizada) | `true` / `false` conforme o eco |
| A companhia **não ecoa**, mas você **relê a reserva** depois e o assento está lá | `true` |
| Você releu e o assento **não** estava | `false` |
| A companhia não ecoa e **você não tem como reler** | **`null`** |
| A leitura de verificação **falhou** | `committed: false`, `confirmed: null`, todos os assentos `failed` |

🔴 **Resposta de mutação que "mente" existe.** Em pelo menos uma companhia, a resposta da remoção
declara sucesso quando não removeu e declara falha quando removeu. **Nessas, quem decide é a
releitura**, não a resposta. Se a sua se comporta assim, releia sempre.

### 2.5 `segmentId` na resposta: ecoe o do PEDIDO

Companhias podem usar chaves de trecho **diferentes** no mapa de assentos e na consulta da reserva —
por exemplo, o mapa com horários zerados e a reserva com horários reais, gerando strings distintas
para o mesmo voo.

**Ecoe o `segmentId` que veio no request.** Devolver o da reserva entrega a quem consome uma chave
que não casa com nada que ele tem na tela.

---

## 3. Variações

### Assento grátis × pago (no mapa)

| | `paid` | `price` | `characteristics` |
|---|---|---|---|
| Grátis | `false` | `null` | sem `chargeable` |
| Pago | `true` | `{currency, total}` | com `chargeable` |

Uma companhia que **nunca** precifica assento devolve `paid: false`, `price: null` em tudo, e
`data.currency: null`. Isso é legítimo.

### Companhia que ecoa × que não ecoa

| | `confirmed` |
|---|---|
| Ecoa lista por assento, ou devolve a reserva atualizada | `boolean` |
| Responde só "ok" | `null` — **a menos que você releia** |

### Capability inexistente

`/seat-map`, `/mark-seats` e `/remove-seats` são **independentes**. É comum uma companhia oferecer
mapa e marcação mas **não** remoção. Nesse caso, `/remove-seats` responde **501
`CAPABILITY_NOT_SUPPORTED`** — e a troca de assento fica impossível naquela companhia, o que é a
verdade.

🔴 **A checagem de capability roda ANTES da validação do corpo e de qualquer resolução de
credencial.** Invertida, a resposta seria "payload inválido" ou "credencial indisponível" — verdade
acidental que esconde o motivo real.

🔴 **Nenhuma das três devolve payload cru da companhia, nem como fallback.** Sem normalizador → 501.

---

## 4. Casos de borda

| Cenário | HTTP | `error.code` |
|---|---|---|
| Assento **ocupado por outro**, na leitura | **200** | — vem no mapa como `status: "occupied"`, `available: false` |
| **Passageiro já tem assento naquele trecho** (ao marcar) | **422** | `BUSINESS_RULE_VIOLATION`. Para trocar: remova antes |
| **Assento não consta no mapa** daquele trecho (ao marcar) | **422** | `BUSINESS_RULE_VIOLATION` — preço desconhecido. Marcar "de graça" um lugar que pode ser pago é o que isso evita |
| **Passageiro inexistente na reserva** | **422** | `BUSINESS_RULE_VIOLATION`. Verifique **antes** de gravar, comparando com os passageiros da reserva |
| **Designator malformado** (`"A12"`, `""`, `null`) | **422** | `BUSINESS_RULE_VIOLATION`, antes de chamar a companhia |
| **Pagamento inline onde a companhia não aceita** | **422** | `BUSINESS_RULE_VIOLATION` |
| **Remover assento que a reserva não declara** | **422** | `BUSINESS_RULE_VIOLATION`. **Liste na mensagem o que a reserva declara** — economiza uma ida e volta |
| **Reserva sem nenhum assento para remover** | **200** | `seats: []`, `committed: true`, `confirmed: true`, mensagem explicando |
| Passageiro **sem assento marcado**, na leitura | **200** | `assignedSeats: []` — e `null` é outra coisa (§1.5) |
| **Mapa ilegível / formato inesperado** | **200** | 🔴 **O normalizador do mapa NUNCA lança.** Degrade para `segments: []`, `passengers: []`, `currency: null` e registre no log. A interface mostra "indisponível" em vez de quebrar |
| Localizador inexistente | **404** | `RESOURCE_NOT_FOUND` |
| Companhia sem a operação | **501** | `CAPABILITY_NOT_SUPPORTED` |
| Companhia respondeu quebrado | **502** | `PROVIDER_INTEGRATION_ERROR` |
| Timeout | **504** | `PROVIDER_TIMEOUT` |

> A assimetria entre a leitura (degrada) e a mutação (falha) é deliberada: um mapa que não abre é um
> inconveniente; uma mutação que reporta sucesso sem gravar é um defeito grave.

---

## 5. Exemplos

### 5.1 `/seat-map` — request

```json
{
  "options": { "provider": "acme-air", "providerCurrency": null, "currency": "BRL" },
  "seatMap": { "booking": { "locator": "ABC123" } }
}
```

### 5.2 `/seat-map` — response (recorte de 1 trecho, 2 fileiras)

```json
{
  "success": true,
  "data": {
    "provider": "acme-air", "locator": "ABC123", "currency": "BRL", "paymentRequired": false,
    "passengers": [
      { "id": "PAX-0001", "firstName": "JOÃO", "lastName": "SILVA", "assignedSeats": [] }
    ],
    "segments": [
      {
        "segmentId": "1",
        "origin": "GRU", "destination": "REC", "departureDate": "2026-09-15",
        "number": "4232",
        "company": { "code": "G3", "name": null },
        "equipment": { "code": "32Q", "name": null },
        "cabins": [
          {
            "cabinClass": "Economy",
            "rows": [
              { "number": "1", "exitRow": false,
                "seats": [
                  { "seat": "1A", "row": "1", "column": "A",
                    "status": "available", "available": true,
                    "paid": true, "price": { "currency": "BRL", "total": 88.00 },
                    "characteristics": ["chargeable", "window", "extra-legroom"],
                    "providerCharacteristics": [],
                    "commercialName": "Conforto", "accessible": null, "recline": null },
                  { "seat": "1B", "row": "1", "column": "B",
                    "status": "blocked", "available": false,
                    "paid": false, "price": null,
                    "characteristics": ["middle", "extra-legroom"],
                    "providerCharacteristics": ["crewrest"],
                    "commercialName": "Conforto", "accessible": null, "recline": null }
                ] },
              { "number": "14", "exitRow": true,
                "seats": [
                  { "seat": "14A", "row": "14", "column": "A",
                    "status": "available", "available": true,
                    "paid": true, "price": { "currency": "BRL", "total": 55.00 },
                    "characteristics": ["chargeable", "window", "exit", "extra-legroom", "no-infant"],
                    "providerCharacteristics": ["leftsideofaircraft"],
                    "commercialName": "Saída de emergência", "accessible": false,
                    "recline": "restricted" },
                  { "seat": "14C", "row": "14", "column": "C",
                    "status": "occupied", "available": false,
                    "paid": false, "price": null,
                    "characteristics": ["aisle", "exit", "extra-legroom"],
                    "providerCharacteristics": [],
                    "commercialName": "Saída de emergência", "accessible": false,
                    "recline": "restricted" }
                ] }
            ]
          }
        ]
      }
    ]
  },
  "meta": { "provider": "acme-air", "duration": 1840, "timestamp": "2026-09-01T12:00:00.000Z" }
}
```

### 5.3 `/mark-seats` — request e response, companhia que NÃO ecoa

```json
{
  "options": { "provider": "acme-air" },
  "markSeats": {
    "booking": { "locator": "ABC123" },
    "seats": [ { "passengerId": "PAX-0001", "segmentId": "1", "seat": "6D" } ]
  }
}
```

```json
{
  "success": true,
  "data": {
    "provider": "acme-air", "locator": "ABC123",
    "committed": true, "confirmed": null, "amount": null,
    "seats": [ { "passengerId": "PAX-0001", "segmentId": "1", "seat": "6D",
                 "status": "assigned", "price": null, "message": null } ]
  },
  "meta": { "provider": "acme-air", "operation": "assignSeats",
            "correlationId": "req-seat-001", "timestamp": "2026-09-01T12:03:00.000Z" }
}
```

**`confirmed: null` não é sucesso comprovado.** Quem consome releva o `/seat-map` para confirmar.

### 5.4 `/mark-seats` — response, companhia que ECOA e cobrou zero

```json
{
  "success": true,
  "data": {
    "provider": "acme-air", "locator": "ABC123",
    "committed": true, "confirmed": true,
    "amount": { "currency": "BRL", "total": 0 },
    "seats": [ { "passengerId": "PAX-0001", "segmentId": "0", "seat": "15A",
                 "status": "assigned", "price": { "currency": "BRL", "total": 0 },
                 "message": null } ]
  },
  "meta": { "provider": "acme-air", "operation": "assignSeats",
            "correlationId": "req-seat-002", "timestamp": "2026-09-01T12:04:00.000Z" }
}
```

`amount` é **objeto com zero**, não `null`: houve movimentação, de valor zero.

### 5.5 `DELETE /remove-seats` — request e response

```json
{
  "options": { "provider": "acme-air" },
  "removeSeats": {
    "booking": { "locator": "ABC123" },
    "seats": [ { "passengerId": "PAX-0001", "segmentId": "0" } ]
  }
}
```

```json
{
  "success": true,
  "data": {
    "provider": "acme-air", "locator": "ABC123",
    "committed": true, "confirmed": true,
    "amount": { "currency": "BRL", "total": 0 },
    "seats": [ { "passengerId": "PAX-0001", "segmentId": "0", "seat": "15A",
                 "status": "removed", "price": null, "message": null } ]
  },
  "meta": { "provider": "acme-air", "operation": "removeSeats",
            "correlationId": "req-seat-003", "timestamp": "2026-09-01T12:06:00.000Z" }
}
```

### 5.6 Assento já ocupado pelo próprio passageiro — 422

```json
{
  "success": false,
  "error": { "code": "BUSINESS_RULE_VIOLATION", "category": "business_rule" },
  "message": "The operation violates a provider or business rule.",
  "correlationId": "req-seat-conflict-001",
  "provider": "acme-air",
  "providerError": {
    "provider": "acme-air", "operation": "assignSeats", "providerCode": null,
    "providerMessage": "Passenger already has a seat on this segment",
    "providerSeverity": null, "httpStatus": 200
  },
  "details": null,
  "metadata": { "operation": "assignSeats", "duration": 1120 }
}
```

### 5.7 Remoção sem capability — 501

```json
{
  "success": false,
  "error": { "code": "CAPABILITY_NOT_SUPPORTED", "category": "not_supported" },
  "message": "This provider does not support the requested operation.",
  "correlationId": "req-seat-cap-001",
  "provider": "acme-air", "details": null,
  "metadata": { "operation": "removeSeats" }
}
```

---

## 6. Checklist

- [ ] `/remove-seats` é **DELETE com corpo**.
- [ ] O `/seat-map` é a fonte de `passengerId`, `segmentId` e `seat` — copiados, nunca montados.
- [ ] Designator normalizado para `"24A"` em toda saída.
- [ ] `assignedSeats`: `null` quando a companhia não informa; `[]` quando informa que não há.
- [ ] Os 4 valores de `status` do assento, com `available` derivado de `status === "available"`.
- [ ] Característica sem equivalente canônico vai para `providerCharacteristics[]`, crua.
- [ ] `paid` segue o preço, não o rótulo.
- [ ] `committed` é o veredito da companhia; `confirmed` é **prova**, e `null` quando ela não existe.
- [ ] Falha de leitura → `committed: false`, `confirmed: null`, tudo `failed`.
- [ ] `amount` é o movimentado de verdade; zero é objeto, não `null`.
- [ ] `segmentId` da resposta ecoa o do **pedido**.
- [ ] Mapa ilegível **degrada**; mutação sem prova **falha**.
- [ ] Capability checada antes do corpo e da credencial.
