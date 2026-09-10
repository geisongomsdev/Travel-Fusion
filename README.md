# Pass Flight API

Uma API que traduz **múltiplos provedores de passagem aérea** para o contrato canônico da Pass —
17 rotas REST/JSON, com `/availability` em `text/event-stream`.

Hoje fala com dois provedores, por caminhos completamente diferentes:

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

**Travelfusion** — o Welcome Pack entrega três contas diferentes, e trocá-las devolve
`4-3900 Invalid credentials`. A do `.env` é a da linha **"API account"**, não a do portal Reports nem
a do IBE. Seis senhas erradas seguidas **desativam** o usuário, por isso o `getLoginId` tem cache
negativo: a primeira recusa é memorizada e as chamadas seguintes falham sem sair para a rede.

`PROVIDERS=latam,travelfusion` define quem está no ar e a ordem — o primeiro é o padrão de quem não
escolhe. Tirar um dali o desliga sem deploy.

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
      travelfusion/         client XML, comandos, normalizadores
api/test/
  contract.spec.ts           invariantes do contrato
  latam.spec.ts              normalizador contra a amostra REAL do portal (433KB)
  latam.integration.spec.ts  provider inteiro contra o duble
web/src/
  components/toolbar/  o toolbar flat do design system da Pass (chips, ícones 1.5)
  components/sandbox/  CodeBlock, FieldTable, Callout, Endpoint — das páginas de operação do portal
  components/ui/       button, input, select, badge, card com as classes do design system
  steps/             busca → escolher → tarifar → reservar
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

**Uma decisão de exibição vale nota:** a LATAM devolve uma oferta por família tarifária, então o
mesmo voo chega repetido — a busca GRU→SCL traz 422 tarifas para 94 voos. Listar cru viraria cinco
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
| `/cancel-booking` | ✅ OrderReshop + OrderCancel | 501 — `StartBooking` já cobra, cancelar seria estorno |
| `/fare-rules` | 501 — devolve penalidade estruturada, não o texto da tarifa | ✅ vem no ProcessDetails |
| `/ping` | ✅ o próprio OAuth2 prova a credencial | ✅ Login |
| assentos, ancillaries, pagamento, emissão, e-ticket | 501 | 501 |

| | |
|---|---|
| Bloqueio Travelfusion | IP não whitelistado — `Login` passa, comando seguinte volta `4-3448` |
| LATAM | **funcionando ponta a ponta** contra o sandbox |

O fluxo completo foi percorrido contra o sandbox real da LATAM: busca GRU→SCL (424 tarifas),
tarifação, reserva (`LA9574345ABYG`, `OPENED`) e recuperação da ordem com passageiro, documento e
nascimento de volta.

**O `/cancel-booking` fica com uma verificação parcial, e vale dizer por quê.** A rota está
implementada e ligada, o duble cobre os dois passos, e contra o sandbox ela chega ao provedor e
recebe `400107002 Invalid order current status` — porque a LATAM só cancela ordem **paga**, e as
ordens criadas aqui ficam em `OPENED`. Fechar isso exige um cartão de teste, que para POS ≠ CL
precisa ser pedido ao time da LATAM (`operations/order-create-payment.md`). O erro é classificado
como `RESOURCE_CONFLICT`, não como payload inválido: o corpo está certo, o estado da ordem é que não
permite.

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
