# Documentação

O foco atual é o provedor **LATAM NDC**. O material da Travelfusion foi arquivado em
[`travelfusion/`](travelfusion/): o código continua no repositório, mas o provedor está bloqueado por
liberação de IP e fora do escopo agora.

## Por onde começar

| Você quer… | Leia |
|---|---|
| entender o fluxo **sem programar** | [`latam/fluxo.md`](latam/fluxo.md) |
| **consumir ou manter** a API: cada rota, pedido, resposta, erros | [`latam/rotas.md`](latam/rotas.md) |
| **apresentar** o projeto, com roteiro e perguntas prováveis | [`latam/apresentacao.md`](latam/apresentacao.md) |
| o resumo curto, para gestão | [`latam/resumo-rodrigo.md`](latam/resumo-rodrigo.md) |
| saber por que NestJS e como o código se organiza | [`stack.md`](stack.md) |
| rodar o projeto e ver o que a doc da LATAM não conta | [`README` da raiz](../README.md) |
| a especificação do contrato canônico (17 rotas) | [`docs-api/docs-api/`](../docs-api/docs-api/README.md) |
| o histórico da integração Travelfusion | [`travelfusion/`](travelfusion/README.md) |

## Estrutura

```
docs/
  README.md               este índice
  stack.md                a stack e a organização do código (vale para qualquer provedor)
  latam/
    rotas.md              referência detalhada de cada rota
    fluxo.md              o fluxo explicado para quem não programa
    apresentacao.md       roteiro de apresentação + perguntas e respostas
    resumo-rodrigo.md     resumo em cinco parágrafos
  travelfusion/           ARQUIVADO
    README.md             o que é, por que parou, como religar
    arquitetura.md · decisoes.md · entrega.md · mapeamento.md
    suporte/              pacotes enviados ao suporte (fora do git: contêm credencial)
```
