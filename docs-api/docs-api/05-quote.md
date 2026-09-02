# 05 — Tarifar: `POST /quote`

Pergunta à companhia **quanto custa esta oferta, agora**, com preço firme. É a etapa entre escolher
um voo na busca e reservar.

Existe porque o resultado da busca é uma **cotação de disponibilidade**, não um compromisso: entre a
busca e a reserva o preço pode mudar, o assento pode acabar, a tarifa pode sair do ar. Tarifar é
perguntar de novo, agora, e receber a resposta que vale.

> **Nomenclatura.** Esta rota se chama `/quote`, não `/pricing`. Ver
> [`01-convencoes.md`](01-convencoes.md) §2: `quote` é *tarifar no provedor*; `pricing` é *margem
> comercial de quem revende*, que está fora deste desafio.

> Termo novo? Está no [`00-glossario.md`](00-glossario.md).

---

## 1. Os dois cenários

A mesma rota atende duas situações, discriminadas pelo conteúdo do bloco `quote`:

| Cenário | Como se endereça | Quando |
|---|---|---|
| **Pré-reserva** | `quote.offers[]` — as ofertas escolhidas na busca | Antes de reservar. É o caso normal |
| **Pós-reserva** | `quote.booking.locator` — o localizador de uma reserva existente | Reconferir o preço de uma reserva em espera, antes de emitir |

Se a sua companhia só suporta um dos dois, o outro responde **501 `CAPABILITY_NOT_SUPPORTED`**.

---

## 2. Request — cenário pré-reserva

```json
{
  "provider": "acme-air",
  "options": { },
  "quote": {
    "type": "roundtrip",
    "offers": [
      {
        "journeyKey": "ACME-RT-DEP-0001",
        "fareId": "ACME-RT-LIGHT-01",
        "fareCode": "ONJAAG2J",
        "bookingClass": "O",
        "familyCode": "LIGHT",
        "flightNumbers": ["1234", "4321"]
      }
    ],
    "passengers": { "adults": 2, "children": 1, "infants": 0 },
    "options": { "currency": "BRL" }
  }
}
```

### Raiz

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `provider` | `string` | **sim** | Provedor da oferta |
| `quote` | `object` | **sim** | O bloco pré-reserva **ou** o pós-reserva |
| `options` | `object` | **sim** | Opções de runtime. Pode vir vazio |

🔴 **A raiz e o bloco `quote` são fechados**: uma chave que você não declarou é **descartada em
silêncio** antes de chegar ao seu código. Foi exatamente assim que o `type` deixou de chegar por um
tempo, e a rota passou a adivinhar o tipo de viagem por contagem. **Declare todo campo que você
pretende ler.**

### `quote` (pré-reserva)

| Campo | Tipo | Obrigatório | Descrição | Valores |
|---|---|---|---|---|
| `quote.type` | `string` | **fortemente recomendado** | Tipo de viagem da oferta. Ver §2.1 | `oneway` \| `roundtrip` \| `multicity` |
| `quote.offers[]` | `array` | **sim**, mínimo 1 | As ofertas selecionadas. Ver §2.2 | |
| `quote.passengers` | `object` | **sim na prática** | Ver §2.3 | |
| `quote.options` | `object` | não | Opções repassadas ao provedor. Ver §2.4 | |

> **Nota:** o contrato real carrega ainda um bloco `quote.snapshot`, com a composição da margem
> comercial da busca, para que o preço reprecificado saia coerente com o que foi exibido. Como
> margem está fora deste desafio, ele não aparece aqui.

### 2.1 🔴 `quote.type` — o discriminador

**Mande sempre.** Sem ele, o servidor precisa adivinhar o tipo de viagem pela **quantidade de
ofertas** — e a heurística natural (`mais de 2 ofertas = multidestino`) **erra num multidestino de
2 trechos**, que vira um pedido de ida-e-volta e sai errado para a companhia.

Do seu lado: **se `type` vier, ele vence a heurística.** Se não vier, e você precisar adivinhar,
documente o critério.

### 2.2 `quote.offers[]`

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `journeyKey` | `string` | **sim\*** | O `identifier` do trecho, vindo da busca. **Opaco** — ver [`01`](01-convencoes.md) §4 |
| `fareId` | `string` | **sim\*** | O `fares[].fareId` da busca |
| `fare.fareId` | `string` | **sim\*** | Terceira forma aceita de identificar a tarifa |
| `fareCode` | `string` | não | Base tarifária |
| `bookingClass` | `string` | não | Classe de reserva (RBD) |
| `familyCode` | `string` | não | Família tarifária |
| `flightNumbers[]` | `string[]` | não | Números de voo, na ordem dos trechos |
| `flightNumber` | `string` | não | Forma singular, legada |

**\* A regra real:** pelo menos **um** de `journeyKey`, `fareId` ou `fare.fareId` tem que estar
presente. Sem nenhum → **400**, com a mensagem dizendo que falta o identificador da oferta.

O motivo de haver três: nem todo provedor identifica a mesma coisa. Alguns endereçam pela jornada
(`journeyKey`), outros pela tarifa (`fareId`). Aceite os três e use o que a sua companhia precisa.

**Um item por trecho ou direção**, na ordem:

| Tipo | Como montar `offers[]` |
|---|---|
| `oneway` | **1** item |
| `roundtrip` | **2** itens: `offers[0]` = ida, `offers[1]` = volta — a ordem é **posicional** |
| `multicity` | **N** itens, um por trecho, na ordem dos trechos |

Num provedor de **pacote**, cada item carrega o `journeyKey` daquele trecho e o `fareCode`/
`familyCode` da tarifa única do pacote. Num provedor de **trecho solto**, cada item carrega o **seu**
`fareId`, porque a tarifa é por voo.

### 2.3 `quote.passengers`

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `adults` | `integer ≥ 1` | **sim na prática** | |
| `children` | `integer ≥ 0` | não | |
| `infants` | `integer ≥ 0` | não | |

🔴 **Não deixe de mandar, e não assuma default.** A tentação é `adults: 1` quando o campo falta —
e aí uma venda de 3 adultos é tarifada pelo preço de um. Se o bloco não vier, **recuse com 400** em
vez de adivinhar; se você aceitar um default, deixe-o explícito no seu contrato.

Multiplique valores unitários pela quantidade do próprio tipo de passageiro. É o mesmo invariante da
busca ([`04`](04-availability-formatos.md) §8, I7).

### 2.4 `quote.options`

Objeto livre, repassado ao provedor. Chaves conhecidas na prática: `currency`, e opções específicas
da companhia (incluir texto de regra tarifária, código promocional, preferências de fonte). Se a sua
companhia não tem nenhuma, aceite o objeto e ignore.

---

## 3. Request — cenário pós-reserva

```json
{
  "provider": "acme-air",
  "options": { },
  "quote": {
    "booking": { "locator": "ABC123" },
    "options": { "fullResponse": false }
  }
}
```

O bloco `quote.booking` é o **endereço da reserva**, e é **idêntico em todas as rotas pós-reserva**
deste contrato:

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `booking.locator` | `string` | **sim** | O localizador (PNR) devolvido pela reserva. **Todo provedor usa** |
| `booking.orderIdentifier` | `string` | condicional | Identificador de pedido, quando a companhia usa um além do localizador. **Sem ele, algumas fontes não encontram a reserva** |
| `booking.bookingToken` | `string` | condicional | Token de reserva, quando a companhia endereça por ele |
| `booking.source` | `string` | não | Fonte/sistema da reserva, quando a companhia precisa |

Guarde **os quatro** valores que a reserva devolver. Qual deles a sua companhia exige depende dela;
o contrato aceita todos.

---

## 4. Response

**HTTP 200.**

```json
{
  "success": true,
  "data": {
    "provider": "acme-air",
    "available": true,
    "currency": "BRL",
    "rawTotal": 1280.45,
    "base": 1120.00,
    "taxes": 160.45,
    "exchange": null
  },
  "meta": { "provider": "acme-air", "duration": 3154, "timestamp": "2026-06-25T12:01:00.000Z" }
}
```

| Campo | Tipo | Sempre presente | Descrição |
|---|---|---|---|
| `data.provider` | `string` | sim | Quem tarifou |
| `data.available` | `boolean` | sim | Ver §4.1 |
| `data.currency` | `string` \| `null` | sim | Moeda dos valores |
| `data.rawTotal` | `number` \| `null` | sim | **O total CRU da companhia.** Ver §4.2 |
| `data.base` | `number` \| `null` | sim | Tarifa base, sem impostos |
| `data.taxes` | `number` \| `null` | sim | Impostos e taxas |
| `data.exchange` | `object` \| `null` | sim | Câmbio aplicado, quando houve. `{from, to, conversionFactor, applied}` |

**Invariante:** `base + taxes == rawTotal`.

🔴 Este invariante é responsabilidade sua. Se a companhia devolve `base` e `taxes` que não fecham
com o total (acontece), **derive `taxes` como `total − base`** em vez de repassar o valor dela. Quem
consome soma os dois esperando o total; um provedor que não fecha vira exceção no código de todo
mundo.

### 4.1 `data.available`

`true` no caminho de sucesso.

**Tarifa que sumiu não vira `available: false`** — vira **409 `FARE_UNAVAILABLE`**. O campo diz "a
cotação foi feita", não "há disponibilidade": disponibilidade que acabou é um erro, não um resultado.

### 4.2 `data.rawTotal` — por que "raw"

`raw` = **cru do fornecedor**, sem nenhuma margem comercial aplicada. O contrato real tem, ao lado,
um total com a margem de quem revende — que está fora deste desafio.

**Na sua API, `rawTotal` é o total, e é o único.** O nome fica porque é o nome do campo no contrato,
e ele diz exatamente o que ele é.

### 4.3 O que fazer quando o preço muda

**A mudança de preço volta na RESPOSTA, não como erro.** Quem consome compara o `rawTotal` com o
valor que exibiu e decide o que fazer — mostrar um aviso, pedir confirmação, seguir.

Devolver 409 aqui só faz sentido quando a companhia **sinaliza a mudança como recusa** (ela se nega a
cotar pelo preço antigo). Aí é `FARE_PRICE_CHANGED`.

---

## 5. Variações por tipo de viagem e modelo de provedor

### No request

Ver §2.2: o que muda é **quantos itens** vão em `offers[]` e **em que ordem**.

### No response

**Nenhuma.** `data` é sempre escalar: um `rawTotal`, um `base`, um `taxes` — para a viagem inteira,
todos os passageiros.

Isso vale inclusive para o provedor de **trecho solto**: mesmo que ele precifique cada voo
separadamente, a resposta do tarifar é **um total só** — a soma que a reserva vai cobrar. Não existe
campo que separe o total por trecho.

**Não existe `fareModel` no `/quote`.** A distinção pacote × trecho solto vive na busca; aqui os dois
modelos convergem para a mesma forma.

---

## 6. Casos de borda

| Cenário | HTTP | `error.code` |
|---|---|---|
| Corpo inválido, ou nenhum identificador de oferta em `offers[]` | **400** | `SEARCH_VALIDATION_ERROR` |
| Identificador opaco corrompido (não abre) | **400** | `SEARCH_VALIDATION_ERROR` — **a chamada nem chega à companhia** |
| A tarifa não existe mais | **409** | `FARE_UNAVAILABLE` |
| A companhia se recusa a cotar pelo preço antigo | **409** | `FARE_PRICE_CHANGED` |
| A companhia não suporta este cenário (pré ou pós-reserva) | **501** | `CAPABILITY_NOT_SUPPORTED` |
| Localizador inexistente (cenário pós-reserva) | **404** | `RESOURCE_NOT_FOUND` |
| A companhia respondeu quebrado | **502** | `PROVIDER_INTEGRATION_ERROR` |
| A companhia não respondeu no tempo | **504** | `PROVIDER_TIMEOUT` |

🔴 **Não devolva 200 com todos os valores `null`.** Se você não conseguiu ler o preço da resposta da
companhia, isso é **502 `PROVIDER_INTEGRATION_ERROR`**, não um sucesso vazio. Um 200 dizendo
`available: true` sem preço nenhum é o pior resultado possível: quem consome acha que deu certo.

---

## 7. Exemplos completos

### 7.1 Ida — request

```json
{
  "provider": "acme-air",
  "options": { },
  "quote": {
    "type": "oneway",
    "offers": [
      { "journeyKey": "ACME-OW-GRU-REC-0001",
        "fareId": "ACME-FARE-LIGHT-0001",
        "fareCode": "ONJAAG2J",
        "bookingClass": "O",
        "familyCode": "LIGHT",
        "flightNumbers": ["1234"] }
    ],
    "passengers": { "adults": 1, "children": 0, "infants": 0 },
    "options": { "currency": "BRL" }
  }
}
```

**Response**

```json
{
  "success": true,
  "data": { "provider": "acme-air", "available": true, "currency": "BRL",
            "rawTotal": 292.75, "base": 245.00, "taxes": 47.75, "exchange": null },
  "meta": { "provider": "acme-air", "duration": 1840, "timestamp": "2026-06-01T12:05:12.000Z" }
}
```

### 7.2 Ida-e-volta, provedor de pacote — request

Duas ofertas, ida primeiro:

```json
{
  "provider": "acme-air",
  "options": { },
  "quote": {
    "type": "roundtrip",
    "offers": [
      { "journeyKey": "ACME-RT-DEP-0001", "fareId": "ACME-RT-LIGHT-01",
        "fareCode": "ONJAAG2J", "bookingClass": "O", "familyCode": "LIGHT" },
      { "journeyKey": "ACME-RT-RET-0001", "fareId": "ACME-RT-LIGHT-01",
        "fareCode": "ONJAAG2J", "bookingClass": "O", "familyCode": "LIGHT" }
    ],
    "passengers": { "adults": 2, "children": 0, "infants": 0 },
    "options": { "currency": "BRL" }
  }
}
```

**Response**

```json
{
  "success": true,
  "data": { "provider": "acme-air", "available": true, "currency": "BRL",
            "rawTotal": 1280.45, "base": 1120.00, "taxes": 160.45, "exchange": null },
  "meta": { "provider": "acme-air", "duration": 2960, "timestamp": "2026-06-01T12:06:03.000Z" }
}
```

### 7.3 Multidestino, 3 trechos — request

```json
{
  "provider": "acme-air",
  "options": { },
  "quote": {
    "type": "multicity",
    "offers": [
      { "journeyKey": "ACME-MC-L0-A", "fareId": "ACME-MC-FARE-L0", "fareCode": "ONJAAG2J" },
      { "journeyKey": "ACME-MC-L1-A", "fareId": "ACME-MC-FARE-L1", "fareCode": "ONJMAG2J" },
      { "journeyKey": "ACME-MC-L2-A", "fareId": "ACME-MC-FARE-L2", "fareCode": "ONJMAG2J" }
    ],
    "passengers": { "adults": 2 },
    "options": { "currency": "BRL" }
  }
}
```

**Response**

```json
{
  "success": true,
  "data": { "provider": "acme-air", "available": true, "currency": "BRL",
            "rawTotal": 2450.00, "base": 2180.00, "taxes": 270.00, "exchange": null },
  "meta": { "provider": "acme-air", "duration": 4120, "timestamp": "2026-06-01T12:07:41.000Z" }
}
```

### 7.4 Pós-reserva — request e response

```json
{
  "provider": "acme-air",
  "options": { },
  "quote": { "booking": { "locator": "ABC123", "orderIdentifier": "ACME-ORD-77321" } }
}
```

```json
{
  "success": true,
  "data": { "provider": "acme-air", "available": true, "currency": "BRL",
            "rawTotal": 915.73, "base": 812.38, "taxes": 103.35, "exchange": null },
  "meta": { "provider": "acme-air", "duration": 2210, "timestamp": "2026-06-01T12:09:55.000Z" }
}
```

### 7.5 Tarifa indisponível

```json
{
  "success": false,
  "error": { "code": "FARE_UNAVAILABLE", "category": "conflict" },
  "message": "The selected fare is no longer available.",
  "correlationId": "req-fare-unavailable-001",
  "provider": "acme-air",
  "providerError": {
    "provider": "acme-air", "operation": "quote",
    "providerCode": "1051",
    "providerMessage": "Fare class not available for the requested date",
    "providerSeverity": null, "httpStatus": 400
  },
  "details": null,
  "metadata": { "operation": "quote", "duration": 1620 }
}
```

---

## 8. Checklist

- [ ] Aceito `journeyKey`, `fareId` **e** `fare.fareId`; recuso com 400 quando nenhum vier.
- [ ] Uso `quote.type` quando ele vem, e documento a heurística quando não vem.
- [ ] Mando os passageiros à companhia — nunca assumo 1 adulto em silêncio.
- [ ] Multiplico valores unitários pela quantidade do tipo.
- [ ] `base + taxes == rawTotal`, mesmo quando a companhia não fecha.
- [ ] Tarifa sumida → 409, nunca 200 com `available: false`.
- [ ] Preço não legível na resposta da companhia → 502, nunca 200 com tudo `null`.
- [ ] Identificador opaco corrompido → 400 antes de chamar a companhia.
