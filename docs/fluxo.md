# Como funciona, do começo ao fim

Este documento é para **qualquer pessoa** — não precisa saber programar. A ideia é que, depois de
ler, você consiga explicar para outra pessoa o que acontece em cada etapa e por quê.

---

## O problema, em uma frase

Cada companhia aérea vende passagem de um jeito diferente. Este projeto é o **tradutor**: por fora
ele fala uma língua só; por dentro, conversa com cada companhia na língua dela.

### A analogia do restaurante

Pense num restaurante com garçom.

| No restaurante | Aqui |
|---|---|
| Você pede "um prato do dia" | O site pede "voos de GRU para SCL dia 20" |
| O garçom leva o pedido à cozinha | Nossa API traduz e chama a LATAM |
| A cozinha fala outra língua e tem regras próprias | A LATAM fala **XML** com regras rígidas |
| O garçom volta com o prato montado | A API devolve os voos num formato único |

Quem está na mesa nunca precisa saber como a cozinha funciona. É esse o ponto: **quem consome a
nossa API não precisa saber nada de LATAM.** Se amanhã entrar outra companhia, o garçom aprende mais
uma língua e a mesa não muda.

---

## Três palavras que aparecem o tempo todo

**Oferta** — um voo com um preço e umas regras. O mesmo voo pode ter cinco ofertas diferentes
(mais barata sem bagagem, mais cara com remarcação, etc.). Uma oferta é o **pacote inteiro**: se for
ida e volta, os dois trechos vêm juntos e não podem ser separados.

**Localizador** — o código da sua reserva, tipo `LA9572806QCFT`. É por ele que a companhia
te reconhece daí em diante.

**Sandbox** — o ambiente de testes da LATAM. Voos de mentira, cartões de mentira, dinheiro de
mentira. Tudo aqui foi testado contra o sandbox de verdade deles, não contra simulação nossa.

---

## O caminho completo, passo a passo

São **cinco passos** na tela. Cada um é uma conversa separada com a companhia.

```
   1              2             3            4            5
Buscar   →    Escolher   →   Revisar   →  Passageiro →  Pagar
   │              │             │            │            │
AirShopping   (só tela)    OfferPrice   OrderCreate   OrderChange
                                                          │
                                        com a passagem na mão:
                                    bilhete · assento e bagagem · cancelar
```

Repare que **assento, bagagem e cancelamento não são passos**. Eles não têm ordem nem
"próximo": são coisas que você faz com a passagem depois de comprada, quando e se quiser. Colocá-los
como etapa daria a entender que o processo só termina depois de passar por eles.

A coluna de baixo é o nome que a LATAM dá a cada conversa. Você não precisa decorar — só saber
que **cada passo é uma pergunta nova para a companhia**, não um pedaço guardado do passo anterior.

---

### Passo 1 — Buscar

Você diz de onde, para onde e quando. A gente pergunta à LATAM quais voos existem.

**O que volta:** muita coisa. Uma busca GRU→SCL devolve **424 tarifas** para uns 94 voos — porque a
companhia manda uma oferta por "família tarifária" (a barata, a com bagagem, a flexível...).

**O que a tela faz com isso:** agrupa por voo. Senão você veria cinco cartões idênticos com preços
diferentes, o que confunde em vez de informar.

**Uma coisa que aprendemos apanhando:** se a gente pede "só executiva" **para a LATAM**, ela devolve
**zero** voos. Sem esse filtro, devolve 424 — sendo 12 de executiva. Então o filtro é aplicado
**depois**, do nosso lado. Pedir para a companhia filtrar escondia voo que existe.

---

### Passo 2 — Escolher

Puramente visual. Você clica no voo e na tarifa. Nada é enviado para a companhia ainda.

O único cuidado aqui: cada oferta carrega um **código opaco** (um texto enorme e sem sentido
aparente). Ele é copiado e devolvido intacto, nunca remontado ou interpretado. É a chave que a
companhia usa para saber exatamente de qual oferta você está falando.

---

### Passo 3 — Revisar

Agora sim a gente volta na companhia e pergunta: **"esse preço ainda vale?"**

Parece redundante, mas não é. Entre a busca e a escolha passaram segundos ou minutos, e passagem é
o tipo de coisa que muda de preço e acaba. Aqui podem acontecer três coisas:

- o preço confirma → segue;
- o preço mudou → a tela avisa e você decide;
- a tarifa acabou → alguém comprou os últimos lugares.

Nesta tela também aparecem **assentos e bagagens** disponíveis, só para você ver. Guarde esta
informação, ela volta depois do pagamento com uma pegadinha.

---

### Passo 4 — Passageiro

Nome, sobrenome, nascimento, documento, e-mail e telefone. Você clica em confirmar e a companhia
cria a reserva.

**O resultado é o localizador.** E aqui vem a parte que mais confunde quem é de fora:

> 🔴 **Reservar não é pagar.**

A reserva nasce **não paga**, com prazo (algo como "pague até amanhã às 4h"). Passado o prazo, a
companhia libera o assento sozinha. É por isso que reservar e pagar são dois passos: **são duas
operações diferentes na companhia**, e fingir que são uma só criaria uma mentira na tela.

---

### Passo 5 — Pagar

Cartão, titular (com CPF) e endereço de cobrança. Duas coisas valem explicar:

**As parcelas.** Antes de pagar dá para consultar em quantas vezes o cartão pode pagar. A pergunta
leva o número do cartão porque **só a operadora sabe** — depende da bandeira e do banco. Nos testes
voltou de 1x a 8x sem juros.

**O valor não sai do navegador.** Isto é importante e é uma decisão de segurança:

> A tela **não manda** quanto cobrar. A API pergunta à companhia quanto custa a reserva e cobra esse
> valor. Se quem chamou mandar um valor junto, ele é tratado como "é isto que eu espero pagar" — e
> se não bater, **nada é cobrado**.

O motivo é simples: um valor que sai do navegador é um valor que dá para mexer. E o erro só
apareceria no extrato de quem comprou.

Quando o pagamento passa, a reserva muda de estado — de "aberta" para "fechada" — e a passagem está
comprada.

**Sobre o cartão:** o número, o código de segurança e a validade **não são gravados em lugar
nenhum**, não aparecem em nenhum registro do sistema e não voltam na resposta. Eles existem durante
a chamada e somem com ela.

---

### Com a passagem na mão

Pago o voo, a mesma tela passa a mostrar três coisas — e nenhuma delas é obrigatória.

**Ver o bilhete.** Um comprovante com localizador, passageiro, voo, horário e valor pago, que dá
para imprimir ou salvar em PDF pelo próprio navegador. Ele **não** é montado com o que a tela
guardou: é montado com o que a companhia responde quando perguntamos de novo pela reserva. Um
comprovante que repete a nossa própria anotação mostraria o que a gente acha, não o que foi
registrado.

**Escolher assento e bagagem** — mesmo com a passagem já emitida. É cobrado à parte.

**Cancelar.** E aqui está o motivo de o botão viver *nesta* tela e não na anterior:

> Antes de pagar **não há o que cancelar**. A reserva não paga expira sozinha no prazo, e a
> companhia recusa o pedido dizendo que o estado é inválido. Um botão que sempre falha é pior do que
> botão nenhum.

Cancelar, aliás, são **duas operações diferentes**, e quem escolhe é a companhia: se ainda está
dentro da janela de arrependimento, ela **anula** o bilhete (o cupom fica marcado como anulado); se
já passou, ela calcula um **reembolso** e devolve o valor. A gente pergunta primeiro qual dos dois
é o caso, e só então cancela. Nos testes, o cancelamento voltou "anulação concluída" com
R$ 1.023,18 declarados como devolvidos.

#### E a compra de assento e bagagem

**A pegadinha que custou meio dia de investigação:**

O mesmo assento 12A tem **dois códigos diferentes**, dependendo de por onde você pergunta:

| Você pergunta... | ...e recebe um código | que serve para |
|---|---|---|
| pela **oferta** (antes de reservar) | `SEI\|...` | só **olhar**; ele morre quando a passagem é emitida |
| pela **reserva** (depois de pagar) | `SEAT_...` | **comprar** |

Usar o primeiro na hora de comprar fazia a LATAM responder um erro que parecia falar de outra coisa
("tipos de oferta misturados"). Descobrir que eram **dois catálogos diferentes**, e não um catálogo
com um problema, foi o que destravou.

É por isso que existem duas telas de assento no sistema: a do passo 3, que é **vitrine**, e a de
depois do pagamento, que é **loja**.

---

## Consultar, a qualquer momento

Além de tudo isso, dá para perguntar à companhia como está a reserva agora, só com o localizador.

Repare numa diferença que parece filosófica e não é: essa consulta **não lê o que a gente guardou**,
ela pergunta de novo. É a diferença entre "o que eu anotei" e "o que é verdade agora" — e é por isso
que o bilhete é montado a partir dela.

---

## Duas regras que valem para o sistema inteiro

### "Se não deu para confirmar, não diga que confirmou"

Quando a companhia responde "recebi, mas ainda estou processando", a tela diz exatamente isso —
"aguardando confirmação" — e não "confirmado". Parece detalhe, mas é a diferença entre a pessoa ir
para o aeroporto tranquila ou ir para o aeroporto sem passagem.

### "Cobrar duas vezes é o pior erro possível"

Toda operação que mexe em dinheiro é feita **uma vez só**. Se a resposta se perder no caminho, o
sistema **não tenta de novo** — porque a primeira tentativa pode ter dado certo e a gente só não
ficou sabendo. O caminho certo é consultar a reserva e ver o que aconteceu.

Operações de **leitura** (buscar, consultar) podem repetir à vontade, porque não gravam nada.
Operações de **escrita** (reservar, pagar, comprar) não repetem. Essa separação está no código, não
na disciplina de quem usa.

---

## O que funciona e o que não funciona

Tudo abaixo foi testado contra o sandbox real da LATAM.

| Etapa | Estado |
|---|---|
| Buscar voos | ✅ funciona — 424 tarifas numa busca |
| Confirmar preço | ✅ funciona |
| Reservar | ✅ funciona — devolve o localizador |
| Consultar reserva | ✅ funciona — traz passageiro, voo e valor |
| Cancelar | ✅ funciona na passagem paga — anulação confirmada e valor devolvido |
| Ver assentos e bagagens | ✅ funciona — 279 assentos com preço, 5 tipos de bagagem |
| **Pagar** | ✅ **funciona** — a reserva passa a paga |
| **Parcelar** | ✅ **funciona** — até 8x sem juros |
| **Ver/imprimir o bilhete** | ✅ funciona |
| **Comprar assento/bagagem** | ⚠️ o pedido está correto, o **sandbox recusa a cobrança** |

Sobre o último item, vale ser preciso, porque "não funciona" seria injusto e vago:

O pedido passa em **toda** a conferência da LATAM. A prova é que, se a gente manda o valor errado de
propósito, ela responde "esse valor não bate com o total" — ou seja, ela leu, entendeu e conferiu.
Mandando o valor certo, ela vai até a autorização da cobrança e é **aí** que recusa. O mesmo
acontece pagando por outro meio, que nem passa por cartão. Conclusão: o pedido está certo e o
ambiente de testes não autoriza cobranças de item extra.

Quando isso vira erro na tela, a mensagem é "o banco recusou, nada foi cobrado, tente outro
cartão" — e não um código técnico. Erro na tela é para quem está comprando; código técnico fica no
registro do sistema, para quem vai investigar.

---

## Como explicar isso em 30 segundos

> "É um tradutor entre quem vende passagem e quem compra. Por fora, uma língua só; por dentro, ele
> fala o dialeto de cada companhia. São cinco passos — buscar, confirmar o preço, reservar,
> passageiro e pagar — e reservar e pagar são separados porque são separados na companhia: a reserva
> nasce com prazo e sem pagamento. Depois de paga, a mesma tela deixa ver o bilhete, comprar assento
> e bagagem, e cancelar — cancelar só existe aí, porque antes de pagar não há o que cancelar. O valor
> da cobrança é sempre perguntado à companhia, nunca aceito de quem chama, e nada que mexe em
> dinheiro é tentado duas vezes."
