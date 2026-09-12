# Resumo — Rodrigo

Construí uma API que traduz companhias aéreas para o contrato canônico de voo da Pass (17 rotas, `/availability` em stream), com a fronteira `FlightProvider` isolando cada provedor — Travelfusion (bloqueada por whitelist de IP, arquivada) e **LATAM NDC**, integrada do zero contra o sandbox real deles.

Com a LATAM o fluxo roda ponta a ponta: busca (424 tarifas), tarifação, reserva, consulta, mapa de assentos, opcionais, **parcelamento em até 8x**, **pagamento** (a ordem sai de `OPENED` e vai a `CLOSED`) e **cancelamento** da passagem paga — que na LATAM são duas operações, anulação ou reembolso, e quem escolhe é ela.

Depois disso, pedido e resposta das 17 rotas foram **padronizados no vocabulário dos modelos canônicos** (`models/`): toda rota que muta carrega o bloco com o nome da operação, a chave de venda passou a ser `fares[].fareId` (a tarifa, não o trecho — um voo tem várias famílias e cada uma é uma venda), o aeroporto virou `iata`/`city`/`terminal`/`coordinates`, a duração é publicada em minutos, a bagagem separa `hand` de `hold` (uma tarifa LIGHT inclui mão e não inclui despacho — o booleano único de antes dizia o contrário) e `committed`/`confirmed` passaram a valer em toda mutação. Sumiram duas exceções que obrigavam quem consome a escrever caminho especial: o envelope próprio do `/retrieve` e o `data.data` do `/cancel-booking`.

A compra de assento/bagagem pós-emissão exigiu o `OrderChange` 24.1 (outro envelope, outra versão e outro catálogo de identificadores); o pedido passa em toda a validação da LATAM e para na autorização da cobrança, que o sandbox não concede nem por cartão nem por BSP.

Boa parte do trabalho foi descobrir o que a doc da LATAM não conta — casing de rota, ordem alfabética obrigatória dos elementos, campos exigidos pelo XSD e a posição real do CPF do titular — e cada descoberta virou nota no README e teste no duble.

Tem front completo (React + o design system da Pass) percorrendo os cinco passos, com bilhete imprimível, 80 testes verdes. O fluxo explicado sem código está em `docs/latam/fluxo.md`, e a referência de cada rota em `docs/latam/rotas.md`.
