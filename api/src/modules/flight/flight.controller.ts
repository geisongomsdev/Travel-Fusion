import {
  Body, Controller, Delete, HttpCode, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Capability, CapabilityGuard } from '../../common/guards/capability.guard';
import { Operation, RawResponse } from '../../common/interceptors/envelope.interceptor';
import { notSupported } from '../../common/errors/app-error';
import { RequestContext } from '../providers/provider.types';
import { AvailabilityDto } from './dto/availability.dto';
import {
  AncillariesDto, CancelBookingDto, CancelEticketDto, CreateBookingDto, FareRulesDto,
  FinancingOptionsDto, IssueDto, MarkSeatsDto, PaymentOptionsDto,
  QuoteDto, RemoveSeatsDto, RetrieveDto, RetrieveEticketDto, SeatMapDto, SellAncillariesDto,
} from './dto/booking.dto';
import { PingDto } from './dto/ping.dto';
import { AvailabilityService } from './use-cases/availability.service';
import { BookingService } from './use-cases/booking.service';
import { FareRulesService } from './use-cases/fare-rules.service';
import { PingService } from './use-cases/ping.service';
import { QuoteService } from './use-cases/quote.service';
import { RetrieveService } from './use-cases/retrieve.service';
import { CancelBookingService } from './use-cases/cancel-booking.service';
import { SeatMapService } from './use-cases/seat-map.service';
import { AncillariesService } from './use-cases/ancillaries.service';
import { PaymentService } from './use-cases/payment.service';
import { SellAncillariesService } from './use-cases/sell-ancillaries.service';
import { ERROR_RESPONSES, NOT_SUPPORTED_ROUTES } from './flight.swagger';

type FlightRequest = Request & { correlationId?: string };

const contextOf = (request: FlightRequest): RequestContext => ({
  correlationId: request.correlationId,
  endUserIp: (request.headers['x-forwarded-for'] as string) ?? request.ip,
  endUserAgent: request.headers['user-agent'],
});

/**
 * 🔴 Toda rota devolve **200**, exceto o `/booking` (201) — 01-convencoes.md §1.
 * O `@Post` do Nest responde 201 por padrão, por isso cada rota declara o seu.
 */
@ApiTags('Voo')
@Controller()
@UseGuards(CapabilityGuard)
export class FlightController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly quote: QuoteService,
    private readonly booking: BookingService,
    private readonly retrieve: RetrieveService,
    private readonly cancel: CancelBookingService,
    private readonly seats: SeatMapService,
    private readonly extras: AncillariesService,
    private readonly payment: PaymentService,
    private readonly postSale: SellAncillariesService,
    private readonly fareRules: FareRulesService,
    private readonly pingProbe: PingService,
  ) {}

  @Post('availability')
  @Capability('availability')
  @RawResponse()
  @ApiTags('Busca')
  @ApiOperation({
    summary: 'Buscar voos',
    description: [
      'Resposta em **stream** (`text/event-stream`), não no envelope padrão.',
      '',
      'Eventos, em ordem: `start` → (`provider_success` | `provider_error`) → `filters` → `complete`.',
      'Se a busca inteira morrer: `fatal_error`. `complete` e `fatal_error` encerram a conexão.',
      '',
      '**"Sem voos" NÃO é erro**: chega como `provider_error` com `data.error.code = "NO_FLIGHTS"`',
      'e **sem** `canonicalCode`. Discrimine por `canonicalCode`, nunca por `type`.',
      '',
      'O pedido usa `departure`/`arrival` em ida e ida-e-volta — a data da volta vai em',
      '`arrival.date` — e `segments[]` no multidestino, com a lista COMPLETA de trechos.',
      '',
      '🔴 A chave de venda é `fares[].fareId`, não `identifier`. O `identifier` do trecho é a',
      'journey da companhia; quem segue para tarifar e reservar é a tarifa.',
    ].join('\n'),
  })
  @ApiBody({ type: AvailabilityDto })
  @ApiResponse({ status: 200, description: 'Stream de eventos SSE.' })
  async search(@Body() dto: AvailabilityDto, @Req() request: FlightRequest, @Res() response: Response): Promise<void> {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Escreve cada evento assim que ele existe: montar tudo antes de responder
    // anularia o propósito do stream.
    for await (const event of this.availability.search(dto, contextOf(request))) {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    response.end();
  }

  @Post('quote')
  @HttpCode(200)
  @Capability('quote')
  @Operation('quote')
  @ApiTags('Venda')
  @ApiOperation({
    summary: 'Tarifar — confirmar o preço firme',
    description: [
      'Mapeia para `OfferPrice`. Contrato: 05-quote.md.',
      '',
      'O corpo leva `provider`, `options` e o bloco `quote` com `type`, `offers[]` e',
      '`passengers`. Na LATAM quem decide a venda é o `fareId` (ou `fare.fareId`): o',
      '`journeyKey` sozinho não abre a oferta.',
      '',
      '🔴 Sem `quote.passengers` é 400: não há default, e `adults: 1` tarifaria uma venda de',
      'três adultos pelo preço de um.',
      '',
      'A resposta é escalar — `rawTotal`, `base`, `taxes`, com `base + taxes == rawTotal` —,',
      'mais as extensões `familyCode`, `family` e `requiredParameters`.',
      '',
      'O cenário pós-reserva (`quote.booking`) responde **501**: a companhia só devolve o total',
      'de uma ordem, e o invariante não fecha com metade dos números.',
    ].join('\n'),
  })
  @ApiBody({ type: QuoteDto })
  @ApiResponse({ status: 200, description: 'Preço firme e parâmetros exigidos pelo provedor.' })
  async tarifar(@Body() dto: QuoteDto, @Req() request: FlightRequest) {
    return this.quote.execute(dto, contextOf(request));
  }

  @Post('booking')
  @HttpCode(201)
  @Capability('booking')
  @Operation('createBooking')
  @ApiTags('Venda')
  @ApiOperation({
    summary: 'Reservar',
    description: [
      'Mapeia para `OrderCreate`. Segura o assento e **não cobra nada**. Contrato: 06-booking.md.',
      '',
      'Os trechos (`segments`/`itinerary`) e a tarifa (`fares[]`) vêm da busca, copiados como',
      'vieram. Quem decide a venda é `selectedFareId`, que tem que existir em `fares[]`.',
      '',
      '🔴 `people[].identifier` é o PaxID com que a oferta foi tarifada (`ADT_1`, `CHD_1`):',
      'é ele que amarra tarifa, assento, bagagem e bilhete ao passageiro certo.',
      '',
      '🔴 Com `displayedTotal`, a tarifa é reconferida antes de reservar: preço maior é 409',
      '`FARE_PRICE_CHANGED`, e nada é reservado.',
      '',
      'A resposta traz `locator`, `status`, `bookingToken` e `orderIdentifier` no topo.',
      '`committed` ≠ `confirmed`: status não-final não autoriza re-reservar — a reserva',
      'pode existir do outro lado.',
      '',
      'Devolve **HTTP 201**; todas as outras rotas devolvem 200.',
    ].join('\n'),
  })
  @ApiBody({ type: CreateBookingDto })
  @ApiResponse({ status: 201, description: 'Reserva criada. Guarde o locator.' })
  async reservar(@Body() dto: CreateBookingDto, @Req() request: FlightRequest) {
    return this.booking.execute(dto, contextOf(request));
  }

  @Post('retrieve')
  @HttpCode(200)
  @Capability('retrieve')
  @RawResponse()
  @ApiTags('Pós-venda')
  @ApiOperation({
    summary: 'Consultar a reserva',
    description: [
      'Mapeia para `OrderRetrieve`. **Sem cache** — toda chamada vai à companhia,',
      'porque o ponto da rota é saber o estado *agora*. Contrato: 08-retrieve.md.',
      '',
      'É a ÚNICA rota com envelope próprio, como o contrato define: `success`, `connector`,',
      '`booking`, `status: "found"`, `message` e `data` — sem `meta`.',
      '',
      '🔴 `segments` (ida, ida-e-volta) e `itinerary` (multidestino) são mutuamente',
      'exclusivos. Num `oneway`, `segments.return` é `[]`.',
      '',
      'Reserva cancelada é **200**; localizador inexistente é **404**.',
    ].join('\n'),
  })
  @ApiBody({ type: RetrieveDto })
  @ApiResponse({ status: 200, description: 'Reserva encontrada.' })
  async consultar(@Body() dto: RetrieveDto, @Req() request: FlightRequest) {
    return this.retrieve.execute(dto, contextOf(request));
  }

  @Post('fare-rules')
  @HttpCode(200)
  @Capability('fareRules')
  @Operation('fareRules')
  @ApiTags('Pós-venda')
  @ApiOperation({
    summary: 'Texto completo da regra tarifária',
    description: [
      'Read-only: não tarifa, não reserva, não altera nada.',
      '',
      'A `key` é **opaca** e vem de `fares[].rules.key` do `/availability`. Quem consome',
      'devolve exatamente como recebeu — nunca monta, nunca interpreta.',
      '',
      '🔴 Chave que não abre é erro de **quem chamou**: 400, e a chamada nem vai à companhia.',
      '',
      'A LATAM responde **501**: a NDC devolve penalidade estruturada, não o texto integral',
      'da tarifa. Publicar aquilo como "condições" seria dizer que é o que não é.',
    ].join('\n'),
  })
  @ApiBody({ type: FareRulesDto })
  async regras(@Body() dto: FareRulesDto, @Req() request: FlightRequest) {
    return this.fareRules.execute(dto, contextOf(request));
  }

  @Post('ping')
  @HttpCode(200)
  @Capability('ping')
  @Operation('ping')
  @ApiTags('Diagnóstico')
  @ApiOperation({
    summary: 'Testar a credencial',
    description: [
      'Na LATAM, o próprio OAuth2 prova a credencial: um token novo só sai com Key e',
      'Secret válidos.',
      '',
      '🔴 A sonda é sempre real — servir um token do cache responderia "ok" sem falar com',
      'a companhia. Quem protege o limite é o teto de **10 tentativas por minuto** (429).',
      '',
      '`verification.scope` é `connection`: valida a credencial da integração, não as',
      'chaves enviadas em `ping.credentials`.',
    ].join('\n'),
  })
  async ping(@Body() dto: PingDto, @Req() request: FlightRequest) {
    return this.pingProbe.execute(dto, contextOf(request));
  }

  @Post('cancel-booking')
  @HttpCode(200)
  @Capability('cancelBooking')
  @Operation('cancelBooking')
  @ApiTags('Pós-venda')
  @ApiOperation({
    summary: 'Cancelar a reserva',
    description: [
      '🔴 **Mutação não idempotente**, e roda **sem retry**. Se a resposta se perder, o caminho',
      'é o `/retrieve` — nunca cancelar de novo, porque a primeira chamada pode ter valido.',
      '',
      'Na LATAM são dois passos: `OrderReshop` calcula o reembolso e `OrderCancel` executa,',
      'porque o segundo exige `ExpectedRefundAmount`. O reshop é read-only — se ele falhar,',
      'nada foi cancelado.',
      '',
      '🔴 `outcome` NÃO é o status: `VOID` anula o bilhete e não devolve dinheiro, `REFUND`',
      'devolve. Quem atende o passageiro precisa dos dois para explicar o que aconteceu.',
      '',
      '🔴 `eticketsCancelled` é `false` até o CUPOM provar o contrário — o `OrderCancelRS`',
      'de sucesso não diz nada sobre documento.',
      '',
      '`status: "PENDING"` significa **aceito, ainda não fechado**. Não é falha, e não',
      'autoriza tentar de novo: consulte o `/retrieve`.',
    ].join('\n'),
  })
  @ApiBody({ type: CancelBookingDto })
  async cancelBooking(@Body() dto: CancelBookingDto, @Req() request: FlightRequest) {
    return this.cancel.execute(dto, contextOf(request));
  }

  @Post('seat-map')
  @HttpCode(200)
  @Capability('seatMap')
  @Operation('seatMap')
  @ApiTags('Assentos')
  @ApiOperation({
    summary: 'Mapa de assentos',
    description: [
      'Read-only: não marca nada. Contrato: 09-assentos.md §1.',
      '',
      'Endereçado pela RESERVA, em `seatMap.booking` — é o mapa de onde saem os',
      '`passengerId`, `segmentId` e `seat` que o /mark-seats aceita.',
      '',
      '**Extensão declarada:** `seatMap.fareId` devolve o mapa da OFERTA, antes de reservar',
      '(`locator: null`). Na LATAM a escolha costuma acontecer ali, mas as chaves desse mapa',
      'morrem na emissão.',
      '',
      'Cada assento traz as 12 chaves do contrato mais `key`, a chave de venda — que permite',
      'comprar assento e bagagem num /sell-ancillaries só.',
      '',
      'Mapa ilegível degrada para `segments: []`, nunca 500: a leitura degrada, a mutação falha.',
    ].join('\n'),
  })
  @ApiBody({ type: SeatMapDto })
  async seatMap(@Body() dto: SeatMapDto, @Req() request: FlightRequest) {
    return this.seats.execute(dto, contextOf(request));
  }

  @Post('mark-seats')
  @HttpCode(200)
  @Capability('markSeats')
  @Operation('assignSeats')
  @ApiTags('Assentos')
  @ApiOperation({
    summary: 'Marcar assentos na reserva emitida',
    description: [
      '🔴 **Cobra o cartão.** Não é idempotente e não tem retry: na LATAM marcar e pagar o',
      'assento são um pedido só, e não existe segurar o lugar sem pagar.',
      '',
      'O assento é endereçado pelo DESIGNADOR (`12A`) mais o trecho — o que a pessoa',
      'escolheu na tela. A tradução para a chave que a companhia vende acontece do lado de',
      'cá, relendo o mapa da própria reserva.',
      '',
      '🔴 Assento fora do mapa, designador malformado ou passageiro que a reserva não tem são',
      '**422 `BUSINESS_RULE_VIOLATION`** ANTES da rede: melhor não oferecer do que oferecer',
      'e falhar depois.',
      '',
      'A resposta traz um item em `seats[]` por assento PEDIDO, com o `segmentId` ecoado do',
      'pedido. `meta.operation` é `assignSeats`. Contrato: 09-assentos.md §2.',
    ].join('\n'),
  })
  @ApiBody({ type: MarkSeatsDto })
  async markSeats(@Body() dto: MarkSeatsDto, @Req() request: FlightRequest) {
    return this.postSale.markSeats(dto, contextOf(request));
  }

  /** DELETE com corpo — é assim no contrato. */
  @Delete('remove-seats')
  @Capability('removeSeats')
  @ApiTags('Não suportado pelo provedor')
  @ApiOperation(NOT_SUPPORTED_ROUTES.removeSeats)
  @ApiBody({ type: RemoveSeatsDto })
  removeSeats(@Body() _dto: RemoveSeatsDto): never { throw notSupported('removeSeats'); }

  @Post('ancillaries')
  @HttpCode(200)
  @Capability('ancillaries')
  @Operation('ancillaries')
  @ApiTags('Assentos')
  @ApiOperation({
    summary: 'Opcionais vendidos à parte',
    description: [
      'Read-only. Endereçado pela RESERVA, em `ancillaries.booking`. Contrato: 10-ancillaries.md §1.',
      '',
      '**Extensão declarada:** `ancillaries.fareId` devolve o catálogo da OFERTA, antes de',
      'reservar — mesma razão do /seat-map.',
      '',
      'Devolve `passengers`, `segments` e `offers`. A `offers[].key` vai literalmente para',
      '`sellAncillaries.items[].key`.',
      '',
      '🔴 O filtro `type` é ESTRITO: oferta sem tipo declarado sai. Já oferta sem',
      '`passengerId`/`segmentId` vale para TODOS — `null` ali é "a viagem inteira".',
    ].join('\n'),
  })
  @ApiBody({ type: AncillariesDto })
  async ancillaries(@Body() dto: AncillariesDto, @Req() request: FlightRequest) {
    return this.extras.execute(dto, contextOf(request));
  }

  @Post('sell-ancillaries')
  @HttpCode(200)
  @Capability('sellAncillaries')
  @Operation('sellAncillaries')
  @ApiTags('Assentos')
  @ApiOperation({
    summary: 'Comprar assento e/ou bagagem na reserva emitida',
    description: [
      '🔴 **Cobra o cartão. Não é idempotente e não tem retry.** Se a resposta se perder, o',
      'caminho é o /retrieve — nunca repetir o pedido.',
      '',
      'O valor cobrado NÃO vem do corpo: é somado a partir do catálogo da própria reserva.',
      'Quem chama escolhe os itens; o preço é da companhia.',
      '',
      'Cada item usa a `key` opaca vinda do catálogo POR RESERVA, devolvida intacta.',
      '',
      'Exige reserva EMITIDA. A LATAM cobra na hora: cartão ausente com soma maior que zero é',
      '**422 `BUSINESS_RULE_VIOLATION`**. Só assento cortesia (soma zero) dispensa o cartão.',
      '',
      'A resposta traz um item por item PEDIDO, com `status` (`booked` | `issued` | `failed`)',
      'e `documentNumber`. Nenhum item aceito é erro, não 200. Contrato: 10-ancillaries.md §3.',
    ].join('\n'),
  })
  @ApiBody({ type: SellAncillariesDto })
  async sellAncillaries(@Body() dto: SellAncillariesDto, @Req() request: FlightRequest) {
    return this.postSale.execute(dto, contextOf(request));
  }

  @Post('payment-options')
  @HttpCode(200)
  @Capability('paymentOptions')
  @ApiTags('Não suportado pelo provedor')
  @ApiOperation(NOT_SUPPORTED_ROUTES.paymentOptions)
  @ApiBody({ type: PaymentOptionsDto })
  paymentOptions(@Body() _dto: PaymentOptionsDto): never { throw notSupported('paymentOptions'); }

  @Post('financing-options')
  @HttpCode(200)
  @Capability('financingOptions')
  @Operation('financingOptions')
  @ApiTags('Pagamento')
  @ApiOperation({
    summary: 'Parcelas que o cartão aceita',
    description: [
      'Read-only: consulta a operadora, não cobra nada. Contrato: 11-emissao.md §2.',
      '',
      'O corpo leva o bloco `financingOptions` com `booking` e `payment`. A resposta traz',
      '`plans[]`; o `plans[].financingId` volta no /issue em `creditCard.financingId`.',
      '',
      '🔴 `interest.monthlyPercent` sai `null`: a LATAM informa uma taxa sem dizer de que',
      'período. `interestFree` é o fato que dá para afirmar.',
      '',
      '🔴 `financingOptions.payment.creditCard.number` é o **número do cartão**. Ele existe no corpo porque a',
      'operadora precisa dele para calcular as parcelas — e **não é logado, não é guardado e',
      'não volta na resposta**.',
      '',
      '`plans: []` é resposta válida: o valor pode estar abaixo da parcela mínima.',
    ].join('\n'),
  })
  @ApiBody({ type: FinancingOptionsDto })
  async financingOptions(@Body() dto: FinancingOptionsDto, @Req() request: FlightRequest) {
    return this.payment.financingOptions(dto, contextOf(request));
  }

  @Post('issue')
  @HttpCode(200)
  @Capability('issue')
  @Operation('issue')
  @ApiTags('Pagamento')
  @ApiOperation({
    summary: 'Pagar a reserva',
    description: [
      'Mapeia para `OrderChange` com `PaymentFunctions` — paga uma ordem que já existe.',
      'Contrato: 11-emissao.md §3.',
      '',
      'A LATAM exige no cartão `holderCpf`, `holderBirthdate`, `holderEmail` e',
      '`billingAddress` (`zipCode`, `street`, `country`). A parcela escolhida vai em',
      '`creditCard.financingId`.',
      '',
      '🔴 **Mutação não idempotente e sem retry.** Cobrar duas vezes é o pior erro possível.',
      'Se a resposta se perder, o caminho é o `/retrieve` — nunca pagar de novo.',
      '',
      '🔴 O valor cobrado é **perguntado à companhia**, não aceito do corpo.',
      '`payment.billedAmount` é opcional e serve como declaração do que quem chama espera:',
      'se divergir, a cobrança não acontece e a resposta é `FARE_PRICE_CHANGED`.',
      '',
      '🔴 A prova de emissão é o NÚMERO DO BILHETE, não o status. `confirmed: null` quer',
      'dizer que a companhia ainda não fechou e a prova não existe — consulte o `/retrieve`,',
      'não repita o pagamento.',
      '',
      '`tickets[]` e `emds[]` são listas separadas: documento de voo e de serviço têm ciclos',
      'de vida diferentes, e anular um não anula o outro.',
    ].join('\n'),
  })
  @ApiBody({ type: IssueDto })
  async issue(@Body() dto: IssueDto, @Req() request: FlightRequest) {
    return this.payment.issue(dto, contextOf(request));
  }

  @Post('retrieve-eticket')
  @HttpCode(200)
  @Capability('retrieveEticket')
  @ApiTags('Não suportado pelo provedor')
  @ApiOperation(NOT_SUPPORTED_ROUTES.retrieveEticket)
  @ApiBody({ type: RetrieveEticketDto })
  retrieveEticket(@Body() _dto: RetrieveEticketDto): never { throw notSupported('retrieveEticket'); }

  @Post('cancel-eticket')
  @HttpCode(200)
  @Capability('cancelEticket')
  @ApiTags('Não suportado pelo provedor')
  @ApiOperation(NOT_SUPPORTED_ROUTES.cancelEticket)
  @ApiBody({ type: CancelEticketDto })
  cancelEticket(@Body() _dto: CancelEticketDto): never { throw notSupported('cancelEticket'); }
}

export { ERROR_RESPONSES };
