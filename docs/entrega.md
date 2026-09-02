# O que foi construído, e o que falta

Resumo da entrega: o que existe hoje, o que foi além do mínimo, e as pendências reais —
separadas por quem depende de quê.

---

## 1. O que foi construído

Uma API própria que traduz a **Travelfusion Direct Connect XML API** (XML puro, fluxo de polling)
para o contrato canônico de voo (17 rotas REST/JSON, `/availability` em stream), mais um front para
exercitar o fluxo inteiro.

### API — `api/`

Fastify + xml2js, ESM. A estrutura espelha
`queue-booking.pass-connect/flight/src/integrations/<provider>/provider/` de propósito: a migração
para o repo do serviço de voo depois é **mover pasta**, não reescrever.

| Rota | Comando Travelfusion | Nota |
|---|---|---|
| `POST /availability` | `StartRouting` + N× `CheckRouting` | Polling ≥ 2s exposto como `text/event-stream` |
| `POST /quote` | `ProcessDetails` | Traz o `RequiredParameterList` já parseado |
| `POST /booking` | `ProcessTerms` → `StartBooking` → N× `CheckBooking` | HTTP 201 |
| `POST /retrieve` | `CheckBooking` | Envelope próprio, `status` sempre `"found"` |
| `POST /fare-rules` | `ProcessDetails` (bloco de termos) | Chave opaca vinda da busca |
| `POST /ping` | `Login` | `LoginId` cacheado |

As outras **11 rotas respondem 501 `CAPABILITY_NOT_SUPPORTED`**, cada uma com o motivo escrito na
descrição do Swagger. Isso é resposta correta do contrato, não lacuna: *"501 = existe, mas não faz"*.

### Front — `web/`

Vite + React + Tailwind + shadcn (componentes vendorizados no repo, que é como o shadcn funciona).
Fluxo em quatro passos: **buscar → escolher → tarifar → reservar**.

### Mock do provedor — `api/tests/mock-travelfusion.js`

As credenciais reais só respondem de IP whitelistado, e hoje a busca volta
`4-3448 Login ID not found`. Sem o mock, nada além do desenho seria verificável.

---

## 2. O que foi além do mínimo

Coisas que o desafio não pedia, mas que mudam o resultado:

**Um mock que reproduz o que quebra, não o caminho feliz.** Ele devolve as rotas **uma vez só** (o
`CheckRouting` real é incremental) e só marca `Complete` depois de algumas passadas. São exatamente
os dois pontos onde uma integração ingênua perde voo: tratar cada resposta como "o total", ou parar
no primeiro polling. O mesmo vale para o `BookingInProgress` antes do `Succeeded`.

**Swagger com as armadilhas escritas.** As descrições dizem *por que* cada regra existe — que
`committed` nunca deduz `confirmed`, que chave corrompida é 400 e não vai ao provedor, que o
`/retrieve` não usa o envelope padrão. Documentação que só lista campo não impede o erro.

**Sanitização do erro do provedor.** `providerError` de 6 chaves, com redação de padrões de segredo
**antes** do truncamento e o payload cru indo só para o log via `correlationId`.

**Identificadores opacos que carregam contexto.** O `identifier` e a `rules.key` são base64url de um
objeto com `RoutingId` + ids de perna — o suficiente para retomar a oferta sem estado do nosso lado.

**Guard de capability como `preHandler`.** Roda antes da validação de corpo, senão um `/issue` vazio
responderia "payload inválido" e mandaria quem chamou procurar no lugar errado.

**Testes das funções que erram silencioso.** `roundMoney` (onde `Math.round(v*100)/100` erra), o
parser de bagagem, a idade na data do voo, o round-trip da chave opaca, e a cabine desconhecida
virando `null` em vez de chute.

---

## 3. Pendências

### 3.1 Bloqueio externo — não é código

| # | O quê |
|---|---|
| 1 | **IP whitelist.** Sem isso só o `Login` responde. Enviar a lista de IPs para `operations@travelfusion.com` respondendo a thread do Welcome Pack, junto com os XML logs que eles pediram |
| 2 | Going-Live Checklist online, no Reports portal |
| 3 | Checklist do IBE (`PASS BR IBE`) ainda não devolvido |
| 4 | Test site onde a Travelfusion faz fake bookings para auditar o fluxo |
| 5 | Conta no YouTrack — **1 usuário só** é permitido, precisa decidir quem |
| 6 | Rotação da senha da API: expira a cada 90 dias. Combinar antes de virar incidente |

Prazo estimado por eles depois que tudo isso entra: **2 a 3 semanas** de auditoria.

### 3.2 Bloqueia o go-live — é código

| # | O quê | Onde |
|---|---|---|
| 1 | **`ListSupplierRoutes` ligado à busca.** Está implementado mas não plugado. Buscar rota que o fornecedor não atende é reprova direta | `provider/commands.js` → `SearchAvailability.js` |
| 2 | **3D Secure / Credit Card Verification.** Ainda não desenhado | — |
| 3 | **Preço por perna × por grupo.** Hoje leio um total só; a spec exige interpretar os dois casos | `routing.normalizer.js` |

### 3.3 Lacunas do contrato que eu conheço

Estas são minhas, não do provedor:

| # | O quê | Gravidade |
|---|---|---|
| 1 | **`roundtrip` emite `groups` com `return: []`** — meia viagem, que o contrato manda suprimir. Falta tratar o `ReturnId` do `StartRouting`. **Só `oneway` está realmente correto hoje** | alta |
| 2 | `multicity` monta `legs: [[leg]]` — um balde por trecho, sem as opções de horário pelo mesmo preço | alta |
| 3 | `options.refundable` e `options.class` chegam no pedido e **não são aplicados** | média |
| 4 | Um `provider_success` só, ao final. Com mais de um fornecedor na branch, deveria sair um por fornecedor conforme completa | média |
| 5 | `fares[].fees` sempre `[]`, `baggage` e `benefits` todos `null` — aceito pelo contrato, mas dá para preencher a partir dos CSPs | baixa |
| 6 | `/retrieve` devolve `trip`, `segments` e `itinerary` como `null`: o `CheckBooking` não traz os trechos | baixa — é limite do provedor |
| 7 | Cache do `LoginId` é variável de módulo. Com várias instâncias, cada uma faz o seu Login | baixa |

### 3.4 Decisões em aberto

**`/booking` × `/issue`.** O contrato separa reservar (segura assento, não cobra) de emitir (o
dinheiro sai). A Travelfusion não separa: o `StartBooking` já é a compra. Hoje `/booking` faz o fluxo
inteiro e `/issue` é 501.

Se a plataforma precisar do gate de aprovação entre os dois, a alternativa é `/booking` guardar
estado local e `/issue` disparar o provedor — mas aí `/booking` passa a devolver `locator: null`, e
isso **precisa ser combinado com quem consome**.

**Bagagem chega antes do que o contrato espera.** O contrato pendura o extra depois da reserva; a
Travelfusion exige no `ProcessTerms`, que é único. Hoje os extras aparecem no `/quote` e vão no corpo
do `/booking`. Funciona, mas é divergência de ordem que quem consome precisa saber.

---

## 4. Por onde eu continuaria

1. **Fechar o `roundtrip` e o `multicity`** (§3.3, itens 1 e 2). É a rota mais usada e a que
   contamina tarifar, reservar e emitir — o erro só aparece no checkout.
2. **Plugar o `ListSupplierRoutes`** (§3.2, item 1). Bloqueia a certificação.
3. **Resolver o IP whitelist** (§3.1, item 1) — sem isso nada acima é testável de verdade.

Os três são independentes e podem andar em paralelo.
