# Arquitetura

Por que as camadas são estas, e o que pode entrar em cada uma.

---

## O desenho

```
   HTTP  ──►  interfaces/http     rotas, schemas do Swagger, presenters
                    │             (só aqui se sabe o que é status HTTP)
                    ▼
              application         use-cases: a regra do contrato
                    │             (não sabe o que é XML, não sabe o que é HTTP)
                    ▼
              integrations/travelfusion
                    ├─ normalizers   provedor → forma canônica
                    └─ provider      transporte XML, Login, comandos, mapa de erro
                                     (o único lugar que sabe o que é Travelfusion)
```

A regra que sustenta tudo: **o formato do provedor não vaza para cima.** Um `use-case` recebe e
devolve a forma do contrato. Se um dia entrar um segundo provedor, ele entra como outra pasta em
`integrations/` e nada acima muda.

Espelha a convenção de `queue-booking.pass-connect/flight/src/integrations/<provider>/provider/`,
de propósito: a migração depois é mover pasta, não reescrever.

---

## Onde cada decisão mora

| Decisão | Arquivo | Por que ali |
|---|---|---|
| Catálogo de erro | `constants/error-codes.js` | Fonte única. Código desconhecido resolve para `UNEXPECTED_ERROR`, nunca lança |
| O que o provedor faz | `constants/capabilities.js` | Uma tabela. Rota nova nasce declarando aqui |
| Timeouts e retries | `config/timeouts.js` | Vêm da spec, não de palpite. Retry em mutação é 0 e está escrito |
| Custom parameters obrigatórios | `provider/custom-parameters.js` | Injetados pelo *client*, não pelos comandos — comando novo nasce conforme |
| Arredondamento de dinheiro | `domain/money.js` | Um `roundMoney`. `Math.round(v*100)/100` erra em valores reais de tarifa |
| Sanitização do erro do provedor | `presenters/error.presenter.js` | Só o presenter publica `providerError`. O cru vai para o log |

---

## Três pontos que merecem atenção

### 1. O guard de capability é `preHandler`, não `if`

A checagem de "este provedor faz isso?" roda **antes** da validação de corpo. Invertida, um `/issue`
com body vazio responderia `400 payload inválido` — verdade acidental que manda quem chamou procurar
no lugar errado. Por isso é `preHandler`, que no Fastify roda antes do handler mas depois do
parsing, e não um `if` dentro do handler.

### 2. O `LoginId` é cache de processo

O `LoginId` da Travelfusion vale indefinidamente, e o `Login` só pode ser chamado poucas vezes por
dia. A regra da casa — resolver credencial do banco a cada request — vale para **usuário e senha**,
não para refazer o Login.

Hoje o cache é uma variável de módulo. Com mais de uma instância, cada uma faz o seu Login: ainda
dentro do limite, mas se o número de instâncias crescer isso precisa virar cache compartilhado.

### 3. O serializer do Fastify poda o que o schema não declara

Isso mordeu três vezes durante a construção: `details.errors`, `price` e as opções de bagagem saíram
como `{}` porque o schema dizia só `type: 'object'`.

**Campo que sai na resposta precisa estar declarado no schema, com forma.** Não é só documentação —
é o que decide o que chega em quem consome.

---

## Testando sem credencial

As credenciais reais só respondem de IP whitelistado. `api/tests/mock-travelfusion.js` sobe um
endpoint XML falso que reproduz o que importa do comportamento real:

- `CheckRouting` **incremental** — devolve as rotas uma vez e nunca mais;
- `Complete` só vira `true` depois de algumas passadas;
- `RequiredParameterList` com o `DisplayText` de bagagem em texto livre;
- `CheckBooking` passando por `BookingInProgress` antes de `Succeeded`.

Os dois primeiros existem porque são exatamente onde uma integração ingênua quebra: tratar cada
resposta do polling como "o total" perde voo, e parar no primeiro `CheckRouting` perde fornecedor.

```bash
node api/tests/mock-travelfusion.js
TF_ENDPOINT=http://localhost:3999/Xml TF_PASSWORD=mock PORT=3011 node api/server.js
```

---

## O que falta

| | |
|---|---|
| `ListSupplierRoutes` ligado à busca | **Bloqueia o go-live.** Implementado, não plugado |
| Um `provider_success` por fornecedor | Hoje sai um só, ao final do polling |
| 3D Secure | Requisito de certificação, ainda não desenhado |
| Cache do `LoginId` compartilhado | Só importa com múltiplas instâncias |
