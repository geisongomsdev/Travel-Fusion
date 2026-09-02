# Travel Fusion

Integração da **Travelfusion Direct Connect XML API** com o contrato canônico de venda de passagens
aéreas — 17 rotas REST/JSON, `/availability` em `text/event-stream`.

A Travelfusion é um agregador que fala **XML puro via HTTP POST**, com fluxo de polling:

```
Login → StartRouting → CheckRouting → ProcessDetails → ProcessTerms → StartBooking → CheckBooking
```

Este repositório é a camada que traduz esse fluxo para o contrato, de modo que a integração fique
indistinguível de qualquer outro provedor por fora.

---

## Rodando

```bash
# API — Fastify, porta 3010, Swagger em /docs
cd api
npm install
cp .env.example .env      # preencha TF_PASSWORD
npm run dev

# Front — Vite + React + Tailwind + shadcn, porta 5173
cd web
npm install
npm run dev
```

### Sem credencial válida

As credenciais reais só respondem a partir de **IP whitelistado** — hoje a busca volta
`4-3448 Login ID not found`. Para exercitar o fluxo inteiro sem elas existe um mock do endpoint XML:

```bash
node api/tests/mock-travelfusion.js                                  # sobe o mock na 3999
TF_ENDPOINT=http://localhost:3999/Xml TF_PASSWORD=mock npm run dev   # API contra o mock
```

O mock reproduz o que importa do comportamento real: `CheckRouting` incremental, `Complete` só depois
de algumas passadas, `RequiredParameterList` com o `DisplayText` de bagagem, e `CheckBooking`
passando por `BookingInProgress` antes de `Succeeded`.

---

## Estrutura

```
api/
  src/
    config/          endpoint, credenciais, timeouts por comando
    constants/       catálogo de erro (18 códigos), capabilities
    domain/          AppError, dinheiro
    application/     use-cases: busca, quote, reserva
    integrations/
      travelfusion/
        provider/    transporte XML, Login+cache, comandos, mapa de erro
        normalizers/ rota → contrato, bagagem
    interfaces/http/ app, rotas, schemas do Swagger, presenters
  tests/             unitários + mock do provedor
web/
  src/
    components/ui/   shadcn (button, card, input, label, badge, steps)
    steps/           busca → resultados → tarifar → reservar
    lib/             cliente HTTP e leitor de SSE
docs/
  decisoes.md        onde o contrato e a Travelfusion não se encaixam
```

A pasta `integrations/travelfusion/provider/` espelha a convenção de
`queue-booking.pass-connect/flight/src/integrations/<provider>/provider/`, para que a migração
depois seja mover pasta, não reescrever.

---

## Estado

| | |
|---|---|
| Implementado | `/availability` (stream), `/quote`, `/booking`, `/retrieve`, `/fare-rules`, `/ping` |
| **501** por limitação do provedor | assentos, ancillaries avulsos, pagamento, emissão, e-ticket, cancelamento |
| Falta para o go-live | `ListSupplierRoutes` ligado à busca, 3D Secure |

A mais importante das decisões: a Travelfusion **não separa reservar de emitir** — o `StartBooking`
já cobra, então `/issue` é 501.

| Documento | Assunto |
|---|---|
| [`docs/mapeamento.md`](docs/mapeamento.md) | Rota do contrato ↔ comando Travelfusion, timeouts, mapa de erro |
| [`docs/arquitetura.md`](docs/arquitetura.md) | As camadas, onde cada decisão mora, o que falta |
| [`docs/decisoes.md`](docs/decisoes.md) | Onde o contrato e o provedor não se encaixam |

---

## Documentação de origem

| Pasta | Conteúdo |
|---|---|
| `docs-api/` | A especificação do contrato — 17 rotas, convenções, catálogo de erros |
| `Travel Fusion/` | Documentação do provedor (spec XML, welcome pack, onboarding) |

> ⚠️ `Travel Fusion/` contém **credenciais reais** e está no `.gitignore`. Não versionar.
