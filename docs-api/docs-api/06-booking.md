# 06 — Reservar: `POST /booking`

Cria a reserva na companhia. **A chamada é síncrona**: a resposta já traz o resultado — não há
consulta posterior para saber se deu certo.

**Guarde tudo que a resposta devolver.** É a partir daqui que todas as rotas seguintes endereçam a
reserva.

> Termo novo? Está no [`00-glossario.md`](00-glossario.md).

---

## 1. Como o corpo se monta

```
┌───────────────────────────────────────────────────────────────┐
│  provider        →  a companhia                               │
│  trip            →  oneway | roundtrip | multicity            │
│  customer        →  quem compra (contato da reserva)          │
│  people[]        →  quem viaja                                │
│  segments        →  COPIADOS DA BUSCA, inteiros  (OW/RT)      │
│  itinerary.legs  →  COPIADOS DA BUSCA, inteiros  (MC)         │
│  fares[]         →  a tarifa escolhida                        │
│  displayedTotal  →  o total que você exibiu ao cliente        │
└───────────────────────────────────────────────────────────────┘
```

Os trechos e a tarifa vêm **da busca**, copiados como vieram. Não remonte, não recalcule: os
identificadores opacos precisam voltar idênticos ([`01`](01-convencoes.md) §4).

---

## 2. Request

`POST /booking`, `Content-Type: application/json`.

### 2.1 Raiz

| Campo | Tipo | Obrigatório | Descrição | Valores |
|---|---|---|---|---|
| `provider` | `string` | **sim** | A companhia desta reserva | |
| `trip` | `string` | **sim** | Tipo de viagem. **Define qual validação se aplica** | `oneway` \| `roundtrip` \| `multicity` |
| `customer` | `object` | **sim** | O comprador / contato da reserva. §2.2 | |
| `people[]` | `array` | **sim**, ≥1 | Os viajantes. §2.3 | |
| `segments` | `object` | **sim** em `oneway` / `roundtrip` | `{departure[], return[]}`. §2.5 | |
| `itinerary` | `object` | **sim** em `multicity` | `{legs[]}`. §2.5 | |
| `fares[]` | `array` | **posicional** — §3 | A tarifa escolhida. **Onde ela vai é o assunto da §3** | |
| `selectedFareId` | `string` | não | Qual tarifa de `fares[]` foi escolhida. Tem que existir na lista — não casar é **falha**, nunca cai numa outra | |
| `displayedTotal` | `number` | recomendado | **O total que você exibiu ao cliente.** É a âncora do gate de re-tarifa (§4) | |
| `ancillaries[]` | `array` | não | Bagagem/extras a pendurar junto com a reserva | |
| `payment` | `object` | não | Bloco de pagamento, quando a companhia o exige já na criação | |
| `options.currency` | `string` | não | | `BRL` \| `USD` \| `EUR` |
| `options.language` | `string` | não | | `pt-br` \| `en-us` \| `es-es` |

### 2.2 `customer` — o comprador

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `email` | `string` (email) | **sim** | Contato da reserva. Ver o aviso abaixo |
| `firstName` / `lastName` | `string` | não | |
| `name` | `string` | não | Nome completo, alternativa aos dois acima |
| `phone` | `ContactPhone` | não | Ver [`01`](01-convencoes.md) §6 |
| `document` | `Document` | não | Ver [`01`](01-convencoes.md) §6 |
| `address` | `object` | não | `{street, city, state, zipCode, postal, country}` |
| `country` | `string` | não | `"BR"` |
| `birthdate` | `string` | não | `YYYY-MM-DD`. A grafia `birthDate` também é aceita |
| `gender` | `string` | não | `male` \| `female`. Valor fora do enum → **400** |

> ⚠️ **Sobre o e-mail e o nome, um aviso que veio de dois dias reais de investigação:** companhias
> validam o **conteúdo** desses campos, não só o formato, e algumas devolvem a **mesma mensagem
> genérica** para causas diferentes. Foi medido: um domínio de e-mail corporativo específico era
> recusado (domínio público passava), e um nome contendo a palavra `TEST` era bloqueado — as duas
> coisas com a mesma frase, que não apontava nenhuma das duas.
>
> Repetir a **mesma reserva** também costuma ser recusado ("já existe reserva igual"). Ao testar,
> troque o passageiro entre execuções.

### 2.3 `people[]` — os viajantes

| Campo | Tipo | Obrigatório | Descrição | Valores |
|---|---|---|---|---|
| `identifier` | `string` | **sim** | **Identificador do passageiro nesta reserva.** É por ele que as rotas de assento e de serviço extra o endereçam depois | |
| `firstName` | `string` | **sim** | | |
| `lastName` | `string` | **sim** | | |
| `ageGroup` **ou** `type` | `string` | **sim** (um dos dois) | Categoria do passageiro | `adult` \| `senior` \| `child` \| `infant` |
| `main` | `boolean` | não | `true` no passageiro principal | |
| `gender` | `string` | condicional | **Várias companhias recusam sem** | `male` \| `female` |
| `birthdate` | `string` | condicional | `YYYY-MM-DD`. **Várias companhias recusam sem**. A grafia `birthDate` também é aceita | |
| `document` | `Document` | condicional | **Exigido por várias companhias.** CPF precisa dos 11 dígitos | |
| `email` | `string` \| `null` | não | | |
| `phone` | `ContactPhone` | não | | |
| `country` | `string` | não | | |
| `nationality` | `string` | não | | |
| `loyalty` | `object` \| `null` | não | Programa de fidelidade. §2.4 | |
| `infantInfo` | `object` \| `null` | não | **Bebê de colo** viajando no colo deste adulto: `{firstName, lastName, gender, birthdate, document}` | |

> 🔴 **Campos "opcionais" que a companhia exige.** O contrato marca `gender`, `birthdate` e
> `document` como opcionais porque nem toda companhia os pede. A sua provavelmente pede pelo menos
> um. **Valide na sua camada e recuse com 400** antes de chamar a companhia — um 400 seu dizendo o
> que falta é muito melhor que o erro genérico dela.

**Bebê de colo:** pode vir de duas formas, e aceite as duas — como entrada própria em `people[]` com
`ageGroup: "infant"`, ou aninhado no adulto acompanhante em `infantInfo`. Quando a companhia exige o
vínculo bebê→adulto, o `infantInfo` é o que o expressa.

### 2.4 `people[].loyalty` — fidelidade

Mapa `{ código IATA da companhia dona do programa: número }`:

```json
"loyalty": { "G3": "396648991", "AD": "1234567", "G3corp": "998877" }
```

| Regra | Detalhe |
|---|---|
| **Chave** | Código IATA de **2 caracteres alfanuméricos com pelo menos 1 letra**, da companhia **dona** do programa |
| **Sufixo `corp`** | Programa **corporativo** — os pontos creditam na empresa, não na pessoa. `G3corp` |
| **Valor** | `string` \| `number` \| `null`, ou `{ number, owner }` onde `owner` ∈ `passenger` \| `company` |
| **`owner` do valor vence o da chave**, nos dois sentidos | |
| **Chave fora do padrão** | → **400** |
| **Valor vazio, zerado ou lixo** (`""`, `0`, `"---"`) | Descartado **sem erro** |
| **Dedupe** | Por companhia + dono; a última ocorrência vence |

🔴 **Bloco acessório: nunca derruba a reserva.** Um cartão que a companhia não reconhece é
**removido antes do request**, e a venda segue. Uma venda paga não pode morrer por causa de um
número de fidelidade.

### 2.5 Os trechos

| `trip` | Onde os trechos vão |
|---|---|
| `oneway` | `segments.departure[]` (≥1). **`segments.return` ausente ou vazio** |
| `roundtrip` | `segments.departure[]` + `segments.return[]` |
| `multicity` | `itinerary.legs[]` — **um item por trecho, na ordem. A posição é o trecho** |

**Copie da busca.** O shape do trecho é o mesmo do `/availability` ([`03`](03-availability.md) §3.1):

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `identifier` | `string` | **sim** | **O identificador opaco da busca.** É ele que endereça a oferta na companhia |
| `company` | `object` | não | `{code, name}` |
| `origin` / `destination` | `Airport` | não | |
| `time` | `FlightTime` | não | |
| `flights[]` | `array` | não | Os segmentos, com `number`, `cabin`, `equipment` e `fareSelection` |
| `fares[]` | `array` | condicional | A tarifa **deste trecho** — só no modelo de trecho solto. §3 |
| `fees[]` | `array` | não | |

### 🔴 `itinerary.legs` na reserva é de UMA dimensão

Diferente da busca. Lá, `legs[i]` é uma **lista de opções** de horário; aqui o cliente **já
escolheu**, então `legs[i]` é **o trecho escolhido**, direto:

```json
"itinerary": {
  "legs": [
    { "identifier": "ACME-MC-L0-A", "origin": { "iata": "POA" }, ... },
    { "identifier": "ACME-MC-L1-A", "origin": { "iata": "GRU" }, ... }
  ]
}
```

**A posição continua sendo o trecho.**

### 2.6 A tarifa (`fares[]`)

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `fareId` | `string` \| `null` | condicional | O `fareId` da busca. **Pode ser `null`** em provedores que não identificam a tarifa separadamente — aí quem endereça é o `identifier` do trecho |
| `appliesTo` | `"all"` \| `string[]` \| `integer[]` | **sim** | A quais trechos esta tarifa se aplica. §3 |
| `familyCode` / `family` / `code` / `name` | `string` | não | |
| `fareCode` | `string` | não | Base tarifária |
| `bookingClass` | `string` | não | Classe de reserva (RBD) |
| `cabin` | `string` | não | Cabine canônica |
| `seats` | `integer` \| `null` | não | |
| `price` | `object` | não | Mesmo shape do `fares[].price` da busca ([`03`](03-availability.md) §3.4) |
| `baggage` / `benefits` / `refundable` / `changeable` | | não | Copiados da busca |

> ⚠️ **`fare` (singular) dentro do trecho não tem efeito.** Só `fares[]` (array) é lido. Os nomes são
> quase idênticos e as semânticas, opostas.

---

## 3. 🔴 Onde a tarifa vai — a regra posicional

**A POSIÇÃO do `fares[]` é a resposta. Nunca os dois lugares ao mesmo tempo.**

| Cenário | Trechos ficam em | `fares[]` fica em | `appliesTo` |
|---|---|---|---|
| **Ida** | `segments.departure[]` | **raiz** do request | `"all"` |
| **Ida-e-volta, provedor de PACOTE** | `segments.departure[]` + `segments.return[]` | **raiz**, uma tarifa só | `"all"` |
| **Ida-e-volta, provedor de TRECHO SOLTO** | idem | **dentro de cada trecho**: `segments.departure[0].fares` e `segments.return[0].fares`. **A raiz nem é enviada** | `["departure"]` / `["return"]` |
| **Multidestino, PACOTE** | `itinerary.legs[]` | **raiz** (ou `itinerary.fares`) | `"all"` |
| **Multidestino, TRECHO SOLTO** | `itinerary.legs[]` | **dentro de cada trecho**: `itinerary.legs[i].fares` | `[0]`, `[1]`, `[2]` |

É a mesma regra da busca ([`04`](04-availability-formatos.md) §6), aplicada ao request. Se você
publicou um pacote na busca, receba a tarifa na raiz aqui; se publicou trecho solto, receba dentro
do trecho.

### Validação cruzada — o que recusar com 400

- Sem `segments.departure` **e** sem `itinerary.legs`;
- `trip: "multicity"` com zero trechos em `itinerary.legs`;
- `trip` diferente de `multicity` com `segments.departure` vazio;
- `trip: "oneway"` com `segments.return` preenchido;
- `fares[]` na raiz **e** dentro dos trechos ao mesmo tempo.

---

## 4. O gate de re-tarifa

Antes de criar a reserva, **reconfira o preço na companhia** e compare com `displayedTotal`.

| Resultado | O que fazer |
|---|---|
| Preço **igual** | Reserva normalmente |
| Preço **subiu** | **409 `FARE_PRICE_CHANGED`.** Não reserve — o cliente veria um valor e pagaria outro |
| Preço **caiu** | Reserva normalmente. A diferença é a favor de quem comprou |
| Tarifa **sumiu** | **409 `FARE_UNAVAILABLE`** |

🔴 **O gate é por DISPONIBILIDADE, não só por delta de preço.** A pergunta é "esta combinação ainda
existe e ainda custa o que eu disse?". Uma tarifa que sumiu não é uma variação de preço — é outro
erro, com outra ação do lado de quem consome.

Se `displayedTotal` não vier, você não tem âncora: reserve pelo preço atual.

---

## 5. Response

**HTTP 201.**

```json
{
  "success": true,
  "data": {
    "locator": "ABC123",
    "status": "CONFIRMED",
    "provider": "acme-air",
    "bookingToken": "acme-token-77321",
    "orderIdentifier": "ACME-ORD-77321",
    "raw": { "providerResponseId": "acme-resp-99001" }
  },
  "meta": {
    "provider": "acme-air", "operation": "createBooking",
    "correlationId": "req-booking-001", "duration": 3154,
    "timestamp": "2026-05-09T12:02:00.000Z"
  }
}
```

`data` sai **no formato da companhia**, por design. Esta rota é a exceção ao canônico: ela devolve o
localizador e o retorno cru da reserva, porque cada companhia carrega ali informação própria que se
perderia numa normalização.

### 🔴 Os quatro valores que PRECISAM estar no topo do `data`

Estes endereçam todas as rotas seguintes. **Ponha-os no topo, com estes nomes**, mesmo que a
companhia os chame de outra coisa mais fundo:

| Campo | Tipo | Para quê |
|---|---|---|
| `locator` | `string` | O PNR. Vira `booking.locator` em **todas** as rotas pós-reserva |
| `status` | `string` | Estado da reserva na companhia |
| `bookingToken` | `string` \| `null` | Quando a sua companhia endereça a reserva por um token além do localizador |
| `orderIdentifier` | `string` \| `null` | Quando a sua companhia usa um identificador de pedido separado — **sem ele, algumas fontes não encontram a reserva depois** |

Se a sua companhia não tem `bookingToken` ou `orderIdentifier`, emita `null` — a chave existe.

O restante do retorno cru pode ficar sob `raw` (ou solto no `data`, à sua escolha).

> **Por que insistir nisso:** um `data` cujo localizador está num caminho diferente por companhia
> obriga quem consome a escrever um caso por integração. É exatamente o que este exercício quer
> evitar.

---

## 6. Casos de borda

| Cenário | HTTP | `error.code` |
|---|---|---|
| Corpo inválido; `trip` incoerente com os trechos; passageiro sem `firstName`/`lastName`/`ageGroup`; `fares[]` nos dois lugares | **400** | `SEARCH_VALIDATION_ERROR` |
| Chave de fidelidade fora do padrão | **400** | `SEARCH_VALIDATION_ERROR` |
| A tarifa sumiu na hora de reservar | **409** | `FARE_UNAVAILABLE` |
| O preço subiu desde a cotação | **409** | `FARE_PRICE_CHANGED` |
| A companhia recusou por regra dela | **422** | `BUSINESS_RULE_VIOLATION` |
| A companhia não suporta reserva | **501** | `CAPABILITY_NOT_SUPPORTED` |
| A companhia respondeu quebrado | **502** | `PROVIDER_INTEGRATION_ERROR` |
| A companhia não respondeu no tempo | **504** | `PROVIDER_TIMEOUT` |
| Reserva gravou parcialmente **e o desfazer também falhou** → sobrou reserva viva | **409** | `BOOKING_PARTIAL_FAILURE`. **409, não 502**: 502 diz "retente", leitura errada quando existe uma reserva de verdade lá fora |

### 🔴 Anti-sucesso-falso

**HTTP 200 e ausência de erro NÃO provam que a reserva existe.** Ver
[`01-convencoes.md`](01-convencoes.md) §7.

Se a resposta da sua companhia contiver marcadores de recusa embutidos num sucesso — um campo de fim
de transação em `false`, um nó de erro no meio do payload, um status "não processado" — **o parser
tem que LANÇAR**, não avisar.

E se a companhia não devolve o localizador de forma inequívoca, **releia a reserva** antes de
responder 201. Uma reserva reportada como criada e que não existe é o pior defeito possível: o
cliente recebe uma confirmação e chega ao aeroporto sem passagem.

---

## 7. Exemplos

### 7.1 Ida, provedor de pacote — request

```json
{
  "provider": "acme-air",
  "trip": "oneway",
  "customer": {
    "firstName": "João", "lastName": "Silva",
    "email": "joao.silva@example.com",
    "country": "BR",
    "document": { "type": "CPF", "number": "11122233344", "nationality": "BR" },
    "birthdate": "1990-06-15",
    "gender": "male",
    "phone": { "country": "55", "area": "11", "number": "988887777", "type": "mobile" }
  },
  "people": [
    {
      "identifier": "pax-adult-1",
      "main": true,
      "firstName": "João", "lastName": "Silva",
      "email": "joao.silva@example.com",
      "country": "BR", "nationality": "BR",
      "document": { "type": "CPF", "number": "11122233344", "nationality": "BR" },
      "birthdate": "1990-06-15", "gender": "male",
      "type": "adult", "ageGroup": "adult",
      "phone": { "country": "55", "area": "11", "number": "988887777", "type": "mobile" },
      "loyalty": { "G3": "396648991" }
    }
  ],
  "segments": {
    "departure": [
      {
        "identifier": "ACME-OW-GRU-REC-0001",
        "company": { "code": "G3", "name": "Acme Air" },
        "origin":      { "iata": "GRU", "city": "São Paulo", "terminal": "3",
                         "coordinates": { "lat": -23.4356, "lng": -46.4731 } },
        "destination": { "iata": "REC", "city": "Recife", "terminal": null,
                         "coordinates": { "lat": -8.1264, "lng": -34.9236 } },
        "time": { "departure": "2026-06-12T08:20:00-03:00",
                  "arrival": "2026-06-12T11:25:00-03:00", "duration": 185 },
        "stops": 0,
        "flights": [
          { "segment": 0, "number": "1234", "connection": false, "cabin": "economy",
            "company": { "code": "G3", "name": "Acme Air", "operating": null },
            "origin": { "iata": "GRU", "city": "São Paulo", "terminal": "3",
                        "coordinates": { "lat": -23.4356, "lng": -46.4731 } },
            "destination": { "iata": "REC", "city": "Recife", "terminal": null,
                             "coordinates": { "lat": -8.1264, "lng": -34.9236 } },
            "time": { "departure": "2026-06-12T08:20:00-03:00",
                      "arrival": "2026-06-12T11:25:00-03:00", "duration": 185 },
            "equipment": { "code": "738", "name": "Boeing 737-800", "description": null } }
        ],
        "fees": []
      }
    ]
  },
  "fares": [
    {
      "fareId": "ACME-FARE-LIGHT-0001",
      "appliesTo": "all",
      "code": "LIGHT", "name": "Light",
      "familyCode": "LIGHT", "family": "Light",
      "fareCode": "ONJAAG2J", "bookingClass": "O",
      "cabin": "economy", "seats": 4,
      "refundable": false, "changeable": true,
      "baggage": {
        "hand": { "included": true,  "pieces": 1, "weight": 10, "unit": "kg", "description": null },
        "hold": { "included": false, "pieces": 0, "weight": 0,  "unit": "kg",
                  "description": null, "type": "checked" }
      },
      "price": {
        "adult": { "base": 245.00,
                   "taxes": { "boarding": 35.75, "service": 0, "fuel": 0, "baggage": 0 },
                   "fees": 12.00, "total": 292.75 },
        "child": null, "baby": null,
        "total": { "base": 245.00,
                   "taxes": { "boarding": 35.75, "service": 0, "fuel": 0, "baggage": 0 },
                   "fees": 12.00, "total": 292.75, "currency": "BRL" }
      }
    }
  ],
  "selectedFareId": "ACME-FARE-LIGHT-0001",
  "displayedTotal": 292.75,
  "options": { "currency": "BRL", "language": "pt-br" }
}
```

**Response**

```json
{
  "success": true,
  "data": { "locator": "ABC123", "status": "CONFIRMED", "provider": "acme-air",
            "bookingToken": "acme-token-77321", "orderIdentifier": null,
            "raw": { "providerResponseId": "acme-resp-99001" } },
  "meta": { "provider": "acme-air", "operation": "createBooking",
            "correlationId": "req-booking-001", "duration": 3154,
            "timestamp": "2026-05-09T12:02:00.000Z" }
}
```

### 7.2 Ida-e-volta, provedor de pacote — tarifa na RAIZ

```jsonc
{
  "provider": "acme-air",
  "trip": "roundtrip",
  "customer": { /* … */ },
  "people": [ /* … */ ],
  "segments": {
    "departure": [ { "identifier": "ACME-RT-DEP-0001",
                     "company": { "code": "G3", "name": "Acme Air" },
                     "origin": { "iata": "GRU" }, "destination": { "iata": "REC" },
                     "time": { "departure": "2026-06-12T08:20:00-03:00",
                               "arrival": "2026-06-12T11:25:00-03:00", "duration": 185 },
                     "flights": [ /* … */ ], "fees": [] } ],
    "return":    [ { "identifier": "ACME-RT-RET-0001",
                     "company": { "code": "G3", "name": "Acme Air" },
                     "origin": { "iata": "REC" }, "destination": { "iata": "GRU" },
                     "time": { "departure": "2026-06-19T17:40:00-03:00",
                               "arrival": "2026-06-19T20:55:00-03:00", "duration": 195 },
                     "flights": [ /* … */ ], "fees": [] } ]
    // ← nenhum trecho tem "fares"
  },
  "fares": [ { "fareId": "ACME-RT-LIGHT-01", "appliesTo": "all",
               "family": "Light", "familyCode": "LIGHT", "cabin": "economy",
               "price": { "total": { "total": 1280.45, "currency": "BRL" } } } ],
  "selectedFareId": "ACME-RT-LIGHT-01",
  "displayedTotal": 1280.45
}
```

### 7.3 Ida-e-volta, provedor de trecho solto — tarifa DENTRO do trecho

```jsonc
{
  "provider": "acme-air",
  "trip": "roundtrip",
  "customer": { /* … */ },
  "people": [ /* … */ ],
  "segments": {
    "departure": [ { "identifier": "ACME-DEP-0001", /* … */
                     "fares": [ { "fareId": "ACME-DEP-MZL", "appliesTo": ["departure"],
                                  "family": "Mais", "cabin": "economy",
                                  "price": { "total": { "total": 656.20, "currency": "BRL" } } } ] } ],
    "return":    [ { "identifier": "ACME-RET-0001", /* … */
                     "fares": [ { "fareId": "ACME-RET-MZL", "appliesTo": ["return"],
                                  "family": "Mais", "cabin": "economy",
                                  "price": { "total": { "total": 618.20, "currency": "BRL" } } } ] } ]
  },
  // ← NÃO existe "fares" na raiz
  "displayedTotal": 1274.40
}
```

### 7.4 Multidestino, provedor de pacote

```jsonc
{
  "provider": "acme-air",
  "trip": "multicity",
  "customer": { /* … */ },
  "people": [ /* … */ ],
  "itinerary": {
    "legs": [
      { "identifier": "ACME-MC-L0-A", "origin": { "iata": "POA" }, "destination": { "iata": "GRU" },
        "time": { "departure": "2026-06-10T06:10:00-03:00" }, "flights": [ /* … */ ] },
      { "identifier": "ACME-MC-L1-A", "origin": { "iata": "GRU" }, "destination": { "iata": "SSA" },
        "time": { "departure": "2026-06-14T10:10:00-03:00" }, "flights": [ /* … */ ] }
      // ← nenhum trecho tem "fares"
    ]
  },
  "fares": [ { "fareId": "ACME-MC-PKG-LIGHT", "appliesTo": "all",
               "family": "Light", "cabin": "economy",
               "price": { "total": { "total": 2450.00, "currency": "BRL" } } } ],
  "displayedTotal": 2450.00
}
```

### 7.5 Multidestino, provedor de trecho solto

```jsonc
{
  "provider": "acme-air",
  "trip": "multicity",
  "customer": { /* … */ },
  "people": [ /* … */ ],
  "itinerary": {
    "legs": [
      { "identifier": "ACME-LOOSE-L0-A", "origin": { "iata": "POA" }, "destination": { "iata": "GRU" },
        "fares": [ { "fareId": "ACME-L0-LIGHT", "appliesTo": [0], "family": "Light",
                     "price": { "total": { "total": 480.00, "currency": "BRL" } } } ] },
      { "identifier": "ACME-LOOSE-L1-A", "origin": { "iata": "GRU" }, "destination": { "iata": "SSA" },
        "fares": [ { "fareId": "ACME-L1-LIGHT", "appliesTo": [1], "family": "Light",
                     "price": { "total": { "total": 300.00, "currency": "BRL" } } } ] }
    ]
  },
  // ← nem "fares" na raiz, nem "itinerary.fares"
  "displayedTotal": 780.00
}
```

### 7.6 Preço mudou — 409

```json
{
  "success": false,
  "error": { "code": "FARE_PRICE_CHANGED", "category": "conflict" },
  "message": "The fare price changed since it was quoted.",
  "correlationId": "req-booking-changed-001",
  "provider": "acme-air",
  "details": null,
  "metadata": { "operation": "createBooking", "duration": 2410 }
}
```

---

## 8. Checklist

- [ ] Recuso com 400, do meu lado, os campos que a minha companhia exige mas o contrato marca como opcionais (`gender`, `birthdate`, `document`).
- [ ] `people[].identifier` é o mesmo identificador que as rotas de assento e extras vão usar.
- [ ] Aceito bebê de colo nas duas formas (entrada própria e `infantInfo`).
- [ ] A tarifa vai em **um lugar só**: raiz para pacote, trecho para trecho solto — e recuso os dois juntos.
- [ ] `itinerary.legs` no request é de **uma dimensão**, e a posição é o trecho.
- [ ] `appliesTo` coerente com onde a tarifa está.
- [ ] Rodo o gate de re-tarifa antes de criar: subiu → 409 `FARE_PRICE_CHANGED`; sumiu → 409 `FARE_UNAVAILABLE`.
- [ ] O `data` devolve `locator`, `status`, `bookingToken` e `orderIdentifier` no topo, com esses nomes.
- [ ] Meu parser **lança** quando a resposta traz marcador de recusa dentro de um sucesso.
- [ ] Se a companhia não confirma o localizador de forma inequívoca, **releio a reserva** antes de responder 201.
- [ ] Fidelidade nunca derruba a reserva.
