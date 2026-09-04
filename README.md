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
  supports: { fareRules: boolean; retrieve: boolean; multicity: boolean };
  probe(ctx): Promise<ProviderProbe>;
  search(request, ctx): AsyncGenerator<ProviderOffer[]>;   // lotes
  quote(key, dto, ctx): Promise<ProviderQuote>;
  book(key, dto, ctx): Promise<ProviderBooking>;
  retrieve(locator, ctx): Promise<ProviderRetrieval>;
  fareRules(key, dto, ctx): Promise<FareRuleSection[]>;
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
npm test               # 64 testes

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
  steps/             busca → resultados → tarifar → reservar → finalizar
```

O `xml.util` vive em `common/` porque os dois provedores o usam — dentro de um deles, a dependência
apontaria na direção errada.

---

## Estado

| | |
|---|---|
| Implementado | `/availability` (stream), `/quote`, `/booking`, `/retrieve`, `/fare-rules`, `/ping` |
| **501** declarado | assentos, ancillaries avulsos, pagamento, emissão, e-ticket, cancelamento |
| Bloqueio Travelfusion | IP não whitelistado — `Login` passa, comando seguinte volta `4-3448` |
| Bloqueio LATAM | falta registrar o app no portal Apigee (Key/Secret) |

Duas capacidades são **501 por honestidade**, não por preguiça: a Travelfusion não separa reservar de
emitir (o `StartBooking` já cobra, então `/issue` é 501), e a LATAM devolve penalidade estruturada em
vez do texto integral da tarifa — publicar aquilo como "condições" seria dizer que é o que não é.

| Documento | Assunto |
|---|---|
| [`docs/stack.md`](docs/stack.md) | A stack NestJS/TS e o que ela resolve estruturalmente |
| [`docs/entrega.md`](docs/entrega.md) | O que foi construído, o que foi além do mínimo, pendências |
| [`docs/mapeamento.md`](docs/mapeamento.md) | Rota do contrato ↔ comando do provedor, timeouts, mapa de erro |
| [`docs/arquitetura.md`](docs/arquitetura.md) | As camadas e onde cada decisão mora |
| [`docs/decisoes.md`](docs/decisoes.md) | Onde o contrato e os provedores não se encaixam |

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
