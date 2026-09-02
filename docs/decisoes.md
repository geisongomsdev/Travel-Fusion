# Decisões de integração

Onde o contrato e a Travelfusion não se encaixam, e o que foi escolhido.

---

## 1. Classificação do provedor: **pacote declarado**

A pergunta que classifica (`04-availability-formatos.md` §2) é: *o provedor diz o que combina com o
quê?* A Travelfusion diz — o `RoutingId` mais `OutwardId`/`ReturnId` endereçam um itinerário
precificado que cobre todas as pernas.

Consequência na matriz:

| Tipo de viagem | Caixa preenchida |
|---|---|
| `oneway` | `departure[]` |
| `roundtrip` | `groups[]` (as três chaves existem; `departure`/`return` ficam vazias) |
| `multicity` | `itineraries[]` |

**Nunca parear pernas por conta própria.** A medição citada na spec mostrou 67% dos pares montáveis
visualmente sendo recusados na reserva.

---

## 2. `/booking` × `/issue` — o atrito estrutural

O contrato separa **reservar** (segura o assento, não cobra) de **emitir** (o dinheiro sai). A
Travelfusion não tem essa separação: os dados de pagamento vão no `ProcessTerms` e o `StartBooking`
já é a compra.

**Decisão:** `/booking` executa o fluxo inteiro (`ProcessTerms` → `StartBooking` → `CheckBooking`) e
`/issue` responde **501 `CAPABILITY_NOT_SUPPORTED`**.

A alternativa — `/booking` guardar estado local e `/issue` disparar o provedor — foi descartada por
enquanto: criaria uma reserva que existe só do nosso lado, sem assento segurado, e o contrato promete
que depois do `/booking` o localizador existe.

> Isto é uma decisão em aberto. Se a plataforma precisar do gate de aprovação entre reservar e
> emitir, a segunda opção volta à mesa — mas aí `/booking` passa a devolver `locator: null`, e isso
> precisa ser combinado com quem consome.

---

## 3. Bagagem chega antes do que o contrato espera

O contrato pendura o extra **depois** da reserva (`/sell-ancillaries`). A Travelfusion exige a
escolha **antes**, dentro do `ProcessTerms` — e só aceita **um** `ProcessTerms`.

**Decisão:** os extras aparecem no `/quote` (`data.requiredParameters[]`, já com o `DisplayText`
parseado) e são enviados no corpo do `/booking`. `/ancillaries` e `/sell-ancillaries` respondem 501,
com a explicação na descrição do Swagger.

---

## 4. `committed` ≠ `confirmed`

O mapeamento é direto e é a regra mais importante do contrato:

| Travelfusion | `committed` | `confirmed` |
|---|---|---|
| `Succeeded` | `true` | `true` |
| `BookingInProgress`, `Unconfirmed`, `UnconfirmedBySupplier` | `true` | `false` |
| `Failed` | — | erro 422 |
| `Duplicate` | — | erro 409 |

`confirmed` **nunca** é deduzido de `committed`. Status não-final não autoriza re-reservar: casos
travados vão para `bsm@travelfusion.com`.

---

## 5. Polling exposto como stream

O `CheckRouting` é incremental — resultados já devolvidos não voltam. A acumulação é nossa, e cada
passada que traz rota nova poderia virar um `provider_success`.

**Hoje** emitimos um `provider_success` só, ao final do polling. Com mais de um fornecedor
habilitado na branch, vale emitir um por fornecedor conforme ele completa — é o que o contrato
espera (`Use provider_success para preencher a tela progressivamente`).

---

## 6. "Sem voos" não é erro

Chega como `provider_error` com `data.error.code = "NO_FLIGHTS"` e **sem** `canonicalCode`, o stream
segue e termina em `complete`. Quem consome discrimina por `canonicalCode`, nunca por `type`.

---

## 7. O que ainda não está ligado

`/retrieve` e `/fare-rules` têm equivalente na Travelfusion (`CheckBooking` e o bloco de termos do
`ProcessDetails`) mas ainda respondem 501. É dívida conhecida, não limitação do provedor — está
marcado assim na descrição de cada rota.
