# 07 — Cancelar a reserva: `POST /cancel-booking`

Cancela uma reserva na companhia. Síncrona.

Diferente de [`12-cancelar-bilhete.md`](12-cancelar-bilhete.md): esta rota cancela **a reserva**;
aquela anula ou reembolsa **um bilhete já emitido**. Numa reserva ainda não emitida, só esta faz
sentido.

> Termo novo? Está no [`00-glossario.md`](00-glossario.md).

---

## 1. Request

```json
{
  "provider": "acme-air",
  "cancel": {
    "booking": { "locator": "ABC123" },
    "options": {
      "etickets": true,
      "reason": "Cancelamento solicitado pelo cliente",
      "refundType": "Refund",
      "notifyContacts": "Email",
      "comments": ["Cancelamento solicitado pelo cliente final."]
    }
  }
}
```

| Campo | Tipo | Obrigatório | Descrição | Valores |
|---|---|---|---|---|
| `provider` | `string` | **sim** | Provedor da reserva | |
| `cancel.booking` | `object` | **sim** | Endereço da reserva. §1.1 | |
| `cancel.options.etickets` | `boolean` | não (**default `true`**) | Cancelar também os bilhetes emitidos, quando houver | |
| `cancel.options.reason` | `string` | não | Motivo, texto livre | |
| `cancel.options.refundType` | `string` | não | Como devolver o valor | `OrderCreditShell` \| `Refund` \| `Voucher` \| `None` |
| `cancel.options.notifyContacts` | `string` | não (**default `None`**) | Se a companhia deve notificar os contatos da reserva | `None` \| `All` \| `Email` |
| `cancel.options.journeyKeys[]` | `string[]` | não | Cancelar só os trechos listados, quando a companhia permite cancelamento parcial |
| `cancel.options.comments[]` | `string[]` | não | Observações a gravar na reserva |
| `cancel.options.segment` | `string` | não | Trecho específico, quando aplicável |

### 1.1 `cancel.booking` — o endereço da reserva

Bloco **idêntico em todas as rotas pós-reserva**:

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `locator` | `string` | **sim** | O localizador devolvido pela reserva |
| `bookingToken` | `string` | condicional | Quando a sua companhia endereça por token |
| `orderIdentifier` | `string` | condicional | Quando a sua companhia usa um identificador de pedido |
| `source` | `string` | não | Fonte/sistema da reserva |

---

## 2. Response

**HTTP 200.** `data` é **canônico** — mesmo shape qualquer que seja a companhia.

```json
{
  "success": true,
  "data": {
    "locator": "ABC123",
    "status": "CANCELLED",
    "outcome": "VOID",
    "provider": "acme-air",
    "cancelledAt": "2026-05-09T12:04:00.000Z",
    "message": "Cancelamento concluído.",
    "eticketsCancelled": true,
    "refund": { "amount": 0, "currency": "BRL", "status": "VOID" },
    "tickets": [
      { "ticketNumber": "9990012345678", "status": "voided" }
    ]
  },
  "meta": { "provider": "acme-air", "operation": "cancelBooking",
            "correlationId": "req-cancel-001", "duration": 2840,
            "timestamp": "2026-05-09T12:04:00.000Z" }
}
```

| Campo | Tipo | Sempre presente | Descrição | Valores |
|---|---|---|---|---|
| `locator` | `string` \| `null` | sim | O localizador cancelado | |
| `status` | `string` | sim | Resultado da operação | `CANCELLED` \| `ERROR` |
| `outcome` | `string` \| `null` | sim | **O que aconteceu com o dinheiro.** §2.1 | `VOID` \| `REFUND` \| `PROCESSED` \| `UNKNOWN` \| `null` |
| `provider` | `string` | sim | | |
| `cancelledAt` | `string` \| `null` | sim | Momento do cancelamento, ISO-8601 | |
| `message` | `string` \| `null` | sim | Mensagem da companhia, quando houver | |
| `eticketsCancelled` | `boolean` | sim | Se os bilhetes também foram cancelados | |
| `refund` | `object` | sim | `{amount, currency, status}` — todos podem ser `null`. Ausente/nulos numa reserva não emitida | |
| `tickets[]` | `array` | sim | Bilhetes afetados. **`[]` numa reserva em espera** (não havia bilhete) | |

### 2.1 🔴 `outcome` — anulado ou reembolsado?

São coisas **muito** diferentes para quem vendeu:

| Valor | Significa |
|---|---|
| `VOID` | **Anulado.** Cancelado dentro da janela em que a companhia desfaz sem cobrar — geralmente o mesmo dia da emissão. **Não houve movimentação de dinheiro** |
| `REFUND` | **Reembolsado.** Houve devolução, sujeita a multa e a prazo |
| `PROCESSED` | A companhia processou o cancelamento, sem dizer em qual dos dois regimes |
| `UNKNOWN` | A companhia cancelou e não deu nenhum sinal sobre o dinheiro |
| `null` | Não aplicável (reserva não emitida) ou nenhum sinal disponível |

🔴 **`outcome` é lido do estado real dos cupons depois do cancelamento — NUNCA do que foi pedido.**
Mandar `refundType: "Refund"` não significa que houve reembolso: a companhia pode ter anulado, ou
recusado o reembolso por regra tarifária e anulado no lugar. O campo diz **o que aconteceu**, não o
que se pediu.

Se você não consegue ler o estado dos cupons, o valor honesto é `UNKNOWN` — **não** `REFUND`.

---

## 3. Variações

**Não há variação por tipo de viagem.** Cancelar é cancelar a reserva inteira: ida, ida-e-volta e
multidestino têm o mesmo request e o mesmo response.

A única variação real é o **estado da reserva no momento do cancelamento**:

| Estado | O que muda no response |
|---|---|
| **Em espera** (não emitida) | `tickets: []`, `refund` com valores `null`, `eticketsCancelled: false`, `outcome` geralmente `null` |
| **Emitida, dentro da janela de anulação** | `tickets[]` com os bilhetes, `outcome: "VOID"`, `refund.amount: 0` |
| **Emitida, fora da janela** | `outcome: "REFUND"` (com o valor devolvido) **ou** a companhia **recusa** — ver §4 |

### Reserva de várias pernas

Quando a reserva foi criada em duas companhias diferentes, são **duas reservas** — e cada uma se
cancela pela sua rota, com o seu localizador. Não existe cancelamento conjunto.

---

## 4. Casos de borda

| Cenário | HTTP | `error.code` |
|---|---|---|
| Corpo inválido; falta `locator` | **400** | `SEARCH_VALIDATION_ERROR` |
| Localizador inexistente | **404** | `RESOURCE_NOT_FOUND` |
| **Reserva já cancelada** | **409** | `BOOKING_ALREADY_CANCELLED` |
| A companhia recusa por regra (fora da janela, estado não permite) | **422** | `BUSINESS_RULE_VIOLATION` |
| A companhia não suporta cancelamento | **501** | `CAPABILITY_NOT_SUPPORTED` |
| A companhia respondeu quebrado | **502** | `PROVIDER_INTEGRATION_ERROR` |
| A companhia não respondeu no tempo | **504** | `PROVIDER_TIMEOUT` |

### Recancelamento

Companhias costumam recusar o cancelamento de algo já cancelado com uma mensagem própria, às vezes
genérica (do tipo *"o status atual da venda não permite cancelamento"*). **Reconheça essa mensagem e
traduza para 409 `BOOKING_ALREADY_CANCELLED`**, em vez de deixar sair como 502.

A diferença importa: 502 diz "problema técnico, tente de novo"; 409 diz "já está feito, pare". Quem
consome age diferente em cada caso.

### Fora da janela, a companhia RECUSA — ela não reembolsa sozinha

Confirmado com suporte de companhia: cancelar fora da janela de anulação **não vira reembolso
automático**. A operação é **recusada** pela regra tarifária. Não há risco de um estorno silencioso
acontecer só porque a rota foi chamada.

### 🔴 Serviços extras NÃO são cancelados por esta rota

Bagagem paga, assento pago e outros extras são **documentos próprios** — com numeração, cupons e
status separados do bilhete. **Cancelar a reserva não cancela nem estorna esses documentos.**
Cancelamento e estorno de extra é operação à parte.

Se a sua companhia oferece essa operação, ela é uma rota adicional — não um efeito colateral desta.

### 🔴 Anti-sucesso-falso

Cancelamento é o caso clássico de sucesso-falso: a companhia responde 200, e a reserva continua
viva. Ver [`01-convencoes.md`](01-convencoes.md) §7.

**Prove com uma leitura independente.** Depois de cancelar, releia a reserva (`POST /retrieve`) e
confirme o status. Se a releitura não confirmar, o resultado não é sucesso.

Em companhias que exigem um comando explícito de fim de transação, **verifique que ele foi aceito**
— um "ok" no comando de cancelamento sem o commit deixa tudo como estava.

---

## 5. Exemplos

### 5.1 Reserva em espera (não emitida)

**Request**
```json
{
  "provider": "acme-air",
  "cancel": { "booking": { "locator": "ABC123" } }
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "locator": "ABC123", "status": "CANCELLED", "outcome": null,
    "provider": "acme-air", "cancelledAt": "2026-05-09T12:04:00.000Z",
    "message": "Reserva cancelada.", "eticketsCancelled": false,
    "refund": { "amount": null, "currency": null, "status": null },
    "tickets": []
  },
  "meta": { "provider": "acme-air", "operation": "cancelBooking",
            "correlationId": "req-cancel-001", "duration": 1420,
            "timestamp": "2026-05-09T12:04:00.000Z" }
}
```

### 5.2 Reserva emitida, anulada no mesmo dia

**Request**
```json
{
  "provider": "acme-air",
  "cancel": {
    "booking": { "locator": "ABC123", "orderIdentifier": "ACME-ORD-77321" },
    "options": { "etickets": true, "reason": "Desistência do cliente", "notifyContacts": "Email" }
  }
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "locator": "ABC123", "status": "CANCELLED", "outcome": "VOID",
    "provider": "acme-air", "cancelledAt": "2026-05-09T18:32:11.000Z",
    "message": "Bilhetes anulados.", "eticketsCancelled": true,
    "refund": { "amount": 0, "currency": "BRL", "status": "VOID" },
    "tickets": [
      { "ticketNumber": "9990012345678", "status": "voided" },
      { "ticketNumber": "9990012345679", "status": "voided" }
    ]
  },
  "meta": { "provider": "acme-air", "operation": "cancelBooking",
            "correlationId": "req-cancel-002", "duration": 4210,
            "timestamp": "2026-05-09T18:32:11.000Z" }
}
```

### 5.3 Já cancelada — 409

```json
{
  "success": false,
  "error": { "code": "BOOKING_ALREADY_CANCELLED", "category": "conflict" },
  "message": "The booking is already cancelled.",
  "correlationId": "req-cancel-dup-001",
  "provider": "acme-air",
  "providerError": {
    "provider": "acme-air", "operation": "cancelBooking", "providerCode": null,
    "providerMessage": "The current sale status does not allow cancellation.",
    "providerSeverity": null, "httpStatus": 200
  },
  "details": null,
  "metadata": { "operation": "cancelBooking", "duration": 980 }
}
```

---

## 6. Checklist

- [ ] `outcome` vem do estado **real** dos cupons, nunca do `refundType` pedido.
- [ ] Não sei o que houve com o dinheiro → `UNKNOWN`, nunca `REFUND`.
- [ ] Recancelamento → 409 `BOOKING_ALREADY_CANCELLED`, não 502.
- [ ] Releio a reserva para provar o cancelamento; sem prova, não reporto sucesso.
- [ ] `tickets: []` numa reserva não emitida (array vazio, não `null`).
- [ ] Deixo claro que esta rota **não** cancela os documentos de serviço extra.
