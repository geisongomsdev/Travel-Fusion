# Travelfusion — arquivado

Material da primeira integração, com a **Travelfusion Direct Connect XML API**. Fica aqui como
histórico e para quando o bloqueio for resolvido. O foco atual é a LATAM
([`../latam/`](../latam/)).

## Por que parou

A Travelfusion só responde a partir de **IP liberado** por eles. O `Login` passa, mas todo comando
seguinte volta `4-3448 Login ID not found`. A liberação depende do suporte da Travelfusion (envio da
lista de IPs e dos logs XML pedidos no Welcome Pack), e não de código.

## O que continua valendo

- O código está em `api/src/modules/providers/travelfusion/` e implementa a mesma interface
  `FlightProvider` da LATAM.
- Para desligar: `PROVIDERS=latam` no `.env`. Para religar: `PROVIDERS=latam,travelfusion`.
- `npm run mock` / `npm run dev:mock` sobem o mock XML da Travelfusion, sem credencial.
- As capacidades declaradas estão em `api/src/common/capabilities.ts` (`TRAVELFUSION_CAPABILITIES`).

## Os documentos

⚠️ Escritos **antes** da migração para NestJS e antes da LATAM. Caminhos como `constants/*.js`,
`preHandler` do Fastify ou `api/tests/mock-travelfusion.js` descrevem a primeira versão. As decisões
de integração continuam corretas para a Travelfusion.

| Arquivo | Conteúdo |
|---|---|
| [`mapeamento.md`](mapeamento.md) | as 17 rotas ↔ comandos Travelfusion, timeouts da spec, mapa de erro e de status |
| [`decisoes.md`](decisoes.md) | onde contrato e Travelfusion não se encaixam: `/booking` × `/issue`, bagagem antes da reserva, polling como stream |
| [`arquitetura.md`](arquitetura.md) | camadas da primeira versão e o mock que reproduz o polling incremental |
| [`entrega.md`](entrega.md) | o que foi entregue, pendências externas (IP, checklists, auditoria) e de código |
| `suporte/` | pacotes preparados para o suporte. `envio-com-credenciais/` fica **fora do git** (`.gitignore`) |
