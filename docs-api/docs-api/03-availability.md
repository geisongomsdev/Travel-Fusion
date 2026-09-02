# 03 — Buscar voos: `POST /availability`

A primeira etapa do fluxo, a mais usada e a mais difícil de acertar.

Recebe um pedido de viagem, consulta os provedores **em paralelo** e devolve cada resposta assim que
ela chega.

> **Este documento** descreve o pedido, o stream e o que cada campo significa.
>
> **O documento [`04`](04-availability-formatos.md)** descreve **onde cada peça vai** — o que muda
> entre ida, ida-e-volta e multidestino, e entre um provedor que vende pacote e um que vende trecho
> solto.
>
> **Leia os dois.** O `04` é onde estão as decisões que ninguém acerta de primeira.

---

## 1. Por que a resposta é um stream

Uma busca fala com várias companhias ao mesmo tempo. Uma responde em 800 ms, outra em 6 segundos,
outra dá timeout.

Se a API esperasse todas para responder, o cliente olharia uma tela vazia pelo tempo da mais lenta —
e perderia tudo se uma travasse.

Então a resposta é um **stream**: o servidor manda um evento por provedor, conforme eles chegam. A
tela vai preenchendo.

O formato é **Server-Sent Events** (`Content-Type: text/event-stream`). Cada pedaço é uma linha:

```
data: {"type":"start", ...}\n\n
data: {"type":"provider_success", ...}\n\n
data: {"type":"complete", ...}\n\n
```

Todo evento tem `type` e `timestamp`. Os eventos de provedor têm também `provider`.

---

## 2. O pedido

`POST /availability`, `Content-Type: application/json`.

O corpo tem **duas formas**, escolhidas pelo campo `type`.

### 2.1 Ida e ida-e-volta

```json
{
  "type": "roundtrip",
  "class": "economy",
  "departure": { "date": "2026-06-12", "iata": "GRU" },
  "arrival":   { "date": "2026-06-19", "iata": "REC" },
  "passengers": { "adults": 2, "children": 1, "childrenAges": [7], "infants": 1 },
  "airline": ["G3"],
  "options": {
    "provider": ["acme-air"],
    "currency": "BRL",
    "language": "pt-br",
    "direct": false,
    "refundable": true
  }
}
```

| Campo | Tipo | Obrigatório | O que é | Valores |
|---|---|---|---|---|
| `type` | `string` | não (padrão `roundtrip`) | Tipo de viagem | `oneway` \| `roundtrip` |
| `class` | `string` | não | Classe de cabine. **Ausente = todas** | `economy` \| `premium_economy` \| `business` \| `first` |
| `departure.date` | `string` | **sim** | Data de ida | `YYYY-MM-DD` |
| `departure.iata` | `string(3)` | **sim** | Aeroporto de origem | Código IATA |
| `arrival.date` | `string` | **sim em `roundtrip`** | Data de volta. Ignorada em `oneway` | `YYYY-MM-DD` |
| `arrival.iata` | `string(3)` | **sim** | Aeroporto de destino | Código IATA |
| `passengers` | `object` | **sim** | Ver §2.3 | |
| `airline[]` | `string[]` | não | Filtrar por companhia | `["G3", "AD"]` |
| `options` | `object` | **sim** | Ver §2.4 | |

### 2.2 Multidestino

```json
{
  "type": "multicity",
  "class": "economy",
  "segments": [
    { "origin": "POA", "destination": "GRU", "date": "2026-06-10" },
    { "origin": "GRU", "destination": "SSA", "date": "2026-06-14" },
    { "origin": "SSA", "destination": "REC", "date": "2026-06-20" }
  ],
  "passengers": { "adults": 2 },
  "options": { "provider": ["acme-air"], "currency": "BRL" }
}
```

| Campo | Tipo | Obrigatório | O que é |
|---|---|---|---|
| `type` | `"multicity"` | **sim** | Literal |
| `segments[]` | `array` | **sim**, **mínimo 2** | Um item por trecho, **na ordem da viagem** |
| `segments[].origin` | `string(3)` | **sim** | IATA |
| `segments[].destination` | `string(3)` | **sim** | IATA |
| `segments[].date` | `string` | **sim** | `YYYY-MM-DD` |

🔴 **A posição em `segments[]` é semântica.** O trecho 0 é o primeiro do roteiro, e essa posição
sobrevive até a resposta. Nunca reordene, nunca compacte.

Nesta forma **não existem** `departure` nem `arrival`.

### 2.3 `passengers`

| Campo | Tipo | Obrigatório | O que é |
|---|---|---|---|
| `adults` | `integer ≥ 0` | **sim, mínimo 1** | Adultos. **Sem adulto a busca é recusada com 400** |
| `adult` | `integer ≥ 0` | não | Nome antigo de `adults`. Aceite os dois; prefira `adults` |
| `children` | `integer ≥ 0` | não | Crianças (2 a 11 anos) |
| `childrenAges[]` | `integer[]` | não | Idades das crianças. Cada valor entre **2 e 11** |
| `infants` | `integer ≥ 0` \| `array` | não | Bebês de colo (menos de 2 anos). Aceita número ou lista |

### 2.4 `options`

| Campo | Tipo | Obrigatório | O que é | Valores |
|---|---|---|---|---|
| `provider[]` | `string[]` | **sim**, mínimo 1 | Quais provedores consultar | Nomes de provedor |
| `currency` | `string` | não | Moeda desejada | `BRL` \| `USD` \| `EUR` |
| `language` | `string` | não (padrão `pt-br`) | Idioma dos campos que você traduz | `pt-br` \| `en-us` \| `es-es` |
| `direct` | `boolean` | não | Só voos diretos, **quando o provedor suporta o filtro** | |
| `refundable` | `boolean` | não | Filtro por reembolsabilidade. Ver §2.5 | |

> **Sobre `provider[]`:** o sistema real pareia este array, por índice, com um array de
> identificadores de credencial (`options.providerCredentialIds[]`), para escolher qual conta usar
> quando há mais de uma na mesma companhia. Isso está **fora do escopo deste desafio** — aqui o
> pedido carrega só `provider[]`.

### 2.5 O filtro `refundable`

`true` = só ofertas reembolsáveis. `false` = só não-reembolsáveis. **Ausente = sem filtro.**

🔴 **Oferta sem sinal confiável é MANTIDA.**

Se todas as tarifas de uma oferta têm `rules.refundable: null`, ela sobrevive ao filtro. Podar às
cegas esconderia oferta boa por causa de um campo que a companhia não preenche.

**Não se aplica a multidestino.**

### 2.6 O filtro `class` (cabine)

É **estrito**: a oferta passa se **qualquer trecho** (`flights[].cabin`) **ou qualquer tarifa**
(`fares[].cabin`) for da classe pedida.

Duas regras, iguais às do filtro de reembolso:

- Cabine desconhecida em **tudo** (todos os campos `null`) → a oferta é **mantida**.
- Cabine conhecida e **nenhuma** bate → removida.

**Ausente = todas as cabines.** Não existe o valor `"all"` neste campo — simplesmente omita a chave.

**Não se aplica a multidestino.**

---

## 3. Os eventos do stream

```
   ┌──────────────────────────────────────────────────────┐
   │  start            a busca começou                    │
   └──────────────────────┬───────────────────────────────┘
                          │
      ┌───────────────────┼───────────────────┐
      │                   │                   │
   provider_success   provider_error    provider_success
   (acme-air)         (nova-air)        (outra)
      │                   │                   │
      └───────────────────┼───────────────────┘
                          │
   ┌──────────────────────▼───────────────────────────────┐
   │  filters          os filtros que a tela pode oferecer│
   └──────────────────────┬───────────────────────────────┘
                          │
   ┌──────────────────────▼───────────────────────────────┐
   │  complete         fim. a conexão fecha               │
   └──────────────────────────────────────────────────────┘

   A qualquer momento, se a busca inteira morrer:
   ┌──────────────────────────────────────────────────────┐
   │  fatal_error      fim. a conexão fecha               │
   └──────────────────────────────────────────────────────┘
```

| `type` | Quando | Encerra? |
|---|---|---|
| `start` | A busca começou. Lista os provedores que serão consultados | não |
| `provider_success` | **Um** provedor devolveu ofertas. Um evento por provedor | não |
| `provider_error` | **Um** provedor falhou **ou não achou voo**. Os outros continuam | não |
| `filters` | Depois das consultas. Consolida os filtros para a tela | não |
| `complete` | Fim com sucesso | **sim** |
| `fatal_error` | A busca inteira morreu | **sim** |

**Não presuma que todo provedor tem sucesso.** Falha parcial é normal. Use `provider_success` para
preencher a tela progressivamente e `complete` para liberar o estado final.

### `start`

```json
{
  "type": "start",
  "message": "Iniciando busca de voos",
  "providers": [ { "provider": "acme-air" }, { "provider": "nova-air" } ],
  "totalProviders": 2,
  "international": false,
  "timestamp": "2026-05-09T12:00:01.000Z"
}
```

| Campo | Tipo | O que é |
|---|---|---|
| `message` | `string` | Texto informativo |
| `providers[]` | `array` | Os provedores que serão consultados |
| `totalProviders` | `integer` | Quantos |
| `international` | `boolean` | Se a rota é internacional |

### `provider_success`

```json
{
  "type": "provider_success",
  "provider": "acme-air",
  "data": { "groups": [], "departure": [], "return": [] },
  "timestamp": "2026-05-09T12:00:03.000Z",
  "groups": 1, "departure": 1, "return": 1,
  "payment": { "acceptedTypes": ["credit-card", "invoice"] }
}
```

| Campo | Tipo | Presença | O que é |
|---|---|---|---|
| `provider` | `string` | sempre | Quem respondeu |
| `data` | `object` | sempre | As ofertas. **O formato varia** — ver [`04`](04-availability-formatos.md) |
| `data.groups[]` | `array` | condicional | Pacotes de ida-e-volta |
| `data.departure[]` | `array` | condicional | Voos de ida avulsos |
| `data.return[]` | `array` | condicional | Voos de volta avulsos |
| `data.itineraries[]` | `array` | condicional | Itinerários multidestino |
| `payment.acceptedTypes[]` | `string[]` | condicional | Formas de pagamento que a companhia aceita. Ver §5 |

#### Os contadores mudam por tipo de viagem

Além do `data`, o evento carrega contadores no nível de cima. **Quais contadores dependem do tipo:**

| Tipo | Contadores | Detalhe |
|---|---|---|
| `oneway` | `groups`, `departure`, `return`, `flights` | `flights = departure + return`. Havendo `groups`, `flights = groups` |
| `roundtrip` | `groups`, `departure`, `return` | sem `flights` |
| `multicity` | `itineraries`, `flights` | 🔴 **`flights` é IGUAL a `itineraries`** — não é contagem de voos |

### `provider_error`

Duas situações diferentes com o mesmo envelope:

- **falha real** → `data.error` tem `canonicalCode` e `category`;
- **sem voos** → `data.error.code` é `"NO_FLIGHTS"`, e **não há** `canonicalCode`.

🔴 **Discrimine por `data.error.canonicalCode`, não por `type`.** Detalhe em
[`02-erros.md`](02-erros.md) §7.

### `filters`

Agregações prontas para a tela montar os filtros.

```json
{
  "type": "filters",
  "trip_type": "roundtrip",
  "data": {
    "filters": {
      "airlines": [ { "code": "G3", "name": "Acme Air", "count": 12 } ],
      "stops": { "departure": { "direct": 5, "1": 7 }, "return": { "direct": 4, "1": 8 } },
      "currency": { "min": 1280.45, "max": 3890.00 },
      "providers": { "acme-air": 12, "nova-air": 0 },
      "refundable": { "refundable": 4, "nonRefundable": 8 }
    }
  },
  "timestamp": "2026-05-09T12:00:05.000Z"
}
```

`refundable` só aparece quando **alguma** oferta tem sinal de reembolsabilidade.

### `complete`

```json
{
  "type": "complete",
  "totalCount": 12,
  "countType": "groups",
  "totalFlights": 12,
  "duration": 4200,
  "message": "Busca concluída: 12 grupos de preço encontrados",
  "providers": [ { "provider": "acme-air" }, { "provider": "nova-air" } ],
  "timestamp": "2026-05-09T12:00:06.000Z"
}
```

`countType` diz **o que** foi contado: `groups`, `flights` ou `itineraries`.

### `fatal_error`

`data` é o corpo de erro padrão. Ver [`02-erros.md`](02-erros.md) §7.

---

## 4. Os campos de cada nível

O `data` da busca é montado com quatro tipos de peça. **Onde cada peça vai** é o assunto do
[`04`](04-availability-formatos.md). Aqui está **o que cada peça contém**.

🔴 **Estas listas de campo são fechadas.**

Um campo que não está na lista do seu nível é **descartado em silêncio** por quem consome — sem
erro, sem log. Se você precisa emitir alguma coisa, ela tem que estar aqui.

### 4.1 O trecho

Um trecho é o caminho de A até B, com ou sem conexão. É o item de `departure[]`, `return[]`,
`group.departure[]`, `group.return[]` e `itinerary.legs[i][j]`.

| Campo | Tipo | O que é |
|---|---|---|
| `identifier` | `string` \| `null` | 🔴 **O identificador opaco da oferta neste trecho.** É ele que segue para tarifar e reservar. Ver [`01`](01-convencoes.md) §4 |
| `company` | `object` | `{code, name}` — **2 chaves neste nível** |
| `origin` | `Airport` | Ver [`01`](01-convencoes.md) §6 |
| `destination` | `Airport` | |
| `time` | `FlightTime` | Do primeiro embarque à última chegada |
| `stops` | `integer` \| `null` | Paradas: conexões **mais** escalas técnicas. `0` = direto. Sem informação, derive de `flights.length - 1` |
| `fareSelection` | `object` \| **chave ausente** | A identidade **tarifária** deste trecho. Ver §4.5 |
| `flights[]` | `array` | Os **segmentos**, na ordem. Voo direto = 1 item; com uma conexão = 2. Ver §4.2 |
| `fares[]` | `array` \| **chave ausente** | As tarifas. **Onde ela existe é o assunto do [`04`](04-availability-formatos.md)** |
| `fees[]` | `array` de `FlightFee` | Lista **legada**. Ver o aviso abaixo |

> ⚠️ **`fees[]` no trecho é legado.**
>
> A lista canônica é `fares[].fees`. Esta existe por compatibilidade e **não é cópia garantida** da
> outra: em alguns provedores vem vazia, em outros recortada no trecho enquanto a da tarifa cobre a
> viagem toda, e ela **não acompanha conversão de moeda**.
>
> Não some com `price.total` — é o mesmo dinheiro.

**Não sobrevive neste nível:** `provider`, `number`, `status`, `cabin`. O número do voo e a cabine
vivem no segmento.

### 4.2 O segmento

Um voo, dentro do trecho.

| Campo | Tipo | O que é |
|---|---|---|
| `origin` | `Airport` | |
| `destination` | `Airport` | |
| `time` | `FlightTime` | |
| `company` | `object` | `{code, name, operating}` — **3 chaves neste nível**, porque codeshare é do segmento |
| `number` | `string` \| `null` | Número do voo. `"1234"` |
| `segment` | `integer` | Índice do segmento dentro do trecho, começando em 0 |
| `connection` | `boolean` | Se é continuação de uma conexão. Padrão `false` |
| `equipment` | `object` | `{code, name, description}` — ver [`01`](01-convencoes.md) §5 |
| `cabin` | `string` \| `null` | Cabine canônica **deste segmento** |

#### 🔴 `cabin: null` no segmento é comum e correto

Quando o voo oferece mais de uma cabine e não dá para dizer qual é a **deste** segmento, o campo é
`null` — e a resposta passa a ser `fares[].cabin`.

Publicar a primeira cabine da lista faz uma busca por econômica devolver oferta que só existe em
premium. Foi medido: **258 segmentos de uma única captura** listavam duas cabines disponíveis.

**Não existe `stops` no segmento** (só no trecho). **Não existe `status`.**

### 4.3 A tarifa (`fares[]`)

| Campo | Tipo | O que é |
|---|---|---|
| `fareId` | `string` \| `null` | **Identificador da tarifa.** É o valor que segue para `/quote` e para a reserva. Opaco. Pode ser `null` em provedores que não identificam a tarifa separadamente — aí quem endereça é o `identifier` do trecho |
| `code` | `string` \| `null` | Código da tarifa |
| `familyCode` | `string` \| `null` | Código da família tarifária. `"LIGHT"` |
| `family` | `string` \| `null` | Nome da família. `"Light"` |
| `fareCode` | `string` \| `null` | **Base tarifária**. `"ONHMAG2J"` |
| `bookingCode` | `string` \| `null` | **Classe de reserva** (a letra). `"Y"` |
| `cabin` | `string` \| `null` | Cabine canônica. Ver [`01`](01-convencoes.md) §6 |
| `seats` | `integer` \| `null` | Assentos restantes nesta tarifa |
| `price` | `object` | Ver §4.4 |
| `fees[]` | `array` de `FlightFee` | **As taxas nomeadas desta tarifa.** É a lista canônica |
| `baggage` | `Baggage` | Ver [`01`](01-convencoes.md) §6 |
| `rules` | `FareRules` | Ver [`01`](01-convencoes.md) §6 |
| `benefits` | `FareBenefits` | Objeto com **8 chaves fixas**. Ver [`01`](01-convencoes.md) §6 |
| `appliesTo` | `"all"` \| `string[]` \| `integer[]` \| **chave ausente** | A quais trechos esta tarifa se aplica. Ver [`04`](04-availability-formatos.md) §7 |
| `legFareIds` | `array` \| **chave ausente** | Num pacote multidestino, o identificador da tarifa **de cada trecho** — a reserva pode precisar mandar um por trecho |

#### Sobre `fares[].fees`

- É a **discriminação** do que já está dentro de `price.total`. Serve para **mostrar** a composição,
  nunca para somar de novo.
- **Some sempre o campo `total`** de cada item (valor da reserva inteira), nunca `value` (valor de um
  passageiro).
- Ela fica na **tarifa**, não no voo, porque é onde as companhias a mandam: em várias delas, o voo
  não carrega taxa nenhuma. Cada família tarifária tem a sua, então duas famílias do mesmo voo podem
  trazer listas diferentes.
- Num pacote de ida-e-volta ou multidestino, a lista **soma os trechos**, igual ao `price.total`.
- É a discriminação do que a companhia **nomeia** — pode não cobrir tudo, e vem `[]` quando ela não
  discrimina nada.

### 4.4 O preço da tarifa

```json
"price": {
  "adult": { "base": 520.00,
             "taxes": { "boarding": 25.00, "service": 10.00, "fuel": 0, "baggage": 0 },
             "fees": 10.00, "total": 565.00 },
  "child": { "base": 390.00,
             "taxes": { "boarding": 25.00, "service": 10.00, "fuel": 0, "baggage": 0 },
             "fees": 10.00, "total": 435.00 },
  "baby":  null,
  "total": { "base": 1430.00,
             "taxes": { "boarding": 75.00, "service": 30.00, "fuel": 0, "baggage": 0 },
             "fees": 30.00, "total": 1565.00, "currency": "BRL" },
  "perPassenger": 521.67,
  "net": null,
  "exchange": null
}
```

| Campo | Tipo | O que é |
|---|---|---|
| `total` | `object` | **O valor da reserva INTEIRA**, todos os passageiros. `{base, taxes{boarding,service,fuel,baggage}, fees, total, currency}` |
| `adult` / `child` / `baby` | `object` \| `null` | Preço de **UM** passageiro daquele tipo. **Valor unitário**, não o subtotal do tipo |
| `perPassenger` | `number` | `total.total` dividido pelo número de passageiros |
| `net` | `object` \| `null` | Custo líquido do fornecedor, quando exposto. `{total, perPassenger}` |
| `exchange` | `object` \| `null` | Câmbio aplicado. `null` quando não houve conversão |

#### `total.fees` — a taxa de distribuição

É a taxa que algumas companhias cobram por venda feita fora do canal próprio.

Ela está **dentro** de `total.total` e **fora** de `total.base`. Ao decompor o preço, some-a com as
taxas — senão sobra um valor órfão.

**Não confunda com a taxa de embarque**, que está em `taxes.boarding`.

#### 🔴 Os nós por passageiro são "tudo ou nada"

Quando a companhia não separa os tipos — algumas devolvem a criança como mais um adulto —, os
**três** vêm `null` juntos.

Publicar só um deles não explicaria o total, e engana mais do que o campo vazio.

Uma taxa de valor fixo é **rateada igualmente** entre os passageiros.

**Invariante:** `adult × nº adultos + child × nº crianças + baby × nº bebês == total.total`.

### 4.5 `fareSelection` — a identidade tarifária do trecho

```json
"fareSelection": { "fareCode": "ONJAAG2J", "bookingCode": "O", "familyCode": "LIG" }
```

**Não é preço.** Num pacote, a tarifa continua sendo a da raiz, e é ela que carrega o dinheiro. O que
muda por trecho é a **base tarifária e a classe de reserva** com que aquele voo foi ofertado.

É o que a companhia usa para reconhecer o voo ao tarifar e ao reservar. Num multidestino, pode ser
**diferente entre os trechos**.

> Numa medição real, **741 de 747** viagens multidestino de um provedor tinham base e classe
> diferentes entre trechos — e nenhuma tinha identidade mista dentro do mesmo trecho. É daí que vem
> a granularidade por trecho.

🔴 **Reenvie a de cada trecho como veio.** Repetir a de um trecho nos demais faz a companhia recusar
a viagem inteira.

**A chave é OMITIDA** quando o provedor não distingue — a raiz já descreve tudo.

---

## 5. `payment.acceptedTypes`

Fica no nível do **evento**, não da tarifa: as formas que a companhia aceita são uniformes por
companhia, não variam por oferta.

```json
"payment": { "acceptedTypes": ["credit-card", "invoice"] }
```

Valores aceitos:

```
credit-card | debit-card | invoice | cash | bank-transfer | voucher | loyalty-points | wallet
```

**Omitido** quando não há forma a declarar.

Este campo é sobre o que a **companhia** aceita receber — não sobre o que o cliente final pode pagar
na loja.

---

## 6. Limite automático de resultados

Não existe campo de limite no pedido. Aplique um teto **por provedor**, em função de quantos estão
sendo consultados:

| Provedores consultados | Teto por provedor |
|---|---|
| 1 | **sem limite** |
| 2 – 3 | 150 |
| 4 – 5 | 100 |
| 6 ou mais | 75 |

O corte é aplicado **depois da ordenação por preço**, sobre `groups`, `departure`, `return` ou
`itineraries`.

⚠️ **Não há campo dizendo que o resultado foi truncado.** Por isso o corte vem depois da ordenação —
as ofertas descartadas são sempre as mais caras.

---

## 7. Ordenação

Ordene por preço, da mais barata para a mais cara.

### 🔴 Num voo avulso, ordene pela família MAIS BARATA — nunca por `fares[0]`

Os dois só coincidem quando o provedor devolve a lista já ordenada, e nem todos devolvem.

E como o corte de resultados (§6) vem logo depois da ordenação, essa confusão joga um voo barato para
o fim da lista — e ele é **descartado**.

---

## 8. Resultados repetidos entre provedores

Os provedores respondem em paralelo, e cada `provider_success` é preservado como veio.

**O mesmo voo pode aparecer em mais de um provedor.** A API **não** remove essas repetições — quem
consome decide qual exibir.

---

## 9. Exemplo completo

**Pedido** — ida e volta, 2 adultos, econômica:

```json
{
  "type": "roundtrip",
  "class": "economy",
  "departure": { "date": "2026-06-12", "iata": "GRU" },
  "arrival":   { "date": "2026-06-19", "iata": "REC" },
  "passengers": { "adults": 2, "children": 0, "infants": 0 },
  "options": { "provider": ["acme-air"], "currency": "BRL", "language": "pt-br" }
}
```

**Stream**, na ordem em que os pedaços chegam:

```
data: {"type":"start","message":"Iniciando busca de voos","providers":[{"provider":"acme-air"}],"totalProviders":1,"international":false,"timestamp":"2026-06-01T12:00:01.000Z"}

data: {"type":"provider_success","provider":"acme-air","data":{ ... ver 04 ... },"timestamp":"2026-06-01T12:00:04.100Z","groups":8,"departure":11,"return":9,"payment":{"acceptedTypes":["credit-card","invoice"]}}

data: {"type":"filters","trip_type":"roundtrip","data":{"filters":{"airlines":[{"code":"G3","name":"Acme Air","count":8}],"stops":{"departure":{"direct":5,"1":6},"return":{"direct":4,"1":5}},"currency":{"min":1280.45,"max":3890.00},"providers":{"acme-air":8},"refundable":{"refundable":3,"nonRefundable":5}}},"timestamp":"2026-06-01T12:00:04.400Z"}

data: {"type":"complete","totalCount":8,"countType":"groups","totalFlights":8,"duration":3600,"message":"Busca concluída: 8 grupos de preço encontrados","providers":[{"provider":"acme-air"}],"timestamp":"2026-06-01T12:00:04.600Z"}
```

O conteúdo do `data` no `provider_success` está em
[`04-availability-formatos.md`](04-availability-formatos.md), com um exemplo completo por variação.

---

## 10. Casos de borda

| Cenário | Resposta |
|---|---|
| Nenhum voo naquele provedor | `provider_error` com `code: "NO_FLIGHTS"` — **não é erro** ([`02`](02-erros.md) §7) |
| Um provedor falha, outros respondem | `provider_error` para ele, `provider_success` para os outros, `complete` normal |
| Todos falham | Um `provider_error` cada, e `complete` com `totalCount: 0` |
| O corpo está inválido | **400** `SEARCH_VALIDATION_ERROR`, **antes** de abrir o stream |
| Falha global durante o stream | `fatal_error`, conexão encerrada |
| `roundtrip` e o provedor só devolveu uma direção, sem pacote | 🔴 **Suprima o provedor** — emita `NO_FLIGHTS` em vez de meia viagem. Ver [`04`](04-availability-formatos.md) §4 |
| Multidestino não suportado pelo provedor | `NO_FLIGHTS` (ou 501, se a operação inteira não existe) |
| A viagem excede o limite de trechos do provedor | `NO_FLIGHTS`, **sem chamar a companhia** |
