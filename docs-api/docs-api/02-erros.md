# 02 — Como toda rota falha

**Todas as rotas falham do mesmo jeito.** Um corpo só, um código estável, um status HTTP por
cenário.

A regra para quem consome: **trate pelo código, nunca pela mensagem.** A mensagem pode mudar; o
código não.

---

## 1. O corpo de erro

```json
{
  "success": false,
  "error": { "code": "FARE_UNAVAILABLE", "category": "conflict" },
  "message": "The selected fare is no longer available.",
  "correlationId": "req-fare-unavailable-001",
  "provider": "acme-air",
  "providerError": {
    "provider": "acme-air",
    "operation": "quote",
    "providerCode": "1051",
    "providerMessage": "Fare class not available for the requested date",
    "providerSeverity": null,
    "httpStatus": 400
  },
  "details": null,
  "metadata": { "operation": "quote", "duration": 912 }
}
```

| Campo | Tipo | Presença | O que é |
|---|---|---|---|
| `success` | `false` | **sempre** | Literalmente `false`. É o discriminador |
| `error.code` | `string` | **sempre** | O código do catálogo (§2). **É este campo que quem consome usa para ramificar** |
| `error.category` | `string` | **sempre** | A família do erro. Serve para agrupar — o código é a chave estável |
| `message` | `string` | **sempre** | **Em inglês.** Vem do catálogo, não do erro interno e não da companhia. Não é traduzida |
| `correlationId` | `string` \| `null` | **sempre** | Identificador da requisição. É a única ponte entre esta resposta e o log com o detalhe cru |
| `provider` | `string` \| `null` | condicional | Onde a falha ocorreu. Ausente quando não há um provedor envolvido |
| `providerError` | `object` \| `null` | condicional | Uma janela **sanitizada** do erro da companhia (§3) |
| `details` | `object` \| `array` \| `null` | condicional | Diagnóstico **estruturado**, nunca texto cru. Em erro de validação: `{errors: {campo: [msgs]}}` |
| `metadata` | `object` | condicional | Contexto: `operation`, `duration`. Omitido quando vazio |

**Campos opcionais são omitidos, não emitidos como `null`.** Quem consome trata ausência como
ausência.

O status HTTP **não** aparece no corpo — ele vem do catálogo.

### 🔴 Sem prefixo de serviço no código

É `FARE_UNAVAILABLE`, não `FLIGHT_FARE_UNAVAILABLE`. O serviço já está no nome da API; o prefixo só
ocuparia espaço.

---

## 2. O catálogo de códigos

18 códigos. Todo erro da sua API cai em um deles.

Estão agrupados por situação, para facilitar a leitura. A tabela completa com HTTP e mensagem está
logo abaixo.

### Por situação

**O pedido está errado**

| Código | HTTP | Quando |
|---|---|---|
| `SEARCH_VALIDATION_ERROR` | 400 | Corpo reprovado pelo schema, JSON malformado, chave opaca corrompida |
| `ROUTE_NOT_FOUND` | 404 | Rota HTTP que não existe |

**O recurso não está no estado esperado**

| Código | HTTP | Quando |
|---|---|---|
| `RESOURCE_NOT_FOUND` | 404 | Localizador, bilhete ou chave que não existe |
| `RESOURCE_CONFLICT` | 409 | Conflito de estado. Ex.: emitir uma reserva já emitida e sem pendência |
| `FARE_UNAVAILABLE` | 409 | A tarifa escolhida não existe mais |
| `FARE_PRICE_CHANGED` | 409 | O preço mudou desde a cotação |
| `BOOKING_ALREADY_CANCELLED` | 409 | Cancelar o que já foi cancelado |
| `BOOKING_PARTIAL_FAILURE` | 409 | Reserva gravou pela metade **e o desfazer também falhou** |

**A companhia recusou, mas o pedido estava certo**

| Código | HTTP | Quando |
|---|---|---|
| `BUSINESS_RULE_VIOLATION` | 422 | Regra da companhia. Payload válido, operação proibida |
| `CAPABILITY_NOT_SUPPORTED` | 501 | A companhia **não oferece** essa operação |
| `PROVIDER_AUTHENTICATION_FAILED` | 401 | Ela recusou as credenciais |

**Algo deu errado no caminho**

| Código | HTTP | Quando |
|---|---|---|
| `PROVIDER_INTEGRATION_ERROR` | 502 | A companhia respondeu quebrado |
| `PROVIDER_UNAVAILABLE` | 503 | Você escolheu **não chamar** a companhia |
| `PROVIDER_TIMEOUT` | 504 | Ela não respondeu no tempo |
| `ENDPOINT_PROFILE_UNAVAILABLE` | 503 | Não há endereço configurado para aquele ambiente |
| `RATE_LIMITED` | 429 | Teto de requisições estourado |
| `UNEXPECTED_ERROR` | 500 | Bug seu, não classificado |
| `PRICING_ERROR` | 502 | Falha no cálculo do preço |

### Tabela completa

| `error.code` | HTTP | `category` | `message` (literal, em inglês) |
|---|---|---|---|
| `SEARCH_VALIDATION_ERROR` | **400** | `validation` | `The request payload is invalid.` |
| `PROVIDER_AUTHENTICATION_FAILED` | **401** | `provider_authentication` | `The provider rejected the configured credentials.` |
| `RESOURCE_NOT_FOUND` | **404** | `not_found` | `The requested resource was not found.` |
| `ROUTE_NOT_FOUND` | **404** | `not_found` | `The requested route does not exist.` |
| `RESOURCE_CONFLICT` | **409** | `conflict` | `The request conflicts with the current resource state.` |
| `FARE_UNAVAILABLE` | **409** | `conflict` | `The selected fare is no longer available.` |
| `FARE_PRICE_CHANGED` | **409** | `conflict` | `The fare price changed since it was quoted.` |
| `BOOKING_ALREADY_CANCELLED` | **409** | `conflict` | `The booking is already cancelled.` |
| `BOOKING_PARTIAL_FAILURE` | **409** | `conflict` | `Booking partially failed and could not be rolled back.` |
| `BUSINESS_RULE_VIOLATION` | **422** | `business_rule` | `The operation violates a provider or business rule.` |
| `RATE_LIMITED` | **429** | `rate_limit` | `Too many requests. Please retry later.` |
| `UNEXPECTED_ERROR` | **500** | `unexpected` | `The request could not be completed.` |
| `CAPABILITY_NOT_SUPPORTED` | **501** | `not_supported` | `This provider does not support the requested operation.` |
| `PROVIDER_INTEGRATION_ERROR` | **502** | `integration` | `The request to the provider could not be completed.` |
| `PRICING_ERROR` | **502** | `pricing` | `The price could not be calculated.` |
| `PROVIDER_UNAVAILABLE` | **503** | `integration` | `The provider is temporarily unavailable. Please retry shortly.` |
| `ENDPOINT_PROFILE_UNAVAILABLE` | **503** | `endpoint_configuration` | `The provider endpoint profile is unavailable for this operation.` |
| `PROVIDER_TIMEOUT` | **504** | `timeout` | `The provider did not respond in time.` |

**Código desconhecido resolve para `UNEXPECTED_ERROR` (500).** A sua função de lookup nunca deve
lançar nem devolver indefinido.

### As distinções que custam caro se você errar

Alguns pares parecem próximos e não são. Cada um manda quem consome fazer uma coisa diferente:

**502 × 503 × 504**

- **502** — a companhia **respondeu**, e a resposta estava quebrada.
- **503** — você **não chamou** a companhia (circuito aberto, degradação deliberada).
- **504** — você chamou e ela **não respondeu no tempo**.

**409 `FARE_PRICE_CHANGED` × 409 `FARE_UNAVAILABLE`**

- Preço mudou → a oferta **existe**, custa outro valor. Quem consome mostra o novo preço.
- Tarifa sumiu → a oferta **não existe mais**. Quem consome volta para a busca.

**401 `PROVIDER_AUTHENTICATION_FAILED` × 502**

- 401 → a companhia **olhou a credencial e recusou**. Ação: revisar o cadastro. **Não retentar.**
- 502 → problema técnico. Ação: **retentar**.

Errar isso manda alguém mexer num cadastro que estava certo.

**409 `BOOKING_PARTIAL_FAILURE` é 409, não 502**

502 significa "tente de novo". Mas aqui existe uma **reserva viva** do outro lado — retentar cria
uma segunda. 409 diz "pare e olhe".

**501 `CAPABILITY_NOT_SUPPORTED` × 400**

- 501 → a operação **existe no contrato**, mas a companhia não faz.
- 400 → o que você mandou está errado.

**422 `BUSINESS_RULE_VIOLATION` × 400**

- 422 → o pedido estava **correto**; a companhia é que não permite aquilo.
- 400 → o pedido estava **malformado**.

### Categorias

```
validation · not_found · conflict · business_rule · not_supported ·
provider_authentication · integration · timeout · endpoint_configuration ·
rate_limit · pricing · unexpected
```

> **Nota.** O sistema real tem mais 7 códigos, todos ligados a autenticação e à escolha de conta —
> assuntos fora deste desafio. Sua API terá os próprios códigos de autenticação; os 18 acima cobrem
> tudo que é do domínio de voo.

---

## 3. A janela `providerError`

Quando o erro veio da companhia, o corpo carrega uma janela **estruturada e sanitizada** — e nada
além dela.

Sempre as mesmas **6 chaves**, `null` onde a companhia não fornece:

| Chave | O que carrega | `null` quando |
|---|---|---|
| `provider` | Nome do provedor, minúsculo, sem espaços nas pontas | **Nunca.** Sem ele, o objeto inteiro vira `null` e o campo some |
| `operation` | Qual operação falhou: `availability`, `quote`, `book`, `issue`, `authenticate`… | Operação desconhecida |
| `providerCode` | Código **nativo** da companhia, como string, cortado em **120 caracteres** | Ela não tem código de erro |
| `providerMessage` | Texto dela, com segredos apagados e cortado em **400 caracteres** (com `…` no fim) | Não é string, ou é vazia |
| `providerSeverity` | Severidade, quando ela informa (`MODERATE`, `CRITICAL`) | A maioria das companhias |
| `httpStatus` | Status HTTP cru da chamada, inteiro entre 100 e 599 | Falha de negócio dentro de um HTTP 200 |

### Como sanitizar

Três passos, nesta ordem:

**1. Monte um objeto NOVO com essas 6 chaves.**

Não filtre o objeto original — construa outro. Assim qualquer campo fora da lista é descartado por
construção. Entrada que não é objeto → o campo inteiro vira `null`.

**2. Apague os segredos, ANTES de cortar o texto.**

Procure na mensagem:

- `chave = valor` ou `chave: valor` para `authorization`, `api-key`, `secret`, `token`, `password`,
  `senha` e variantes → mantenha a chave, troque o valor por `[REDACTED]`;
- `Basic <base64>` e `Bearer <token>` → `[REDACTED]`.

> Mensagem de companhia **não deveria** carregar segredo. Mas um erro serializado já vazou um header
> com token numa captura real. É defesa em profundidade.

**3. Corte em 400 caracteres.**

Depois de apagar os segredos, nunca antes.

### O que nunca pode aparecer

Corpo cru da companhia · headers · URL · stack trace · credencial · qualquer campo além dos 6.

---

## 4. A regra de ouro: o cru só vai para o log

**Mensagem, stack e payload da companhia nunca entram no corpo da resposta.** Vão para o log do
servidor, ligados pelo `correlationId`.

Implemente as **quatro barreiras** abaixo. Disciplina sozinha não sustenta isso:

**1. A mensagem pública vem do catálogo, não do erro.**

O `message` do corpo é a mensagem fixa do código. O `error.message` interno só sai se você
**explicitamente** decidir passá-lo — e o tratamento central não passa.

**2. A janela do provedor passa obrigatoriamente pelo sanitizador.**

Nunca publique o objeto que o ponto de falha anexou. Publique sempre o resultado da sanitização (§3).

**3. `metadata` tem lista de bloqueio.**

Descarte estas chaves: `stack`, `rawError`, `errorMessage`, `originalError`, `providerBody`,
`responseBody`, `requestBody`, `responseHeaders`, `requestHeaders`, `url`. Descarte também valores
`null`/`undefined`.

**4. `details` só recebe estrutura que VOCÊ montou.**

Nunca copie `error.details` automaticamente. É por ali que mensagem de banco, nome de tabela e nome
de schema vazam.

### E o log recebe o oposto

Com uma distinção que vale copiar:

| Status | Nível | Stack? |
|---|---|---|
| **4xx** | `warn` | **não** |
| **5xx** | `error` | **sim**, com o detalhe cru |

Por que 4xx sem stack: 4xx é falha de quem chamou. Depois de uma mudança de contrato, todo cliente
não migrado gerava um erro com stack por requisição — e isso afogou as falhas de verdade no log.

---

## 5. Como decidir qual código usar

Quando um erro sobe, você precisa decidir qual código do catálogo ele é.

**A primeira condição verdadeira vence.** O padrão é `UNEXPECTED_ERROR`.

| Ordem | Teste | Resultado |
|---|---|---|
| 1 | O ponto de falha declarou a natureza do erro (uma dica: `validation`, `not_found`, `conflict`, `fare_price_changed`, `fare_unavailable`, `already_cancelled`, `business_rule`, `rate_limited`) | o código correspondente |
| 2 | **O erro carrega um código do catálogo** — foi lançado por você, já sabendo o que é | esse código |
| 3 | É timeout (`ECONNABORTED`, `ETIMEDOUT`, ou a palavra "timeout" na mensagem) | `PROVIDER_TIMEOUT` |
| 4 | Tem cara de integração: o erro tem resposta HTTP, tem request pendurado, ou está marcado como tal | `PROVIDER_INTEGRATION_ERROR` |
| 5 | Erro **não classificado** numa rota que **já chamou** a companhia | `PROVIDER_INTEGRATION_ERROR` (502) |
| 6 | Sem erro tipado, mas com mensagem ou detalhe de validação | `SEARCH_VALIDATION_ERROR` |
| — | nada bateu | `UNEXPECTED_ERROR` (500) |

### Três decisões de ordem que valem copiar

Cada uma tem um bug real por trás:

**#2 antes de #4.** Um erro 4xx que você mesmo tipou, mas que carrega o nome do provedor, seria
promovido a 502 pelo teste de integração — e quem consome iria retentar uma requisição que nunca vai
funcionar.

**#5 é opt-in por rota, não global.** Só a rota cujo trabalho **é** chamar a companhia promove o
inesperado a 502. As outras mantêm 500. É isso que cobre o caso "a companhia devolve erro sem
marcador nenhum dentro de um HTTP 200".

**Timeout antes de integração.** Senão todo timeout com resposta parcial vira 502, e se perde a
informação de que o problema foi tempo.

---

## 6. Erro de validação: o formato de `details.errors`

Formato único: **`{ campo: [mensagens] }`**.

Um objeto. A chave é o caminho do campo. O valor é um array, porque um campo pode falhar por mais de
um motivo.

```json
{
  "success": false,
  "error": { "code": "SEARCH_VALIDATION_ERROR", "category": "validation" },
  "message": "The request payload is invalid.",
  "correlationId": "req-validation-001",
  "provider": null,
  "details": {
    "errors": {
      "departure.iata": ["IATA deve ter 3 caracteres"],
      "passengers": ["Pelo menos 1 adulto é obrigatório"],
      "options.provider": ["provider[] is required"]
    }
  },
  "metadata": { "operation": "availability" }
}
```

**O caminho do campo** usa **ponto** como separador de nível, e o índice do array entre pontos:

```
quote.offers.0.journeyKey
```

Quando o campo obrigatório está **ausente**, a chave é o nome dele. Quando não dá para determinar o
campo, use `_`.

---

## 7. Erro no stream da busca

A busca fala com vários provedores **em paralelo**. A falha de um **não derruba** a busca — os
outros continuam.

Por isso existem dois eventos de erro diferentes.

### `provider_error` — um provedor falhou, os outros seguem

**Não é o corpo de erro padrão.** É um evento de stream, com um bloco `error` próprio:

```json
{
  "type": "provider_error",
  "provider": "acme-air",
  "data": {
    "error": {
      "message": "Object reference not set to an instance of an object.",
      "code": "9",
      "canonicalCode": "PROVIDER_INTEGRATION_ERROR",
      "category": "integration",
      "providerError": {
        "provider": "acme-air", "operation": "availability",
        "providerCode": "9",
        "providerMessage": "Object reference not set to an instance of an object.",
        "providerSeverity": null, "httpStatus": 400
      }
    },
    "groups": [], "departure": [], "return": []
  },
  "timestamp": "2026-05-09T12:00:05.000Z",
  "groups": 0, "flights": 0
}
```

| Chave em `data.error` | O que carrega |
|---|---|
| `message` | A `providerMessage` **sanitizada**. Sem janela de provedor, a mensagem em inglês do catálogo |
| `code` | Código **nativo** da companhia, como string. `"UNKNOWN"` quando não há |
| `canonicalCode` | O código do catálogo (§2) |
| `category` | A categoria do catálogo |
| `providerError` | A janela sanitizada de 6 chaves — **só quando existe** |

**Duas regras:**

- **Nada de `details` cru.** Só a janela sanitizada sai; o corpo da companhia fica no log.
- **Erro seu não vira erro "do provedor".** Quando o erro é tipado por você e não há erro real de
  companhia, `providerError` sai `null` e a mensagem é a do catálogo — **não** a sua mensagem
  interna. Fabricar uma janela com o seu texto rotula a companhia como culpada e vaza detalhe
  interno num canal que o corpo HTTP já protege.

### `fatal_error` — a busca inteira morreu

Aqui `data` **é** o corpo de erro padrão, montado pelo mesmo código da resposta HTTP:

```json
{
  "type": "fatal_error",
  "data": { /* o corpo de erro da §1, completo */ },
  "timestamp": "2026-05-09T12:00:01.000Z"
}
```

Pode acontecer antes ou depois dos headers do stream. Acontecendo durante o stream, a conexão fecha
depois do evento.

### 🔴 "Sem voos" NÃO é erro

Quando um provedor simplesmente não tem oferta para aquela rota e data:

```json
{
  "type": "provider_error",
  "provider": "acme-air",
  "data": {
    "error": {
      "message": "No flights found for the requested search",
      "code": "NO_FLIGHTS",
      "details": null
    },
    "groups": [], "departure": [], "return": []
  },
  "timestamp": "2026-05-09T12:00:04.000Z",
  "groups": 0, "flights": 0
}
```

Repare:

- `code: "NO_FLIGHTS"` está **fora do catálogo**;
- **não há** `canonicalCode`, `category` nem `providerError`.

Ninguém errou, nada quebrou — o provedor não tem voo.

O envelope de transporte é o mesmo (`type: "provider_error"`) porque, no stream, ele significa *"este
provedor não trouxe resultado"* — e isso cobre os dois casos.

> **Para quem consome: discrimine por `data.error.canonicalCode`, não por `type`.** Só a falha real
> traz `canonicalCode` e `category`.

Num multidestino, o balde vazio muda: o evento manda `itineraries: []`, e a mensagem é
`"No flights found for multi-city search"`.

---

## 8. Exemplos por categoria

**Validação (400)** — ver §6.

**Tarifa indisponível (409)**
```json
{ "success": false,
  "error": { "code": "FARE_UNAVAILABLE", "category": "conflict" },
  "message": "The selected fare is no longer available.",
  "correlationId": "req-fare-unavailable-001",
  "provider": "acme-air", "details": null,
  "metadata": { "operation": "quote" } }
```

**Preço mudou (409)**
```json
{ "success": false,
  "error": { "code": "FARE_PRICE_CHANGED", "category": "conflict" },
  "message": "The fare price changed since it was quoted.",
  "correlationId": "req-fare-changed-001",
  "provider": "acme-air", "details": null,
  "metadata": { "operation": "issue" } }
```

**Recurso não encontrado (404)**
```json
{ "success": false,
  "error": { "code": "RESOURCE_NOT_FOUND", "category": "not_found" },
  "message": "The requested resource was not found.",
  "correlationId": "req-notfound-001",
  "provider": "acme-air",
  "providerError": { "provider": "acme-air", "operation": "retrieve", "providerCode": null,
                     "providerMessage": "Registro não encontrado",
                     "providerSeverity": null, "httpStatus": null },
  "metadata": { "operation": "retrieve", "duration": 1080 } }
```

**Credenciais recusadas (401)**
```json
{ "success": false,
  "error": { "code": "PROVIDER_AUTHENTICATION_FAILED", "category": "provider_authentication" },
  "message": "The provider rejected the configured credentials.",
  "correlationId": "req-ping-auth-001",
  "provider": "acme-air",
  "providerError": { "provider": "acme-air", "operation": "authenticate", "providerCode": null,
                     "providerMessage": "Authentication request rejected the configured credentials",
                     "providerSeverity": null, "httpStatus": 401 },
  "details": null,
  "metadata": { "operation": "ping", "duration": 734 } }
```

**Falha de integração (502)**
```json
{ "success": false,
  "error": { "code": "PROVIDER_INTEGRATION_ERROR", "category": "integration" },
  "message": "The request to the provider could not be completed.",
  "correlationId": "req-provider-001",
  "provider": "acme-air",
  "details": { "providerCode": "HOST_UNAVAILABLE" },
  "metadata": { "operation": "retrieve", "duration": 912 } }
```

**Operação inexistente na companhia (501)**
```json
{ "success": false,
  "error": { "code": "CAPABILITY_NOT_SUPPORTED", "category": "not_supported" },
  "message": "This provider does not support the requested operation.",
  "correlationId": "req-capability-001",
  "provider": "acme-air", "details": null,
  "metadata": { "operation": "remove-seats" } }
```

**Regra de negócio da companhia (422)**
```json
{ "success": false,
  "error": { "code": "BUSINESS_RULE_VIOLATION", "category": "business_rule" },
  "message": "The operation violates a provider or business rule.",
  "correlationId": "req-business-001",
  "provider": "acme-air",
  "providerError": { "provider": "acme-air", "operation": "assignSeats", "providerCode": null,
                     "providerMessage": "Passenger already has a seat on this segment",
                     "providerSeverity": null, "httpStatus": 200 },
  "details": null,
  "metadata": { "operation": "assignSeats" } }
```

**Excesso de requisições (429)**
```json
{ "success": false,
  "error": { "code": "RATE_LIMITED", "category": "rate_limit" },
  "message": "Too many requests. Please retry later.",
  "correlationId": "req-rate-001",
  "provider": "acme-air", "details": null,
  "metadata": { "operation": "ping" } }
```

---

## 9. Consulta rápida: status por cenário

| Cenário | HTTP |
|---|---|
| Corpo inválido, chave opaca corrompida | 400 |
| A companhia recusou as credenciais | 401 |
| Localizador, bilhete ou rota que não existe | 404 |
| Estado conflitante, tarifa sumiu, preço mudou, já cancelado, reserva órfã | 409 |
| Regra de negócio da companhia | 422 |
| Excesso de requisições | 429 |
| Bug seu, não classificado, rota que não chamou o provedor | 500 |
| A companhia não faz a operação | 501 |
| A companhia respondeu quebrado (inclusive erro dentro de um 200) | 502 |
| Você escolheu não chamar; endereço não configurado | 503 |
| A companhia não respondeu no tempo | 504 |
