# Como apresentar o projeto

Roteiro para mostrar a integração LATAM a quem vai avaliar: liderança técnica, produto ou a pessoa
que pediu o desafio. Tem checklist de preparação, um roteiro de 20 minutos com o que dizer em cada
parte, a demo clique a clique, um plano B e as perguntas mais prováveis com respostas tiradas do
código.

Material de apoio:

- [`rotas.md`](rotas.md) — referência de cada rota, para responder pergunta técnica;
- [`fluxo.md`](fluxo.md) — o fluxo sem código, para plateia de negócio;
- [`resumo-rodrigo.md`](resumo-rodrigo.md) — o resumo em cinco parágrafos.

---

## 1. A mensagem em três frases

Se sobrar só um minuto, é isto:

> **1.** Construí uma API que traduz companhias aéreas para o contrato de voo da Pass. Por fora ela
> fala uma língua só; por dentro, fala o NDC da LATAM.
>
> **2.** O fluxo roda de ponta a ponta contra o **sandbox real** da LATAM: busca, preço, reserva,
> parcelamento, pagamento, bilhete e cancelamento. Só a compra de assento e bagagem para na
> autorização da cobrança, que o sandbox não concede.
>
> **3.** O valor cobrado vem sempre da companhia, nada que mexe em dinheiro é tentado duas vezes, e
> tudo que a documentação da LATAM não contava virou nota e teste.

---

## 2. Preparação (faça no dia anterior)

### Ambiente

- [ ] `api/.env` com `LATAM_API_KEY`, `LATAM_API_SECRET`, `LATAM_AGENCY_IATA`,
      `LATAM_TRAVEL_AGENT_ID` e `LATAM_COUNTRY=BR` preenchidos.
- [ ] **`PROVIDERS=latam`** no `.env`. Com a Travelfusion ligada, a busca também chama a Travelfusion,
      que falha por IP não liberado. O stream segue, mas aparece um `provider_error` no meio da demo
      que você vai ter que explicar.
- [ ] `cd api && npm install && npm test` → **67 testes verdes**. Guarde o print.
- [ ] `cd api && npm run dev` → API na porta 3010, Swagger em `http://localhost:3010/docs`.
- [ ] `cd web && npm install && npm run dev` → tela na porta 5173.
- [ ] `/ping` com `{"options":{"provider":"latam"},"ping":{"environment":"sandbox","credentials":{"k":"v"}}}`
      responde `valid: true`.

### Ensaio completo, uma vez

Rode o fluxo inteiro **na véspera**, com a mesma rota e datas da apresentação:

- [ ] busca GRU → SCL, ida e volta, 1 adulto, datas **30 a 60 dias à frente**;
- [ ] anote quanto tempo a busca levou (campo `duration` do evento `complete`, na aba Network).
      Não dá para citar um número que você não mediu;
- [ ] reserve, pague com o cartão de teste (`4000000000002701`, CVV `737`, validade `03/30`) e anote o
      localizador;
- [ ] abra o bilhete, abra a loja de assento e bagagem e cancele.

### Material de reserva

- [ ] **Prints de cada tela** do ensaio (busca, resultados, revisão, passageiro, pagamento
      confirmado, bilhete, cancelamento). O sandbox da LATAM pode estar lento ou fora do ar na hora.
- [ ] Uma aba com o Swagger aberta.
- [ ] Um terminal com `npm test` pronto para rodar.
- [ ] Este documento e o `rotas.md` abertos, para consulta.

### Dados para digitar sem pensar

| Campo | Valor |
|---|---|
| Passageiro | Andy Peterson · nascimento 1990-04-21 · documento AB123456 |
| Contato | um e-mail seu · telefone com DDD |
| Titular do cartão | ANDY PETERSON · CPF `52998224725` (formato válido, de teste) |
| Cartão | VI · `4000000000002701` · `737` · `03/30` |
| Cobrança | BR · `01310-100` · Av. Paulista, 1000 |

---

## 3. Roteiro de 20 minutos

| Tempo | Parte | Objetivo |
|---|---|---|
| 0:00 – 2:00 | O problema | por que existe um tradutor |
| 2:00 – 5:00 | O desenho | a fronteira `FlightProvider` e o contrato |
| 5:00 – 13:00 | Demo ao vivo | o fluxo inteiro, na tela |
| 13:00 – 16:00 | O que a doc não conta | mostrar o trabalho que não aparece na tela |
| 16:00 – 18:00 | Estado honesto | o que funciona, o que não, e por quê |
| 18:00 – 20:00 | Próximos passos | o que falta para produção |
| depois | Perguntas | seção 6 |

### 0:00 — O problema (2 min)

**Diga:**

> "Cada companhia vende passagem de um jeito. A Pass tem um contrato próprio de 17 rotas, e o
> desafio era fazer um provedor falar esse contrato **sem inventar formato**. Começou com a
> Travelfusion, que ficou bloqueada por liberação de IP do lado deles. A LATAM não tem essa
> exigência: dá para criar a credencial sozinho no portal. Então fiz a integração com a LATAM do
> zero, direto no sandbox real."

**Mostre:** nada ainda, ou a tabela de sumário do [`rotas.md`](rotas.md#sumário).

### 2:00 — O desenho (3 min)

**Diga:**

> "A regra é uma só: **o formato do provedor não sobe**. Acima de uma interface, `FlightProvider`, só
> existe o vocabulário do contrato. Abaixo dela, só existe XML da LATAM. Um caso de uso como 'pagar'
> não sabe o que é NDC."

**Mostre:** `api/src/modules/providers/provider.types.ts`, a interface `FlightProvider`.

**Três pontos para destacar:**

1. **A oferta é o par ida + volta já fechado** (`{ outbound, inbound }`). A LATAM declara o que combina
   com o quê; a API nunca monta a combinação por conta própria. Juntar ida e volta "que parecem
   combinar" é o erro que reprova uma integração.
2. **A busca é um stream.** A tela recebe eventos à medida que os provedores respondem. Com a LATAM
   vem tudo de uma vez, mas o contrato está pronto para vários provedores em paralelo.
3. **Capability por provedor.** O que a LATAM não faz responde `501` com o motivo, e não `404` nem
   `500`.

### 5:00 — Demo ao vivo (8 min)

Deixe a aba **Network** do navegador aberta: ela mostra que cada passo é uma chamada real.

| # | Na tela | O que fazer | O que dizer |
|---|---|---|---|
| 1 | **Buscar** | GRU → SCL, ida e volta, 1 adulto | "Isto dispara um `AirShopping` na LATAM." Na aba Network, abra o `/availability` e mostre os eventos `start`, `provider_success`, `filters`, `complete` |
| 2 | **Escolher** | clique num voo; mostre as famílias dentro do cartão | "A LATAM manda uma oferta por família tarifária: são mais de 400 tarifas para uns 94 voos. A tela agrupa por voo, senão seriam cinco cartões iguais com preços diferentes." |
| 3 | (opcional) | filtre por executiva | "Se eu peço executiva **para a LATAM**, ela devolve zero. Sem o filtro, devolve 424, 12 de executiva. Então o filtro é nosso, depois da resposta." |
| 4 | **Revisar** | escolha a tarifa | "Aqui a API pergunta de novo: esse preço ainda vale? É o `OfferPrice`." Abra o mapa de assentos: "isto é **vitrine**; guardem essa palavra." |
| 5 | **Passageiro** | preencha e confirme | "A reserva nasce **não paga**, com prazo. Por isso reservar e pagar são passos separados: a companhia os separa." Mostre o localizador e o status `OPENED` |
| 6 | **Pagar** | consulte as parcelas | "Parcelas dependem do cartão, então a pergunta leva o número. Vieram até 8x." |
| 7 | **Pagar** | pague | "🔴 A tela **não manda** quanto cobrar. A API pergunta à LATAM o total da reserva e cobra esse valor. Se alguém mandar um valor diferente, nada é cobrado." Mostre `CLOSED` |
| 8 | **Bilhete** | abra e mostre imprimir | "O bilhete não é montado com o que a tela guardou: a API consulta a reserva de novo na LATAM." |
| 9 | **Assento e bagagem** | abra a loja | "Lembram da vitrine? O mesmo assento tem **outro código** depois da emissão. Só o segundo compra. Descobrir isso destravou a compra." Se tentar comprar: "o sandbox recusa a autorização da cobrança; já explico." |
| 10 | **Cancelar** | cancele | "Cancelar só existe depois de pagar: antes, a LATAM recusa. E é ela quem decide se é anulação ou reembolso." Mostre o valor devolvido |
| 11 | (opcional) | consulte a reserva de novo | "A ordem continua `CLOSED` na LATAM, mas a tela mostra cancelada. Quem diz a verdade é o cupom do bilhete, e é ele que a API lê." |

**Se só der tempo de uma coisa:** passos 5 e 7. Reservar ≠ pagar, e o valor vem da companhia.

### 13:00 — O que a doc da LATAM não conta (3 min)

Escolha **três** exemplos; a lista completa está no README da raiz.

1. **Uma rota com letra maiúscula.** `/ndc/v192/offerPrice` funciona; `offerprice` dá 404. Não está
   no YAML publicado.
2. **A ordem dos campos no XML é obrigatória**, e o erro não diz qual campo está fora do lugar.
3. **O CPF do titular vai na raiz da mensagem** de compra de opcional, com tipo `I` (a doc diz
   `CPF`). Foram cinco posições testadas até achar.
4. **O mesmo código de erro significa duas coisas opostas**: "ainda não pagou" e "já cancelou". A API
   desempata consultando o bilhete.
5. **O void não devolve status**: confirma num texto, "VOID completed successfully".

**Feche com:**

> "Cada descoberta virou comentário no código, nota no README e regra no dublê de testes. O dublê
> repete essas validações da LATAM, então se alguém quebrar a ordem de um campo, o teste falha
> antes de chegar no sandbox."

### 16:00 — Estado honesto (2 min)

| Funciona contra o sandbox real | Não funciona / não existe |
|---|---|
| busca, preço, reserva, consulta | compra de assento/bagagem: o sandbox **recusa a cobrança** |
| vitrine e loja de assento e bagagem | `/fare-rules`: a LATAM não dá o texto da tarifa (501) |
| parcelamento (até 8x) | e-ticket e formas de pagamento: existem na NDC, não integrados (501) |
| pagamento (`OPENED → CLOSED`) | Travelfusion: bloqueada por IP; código existe, desligado |
| bilhete e cancelamento (void) | — |

**Sobre a compra de opcional, seja preciso:**

> "Não é 'não funciona'. Com um valor errado de propósito, a LATAM responde 'valor não bate', ou seja,
> leu e conferiu o pedido. Com o valor certo, ela chega à autorização da cobrança e recusa. Pagando
> por outro meio, que nem passa por cartão, recusa igual. O pedido está correto; o ambiente de
> testes não autoriza esse tipo de cobrança."

### 18:00 — Próximos passos (2 min)

Ver a [seção 7](#7-o-que-falta-para-produção). Cite os três primeiros.

---

## 4. Plano B

| Se… | Faça |
|---|---|
| o sandbox da LATAM está lento | enquanto espera, explique o stream (seção 3, parte 2). O teto da busca é 60 s |
| o sandbox está fora do ar | passe pelos prints do ensaio, na mesma ordem da demo |
| a busca volta `401` | credencial ou `.env`. Mostre que a API **explica** o que falta em `providerError.providerMessage`, sem sair para a rede |
| a busca volta `403122004`, `403122009`, `403122010` ou `403122003` | identidade da agência no `.env` (tabela no README). Troque para os prints |
| a tarifa esgota entre busca e revisão | **aproveite**: "é exatamente para isso que o `/quote` existe" |
| nada funciona | rode `npm test` ao vivo: são 67 testes, 15 deles exercitando o provedor inteiro contra o dublê do NDC |

---

## 5. Pontos fortes para defender

Se perguntarem "o que tem de diferente aqui?":

1. **Dinheiro nunca é decidido fora da companhia.** O `/issue` pergunta o total antes de cobrar; o
   `/sell-ancillaries` soma os preços a partir do catálogo da própria reserva.
2. **Nada que escreve é repetido.** Reservar, pagar, comprar e cancelar rodam com retry zero. Se a
   resposta se perde, o caminho é consultar, não tentar de novo.
3. **Não afirma o que não sabe.** `confirmed` só em status final; `refundable: null` não é "sim";
   cabine desconhecida é `null`; cancelamento sem confirmação é `pending`.
4. **Erros acionáveis.** 18 códigos fixos, `correlationId` em tudo, credencial ausente vira 401 com a
   instrução, e o XML cru nunca vai para quem chama.
5. **Honestidade de contrato.** O que não existe responde 501 com o motivo. Onde a API diverge do
   contrato (assentos pela oferta), a divergência está documentada.
6. **Testes que conhecem o provedor.** O normalizador é testado contra uma resposta real de 433 KB do
   portal, e o dublê repete as validações que a LATAM faz.

---

## 6. Perguntas e respostas

### Produto e negócio

**Isso já pode ir para produção?**
Não. Está validado no **sandbox**. Faltam: app de produção aprovado pela LATAM (o de sandbox é
self-service; o de produção passa por aprovação), identidade de agência real da Pass, autenticação na
própria API, o ajuste do log de cartão e a decisão sobre PCI (seção 7).

**Por que a LATAM e não a Travelfusion?**
A Travelfusion exige liberar o IP de quem chama; o login passa, mas todo comando seguinte volta
`4-3448`, e a liberação depende deles. A LATAM entrega Key/Secret no portal, sem whitelist. O código
da Travelfusion continua no repositório, atrás da mesma interface, e é desligado com
`PROVIDERS=latam`.

**A LATAM só vende LATAM. Isso não limita?**
Sim, é complemento e não substituto de um agregador. O ponto do desenho é que **o próximo provedor
entra sem mexer nos casos de uso**. A LATAM entrou assim, com a Travelfusion já existindo.

**Quanto tempo leva uma busca?**
Responda com o número que você mediu no ensaio (`duration` do evento `complete`). O teto configurado é
60 segundos. A LATAM responde de uma vez, sem polling.

**Por que reservar e pagar são dois passos?**
Porque são duas operações na LATAM. A reserva nasce `OPENED`, sem pagamento, com prazo
(`PaymentTimeLimitDateTime`); é o pagamento que a fecha. Juntar os dois esconderia um estado real, e
o prazo existe de verdade.

**E se a pessoa não pagar?**
A LATAM libera a reserva sozinha quando o prazo vence. O `/retrieve` mostra o prazo em `expiresAt`.

**Dá para cancelar antes de pagar?**
Não: a LATAM recusa com "estado inválido". Por isso o botão só aparece depois do pagamento. A
reserva não paga simplesmente expira.

**Qual a diferença entre anulação e reembolso?**
Dentro da janela de arrependimento a LATAM **anula** o bilhete (void); fora dela, calcula um
**reembolso**. A API pergunta primeiro (`OrderReshop`) e só então cancela, do jeito que a LATAM
indicou. No teste, a anulação devolveu R$ 1.023,18.

**Por que comprar assento não funciona?**
Funciona até o último passo. O pedido passa em toda a validação da LATAM; ela recusa na autorização
da cobrança, com cartão e também por BSP. Com um valor errado de propósito, a resposta é "valor não
bate", o que prova que o pedido foi lido e conferido. É limite do sandbox.

**Tem parcelamento com juros?**
A API devolve o que a LATAM informa: quantidade, valor da parcela, total, taxa e se é promocional.
No sandbox vieram de 1x a 8x sem juros.

### Arquitetura

**Como entra uma nova companhia (Gol, Azul)?**
Três lugares: uma classe que implementa `FlightProvider` (em `providers/<nome>/`), o registro no
`ProviderRegistry` e no módulo, e a tabela de capacidades em `common/capabilities.ts`. Depois, o nome
em `PROVIDERS`. Controller, DTOs e casos de uso não mudam.

**Por que NestJS?**
É a stack do `booking.pass-connect.com`. E três regras do contrato viraram estrutura em vez de
disciplina: o guard de capacidade roda antes da validação, a forma da resposta é tipada, e validação
e Swagger saem do mesmo DTO. Detalhes em [`../stack.md`](../stack.md).

**Onde fica o estado? Tem banco?**
Não tem banco. O estado da reserva mora na LATAM, e a API pergunta sempre que precisa. O que precisa
atravessar passos (qual oferta, quais passageiros) viaja dentro do `identifier` opaco.

**O que tem dentro do `identifier`?**
Um JSON em base64url com provedor, `OfferID`, `PaxJourneyID`, `OfferItemID`, direção e a lista de
passageiros da busca. Quem consome não lê nem monta; ele existe para a API voltar à mesma oferta sem
guardar nada.

**Por que a oferta é o par ida + volta, e não trechos soltos?**
Porque a LATAM declara a combinação dentro do mesmo `OfferID`. Montar pares por conta própria
ofereceria combinações que a companhia não vende; o erro só apareceria na hora de reservar.

**Por que a busca é stream e não um JSON normal?**
É o contrato da Pass. Com vários provedores, a tela mostra resultados à medida que cada um responde,
sem esperar o mais lento. A API consulta todos em paralelo, e a falha de um vira `provider_error`
sem derrubar os outros.

**"Sem voos" é erro?**
Não. Vem como `provider_error` com `code: NO_FLIGHTS` e **sem** `canonicalCode`, e a busca termina
normalmente. Quem consome diferencia pelo `canonicalCode`.

**Por que o filtro de cabine é feito pela API?**
Porque foi medido: pedindo executiva à LATAM vieram 0 ofertas; sem o filtro vieram 424, 12 de
executiva. Filtrar na LATAM escondia voo que existe.

**Por que `/seat-map` diverge do contrato?**
O contrato endereça o mapa pelo localizador, supondo escolha depois de reservar. Na LATAM a vitrine
de assentos responde pela oferta, antes de o localizador existir. A divergência está documentada no
Swagger e no `rotas.md`.

**Por que existem `/order-seat-map` e `/order-ancillaries`, que o contrato não tem?**
A LATAM tem dois catálogos. O da oferta devolve ids `SEI|…`, que morrem na emissão; o da reserva
devolve `SEAT_…`/`BAG_…`, os únicos que a compra aceita. Misturar os dois é o erro
`INVALID_OFFER_TYPES`.

**Por que 501 e não 404?**
404 diria "essa rota não existe". 501 diz "a rota existe no contrato, este provedor não a atende", e
quem consome age diferente nos dois casos.

**Por que 502 e não 500 quando a LATAM falha?**
500 é falha nossa; 502 é falha na companhia. Quem opera precisa saber para quem ligar.

### LATAM e NDC

**O que é NDC?**
New Distribution Capability: o padrão XML da IATA para companhias venderem direto a agências. A LATAM
usa a versão 19.2 para quase tudo e a 24.1 para compra de opcional depois da emissão.

**Como a API autentica na LATAM?**
OAuth2 `client_credentials`: Basic Auth com Key/Secret **mais** o header `x-api-key`. Só o Basic dá
`401 Invalid credentials`, o que parece credencial errada e não é. O token vale 59 minutos; a API
renova um minuto antes e, se vier 401/403 numa leitura, renova e repete uma vez.

**Dez buscas ao mesmo tempo pedem dez tokens?**
Não. Pedidos simultâneos esperam o mesmo pedido de token.

**Por que tanto erro 403 diferente na configuração?**
Toda mensagem NDC carrega a identidade da agência, e cada campo faltando tem o seu código: IATA
(`403122010`), agente (`403122009`), país que não bate com o POS (`403122003`), app sem a API
liberada (`403122004`). A tabela está no README.

**Como vocês descobriram o que a doc não dizia?**
Sondando o sandbox, um erro de cada vez. O gateway costuma apontar o elemento **seguinte** ao que
falta, então cada campo custou uma rodada de tentativa. Cada descoberta tem comentário no código e
regra no dublê de testes.

**Por que um bilhete cancelado aparece como `CLOSED`?**
Para a LATAM a ordem existe e foi concluída. O cancelamento aparece no **cupom** do bilhete
(`CouponStatusCode: VOID`), e a API dá precedência a ele.

### Segurança e dinheiro

**O valor da cobrança pode ser manipulado pela tela?**
Não. O `/issue` consulta o total na LATAM e cobra esse. Um `amount` enviado só serve de conferência:
se divergir, responde `FARE_PRICE_CHANGED` e não cobra. No `/sell-ancillaries` o corpo nem tem campo
de valor.

**E se a resposta do pagamento se perder?**
A API não repete, porque a primeira tentativa pode ter cobrado. A resposta é timeout (504), e o
caminho é o `/retrieve`: se a ordem está `confirmed`, o pagamento passou.

**Vocês guardam o cartão?**
Não há persistência, o cartão não volta em resposta e os logs dessas rotas registram só localizador
e `correlationId`. **Mas há um ponto em aberto, e é melhor você trazê-lo antes que perguntem:** em
falha de rede, o log registra o objeto de erro do axios, que carrega o corpo da requisição e,
portanto, o cartão. Precisa ser corrigido antes de uso real (detalhe no `rotas.md`). E como o cartão
passa pela API, produção exige PCI-DSS ou tokenização antes.

**A API tem autenticação?**
Não, e o CORS aceita qualquer origem. É uma API de desafio rodando local. Para produção, precisa de
autenticação de quem chama e de CORS restrito.

**O que aparece para o usuário quando dá erro?**
A tela traduz o código para uma frase de quem compra ("o banco recusou, nada foi cobrado, tente outro
cartão"). O detalhe técnico fica no log, ligado pelo `correlationId`.

**Segredos podem vazar na resposta de erro?**
O `providerError` passa por redação de `Bearer`, `Basic`, `api_key`, `secret` e `password` antes de
ser cortado em 400 caracteres. O XML cru nunca vai para o corpo.

### Qualidade, testes e operação

**Quantos testes, e o que cobrem?**
67. `contract.spec.ts` (23) cobre as regras do contrato. `latam.spec.ts` (29) testa o normalizador
contra uma resposta **real** de 433 KB do portal, e pula sozinho se a amostra não estiver presente,
porque ela fica fora do git. `latam.integration.spec.ts` (15) roda o provedor inteiro contra o dublê
do NDC.

**Por que não existe modo mock para rodar a API sem credencial?**
Porque um dublê acessível por configuração acaba ligado em produção por acidente. O dublê só é
alcançável pelo teste, injetado no construtor. Sem credencial, a API responde 401 explicando o que
configurar.

**Como se investiga um problema?**
Pelo `correlationId`: ele volta na resposta, no header `x-correlation-id`, e vai para a LATAM como
`X-latam-Track-Id`. Com ele se acha a linha no log da API e se abre chamado na LATAM.

**Tem métricas, tracing, alertas?**
Não, só logs. Fica para a etapa de produção.

**E com várias instâncias?**
A API não guarda estado de negócio. O que é por instância: o cache do token (cada instância pede o
seu, o que é aceitável) e o limite de 10 `/ping` por minuto, que viraria contador compartilhado.

**O Swagger está atualizado?**
Os schemas de pedido e resposta sim, porque saem dos DTOs. Algumas **descrições** ainda falam da
Travelfusion (`ProcessDetails`, `CheckBooking`…). A referência da LATAM é o `rotas.md`.

### Front-end

**Com o que o front foi feito?**
React + Vite + Tailwind, com os componentes e tokens do design system da Pass (paleta neutra, Geist,
toolbar flat), e não um tema genérico.

**Por que assento, bagagem e cancelamento não são passos?**
Porque não têm ordem nem são obrigatórios: são o que se faz com a passagem já comprada. Colocá-los
como etapa daria a entender que a compra só termina depois deles.

**O bilhete é um PDF gerado?**
Não. É montado com a resposta do `/retrieve` e impresso pelo navegador, que também salva em PDF.
Gerar arquivo seria um segundo lugar para manter atualizado.

---

## 7. O que falta para produção

Em ordem de prioridade:

1. **Log de falha de rede sem dados de cartão** (`LatamClient.send`). Pequeno, e bloqueia uso real.
2. **Autenticação na API e CORS restrito.**
3. **PCI-DSS ou tokenização** do cartão antes de chegar à API.
4. **App de produção na LATAM** e identidade de agência real da Pass.
5. **Descrições do Swagger** atualizadas para a LATAM.
6. **Compra de opcional** validada num ambiente que autorize a cobrança.
7. Rotas 501 que a NDC oferece: `remove-seats`, `payment-options`, `retrieve-eticket`,
   `cancel-eticket`.
8. **Observabilidade**: métricas por mensagem NDC, taxa de erro por código, latência do
   `AirShopping`.
9. Detalhes do contrato: `international` sempre `false`, `trip` inferido pela contagem de segmentos,
   multidestino com uma opção por trecho.

---

## 8. Cuidados na hora de falar

| Evite | Prefira |
|---|---|
| "está 100% pronto" | "roda ponta a ponta no sandbox; faltam estes itens para produção" |
| "a compra de assento não funciona" | "o pedido está correto; o sandbox não autoriza a cobrança" |
| "o cartão nunca aparece em log" | "não é gravado nem devolvido; há um ponto em aberto no log de falha de rede" |
| "a doc da LATAM está errada" | "a doc não conta tudo; o que descobrimos está registrado" |
| "é igual para qualquer companhia" | "o próximo provedor entra sem mexer nos casos de uso" |
| citar tempo de busca de cabeça | o número medido no ensaio |
