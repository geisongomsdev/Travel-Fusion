# Travel Fusion

Integração da **Travelfusion Direct Connect XML API** com o contrato canônico de venda
de passagens aéreas (17 rotas REST/JSON, `/availability` em `text/event-stream`).

## O que é

A Travelfusion é um agregador que fala **XML puro via HTTP POST**, com fluxo de polling:

```
Login → StartRouting → CheckRouting → ProcessDetails → ProcessTerms → StartBooking → CheckBooking
```

Este repositório é a camada que traduz esse fluxo para o contrato, de modo que a
integração fique indistinguível de qualquer outro provedor por fora.

## Status

Em desenvolvimento.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `docs-api/` | Especificação do contrato — as 17 rotas, convenções, catálogo de erros |
| `Travel Fusion/` | Documentação do provedor (spec XML, welcome pack, onboarding) |

> ⚠️ `Travel Fusion/travelfusiononboardingdev.md` contém **credenciais reais** e está
> no `.gitignore`. Não versionar.
