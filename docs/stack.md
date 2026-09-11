# A stack, e por que ela

A API é **NestJS + TypeScript**, alinhada com `booking.pass-connect.com` (Nest + Express,
`class-validator`, `@nestjs/swagger`, `src/{common,modules}`).

---

## O que o Nest resolve que antes era manual

Três regras do contrato deixaram de depender de disciplina e passaram a ser estruturais.

### 1. Capability antes da validação — de graça

O contrato exige que "este provedor faz isso?" seja checado **antes** de validar o corpo. Invertida,
uma rota não suportada com body vazio responderia `400 payload inválido` em vez de `501`.

No Nest, **guards rodam antes dos pipes**. A regra virou um decorator:

```ts
@Delete('remove-seats')
@Capability('removeSeats')
removeSeats(): never { throw notSupported('removeSeats'); }
```

O guard pergunta se **algum provedor ligado em `PROVIDERS`** faz a operação. Quando só um faz, o caso
de uso confere o `supports` do provedor escolhido e responde 501 se for o outro.

### 2. A forma da resposta virou tipo

`flight.types.ts` descreve o vocabulário canônico — `Leg`, `Fare`, `FarePrice`, `FareBenefits` com
as 8 chaves fixas — e `provider.types.ts` descreve a fronteira com os provedores. Esquecer um campo
que o contrato exige passou a ser erro de compilação.

Na primeira versão (Fastify), três campos (`details.errors`, `price`, as opções de bagagem) saíram
como `{}` porque o serializer podava o que o schema não declarava — o tipo de bug que some quando o
compilador conhece a forma.

### 3. Uma fonte para validação e documentação

Os DTOs carregam `class-validator` e `@nestjs/swagger` juntos:

```ts
@ApiProperty({ example: 'GRU' })
@IsString() @Length(3, 3)
origin!: string;
```

Antes eram dois artefatos — JSON Schema à mão para o Swagger, checagem à parte — que divergiam
sozinhos. Os **schemas** do Swagger continuam fiéis por isso; as **descrições** são texto livre e
algumas ainda falam da Travelfusion (lista em [`latam/rotas.md`](latam/rotas.md#onde-o-swagger-ainda-não-reflete-este-documento)).

---

## O que continua sendo escolha, não framework

| Decisão | Onde | Por quê |
|---|---|---|
| `AppError` **não** estende `HttpException` | `common/errors/` | O status vem do catálogo, não do construtor. Assim ninguém escolhe um status que o contrato não prevê |
| Um `ContractExceptionFilter` global | `common/filters/` | Só ele publica `providerError`, e sempre sanitizado. O cru vai para o log |
| `EnvelopeInterceptor` com escape | `common/interceptors/` | O envelope de três chaves é automático; `@RawResponse()` marca as duas rotas que têm forma própria (`/availability` e `/retrieve`) |
| Credencial em branco falha no client | `providers/latam/latam.client.ts` | Falha **antes da rede**, com 401 acionável — não como 403 do gateway virando "502, retente" |
| Configuração do client por construtor | `LATAM_CLIENT_CONFIG` | O dublê de teste aponta o client para outro lugar sem mexer em variável de ambiente global |
| Retry por mensagem, zero em escrita | `latam.client.ts` → `OPERATION_TIMEOUTS` | Repetir reserva, pagamento ou cancelamento pode duplicar o efeito |

---

## Estrutura

```
api/src/
  main.ts                    bootstrap, Swagger, ValidationPipe, filtro e interceptor globais
  config/                    env, timeouts, credenciais
  common/
    capabilities.ts          o que cada provedor faz — uma tabela por provedor
    correlation.middleware   x-correlation-id em toda requisição
    errors/                  catálogo (18 códigos) e AppError
    filters/                 corpo de erro do contrato
    guards/                  @Capability
    interceptors/            envelope + @RawResponse
    utils/                   money, offer-key, idade na data do voo
    xml/                     travessia tipada de XML, usada pelos dois provedores
  modules/
    flight/                  controller, DTOs, tipos canônicos, casos de uso  ← não sabe o que é XML
    providers/
      provider.types.ts      a fronteira FlightProvider
      provider.registry.ts   quem atende cada requisição, a partir de PROVIDERS
      latam/                 client OAuth2, comandos NDC, normalizadores, mapa de erro
      travelfusion/          client XML, comandos, normalizadores (arquivado)
    health/
api/test/
  contract.spec.ts           invariantes do contrato
  latam.spec.ts              normalizador contra a amostra real do portal
  latam.integration.spec.ts  provider inteiro contra o dublê do NDC (test/fixtures/)
```

A fronteira que importa: **o formato do provedor não sobe de `modules/providers/<nome>/`.** Um novo
provedor entra como pasta irmã, é registrado no `ProviderRegistry` e em `capabilities.ts`, e nada em
`modules/flight/` muda.

---

## Rodando

```bash
cd api
npm install
cp .env.example .env   # preencha LATAM_* e use PROVIDERS=latam
npm run dev            # porta 3010, Swagger em /docs
npm test               # 67 testes
npm run lint
```

Não existe modo mock para a LATAM: sem credencial, as rotas respondem **401 com a instrução** antes de
sair para a rede. O dublê do NDC só é alcançável pelos testes. (`npm run dev:mock` sobe o mock da
Travelfusion, que está arquivada.)
