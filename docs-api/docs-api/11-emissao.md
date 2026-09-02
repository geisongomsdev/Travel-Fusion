# 11 — Emitir: `/payment-options`, `/financing-options`, `/issue`

A emissão é o momento em que a reserva vira bilhete e o dinheiro sai. Três rotas, na ordem:

| # | Método | Rota | O que faz |
|---|---|---|---|
| 1 | `POST` | `/payment-options` | Quais formas de pagamento a companhia aceita nesta reserva, e **qual código a emissão exige** |
| 2 | `POST` | `/financing-options` | Planos de parcelamento — só quando a forma escolhida é cartão |
| 3 | `POST` | `/issue` | **Emite.** Cobra a tarifa **e tudo que ficou pendurado** |

🔴 **A emissão NÃO é idempotente. Nunca retente automaticamente.** Uma emissão repetida é um bilhete
a mais, cobrado.

> Termo novo? Está no [`00-glossario.md`](00-glossario.md).

---

## 1. `POST /payment-options`

### 1.1 Request

```json
{
  "options": { "provider": "acme-air", "currency": "BRL" },
  "paymentOptions": { "booking": { "locator": "ABC123" } }
}
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `options.provider` | `string` | **sim** | |
| `options.currency` | `string(3)` | não | Só **rotula** a resposta quando ela vem de tabela (§1.3). Numa consulta viva, a moeda da companhia vence |
| `paymentOptions.booking` | `object` | **sim** | `locator` obrigatório |

### 1.2 Response

```json
{
  "success": true,
  "data": {
    "provider": "acme-air",
    "locator": "ABC123",
    "currency": "BRL",
    "source": "provider",
    "fareChanged": false,
    "amount": { "currency": "BRL", "total": 915.73 },
    "requires": { "securityKey": false, "securityToken": false,
                  "passengerDocument": false, "tourCode": false },
    "methods": [
      { "method": { "type": "credit-card", "code": 2, "typeCode": 6 },
        "label": "Cartão", "requiresManualAuthorization": false,
        "cardBrands": [ { "code": 1, "name": "Visa" }, { "code": 3, "name": "Mastercard" },
                        { "code": 2, "name": "Amex" }, { "code": 7, "name": "Elo" } ] },
      { "method": { "type": "invoice", "code": 1, "typeCode": 2 },
        "label": "Faturada", "requiresManualAuthorization": false, "cardBrands": [] }
    ]
  },
  "meta": { "provider": "acme-air", "operation": "paymentOptions",
            "correlationId": "req-pay-001", "timestamp": "2026-08-26T14:00:00.000Z" }
}
```

| Campo | Tipo | Descrição | Valores |
|---|---|---|---|
| `provider` / `locator` / `currency` | | | |
| `source` | `string` | **De onde veio esta resposta.** §1.3 | `provider` \| `static-map` |
| `fareChanged` | `boolean` \| `null` | A companhia sinaliza que o preço mudou desde a cotação. **É o mesmo sinal que o `/issue` avalia** | |
| `amount` | `{currency, total}` \| `null` | Total a pagar na emissão | |
| `requires.securityKey` | `boolean` \| `null` | A emissão exige uma chave de segurança | |
| `requires.securityToken` | `boolean` \| `null` | ... um token | |
| `requires.passengerDocument` | `boolean` \| `null` | ... o documento do passageiro | |
| `requires.tourCode` | `boolean` \| `null` | ... um código de tarifa negociada | |
| `methods[]` | `array` | As formas aceitas. §1.4 | |

🔴 **Em `requires.*`, a chave existe sempre, mas `null` não é `false`.** `false` afirma "não exige";
`null` diz "a companhia não informa". Emitir `false` no lugar de `null` faz quem consome omitir um
campo que a emissão vai pedir.

### 1.3 `source` — consulta viva × tabela documentada

| Valor | Significa |
|---|---|
| `provider` | **A companhia respondeu agora.** `fareChanged`, `amount` e `requires.*` são dela |
| `static-map` | **A companhia não expõe essa consulta.** A resposta veio da documentação dela, mantida por você. Nesse caso `fareChanged`, `amount`, `requires.*` e `label` saem **`null`** |

Este campo existe para ser honesto sobre a origem: publicar uma tabela estática como se fosse
cotação é mentir sobre o que se sabe.

Se a sua companhia não tem endpoint de formas de pagamento, use `static-map` e preencha só o que a
documentação dela garante.

### 1.4 `methods[]` — a forma de pagamento

| Campo | Tipo | Descrição | Valores |
|---|---|---|---|
| `method.type` | `string` | **O tipo canônico.** É por ele que quem consome ramifica e traduz | `credit-card` \| `debit-card` \| `invoice` \| `cash` \| `bank-transfer` \| `voucher` \| `loyalty-points` \| `wallet` \| `pix` \| `bank-slip` |
| `method.code` | `integer` \| `string` \| `null` | 🔴 **O código que a EMISSÃO exige.** `null` = a companhia não tem código de método, e o valor a enviar é a bandeira do cartão |
| `method.typeCode` | `integer` \| `string` \| `null` | Subtipo, quando a companhia distingue |
| `label` | `string` \| `null` | Rótulo **cru da companhia** |
| `requiresManualAuthorization` | `boolean` \| `null` | A companhia exige autorização manual para esta forma |
| `cardBrands[]` | `array` | `{code, name}`. Vazio fora de cartão. `name: null` quando a companhia não documenta o nome de uma bandeira |

🔴 **Localize por `method.type`, NUNCA por `label`.** O rótulo é texto da companhia, muda entre elas
para a mesma coisa e prende a interface no idioma da primeira resposta. Ver
[`01-convencoes.md`](01-convencoes.md) §5.

🔴 **`method.code` é o que o `/issue` consome.** Se a sua companhia identifica a forma por um código
próprio, é ele que vai aqui. Se ela identifica pela bandeira do cartão, `code` é `null` e a
identificação vem de `cardBrands[].code`.

**Lista vazia de métodos LANÇA** (502): uma companhia que responde a consulta de pagamento sem
nenhuma forma não está dizendo "não aceita nada" — está quebrada.

---

## 2. `POST /financing-options`

Só faz sentido quando a forma escolhida é cartão parcelado.

### 2.1 Request

```json
{
  "options": { "provider": "acme-air", "currency": "BRL" },
  "financingOptions": {
    "booking": { "locator": "ABC123" },
    "payment": {
      "paymentMethod": 2,
      "paymentMethodType": 6,
      "creditCard": { "brand": 1, "number": "444433", "expiryDate": "03/2030" }
    },
    "totalAmount": 915.73
  }
}
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `options.provider` | `string` | **sim** | |
| `options.currency` | `string(3)` | não | Rótulo, quando a companhia não declara moeda |
| `financingOptions.booking` | `object` | **sim** | `locator` |
| `financingOptions.payment.paymentMethod` | `integer` \| `string` | condicional | O `method.code` do `/payment-options` |
| `financingOptions.payment.paymentMethodType` | `integer` \| `string` | condicional | O `method.typeCode` |
| `financingOptions.payment.creditCard.brand` | `integer` \| `string` | condicional | O `cardBrands[].code` |
| `financingOptions.payment.creditCard.number` | `string` | condicional | 🔴 **Algumas companhias cotam pelo BIN** — os 6 primeiros dígitos bastam. Não peça o cartão inteiro se você só precisa do BIN |
| `financingOptions.totalAmount` | `number` | condicional | Valor a parcelar, quando a companhia não o infere da reserva |
| `financingOptions.rateTokens` | `string` | condicional | 🔴 Algumas companhias cotam parcelamento pela **tarifa da busca**, não pela reserva. Ver §2.4 |

### 2.2 Response

```json
{
  "success": true,
  "data": {
    "provider": "acme-air", "locator": "ABC123", "currency": "BRL",
    "source": "provider",
    "minInstallmentAmount": { "currency": "BRL", "total": 30.00 },
    "plans": [
      { "installments": 1, "financingId": 21, "cardBrand": null, "interestFree": true,
        "interest": { "monthlyPercent": null, "amount": { "currency": "BRL", "total": 0 } },
        "installmentAmount":      { "currency": "BRL", "total": 915.73 },
        "firstInstallmentAmount": { "currency": "BRL", "total": 915.73 },
        "totalAmount":            { "currency": "BRL", "total": 915.73 } },
      { "installments": 6, "financingId": 26, "cardBrand": null, "interestFree": false,
        "interest": { "monthlyPercent": null, "amount": { "currency": "BRL", "total": 86.27 } },
        "installmentAmount":      { "currency": "BRL", "total": 148.02 },
        "firstInstallmentAmount": { "currency": "BRL", "total": 261.90 },
        "totalAmount":            { "currency": "BRL", "total": 1002.00 } }
    ]
  },
  "meta": { "provider": "acme-air", "operation": "financingOptions",
            "correlationId": "req-fin-001", "timestamp": "2026-08-26T14:02:00.000Z" }
}
```

| Campo | Tipo | Descrição | Valores |
|---|---|---|---|
| `source` | `string` | Origem da resposta | `provider` (cotação real) \| `static-rules` (tabela da documentação) |
| `minInstallmentAmount` | `{currency, total}` \| `null` | Parcela mínima que a companhia aceita | |
| `plans[]` | `array` | Os planos. §2.3 | |

### 2.3 `plans[]`

| Campo | Tipo | Descrição |
|---|---|---|
| `installments` | `integer` \| `null` | Número de parcelas |
| `financingId` | `integer` \| `string` \| `null` | 🔴 **O identificador do plano, que volta no `/issue`.** `null` quando a companhia não identifica o plano — algumas devolvem um id que é da **cotação**, não do plano, e nesse caso emitir `null` é o correto |
| `cardBrand` | `{code, name}` \| `null` | Bandeira, quando o plano é específico dela |
| `interestFree` | `boolean` \| `null` | **Sem juros.** É o único fato sobre juros que praticamente toda companhia consegue afirmar — por isso ele vive fora de `interest` |
| `interest.monthlyPercent` | `number` \| `null` | Percentual **mensal**. `null` quando a companhia não informa, ou informa um percentual **de período indefinido** |
| `interest.amount` | `{currency, total}` \| `null` | Juros em dinheiro |
| `installmentAmount` | `{currency, total}` \| `null` | Valor de cada parcela |
| `firstInstallmentAmount` | `{currency, total}` \| `null` | A primeira pode diferir |
| `totalAmount` | `{currency, total}` \| `null` | Total com juros. Da companhia quando ela informa; senão `1ª + demais × (n−1)`. **`null` quando não dá para saber — nunca estimado** |

🔴 **`interest.monthlyPercent` não é comparável entre companhias.** Algumas informam percentual,
outras só o valor em dinheiro, outras um percentual cujo **período não está documentado**. Um
percentual de período desconhecido publicado como "mensal" é um número errado na tela.
**`interestFree` é o campo comum**; o resto é `null` quando não há certeza.

**`plans: []` é resposta LEGÍTIMA** — acontece quando o valor está abaixo da parcela mínima. Aqui,
diferente do `/payment-options`, lista vazia **não** é erro.

### 2.4 Quando a companhia coteia pela BUSCA, não pela reserva

Algumas companhias cotam parcelamento a partir do **identificador da tarifa da busca**, não do
localizador. Mandar o localizador ali devolve um erro obscuro delas.

Se for o seu caso: exija `rateTokens` e, quando ele faltar, responda
**422 `BUSINESS_RULE_VIOLATION` ANTES de chamar a companhia**, com uma mensagem dizendo o que falta.
Deixar o erro dela vazar como 502 manda quem consome investigar a rede quando o problema é o corpo.

---

## 3. `POST /issue` — emitir

### 3.1 Request

```json
{
  "options": { "provider": "acme-air" },
  "issue": {
    "booking": { "locator": "ABC123" },
    "acceptFareChange": false,
    "payment": {
      "paymentMethod": 2,
      "paymentMethodType": 6,
      "billedAmount": 915.73,
      "creditCard": {
        "number": "4444333322221111", "brand": 1, "cvv": "737",
        "expiryDate": "12/2028", "holderName": "JOAO SILVA",
        "installments": 6, "financingId": 26, "holderCpf": "11122233344"
      }
    }
  }
}
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `options.provider` | `string` | **sim** | |
| `issue.booking` | `object` | **sim** | `locator`. Algumas companhias exigem também `bookingToken` ou `orderIdentifier` |
| `issue.acceptFareChange` | `boolean` | não (default `false`) | **Confirma a emissão mesmo com o preço alterado.** §3.3 |
| `issue.payment.paymentMethod` | `integer` \| `string` | condicional | O `method.code` do `/payment-options` |
| `issue.payment.paymentMethodType` | `integer` \| `string` | condicional | O `method.typeCode` |
| `issue.payment.billedAmount` | `number` | condicional | **Valor a cobrar.** Ausente = total da reserva. Em algumas companhias serve de **âncora**: divergir do saldo vivo → 409 |
| `issue.payment.creditCard` | `object` | condicional | §3.2 |

### 3.2 `creditCard`

| Campo | Tipo | Descrição |
|---|---|---|
| `number` | `string` | |
| `brand` | `string` \| `integer` | 🔴 **Algumas companhias usam CÓDIGO NUMÉRICO** de bandeira, outras a sigla. O valor vem de `cardBrands[].code` do `/payment-options` — copie de lá |
| `cvv` | `string` | |
| `expiryDate` | `string` | `MM/AAAA`. `"12/2028"` |
| `holderName` | `string` | |
| `installments` | `integer` | |
| `financingId` | `integer` \| `string` | O `plans[].financingId` do `/financing-options` |
| `holderCpf` | `string` | **Exigido por algumas companhias** para cobrar |
| `holderEmail` / `holderPhone` | `string` | Conforme a companhia |
| `billingAddress` | `object` | Endereço de cobrança, quando exigido |

### 3.3 🔴 O gate de re-tarifa

Antes de emitir, **reconfira o preço na companhia**:

```
1. Reconfira o preço  (é o mesmo sinal que fareChanged do /payment-options carrega)

2. Preço MUDOU e acceptFareChange !== true
   →  409 FARE_PRICE_CHANGED   (não emite)

3. Preço MUDOU e acceptFareChange === true
   →  emite pelo preço NOVO

4. Tarifa SUMIU
   →  409 FARE_UNAVAILABLE

5. Reserva JÁ emitida e sem pendência
   →  409 RESOURCE_CONFLICT  ("Booking already has tickets")

6. Reserva JÁ emitida COM saldo pendente
   →  pula o gate e paga só o saldo
```

### 3.4 🔴 O `/issue` cobra TUDO que está pendurado

A tarifa **mais** o assento pago marcado em [`09`](09-assentos.md) **mais** a bagagem e os serviços
pendurados em [`10`](10-ancillaries.md) — numa chamada só do ponto de vista de quem consome.

Do seu lado, quantas transações isso vira depende da companhia:

| Modelo | Como implementar |
|---|---|
| Um pagamento só | A companhia cobra tudo junto |
| Autorizações separadas **no mesmo cartão** | Uma por documento, sequencialmente |
| **Duas chamadas**: tarifa na forma pedida, extras sempre no cartão | Algumas companhias só aceitam cartão para o extra, mesmo com a tarifa faturada |

🔴 **Um extra recusado NÃO desfaz o bilhete.** Se a tarifa emitiu e o extra falhou, a resposta é
**200** com o bilhete em `tickets[]` e o extra em `emds[]` com `status: "failed"` e `message`. Nunca
lance depois que o bilhete saiu — ele existe, e quem consome precisa saber disso.

### 3.5 Response

```json
{
  "success": true,
  "data": {
    "provider": "acme-air",
    "locator": "ABC123",
    "committed": true,
    "confirmed": true,
    "queued": false,
    "amount": { "currency": "BRL", "total": 1090.73 },
    "authorizationCode": "005705",
    "tickets": [
      { "ticketNumber": "9990012345678", "type": "flight",
        "passengerId": "1", "passengerName": "CARLOS ANDRADE",
        "status": "issued", "providerStatus": "Ativo",
        "issueDate": "2026-08-26T23:18:46.000Z", "cancelToken": null,
        "company": { "code": "G3", "name": "Acme Air" },
        "amount": { "currency": "BRL", "total": 915.73 }, "message": null }
    ],
    "emds": [
      { "ticketNumber": "9994400012345", "type": "baggage",
        "passengerId": "1", "passengerName": "CARLOS ANDRADE",
        "status": "issued", "providerStatus": "Ativo",
        "issueDate": "2026-08-26T23:18:47.000Z", "cancelToken": null,
        "company": { "code": "G3", "name": "Acme Air" },
        "amount": { "currency": "BRL", "total": 175.00 }, "message": null }
    ],
    "messages": [ { "code": "AUTH", "text": "AUTH 035777" } ]
  },
  "meta": { "provider": "acme-air", "operation": "issue",
            "correlationId": "req-issue-001", "timestamp": "2026-08-26T23:18:48.000Z" }
}
```

| Campo | Tipo | Significado exato |
|---|---|---|
| `provider` / `locator` | | |
| `committed` | `boolean` | **A companhia aceitou e persistiu a emissão** |
| `confirmed` | `boolean` \| **`null`** | 🔴 **A companhia DEVOLVEU o número do bilhete.** §3.6 |
| `queued` | `boolean` | A companhia **enfileirou** para processar depois — a emissão não terminou nesta chamada |
| `amount` | `{currency, total}` \| `null` | **O que foi REALMENTE cobrado.** `null` quando a companhia não informa o valor |
| `authorizationCode` | `string` \| `null` | Código de autorização da transação |
| `tickets[]` | `array` | **Documentos de voo.** §3.7 |
| `emds[]` | `array` | **Documentos de serviço extra** (bagagem, assento). Mesmo shape. Vazio quando nada estava pendurado, ou quando a companhia não os expõe |
| `messages[]` | `array` | `{code, text}` — avisos crus da companhia. Repasse sem traduzir |

### 3.6 `confirmed` na emissão

| Situação | `confirmed` |
|---|---|
| A companhia **devolve o número do bilhete** | `true` |
| A companhia **não devolve** número nenhum, e você não releu | **`null`** |
| A companhia respondeu 200 **sem erro e sem bilhete** — nada materializou | **`false`** |

🔴 **`false` aqui é real e acontece.** Uma companhia responde 200, sem erro, e simplesmente não
emitiu nada. Ver [`01-convencoes.md`](01-convencoes.md) §7.

Onde a companhia não devolve o número, **releia o bilhete** ([`12`](12-cancelar-bilhete.md)) para
transformar `null` em `true`/`false`.

### 3.7 O documento (`tickets[]` e `emds[]`)

| Campo | Tipo | Descrição | Valores |
|---|---|---|---|
| `ticketNumber` | `string` \| `null` | Número do documento | |
| `type` | `string` | Natureza | `flight` (em `tickets[]`) \| `baggage` \| `seat` \| `other` (em `emds[]`) |
| `passengerId` | `string` \| `null` | | |
| `passengerName` | `string` \| `null` | | |
| `status` | `string` | §3.8 | `issued` \| `failed` \| `voided` \| `refunded` \| `unknown` |
| `providerStatus` | `string` \| `null` | Status **cru** da companhia | `"Ativo"`, `"TE"`, `"ISSUED"` |
| `issueDate` | `string` \| `null` | ISO-8601 | |
| `cancelToken` | `string` \| `null` | Token que a anulação exige, quando a companhia trabalha assim | |
| `company` | `object` | `{code, name}` | |
| `amount` | `{currency, total}` \| `null` | Valor deste documento | |
| `message` | `string` \| `null` | Motivo, quando `failed` | |

### 3.8 Os `status` do documento

| Valor | Significa |
|---|---|
| `issued` | Emitido |
| `failed` | **Só em `emds[]`.** O extra não materializou; `message` diz por quê. O bilhete de voo, se falhou, é erro — não um documento com status |
| `voided` | Anulado |
| `refunded` | Reembolsado |
| `unknown` | **Status da companhia fora do mapa** |

🔴 **Status desconhecido vira `unknown`, NUNCA `issued`.** Assumir emissão a partir de um status que
você não reconhece é a forma mais direta de reportar uma venda que não existe.

---

## 4. Casos de borda

| Cenário | Rota | HTTP | `error.code` |
|---|---|---|---|
| Corpo inválido | todas | **400** | `SEARCH_VALIDATION_ERROR` |
| Localizador inexistente | todas | **404** | `RESOURCE_NOT_FOUND` |
| **Preço mudou** e não foi confirmado | `/issue` | **409** | `FARE_PRICE_CHANGED` — reenvie com `acceptFareChange: true` |
| **Tarifa sumiu** | `/issue` | **409** | `FARE_UNAVAILABLE` |
| **Reserva já emitida, sem pendência** | `/issue` | **409** | `RESOURCE_CONFLICT` |
| **Extra pago pendurado e nenhum cartão** | `/issue` | **200** | O bilhete sai; o extra volta `emds[].status: "failed"` com `message` |
| **Reserva já emitida com saldo e nenhum cartão** | `/issue` | **422** | `BUSINESS_RULE_VIOLATION` |
| **Identificador da tarifa da busca ausente**, na companhia que exige | `/financing-options` | **422** | `BUSINESS_RULE_VIOLATION`, antes de chamar a companhia |
| Lista de formas **vazia** | `/payment-options` | **502** | `PROVIDER_INTEGRATION_ERROR` — a companhia respondeu quebrado |
| `plans: []` | `/financing-options` | **200** | Legítimo (valor abaixo da parcela mínima) |
| A companhia não faz a operação | todas | **501** | `CAPABILITY_NOT_SUPPORTED` |
| Regra da companhia | todas | **422** | `BUSINESS_RULE_VIOLATION` |
| Companhia quebrada | todas | **502** | `PROVIDER_INTEGRATION_ERROR` |
| Timeout | todas | **504** | `PROVIDER_TIMEOUT` |

> **`/payment-options` costuma não ter 501**: mesmo quando a companhia não expõe consulta, você pode
> responder pela documentação dela com `source: "static-map"`. Já o `/financing-options` responde
> 501 quando a companhia simplesmente não parcela.

---

## 5. Exemplos

### 5.1 `/payment-options` — companhia que não expõe consulta

```json
{
  "success": true,
  "data": {
    "provider": "acme-air", "locator": "ABC123", "currency": "BRL",
    "source": "static-map",
    "fareChanged": null, "amount": null,
    "requires": { "securityKey": null, "securityToken": null,
                  "passengerDocument": null, "tourCode": null },
    "methods": [
      { "method": { "type": "credit-card", "code": null, "typeCode": null },
        "label": null, "requiresManualAuthorization": null,
        "cardBrands": [ { "code": "VI", "name": "Visa" }, { "code": "MC", "name": "Mastercard" },
                        { "code": "AX", "name": "Amex" }, { "code": "EL", "name": "Elo" } ] },
      { "method": { "type": "invoice", "code": "AG", "typeCode": null },
        "label": null, "requiresManualAuthorization": null, "cardBrands": [] }
    ]
  },
  "meta": { "provider": "acme-air", "operation": "paymentOptions",
            "correlationId": "req-pay-002", "timestamp": "2026-08-26T14:00:00.000Z" }
}
```

Tudo que a companhia não garante sai `null` — e `source` diz por quê.

### 5.2 `/financing-options` — tabela documentada

```json
{
  "success": true,
  "data": {
    "provider": "acme-air", "locator": "ABC123", "currency": "BRL",
    "source": "static-rules",
    "minInstallmentAmount": { "currency": "BRL", "total": 30.00 },
    "plans": [
      { "installments": 1, "financingId": null, "cardBrand": null, "interestFree": true,
        "interest": { "monthlyPercent": null, "amount": null },
        "installmentAmount": null, "firstInstallmentAmount": null, "totalAmount": null },
      { "installments": 5, "financingId": null, "cardBrand": null, "interestFree": true,
        "interest": { "monthlyPercent": null, "amount": null },
        "installmentAmount": null, "firstInstallmentAmount": null, "totalAmount": null },
      { "installments": 6, "financingId": null, "cardBrand": null, "interestFree": false,
        "interest": { "monthlyPercent": 1.99, "amount": null },
        "installmentAmount": null, "firstInstallmentAmount": null, "totalAmount": null }
    ]
  },
  "meta": { "provider": "acme-air", "operation": "financingOptions",
            "correlationId": "req-fin-002", "timestamp": "2026-08-26T14:02:00.000Z" }
}
```

A documentação garante quantas parcelas e se há juros; **não** garante os valores. Eles saem `null`.

### 5.3 `/issue` — faturado, sem extras

```json
{
  "options": { "provider": "acme-air" },
  "issue": {
    "booking": { "locator": "ABC123" },
    "payment": { "paymentMethod": 1, "paymentMethodType": 2 }
  }
}
```

```json
{
  "success": true,
  "data": {
    "provider": "acme-air", "locator": "ABC123",
    "committed": true, "confirmed": true, "queued": false,
    "amount": { "currency": "BRL", "total": 915.73 },
    "authorizationCode": null,
    "tickets": [
      { "ticketNumber": "9990012345678", "type": "flight",
        "passengerId": "1", "passengerName": "CARLOS ANDRADE",
        "status": "issued", "providerStatus": "Ativo",
        "issueDate": "2026-08-26T23:18:46.000Z", "cancelToken": null,
        "company": { "code": "G3", "name": "Acme Air" },
        "amount": { "currency": "BRL", "total": 915.73 }, "message": null }
    ],
    "emds": [],
    "messages": []
  },
  "meta": { "provider": "acme-air", "operation": "issue",
            "correlationId": "req-issue-002", "timestamp": "2026-08-26T23:18:48.000Z" }
}
```

### 5.4 `/issue` — cartão parcelado, com bagagem e assento pendurados

```json
{
  "options": { "provider": "acme-air" },
  "issue": {
    "booking": { "locator": "ABC123" },
    "acceptFareChange": true,
    "payment": {
      "paymentMethod": 2, "paymentMethodType": 6, "billedAmount": 1090.73,
      "creditCard": { "number": "4444333322221111", "brand": 1, "cvv": "737",
                      "expiryDate": "12/2028", "holderName": "CARLOS ANDRADE",
                      "installments": 6, "financingId": 26, "holderCpf": "11122233344" }
    }
  }
}
```

```json
{
  "success": true,
  "data": {
    "provider": "acme-air", "locator": "ABC123",
    "committed": true, "confirmed": true, "queued": false,
    "amount": { "currency": "BRL", "total": 1130.73 },
    "authorizationCode": "005705",
    "tickets": [
      { "ticketNumber": "9990012345680", "type": "flight",
        "passengerId": "1", "passengerName": "CARLOS ANDRADE",
        "status": "issued", "providerStatus": "Ativo",
        "issueDate": "2026-08-26T23:20:11.000Z", "cancelToken": null,
        "company": { "code": "G3", "name": "Acme Air" },
        "amount": { "currency": "BRL", "total": 915.73 }, "message": null }
    ],
    "emds": [
      { "ticketNumber": "9994400012346", "type": "baggage",
        "passengerId": "1", "passengerName": "CARLOS ANDRADE",
        "status": "issued", "providerStatus": "Ativo",
        "issueDate": "2026-08-26T23:20:12.000Z", "cancelToken": null,
        "company": { "code": "G3", "name": "Acme Air" },
        "amount": { "currency": "BRL", "total": 175.00 }, "message": null },
      { "ticketNumber": "9994400012347", "type": "seat",
        "passengerId": "1", "passengerName": "CARLOS ANDRADE",
        "status": "issued", "providerStatus": "Ativo",
        "issueDate": "2026-08-26T23:20:13.000Z", "cancelToken": null,
        "company": { "code": "G3", "name": "Acme Air" },
        "amount": { "currency": "BRL", "total": 40.00 }, "message": null }
    ],
    "messages": [ { "code": "AUTH", "text": "AUTH 035777" },
                  { "code": null, "text": "VERIFY CARDHOLDER SIGNATURE" } ]
  },
  "meta": { "provider": "acme-air", "operation": "issue",
            "correlationId": "req-issue-003", "timestamp": "2026-08-26T23:20:14.000Z" }
}
```

### 5.5 `/issue` — bilhete saiu, extra falhou

```json
{
  "success": true,
  "data": {
    "provider": "acme-air", "locator": "ABC123",
    "committed": true, "confirmed": true, "queued": false,
    "amount": { "currency": "BRL", "total": 915.73 },
    "authorizationCode": null,
    "tickets": [
      { "ticketNumber": "9990012345681", "type": "flight",
        "passengerId": "1", "passengerName": "CARLOS ANDRADE",
        "status": "issued", "providerStatus": "ISSUED",
        "issueDate": "2026-08-27T10:04:00.000Z", "cancelToken": null,
        "company": { "code": "G3", "name": "Acme Air" },
        "amount": { "currency": "BRL", "total": 915.73 }, "message": null }
    ],
    "emds": [
      { "ticketNumber": null, "type": "baggage",
        "passengerId": "1", "passengerName": "CARLOS ANDRADE",
        "status": "failed", "providerStatus": null,
        "issueDate": null, "cancelToken": null,
        "company": { "code": "G3", "name": "Acme Air" },
        "amount": null,
        "message": "Ancillary charge requires a credit card; none was provided." }
    ],
    "messages": []
  },
  "meta": { "provider": "acme-air", "operation": "issue",
            "correlationId": "req-issue-004", "timestamp": "2026-08-27T10:04:01.000Z" }
}
```

**200, não erro.** O bilhete existe.

### 5.6 Preço mudou — 409

```json
{
  "success": false,
  "error": { "code": "FARE_PRICE_CHANGED", "category": "conflict" },
  "message": "The fare price changed since it was quoted.",
  "correlationId": "req-issue-changed-001",
  "provider": "acme-air",
  "providerError": {
    "provider": "acme-air", "operation": "issue", "providerCode": null,
    "providerMessage": "Fare amount differs from the quoted value",
    "providerSeverity": null, "httpStatus": 200
  },
  "details": null,
  "metadata": { "operation": "issue", "duration": 3120 }
}
```

---

## 6. Checklist

- [ ] `method.type` é canônico; `label` é cru e **não** se usa para localizar.
- [ ] `method.code` é o valor que o `/issue` consome.
- [ ] `requires.*`: `null` ≠ `false`.
- [ ] `source` diz honestamente se a resposta veio da companhia ou da documentação dela.
- [ ] Lista de formas vazia → 502; `plans: []` → 200.
- [ ] `interestFree` sempre que possível; percentual só quando o período é conhecido.
- [ ] `totalAmount` nunca estimado.
- [ ] Gate de re-tarifa antes de emitir, com `acceptFareChange` como escape.
- [ ] A emissão cobra a tarifa **e tudo que está pendurado**.
- [ ] Extra que falha **não** desfaz o bilhete — vira `emds[].failed` num 200.
- [ ] `confirmed` só é `true` com o número do bilhete em mãos; `false` existe e é real.
- [ ] Status desconhecido → `unknown`, nunca `issued`.
- [ ] **Nunca retentar a emissão automaticamente.**
