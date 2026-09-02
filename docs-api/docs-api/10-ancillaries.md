# 10 — Bagagem e serviços extras: `/ancillaries` e `/sell-ancillaries`

Duas rotas, na ordem:

| # | Método | Rota | O que faz |
|---|---|---|---|
| 1 | `POST` | `/ancillaries` | **Lista** os extras à venda para esta reserva. Leitura pura |
| 2 | `POST` | `/sell-ancillaries` | **Vende ou pendura** o extra escolhido |

**Extra exige reserva.** Nenhuma companhia vende bagagem ou serviço antes de existir um localizador —
por isso as duas rotas endereçam por `booking.locator` e não por oferta de busca.

**"Pendurar" é o modo normal.** Na maioria das companhias, `/sell-ancillaries` **anexa** o serviço à
reserva sem cobrar; a cobrança acontece na emissão ([`11-emissao.md`](11-emissao.md)), que paga a
tarifa e tudo que estiver pendurado, de uma vez.

> **Nota de contrato:** nestas duas rotas o provedor vai em **`options.provider`**, não na raiz do
> corpo — diferente de `/quote` e `/booking`.

> Termo novo? Está no [`00-glossario.md`](00-glossario.md).

---

## 1. `POST /ancillaries` — as ofertas

### 1.1 Request

```json
{
  "options": { "provider": "acme-air", "currency": "BRL" },
  "ancillaries": {
    "booking": { "locator": "ABC123" },
    "type": "baggage"
  }
}
```

| Campo | Tipo | Obrigatório | Descrição | Valores |
|---|---|---|---|---|
| `options.provider` | `string` | **sim** | | |
| `options.currency` | `string(3)` | não (default `BRL`) | Moeda desejada. Preferência da **chamada** | |
| `ancillaries.booking` | `object` | **sim** | Endereço da reserva. `locator` obrigatório | |
| `ancillaries.type` | `string` | não | Filtro de tipo. **Ausente = tudo**. §1.3 | `baggage` \| `seat` \| `meal` \| `pet-cabin` \| `pet-hold` \| `unaccompanied-minor` \| `vip-lounge` \| `upgrade` \| `other` |
| `ancillaries.passengers[]` | `string[]` | não | Filtrar por passageiro. Ids vindos do `/retrieve` ou do `/seat-map` | |
| `ancillaries.segments[]` | `string[]` | não | Filtrar por trecho. Ids vindos do `/seat-map` | |

`ancillaries` é **fechado**: chave desconhecida ali → **400**.

### 1.2 Response

```json
{
  "success": true,
  "data": {
    "provider": "acme-air",
    "locator": "ABC123",
    "currency": "BRL",
    "passengers": [
      { "id": "1", "firstName": "CARLOS", "lastName": "ANDRADE", "type": "adult" }
    ],
    "segments": [
      { "segmentId": "1", "origin": "GRU", "destination": "GIG",
        "departureDate": null, "number": "1378",
        "company": { "code": "G3", "name": null } }
    ],
    "offers": [
      { "key": "0C3|1|175.00", "type": "baggage", "code": "0C3",
        "name": "PRIMEIRA BAGAGEM - 23 KG", "description": null,
        "passengerId": "1", "segmentId": "1",
        "price": { "currency": "BRL", "total": 175.00 },
        "baggage": { "pieces": 1, "weight": 23, "unit": "kg" } },
      { "key": "0JT|1|220.00", "type": "baggage", "code": "0JT",
        "name": "SEGUNDA BAGAGEM - 23 KG", "description": null,
        "passengerId": "1", "segmentId": "1",
        "price": { "currency": "BRL", "total": 220.00 },
        "baggage": { "pieces": 2, "weight": 23, "unit": "kg" } }
    ]
  },
  "meta": { "provider": "acme-air", "operation": "ancillaries",
            "correlationId": "req-anc-001", "timestamp": "2026-08-26T23:05:11.000Z" }
}
```

#### Raiz

| Campo | Tipo | Descrição |
|---|---|---|
| `provider` | `string` | |
| `locator` | `string` \| `null` | |
| `currency` | `string` \| `null` | Moeda da primeira oferta com preço; senão a pedida; senão `null` |
| `passengers[]` | `array` | |
| `segments[]` | `array` | |
| `offers[]` | `array` | |

#### `passengers[]`

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | `string` \| `null` | 🔴 **É o `items[].passengerId` do `/sell-ancillaries`** |
| `firstName` / `lastName` | `string` \| `null` | |
| `type` | `string` \| `null` | `adult` \| `child` \| `infant` \| `null` |

#### `segments[]`

| Campo | Tipo | Descrição |
|---|---|---|
| `segmentId` | `string` \| `null` | 🔴 **É o `items[].segmentId` do `/sell-ancillaries`** |
| `origin` / `destination` | `string` \| `null` | IATA |
| `departureDate` | `string` \| `null` | Como a companhia informa. `null` quando não informa |
| `number` | `string` \| `null` | Número do voo |
| `company` | `object` | `{code, name}` |

#### `offers[]` — a oferta

| Campo | Tipo | Descrição |
|---|---|---|
| `key` | `string` | 🔴 **Chave OPACA.** §2 |
| `type` | `string` \| `null` | **O que a COMPANHIA diz** que é. `null` = ela não classifica — **nunca deduza do nome** |
| `code` | `string` \| `null` | Código cru da companhia. Informativo |
| `name` | `string` \| `null` | Nome cru da companhia, **não traduzido** |
| `description` | `string` \| `null` | |
| `passengerId` | `string` \| `null` | **`null` = vale para qualquer passageiro** (algumas companhias consultam por um adulto genérico) |
| `segmentId` | `string` \| `null` | **`null` = vale para a viagem toda** |
| `price` | `{currency, total}` \| `null` | §1.4 |
| `baggage` | `{pieces, weight, unit}` \| `null` | Só quando o extra é bagagem estruturada. §1.5 |

### 1.3 🔴 O filtro `type` é ESTRITO — e isso apaga oferta real

Oferta com `type: null` (a companhia não classificou) é **descartada** quando `type` é enviado.

Isso é o comportamento certo — `type` é um filtro, e um `null` não casa com `baggage` —, mas tem uma
consequência prática: **consultar sem `type` e filtrar no cliente vê mais ofertas.** Deixe isso
explícito para quem consome.

### 1.4 `price.total: 0` ≠ `price: null`

| Valor | Significa |
|---|---|
| `{currency, total: 0}` | **Valor declarado, zero.** O item está incluso na tarifa |
| `null` | **A companhia não informou** o preço |

Item gratuito é vendido normalmente e fica `booked` sem gerar documento cobrado.

### 1.5 🔴 Bagagem em DEGRAU acumulado

Em várias companhias, a oferta de bagagem é um **degrau**, não um incremento:

```
"PRIMEIRA BAGAGEM"  → pieces: 1, total: 175,00   (uma mala,  ao todo)
"SEGUNDA BAGAGEM"   → pieces: 2, total: 220,00   (duas malas, ao todo)
"TERCEIRA BAGAGEM"  → pieces: 3, total: 260,00   (três malas, ao todo)
```

**`pieces` é o TOTAL de malas do degrau, e o preço é do CONJUNTO.** Somar dois degraus para "duas
malas" cobra 395,00 em vez de 220,00.

Deixe explícito em `baggage.pieces` qual é o total, e não trate a lista como itens somáveis.

---

## 2. 🔴 A `key` opaca

| | |
|---|---|
| **De onde vem** | Só de `data.offers[].key` do `/ancillaries` **desta mesma reserva** |
| **Para onde vai** | Literalmente para `sellAncillaries.items[].key`. Mesmo nome, valor copiado |
| **O que NÃO fazer** | Não montar, não abrir, não normalizar, não casar por `code`, não reordenar, não deduplicar por prefixo, não persistir como identidade estável entre consultas |

### Por que a `key` não pode ser só o código do serviço

Um caso real: o **mesmo código de serviço tem um preço por trecho** numa companhia — o mesmo assento
custava 40, 48, 53, 58, 63, 79, 90 e 111 conforme o trecho. Casar só pelo código gravou **79,00 no
lugar de 40,00**.

Outro: uma companhia repete o mesmo identificador de grupo dez vezes, com preços diferentes; só a
chave inteira é única.

**Consequência para você:** a `key` tem que carregar tudo que identifica **aquela oferta exata** —
serviço, trecho e preço, se for o caso. Um bom formato é a concatenação dos discriminadores:

```
<código do serviço>|<trecho>|<preço>
```

**Duas ofertas com a mesma `key` compram a mesma coisa pelo mesmo valor.** Se isso não for verdade
no seu formato, a chave está incompleta.

---

## 3. `POST /sell-ancillaries` — vender ou pendurar

### 3.1 Request

```json
{
  "options": { "provider": "acme-air" },
  "sellAncillaries": {
    "booking": { "locator": "ABC123" },
    "items": [
      { "key": "0C3|1|175.00", "passengerId": "1", "segmentId": "1", "type": "baggage" }
    ]
  }
}
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `options.provider` | `string` | **sim** | |
| `sellAncillaries.booking` | `object` | **sim** | `locator` obrigatório |
| `sellAncillaries.items[]` | `array` | **sim**, ≥1 | Fechado: chave desconhecida no item → **400** |
| `items[].key` | `string` | **sim** | Copiada de `offers[].key` |
| `items[].passengerId` | `string` | **sim** | De `passengers[].id` |
| `items[].segmentId` | `string` \| `null` | não | De `segments[].segmentId`. `null` = viagem toda |
| `items[].type` | `string` | não | De `offers[].type`, quando havia |
| `items[].count` | `integer ≥ 1` | não | Quantidade, quando a companhia aceita |
| `sellAncillaries.payment.creditCard` | `object` | não | **Ausente = PENDURA** (cobra na emissão). Presente = cobra agora, onde a companhia permite. Mesmo shape do cartão da emissão ([`11`](11-emissao.md) §3.2) |

> 🔴 **Se a oferta veio com `passengerId: null`** (a companhia consultou por um passageiro
> genérico), quem consome ainda assim **precisa** escolher um passageiro concreto — `items[].passengerId`
> é obrigatório. Deixe isso claro na descrição da sua oferta.

### 3.2 Response

```json
{
  "success": true,
  "data": {
    "provider": "acme-air",
    "locator": "ABC123",
    "committed": true,
    "confirmed": true,
    "amount": null,
    "items": [
      { "key": "0C3|1|175.00", "passengerId": "1", "segmentId": "1", "type": "baggage",
        "status": "booked", "price": { "currency": "BRL", "total": 175.00 },
        "documentNumber": null, "message": null }
    ]
  },
  "meta": { "provider": "acme-air", "operation": "sellAncillaries",
            "correlationId": "req-sell-001", "timestamp": "2026-08-26T23:07:00.000Z" }
}
```

| Campo | Tipo | Significado exato |
|---|---|---|
| `provider` / `locator` | `string` / `string` \| `null` | Eco |
| `committed` | `boolean` | **A companhia aceitou e persistiu** o serviço na reserva |
| `confirmed` | `boolean` \| **`null`** | **Existe prova** de que ele está lá. `null` = a companhia não ecoa e você não releu. Ver [`01`](01-convencoes.md) §7 |
| `amount` | `{currency, total}` \| `null` | **O que foi movimentado AGORA.** `null` quando só pendurou |
| `items[]` | `array` | Um item por item **PEDIDO** |

`items[]` item:

| Campo | Tipo | Descrição |
|---|---|---|
| `key` / `passengerId` / `segmentId` / `type` | | Eco do pedido |
| `status` | `string` | §3.3 |
| `price` | `{currency, total}` \| `null` | |
| `documentNumber` | `string` \| `null` | Número do documento gerado. `null` quando `booked` — ele nasce na emissão |
| `message` | `string` \| `null` | Motivo, quando `failed`; ou a nota de duplicidade (§3.4) |

### 3.3 Os três `status`

| Valor | Significa | `documentNumber` |
|---|---|---|
| `booked` | **Pendurado.** O serviço está na reserva; o documento sai na emissão | `null` |
| `issued` | **Documento emitido nesta chamada** — acontece quando a companhia cobra na hora (com cartão) | preenchido, quando a companhia o expõe |
| `failed` | **A companhia recusou ESTE item.** `message` diz por quê | `null` |

🔴 **Nenhum item aceito → ERRO, não 200 com tudo `failed`.** Um 200 em que nada aconteceu é lido
como sucesso parcial por quem consome. Se a companhia recusou todos, a resposta é o `ErrorEnvelope`.

> **Nem toda companhia expõe o número do documento** do serviço. Onde ela não expõe, `issued` é
> inferido de outro sinal (por exemplo, o saldo devedor da reserva ter zerado) e `documentNumber`
> fica `null`. Isso é honesto; inventar um número não é.

### 3.4 🔴 IDEMPOTÊNCIA — a rota NÃO é idempotente na companhia

**Medido em três companhias diferentes: a mesma `key` enviada duas vezes gera dois documentos e
cobra duas vezes.** Num teste real, o total de bagagem de uma reserva foi de 175,00 para 350,00
porque o pedido repetiu.

**A rede de proteção é sua, e ela funciona assim:**

```
1. ANTES de pendurar, LEIA na companhia o que já está pendurado naquela reserva
   (a consulta de reserva, ou o endpoint de serviços dela)

2. Item JÁ presente
   → 200, status "booked", preço lido da reserva,
     message: "Service already on the booking; not added again."
     SEM chamar a venda na companhia

3. Item ausente
   → pendura normalmente

4. A LEITURA falhou / veio ilegível
   → 502 PROVIDER_INTEGRATION_ERROR (retentável)
     NUNCA pendure às cegas
```

Três detalhes que fazem diferença:

- **Um item pendurado cobre UM item.** Se o request pede o mesmo serviço duas vezes na mesma
  chamada, o segundo é pendurado — o primeiro "consome" o que já estava lá.
- **Algumas companhias recusam a duplicata sozinhas**, com um código próprio. Nessas, a rede é
  redundante mas inofensiva.
- **Algumas são idempotentes por desenho** (cobram o delta), e uma segunda venda sai com
  `amount: 0`. Também não precisam da rede.

Descubra em qual dos três casos a sua está — e, na dúvida, implemente a rede.

### 3.5 Assento pago pode aparecer aqui sozinho

Em algumas companhias, marcar um assento pago pelo `/mark-seats` faz a **própria companhia** pendurar
o serviço correspondente. Se você pendurar o seu por cima, o item fica **duplicado**.

Regra: **antes de pendurar um serviço de assento, leia se a companhia já o pendurou.** É o mesmo
mecanismo da §3.4, aplicado a um caso que quem consome não vê.

---

## 4. Casos de borda

| Cenário | HTTP | `error.code` |
|---|---|---|
| Corpo inválido; `items[]` vazio; chave desconhecida | **400** | `SEARCH_VALIDATION_ERROR` |
| `key` corrompida (não abre) | **400** | `SEARCH_VALIDATION_ERROR` — **antes** de chamar a companhia |
| Localizador inexistente | **404** | `RESOURCE_NOT_FOUND` |
| **Extra já está na reserva** | **200** | `status: "booked"` + mensagem de duplicidade (§3.4) |
| **Nenhum item aceito** | erro | não 200 |
| A companhia recusou por regra (só vende extra depois de emitir, por exemplo) | **422** | `BUSINESS_RULE_VIOLATION` |
| Extra pago e a companhia exige cartão, que não veio | **422** | `BUSINESS_RULE_VIOLATION` |
| A companhia não vende extras | **501** | `CAPABILITY_NOT_SUPPORTED` |
| A leitura de duplicidade falhou | **502** | `PROVIDER_INTEGRATION_ERROR` |
| A companhia respondeu quebrado | **502** | `PROVIDER_INTEGRATION_ERROR` |
| Timeout | **504** | `PROVIDER_TIMEOUT` |

🔴 **Sem `provider` no request, a resposta é 400** — não 501. "Não sei qual companhia" é payload
inválido; "esta companhia não faz isso" é capability.

---

## 5. Exemplos

### 5.1 Consultar bagagem — request e response

```json
{
  "options": { "provider": "acme-air", "currency": "BRL" },
  "ancillaries": { "booking": { "locator": "ABC123" }, "type": "baggage" }
}
```

```json
{
  "success": true,
  "data": {
    "provider": "acme-air", "locator": "ABC123", "currency": "BRL",
    "passengers": [ { "id": "1", "firstName": "CARLOS", "lastName": "ANDRADE", "type": "adult" } ],
    "segments": [ { "segmentId": "1", "origin": "GRU", "destination": "GIG",
                    "departureDate": null, "number": "1378",
                    "company": { "code": "G3", "name": null } } ],
    "offers": [
      { "key": "0C3|1|175.00", "type": "baggage", "code": "0C3",
        "name": "PRIMEIRA BAGAGEM - 23 KG", "description": null,
        "passengerId": "1", "segmentId": "1",
        "price": { "currency": "BRL", "total": 175.00 },
        "baggage": { "pieces": 1, "weight": 23, "unit": "kg" } },
      { "key": "0JT|1|220.00", "type": "baggage", "code": "0JT",
        "name": "SEGUNDA BAGAGEM - 23 KG", "description": null,
        "passengerId": "1", "segmentId": "1",
        "price": { "currency": "BRL", "total": 220.00 },
        "baggage": { "pieces": 2, "weight": 23, "unit": "kg" } },
      { "key": "0DF|1|0", "type": "baggage", "code": "0DF",
        "name": "BAGAGEM INCLUSA", "description": null,
        "passengerId": "1", "segmentId": "1",
        "price": { "currency": "BRL", "total": 0 },
        "baggage": { "pieces": 1, "weight": 10, "unit": "kg" } }
    ]
  },
  "meta": { "provider": "acme-air", "operation": "ancillaries",
            "correlationId": "req-anc-001", "timestamp": "2026-08-26T23:05:11.000Z" }
}
```

Repare no terceiro item: `total: 0` é **incluso declarado**, não "sem preço".

### 5.2 Pendurar — request e response

```json
{
  "options": { "provider": "acme-air" },
  "sellAncillaries": {
    "booking": { "locator": "ABC123" },
    "items": [ { "key": "0C3|1|175.00", "passengerId": "1", "segmentId": "1", "type": "baggage" } ]
  }
}
```

```json
{
  "success": true,
  "data": {
    "provider": "acme-air", "locator": "ABC123",
    "committed": true, "confirmed": true, "amount": null,
    "items": [ { "key": "0C3|1|175.00", "passengerId": "1", "segmentId": "1", "type": "baggage",
                 "status": "booked", "price": { "currency": "BRL", "total": 175.00 },
                 "documentNumber": null, "message": null } ]
  },
  "meta": { "provider": "acme-air", "operation": "sellAncillaries",
            "correlationId": "req-sell-001", "timestamp": "2026-08-26T23:07:00.000Z" }
}
```

`amount: null` porque **só pendurou** — a cobrança sai na emissão.

### 5.3 Vender cobrando na hora (com cartão)

```json
{
  "options": { "provider": "acme-air" },
  "sellAncillaries": {
    "booking": { "locator": "ABC123" },
    "items": [ { "key": "0C3|1|175.00", "passengerId": "1", "segmentId": "1", "type": "baggage" } ],
    "payment": {
      "creditCard": { "brand": "VI", "number": "4444333322221111", "cvv": "737",
                      "expiryDate": "03/2030", "installments": 1,
                      "holderName": "CARLOS ANDRADE", "holderCpf": "11122233344" }
    }
  }
}
```

```json
{
  "success": true,
  "data": {
    "provider": "acme-air", "locator": "ABC123",
    "committed": true, "confirmed": true,
    "amount": { "currency": "BRL", "total": 175.00 },
    "items": [ { "key": "0C3|1|175.00", "passengerId": "1", "segmentId": "1", "type": "baggage",
                 "status": "issued", "price": { "currency": "BRL", "total": 175.00 },
                 "documentNumber": "9994400012345", "message": null } ]
  },
  "meta": { "provider": "acme-air", "operation": "sellAncillaries",
            "correlationId": "req-sell-002", "timestamp": "2026-08-26T23:09:00.000Z" }
}
```

### 5.4 Item já na reserva — 200 com nota

```json
{
  "success": true,
  "data": {
    "provider": "acme-air", "locator": "ABC123",
    "committed": true, "confirmed": true, "amount": null,
    "items": [ { "key": "0C3|1|175.00", "passengerId": "1", "segmentId": "1", "type": "baggage",
                 "status": "booked", "price": { "currency": "BRL", "total": 175.00 },
                 "documentNumber": null,
                 "message": "Service already on the booking; not added again." } ]
  },
  "meta": { "provider": "acme-air", "operation": "sellAncillaries",
            "correlationId": "req-sell-003", "timestamp": "2026-08-26T23:11:00.000Z" }
}
```

### 5.5 Companhia só vende extra depois de emitir — 422

```json
{
  "success": false,
  "error": { "code": "BUSINESS_RULE_VIOLATION", "category": "business_rule" },
  "message": "The operation violates a provider or business rule.",
  "correlationId": "req-sell-rule-001",
  "provider": "acme-air",
  "providerError": {
    "provider": "acme-air", "operation": "sellAncillaries", "providerCode": null,
    "providerMessage": "Ancillary sale is only allowed after ticket issuance",
    "providerSeverity": null, "httpStatus": 200
  },
  "details": null,
  "metadata": { "operation": "sellAncillaries", "duration": 1340 }
}
```

---

## 6. Checklist

- [ ] A `key` identifica a oferta **exata** — inclui trecho e preço quando eles discriminam.
- [ ] `type` vem do que a companhia diz; `null` quando ela não classifica. **Nunca deduzo do nome.**
- [ ] `price.total: 0` é "incluso declarado"; `price: null` é "não informado".
- [ ] `baggage.pieces` é o **total do degrau**, e deixo claro que degraus não se somam.
- [ ] Antes de pendurar, **leio na companhia** o que já está lá.
- [ ] Item já presente → 200 `booked` + mensagem, sem chamar a venda.
- [ ] Leitura de duplicidade ilegível → 502 retentável, **nunca** pendura às cegas.
- [ ] Nenhum item aceito → erro, não 200 com tudo `failed`.
- [ ] `amount: null` quando só pendurou; valor quando cobrou.
- [ ] `confirmed` é prova, não dedução de `committed`.
