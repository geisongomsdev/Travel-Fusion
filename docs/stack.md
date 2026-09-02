# A stack, e por que ela

A API é **NestJS + TypeScript**, alinhada com `booking.pass-connect.com` (Nest + Express,
`class-validator`, `@nestjs/swagger`, `src/{common,modules}`).

---

## O que o Nest resolve que antes era manual

Três regras do contrato deixaram de depender de disciplina e passaram a ser estruturais.

### 1. Capability antes da validação — de graça

O contrato exige que "este provedor faz isso?" seja checado **antes** de validar o corpo. Invertida,
um `/issue` com body vazio responderia `400 payload inválido` em vez de `501`.

No Nest, **guards rodam antes dos pipes**. A regra virou um decorator:

```ts
@Post('issue')
@Capability('issue')
issue(): never { throw notSupported('issue'); }
```

Antes era um `preHandler` que alguém precisava lembrar de pendurar em cada rota.

### 2. A forma da resposta virou tipo

`flight.types.ts` descreve o vocabulário canônico — `Leg`, `Fare`, `FarePrice`, `FareBenefits` com
as 8 chaves fixas. Esquecer um campo que o contrato exige passou a ser erro de compilação.

Na versão anterior, três campos (`details.errors`, `price`, as opções de bagagem) saíram como `{}`
em produção porque o serializer podava o que o schema não declarava — o tipo de bug que some quando
o compilador conhece a forma.

### 3. Uma fonte para validação e documentação

Os DTOs carregam `class-validator` e `@nestjs/swagger` juntos:

```ts
@ApiProperty({ example: 'GRU' })
@IsString() @Length(3, 3)
origin!: string;
```

Antes eram dois artefatos — JSON Schema à mão para o Swagger, checagem à parte — que divergiam
sozinhos.

---

## O que continua sendo escolha, não framework

| Decisão | Onde | Por quê |
|---|---|---|
| `AppError` **não** estende `HttpException` | `common/errors/` | O status vem do catálogo, não do construtor. Assim ninguém escolhe um status que o contrato não prevê |
| Um `ContractExceptionFilter` global | `common/filters/` | Só ele publica `providerError`, e sempre sanitizado. O cru vai para o log |
| `EnvelopeInterceptor` com escape | `common/interceptors/` | O envelope de três chaves é automático; `@RawResponse()` marca as duas rotas que têm forma própria (`/availability` e `/retrieve`) |
| Guard de credencial no client | `config/credentials.ts` | Credencial em branco falha **antes da rede**, com 401 acionável — não como 400 do provedor virando "502, retente" |

---

## Estrutura

```
src/
  main.ts                    bootstrap, Swagger, ValidationPipe global
  config/                    env, timeouts da spec, guard de credencial
  common/
    capabilities.ts          o que o provedor faz — uma tabela
    errors/                  catálogo (18 códigos) e AppError
    filters/                 corpo de erro do contrato
    guards/                  @Capability
    interceptors/            envelope + @RawResponse
    utils/                   money, offer-key
  modules/
    flight/                  controller, DTOs, tipos canônicos, use-cases
    travelfusion/            client XML, comandos, normalizers  ← só aqui se sabe o que é XML
    health/
```

A fronteira que importa: **o formato do provedor não sobe de `modules/travelfusion/`.** Um segundo
provedor entra como pasta irmã e nada acima muda.

---

## Rodando

```bash
npm install
npm run dev:mock     # mock + API apontada para ele, sem credencial
npm run dev          # contra o .env
npm test             # 18 testes
```

`dev:mock` existe porque o erro mais comum é rodar `npm run dev` com o `.env` de exemplo: a API fala
com a Travelfusion de produção, que recusa (IP não whitelistado, senha placeholder). Agora isso
responde **401 com a instrução**, e o log de subida avisa antes da primeira chamada.
