# Resumo — Rodrigo

Construí uma API que traduz companhias aéreas para o contrato canônico de voo da Pass (17 rotas, `/availability` em stream), com a fronteira `FlightProvider` isolando cada provedor — Travelfusion (bloqueada por whitelist de IP) e **LATAM NDC**, integrada do zero contra o sandbox real deles.

Com a LATAM o fluxo roda ponta a ponta: busca (424 tarifas), tarifação, reserva, consulta, cancelamento, mapa de assentos, opcionais, **parcelamento em até 8x** e **pagamento** — a ordem sai de `OPENED` e vai a `CLOSED`.

A compra de assento/bagagem pós-emissão exigiu o `OrderChange` 24.1 (outro envelope, outra versão e outro catálogo de identificadores); o pedido passa em toda a validação da LATAM e para na autorização da cobrança, que o sandbox não concede nem por cartão nem por BSP.

Boa parte do trabalho foi descobrir o que a doc da LATAM não conta — casing de rota, ordem alfabética obrigatória dos elementos, campos exigidos pelo XSD e a posição real do CPF do titular — e cada descoberta virou nota no README e teste no duble.

Tem front completo (React + o design system da Pass) percorrendo os seis passos, 67 testes verdes, e o detalhamento em `docs/fluxo.md`.
