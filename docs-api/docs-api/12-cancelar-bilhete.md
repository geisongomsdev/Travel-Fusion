# 12 — Bilhete emitido: `/retrieve-eticket` e `/cancel-eticket`

Duas rotas que operam sobre o **bilhete**, não sobre a reserva.

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/retrieve-eticket` | **Consulta** o bilhete emitido — número, cupons, status |
| `POST` | `/cancel-eticket` | **Anula ou reembolsa** o bilhete |

Diferença para [`07-cancel-booking.md`](07-cancel-booking.md): lá se cancela **a reserva**; aqui, um
**documento** já emitido. Numa reserva não emitida, só a outra faz sentido.

> Termo novo? Está no [`00-glossario.md`](00-glossario.md).

---

## 1. `POST /retrieve-eticket`

### 1.1 Para que serve

Duas coisas, e as duas importam:

1. **Obter o número do bilhete** quando a companhia não o devolve na emissão. Em várias, o `/issue`
   confirma que emitiu mas não diz o número — é aqui que ele aparece.
2. **Provar o efeito.** É a leitura independente que transforma o `confirmed: null` do `/issue` em
   `true` ou `false`. Ver [`01-convencoes.md`](01-convencoes.md) §7.

### 1.2 Request

```json
{
  "options": { "provider": "acme-air" },
  "retrieveEticket": { "eticket": "9990012345678" }
}
```

ou

```json
{
  "options": { "provider": "acme-air" },
  "retrieveEticket": { "booking": { "locator": "ABC123" } }
}
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `options.provider` | `string` | **sim** | |
| `retrieveEticket.eticket` | `string` | **condicional** | O número do bilhete |
| `retrieveEticket.booking` | `object` | **condicional** | Endereço da reserva. Aqui `locator` é **opcional** dentro do bloco |
| `retrieveEticket.booking.locator` | `string` | condicional | |
| `retrieveEticket.booking.orderIdentifier` / `.bookingToken` / `.source` | `string` | condicional | Conforme a sua companhia |
| `retrieveEticket.options.system` | `integer` \| `string` | não | Sistema/GDS, quando a companhia precisa |

🔴 **A regra: pelo menos UM de `eticket` ou `booking.locator`.** Nenhum dos dois → **400**.

**Qual deles a sua companhia aceita é decisão dela**, e você precisa documentar:

| A sua companhia… | Então |
|---|---|
| busca só pelo número do bilhete | `eticket` é obrigatório; sem ele, **400** com mensagem clara |
| busca só pelo localizador | `booking.locator` é obrigatório |
| aceita os dois | qualquer um serve |
| **precisa dos dois** (o localizador resolve de qual sistema o bilhete veio) | exija ambos, e diga isso no 400 |

### 1.3 Response

**HTTP 200.** `data` sai **no formato da companhia** — esta rota não é normalizada.

```json
{
  "success": true,
  "data": {
    "tickets": [
      { "number": "9990012345678", "status": "Ativo",
        "issueDate": "2026-08-26T23:18:46.000Z",
        "coupons": [ { "segment": 1, "status": "OPEN FOR USE" } ] }
    ],
    "ancillaryDocuments": [
      { "number": "9994400012345", "description": "Serviço - BAGAGEM 23KG",
        "currency": "BRL", "amount": 175.00, "status": "Ativo" }
    ]
  },
  "meta": { "provider": "acme-air", "operation": "retrieveEticket",
            "correlationId": "req-tkt-001", "timestamp": "2026-08-27T09:00:00.000Z" }
}
```

**Recomendação forte**, mesmo sem normalização: exponha no topo do `data` o **número**, o **status**
e a **data de emissão** de cada documento, com nomes estáveis. Quem consome usa esta rota
principalmente para responder "o bilhete existe e está válido?" — obrigá-lo a caçar isso num formato
diferente por companhia derrota o propósito.

---

## 2. `POST /cancel-eticket`

### 2.1 Request

```json
{
  "options": { "provider": "acme-air" },
  "cancelEticket": {
    "eticket": "9990012345678",
    "booking": { "locator": "ABC123" },
    "reason": "Cancelamento solicitado pelo cliente",
    "cancelToken": "YWNtZS10b2tlbi0wMDE="
  }
}
```

| Campo | Tipo | Obrigatório | Descrição | Valores |
|---|---|---|---|---|
| `options.provider` | `string` | **sim** | | |
| `cancelEticket.eticket` | `string` | **sim** | O número do bilhete a anular | |
| `cancelEticket.booking` | `object` | condicional | Endereço da reserva, quando a companhia precisa | |
| `cancelEticket.reason` | `string` | não | Motivo, texto livre | |
| `cancelEticket.refundType` | `string` | não | 🔴 **Decide ANULAR × REEMBOLSAR.** §2.2 | `refund` \| `OrderCreditShell` \| `Payment` \| `ExistingCredit` \| `Voucher` |
| `cancelEticket.cancelToken` | `string` | condicional | 🔴 Token que a anulação exige, quando a companhia trabalha assim. **Vem de `tickets[].cancelToken` do `/issue`** — sem ele, algumas companhias tentam usar o número do bilhete como token e falham |
| `cancelEticket.journeyKeys[]` | `string[]` | não | Cancelar só os trechos listados, quando a companhia permite parcial | |

### 2.2 🔴 Anular × reembolsar — decidido por `refundType`

| `refundType` | O que a companhia faz |
|---|---|
| **ausente** | **ANULA** (void). Só funciona dentro da janela da companhia — geralmente o **mesmo dia** da emissão. Não há movimentação de dinheiro |
| preenchido | **REEMBOLSA**, no regime pedido. Sujeito à regra tarifária, com multa e prazo |

**Fora da janela de anulação, a companhia RECUSA** — ela **não** converte para reembolso sozinha.
Confirmado com suporte de companhia: não há risco de um estorno acontecer só porque a rota foi
chamada sem `refundType`.

### 2.3 Response

**HTTP 200.** `data` **no formato da companhia**, como na consulta.

```json
{
  "success": true,
  "data": {
    "ticketNumber": "9990012345678",
    "status": "Cancelado",
    "cancelledAt": "2026-08-27T09:12:00.000Z",
    "refund": { "amount": 0, "currency": "BRL" }
  },
  "meta": { "provider": "acme-air", "operation": "cancelEticket",
            "correlationId": "req-tkt-cancel-001", "timestamp": "2026-08-27T09:12:00.000Z" }
}
```

**Mesma recomendação:** exponha `ticketNumber`, `status` e o que aconteceu com o dinheiro no topo,
com nomes estáveis.

---

## 3. 🔴 Serviços extras NÃO são cancelados por esta rota

Bagagem paga, assento pago e outros extras são **documentos próprios** — numeração, cupons e status
separados do bilhete de voo.

**Anular o bilhete não anula nem estorna esses documentos.** Confirmado com suporte de companhia.
Cancelamento e estorno de serviço extra é **operação à parte**.

Se a sua companhia oferece essa operação, ela é uma rota adicional — não um efeito colateral desta.
Se não oferece, deixe explícito para quem consome: os documentos de serviço **sobrevivem** ao
cancelamento do bilhete, e alguém vai precisar tratá-los manualmente.

---

## 4. Casos de borda

| Cenário | Rota | HTTP | `error.code` |
|---|---|---|---|
| Nem `eticket` nem `booking.locator` | `/retrieve-eticket` | **400** | `SEARCH_VALIDATION_ERROR` |
| Corpo inválido; falta `eticket` | `/cancel-eticket` | **400** | `SEARCH_VALIDATION_ERROR` |
| **Bilhete ou localizador inexistente** | ambas | **404** | `RESOURCE_NOT_FOUND` — nunca um status chutado |
| **Bilhete já cancelado** | `/cancel-eticket` | **409** | `BOOKING_ALREADY_CANCELLED` |
| **Fora da janela de anulação** e a companhia recusa | `/cancel-eticket` | **422** | `BUSINESS_RULE_VIOLATION` |
| `cancelToken` ausente na companhia que o exige | `/cancel-eticket` | **400** | `SEARCH_VALIDATION_ERROR`, **antes** de chamar |
| A companhia não faz a operação | ambas | **501** | `CAPABILITY_NOT_SUPPORTED` |
| A companhia respondeu quebrado | ambas | **502** | `PROVIDER_INTEGRATION_ERROR` |
| Timeout | ambas | **504** | `PROVIDER_TIMEOUT` |

### Quando a companhia não anula por bilhete

Algumas não têm anulação **por documento** — só o cancelamento da reserva inteira, que aplica a
anulação automaticamente quando está dentro da janela.

Nesse caso, `/cancel-eticket` responde **501 `CAPABILITY_NOT_SUPPORTED`**, e a orientação para quem
consome é usar `/cancel-booking`. É a resposta honesta: a operação não existe ali.

### 🔴 Anti-sucesso-falso

**Anulação é o caso clássico.** A companhia responde 200 e o bilhete continua válido. Ver
[`01-convencoes.md`](01-convencoes.md) §7.

**Prove relendo** com `/retrieve-eticket` e confirme o status do documento. Sem essa prova, o
resultado não é sucesso.

Em companhias que exigem um comando de fim de transação, **verifique que ele foi aceito** — um "ok"
no comando de anulação sem o commit deixa tudo como estava.

---

## 5. Exemplos

### 5.1 Consultar por número do bilhete

```json
{
  "options": { "provider": "acme-air" },
  "retrieveEticket": { "eticket": "9990012345678" }
}
```

```json
{
  "success": true,
  "data": {
    "tickets": [
      { "number": "9990012345678", "status": "Ativo",
        "issueDate": "2026-08-26T23:18:46.000Z",
        "passengerName": "CARLOS ANDRADE",
        "coupons": [
          { "segment": 1, "origin": "GRU", "destination": "GIG", "status": "OPEN FOR USE" }
        ] }
    ],
    "ancillaryDocuments": [
      { "number": "9994400012345", "description": "Serviço - BAGAGEM 23KG",
        "currency": "BRL", "amount": 175.00, "status": "Ativo" }
    ]
  },
  "meta": { "provider": "acme-air", "operation": "retrieveEticket",
            "correlationId": "req-tkt-001", "timestamp": "2026-08-27T09:00:00.000Z" }
}
```

### 5.2 Consultar por localizador

```json
{
  "options": { "provider": "acme-air" },
  "retrieveEticket": { "booking": { "locator": "ABC123", "orderIdentifier": "ACME-ORD-77321" } }
}
```

### 5.3 Anular no mesmo dia

```json
{
  "options": { "provider": "acme-air" },
  "cancelEticket": {
    "eticket": "9990012345678",
    "booking": { "locator": "ABC123" },
    "reason": "Desistência do cliente"
  }
}
```

```json
{
  "success": true,
  "data": {
    "ticketNumber": "9990012345678",
    "status": "Cancelado",
    "cancelledAt": "2026-08-26T23:55:00.000Z",
    "refund": { "amount": 0, "currency": "BRL" }
  },
  "meta": { "provider": "acme-air", "operation": "cancelEticket",
            "correlationId": "req-tkt-cancel-001", "timestamp": "2026-08-26T23:55:00.000Z" }
}
```

### 5.4 Reembolso pedido explicitamente

```json
{
  "options": { "provider": "acme-air" },
  "cancelEticket": {
    "eticket": "9990012345678",
    "booking": { "locator": "ABC123" },
    "refundType": "refund",
    "reason": "Cancelamento com reembolso",
    "cancelToken": "YWNtZS10b2tlbi0wMDE="
  }
}
```

### 5.5 Bilhete já cancelado — 409

```json
{
  "success": false,
  "error": { "code": "BOOKING_ALREADY_CANCELLED", "category": "conflict" },
  "message": "The booking is already cancelled.",
  "correlationId": "req-tkt-dup-001",
  "provider": "acme-air",
  "providerError": {
    "provider": "acme-air", "operation": "cancelEticket", "providerCode": null,
    "providerMessage": "The current sale status does not allow cancellation.",
    "providerSeverity": null, "httpStatus": 200
  },
  "details": null,
  "metadata": { "operation": "cancelEticket", "duration": 1040 }
}
```

### 5.6 Companhia sem anulação por bilhete — 501

```json
{
  "success": false,
  "error": { "code": "CAPABILITY_NOT_SUPPORTED", "category": "not_supported" },
  "message": "This provider does not support the requested operation.",
  "correlationId": "req-tkt-cap-001",
  "provider": "acme-air", "details": null,
  "metadata": { "operation": "cancelEticket" }
}
```

---

## 6. Checklist

- [ ] `/retrieve-eticket` aceita `eticket` **ou** `booking.locator`; nenhum dos dois → 400.
- [ ] Documento claramente qual dos dois a minha companhia exige.
- [ ] Exponho número, status e data de emissão no topo do `data`, com nomes estáveis.
- [ ] `refundType` ausente = **anular**; preenchido = **reembolsar**.
- [ ] `cancelToken` exigido antes de chamar, quando a companhia o pede.
- [ ] Deixo explícito que **serviços extras sobrevivem** ao cancelamento do bilhete.
- [ ] Companhia sem anulação por bilhete → 501, orientando para `/cancel-booking`.
- [ ] **Releio o bilhete** para provar a anulação; sem prova, não reporto sucesso.
- [ ] Recancelamento → 409, não 502.
