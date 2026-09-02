# 04 — As variações de formato da busca

**Este é o documento mais importante do conjunto, e o mais fácil de errar.**

---

## O problema, em uma página

O `data` de um evento `provider_success` **não tem um formato só**.

Ele tem **quatro caixas possíveis**, e qual delas é preenchida — e onde as tarifas ficam dentro
dela — depende de duas coisas:

```
   1. QUE TIPO DE VIAGEM?              2. COMO O PROVEDOR VENDE?

      ida                                 pacote
      ida e volta                         trecho solto
      multidestino
```

Errar isso **não gera erro nenhum.** Gera **preço errado na tela** — dobrado, ou pela metade. E a
descoberta acontece no checkout, quando o cliente já escolheu.

Se você ler só uma coisa deste material, leia este documento.

---

## 1. As quatro caixas

```jsonc
"data": {
  "groups":      [],   // pacotes de ida-e-volta
  "departure":   [],   // voos de IDA avulsos
  "return":      [],   // voos de VOLTA avulsos
  "itineraries": []    // itinerários multidestino
}
```

Nenhuma busca usa as quatro ao mesmo tempo. Qual conjunto aparece está na matriz da §3.

---

## 2. A pergunta que classifica o seu provedor

> ## O provedor **DIZ** o que combina com o quê?
>
> **Diz → é PACOTE.**
> **Não diz nada → são TRECHOS SOLTOS.**

Não importa se os voos chegam separados no JSON dele. O que decide é existir, ou não, uma
**declaração de combinabilidade**: um nó que amarra trechos, uma lista de "combina com", um
itinerário precificado que cobre todas as pernas, uma lista de recomendações.

### 🔴 Nunca invente uma combinação que a companhia não vendeu

Isto foi **medido**, não é teoria.

Uma companhia publica os voos separados **e** publica uma lista de pares recomendados. Quatro
reservas de teste mostraram que a lista **é uma restrição, não uma sugestão**:

- par recomendado → reservou;
- par **não** recomendado → **409, tarifa indisponível**.

E **67%** dos pares que dava para montar visualmente **não estavam** na lista.

Se você parear voos por conta própria porque "faz sentido", você vai ofertar ao cliente dois de cada
três itinerários que a companhia recusa na hora de reservar.

### O algoritmo, passo a passo

```
PASSO 1 — Procure no retorno cru um nó que AMARRE trechos
          (um "combina com", um itinerário precificado com N trechos,
           um grupo tarifário que cubra a viagem toda, uma lista de recomendações)

          ACHOU?
             │
             ├─ SIM  →  PACOTE DECLARADO
             │          publique o que ele declara
             │          fareModel: "package"
             │          fares[] na RAIZ
             │
             └─ NÃO  →  vá ao passo 2


PASSO 2 — Cada trecho é vendável sozinho E a reserva aceita N trechos
          cobrando a SOMA?

             ├─ SIM  →  PACOTE MONTADO POR PREÇO
             │          fareModel: "per-leg"
             │          fares[] DENTRO do trecho
             │
             └─ NÃO  →  vá ao passo 3


PASSO 3 — Publique TRECHOS SOLTOS
          departure[] / return[], sem grupo nenhum
```

> **O passo 2 não contradiz "nunca invente".** Ali, toda combinação **é** comprável, porque a própria
> reserva aceita os N trechos juntos. A companhia não declara pares porque não precisa: ela vende
> qualquer um.

### Como montar o pacote por preço (o passo 2)

O critério é **preço**:

- dentro de um trecho, voos de **mesmo preço** entram no mesmo balde;
- um pacote é a escolha de **um balde por trecho**;
- logo: **qualquer combinação dentro do pacote custa o mesmo total.**

```
   trecho 0                trecho 1
   ┌──────────────┐        ┌──────────────┐
   │ voo A  R$480 │        │ voo D  R$300 │      ← pacote 1: R$780
   │ voo B  R$480 │        │ voo E  R$300 │        (qualquer A/B com qualquer D/E)
   ├──────────────┤        ├──────────────┤
   │ voo C  R$620 │        │ voo F  R$410 │      ← pacote 2: R$1.030
   └──────────────┘        └──────────────┘
```

Guarde **listas** (N + M itens), não o produto cartesiano (N × M) — assim não explode.

**Três guardas obrigatórias:**

| Guarda | Por quê |
|---|---|
| **Teto de pacotes** (algo como 200), cortando as faixas **mais caras** primeiro, e reportando quantas faixas caíram | Corte silencioso esconde perda de oferta |
| **Trecho sem nenhum voo precificável → NENHUM pacote sai daquele provedor** | Meia viagem não é comprável |
| **Compare preços arredondados**, não floats crus | `1280.4499999` e `1280.45` são o mesmo preço |

---

## 3. A MATRIZ

| Tipo × modelo | Caixa usada | `fares[]` fica | `price.total` é | `fareModel` | Existe? |
|---|---|---|---|---|---|
| **Ida × pacote** | — | — | — | — | ❌ **não faz sentido** |
| **Ida × solto** | `departure[]` | **raiz de cada voo** | não há total no item | *não existe* | ✅ **toda ida é assim** |
| **Ida-e-volta × pacote** | `groups[]` (+ `departure[]`/`return[]`) | **raiz do grupo** | a viagem inteira | `"package"` | ✅ |
| **Ida-e-volta × solto** | `departure[]` + `return[]`, `groups: []` | **raiz de cada voo** | não há total no item | *não existe* | ✅ |
| **Multidestino × pacote** | `itineraries[]` | **raiz do itinerário** | o pacote declarado | `"package"` | ✅ |
| **Multidestino × solto** | `itineraries[]` | **dentro de `legs[i][j]`** | soma da mais barata de cada trecho | `"per-leg"` | ✅ |

### 3.1 Ida × pacote — não existe

Uma ida tem **um** trecho.

"Pacote" só significa alguma coisa quando há mais de um trecho para combinar. Com um trecho, o voo
já **é** a viagem inteira.

**Não emita `groups[]` numa viagem de ida.**

### 3.2 Ida × trecho solto — a única forma de ida

```jsonc
"data": {
  "departure": [ /* voos, cada um com o SEU fares[] na raiz */ ],
  "return": []
}
```

**O que você precisa saber:**

- `fares[]` na raiz de cada voo são **ALTERNATIVAS** — as famílias tarifárias daquele mesmo voo.
  O cliente escolhe uma.
- **Não existe total de preço no item.** O preço de vitrine de um voo avulso é a **mais barata** das
  famílias dele, e quem consome calcula.
- **`fareModel` não existe neste nível** — é campo de grupo e de itinerário apenas.
- Obrigatórios: `identifier`, `flights[]` (≥1 segmento), `fares[]` (≥1).

⚠️ **Armadilha nº 1:** em ida, o dinheiro está no `fares[]` do voo. Ordenar por `fares[0]` está
errado — ver [`03`](03-availability.md) §7.

### 3.3 Ida-e-volta × pacote declarado

```jsonc
"data": {
  "groups": [
    {
      "id": 1,
      "price": { "total": 1280.45, "perPassenger": 640.23, "currency": "BRL" },
      "departure": [ { /* trecho de ida, SEM a chave fares */ } ],
      "return":    [ { /* trecho de volta, SEM a chave fares */ } ],
      "fares": [ /* ALTERNATIVAS da viagem inteira */ ],
      "fareModel": "package"
    }
  ],
  "departure": [ /* os mesmos voos, avulsos, COM fares próprias */ ],
  "return":    [ /* idem */ ]
}
```

| Item | Regra |
|---|---|
| `fares[]` | **na RAIZ do grupo**. Cada uma cobre ida **e** volta — escolher uma vale para as duas pernas |
| `group.departure[]` / `group.return[]` | Arrays de trecho, **SEM a chave `fares`** |
| `price.total` | O total da **viagem inteira** = a mais barata das alternativas da raiz |
| `fareModel` | `"package"` |
| Na tela | **UM** seletor de tarifa por card |

🔴 **Somar `departure` + `return` DOBRA o preço.** É o erro mais comum de quem consome.

**Campos obrigatórios do grupo:** `id`, `price{total, perPassenger, currency}`, `departure[]`,
`return[]`, `fares[]`, `fareModel`.

### 3.4 Ida-e-volta × trecho solto

```jsonc
"data": {
  "groups": [],
  "departure": [ { /* voo de ida, com o SEU fares[] */ } ],
  "return":    [ { /* voo de volta, com o SEU fares[] */ } ]
}
```

**O que você precisa saber:**

- **Não forme grupo.** Publique as pernas soltas; o cliente compõe ida + volta.
- `groups: []` — presente e vazio, **não** ausente.
- Cada perna é uma reserva própria na companhia.
- `fareModel` não existe (não há grupo).

**Por que não parear você mesmo:** um grupo que você inventou não tem contraparte do lado da
companhia. Quando o cliente escolher, você vai precisar reservar duas coisas independentes de
qualquer forma — e, no meio do caminho, ofertou uma combinação que ninguém garantiu.

> **E se o meu provedor precifica trecho a trecho MAS aceita as duas pernas numa reserva só?**
>
> O contrato aceita um `groups[]` com `fareModel: "per-leg"`: as tarifas ficariam dentro de cada
> perna, com `appliesTo: ["departure"]` / `["return"]`, e `price.total` seria a soma da mais barata
> de cada uma.
>
> A orientação padrão continua sendo publicar pernas soltas em ida-e-volta. Use o `per-leg` só se a
> sua companhia realmente vender as duas pernas numa transação.

### 3.5 Multidestino × pacote declarado

```jsonc
"data": {
  "itineraries": [
    {
      "id": 1,
      "airline": "G3",
      "price": { "total": 2450.00, "perPassenger": 1225.00, "currency": "BRL" },
      "legs": [
        [ { /* trecho 0 — opção A */ }, { /* trecho 0 — opção B, MESMO preço */ } ],
        [ { /* trecho 1 — única opção */ } ]
      ],
      "fares": [ /* ALTERNATIVAS da viagem inteira */ ],
      "fareModel": "package"
    }
  ]
}
```

**O que você precisa saber:**

- **`itineraries[]` é a ÚNICA caixa do multidestino.** Nada de `groups`, `departure` ou `return`.
- `fares[]` na **raiz do itinerário**; `legs[i][j]` **sem** a chave `fares`.
- `price.total` é o total que **o provedor declarou** — não a soma que você faria.
- `airline` (código IATA da validadora) existe **só** no itinerário, não no grupo.

**Um itinerário = um pacote fechado e comprável.** Se um pacote declarado não cobre **todos** os
trechos pedidos, descarte-o.

🔴 **Não trunque pacotes declarados.**

Se a companhia declara 582 combinações, publique as 582 e deixe o teto de resultados
([`03`](03-availability.md) §6) fazer o corte por preço. Um limite fixo no seu código (do tipo "no
máximo 16 itinerários") descarta oferta boa **antes** da ordenação — e a que sobra pode ser a mais
cara.

### 3.6 Multidestino × trecho solto

```jsonc
"data": {
  "itineraries": [
    {
      "id": 1,
      "price": { "total": 780.00, "perPassenger": 780.00, "currency": "BRL" },
      "legs": [
        [
          { "identifier": "a1", "time": { "departure": "2026-09-15T08:00:00-03:00" },
            "fares": [ { "familyCode": "LIGHT",
                         "price": { "total": { "total": 480.00, "currency": "BRL" } } } ] },
          { "identifier": "a2", "time": { "departure": "2026-09-15T18:00:00-03:00" },
            "fares": [ { "familyCode": "LIGHT",
                         "price": { "total": { "total": 480.00, "currency": "BRL" } } } ] }
        ],
        [
          { "identifier": "b1",
            "fares": [ { "familyCode": "LIGHT",
                         "price": { "total": { "total": 300.00, "currency": "BRL" } } } ] }
        ]
      ],
      "fareModel": "per-leg"
    }
  ]
}
```

**O que você precisa saber:**

- 🔴 **A chave `fares` NÃO existe na raiz.** Nem como `[]`. Está **ausente** — ver §6.
- Cada opção de voo carrega o **seu** `fares[]`.
- `price.total` = **soma da mais barata de cada trecho** (480 + 300 = 780).
- `fareModel: "per-leg"`.

🔴 **Este é o formato mais frágil.** Um consumidor que só olhe a raiz **passa batido sem erro
nenhum** e mostra uma fração do preço.

---

## 4. Ida-e-volta: `groups[]` e as pernas soltas **convivem**

Três coisas diferentes usam a palavra "departure". Separe:

| O quê | Onde fica | O que é |
|---|---|---|
| `data.departure[]` | raiz do `data` | **Voos de ida AVULSOS**, cada um com o seu `fares[]` |
| `data.groups[]` | raiz do `data` | **Pacotes** que o provedor declarou |
| `group.departure[]` | dentro do grupo | **Opções de horário** da ida daquele pacote — todas ao mesmo preço |

### Não é ou-um-ou-outro

Num provedor que declara pacotes, o `data` traz **`groups[]` E `departure[]`/`return[]`** ao mesmo
tempo, quando a companhia manda as duas coisas.

| Modelo do provedor | `groups[]` | `departure[]` / `return[]` |
|---|---|---|
| **Pacote** | preenchido | preenchido também, quando a companhia manda perna avulsa |
| **Trecho solto** | `[]` sempre | preenchido — é a única saída |

**Por quê:** as pernas avulsas alimentam a visão "segmentada" da tela e a montagem de *ida numa
companhia + volta em outra* (que são duas reservas de ida). Devolver só `groups[]` descarta esse
caminho, e o provedor some dessas telas.

⚠️ **O mesmo voo aparece nos dois lugares.** Não conte duas vezes, e não misture:

- reservar um `group` é **uma** reserva;
- casar `departure[i]` com `return[j]` de provedores diferentes são **duas** reservas de ida.

### As três chaves sempre existem num `roundtrip`

Numa busca `roundtrip`, emita **sempre** `groups`, `departure` e `return` — array vazio quando não
há. Nunca omita.

### 🔴 Meia viagem é suprimida

Numa busca `roundtrip`, se o provedor devolveu **só uma** das direções e nenhum pacote, **suprima o
provedor inteiro** com `NO_FLIGHTS`.

Publicar só a ida faz a tela mostrar um preço que não é a viagem que o cliente pediu.

---

## 5. `legs[i]` no multidestino — por que é lista de listas

`itinerary.legs` é um **array de arrays**:

```js
legs[i][j]
//   │  └── j = OPÇÕES DE VOO daquele trecho
//   └───── i = o TRECHO i do pedido, na ordem pedida
```

```
   legs[0]                    legs[1]
   ┌──────────────────┐       ┌──────────────────┐
   │ [0] voo 08:00    │       │ [0] voo 11:00    │
   │ [1] voo 18:00    │       └──────────────────┘
   └──────────────────┘
     escolha UMA               escolha UMA
            └──────── somam ────────┘
```

### O índice externo é o trecho, e a posição é semântica

🔴 **Nunca compacte a lista.**

Se o trecho 2 não tiver voo, você **não** pode encurtar o array — o trecho 3 viraria `legs[1]`, e a
reserva sairia com a tarifa do trecho errado, **sem erro nenhum**.

Ou o itinerário cobre todos os trechos, ou ele não existe.

### O índice interno são opções de horário pelo MESMO preço

Um pacote pode oferecer várias saídas no mesmo trecho, todas custando igual. `legs[i][0]` é o voo
quando há só um.

### A regra dos baldes

> **Dentro do trecho, o cliente escolhe UMA. Entre trechos, elas SOMAM.**

Somar as opções de um mesmo trecho conta "3 idas em vez de uma".

A mesma regra vale em ida-e-volta: `group.departure[]` são opções da ida (escolha uma), e a ida soma
com a volta.

### 🔴 A armadilha

`legs[i]` é um **array**. Quem faz `leg.fares` sobre ele recebe `undefined` — não erro, não
exceção — e **a tarifa some em silêncio**.

Este bug já aconteceu: todo trecho passou a valer zero.

```js
// ❌ ERRADO
for (const leg of itinerary.legs) { leg.fares }        // undefined

// ✅ CERTO
for (const opcoes of itinerary.legs) {                  // opcoes é um ARRAY
  for (const leg of opcoes) { leg.fares }
}
```

**Aceite as duas formas na entrada, emita sempre a de fora.** Se o seu código montar `legs` em uma
dimensão (`[leg, leg]`), envolva cada item antes de publicar: a saída é **sempre** duas dimensões.

---

## 6. Chave **ausente** ≠ `fares: []`

Esta é a diferença mais sutil do contrato, e é ela que carrega a informação de onde as tarifas estão.

| Situação | O que emitir na raiz | `fareModel` |
|---|---|---|
| Tarifas na **raiz** (pacote) | `fares: [...]` — e **apague** as `fares` das pernas | `"package"` |
| Tarifas nas **pernas** | **omita a chave `fares` por completo** | `"per-leg"` |
| **Sem tarifa nenhuma** | `fares: []` | `"package"` |

### Duas regras que vêm daí

**1. A tarifa mora em UM lugar só.**

Se a raiz está preenchida, apague as `fares` das pernas. Publicar nos dois lugares deixa as tarifas
da perna fora de todo caminho de dinheiro: quem calcula para na raiz não-vazia, e as da perna saem
com o preço cru — sem conversão de moeda, dentro de um item rotulado noutra moeda.

**2. `[]` na raiz seria ambíguo.**

Quem consome não saberia se é *"pacote sem tarifa"* ou *"as tarifas estão nas pernas"*.

### Derive o `fareModel` da posição

Se o seu código não carimbar `fareModel` explicitamente, derive-o:

```
raiz preenchida                     →  "package"
raiz ausente + pernas com fares     →  "per-leg"
raiz ausente + pernas sem fares     →  "package"   (e fares: [] na raiz)
fareModel declarado explicitamente  →  vence sempre
```

**Por que derivar:** a natureza estava codificada duas vezes de forma independente (a presença da
chave × a string). Um código que movia as tarifas para as pernas e esquecia o carimbo saía como
`"package"` — **um seletor só na tela, cobrando a soma das duas pernas.**

### Para quem consome

```js
if (!oferta.fares)              // ✅ cobre chave ausente E lista vazia
if (oferta.fares.length === 0)  // ❌ TypeError quando a chave não existe
```

---

## 7. `appliesTo`

Diz a quais trechos uma tarifa se aplica.

| Valor | Significa |
|---|---|
| `"all"` | Cobre a viagem inteira |
| `["departure"]` / `["return"]` | Ida-e-volta com tarifa por direção |
| `[0]`, `[1]`, `[2]` | Índice do trecho no multidestino |
| **chave ausente** ou `null` | Cobre a viagem inteira |

### A semântica formal

- `appliesTo` ausente, `null` ou `"all"` → as tarifas da lista são **ALTERNATIVAS** ⇒ o preço é a
  **MENOR** delas.
- `appliesTo` presente e ≠ `"all"` em **TODAS** as tarifas de uma lista com mais de um item → elas
  são **COMPLEMENTARES** ⇒ o preço é a **SOMA**.

### 🔴 Emita, mas não dependa dele

**Emita `appliesTo` nas tarifas de trecho.** É o contrato, e a reserva o consome para amarrar tarifa
a trecho.

**Mas o sinal primário para o dinheiro é a POSIÇÃO**, não este campo.

Quem calcula usa *"uma escolha por trecho, somando os trechos"* a partir da estrutura, e o
`appliesTo` é confirmação. Se ele estiver presente, ele manda; se estiver ausente, a posição resolve.

**Nunca construa o cálculo de preço em cima dele sozinho.**

Aceite as duas grafias na entrada: string crua (`"departure"`) e array (`["departure"]`).

---

## 8. Os invariantes de dinheiro

Estes valem para **todas** as combinações. São o que separa um resultado certo de um bug caro.

### I1 — `price.total` é sempre uma combinação REALMENTE comprável

- **`package`** → a **mais barata das alternativas** da raiz.
- **`per-leg`** → a **soma da mais barata de cada trecho**.

O algoritmo é: **uma escolha por trecho, somando os trechos.** Nunca a soma de todas as listas, nunca
o mínimo global.

### I2 — Somar as pernas de um PACOTE dobra o preço

Num `package`, `price.total` já cobre a viagem inteira, e as pernas **não têm** `fares`.

O inverso é simétrico: num `per-leg`, **ler só uma perna mostra METADE** (ou uma fração, no
multidestino).

### I3 — Dentro de uma direção ou de um trecho, as opções COMPETEM

`legs[i][0..n]` e `group.departure[0..n]` são alternativas de horário pelo mesmo preço. Somá-las dá
"3 idas + 1 volta".

### I4 — `base + taxes + fees` fecha com `total`

Na sua API — que devolve o valor **cru do fornecedor** — a decomposição tem que fechar.

Se não fechar, ou você perdeu uma parcela ou somou duas vezes.

> Onde há margem comercial aplicada (fora do escopo deste desafio), essa igualdade deixa de valer de
> propósito: só o total é reescrito e as partes permanecem cruas. Não é o seu caso.

### I5 — `fees[].total` × `fees[].value`

- **`total`** = o valor da reserva INTEIRA, todos os passageiros.
- **`value`** = o valor de UM passageiro adulto.

**Sempre some `total`.** Numa busca com 2 adultos, `value` é metade do cobrado.

Foi o erro mais comum de uma auditoria real de mapeamento.

### I6 — `fares[].fees[]` é detalhamento, não parcela a somar

Já está dentro de `price.total`.

E **pode não cobrir tudo**: é a discriminação do que a companhia **nomeia**. Algumas nomeiam só o
somatório de impostos. Vem `[]` quando ela não discrimina nada.

### I7 — Decomposição por passageiro

```
adult × nº adultos + child × nº crianças + baby × nº bebês == total.total
```

Os nós são **unitários**. Quando a fonte não separa, os **três** vêm `null` juntos.

Uma taxa de valor fixo é **rateada igualmente** entre os passageiros — o nó por passageiro é
unitário, não a taxa inteira.

### I8 — Taxa declarada pela companhia NÃO se recalcula

Se o retorno cru traz o valor da taxa, **use-o**: o total já o contém.

Recalcular por cima é cobrar duas vezes — num caso real, R$ 43,38 a mais por reserva, até alguém
auditar.

### I9 — Quando você calcula uma taxa mínima, ela vai em TODAS as famílias

Se a companhia cobra `max(percentual × base, valor mínimo)` e você precisa embutir isso, calcule o
**delta por família** (`mínimo − Σ lineares daquela família`). **Não** coloque o valor cheio numa só.

Colocando só na família que compunha o preço de vitrine, você empurra a **família barata acima da
cara**. O cálculo passa a eleger a cara, e a oferta **perde a taxa em silêncio** — vitrine abaixo do
cobrado, e 409 no gate de re-tarifa.

Com o delta por família a ordem se preserva, porque `total = base + max(Σ linear, mínimo)` é
crescente na base.

### I10 — Ordene pela família mais barata, nunca por `fares[0]`

Ver [`03`](03-availability.md) §7.

---

## 9. Um exemplo completo por variação

Todos são o campo `data` de um evento `provider_success`. Campos abreviados com `…` onde não mudam
nada.

### 9.1 Ida × trecho solto

```json
{
  "departure": [
    {
      "identifier": "ACME-OW-GRU-REC-0001",
      "company": { "code": "G3", "name": "Acme Air" },
      "origin":      { "iata": "GRU", "city": "São Paulo", "terminal": "3",
                       "coordinates": { "lat": -23.4356, "lng": -46.4731 } },
      "destination": { "iata": "REC", "city": "Recife", "terminal": null,
                       "coordinates": { "lat": -8.1264, "lng": -34.9236 } },
      "time": { "departure": "2026-06-12T08:20:00-03:00",
                "arrival":   "2026-06-12T11:25:00-03:00", "duration": 185 },
      "stops": 0,
      "fareSelection": { "fareCode": "ONJAAG2J", "bookingCode": "O", "familyCode": "LIG" },
      "flights": [
        {
          "origin":      { "iata": "GRU", "city": "São Paulo", "terminal": "3",
                           "coordinates": { "lat": -23.4356, "lng": -46.4731 } },
          "destination": { "iata": "REC", "city": "Recife", "terminal": null,
                           "coordinates": { "lat": -8.1264, "lng": -34.9236 } },
          "time": { "departure": "2026-06-12T08:20:00-03:00",
                    "arrival":   "2026-06-12T11:25:00-03:00", "duration": 185 },
          "company": { "code": "G3", "name": "Acme Air", "operating": null },
          "number": "1234", "segment": 0, "connection": false,
          "equipment": { "code": "738", "name": "Boeing 737-800", "description": null },
          "cabin": "economy"
        }
      ],
      "fares": [
        {
          "fareId": "ACME-FARE-LIGHT-0001",
          "code": "LIGHT", "familyCode": "LIGHT", "family": "Light",
          "fareCode": "ONJAAG2J", "bookingCode": "O", "cabin": "economy", "seats": 4,
          "price": {
            "adult": { "base": 245.00,
                       "taxes": { "boarding": 35.75, "service": 0, "fuel": 0, "baggage": 0 },
                       "fees": 12.00, "total": 292.75 },
            "child": null, "baby": null,
            "total": { "base": 245.00,
                       "taxes": { "boarding": 35.75, "service": 0, "fuel": 0, "baggage": 0 },
                       "fees": 12.00, "total": 292.75, "currency": "BRL" },
            "perPassenger": 292.75, "net": null, "exchange": null
          },
          "fees": [
            { "code": "BR3", "name": "Taxa de Embarque", "type": "fixed",
              "value": 35.75, "total": 35.75, "currency": "BRL",
              "included": true, "countryCode": "BR", "route": null },
            { "code": "DU", "name": "Taxa de Distribuição", "type": "fixed",
              "value": 12.00, "total": 12.00, "currency": "BRL",
              "included": true, "countryCode": null, "route": null }
          ],
          "baggage": {
            "hand": { "included": true,  "pieces": 1, "weight": 10, "unit": "kg",
                      "description": "Uma peça de até 10 kg" },
            "hold": { "included": false, "pieces": 0, "weight": 0, "unit": "kg",
                      "description": null, "type": "checked" }
          },
          "rules": {
            "refundable": false, "changeable": true,
            "key": "eyJjYXJyaWVyIjoiRzMiLCJvcmlnaW4iOiJHUlUifQ",
            "penalties": [
              { "type": "change", "amount": 180.00, "amountType": "fixed",
                "currency": "BRL", "description": "Multa de remarcação" }
            ],
            "endorsable": null, "transferable": null,
            "refund": null,
            "change": { "amount": 180.00, "currency": "BRL" },
            "cancellation": null, "noShow": null
          },
          "benefits": {
            "wifi": null, "catering": null, "entertainment": null,
            "seatSelection": { "status": "chargeable", "description": "Seleção de assento",
                               "amount": 45.00, "currency": "BRL" },
            "extraSpaceSeat": null, "priorityBoarding": null,
            "loyalty": { "status": "included", "description": "Acúmulo de pontos",
                         "amount": null, "currency": null },
            "lounge": null
          }
        },
        {
          "fareId": "ACME-FARE-PLUS-0001",
          "code": "PLUS", "familyCode": "PLUS", "family": "Plus",
          "fareCode": "ONJPAG2J", "bookingCode": "P", "cabin": "economy", "seats": 9,
          "price": {
            "adult": { "base": 410.00,
                       "taxes": { "boarding": 35.75, "service": 0, "fuel": 0, "baggage": 0 },
                       "fees": 12.00, "total": 457.75 },
            "child": null, "baby": null,
            "total": { "base": 410.00,
                       "taxes": { "boarding": 35.75, "service": 0, "fuel": 0, "baggage": 0 },
                       "fees": 12.00, "total": 457.75, "currency": "BRL" },
            "perPassenger": 457.75, "net": null, "exchange": null
          },
          "fees": [ /* … */ ],
          "baggage": {
            "hand": { "included": true, "pieces": 1, "weight": 10, "unit": "kg", "description": null },
            "hold": { "included": true, "pieces": 1, "weight": 23, "unit": "kg",
                      "description": "Uma peça de até 23 kg", "type": "checked" }
          },
          "rules": { "refundable": true, "changeable": true, "key": "…",
                     "penalties": [], "endorsable": null, "transferable": null,
                     "refund": null, "change": null, "cancellation": null, "noShow": null },
          "benefits": { "wifi": null, "catering": null, "entertainment": null,
                        "seatSelection": { "status": "included", "description": null,
                                           "amount": null, "currency": null },
                        "extraSpaceSeat": null, "priorityBoarding": null,
                        "loyalty": null, "lounge": null }
        }
      ],
      "fees": []
    }
  ],
  "return": []
}
```

**Preço de vitrine = 292,75** — a família mais barata. Não há total no item.

### 9.2 Ida-e-volta × pacote

```json
{
  "groups": [
    {
      "id": 1,
      "price": { "total": 1280.45, "perPassenger": 640.23, "currency": "BRL" },
      "departure": [
        {
          "identifier": "ACME-RT-DEP-0001",
          "company": { "code": "G3", "name": "Acme Air" },
          "origin":      { "iata": "GRU", "city": "São Paulo", "terminal": "3",
                           "coordinates": { "lat": -23.4356, "lng": -46.4731 } },
          "destination": { "iata": "REC", "city": "Recife", "terminal": null,
                           "coordinates": { "lat": -8.1264, "lng": -34.9236 } },
          "time": { "departure": "2026-06-12T08:20:00-03:00",
                    "arrival": "2026-06-12T11:25:00-03:00", "duration": 185 },
          "stops": 0,
          "fareSelection": { "fareCode": "ONJAAG2J", "bookingCode": "O", "familyCode": "LIG" },
          "flights": [ { "number": "1234", "segment": 0, "connection": false, "cabin": "economy",
                         "company": { "code": "G3", "name": "Acme Air", "operating": null },
                         "origin": { "iata": "GRU", "city": "São Paulo", "terminal": "3",
                                     "coordinates": { "lat": -23.4356, "lng": -46.4731 } },
                         "destination": { "iata": "REC", "city": "Recife", "terminal": null,
                                          "coordinates": { "lat": -8.1264, "lng": -34.9236 } },
                         "time": { "departure": "2026-06-12T08:20:00-03:00",
                                   "arrival": "2026-06-12T11:25:00-03:00", "duration": 185 },
                         "equipment": { "code": "738", "name": "Boeing 737-800", "description": null } } ],
          "fees": []
        }
      ],
      "return": [
        {
          "identifier": "ACME-RT-RET-0001",
          "company": { "code": "G3", "name": "Acme Air" },
          "origin":      { "iata": "REC", "city": "Recife", "terminal": null,
                           "coordinates": { "lat": -8.1264, "lng": -34.9236 } },
          "destination": { "iata": "GRU", "city": "São Paulo", "terminal": "3",
                           "coordinates": { "lat": -23.4356, "lng": -46.4731 } },
          "time": { "departure": "2026-06-19T17:40:00-03:00",
                    "arrival": "2026-06-19T20:55:00-03:00", "duration": 195 },
          "stops": 0,
          "fareSelection": { "fareCode": "ONJAAG2J", "bookingCode": "O", "familyCode": "LIG" },
          "flights": [ { "number": "4321", "segment": 0, "connection": false, "cabin": "economy",
                         "company": { "code": "G3", "name": "Acme Air", "operating": null },
                         "origin": { "iata": "REC", "city": "Recife", "terminal": null,
                                     "coordinates": { "lat": -8.1264, "lng": -34.9236 } },
                         "destination": { "iata": "GRU", "city": "São Paulo", "terminal": "3",
                                          "coordinates": { "lat": -23.4356, "lng": -46.4731 } },
                         "time": { "departure": "2026-06-19T17:40:00-03:00",
                                   "arrival": "2026-06-19T20:55:00-03:00", "duration": 195 },
                         "equipment": { "code": "738", "name": "Boeing 737-800", "description": null } } ],
          "fees": []
        }
      ],
      "fares": [
        { "fareId": "ACME-RT-LIGHT-01", "familyCode": "LIGHT", "family": "Light",
          "fareCode": "ONJAAG2J", "bookingCode": "O", "cabin": "economy", "seats": 4,
          "price": { "adult": { "base": 560.00,
                                "taxes": { "boarding": 71.50, "service": 0, "fuel": 0, "baggage": 0 },
                                "fees": 8.72, "total": 640.22 },
                     "child": null, "baby": null,
                     "total": { "base": 1120.00,
                                "taxes": { "boarding": 143.00, "service": 0, "fuel": 0, "baggage": 0 },
                                "fees": 17.45, "total": 1280.45, "currency": "BRL" },
                     "perPassenger": 640.23, "net": null, "exchange": null },
          "fees": [ { "code": "BR3", "name": "Taxa de Embarque", "type": "fixed",
                      "value": 71.50, "total": 143.00, "currency": "BRL",
                      "included": true, "countryCode": "BR", "route": null } ],
          "baggage": { "hand": { "included": true, "pieces": 1, "weight": 10, "unit": "kg", "description": null },
                       "hold": { "included": false, "pieces": 0, "weight": 0, "unit": "kg",
                                 "description": null, "type": "checked" } },
          "rules": { "refundable": false, "changeable": true, "key": "…", "penalties": [],
                     "endorsable": null, "transferable": null, "refund": null,
                     "change": null, "cancellation": null, "noShow": null },
          "benefits": { "wifi": null, "catering": null, "entertainment": null,
                        "seatSelection": null, "extraSpaceSeat": null,
                        "priorityBoarding": null, "loyalty": null, "lounge": null } },
        { "fareId": "ACME-RT-PLUS-01", "familyCode": "PLUS", "family": "Plus",
          "fareCode": "ONJPAG2J", "bookingCode": "P", "cabin": "economy", "seats": 9,
          "price": { "adult": null, "child": null, "baby": null,
                     "total": { "base": 1690.00,
                                "taxes": { "boarding": 143.00, "service": 0, "fuel": 0, "baggage": 0 },
                                "fees": 17.45, "total": 1850.45, "currency": "BRL" },
                     "perPassenger": 925.23, "net": null, "exchange": null },
          "fees": [ /* … */ ],
          "baggage": { "hand": { "included": true, "pieces": 1, "weight": 10, "unit": "kg", "description": null },
                       "hold": { "included": true, "pieces": 1, "weight": 23, "unit": "kg",
                                 "description": null, "type": "checked" } },
          "rules": { "refundable": true, "changeable": true, "key": "…", "penalties": [],
                     "endorsable": null, "transferable": null, "refund": null,
                     "change": null, "cancellation": null, "noShow": null },
          "benefits": { "wifi": null, "catering": null, "entertainment": null,
                        "seatSelection": null, "extraSpaceSeat": null,
                        "priorityBoarding": null, "loyalty": null, "lounge": null } }
      ],
      "fareModel": "package"
    }
  ],
  "departure": [ /* os mesmos voos de ida, avulsos, cada um com o SEU fares[] */ ],
  "return":    [ /* idem para a volta */ ]
}
```

`price.total` = **1280,45** = a mais barata das duas alternativas da raiz.

Repare que as pernas **não têm** `fares`.

### 9.3 Ida-e-volta × trecho solto

```json
{
  "groups": [],
  "departure": [
    { "identifier": "ACME-DEP-0001", "company": { "code": "AD", "name": "Acme Air" },
      "origin":      { "iata": "GRU", "city": "São Paulo", "terminal": "2",
                       "coordinates": { "lat": -23.4356, "lng": -46.4731 } },
      "destination": { "iata": "REC", "city": "Recife", "terminal": null,
                       "coordinates": { "lat": -8.1264, "lng": -34.9236 } },
      "time": { "departure": "2026-06-12T07:15:00-03:00",
                "arrival": "2026-06-12T10:20:00-03:00", "duration": 185 },
      "stops": 0,
      "flights": [ /* … */ ],
      "fares": [ { "fareId": "ACME-DEP-MZL", "familyCode": "MZL", "family": "Mais",
                   "cabin": "economy",
                   "price": { "adult": null, "child": null, "baby": null,
                              "total": { "base": 618.00,
                                         "taxes": { "boarding": 38.20, "service": 0, "fuel": 0, "baggage": 0 },
                                         "fees": 0, "total": 656.20, "currency": "BRL" },
                              "perPassenger": 656.20, "net": null, "exchange": null },
                   "fees": [], "baggage": { /* … */ }, "rules": { /* … */ }, "benefits": { /* … */ } } ],
      "fees": [] }
  ],
  "return": [
    { "identifier": "ACME-RET-0001", "company": { "code": "AD", "name": "Acme Air" },
      "origin":      { "iata": "REC", "city": "Recife", "terminal": null,
                       "coordinates": { "lat": -8.1264, "lng": -34.9236 } },
      "destination": { "iata": "GRU", "city": "São Paulo", "terminal": "2",
                       "coordinates": { "lat": -23.4356, "lng": -46.4731 } },
      "time": { "departure": "2026-06-19T18:40:00-03:00",
                "arrival": "2026-06-19T21:55:00-03:00", "duration": 195 },
      "stops": 0,
      "flights": [ /* … */ ],
      "fares": [ { "fareId": "ACME-RET-MZL", "familyCode": "MZL", "family": "Mais",
                   "cabin": "economy",
                   "price": { "adult": null, "child": null, "baby": null,
                              "total": { "base": 580.00,
                                         "taxes": { "boarding": 38.20, "service": 0, "fuel": 0, "baggage": 0 },
                                         "fees": 0, "total": 618.20, "currency": "BRL" },
                              "perPassenger": 618.20, "net": null, "exchange": null },
                   "fees": [], "baggage": { /* … */ }, "rules": { /* … */ }, "benefits": { /* … */ } } ],
      "fees": [] }
  ]
}
```

`groups: []` presente e vazio. O cliente compõe 656,20 + 618,20.

### 9.4 Multidestino × pacote

```json
{
  "itineraries": [
    {
      "id": 1,
      "airline": "G3",
      "price": { "total": 2450.00, "perPassenger": 1225.00, "currency": "BRL" },
      "legs": [
        [ { "identifier": "ACME-MC-L0-A", "company": { "code": "G3", "name": "Acme Air" },
            "origin":      { "iata": "POA", "city": "Porto Alegre", "terminal": null,
                             "coordinates": { "lat": -29.9944, "lng": -51.1714 } },
            "destination": { "iata": "GRU", "city": "São Paulo", "terminal": "3",
                             "coordinates": { "lat": -23.4356, "lng": -46.4731 } },
            "time": { "departure": "2026-06-10T06:10:00-03:00",
                      "arrival": "2026-06-10T08:05:00-03:00", "duration": 115 },
            "stops": 0,
            "fareSelection": { "fareCode": "ONJAAG2J", "bookingCode": "O", "familyCode": "LIG" },
            "flights": [ /* … */ ], "fees": [] },
          { "identifier": "ACME-MC-L0-B",
            "time": { "departure": "2026-06-10T14:30:00-03:00",
                      "arrival": "2026-06-10T16:25:00-03:00", "duration": 115 },
            "company": { "code": "G3", "name": "Acme Air" },
            "origin":      { "iata": "POA", "city": "Porto Alegre", "terminal": null,
                             "coordinates": { "lat": -29.9944, "lng": -51.1714 } },
            "destination": { "iata": "GRU", "city": "São Paulo", "terminal": "3",
                             "coordinates": { "lat": -23.4356, "lng": -46.4731 } },
            "stops": 0,
            "fareSelection": { "fareCode": "ONJAAG2J", "bookingCode": "O", "familyCode": "LIG" },
            "flights": [ /* … */ ], "fees": [] } ],
        [ { "identifier": "ACME-MC-L1-A", "company": { "code": "G3", "name": "Acme Air" },
            "origin":      { "iata": "GRU", "city": "São Paulo", "terminal": "3",
                             "coordinates": { "lat": -23.4356, "lng": -46.4731 } },
            "destination": { "iata": "SSA", "city": "Salvador", "terminal": null,
                             "coordinates": { "lat": -12.9086, "lng": -38.3225 } },
            "time": { "departure": "2026-06-14T10:10:00-03:00",
                      "arrival": "2026-06-14T12:35:00-03:00", "duration": 145 },
            "stops": 0,
            "fareSelection": { "fareCode": "ONJMAG2J", "bookingCode": "M", "familyCode": "LIG" },
            "flights": [ /* … */ ], "fees": [] } ]
      ],
      "fares": [
        { "fareId": "ACME-MC-PKG-LIGHT",
          "familyCode": "LIGHT", "family": "Light", "cabin": "economy", "seats": 5,
          "legFareIds": ["ACME-MC-FARE-L0", "ACME-MC-FARE-L1"],
          "price": { "adult": null, "child": null, "baby": null,
                     "total": { "base": 2180.00,
                                "taxes": { "boarding": 240.00, "service": 0, "fuel": 0, "baggage": 0 },
                                "fees": 30.00, "total": 2450.00, "currency": "BRL" },
                     "perPassenger": 1225.00, "net": null, "exchange": null },
          "fees": [ { "code": "BR3", "name": "Taxa de Embarque", "type": "fixed",
                      "value": 120.00, "total": 240.00, "currency": "BRL",
                      "included": true, "countryCode": "BR", "route": null } ],
          "baggage": { /* … */ }, "rules": { /* … */ }, "benefits": { /* … */ } }
      ],
      "fareModel": "package"
    }
  ]
}
```

O trecho 0 tem **duas opções de horário pelo mesmo preço**.

`legFareIds` carrega o identificador da tarifa de cada trecho, porque a reserva manda um por trecho.

### 9.5 Multidestino × trecho solto

```json
{
  "itineraries": [
    {
      "id": 1,
      "airline": "AD",
      "price": { "total": 780.00, "perPassenger": 780.00, "currency": "BRL" },
      "legs": [
        [
          { "identifier": "ACME-LOOSE-L0-A", "company": { "code": "AD", "name": "Acme Air" },
            "origin":      { "iata": "POA", "city": "Porto Alegre", "terminal": null,
                             "coordinates": { "lat": -29.9944, "lng": -51.1714 } },
            "destination": { "iata": "GRU", "city": "São Paulo", "terminal": "2",
                             "coordinates": { "lat": -23.4356, "lng": -46.4731 } },
            "time": { "departure": "2026-09-15T08:00:00-03:00",
                      "arrival": "2026-09-15T09:55:00-03:00", "duration": 115 },
            "stops": 0,
            "flights": [ /* … */ ],
            "fares": [
              { "fareId": "ACME-L0-LIGHT", "familyCode": "LIGHT", "family": "Light",
                "cabin": "economy", "appliesTo": [0],
                "price": { "adult": null, "child": null, "baby": null,
                           "total": { "base": 430.00,
                                      "taxes": { "boarding": 50.00, "service": 0, "fuel": 0, "baggage": 0 },
                                      "fees": 0, "total": 480.00, "currency": "BRL" },
                           "perPassenger": 480.00, "net": null, "exchange": null },
                "fees": [], "baggage": { /* … */ }, "rules": { /* … */ }, "benefits": { /* … */ } }
            ],
            "fees": [] },
          { "identifier": "ACME-LOOSE-L0-B",
            "time": { "departure": "2026-09-15T18:00:00-03:00",
                      "arrival": "2026-09-15T19:55:00-03:00", "duration": 115 },
            "company": { "code": "AD", "name": "Acme Air" },
            "origin":      { "iata": "POA", "city": "Porto Alegre", "terminal": null,
                             "coordinates": { "lat": -29.9944, "lng": -51.1714 } },
            "destination": { "iata": "GRU", "city": "São Paulo", "terminal": "2",
                             "coordinates": { "lat": -23.4356, "lng": -46.4731 } },
            "stops": 0,
            "flights": [ /* … */ ],
            "fares": [
              { "fareId": "ACME-L0-LIGHT-B", "familyCode": "LIGHT", "family": "Light",
                "cabin": "economy", "appliesTo": [0],
                "price": { "adult": null, "child": null, "baby": null,
                           "total": { "base": 430.00,
                                      "taxes": { "boarding": 50.00, "service": 0, "fuel": 0, "baggage": 0 },
                                      "fees": 0, "total": 480.00, "currency": "BRL" },
                           "perPassenger": 480.00, "net": null, "exchange": null },
                "fees": [], "baggage": { /* … */ }, "rules": { /* … */ }, "benefits": { /* … */ } }
            ],
            "fees": [] }
        ],
        [
          { "identifier": "ACME-LOOSE-L1-A", "company": { "code": "AD", "name": "Acme Air" },
            "origin":      { "iata": "GRU", "city": "São Paulo", "terminal": "2",
                             "coordinates": { "lat": -23.4356, "lng": -46.4731 } },
            "destination": { "iata": "SSA", "city": "Salvador", "terminal": null,
                             "coordinates": { "lat": -12.9086, "lng": -38.3225 } },
            "time": { "departure": "2026-09-20T11:00:00-03:00",
                      "arrival": "2026-09-20T13:25:00-03:00", "duration": 145 },
            "stops": 0,
            "flights": [ /* … */ ],
            "fares": [
              { "fareId": "ACME-L1-LIGHT", "familyCode": "LIGHT", "family": "Light",
                "cabin": "economy", "appliesTo": [1],
                "price": { "adult": null, "child": null, "baby": null,
                           "total": { "base": 260.00,
                                      "taxes": { "boarding": 40.00, "service": 0, "fuel": 0, "baggage": 0 },
                                      "fees": 0, "total": 300.00, "currency": "BRL" },
                           "perPassenger": 300.00, "net": null, "exchange": null },
                "fees": [], "baggage": { /* … */ }, "rules": { /* … */ }, "benefits": { /* … */ } }
            ],
            "fees": [] }
        ]
      ],
      "fareModel": "per-leg"
    }
  ]
}
```

🔴 **Repare: não existe a chave `fares` na raiz do itinerário.**

`price.total` = 480 + 300 = **780**. Trocar de horário no trecho 0 não muda o valor — é por isso que
as duas opções vieram juntas.

---

## 10. Checklist de conferência

Antes de considerar a busca pronta:

**Classificação**
- [ ] Classifiquei meu provedor: pacote declarado × trecho solto (§2).
- [ ] Nunca ofereço uma combinação que a companhia não declarou.

**Formato por tipo de viagem**
- [ ] Ida emite `departure[]` + `return: []`, tarifas na raiz de cada voo, sem `groups`.
- [ ] Ida-e-volta emite as **três** chaves (`groups`, `departure`, `return`), vazias quando não há.
- [ ] Ida-e-volta com só uma direção e sem pacote → **suprimo o provedor** com `NO_FLIGHTS`.
- [ ] Multidestino emite **só** `itineraries[]`.

**Estrutura**
- [ ] `legs` é sempre um array **de arrays**, mesmo com um voo por trecho.
- [ ] Nunca compacto `legs` — a posição é o trecho.
- [ ] Quando as tarifas estão nas pernas, **omito a chave `fares` da raiz** (não emito `[]`).
- [ ] Quando as tarifas estão na raiz, **apago as das pernas**.
- [ ] `fareModel` concorda com onde as tarifas estão.

**Dinheiro**
- [ ] `price.total` é uma combinação realmente comprável (§8, I1).
- [ ] `base + taxes + fees == total`.
- [ ] Somo `fees[].total`, nunca `fees[].value`.
- [ ] Ordeno pela família mais barata, não por `fares[0]`.
- [ ] Aplico o teto de resultados **depois** da ordenação.

**Dados**
- [ ] Cabine vem do campo documentado como cabine — nunca da letra nem do nome da família.
