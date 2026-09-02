# Desafio — Integração de um Provedor de Voo

## O que é isto

Uma **especificação de contrato**: a descrição exata do que uma API de venda de passagens aéreas
recebe e do que ela devolve, em cada etapa.

Não é documentação de código. Não descreve como a API existente foi construída — descreve **o
formato das mensagens**. Você pode implementar em qualquer linguagem, com qualquer framework.

---

## O que você vai construir

Você recebeu três coisas:

1. **Estes documentos** — o contrato que a sua API precisa cumprir.
2. **A documentação do provedor** — a companhia aérea ou consolidador que você vai integrar.
3. **Credenciais de teste** desse provedor.

Sua entrega é **uma API própria** que fala com esse provedor e expõe as rotas descritas aqui.

### O critério de avaliação

**Fidelidade ao contrato.** Nome de rota, formato do pedido, formato da resposta, nome de cada campo,
o que vira `null`, os códigos de erro, e o comportamento em cada tipo de viagem — tudo isso precisa
bater com o que está escrito.

### Por que isso importa

O ponto do exercício não é fazer *uma* integração funcionar. É fazer a sua integração parecer,
**de fora**, idêntica a todas as outras.

Quem consome uma API dessas fala com dez companhias diferentes. Se cada integração devolver o preço
num formato, o localizador em outro lugar e o erro com outro nome, quem consome escreve dez códigos
diferentes — e erra em nove. O contrato existe para que ele escreva **um só**.

---

## O que NÃO faz parte

Estes assuntos foram cortados de propósito. Eles pertencem à plataforma que consome a API, não à
integração com a companhia. **Você não precisa implementar nada disso:**

- preço de revenda: markup, comissão, taxa de serviço, qualquer margem;
- autenticação das rotas e identificação de quem chama;
- contexto comercial do pedido (agência, cliente, centro de custo);
- múltiplas contas na mesma companhia e escolha de qual usar;
- cache, filas, processamento em segundo plano, banco de dados, deploy.

Onde um desses assuntos encosta no contrato, há uma nota de uma linha dizendo o que foi omitido.

**Sua API sempre devolve o valor cru do fornecedor** — o que a companhia cobra, sem nenhuma margem
por cima.

---

## Por onde começar

### Se você nunca trabalhou com passagens aéreas

Leia nesta ordem, sem pular:

1. **[`00-glossario.md`](00-glossario.md)** — o vocabulário. Segmento, trecho, tarifa, localizador,
   bilhete, EMD. Vinte minutos aqui economizam horas depois.
2. **[`01-convencoes.md`](01-convencoes.md)** — as regras que valem para todas as rotas.
3. **[`02-erros.md`](02-erros.md)** — como toda rota falha.
4. **[`03-availability.md`](03-availability.md)** e **[`04-availability-formatos.md`](04-availability-formatos.md)**
   — a busca. É a rota mais difícil; reserve tempo.

Depois disso, os outros documentos podem ser lidos na ordem em que você for implementando.

### Se você já conhece o domínio

Passe direto para `01`, `02` e `04`. O `04` é onde estão as decisões que ninguém acerta de primeira.

---

## Os documentos

| # | Arquivo | Assunto |
|---|---|---|
| 00 | [`00-glossario.md`](00-glossario.md) | O vocabulário do domínio |
| 01 | [`01-convencoes.md`](01-convencoes.md) | Envelope de resposta, política do `null`, objetos compartilhados |
| 02 | [`02-erros.md`](02-erros.md) | Formato de erro, catálogo de códigos, status HTTP |
| 03 | [`03-availability.md`](03-availability.md) | **Buscar** — pedido, stream de eventos, campos |
| 04 | [`04-availability-formatos.md`](04-availability-formatos.md) | **As variações da busca.** O documento mais importante |
| 05 | [`05-quote.md`](05-quote.md) | **Tarifar** — confirmar o preço firme |
| 06 | [`06-booking.md`](06-booking.md) | **Reservar** |
| 07 | [`07-cancel-booking.md`](07-cancel-booking.md) | **Cancelar a reserva** |
| 08 | [`08-retrieve.md`](08-retrieve.md) | **Consultar a reserva** |
| 09 | [`09-assentos.md`](09-assentos.md) | Mapa de assentos, marcar, remover |
| 10 | [`10-ancillaries.md`](10-ancillaries.md) | Bagagem e serviços extras |
| 11 | [`11-emissao.md`](11-emissao.md) | Formas de pagamento, parcelamento, **emitir** |
| 12 | [`12-cancelar-bilhete.md`](12-cancelar-bilhete.md) | Consultar e cancelar o bilhete |
| 13 | [`13-fare-rules-e-ping.md`](13-fare-rules-e-ping.md) | Regras tarifárias e teste de credencial |

---

## O fluxo, do começo ao fim

```
   ┌──────────────────────────────────────────────────────────┐
   │  1.  POST /availability            BUSCAR                │
   │      "quais voos existem de GRU para REC no dia 12?"     │
   │      resposta em stream: cada companhia responde no      │
   │      seu tempo                                           │
   └────────────────────────┬─────────────────────────────────┘
                            │  o cliente escolhe uma oferta
   ┌────────────────────────▼─────────────────────────────────┐
   │  2.  POST /quote                   TARIFAR               │
   │      "esta oferta ainda custa isso, agora?"              │
   └────────────────────────┬─────────────────────────────────┘
                            │
   ┌────────────────────────▼─────────────────────────────────┐
   │  3.  POST /booking                 RESERVAR              │
   │      segura os assentos. NÃO cobra nada ainda.           │
   │      ►► devolve o LOCALIZADOR — guarde-o                 │
   └────────────────────────┬─────────────────────────────────┘
                            │
      ┌─────────────────────┼─────────────────────┐
      │                     │                     │
   ┌──▼─────────────┐  ┌────▼──────────────┐  ┌───▼────────────┐
   │ 4. ASSENTOS    │  │ 5. EXTRAS         │  │ 6. CONSULTAR   │
   │  /seat-map     │  │  /ancillaries     │  │  /retrieve     │
   │  /mark-seats   │  │  /sell-ancillaries│  │                │
   │  /remove-seats │  │                   │  │  (a qualquer   │
   │                │  │                   │  │   momento)     │
   │ assento pago   │  │ bagagem extra     │  └────────────────┘
   │ fica PENDURADO │  │ fica PENDURADA    │
   └──────┬─────────┘  └─────────┬─────────┘
          │                      │
          └──────────┬───────────┘
                     │
   ┌─────────────────▼────────────────────────────────────────┐
   │  7.  POST /payment-options      quais formas de pagamento│
   │      POST /financing-options    parcelas (se for cartão) │
   │      POST /issue                EMITIR ◄── o dinheiro sai│
   │                                                          │
   │      a emissão cobra a passagem E tudo que ficou         │
   │      pendurado, de uma vez                               │
   └─────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┴─────────────┐
        │                          │
   ┌────▼──────────────┐  ┌────────▼──────────────┐
   │ /retrieve-eticket │  │ /cancel-eticket       │
   │  ver o bilhete    │  │  anular / reembolsar  │
   └───────────────────┘  └───────────────────────┘


   A qualquer momento:
      POST /cancel-booking    cancelar a reserva
      POST /fare-rules        ler as condições da tarifa
      POST /ping              testar se a credencial funciona
```

---

## As 17 rotas

Todas na raiz, sem prefixo de versão. Todas recebem e devolvem `application/json` — **exceto**
`/availability`, cuja resposta é um stream (`text/event-stream`).

| Método | Rota | Etapa |
|---|---|---|
| `POST` | `/availability` | buscar |
| `POST` | `/quote` | tarifar |
| `POST` | `/booking` | reservar |
| `POST` | `/cancel-booking` | cancelar a reserva |
| `POST` | `/retrieve` | consultar a reserva |
| `POST` | `/seat-map` | ler o mapa de assentos |
| `POST` | `/mark-seats` | marcar assento |
| `DELETE` | `/remove-seats` | remover assento — **com corpo** |
| `POST` | `/ancillaries` | listar bagagem e extras à venda |
| `POST` | `/sell-ancillaries` | vender ou pendurar o extra |
| `POST` | `/payment-options` | formas de pagamento da emissão |
| `POST` | `/financing-options` | parcelamento |
| `POST` | `/issue` | emitir |
| `POST` | `/retrieve-eticket` | consultar o bilhete |
| `POST` | `/cancel-eticket` | anular ou reembolsar o bilhete |
| `POST` | `/fare-rules` | texto completo da regra tarifária |
| `POST` | `/ping` | testar a credencial |

---

## Se você não conseguir fazer tudo

Implemente nesta ordem:

**1. A busca, correta** ([`03`](03-availability.md) e [`04`](04-availability-formatos.md)).

É a rota mais usada, a mais difícil e a que mais estraga o resto. Um formato errado aqui contamina
tarifar, reservar e emitir — e o erro só aparece no checkout.

**2. Tarifar e reservar** ([`05`](05-quote.md) e [`06`](06-booking.md)).

Sem elas não existe venda.

**3. O contrato de erro** ([`02`](02-erros.md)).

Um erro fora do padrão obriga quem consome a tratar a sua API como caso especial — exatamente o que
o exercício quer evitar.

**4. O resto**, na ordem em que o seu provedor suportar.

### Quando o seu provedor não oferece a operação

A resposta certa é **HTTP 501** com `error.code: "CAPABILITY_NOT_SUPPORTED"`.

Nunca invente um formato diferente sem avisar. Nunca devolva o retorno cru da companhia como
consolo. Detalhe em [`01-convencoes.md`](01-convencoes.md) §8.

---

## Como estes documentos são escritos

Cada rota segue a mesma estrutura:

1. **O que a rota faz** e quando é chamada
2. **Request** — tabela com caminho do campo, tipo, se é obrigatório, descrição e valores aceitos
3. **Response** — a mesma tabela, para o que sai
4. **Variações** — o que muda por tipo de viagem e por modelo de provedor
5. **Casos de borda** — o que responder quando dá errado, com status HTTP e código
6. **Exemplos completos** — pedido e resposta, prontos para copiar
7. **Checklist** — para conferir antes de considerar pronto

| Marca | Significa |
|---|---|
| 🔴 | **Armadilha.** Um ponto em que já se errou de verdade, com consequência real |
| ⚠️ | Aviso importante, mas não crítico |
| `código` | Nome exato de um campo, valor ou rota — copie como está |

Os exemplos usam o provedor fictício **`acme-air`**. Aeroportos, voos, valores e passageiros são
plausíveis, mas inventados.

Onde companhias reais divergem de um jeito que **muda o formato da resposta**, os documentos
descrevem a regra de forma estrutural — *"provedor que vende pacote"* × *"provedor que vende trecho
solto"* — sem citar nomes. **Classifique o seu** e siga o caminho correspondente.
