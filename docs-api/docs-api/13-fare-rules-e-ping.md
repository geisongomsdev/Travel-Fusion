# 13 — Regras tarifárias e teste de credencial

Duas rotas de apoio, independentes do funil de venda.

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/fare-rules` | Devolve o **texto completo** das condições da tarifa |
| `POST` | `/ping` | Responde: **esta credencial autentica nesta companhia AGORA?** |

> Termo novo? Está no [`00-glossario.md`](00-glossario.md).

---

# Parte A — `POST /fare-rules`

## A1. Quando é chamada

Depois do `/availability`, quando quem consome quer ler as condições da tarifa: multa, remarcação,
reembolso, bagagem. Read-only — não tarifa, não reserva, não altera nada.

## A2. Request

```json
{
  "provider": "acme-air",
  "fareRules": { "key": "eyJjYXJyaWVyIjoiRzMiLCJvcmlnaW4iOiJHUlUifQ" }
}
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `provider` | `string` | **sim** | |
| `fareRules.key` | `string` | **sim** | 🔴 **A chave opaca vinda de `fare.rules.key` do `/availability`.** §A3 |

`fareRules` é **fechado**: nenhum outro campo dentro dele.

## A3. A `key`

| | |
|---|---|
| **De onde vem** | `fares[].rules.key` do `/availability` |
| **É opaca** | Quem consome devolve exatamente como recebeu. Nunca monta, nunca interpreta |
| **`key: null` na busca** | A companhia **não expõe** o texto. Quem consome esconde o botão e nem chama esta rota |

**Do seu lado:** codifique nela tudo que você precisa para reconstruir a consulta — companhia, rota,
data, base tarifária, identificador de tarifa, o que a sua companhia pedir. Um base64 de um objeto
JSON resolve.

🔴 **Chave que não abre é erro de QUEM CHAMOU: 400, e a chamada nem vai à companhia.** Uma chave
corrompida não é falha de integração.

**Se a chave ficar grande** — algumas companhias exigem um identificador de itinerário de vários KB
que se repete em cada tarifa da busca, e isso chegou a levar uma resposta de busca a 3 MB, metade
disso em chaves — guarde o payload do seu lado e devolva uma referência curta. Nesse caso a
referência **expira**, e a expirada responde **404 `RESOURCE_NOT_FOUND`**: "a busca é velha, busque
de novo".

## A4. Response

```json
{
  "success": true,
  "data": {
    "provider": "acme-air",
    "sections": [
      {
        "company": "G3",
        "fareBasis": "ONIMAG2J",
        "origin": "VCP",
        "destination": "REC",
        "text": "50.RULE APPLICATION AND OTHER CONDITIONS\n   LIGHT FARE\n01.ELIGIBILITY\n   NO ELIGIBILITY REQUIREMENTS APPLY.\n16.PENALTIES\n   ..."
      }
    ]
  },
  "meta": { "provider": "acme-air", "duration": 2140, "timestamp": "2026-08-27T18:00:00.000Z" }
}
```

| Campo | Tipo | Descrição |
|---|---|---|
| `provider` | `string` | Eco |
| `sections[]` | `array`, **mínimo 1** | As seções de regra. §A5 |
| `sections[].company` | `string` \| `null` | Código IATA da companhia |
| `sections[].fareBasis` | `string` \| `null` | Base tarifária. `"ONIMAG2J"` |
| `sections[].origin` | `string` \| `null` | IATA |
| `sections[].destination` | `string` \| `null` | IATA |
| `sections[].text` | `string` | **O texto da companhia, com `\n` preservado.** Nunca `null`, nunca vazio |

**As 5 chaves existem sempre**, na mesma ordem. Ausência é `null`, **nunca `""`**.

## A5. Uma seção ou várias?

**Uma por trecho ou por componente tarifário, conforme a companhia responder.**

| A companhia devolve… | Então |
|---|---|
| um texto por trecho | uma seção por trecho, com `origin`/`destination` de cada |
| um texto por componente tarifário | uma seção por componente |
| um bloco único | **uma seção só**, e `company`/`fareBasis`/`origin`/`destination` podem ser `null` |

Quando a companhia devolve uma **lista de linhas** para o mesmo trecho, junte-as com `\n`, **na
ordem**.

## A6. 🔴 HTML da companhia vira TEXTO puro

`text` é sempre **texto**, nunca marcação. Algumas companhias devolvem HTML; converta.

A conversão, na ordem:

| Entrada | Saída |
|---|---|
| `<br>`, `<br/>` | `\n` |
| `</p>`, `</div>`, `</li>`, `</tr>`, `</h1>`…`</h6>` | `\n` |
| `<li ...>` | `- ` |
| qualquer outra tag | removida |
| `&nbsp; &amp; &lt; &gt; &quot; &apos; &#39; &#x27;` | decodificadas |
| entidade nomeada desconhecida | **fica como veio** |
| espaço ou tabulação **no fim** da linha | cortado |
| 3 ou mais `\n` seguidos | vira 2 |

**Três armadilhas com consequência real**, todas cobertas por teste no contrato original:

1. **A regex de tag tem que exigir uma LETRA depois do `<`.** Sem isso, o texto `CHANGE <= 3 DAYS`
   — que aparece de verdade em regras tarifárias — é comido como se fosse uma tag.
2. **A indentação da ESQUERDA é preservada.** Em regras tarifárias ela é **semântica**: os níveis de
   recuo indicam a hierarquia das condições. Só o espaço no **fim** da linha cai. Texto sem tag
   nenhuma passa **intacto**.
3. **Codepoint numérico fora da faixa Unicode não pode derrubar a rota.** Uma entidade como
   `&#x110000;` ou um surrogate solto faz a função de conversão lançar em várias linguagens. Deixe
   literal. E resolva entidades nomeadas com uma verificação de propriedade **própria** do objeto —
   senão `&constructor;` injeta o código-fonte de uma função no meio da regra tarifária.

Texto de companhia é **entrada não confiável**. Trate como tal.

## A7. Casos de borda

| Cenário | HTTP | `error.code` |
|---|---|---|
| Corpo inválido; `key` ausente | **400** | `SEARCH_VALIDATION_ERROR` |
| **`key` corrompida** (não abre, não é objeto, falta campo interno) | **400** | `SEARCH_VALIDATION_ERROR` — **nunca chega à companhia** |
| Referência **expirada** (quando você usa chave curta) | **404** | `RESOURCE_NOT_FOUND` |
| A companhia responde 404 para aquela tarifa | **404** | `RESOURCE_NOT_FOUND` |
| A companhia não expõe o texto | **501** | `CAPABILITY_NOT_SUPPORTED` |
| 🔴 **HTTP 200 da companhia SEM nenhum texto** | **502** | `PROVIDER_INTEGRATION_ERROR` |
| A companhia respondeu quebrado | **502** | `PROVIDER_INTEGRATION_ERROR` |
| Timeout | **504** | `PROVIDER_TIMEOUT` |

🔴 **Sucesso sem texto não é regra tarifária — é a companhia respondendo vazio.** `sections: []` é
**502**, não um 200 oco. Um 200 com lista vazia faz quem consome exibir uma tela em branco como se
fosse a resposta.

🔴 **Item cru que não é objeto** (um `null`, uma string, um número no meio da lista) tem que ser
**descartado antes de você acessar qualquer campo dele** — senão o erro de tipo substitui o erro
tipado e a rota morre com um 500 sem explicação.

## A8. Exemplos

**Request**
```json
{
  "provider": "acme-air",
  "fareRules": { "key": "eyJjYXJyaWVyIjoiRzMiLCJvcmlnaW4iOiJWQ1AiLCJkZXN0aW5hdGlvbiI6IlJFQyIsImRhdGUiOiIyMDI2LTA5LTE2IiwiZmFyZUJhc2lzIjoiT05ITUFHMkoifQ" }
}
```

**Response — bloco único**
```json
{
  "success": true,
  "data": {
    "provider": "acme-air",
    "sections": [
      { "company": "G3", "fareBasis": "ONIMAG2J", "origin": "VCP", "destination": "REC",
        "text": "V FARE BASIS     BK    FARE   TRAVEL-TICKET AP  MINMAX  RTG\n  1   ONIMAG2J       O X   684.90 D25JN  T25JN 21   /365  300\nPASSENGER TYPE-ADT                 AUTO PRICE-YES\nFROM-VCP TO-REC    CXR-G3    TVL-23SEP26  RULE-LIGH\n\n50.RULE APPLICATION AND OTHER CONDITIONS\n   LIGHT FARE\n\n01.ELIGIBILITY\n   NO ELIGIBILITY REQUIREMENTS APPLY.\n\n16.PENALTIES\n   CHANGES\n     ANY TIME\n       CHARGE BRL 180.00 FOR REISSUE/REVALIDATION.\n   CANCELLATIONS\n     ANY TIME\n       TICKET IS NON-REFUNDABLE." }
    ]
  },
  "meta": { "provider": "acme-air", "duration": 2140, "timestamp": "2026-08-27T18:00:00.000Z" }
}
```

**Response — uma seção por trecho (ida e volta)**
```json
{
  "success": true,
  "data": {
    "provider": "acme-air",
    "sections": [
      { "company": "G3", "fareBasis": "ONIMAG2J", "origin": "GRU", "destination": "REC",
        "text": "16.PENALTIES\n   CHANGES\n     ANY TIME\n       CHARGE BRL 180.00 ..." },
      { "company": "G3", "fareBasis": "ONIMAG2J", "origin": "REC", "destination": "GRU",
        "text": "16.PENALTIES\n   CHANGES\n     ANY TIME\n       CHARGE BRL 180.00 ..." }
    ]
  },
  "meta": { "provider": "acme-air", "duration": 3410, "timestamp": "2026-08-27T18:02:00.000Z" }
}
```

**HTML da companhia, antes e depois**
```
cru:    <div style="font-size:12pt"><p><strong>Regras válidas apenas para voos operados
        pela Acme Air.</strong></p><p>Consulte a central para voos de parceiros.</p></div>

texto:  Regras válidas apenas para voos operados pela Acme Air.
        Consulte a central para voos de parceiros.
```

**Sem texto — 502**
```json
{
  "success": false,
  "error": { "code": "PROVIDER_INTEGRATION_ERROR", "category": "integration" },
  "message": "The request to the provider could not be completed.",
  "correlationId": "req-rules-empty-001",
  "provider": "acme-air",
  "details": null,
  "metadata": { "operation": "fareRules", "duration": 1880 }
}
```

---

# Parte B — `POST /ping`

## B1. A pergunta que ela responde

**"Esta credencial autentica de verdade nesta companhia, AGORA?"** Uma pergunta só.

Serve à tela de cadastro de integrações: alguém digita as credenciais e precisa saber, antes de
salvar, se elas funcionam.

🔴 **Não use token guardado em cache.** Cada sonda recebe a credencial explicitamente e faz uma
autenticação nova. Confirmar um token que já estava guardado responde a pergunta errada — ele pode
ter sido emitido antes da credencial mudar.

## B2. Request

```json
{
  "options": { "provider": "acme-air" },
  "ping": {
    "environment": "sandbox",
    "credentials": {
      "username": "agencia",
      "password": "senha-da-agencia",
      "organization": "99570446"
    }
  }
}
```

| Campo | Tipo | Obrigatório | Descrição | Valores |
|---|---|---|---|---|
| `options.provider` | `string` | **sim** | | |
| `ping.environment` | `string` | **sim** | **Escolhe o ambiente** da companhia. Sem ele, o teste bateria num ambiente arbitrário | `sandbox` \| `production` |
| `ping.credentials` | `object` | **sim**, ≥1 chave | **As credenciais a testar.** Shape livre — cada companhia pede um conjunto diferente. Quem valida completude é a própria sonda | |

`options` e a raiz são **fechados**: chave desconhecida → **400**.

## B3. Response

```json
{
  "success": true,
  "data": {
    "valid": true,
    "provider": "acme-air",
    "environment": "sandbox",
    "verification": { "method": "auth", "scope": "credential" }
  },
  "meta": { "provider": "acme-air", "duration": 812, "timestamp": "2026-08-20T12:00:00.000Z" }
}
```

| Campo | Tipo | Descrição | Valores |
|---|---|---|---|
| `valid` | `true` | Constante. §B5 | |
| `provider` | `string` | | |
| `environment` | `string` | | `sandbox` \| `production` |
| `verification.method` | `string` | **COMO** foi provado | `auth` \| `catalog` |
| `verification.scope` | `string` | 🔴 **O QUE foi provado.** §B4 | `credential` \| `connection` |

**`verification.method`:**

| Valor | Quando usar |
|---|---|
| `auth` | A companhia tem endpoint de login. Você chamou o login |
| `catalog` | A autenticação viaja em toda chamada. Você usou a **chamada autenticada mais barata** do contrato dela — **nunca uma busca** |

Se a sonda de login abre uma **sessão**, feche-a. Sessões penduradas acabam recusando conexões novas.

## B4. 🔴 `verification.scope` — a honestidade do teste

| Valor | Significa |
|---|---|
| `credential` | A companhia **validou os campos do cadastro** que você mandou |
| `connection` | A companhia respondeu e a integração autenticou, **mas ela não confere os campos do cadastro** |

O caso `connection` é real e não é raro: uma companhia pode autenticar pelo par de credenciais **da
integração** e simplesmente **ignorar** o identificador de agência que veio no cadastro. Medido: a
mesma chamada, com o identificador real, com lixo e com o campo vazio, devolveu resposta **idêntica
byte a byte** nas três.

**Com `scope: "connection"`, um 200 NÃO garante que a conta cadastrada existe.** Quem consome
precisa saber disso — por isso o campo existe.

Default `credential`; declare `connection` só onde você **verificou** que a companhia não confere.

## B5. 🔴 Não existe 200 com `valid: false`

Credencial recusada é **erro**, com código próprio:

**401 `PROVIDER_AUTHENTICATION_FAILED`**

E a distinção que segue é o coração desta rota:

| Resultado | Resposta | O que quem consome deve fazer |
|---|---|---|
| A companhia **recusou** | **401** `PROVIDER_AUTHENTICATION_FAILED` | **Revisar o cadastro.** Não retentar |
| **Não deu para verificar** (timeout, rede, companhia fora) | **502/503/504** | **Retentar.** Não mexer no cadastro |

### O problema: quase nenhuma companhia recusa com um 401 limpo

Foi medido em cinco companhias. Nenhuma delas devolve um 401 óbvio:

- HTTP **500** com um erro de autenticação no envelope;
- HTTP **500** com `"401 UNAUTHORIZED"` ou `"usuário ou senha inválidos"` **no corpo**;
- HTTP **200** com uma exceção em texto livre;
- HTTP **400** com um código de cliente inválido.

Pelo status puro, credencial errada chega como 502 "tente de novo" — **a orientação oposta à certa**.

### As regras de classificação

1. **Só 401 e 403 são recusa por status.** 400 é payload; 5xx é problema deles.
2. **Fora disso, case a FRASE, nunca a palavra solta.** Procurar `"inválido"` ou `"login"` soltos faz
   um erro de negócio como *"Origem inválida"* virar "a companhia recusou sua credencial" — mandando
   alguém corrigir um cadastro correto.
3. 🔴 **Na dúvida, erre para "não deu para verificar" (502).** Mandar revisar um cadastro que está
   certo é o pior desfecho: a pessoa muda o que estava funcionando.

**Dois sinais adicionais** que valem procurar:

- Um indicador de "sessão expirada" numa credencial **recém-enviada** é contradição → é recusa.
- Um catálogo que volta **vazio** não é recusa (a autenticação passou), mas também não é operação
  normal → **502**.

## B6. Limites

**Teto de tentativas: 10 por minuto, por conta + companhia.** Estourou → **429 `RATE_LIMITED`**, e
**nada é enviado à companhia**.

Por que não só o limite global por IP: cada tentativa é um **login real**. Falhas de autenticação
acumuladas **bloqueiam a conta na companhia** — e quem paga é o dono do cadastro, não quem digitou
errado. Além disso, a mesma pessoa abre várias abas e sai por IPs diferentes, que somam contra a
**mesma** conta lá.

**Ordem obrigatória dos guards:**

```
validar corpo  →  capability (501)  →  teto (429)  →  sonda
```

O 501 antes do teto: uma operação que não existe não deve gastar tentativa.

**Timeout curto e explícito (~15 s), sem retry próprio.** Há uma pessoa parada num formulário;
repetir uma recusa só a faz esperar mais pela mesma resposta.

## B7. 🔴 Segurança

**Neste modo, a credencial é entrada de quem chamou.** Duas consequências:

1. **Se a sua companhia deriva o endereço a partir da credencial** (algumas o fazem), **valide o
   destino contra uma lista permitida**. Sem isso, a rota vira uma sonda de rede interna: quem
   chama escolhe para onde a sua API abre conexão.
2. **Segredo nunca no log nem no corpo da resposta.** Registre provedor, ambiente e modo — nada do
   conteúdo. O detalhe cru fica só no log do servidor, ligado pelo `correlationId`.

## B8. Casos de borda

| Cenário | HTTP | `error.code` |
|---|---|---|
| Corpo inválido; `environment` ausente; `credentials` vazio | **400** | `SEARCH_VALIDATION_ERROR` |
| **Endereço derivado da credencial fora da lista permitida** | **400** | `SEARCH_VALIDATION_ERROR` |
| **A companhia recusou as credenciais** | **401** | `PROVIDER_AUTHENTICATION_FAILED` |
| Recusou **e** o ambiente é o suspeito (existe endereço para o outro) | **401** | `PROVIDER_AUTHENTICATION_FAILED` — mencione o ambiente em `providerError.providerMessage`. Ver a nota abaixo |
| Excesso de tentativas | **429** | `RATE_LIMITED` |
| A companhia não tem como ser sondada | **501** | `CAPABILITY_NOT_SUPPORTED` |
| Não deu para verificar | **502** / **503** / **504** | `PROVIDER_INTEGRATION_ERROR` / `PROVIDER_UNAVAILABLE` / `PROVIDER_TIMEOUT` |

> **Sobre o ambiente trocado.** Um erro comum de cadastro é digitar a credencial de teste e marcar
> "produção" (ou o contrário). Quando a companhia recusa **e** você tem endereço configurado para o
> outro ambiente, isso é um forte indício.
>
> Ainda assim, o código é **`PROVIDER_AUTHENTICATION_FAILED`** — o ambiente é uma **suspeita sua**,
> não algo que a companhia afirmou. Uma credencial revogada com o ambiente **correto** cai no mesmo
> caso. Coloque a suspeita na mensagem; não invente um código para ela.

## B9. Exemplos

**Request**
```json
{
  "options": { "provider": "acme-air" },
  "ping": {
    "environment": "sandbox",
    "credentials": { "username": "agencia", "password": "senha-da-agencia",
                     "domain": "DOMAIN", "organization": "99570446" }
  }
}
```

**Sucesso — credencial validada**
```json
{
  "success": true,
  "data": { "valid": true, "provider": "acme-air", "environment": "sandbox",
            "verification": { "method": "auth", "scope": "credential" } },
  "meta": { "provider": "acme-air", "duration": 812, "timestamp": "2026-08-20T12:00:00.000Z" }
}
```

**Sucesso — só a conexão foi provada**
```json
{
  "success": true,
  "data": { "valid": true, "provider": "acme-air", "environment": "sandbox",
            "verification": { "method": "catalog", "scope": "connection" } },
  "meta": { "provider": "acme-air", "duration": 1204, "timestamp": "2026-08-20T12:01:00.000Z" }
}
```

**Recusada — 401**
```json
{
  "success": false,
  "error": { "code": "PROVIDER_AUTHENTICATION_FAILED", "category": "provider_authentication" },
  "message": "The provider rejected the configured credentials.",
  "correlationId": "req-ping-auth-001",
  "provider": "acme-air",
  "providerError": {
    "provider": "acme-air", "operation": "authenticate", "providerCode": null,
    "providerMessage": "Authentication request rejected the configured credentials",
    "providerSeverity": null, "httpStatus": 401
  },
  "details": null,
  "metadata": { "operation": "ping", "duration": 734 }
}
```

**Excesso de tentativas — 429**
```json
{
  "success": false,
  "error": { "code": "RATE_LIMITED", "category": "rate_limit" },
  "message": "Too many requests. Please retry later.",
  "correlationId": "req-ping-rate-001",
  "provider": "acme-air", "details": null,
  "metadata": { "operation": "ping" }
}
```

**Sem sonda implementada — 501**
```json
{
  "success": false,
  "error": { "code": "CAPABILITY_NOT_SUPPORTED", "category": "not_supported" },
  "message": "This provider does not support the requested operation.",
  "correlationId": "req-ping-cap-001",
  "provider": "acme-air", "details": null,
  "metadata": { "operation": "ping" }
}
```

---

## Checklist

**`/fare-rules`**
- [ ] A `key` é opaca, aceita de volta como saiu; corrompida → 400 antes de chamar.
- [ ] `sections[]` nunca vazio — vazio é 502.
- [ ] As 5 chaves da seção existem sempre; ausência é `null`, nunca `""`.
- [ ] HTML vira texto; a regex de tag exige letra depois do `<`.
- [ ] Indentação da esquerda preservada; só o espaço no fim cai.
- [ ] Entidade inválida não derruba a rota.
- [ ] Item cru que não é objeto é descartado antes de qualquer acesso.

**`/ping`**
- [ ] Autentica de novo; não confirma token guardado.
- [ ] `verification.scope` diz honestamente o que foi provado.
- [ ] Nunca 200 com `valid: false`.
- [ ] Recusa (401) × não-deu-para-verificar (502+) bem separadas; na dúvida, 502.
- [ ] Casamento de mensagem por **frase**, não por palavra.
- [ ] Teto por conta + companhia; 501 antes do teto.
- [ ] Destino derivado de credencial validado contra lista permitida.
- [ ] Segredo nunca no log nem no corpo.
