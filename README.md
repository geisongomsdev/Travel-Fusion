# Pass Flight API

Uma API que traduz **provedores de passagem aérea** para o contrato canônico da Pass —
17 rotas REST/JSON, com `/availability` em `text/event-stream`.

🎯 **O foco atual é a LATAM NDC**, que roda ponta a ponta contra o sandbox real. A Travelfusion está
arquivada: o código continua atrás da mesma interface, mas o provedor está bloqueado por liberação de
IP ([`docs/travelfusion/`](docs/travelfusion/README.md)).

## Documentação

| Você quer… | Leia |
|---|---|
| cada rota em detalhe: pedido, o que acontece por dentro, resposta, erros | [`docs/latam/rotas.md`](docs/latam/rotas.md) |
| o fluxo explicado para quem não programa | [`docs/latam/fluxo.md`](docs/latam/fluxo.md) |
| apresentar o projeto, com roteiro e perguntas prováveis | [`docs/latam/apresentacao.md`](docs/latam/apresentacao.md) |
| a stack e a organização do código | [`docs/stack.md`](docs/stack.md) |
| o índice completo | [`docs/README.md`](docs/README.md) |

## Dois provedores, por caminhos diferentes

A fronteira foi desenhada com os dois, e é por isso que eles aparecem lado a lado:

| | Travelfusion | LATAM NDC |
|---|---|---|
| Protocolo | XML puro, envelope `<CommandList>` | XML IATA NDC 19.2 + 7 headers `X-latam-*` |
| Autenticação | `Login` → `LoginId` eterno | OAuth2 client_credentials, token de 59 min |
| Busca | `StartRouting` + polling incremental | `AirShopping` **síncrono** |
| Reserva | `ProcessTerms` → `StartBooking` → `CheckBooking` | `OfferPrice` → `OrderCreate` → `OrderRetrieve` |
| Cobertura | agregador, várias companhias | só LATAM |

Por fora, os dois são indistinguíveis: mesma resposta, mesmo vocabulário, mesmo catálogo de erro.

---

## A fronteira de provedor

Tudo acima de `FlightProvider` fala o contrato; tudo abaixo fala XML de fornecedor.

```ts
interface FlightProvider {
  name: string;
  supports: { fareRules; retrieve; multicity; cancelBooking: boolean };
  probe(ctx): Promise<ProviderProbe>;
  search(request, ctx): AsyncGenerator<ProviderOffer[]>;   // lotes
  quote(key, dto, ctx): Promise<ProviderQuote>;
  book(key, dto, ctx): Promise<ProviderBooking>;
  retrieve(locator, ctx): Promise<ProviderRetrieval>;
  fareRules(key, dto, ctx): Promise<FareRuleSection[]>;
  cancelBooking?(locator, ctx): Promise<ProviderCancellation>;  // opcional
}
```

Duas decisões carregam o desenho:

**`search` é async generator nos dois.** A Travelfusion entrega em pedaços (o `CheckRouting` é
incremental — resultado já devolvido não volta) e a LATAM entrega de uma vez. Quem consome itera até
acabar, sem saber qual é qual.

**A oferta é `{ outbound, inbound }` — o par já fechado.** Os dois provedores *declaram* a
combinabilidade: `RoutingId` na Travelfusion, `OfferID` + `PaxJourneyRefID` na LATAM. Modelar o
pacote inteiro como uma coisa só torna impossível parear ida com volta por conta própria, que é a
regra que reprova a integração (`04-availability-formatos.md §2`).

`/availability` consulta **todos os provedores em paralelo** e emite um `provider_success` por
provedor, na ordem em que respondem. Falha de um não derruba os outros — vira `provider_error` com o
código do catálogo, e o stream segue.

---

## Rodando

```bash
cd api
npm install
cp .env.example .env
npm run dev            # porta 3010, Swagger em /docs
npm test               # 67 testes
npm run lint

cd ../web
npm install
npm run dev            # porta 5173
```

### Credenciais

**LATAM** — self-service, sai em 2 minutos:

1. Portal Apigee (`latamxp-sandboxdirectconnect.apigee.io`) → **Apps** → **+ NEW APP**
2. Adicione a API `NDC v19.2 - Dev` → **Create**
3. Copie **Key** e **Secret** para `LATAM_API_KEY` / `LATAM_API_SECRET`

Sem whitelist de IP. Aprovação da LATAM só é necessária para app de **produção**.

🔴 **Key que gera token não é key que busca.** O `/oauth/cc/token` devolve `200` para qualquer app
registrado, mas o gateway NDC recusa com `403122004 Forbidden User` os apps que não têm a API
liberada. Um token válido não prova acesso — a prova é um `AirShopping` que volta `200`.

Além da Key/Secret, **toda mensagem NDC carrega a identidade da agência**, e cada campo ausente tem
seu próprio 403:

| Variável | Sem ela | O que é |
|---|---|---|
| `LATAM_AGENCY_IATA` | `403122010` | O número IATA **da sua agência**. O `75996406` do guia do Postman é de uma agência de demonstração e não vale para a sua Key. |
| `LATAM_TRAVEL_AGENT_ID` | `403122009 Missing Agent Info` | O e-mail do agente cadastrado. Vira `<TravelAgent><TravelAgentID>`. |
| `LATAM_COUNTRY` | `403122003` | A praça onde a agência está cadastrada — e ela precisa bater com o `POS` da mensagem. Uma agência registrada em `BR` é recusada com `POS: CL`. |

`LATAM_AGENCY_ID` entra na mensagem mas o sandbox **não valida** o valor.

`PROVIDERS` define quem está no ar e a ordem — o primeiro é o padrão de quem não escolhe. Tirar um
dali o desliga sem deploy. **Com o foco na LATAM, use `PROVIDERS=latam`**: com a Travelfusion ligada,
toda busca também a consulta, e ela devolve `provider_error` por IP não liberado.

**Travelfusion** (arquivada) — o Welcome Pack entrega três contas diferentes, e trocá-las devolve
`4-3900 Invalid credentials`. A do `.env` é a da linha **"API account"**, não a do portal Reports nem
a do IBE. Seis senhas erradas seguidas **desativam** o usuário, por isso o `getLoginId` tem cache
negativo. Mais em [`docs/travelfusion/`](docs/travelfusion/README.md).

### Sem credencial

A API responde `401 PROVIDER_AUTHENTICATION_FAILED` **antes de sair para a rede**, com a instrução no
corpo. Não existe modo mock: o duble do NDC vive em `api/test/fixtures/` e só o teste de integração o
alcança, injetado por construtor. Um duble alcançável pela configuração de runtime vira produção por
acidente.

---

## O que a doc da LATAM não conta

Tudo abaixo foi descoberto sondando o sandbox, um erro de cada vez. Está aqui porque cada item custou
uma rodada de tentativa e erro, e o erro que o gateway devolve raramente aponta o campo culpado.

**O token exige `x-api-key` além do Basic Auth.** Só com `-u key:secret` o `/oauth/cc/token` responde
`401 Invalid credentials` — o que parece credencial errada e não é.

**`offerPrice` é camelCase; o resto é minúsculo.** `/ndc/v192/offerprice` responde
`404 Invalid url or Method Not Allowed`. O YAML publicado não lista essa rota. As demais
(`/airshopping`, `/order/create`, `/order/retrieve`, `/order/cancel`, `/order/reshop`) são minúsculas.

**O XSD cobra campos que a doc não destaca**, e a mensagem de erro cita o elemento *seguinte* ao que
faltou:

| Mensagem | Falta | Erro |
|---|---|---|
| `OfferPrice` | `OwnerCode` depois do `OfferRefID` | `cvc-complex-type.2.4.a` |
| `OfferPrice` | `DataLists/PaxList` de volta | `cvc-identity-constraint.4.3: Key 'PaxIDKeyRef4' not found` |
| `OrderCreate` | `OwnerCode`, `Individual/IndividualID` | `400113025` |
| `OrderRetrieve` | `Order` dentro de `OrderFilterCriteria` | `911` |
| `OrderCreate` | `DataLists/ContactInfoList` — contato é obrigatório | `912 ContactInfoList is null or empty` |
| `OrderCancel` | `ExpectedRefundAmount`, com o valor vindo do `OrderReshop` | `933` |

**A ordem dos elementos é alfabética, e é obrigatória.** Em `Pax`: `ContactInfoRefID`, `IdentityDoc`,
`Individual`, `PaxID`, `PTC` — e dentro de `Individual`, `Birthdate` antes de `GivenName`. Fora dessa
sequência o gateway recusa sem dizer qual campo está no lugar errado.

Por isso o duble em `api/test/fixtures/latam-ndc-double.mjs` é chato de propósito: ele repete essas
validações. Cada regra ali veio de um 400/403 real, e é o que faz `latam.integration.spec.ts` pegar a
regressão antes do sandbox.

---

## Estrutura

```
api/src/
  common/
    errors/          AppError + catálogo do contrato (18 códigos)
    xml/             travessia tipada de XML (XmlElement, child, attr)
    utils/           dinheiro, chave opaca de oferta, idade na data do voo
  config/            env, timeouts por comando, credenciais
  modules/
    flight/          a camada do CONTRATO — controller, DTOs, casos de uso
                     (inclui os filtros de `refundable`/`class`, que valem para os dois)
    providers/
      provider.types.ts     a fronteira
      provider.registry.ts  quem atende esta requisição
      latam/                client OAuth2, comandos NDC, normalizador
      travelfusion/         client XML, comandos, normalizadores (arquivado)
api/test/
  contract.spec.ts           invariantes do contrato
  latam.spec.ts              normalizador contra a amostra REAL do portal (433KB)
  latam.integration.spec.ts  provider inteiro contra o duble
web/src/
  components/toolbar/  o toolbar flat do design system da Pass (chips, ícones 1.5)
  components/sandbox/  CodeBlock, FieldTable, Callout, Endpoint — das páginas de operação do portal
  components/ui/       button, input, select, badge, card com as classes do design system
  steps/             buscar → escolher → revisar → passageiro → pagar
docs/
  latam/             rotas, fluxo, apresentação e resumo
  travelfusion/      material arquivado da primeira integração
```

O `xml.util` vive em `common/` porque os dois provedores o usam — dentro de um deles, a dependência
apontaria na direção errada.

---

## O front

Uma tela só, que percorre o fluxo inteiro e mostra o contrato acontecendo.

Os componentes vêm do **design system da Pass** (`Pass_projects/sandbox`), não de um tema genérico:

| | |
|---|---|
| Paleta | **neutra** — `--primary` é quase preto (oklch 0.205). Cor no chrome é ruído; quem colore a tela é o dado |
| Fonte | Geist / Geist Mono |
| Raio | `--radius: 0.625rem`, com a escala `sm/md/lg/xl` derivada dele |
| Primitivos | `button`, `input`, `badge`, `card` e o trigger do `select` com as classes de `sandbox/src/components/ui/` |
| Barra | o padrão **flat** do `TravelsToolbar`: a barra some (sem borda, sem sombra) e cada controle vira um chip `bg-primary/5`, hover `bg-primary/10` |
| Ícones | traço 1.5 e `text-muted-foreground opacity-50` — o tratamento de `data-toolbar-styles.ts` |
| Status | pílula `bg-<cor>-500/10 text-<cor>-600 border-<cor>-500/20`, como no `ServiceDetailModal` |

Os tokens do toolbar ficam em `web/src/components/toolbar/toolbar-styles.js`, portados um a um — no
projeto original eles existem justamente para "chip" ser uma decisão só, em um arquivo só.

A exceção deliberada à paleta neutra é o **bloco de código** (`components/sandbox/CodeBlock`), que
mantém o tema escuro do print em `docs-api/latam/latam/assets/aishopping-…png`. Ali é payload, não
chrome. Junto dele ficam os outros três componentes das páginas de operação do sandbox de docs:
`FieldTable` (a tabela `Field Name / Type / Accepted Values / Required`), `Callout` (`### Advice` com
o triângulo de `assets/warning-sign`, e `**Note:**`) e `Endpoint` (a faixa `### URL Endpoint`).

O fluxo tem **cinco passos** — buscar, escolher, revisar, passageiro e **pagar**. Pagar é passo
próprio porque é operação própria: a reserva nasce com prazo e sem pagamento.

🔴 **Assento, bagagem, bilhete e cancelamento NÃO são passos.** Não têm ordem nem "próximo": são o
que se faz com a passagem já comprada. Ficam na própria tela de pagamento, depois da confirmação —
e o cancelamento fica **só** ali, porque antes de pagar a companhia recusa o pedido com "estado
inválido". Um botão que sempre falha é pior que botão nenhum.

O bilhete é montado a partir do `/retrieve`, não do estado da tela: comprovante que repete a própria
anotação mostra o que a gente acha, não o que a companhia registrou. Imprimir usa o diálogo do
navegador (de onde sai o PDF) e um `@media print` que deixa só o bloco do bilhete — gerar arquivo
seria um segundo lugar para manter, e o desatualizado apareceria na primeira mudança.

**Uma decisão de exibição vale nota:** a LATAM devolve uma oferta por família tarifária, então o
mesmo voo chega repetido — a busca GRU→SCL traz 424 tarifas para cerca de 94 voos. Listar cru viraria cinco
cartões idênticos com preços diferentes. `ResultsStep` agrupa por voo e deixa as famílias como
escolha dentro do cartão; o `identifier` continua sendo o da família escolhida, nunca remontado.


---

## Estado

Capability é **por provedor**, não global. O guard deixa passar a operação que ALGUM provedor no ar
faz, e o caso de uso devolve 501 quando o provedor escolhido não faz — antes o mapa era só o da
Travelfusion, e o `/cancel-booking` respondia 501 mesmo com a LATAM, que cancela.

| Rota | LATAM | Travelfusion |
|---|---|---|
| `/availability` (stream) | ✅ AirShopping | ✅ StartRouting + polling |
| `/quote` | ✅ OfferPrice | ✅ ProcessDetails |
| `/booking` | ✅ OrderCreate | ✅ ProcessTerms + StartBooking |
| `/retrieve` | ✅ OrderRetrieve | ✅ CheckBooking |
| `/cancel-booking` | ✅ OrderReshop + OrderCancel/**Void** | 501 — `StartBooking` já cobra, cancelar seria estorno |
| `/seat-map` | ✅ SeatAvailability, **pela oferta** | 501 — depende do fornecedor por trás do agregador |
| `/ancillaries` | ✅ ServiceList, **pela oferta** | 501 — saem no `/quote`, em `requiredParameters` |
| `/fare-rules` | 501 — devolve penalidade estruturada, não o texto da tarifa | ✅ vem no ProcessDetails |
| `/ping` | ✅ o próprio OAuth2 prova a credencial | ✅ Login |
| `/financing-options` | ✅ InstallmentOptions | 501 — não expõe parcelamento |
| `/issue` | ✅ OrderChange com pagamento | 501 — `StartBooking` já cobra |
| `/order-seat-map`, `/order-ancillaries` | ✅ os mesmos catálogos, **pela reserva** | 501 |
| `/sell-ancillaries`, `/mark-seats` | ✅ OrderChange 24.1 (ver abaixo) | 501 — o extra entra como CSP no `/booking` |
| e-ticket, `payment-options` | 501 | 501 |

| | |
|---|---|
| Bloqueio Travelfusion | IP não whitelistado — `Login` passa, comando seguinte volta `4-3448` |
| LATAM | **funcionando ponta a ponta** contra o sandbox |

O fluxo completo foi percorrido contra o sandbox real da LATAM: busca GRU→SCL (424 tarifas),
tarifação, reserva (`OPENED`), **pagamento** (a ordem passa a `CLOSED`), recuperação da ordem com
passageiro, documento, nascimento e itinerário de volta, e **cancelamento** (`VOID completed
successfully`, cupom `V`, R$ 1.023,18 declarados como devolvidos).

### Pagar, parcelar e comprar extras

Reservar e pagar são operações **separadas**, e são separadas porque a companhia as separa: o
`OrderCreate` devolve uma ordem em `OPENED` com prazo (`PaymentTimeLimitDateTime`), e é o pagamento
que fecha a passagem. Por isso `/booking` e `/issue` são rotas distintas, e não uma só.

| Rota | Mensagem | Estado |
|---|---|---|
| `/financing-options` | `InstallmentOptions` (v192) | ✅ até 8x sem juros, verificado |
| `/issue` | `OrderChange` com pagamento (v192) | ✅ ordem vai de `OPENED` a `CLOSED`, verificado |
| `/order-seat-map` | `SeatAvailability` **pela ordem** | ✅ 279 assentos com `SEAT_…`, verificado |
| `/order-ancillaries` | `ServiceList` **pela ordem** | ✅ 5 bagagens com `BAG_…`, verificado |
| `/sell-ancillaries`, `/mark-seats` | `OrderChange` 24.1 | ⚠️ payload aceito; o sandbox recusa a cobrança |

🔴 **O valor a cobrar não vem do corpo.** O `/issue` pergunta o total à companhia pelo `OrderRetrieve`
e cobra esse. Um `amount` no pedido é tratado como *declaração de expectativa*: se divergir, a
resposta é `FARE_PRICE_CHANGED` e nada é cobrado. Aceitar o número de quem chama seria deixar o preço
da cobrança ser decidido fora da companhia — e o erro só apareceria no extrato de quem comprou.

🔴 **Dado de cartão não é guardado e não volta na resposta.** O PAN existe nas chamadas em que a
operadora precisa dele (parcelas e cobrança) e morre com a requisição. Os logs dessas rotas registram
só o `correlationId` e o localizador.

⚠️ **Ponto em aberto:** numa falha de rede sem resposta (timeout, conexão recusada), o `LatamClient`
loga o objeto de erro do axios inteiro, e ele carrega o corpo XML da requisição — com o cartão, no
`/issue` e no `/sell-ancillaries`. Precisa ser corrigido antes de uso real. Detalhe em
[`docs/latam/rotas.md`](docs/latam/rotas.md#dado-de-cartão-o-que-é-garantido-e-o-que-ainda-não-é).

#### Cancelar são DUAS operações, e a companhia diz qual

O `OrderReshop` é quem decide, e a resposta muda de forma conforme o caso:

| A companhia responde | Significa | O que mandamos |
|---|---|---|
| `Desc/DescText: VOID permitted` | dentro da janela de arrependimento | `OrderCancel` **só com o OrderID** |
| `PriceDifferential` com `DifferentialTypeCode: Refund` | fora dela | `OrderCancel` com o `ExpectedRefundAmount` calculado |

Duas armadilhas moravam aí:

**O valor do reembolso não está onde a amostra sugere.** Numa ordem paga ele vem em
`PriceDifferential/GrandTotalAmount` — irmão do `DiffPrice`, que só traz o detalhamento
(tarifa, taxa de embarque, opcionais). Procurando só dentro do `DiffPrice`, o cancelamento parava
com "sem valor de reembolso" numa resposta que trazia o valor.

**O cancelamento não aparece no status da ordem.** Um bilhete anulado continua com
`Order/StatusCode: CLOSED` — do ponto de vista da companhia a ordem existe e está fechada. Quem
conta a verdade é o **cupom**, em `TicketDocInfo/Ticket/Coupon/CouponStatusCode: VOID`. Sem olhar
ali, o `/retrieve` publicava como confirmada uma passagem já anulada, e o cupom tem precedência
justamente porque quem comprou não vai voar.

**`400107002 Invalid order current status` quer dizer duas coisas OPOSTAS**: "ainda não foi paga" e
"já foi cancelada". Como o código não distingue e a diferença muda tudo para quem está na tela, o
provedor **pergunta** — uma leitura a mais só no caminho de falha — e devolve
`BOOKING_ALREADY_CANCELLED` quando o cupom já está anulado.

**`TicketDocInfo` vem em dois lugares com dois nomes de campo:** solto na resposta
(`Ticket/TicketNumber`) ou em `DataLists/TicketDocInfoList` (`TicketDocNbr`). Lendo só o segundo,
que é o que a amostra mostra, o `/issue` devolvia `tickets: []` numa emissão que tinha bilhete.

**O void não devolve `StatusCode` nenhum.** Ele confirma em texto, num `MarketingMessage`:
`VOID completed successfully`. Sem ler isso, um cancelamento que deu certo era publicado como
`pending` — o contrário do que aconteceu. E o valor devolvido só aparece aí, no
`TicketDocInfo/PaymentInfo` com `PaymentStatusCode: REFUNDED`; é ele que o contrato publica em
`refund`, junto do cupom marcado `V`.

#### Dois catálogos de assento, e a diferença importa

O mesmo assento tem **dois identificadores**, conforme por onde se pergunta:

| Endereçado por | Rota | `offerItemId` | Serve para |
|---|---|---|---|
| Oferta (antes de reservar) | `/seat-map`, `/ancillaries` | `SEI\|…` | escolher; morre na emissão |
| Ordem (depois de emitida) | `/order-seat-map`, `/order-ancillaries` | `SEAT_…` / `BAG_…` | **comprar** |

Trocar um pelo outro é o que fazia a LATAM responder `INVALID_OFFER_TYPES: Mixed type offers are not
supported`. O prefixo (`SEAT_`/`BAG_`) é o que roteia o pedido para o fluxo de opcionais; um id fora
desse formato cai no fluxo de **troca de voo**, que é outra coisa sobre a mesma reserva. Por isso o
`/sell-ancillaries` recusa antes da rede um id que não esteja no catálogo daquela reserva.

#### O que o 24.1 exige e a doc não diz

O `OrderChange` de opcionais é outra mensagem, com outro envelope (EASD, `easd:` nos filhos do topo)
e outra versão. Três coisas custaram tentativa e erro:

| Sintoma | Causa |
|---|---|
| `911 The content of element 'Order' is not complete` | `ServiceList` pela ordem exige `OrderItem/GrandTotalAmount` |
| `400300011 Required field is missing: AugmentationPoint` | o CPF do titular vai na **raiz** da mensagem, como `easd:AugmentationPoint`, antes de tudo — testei dentro do `PaymentCard` (onde a doc sugere), do `PaymentMethod`, do `PaymentProcessingDetails`, no fim do `Request` e na raiz sem prefixo: as cinco dão o mesmo erro |
| `400300012 IdentityDocTypeCode value must be I for Brazil` | a doc manda `CPF`; o gateway quer `I` |

**Onde parou.** Com isso o pedido passa em toda a validação: com um valor errado a companhia responde
`400300005 Payment amount does not match order total`, e com o valor certo ela responde
`409300032 Unsuccessful authorize` — a autorização da cobrança do opcional. O mesmo acontece pagando
por BSP (`PaymentTypeCode CA`), que é isento das regras de cartão do Brasil. Ou seja: **o payload está
correto e o sandbox não autoriza cobranças de opcional**. O contrato mapeia isso para
`PAYMENT_DECLINED` (409) — recusa da operadora não é conflito de estado nem erro de integração, e
repetir com o mesmo cartão dá no mesmo.

O voo em si **é pago** pelo mesmo cartão de teste (`4000000000002701`, CVV `737`, `03/30`, tabela em
`operations/order-create-payment.md`): o `/issue` fecha a ordem em `CLOSED`.

### `options.refundable` e `options.class`

Os dois eram aceitos no pedido e **não faziam efeito** — pior que não existir, porque quem chama
acredita que filtrou. Agora são aplicados em `AvailabilityService.applyOptionFilters`, na camada do
contrato, e por isso valem igual nos dois provedores.

🔴 **A cabine NÃO vai para o `AirShopping`**, e isso é medido: com `PreferredCabinType C` a LATAM
devolve **0** ofertas na mesma busca em que, sem o filtro, devolve **424** — 12 delas business.
Mandar o critério para cima escondia oferta que existe. Filtrando depois, `class=business` devolve 6.

`refundable: null` é **desconhecido**, não "sim": quem pediu só reembolsável não recebe tarifa cuja
regra a companhia não afirmou.

---

## Documentação de origem

| Pasta | Conteúdo | Versionada |
|---|---|---|
| `docs-api/` | A especificação do contrato — 17 rotas, convenções, erros | sim |
| `docs-api/latam/` | Portal NDC da LATAM (54 docs, 233 payloads) | **não** |
| `Travel Fusion/` | Spec XML, welcome pack, onboarding | **não** |

> ⚠️ As duas pastas de provedor ficam fora do repositório: contêm material do fornecedor e
> credenciais reais. `api/test/latam.spec.ts` usa uma amostra de `docs-api/latam/` e **pula sozinho**
> quando ela não está presente, então a suíte continua verde num clone limpo.
