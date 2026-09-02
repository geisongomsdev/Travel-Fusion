# 08 — Consultar a reserva: `POST /retrieve`

Lê a reserva **ao vivo na companhia**. Não é etapa do funil de venda — é consulta avulsa, usada para:

- **reler o estado** antes e depois de marcar assento, emitir ou cancelar (é a leitura independente
  que prova o efeito das mutações — ver [`01-convencoes.md`](01-convencoes.md) §7);
- **importar** uma reserva feita fora da plataforma, para exibi-la e operá-la.

**Sem cache.** Toda chamada vai à companhia — o ponto da rota é saber o estado *agora*.

> Termo novo? Está no [`00-glossario.md`](00-glossario.md).

---

## 1. Request

```json
{
  "options": { "provider": "acme-air" },
  "booking": { "locator": "ABC123", "lastName": "Silva" }
}
```

### `options`

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `provider` | `string` | **sim** | Provedor da reserva |

### `booking` — o endereço da reserva

Bloco compartilhado com todas as rotas pós-reserva, com alguns campos extras que só esta usa:

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `locator` | `string` | **sim** | O localizador. **Todo provedor usa** |
| `bookingToken` | `string` | condicional | Quando a sua companhia endereça por token |
| `orderIdentifier` | `string` | condicional | Quando a sua companhia usa identificador de pedido |
| `source` | `string` | não | Fonte/sistema da reserva |
| `lastName` | `string` | não | Sobrenome do passageiro principal. Algumas companhias exigem como confirmação |
| `system` | `string` | não | Sistema/GDS, quando aplicável |
| `history` | `boolean` | não | Incluir histórico de eventos da reserva, quando a companhia oferece |
| `language` | `string` | não | Idioma repassado à companhia |

> **Campo desconhecido no bloco `booking` é ignorado, não recusado.** Este bloco é deliberadamente
> tolerante, porque cada companhia pede um conjunto diferente e quem consome manda o superconjunto.
> A raiz do request, ao contrário, é **fechada**: chave desconhecida ali → **400**.

---

## 2. Response

**HTTP 200.** O envelope tem chaves a mais que as demais rotas:

```json
{
  "success": true,
  "connector": "acme-air",
  "booking": "ABC123",
  "status": "found",
  "message": "Booking retrieved successfully",
  "data": { }
}
```

| Campo | Tipo | Sempre presente | Descrição |
|---|---|---|---|
| `success` | `true` | sim | |
| `connector` | `string` | sim | O provedor, exatamente como veio no request |
| `booking` | `string` | sim | Eco do `booking.locator` do request |
| `status` | `string` | sim | **Um único valor: `"found"`.** Qualquer outro cenário é erro, com `ErrorEnvelope` |
| `message` | `string` | sim | `"Booking retrieved successfully"` |
| `data` | `object` | sim | O conteúdo da reserva. §3 |

---

## 3. `data` — o conteúdo da reserva

**Todas as chaves existem sempre**, com `null` onde não há informação — exceto `fares`, cuja
**presença** carrega informação (§4.3).

### 3.1 Identidade e forma da viagem

| Campo | Tipo | Descrição | Valores |
|---|---|---|---|
| `status` | `string` \| `null` | **Estado de VENDA da reserva.** §4.1 | `confirmed` \| `pending` \| `cancelled` \| `null` |
| `type` | `string` | Literal | `"flight"` |
| `trip` | `string` \| `null` | Tipo de viagem, **derivado dos trechos** (§4.2) | `oneway` \| `roundtrip` \| `multicity` \| `null` |
| `grouping` | `string` \| `null` | Derivado 1:1 de `trip` | `segmented` (ida) \| `provider-group` (ida-e-volta) \| `multicity` \| `null` |
| `title` | `string` \| `null` | Rótulo legível da viagem: trechos unidos por `" / "`. `"GRU - REC / REC - GRU"` |
| `destination` | `Airport` \| `null` | Ida-e-volta: destino da **IDA**. Multidestino: destino do **último** trecho |
| `iata` | `object` \| `null` | `{from, to}` — origem do primeiro trecho e `destination.iata` |
| `departure` | `string` \| `null` | Partida do primeiro trecho, ISO-8601 |
| `arrival` | `string` \| `null` | Chegada do último trecho, ISO-8601 |
| `currency` | `string` \| `null` | Moeda da reserva |

### 3.2 Datas

| Campo | Tipo | Descrição |
|---|---|---|
| `createdAt` | `string` \| `null` | Quando a reserva foi criada na companhia |
| `expiresAt` | `string` \| `null` | **Prazo da reserva em espera** — depois disso a companhia a cancela sozinha |
| `confirmationAt` | `string` \| `null` | Quando foi confirmada. Cai em `createdAt` quando a companhia não distingue |

### 3.3 Provedor e localizadores

| Campo | Tipo | Descrição |
|---|---|---|
| `provider.code` | `string` \| `null` | O provedor |
| `provider.name` | `string` \| `null` | ⚠️ **Nome da COMPANHIA AÉREA do primeiro trecho**, não o nome do provedor. O nome do campo sugere o contrário |
| `provider.locator` | `string` \| `null` | O localizador devolvido pela companhia |
| `supplier.confirmation` | `string` \| `null` | **O localizador NA COMPANHIA AÉREA**, quando ele difere do do provedor. Num consolidador, são dois códigos diferentes e o passageiro precisa do da companhia no check-in |

### 3.4 `people[]` — os passageiros

Array **detalhado**.

| Campo | Tipo | Descrição | Valores |
|---|---|---|---|
| `main` | `boolean` | `true` **só no primeiro**. Bebê de colo é sempre `false` | |
| `name` | `string` \| `null` | `firstName + " " + lastName`. `null` se ambos vazios | |
| `firstName` / `lastName` | `string` \| `null` | | |
| `email` | `string` \| `null` | | |
| `phone` | `object` | `{country, area, number, type}` — todos `string` \| `null`. Quando a companhia não separa DDI/DDD, o número inteiro vai em `number` | |
| `nationality` | `string` \| `null` | | |
| `document` | `object` | `{type, number}` — `string` \| `null` | |
| `birthdate` | `string` \| `null` | **Normalizada para `YYYY-MM-DD`**, mesmo quando a companhia manda data-hora | |
| `age` | `integer` \| `null` | Derivada de `birthdate` no momento da consulta. `null` sem data | |
| `type` | `string` \| `null` | Categoria | `adult` \| `child` \| `infant` \| `null` |
| `ageGroup` | `string` \| `null` | **Sempre igual a `type`** | |
| `gender` | `string` \| `null` | | `male` \| `female` \| `null` |
| `loyalty` | `object` \| `null` | `{ "<IATA da companhia dona>": "<número>" }`. Programa não reconhecido → `null`, **nunca um palpite** | |

🔴 **Bebê de colo vira entrada PRÓPRIA.** As companhias costumam devolvê-lo aninhado no adulto
acompanhante. Na resposta ele é uma entrada em `people[]`, com `main: false`,
`type`/`ageGroup: "infant"`, `email: null` e `phone` todo `null`.

🔴 **Normalize `type` a partir do vocabulário da companhia**, que varia muito (`ADT`, `Adulto`,
`SENIOR`, `CHD`, `CNN`, `Criança`, `INF`, `Bebê`). Mapeie para os três valores canônicos; o que não
reconhecer é `null`, não um chute.

### 3.5 `segments` e `itinerary` — os trechos

**São mutuamente exclusivos**, e qual dos dois aparece depende do tipo de viagem:

| `trip` | `segments` | `itinerary` |
|---|---|---|
| `oneway` | `{ departure: [1 trecho], return: [] }` | `null` |
| `roundtrip` | `{ departure: [1 trecho], return: [1 trecho] }` | `null` |
| `multicity` | **`null`** | `{ id: null, airline, legs: [1 por trecho] }` |

🔴 **Num `oneway`, `segments.return` é `[]`** — array vazio, não `null`. É a exceção estrutural mais
comum do contrato.

**O trecho** (item de `segments.departure[]`, `segments.return[]` e `itinerary.legs[]`):

| Campo | Tipo | Descrição |
|---|---|---|
| `identifier` | `string` \| `null` | **Sempre `null` nesta rota.** É o token de OFERTA da busca; numa consulta ele não existe mais |
| `provider` | `string` \| `null` | |
| `company` | `object` | `{code, name}` |
| `origin` / `destination` | `Airport` | |
| `time.departure` / `time.arrival` | `string` \| `null` | ISO-8601 |
| `time.duration` | `integer` \| `null` | **Minutos** |
| `time.nextDay` | `boolean` \| `null` | `true` se a chegada é no dia seguinte. **`null` quando falta uma das duas datas** — não `false` |
| `stops` | `integer` \| `null` | Paradas do trecho (`flights.length - 1`) |
| `flights[]` | `array` | Sempre array. Ver abaixo |
| `fares[]` | `array` \| **chave ausente** | Só no modelo de trecho solto. §4.3 |

**O segmento** (item de `flights[]`): `number`, `connection` (`boolean`, default `false`),
`origin.{iata}`, `destination.{iata}`, `company.{code, name}`,
`time.{departure, arrival, duration}`, `equipment.{code, name, description}`.

`itinerary.airline` é o código IATA da companhia do primeiro trecho.

### 3.6 `fares[]` — as tarifas

| Campo | Tipo | Descrição |
|---|---|---|
| `appliesTo` | `"all"` \| `string[]` \| `null` | §4.3 |
| `name` | `string` \| `null` | Nome da família tarifária. `"Light"` |
| `fareCode` | `string` \| `null` | **Base tarifária**. `"UNJAAG2J"` |
| `bookingCode` | `string` \| `null` | **Classe de reserva (RBD)**. `"U"` |
| `familyCode` | `string` \| `null` | |
| `cabin` | `string` \| `null` | Cabine canônica. Derivada **só** do campo documentado como cabine, **nunca do RBD** |
| `baggage` | `Baggage` \| `null` | Ver [`01`](01-convencoes.md) §6. `null` quando a companhia não informa |
| `price.total` | `number` \| `null` | **Só na tarifa de pacote** (`appliesTo: "all"`). Na tarifa de trecho é **sempre `null`** — §4.3 |
| `fareId` / `code` | `string` \| `null` | **Sempre `null` nesta rota** — a consulta não devolve identificador de tarifa reutilizável |
| `refundable` / `changeable` | `boolean` \| `null` | **Sempre `null`** — a consulta não expõe as regras. Para o texto da regra, use [`13`](13-fare-rules-e-ping.md) |
| `price.adult` / `.child` / `.baby` | `null` | **Sempre `null`** — a consulta não decompõe por passageiro |

### 3.7 `fields` — tudo que a consulta traz e não tem lugar no shape acima

| Campo | Tipo | Descrição | Valores |
|---|---|---|---|
| `providerStatus` | `string` \| `null` | **Estado fino, normalizado.** §4.1 | `CONFIRMED` \| `HOLD` \| `TICKETED` \| `CANCELLED` \| `ERROR` \| string crua não reconhecida \| `null` |
| `system` | `string` \| `null` | Sistema/GDS da reserva | |
| `issueDate` | `string` \| `null` | Emissão da **reserva** (≠ emissão do bilhete, que está em `tickets[].issueDate`) | |
| `balanceDue` | `number` \| `null` | **Quanto falta pagar.** 🔴 `0` = quitado; `null` = a companhia não informa. A distinção é intencional | |
| `permissions` | `object` \| `null` | **Sempre as 6 chaves**, cada uma `boolean` \| `null`: `canIssue`, `canCancel`, `canRebook`, `canSelectSeats`, `canReissueCombined`, `canReissueWithFare` | |
| `contacts[]` | `array` | Sempre array. `{type, name, email, phone}`; `type` é `"passenger"` (derivado dos passageiros) ou o que a companhia informar. Deduplicado | |
| `tickets[]` | `array` | Sempre array. §3.8 | |
| `ancillaries[]` | `array` | Sempre array. §3.9 | |
| `pricing.currency` | `string` \| `null` | Moeda do total **da companhia** | |
| `pricing.total` | `number` \| `null` | **Total da companhia** — o que ela cobra pela reserva | |
| `pricing.breakdown[]` | `array` | Composição, no formato da companhia. `[]` quando não há | |

### 3.8 `fields.tickets[]` — os bilhetes

Exatamente 5 campos. Ausência é `null`, nunca omissão.

| Campo | Tipo | Descrição |
|---|---|---|
| `passengerId` | `string` \| `integer` \| `null` | O mesmo identificador do passageiro |
| `ticketNumber` | `string` \| `null` | Número do bilhete. **`null` quando a companhia não o expõe na consulta** — algumas só o dão numa rota de bilhete específica |
| `status` | `string` \| `null` | Como a companhia nomeia. `"ISSUED"`, `"Ativo"` |
| `issueDate` | `string` \| `null` | Emissão **do bilhete** |
| `cancelToken` | `string` \| `null` | Token que a anulação exige, quando a companhia trabalha assim. `null` onde ela anula pelo próprio número |

### 3.9 `fields.ancillaries[]` — os serviços extras

Serviço além do voo (assento pago, bagagem extra). **Documento, valor e status próprios** — ver
[`07`](07-cancel-booking.md) §4.

| Campo | Tipo | Descrição |
|---|---|---|
| `documentNumber` | `string` \| `null` | Número do documento do serviço |
| `type` | `string` \| `null` | **Como a companhia nomeia, sem tradução** |
| `description` | `string` \| `null` | |
| `status` | `string` \| `null` | Cru da companhia |
| `amount` | `number` \| `null` | Valor escalar |
| `currency` | `string` \| `null` | |
| `issueDate` | `string` \| `null` | |
| `passengerId` | `string` \| `null` | |
| `segmentIds[]` | `string[]` | **A referência do trecho como a COMPANHIA escreve** (o identificador interno dela), não a posição. `[]` quando não há |
| `seat` | `string` \| `null` | Só quando o serviço é assento |

---

## 4. As regras canônicas

### 4.1 🔴 O status é DUPLO, e as duas metades servem a públicos diferentes

| Campo | Vocabulário | Para quem |
|---|---|---|
| `data.status` | **de VENDA**: `confirmed` \| `pending` \| `cancelled` \| `null` | Quem decide o que fazer com a venda |
| `data.fields.providerStatus` | **fino, da companhia**, normalizado | Quem precisa do detalhe |

**O mapa de venda tem 4 entradas, e só 4:**

| Estado da companhia | `data.status` |
|---|---|
| Confirmada / reservada | `confirmed` |
| Emitida | `confirmed` |
| Em espera / pendente | `pending` |
| Cancelada | `cancelled` |
| **Qualquer outra coisa** | **`null`** |

🔴 **Fora do mapa → `null`.** Uma reserva `EXPIRED`, por exemplo, sai com `data.status: null` e
`providerStatus: "EXPIRED"`. Forçá-la para `cancelled` seria afirmar algo que a companhia não disse.

**Em `providerStatus`, normalize os sinônimos** (`BOOKED`→`CONFIRMED`, `HELD`/`PENDING`/`OPEN`→
`HOLD`, `ISSUED`→`TICKETED`, `CANCELED`→`CANCELLED`) e **repasse cru** o que você não reconhecer.

### 4.2 `trip` e `grouping` são DERIVADOS

A companhia raramente diz "isto é uma ida-e-volta". Derive:

| Trechos | `trip` | `grouping` |
|---|---|---|
| 1 | `oneway` | `segmented` |
| 2, **espelhados** (A→B e B→A) | `roundtrip` | `provider-group` |
| Qualquer outra combinação de 2+ | `multicity` | `multicity` |
| 0 | `null` | `null` |

**Quando a companhia devolve uma jornada só, com vários voos, e o destino final é a origem**, você
provavelmente tem uma ida-e-volta achatada. Procure o ponto de virada, com estes sinais somados:

- descontinuidade de escala (a chegada de um voo não é a origem do seguinte);
- mudança de data entre um voo e o próximo;
- intervalo longo (algumas horas) entre chegada e próxima partida.

Escolha o candidato com mais sinais; empate, o **último** índice. Com exatamente 2 voos encadeados
que voltam à origem, parta no índice 1.

**As duas pernas herdam a tarifa da viagem inteira** — nunca a tarifa da outra ponta.

### 4.3 🔴 Onde as tarifas vão — decidido pelo PROVEDOR, não por igualdade

Mesma regra posicional da busca ([`04`](04-availability-formatos.md) §6) e da reserva:

| Modelo | Onde a tarifa vai | `appliesTo` | `price.total` |
|---|---|---|---|
| **PACOTE** (o default; e **qualquer viagem de 1 trecho**) | **1 tarifa na raiz** (`data.fares[0]`). A chave `fares` **não aparece** dentro dos trechos | `"all"` | O total do provedor |
| **TRECHO SOLTO** | **1 tarifa por trecho**, em `segments[].fares` / `itinerary.legs[].fares`. **A raiz não é enviada** | Ida-e-volta: `["departure"]` / `["return"]`. Multidestino: `null` | 🔴 **Sempre `null`** |
| **Sem tarifa nenhuma** | `data.fares: null` (chave presente) | — | — |

🔴 **Duas regras que parecem detalhe e não são:**

1. **A escolha é do PROVEDOR, não da igualdade das tarifas.** Um provedor de trecho solto que
   devolveu a mesma tarifa nos dois trechos continua sendo trecho solto: publique as duas, uma por
   trecho. A repetição é o sinal de que **não** é pacote.
2. **No modelo de trecho solto, `price.total` da tarifa de trecho é SEMPRE `null`.** Ratear o total
   da reserva pelas pernas seria **inventar dinheiro**: você não sabe quanto de cada perna compõe o
   total, e um valor plausível na tela é pior que um campo vazio.

**Ao montar a tarifa de pacote a partir de trechos**, compare os campos entre as pernas
(`familyCode`, nome da família, cabine, classe de reserva, base tarifária, bagagem): **o que
coincidir em todas fica; o que divergir sai `null`.** Nunca escolha um dos valores.

### 4.4 Campos que são sempre `null`

Alguns campos existem porque este `data` reaproveita o vocabulário do request de **criação** de
reserva ([`06`](06-booking.md)) — assim quem importa uma reserva feita fora consegue reexibi-la e
operá-la com o mesmo código. Numa consulta eles não têm conteúdo:

`identifier` do trecho · `fareId` e `code` da tarifa · `refundable` e `changeable` ·
`price.adult` / `.child` / `.baby` · `provider.name` quando não há voo.

Nas tabelas acima eles estão marcados. Emita-os como `null` — a chave existe, o conteúdo não.

---

## 5. Variações

### 5.1 Ida, provedor de pacote

```jsonc
"trip": "oneway", "grouping": "segmented", "title": "GRU - REC",
"segments": { "departure": [ /* 1 trecho */ ], "return": [] },
"itinerary": null,
"fares": [ { "appliesTo": "all", "name": "Light", "fareCode": "UNJAAG2J",
             "bookingCode": "U", "cabin": "economy",
             "price": { "adult": null, "child": null, "baby": null, "total": 700.04 } } ]
// o trecho NÃO tem a chave "fares"
```

### 5.2 Ida-e-volta, provedor de pacote

```jsonc
"trip": "roundtrip", "grouping": "provider-group",
"title": "GRU - REC / REC - GRU",
"destination": { "iata": "REC", ... },        // destino da IDA
"segments": { "departure": [ /* 1 */ ], "return": [ /* 1 */ ] },
"itinerary": null,
"fares": [ { "appliesTo": "all", ... } ]       // na RAIZ; nenhum trecho tem "fares"
```

### 5.3 Ida-e-volta, provedor de trecho solto

```jsonc
// a chave "fares" NÃO existe na raiz
"segments": {
  "departure": [ { ..., "fares": [ { "appliesTo": ["departure"], "name": "Mais",
                                     "price": { "total": null } } ] } ],
  "return":    [ { ..., "fares": [ { "appliesTo": ["return"],    "name": "Mais",
                                     "price": { "total": null } } ] } ]
}
```

**Vale mesmo com as duas tarifas idênticas.**

### 5.4 Multidestino, provedor de pacote

```jsonc
"trip": "multicity", "grouping": "multicity",
"segments": null,
"itinerary": { "id": null, "airline": "G3", "legs": [ /* 1 por trecho */ ] },
"fares": [ { "appliesTo": "all", ... } ]       // na RAIZ; nenhum trecho tem "fares"
```

### 5.5 Multidestino, provedor de trecho solto

```jsonc
// a chave "fares" NÃO existe na raiz
"itinerary": { "id": null, "airline": "AD", "legs": [
  { ..., "fares": [ { "appliesTo": null, "name": "Light", "price": { "total": null } } ] },
  { ..., "fares": [ { "appliesTo": null, "name": "Plus",  "price": { "total": null } } ] }
] }
```

Repare que no multidestino de trecho solto o `appliesTo` é **`null`**, não `[0]`/`[1]` — a posição
no array já é o trecho.

### 5.6 🔴 Reserva CANCELADA — o caminho pobre

**Não é erro. É HTTP 200.** A companhia devolve a reserva **sem trechos**:

```json
{
  "success": true, "connector": "acme-air", "booking": "XYZ789",
  "status": "found", "message": "Booking retrieved successfully",
  "data": {
    "status": "cancelled",
    "trip": null, "grouping": null, "title": null,
    "destination": null, "iata": null,
    "segments": null, "itinerary": null, "fares": null,
    "departure": null, "arrival": null, "currency": null,
    "createdAt": "2026-07-20T12:05:00", "expiresAt": null, "confirmationAt": null,
    "people": [
      { "main": true, "name": "JOÃO SILVA", "firstName": "JOÃO", "lastName": "SILVA",
        "email": null, "phone": { "country": null, "area": null, "number": null, "type": null },
        "nationality": null, "document": { "type": "CPF", "number": "11122233344" },
        "birthdate": "1990-06-15", "age": 36, "type": "adult", "ageGroup": "adult",
        "gender": "male", "loyalty": null }
    ],
    "provider": { "code": "acme-air", "name": null, "locator": "XYZ789" },
    "supplier": { "confirmation": null },
    "fields": {
      "providerStatus": "CANCELLED",
      "system": "ACME_GWS", "issueDate": null, "balanceDue": null,
      "permissions": { "canIssue": false, "canCancel": false, "canRebook": false,
                       "canSelectSeats": false, "canReissueCombined": null,
                       "canReissueWithFare": null },
      "contacts": [ { "type": "passenger", "name": "JOÃO SILVA", "email": null, "phone": null } ],
      "tickets": [], "ancillaries": [],
      "pricing": { "currency": null, "total": null, "breakdown": [] }
    }
  }
}
```

Quase tudo `null`, `people` e `fields` úteis. É o formato de saída mais comum depois de um
cancelamento — e é ele que prova que o cancelamento funcionou.

---

## 6. Casos de borda

| Cenário | HTTP | `error.code` |
|---|---|---|
| Corpo inválido; chave desconhecida na raiz | **400** | `SEARCH_VALIDATION_ERROR` |
| **Localizador inexistente** | **404** | `RESOURCE_NOT_FOUND` |
| **Reserva cancelada** | **200** | — **não é erro**. §5.6 |
| Estado fora do vocabulário de venda | **200** | — `data.status: null` + `providerStatus` cru |
| A companhia não suporta consulta | **501** | `CAPABILITY_NOT_SUPPORTED` |
| A companhia respondeu quebrado | **502** | `PROVIDER_INTEGRATION_ERROR` |
| A companhia não respondeu no tempo | **504** | `PROVIDER_TIMEOUT` |

🔴 **Locator inexistente é 404, nunca um status chutado.** A tentação é devolver 200 com
`status: cancelled` ou `status: null` — mas "não existe" e "existe e está cancelada" são fatos
diferentes, e quem consome age diferente em cada um.

---

## 7. Exemplo completo — ida, reserva ativa

```json
{
  "success": true,
  "connector": "acme-air",
  "booking": "ABC123",
  "status": "found",
  "message": "Booking retrieved successfully",
  "data": {
    "status": "confirmed",
    "createdAt": "2026-07-20T12:05:00",
    "expiresAt": "2026-07-21T12:05:00",
    "confirmationAt": "2026-07-20T12:05:00",
    "type": "flight",
    "trip": "oneway",
    "grouping": "segmented",
    "title": "GRU - REC",
    "destination": { "iata": "REC", "code": "REC", "name": null, "city": "Recife",
                     "country": null, "coordinates": { "lat": -8.1264, "lng": -34.9236 } },
    "iata": { "from": "GRU", "to": "REC" },
    "departure": "2026-09-15T05:00:00-03:00",
    "arrival": "2026-09-15T08:05:00-03:00",
    "currency": "BRL",
    "people": [
      {
        "main": true, "name": "ANA SOUZA", "firstName": "ANA", "lastName": "SOUZA",
        "email": "ana.souza@example.com",
        "phone": { "country": "55", "area": "11", "number": "988887777", "type": "mobile" },
        "nationality": "BR",
        "document": { "type": "CPF", "number": "11122233344" },
        "birthdate": "1988-03-22", "age": 38,
        "type": "adult", "ageGroup": "adult", "gender": "female",
        "loyalty": { "G3": "396648991" }
      }
    ],
    "segments": {
      "departure": [
        {
          "identifier": null,
          "provider": "acme-air",
          "company": { "code": "G3", "name": "Acme Air" },
          "origin":      { "iata": "GRU", "code": "GRU", "name": null, "city": "São Paulo",
                           "country": null, "coordinates": { "lat": -23.4356, "lng": -46.4731 } },
          "destination": { "iata": "REC", "code": "REC", "name": null, "city": "Recife",
                           "country": null, "coordinates": { "lat": -8.1264, "lng": -34.9236 } },
          "time": { "departure": "2026-09-15T05:00:00-03:00",
                    "arrival": "2026-09-15T08:05:00-03:00",
                    "duration": 185, "nextDay": false },
          "stops": 0,
          "flights": [
            { "number": "4232", "connection": false,
              "origin": { "iata": "GRU" }, "destination": { "iata": "REC" },
              "company": { "code": "G3", "name": "Acme Air" },
              "time": { "departure": "2026-09-15T05:00:00-03:00",
                        "arrival": "2026-09-15T08:05:00-03:00", "duration": 185 },
              "equipment": { "code": "32Q", "name": "Airbus A320neo", "description": null } }
          ]
        }
      ],
      "return": []
    },
    "itinerary": null,
    "fares": [
      {
        "fareId": null, "code": null,
        "appliesTo": "all",
        "name": "light", "fareCode": "UNJAAG2J", "bookingCode": "U", "familyCode": "lig",
        "cabin": "economy",
        "refundable": null, "changeable": null,
        "baggage": {
          "hand": { "included": true,  "pieces": 1, "weight": 10, "unit": "kg", "description": null },
          "hold": { "included": false, "pieces": 0, "weight": 0,  "unit": "kg",
                    "description": null, "type": "checked" }
        },
        "price": { "adult": null, "child": null, "baby": null, "total": 700.04 }
      }
    ],
    "provider": { "code": "acme-air", "name": "Acme Air", "locator": "ABC123" },
    "supplier": { "confirmation": "XKPQ2M" },
    "fields": {
      "providerStatus": "CONFIRMED",
      "system": "ACME_GWS",
      "issueDate": null,
      "balanceDue": 700.04,
      "permissions": { "canIssue": true, "canCancel": true, "canRebook": false,
                       "canSelectSeats": true, "canReissueCombined": null,
                       "canReissueWithFare": null },
      "contacts": [
        { "type": "passenger", "name": "ANA SOUZA", "email": "ana.souza@example.com",
          "phone": "11988887777" }
      ],
      "tickets": [],
      "ancillaries": [],
      "pricing": {
        "currency": "BRL", "total": 700.04,
        "breakdown": [
          { "passengerType": "ADT", "quantity": 1, "base": 618.00, "taxes": 82.04, "total": 700.04 }
        ]
      }
    }
  }
}
```

---

## 8. Checklist

- [ ] `status` de venda tem **4 valores**; o que não estiver no mapa vira `null`.
- [ ] `providerStatus` normaliza sinônimos e **repassa cru** o que não reconhece.
- [ ] `segments.return: []` num `oneway` (array vazio, não `null`).
- [ ] `segments` e `itinerary` são mutuamente exclusivos.
- [ ] Bebê de colo vira **entrada própria** em `people[]`.
- [ ] `birthdate` normalizada para `YYYY-MM-DD`.
- [ ] Tarifa na raiz (pacote) **ou** no trecho (solto) — nunca as duas.
- [ ] No modelo de trecho solto, `price.total` da tarifa de trecho é **`null`** — não rateio.
- [ ] Ao mesclar tarifas de trechos num pacote, campo divergente vira `null`.
- [ ] `balanceDue: 0` ≠ `balanceDue: null`.
- [ ] `tickets` e `ancillaries` são **sempre arrays**.
- [ ] Locator inexistente → **404**, nunca status chutado.
- [ ] Reserva cancelada → **200** com o caminho pobre.
