# 01 — Convenções e vocabulário canônico

Este documento vale para **todas** as rotas. Os outros assumem que você já leu.

Se algum termo aqui for novo para você, ele está no [`00-glossario.md`](00-glossario.md).

---

## 1. Envelope de resposta

Toda resposta bem-sucedida tem exatamente **três chaves** no topo. Sempre as mesmas.

```json
{
  "success": true,
  "data": { },
  "meta": {
    "provider": "acme-air",
    "duration": 3154,
    "timestamp": "2026-06-25T12:01:00.000Z"
  }
}
```

| Campo | Tipo | Sempre presente | O que é |
|---|---|---|---|
| `success` | `boolean` | sim | Sempre `true` no sucesso. É o primeiro campo que quem consome olha |
| `data` | `object` | sim | O resultado. O formato muda por rota — cada documento descreve o seu |
| `meta.provider` | `string` | sim | Qual provedor atendeu |
| `meta.duration` | `integer` | sim | Milissegundos gastos na chamada à companhia |
| `meta.timestamp` | `string` | sim | Momento da resposta, em ISO-8601 |
| `meta.operation` | `string` \| `null` | não | Nome da operação (`quote`, `createBooking`, `assignSeats`…). Presente nas rotas que alteram alguma coisa |
| `meta.correlationId` | `string` \| `null` | não | Identificador da requisição, para citar no suporte |

**Duas exceções:**

- **`/availability`** não usa este envelope — a resposta é um stream de eventos. Ver
  [`03`](03-availability.md).
- **`/booking`** devolve **HTTP 201**; todas as outras devolvem **200**.

**Erro nunca usa este envelope.** O formato de erro está em [`02-erros.md`](02-erros.md).

---

## 2. `quote` × `pricing` — dois nomes para dois preços

Estas duas palavras significam coisas diferentes. Trocar uma pela outra é bug de dinheiro, então
cada uma tem um nome reservado.

### `quote` = tarifar no provedor

Perguntar **à companhia** quanto custa esta oferta, agora, com preço firme. É uma chamada de rede
para um sistema de fora.

É por isso que a rota se chama `POST /quote`.

### `pricing` = margem comercial

Markup, comissão, taxa de serviço — o que **quem revende** acrescenta por cima. É cálculo interno,
não vem da companhia.

**Isso está fora do escopo deste desafio.** Sua API sempre devolve o valor **cru do fornecedor**.

> **Na prática:** se você criar um campo, método ou módulo chamado `pricing`, ele não pode
> significar "tarifar".

---

## 3. A política do `null`

**Regra: `null` é a única forma de ausência.**

Um campo que a companhia não informa sai `null`. Nunca `""`, nunca `0`, nunca `{}`, nunca a chave
omitida.

### Por que isso importa

Porque quem consome precisa distinguir quatro situações que `""` e `0` embaralham:

| Valor | Significa | Exemplo |
|---|---|---|
| `null` | **A companhia não informou.** Nada se sabe | `refundable: null` → não dá para dizer se é reembolsável |
| `0` num campo de dinheiro | **Ela informou zero** | `balanceDue: 0` → está quitado |
| `false` num booleano | **Ela disse que não** | `refundable: false` → não é reembolsável |
| `[]` numa lista | **Ela informou, e não há nenhum** | `tickets: []` → a reserva não tem bilhete |

Repare na diferença entre a primeira e a terceira linha. `null` é "não sei"; `false` é "sei que não".
Mostrar "não reembolsável" quando a verdade é "não sabemos" é dar ao cliente uma informação que
ninguém garantiu.

### Duas regras que vêm daí

**Nunca invente.** Se a companhia não expõe um sinal, o campo é `null`. Deduzir "não incluso" de
"não mencionado" cria informação falsa na tela.

**Nunca deduza um campo a partir de outro.** O caso mais caro disso está na §7.

### Onde `[]` é estrutural, não ausência

Estas listas **sempre existem** como array. Vazias quando não há conteúdo, nunca `null`:

- `fees[]` de uma tarifa ou de um voo
- `penalties[]` das regras tarifárias
- `flights[]` de um trecho
- `segments.return[]` numa viagem só de ida — **não há volta, então é `[]`**
- `tickets[]`, `ancillaries[]`, `contacts[]` na consulta de reserva

### E uma exceção no sentido oposto

**`assignedSeats`** (os assentos que um passageiro já tem) é:

- `null` → a companhia **não informa** quais assentos ele tem
- `[]` → ela informa, e **não há nenhum**

As duas coisas acontecem, e são diferentes.

### A exceção mais importante: chave **ausente** ≠ `null`

Numa oferta de busca, a chave `fares` pode estar **completamente ausente**. Isso não é lacuna — é
informação: *"as tarifas não estão aqui, estão dentro dos trechos"*.

O assunto é o [`04-availability-formatos.md`](04-availability-formatos.md). Por ora, guarde a forma
segura de testar:

```js
if (!oferta.fares)              // ✅ cobre chave ausente E lista vazia
if (oferta.fares.length === 0)  // ❌ estoura quando a chave não existe
```

---

## 4. Identificadores opacos

Vários campos carregam um valor que **só o seu provedor entende**: o identificador de uma oferta, a
chave de uma regra tarifária, a chave de um serviço extra.

### A regra, para quem consome

Copie o valor de onde ele veio e cole onde ele vai. **Sem** interpretar, **sem** remontar, **sem**
reordenar, **sem** deduplicar por prefixo, **sem** guardar como identidade permanente.

### A regra, para você

Você é livre para codificar ali o que precisar — um token da companhia, um base64 de um objeto
JSON, uma referência interna. Mas com duas obrigações:

**1. O valor tem que voltar exatamente como saiu.**

Se ele chegar diferente, você recusa com **400** e a chamada nem vai para a companhia. Chave
corrompida é erro de quem chamou, não falha de integração.

**2. Nunca fabrique uma chave que não funcione.**

Se a companhia não expõe aquilo que a chave endereçaria, o campo é `null`. Quem consome entende que
a operação não existe ali. Uma chave inventada vira um 404 no meio da venda.

### Quando a chave fica grande demais

Algumas companhias exigem identificadores de vários KB, que se repetem em cada tarifa da busca. Numa
medição real, isso levou a resposta de uma busca a 3 MB — metade disso em chaves.

Solução: guarde o payload do seu lado e devolva uma **referência curta**. Nesse caso a referência
**expira**, e a expirada responde **404 `RESOURCE_NOT_FOUND`** — que significa, para quem consome,
*"a busca é velha, busque de novo"*.

---

## 5. Datas, moeda e idioma

### Data e hora

| Formato | Onde se usa | Exemplo |
|---|---|---|
| `YYYY-MM-DD` | Datas de viagem no pedido; data de nascimento | `"2026-06-12"` |
| ISO-8601 com fuso | Horários de voo | `"2026-06-12T08:20:00-03:00"` |
| ISO-8601 em UTC | `timestamp` do `meta` e dos eventos | `"2026-06-25T12:01:00.000Z"` |

🔴 **Horário de voo é hora local do aeroporto.** Não converta para UTC ao repassar: uma partida às
08:20 em Guarulhos tem que continuar 08:20 na resposta. Quem consome exibe esse valor direto na
tela.

### Moeda

Dinheiro aparece em duas formas, e as duas convivem:

```jsonc
// nas rotas depois da reserva (assento, extras, emissão):
"price": { "currency": "BRL", "total": 88.00 }        // ou null

// na busca e no tarifar, dentro da tarifa:
"price": { "total": { "currency": "BRL", "total": 1280.45, "base": 1040.00, ... } }
```

Nunca `{ "amount": ... }` nem `{ "value": ... }` como envelope de dinheiro.

**`options.currency` no pedido é a moeda desejada.** Se a companhia não a suporta, devolva na moeda
que ela usou e diga qual foi. Nunca converta em silêncio, nunca invente uma cotação.

Quando houver conversão, declare-a:

```json
"exchange": { "from": "USD", "to": "BRL", "conversionFactor": 5.42, "applied": true }
```

`null` quando não houve conversão.

### Idioma

`options.language` aceita `pt-br`, `en-us`, `es-es`. O padrão é `pt-br`.

Vale para os campos que **você** traduz: nome de equipamento, descrição de comodidade.

### 🔴 Nunca substitua um código pelo nome

Se a companhia manda `"738"` e você resolve para `"Boeing 737-800"`, o código tem que **sobreviver
ao lado** do nome:

```json
"equipment": { "code": "738", "name": "Boeing 737-800", "description": null }
```

Trocar o código pelo nome perde a chave de busca e prende o campo no idioma da primeira resposta.

A mesma regra vale para o nome comercial de um assento, o rótulo de uma forma de pagamento e a
descrição de uma comodidade: **quem consome localiza pela chave estrutural, nunca pelo texto que a
companhia mandou.**

---

## 6. Vocabulário canônico compartilhado

Estes objetos aparecem em várias rotas com **exatamente o mesmo formato**. Defina cada um uma vez do
seu lado e reutilize.

### `Airport` — aeroporto

| Campo | Tipo | O que é |
|---|---|---|
| `iata` | `string(3)` \| `null` | Código IATA. `"GRU"` |
| `city` | `string` \| `null` | Nome da cidade. `"São Paulo"` |
| `terminal` | `string` \| `null` | Terminal, quando a companhia informa. `"3"` |
| `coordinates.lat` | `number` \| `null` | Latitude |
| `coordinates.lng` | `number` \| `null` | Longitude |

```json
{ "iata": "GRU", "city": "São Paulo", "terminal": "3",
  "coordinates": { "lat": -23.4356, "lng": -46.4731 } }
```

### `FlightTime` — horários

| Campo | Tipo | O que é |
|---|---|---|
| `departure` | `string` \| `null` | Partida, hora local, ISO-8601 com fuso |
| `arrival` | `string` \| `null` | Chegada, hora local |
| `duration` | `integer` | Duração em **minutos**. `0` quando não informada |

### `AirlineCompany` — companhia aérea

| Campo | Tipo | O que é |
|---|---|---|
| `code` | `string(2)` \| `null` | Código IATA da companhia. `"G3"` |
| `name` | `string` \| `null` | Nome. `"Acme Air"` |
| `operating` | `string` \| `null` | Companhia que **opera** o voo, quando é diferente de quem vende (codeshare) |

> ⚠️ **O número de chaves muda por nível.** No **trecho**, o objeto tem só `{code, name}`. No
> **segmento** (dentro de `flights[]`), tem os três. É de propósito: codeshare é característica do
> voo, não do trecho.

### `FlightFee` — uma taxa, com nome

| Campo | Tipo | O que é |
|---|---|---|
| `code` | `string` \| `null` | Código **cru da companhia**. `"BR3"`, `"YQ"`. É o campo estável para agrupar e traduzir |
| `name` | `string` \| `null` | Rótulo legível. Pode variar entre companhias para a mesma cobrança |
| `type` | `string` \| `null` | Natureza da taxa, quando a companhia classifica |
| `value` | `number` | **Valor de UM passageiro adulto** |
| `total` | `number` | **Valor da reserva INTEIRA**, todos os passageiros |
| `currency` | `string` \| `null` | Moeda |
| `included` | `boolean` | Se já está somada no total da tarifa. Padrão `false` |
| `countryCode` | `string` \| `null` | País da taxa, quando aplicável |
| `route` | `string` \| `null` | Trecho a que se aplica, quando informado |

🔴 **`value` × `total` é a confusão mais cara deste contrato.**

Numa busca com 2 adultos, `value` é **metade** do que se cobra. **Sempre some `total`.**

### `Baggage` — franquia de bagagem

Dois nós, e **cada um tem o seu próprio `included`**. Não existe `included` no topo.

```json
"baggage": {
  "hand": { "included": true,  "pieces": 1, "weight": 10, "unit": "kg",
            "description": "Uma peça de até 10 kg" },
  "hold": { "included": false, "pieces": 0, "weight": 0,  "unit": "kg",
            "description": null, "type": "checked" }
}
```

`hand` é a bagagem de **mão**; `hold` é a **despachada**.

| Campo | Tipo | O que é |
|---|---|---|
| `hand.included` / `hold.included` | `boolean` | Se **aquela** bagagem está inclusa na tarifa |
| `hand.pieces` / `hold.pieces` | `integer` | Quantas peças. `0` quando não incluso |
| `hand.weight` / `hold.weight` | `number` | Peso máximo por peça |
| `hand.unit` / `hold.unit` | `string` \| `null` | `"kg"`, `"lb"` |
| `hand.description` / `hold.description` | `string` \| `null` | Texto da companhia |
| `hold.type` | `string` \| `null` | Só na despachada. `"checked"` |

Quando a companhia não diz `included` explicitamente, deduza de `pieces > 0 || weight > 0`.

### `FareRules` — regras de reembolso e alteração

| Campo | Tipo | O que é |
|---|---|---|
| `refundable` | `boolean` \| `null` | Reembolsável. `null` = a companhia não dá sinal confiável |
| `changeable` | `boolean` \| `null` | Alterável |
| `penalties[]` | `array` | Multas estruturadas — ver abaixo |
| `refund` / `change` / `cancellation` / `noShow` | `object` \| `null` | A mesma multa, na forma de objeto por tipo |
| `endorsable` | `boolean` \| `null` | Se pode ser transferida para outra companhia |
| `transferable` | `boolean` \| `null` | Se pode mudar de titular |
| `key` | `string` \| `null` | **Chave opaca** para `POST /fare-rules` — o texto integral da regra. `null` = a companhia não expõe o texto |

Cada item de `penalties[]` é `{type, amount, amountType, currency, description}`, onde `type` é
`refund`, `change`, `cancellation` ou `noShow`.

#### 🔴 A mesma multa aparece nas duas formas

Repare que a informação está duplicada: existe uma **lista** (`penalties[]`) e existem **objetos por
tipo** (`refund`, `change`…).

Isso é de propósito. Cada companhia publica de um jeito, e a regra é: **a forma que vier preenchida
alimenta a que vier vazia, campo a campo.**

Se a companhia só manda a lista, derive os objetos a partir dela. Se só manda os objetos, derive a
lista. Assim quem consome lê **uma** das duas, à escolha, e sempre encontra o dado.

Nada é inventado — é o mesmo dado, apresentado de dois jeitos.

### `FareBenefits` — comodidades da tarifa

Um objeto com **8 chaves fixas**, todas sempre presentes:

```json
"benefits": {
  "wifi": null,
  "catering": null,
  "entertainment": null,
  "seatSelection":    { "status": "included",    "description": "Seleção de assento gratuita", "amount": null, "currency": null },
  "extraSpaceSeat":   { "status": "chargeable",  "description": "Assento com espaço extra",    "amount": 45,   "currency": "BRL" },
  "priorityBoarding": { "status": "not_offered", "description": null, "amount": null, "currency": null },
  "loyalty": null,
  "lounge": null
}
```

Cada chave é **`null`** ou um objeto `{status, description, amount, currency}`.

#### São 4 estados, não 2

| Valor | Significa |
|---|---|
| `null` | **Não informado.** A companhia não diz nada sobre isso |
| `status: "included"` | Está incluso na tarifa |
| `status: "chargeable"` | Existe, cobrado à parte |
| `status: "not_offered"` | **Confirmado que não tem.** A companhia afirmou |

🔴 Tratar `null` como `not_offered` faz a tela dizer *"este voo não tem wi-fi"* quando a verdade é
*"não sabemos"*.

`amount` e `currency` só aparecem quando existe um custo conhecido.

`description` é **texto cru da companhia, ou `null`** — nunca uma frase que você escreveu. Quem
consome monta o texto a partir da chave + status.

> Regras de cancelamento, alteração e reembolso ficam em `rules`, **não aqui**.

### `Document` — documento do passageiro

| Campo | Tipo | Valores |
|---|---|---|
| `type` | `string` | `CPF` \| `PASSPORT` \| `RG` \| `RNE` \| `RNM` \| `MERCOSUR` |
| `number` | `string` | Só dígitos, quando for CPF |
| `nationality` | `string` \| `null` | `"BR"` |
| `issuingCountry` | `string` \| `null` | País emissor |
| `expiryDate` | `string` \| `null` | `YYYY-MM-DD` |
| `issueDate` | `string` \| `null` | `YYYY-MM-DD` |

### `ContactPhone` — telefone

| Campo | Tipo | Exemplo |
|---|---|---|
| `country` | `string` \| `null` | `"55"` |
| `area` | `string` \| `null` | `"11"` |
| `number` | `string` \| `null` | `"988887777"` |
| `type` | `string` \| `null` | `"mobile"` |

Quando a companhia não separa código de país e DDD, ponha o número inteiro em `number` e deixe os
outros `null`.

### Cabine canônica

Quatro valores, e **só** esses quatro:

```
economy | premium_economy | business | first
```

#### 🔴 De onde tirar a cabine

**Do campo que a companhia documenta como cabine.** Nunca da classe de reserva (a letra), nunca do
nome da família tarifária.

Por quê:

- **A letra não tem mapa oficial.** `J` costuma ser executiva e `Y` econômica, mas cada companhia usa
  as suas do jeito dela.
- **O nome mente.** Numa auditoria real, deduzir a cabine a partir do nome da família classificou
  **1.164 de 3.123 tarifas errado** — nomes como `"BC CLASSIC"` viravam econômica.

Se a companhia não documenta a cabine naquele nível, o campo é **`null`**. Ver
[`00-glossario.md`](00-glossario.md).

---

## 7. 🔴 `committed` ≠ `confirmed` — a regra mais importante

Todas as rotas que **alteram** alguma coisa na reserva — marcar assento, remover assento, vender
extra, emitir — devolvem estes dois campos.

Eles respondem perguntas **diferentes**:

| Campo | A pergunta | Tipo |
|---|---|---|
| `committed` | *"A companhia aceitou o comando e gravou?"* | `boolean` — **nunca `null`** |
| `confirmed` | *"Existe **prova** de que o efeito aconteceu?"* | `boolean` \| **`null`** |

### Quando cada valor de `confirmed`

| Valor | Quando |
|---|---|
| `true` | A companhia **ecoou** o resultado (devolveu o assento marcado, o número do bilhete, o serviço na reserva) **ou** você releu a reserva depois e encontrou lá |
| `false` | Você **procurou a prova e ela não estava lá**. Isso é falha, não sucesso parcial |
| `null` | A prova **não existe** naquela companhia — ela responde "ok" e não diz mais nada |

### Por que essa separação existe

Um caso real: uma companhia respondia `status="Complete"`, HTTP 200, sem nenhum erro — **e não
gravava nada.** O detalhe estava num atributo de fim de transação que vinha `false`.

O bug ficou invisível por **meses**. E ficou justamente porque essa companhia não devolve o assento
de volta: se o código tivesse marcado `confirmed: true` a partir do `committed`, ele teria ficado
invisível para sempre.

### 🔴 `confirmed` NUNCA é deduzido de `committed`

**HTTP 200, `"Complete"`, ausência de erro — nada disso prova efeito.**

Três consequências para quem implementa:

**1. Faça o seu parser LANÇAR quando houver marcador de recusa dentro de um sucesso.**

Um campo de fim de transação em `false`, um nó de erro no meio do payload, um status "não
processado". Isso não é aviso — é falha, e tem que virar erro.

**2. A prova é uma leitura independente.**

Releia a reserva depois de gravar e compare com o que você pediu.

**3. Onde a companhia não devolve prova nenhuma, use o teste diferencial.**

Mande algo que **deveria** falhar e confira se falha. Se não falhar, o seu comando também não está
sendo lido.

### E para quem consome

**`committed: true, confirmed: null` não é sucesso comprovado.** Quem consome precisa reler para
confirmar. O campo existe para dizer isso.

### Falha de leitura nunca vira confirmação

Se a leitura de verificação falhar, o resultado é:

```json
{ "committed": false, "confirmed": null, "seats": [ { "status": "failed", ... } ] }
```

**Nunca** o contrário.

---

## 8. Quando o provedor não tem a operação

Se a companhia **não oferece** aquilo, a resposta é:

**HTTP 501**, com `error.code: "CAPABILITY_NOT_SUPPORTED"`.

Três regras que acompanham:

**1. Essa checagem roda ANTES de tudo.**

Antes de validar o corpo, antes de qualquer outra coisa. Invertida, a resposta seria "payload
inválido" — verdade acidental que esconde o motivo real e manda quem chamou procurar no lugar
errado.

**2. Nunca devolva o retorno cru da companhia como consolo.**

Sem normalização, é 501. Uma rota canônica que às vezes devolve outro formato é pior do que uma rota
que não existe: quem consome não tem como se defender.

**3. Provedor desconhecido continua sendo 400.**

`501` = "existe, mas não faz isso". `400` = "não existe". São coisas diferentes, e quem consome age
diferente em cada uma.

---

## 9. O que foi omitido destes documentos

O contrato real carrega, em toda rota, dois blocos que **não** aparecem aqui:

- **Contexto comercial** do pedido — agência, cliente, centro de custo. Serve para escolher a regra
  de precificação.
- **Identificador de credencial** — escolhe qual conta usar quando existe mais de uma na mesma
  companhia (`options.providerCredentialIds[]`, pareado por índice com `options.provider[]`).

Os dois pertencem à plataforma que consome a API, não à integração com a companhia. Nos exemplos
destes documentos, o pedido carrega apenas `options.provider[]`.

Se um dia a sua API tiver mais de uma credencial por companhia, você vai precisar de algo
equivalente. Mas isso está fora do desafio.
