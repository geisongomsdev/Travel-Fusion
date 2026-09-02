# 00 — Glossário

Leia isto antes de tudo. O mundo de passagens aéreas tem um vocabulário próprio, e ele aparece em
todos os outros documentos. Aqui está o significado de cada termo, em português simples.

Você não precisa decorar. Volte aqui quando encontrar uma palavra que não conhece.

---

## As peças de uma viagem

Estas quatro palavras se parecem e significam coisas diferentes. Confundi-las é a causa mais comum
de erro nesta integração.

### Segmento — um voo

Um voo, de um aeroporto a outro, sem trocar de avião.

```
GRU ──────────────► REC
   voo 1234, direto
```

### Trecho — um pedaço da viagem

O caminho de A até B, do jeito que o cliente pensa: *"minha ida"*, *"minha volta"*, *"a segunda
perna do meu roteiro"*.

Um trecho pode ter **um** segmento (voo direto) ou **vários** (com conexão):

```
trecho GRU → REC, direto:
   GRU ──────────────► REC              1 segmento

trecho GRU → REC, com conexão em BSB:
   GRU ────► BSB ────► REC              2 segmentos
        voo 1234   voo 5678
```

Nos documentos, "trecho" e "perna" são sinônimos.

### Itinerário — a viagem inteira

Todos os trechos juntos. Numa ida-e-volta, o itinerário tem 2 trechos; num roteiro de 3 cidades,
tem 3.

### Oferta — o que está à venda

Um itinerário **com preço**. É o que aparece como um card na tela de resultados.

---

## Os três tipos de viagem

| Nome | Em português | Exemplo |
|---|---|---|
| **`oneway`** | Só ida | São Paulo → Recife |
| **`roundtrip`** | Ida e volta | São Paulo → Recife → São Paulo |
| **`multicity`** | Multidestino, ou "múltiplos trechos" | Porto Alegre → São Paulo → Salvador → Recife |

Nos documentos você vai ver as abreviações **OW** (oneway), **RT** (roundtrip) e **MC** (multicity).

---

## Códigos IATA

A IATA é a associação internacional das companhias aéreas. Ela mantém dois catálogos de código que
aparecem o tempo todo:

| Tipo | Formato | Exemplos |
|---|---|---|
| **Aeroporto** | 3 letras | `GRU` (Guarulhos), `REC` (Recife), `POA` (Porto Alegre), `SSA` (Salvador) |
| **Companhia aérea** | 2 caracteres | `G3`, `AD`, `LA` |

Nos exemplos deste material, as companhias são fictícias (`acme-air`, `nova-air`), mas os aeroportos
são reais.

---

## Tarifa: os quatro nomes que se confundem

Uma mesma passagem tem quatro identificadores diferentes, e cada um responde a uma pergunta.

### Família tarifária (`family`, `familyCode`)

O **nome comercial** do que você está comprando. É o que aparece na tela para o cliente:

> Light · Plus · Max · Econômica Promocional · Executiva Flex

Famílias diferentes no **mesmo voo** têm preços e regras diferentes: a mais barata costuma não ter
bagagem despachada nem remarcação; a mais cara tem.

### Base tarifária (`fareCode`, ou *fare basis*)

Um código interno da companhia que identifica **as regras exatas** daquela tarifa:

```
ONHMAG2J
```

Não tente decodificar. Cada companhia tem o seu esquema. Ele serve para: (a) a companhia reconhecer
qual tarifa você quer, e (b) consultar o texto completo das regras.

### Classe de reserva / RBD (`bookingCode`, `bookingClass`)

**Uma letra.** Diz em qual "balde de assentos" a companhia vai alocar o passageiro.

```
Y · O · P · J · M
```

🔴 **A classe de reserva NÃO é a cabine.** Um `J` costuma ser executiva e um `Y` econômica — mas não
existe mapa oficial, e cada companhia usa as letras do seu jeito. **Nunca deduza a cabine a partir
da letra.**

### Cabine (`cabin`)

Onde a pessoa **senta fisicamente**. Só quatro valores, sempre:

```
economy | premium_economy | business | first
```

Isto é o que o cliente entende como "classe do voo".

---

## Preço: as partes de um valor

Um preço de passagem não é um número só. Ele se decompõe assim:

```
   base            a tarifa em si, o que a companhia cobra pelo assento
 + taxes           impostos e taxas obrigatórias
 + fees            taxa de distribuição da companhia (ver abaixo)
 ─────────
 = total           o que o cliente paga
```

| Termo | O que é |
|---|---|
| **`base`** | A tarifa pura. É sobre ela que as regras e as multas incidem |
| **`taxes.boarding`** | **Taxa de embarque** — cobrada pelo aeroporto, repassada pela companhia |
| **`taxes.service`, `.fuel`, `.baggage`** | Outras taxas, quando a companhia as discrimina |
| **`fees`** | **Taxa de distribuição.** Algumas companhias cobram uma taxa por venda feita fora do site delas. Está **dentro** do total e **fora** da base |

🔴 **`fees` não é a taxa de embarque.** São coisas diferentes, e somá-las duas vezes é um erro
frequente.

---

## Reserva, bilhete e documento extra

Três coisas diferentes, criadas em três momentos diferentes.

```
   1. RESERVA          2. BILHETE            3. DOCUMENTO EXTRA
      (PNR)               (e-ticket)            (EMD)

   assentos guardados  a passagem paga       bagagem, assento pago
   dinheiro não saiu   dinheiro saiu         cobrados à parte
   pode expirar        vale para voar        número e status próprios
```

### Reserva (*booking*) — e o localizador (**PNR**)

Criar a reserva **segura os assentos**, mas não paga nada. A companhia devolve um **localizador**:
um código curto, geralmente 6 letras e números.

```
ABC123
```

**PNR** significa *Passenger Name Record*. Na prática, "PNR" e "localizador" são a mesma coisa, e
neste material usamos **localizador**.

Uma reserva não paga costuma ter **prazo**: se ninguém emitir até lá, a companhia cancela sozinha.
Isso se chama estar **"em espera"** (ou *hold*).

### Bilhete (*e-ticket*)

O documento que vale para voar. Nasce quando você **emite**, e emitir é quando o dinheiro sai.

O número tem 13 dígitos, e os 3 primeiros identificam a companhia:

```
9990012345678
```

### Documento extra (**EMD**)

**EMD** significa *Electronic Miscellaneous Document*. É o "bilhete" de tudo que **não é o voo**:
bagagem despachada comprada à parte, assento pago, refeição especial.

🔴 **Ele é independente do bilhete.** Tem numeração própria, status próprio, e **cancelar o bilhete
não cancela o EMD.** Isso aparece em vários pontos dos documentos porque tem consequência real: um
cliente que cancela a passagem pode continuar tendo pago pela bagagem.

---

## As operações do fluxo

| Termo | O que acontece | Dinheiro sai? |
|---|---|---|
| **Buscar** | Perguntar quais voos existem e por quanto | não |
| **Tarifar** (*quote*) | Perguntar à companhia o preço **firme** de uma oferta específica, agora | não |
| **Reservar** (*book*) | Segurar os assentos. Devolve o **localizador** | não |
| **Emitir** (*issue*) | Transformar a reserva em bilhete | **sim** |
| **Anular** (*void*) | Desfazer a emissão como se nunca tivesse acontecido. Só dentro de uma janela curta — normalmente o mesmo dia | não (nada foi cobrado de fato) |
| **Reembolsar** (*refund*) | Devolver o dinheiro, com multa e prazo | sim, no sentido inverso |
| **Pendurar** | Anexar um serviço extra à reserva **sem cobrar**. A cobrança sai na emissão | não |

### Por que tarifar existe

O resultado da busca é uma **fotografia**: os preços mudam, os assentos acabam. Tarifar é perguntar
de novo, agora, e receber a resposta que vale. Sem isso, o cliente vê um preço na tela e paga outro.

### Gate de re-tarifa

Uma conferência automática antes de reservar ou emitir: *"o preço ainda é o que eu mostrei?"*

- Subiu → a operação é **bloqueada** (o cliente precisa ser avisado).
- Caiu → segue normalmente.
- A tarifa sumiu → outro erro, com outra mensagem.

---

## Como a companhia vende: pacote × trecho solto

Esta distinção decide o formato da resposta da busca, e é o assunto do documento
[`04`](04-availability-formatos.md).

### Pacote

A companhia **declara** que a ida e a volta (ou os N trechos) formam **uma oferta só**, com um preço
só. Ela diz o que combina com o quê.

```
┌─────────────────────────────────┐
│  PACOTE — R$ 1.280,45           │
│    ida:   GRU → REC             │
│    volta: REC → GRU             │
│  uma tarifa cobre as duas       │
└─────────────────────────────────┘
```

### Trecho solto

A companhia vende **cada voo separadamente**, com preço próprio, e não diz nada sobre combinações.

```
┌──────────────────┐   ┌──────────────────┐
│ IDA — R$ 656,20  │   │ VOLTA — R$ 618,20│
│ GRU → REC        │   │ REC → GRU        │
│ tarifa própria   │   │ tarifa própria   │
└──────────────────┘   └──────────────────┘
```

🔴 **Nunca invente uma combinação que a companhia não vendeu.** Numa medição real, dois de cada três
pares "montados por lógica" eram recusados na hora de reservar.

---

## Outros termos que aparecem

| Termo | Significado |
|---|---|
| **Consolidador** | Empresa que revende passagens de várias companhias. Do seu ponto de vista, é "um provedor" como qualquer outro |
| **GDS** | *Global Distribution System* — as grandes centrais que intermediam a venda aérea |
| **Codeshare** | Voo vendido por uma companhia e **operado** por outra. Por isso existe o campo `company.operating` |
| **Conexão** | Trocar de avião no meio do trecho |
| **Escala técnica** | O avião pousa, mas o passageiro continua no mesmo voo. Conta como parada, não como conexão |
| **Chave opaca** | Um valor que só o provedor entende. Você copia de onde veio e cola onde vai, sem interpretar. Ver [`01`](01-convencoes.md) §4 |
| **SSE** (*Server-Sent Events*) | Um formato de resposta HTTP em que o servidor manda vários pedaços ao longo do tempo, em vez de um JSON único no fim. A busca usa isso porque cada companhia responde no seu tempo |
| **Fidelidade** | Programa de pontos/milhas. O número do cartão vai junto com o passageiro na reserva |
| **Bebê de colo** (*infant*) | Criança de menos de 2 anos que viaja no colo de um adulto, sem assento próprio |

---

## Convenções de escrita destes documentos

| Marca | Significa |
|---|---|
| 🔴 | **Armadilha.** Um ponto em que já se errou de verdade, com consequência real |
| ⚠️ | Aviso importante, mas não crítico |
| `código` | Nome exato de um campo, valor ou rota — copie como está |
| **negrito** | A parte da frase que você não pode perder |

Os exemplos usam o provedor fictício **`acme-air`** (e **`nova-air`**, quando precisa de um segundo).
Substitua pelo nome do seu.
