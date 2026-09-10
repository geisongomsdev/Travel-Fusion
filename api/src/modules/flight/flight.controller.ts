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
  CancelBookingDto, CreateBookingDto, FareRulesDto, FinancingOptionsDto, IssueDto,
  OrderCatalogDto, QuoteDto, RetrieveDto, SeatMapDto, SellAncillariesDto,
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
      'Por trás: `StartRouting` + polling de `CheckRouting` (≥ 2s). O polling é incremental —',
      'resultados já devolvidos não voltam, então a acumulação é nossa.',
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
  @Capability('quote')
  @Operation('quote')
  @ApiTags('Venda')
  @ApiOperation({
    summary: 'Tarifar — confirmar o preço firme',
    description: [
      'Mapeia para `ProcessDetails`.',
      '',
      'Devolve também `requiredParameters[]` — os CSPs que o provedor vai exigir,',
      'bagagem incluída, já parseados do `DisplayText`. Guarde: o `ProcessTerms` é',
      '**único** e não haverá segunda chance de perguntar.',
    ].join('\n'),
  })
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
      'Mapeia para `ProcessTerms` (**um só**) → `StartBooking` → polling de `CheckBooking`.',
      '',
      '🔴 `committed` ≠ `confirmed`. `committed:true` diz que a reserva foi aceita pelo',
      'provedor; `confirmed` só vira `true` quando o status final `Succeeded` chega, e',
      '**nunca é deduzido** de `committed`. Status não-final (`BookingInProgress`,',
      '`Unconfirmed`) não autoriza re-reservar — a reserva pode existir do outro lado.',
      '',
      'Devolve **HTTP 201**; todas as outras rotas devolvem 200.',
    ].join('\n'),
  })
  @ApiResponse({ status: 201, description: 'Reserva criada. Guarde o locator.' })
  async reservar(@Body() dto: CreateBookingDto, @Req() request: FlightRequest) {
    return this.booking.execute(dto, contextOf(request));
  }

  /**
   * 🔴 O /retrieve NÃO usa o envelope de três chaves: tem chaves próprias
   * (connector, booking, status, message) e `status` só assume `"found"`.
   * Qualquer outro cenário é erro, com o corpo de erro padrão.
   */
  @Post('retrieve')
  @Capability('retrieve')
  @RawResponse()
  @ApiTags('Pós-venda')
  @ApiOperation({
    summary: 'Consultar a reserva',
    description: [
      'Mapeia para `CheckBooking`. **Sem cache** — toda chamada vai à companhia,',
      'porque o ponto da rota é saber o estado *agora*.',
      '',
      '🔴 Esta rota tem envelope próprio, e `status` só assume `"found"`.',
      '',
      'Todas as chaves de `data` existem sempre, com `null` onde a Travelfusion não',
      'informa: o `CheckBooking` não devolve os trechos, então `trip`, `segments` e',
      '`itinerary` vêm `null`.',
    ].join('\n'),
  })
  @ApiResponse({ status: 200, description: 'Reserva encontrada.' })
  async consultar(@Body() dto: RetrieveDto, @Req() request: FlightRequest) {
    const { locator, connector, data } = await this.retrieve.execute(dto, contextOf(request));
    return {
      success: true,
      connector,
      booking: locator,
      status: 'found',
      message: 'Booking retrieved successfully',
      data,
    };
  }

  @Post('fare-rules')
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
    ].join('\n'),
  })
  async regras(@Body() dto: FareRulesDto, @Req() request: FlightRequest) {
    return this.fareRules.execute(dto, contextOf(request));
  }

  @Post('ping')
  @Capability('ping')
  @Operation('ping')
  @ApiTags('Diagnóstico')
  @ApiOperation({
    summary: 'Testar a credencial',
    description: [
      'Mapeia para `Login`.',
      '',
      '🔴 Aqui o `Login` é sempre real — servir o `LoginId` do cache responderia',
      '"ok" sem falar com a companhia. Quem protege o limite diário de `Login` da',
      'Travelfusion é o teto de **10 tentativas por minuto** do contrato (429).',
      '',
      '`verification.scope` é `connection`: o `Login` valida a credencial da',
      'integração, não as chaves enviadas em `ping.credentials`.',
    ].join('\n'),
  })
  async ping(@Body() dto: PingDto, @Req() request: FlightRequest) {
    return this.pingProbe.execute(dto, contextOf(request));
  }

  // ── Rotas que existem no contrato e a Travelfusion não atende ───────────────
  // Registradas de propósito: 501 documentado é melhor do que 404, porque diz a
  // quem consome que a operação existe e o problema é este provedor.

  @Post('cancel-booking')
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
      '`cancelled: false` com `status: "pending"` significa **aceito, ainda não fechado**.',
      'Não é falha, e não autoriza tentar de novo: consulte o `/retrieve`.',
      '',
      'A Travelfusion responde **501**: lá o `StartBooking` já cobra, então cancelar seria',
      'estorno, coisa que o Direct Connect não expõe.',
    ].join('\n'),
  })
  @ApiBody({ type: CancelBookingDto })
  async cancelBooking(@Body() dto: CancelBookingDto, @Req() request: FlightRequest) {
    return this.cancel.execute(dto, contextOf(request));
  }

  @Post('seat-map')
  @Capability('seatMap')
  @Operation('seatMap')
  @ApiTags('Assentos')
  @ApiOperation({
    summary: 'Mapa de assentos da oferta',
    description: [
      'Read-only: não marca nada.',
      '',
      '🔴 **Divergência consciente do contrato canônico.** O `09-assentos.md` endereça o mapa',
      'pelo LOCALIZADOR, assumindo escolha pós-reserva. Na LATAM o `/seats/availability`',
      'responde pela OFERTA — a escolha é anterior, e o localizador ainda não existe.',
      '',
      'Mapa ilegível degrada para `segments: []`, nunca 500: a leitura degrada, a mutação falha.',
    ].join('\n'),
  })
  @ApiBody({ type: SeatMapDto })
  async seatMap(@Body() dto: SeatMapDto, @Req() request: FlightRequest) {
    return this.seats.execute(dto, contextOf(request));
  }

  /**
   * O mapa de assentos de uma reserva JÁ EMITIDA — o catálogo de onde saem os
   * identificadores que o /sell-ancillaries aceita.
   */
  @Post('order-seat-map')
  @Capability('seatMap')
  @Operation('seatMap')
  @ApiTags('Assentos')
  @ApiOperation({
    summary: 'Mapa de assentos da reserva emitida',
    description: [
      'Read-only. Endereçado pelo LOCALIZADOR, ao contrário do /seat-map, que responde pela oferta.',
      '',
      '🔴 **Não é o mesmo catálogo.** Os `offerItemId` daqui (`SEAT_…`) são os únicos que o',
      '/sell-ancillaries aceita; os do /seat-map (`SEI|…`) morrem na emissão. Usar um no lugar',
      'do outro faz a companhia recusar com `INVALID_OFFER_TYPES`.',
    ].join('\n'),
  })
  @ApiBody({ type: OrderCatalogDto })
  async orderSeatMap(@Body() dto: OrderCatalogDto, @Req() request: FlightRequest) {
    return this.postSale.seatMap(dto, contextOf(request));
  }

  /** Idem, para bagagem e demais opcionais. */
  @Post('order-ancillaries')
  @Capability('ancillaries')
  @Operation('ancillaries')
  @ApiTags('Assentos')
  @ApiOperation({
    summary: 'Opcionais da reserva emitida',
    description: 'Read-only. Mesmo par de catálogos do /order-seat-map, endereçado pelo localizador.',
  })
  @ApiBody({ type: OrderCatalogDto })
  async orderAncillaries(@Body() dto: OrderCatalogDto, @Req() request: FlightRequest) {
    return this.postSale.ancillaries(dto, contextOf(request));
  }

  /**
   * 🔴 Marcar assento e comprar assento são a MESMA operação na LATAM: o
   * assento é confirmado no mesmo pedido em que é cobrado, e não existe
   * segurá-lo sem pagar. Esta rota existe porque o contrato canônico a prevê,
   * e delega para o /sell-ancillaries em vez de fingir uma etapa que não há.
   */
  @Post('mark-seats')
  @Capability('markSeats')
  @Operation('sellAncillaries')
  @ApiTags('Assentos')
  @ApiOperation({
    summary: 'Marcar assentos na reserva emitida',
    description: [
      '🔴 **Cobra o cartão.** Não é idempotente e não tem retry: na LATAM marcar e pagar o',
      'assento é um pedido só. Mesmo corpo e mesma resposta do /sell-ancillaries.',
    ].join('\n'),
  })
  @ApiBody({ type: SellAncillariesDto })
  async markSeats(@Body() dto: SellAncillariesDto, @Req() request: FlightRequest) {
    return this.postSale.execute(dto, contextOf(request));
  }

  /** DELETE com corpo — é assim no contrato. */
  @Delete('remove-seats')
  @Capability('removeSeats')
  @ApiTags('Não suportado pelo provedor')
  @ApiOperation(NOT_SUPPORTED_ROUTES.removeSeats)
  removeSeats(): never { throw notSupported('removeSeats'); }

  @Post('ancillaries')
  @Capability('ancillaries')
  @Operation('ancillaries')
  @ApiTags('Assentos')
  @ApiOperation({
    summary: 'Opcionais vendidos à parte',
    description: [
      'Read-only. Endereçado pela OFERTA, como o /seat-map — mesma divergência, mesma razão.',
      '',
      'Assentos são filtrados fora: eles vêm no /seat-map, com fileira e coluna. A Travelfusion',
      'responde 501 porque lá os opcionais já saem no /quote, em requiredParameters.',
    ].join('\n'),
  })
  @ApiBody({ type: SeatMapDto })
  async ancillaries(@Body() dto: SeatMapDto, @Req() request: FlightRequest) {
    return this.extras.execute(dto, contextOf(request));
  }

  @Post('sell-ancillaries')
  @Capability('sellAncillaries')
  @Operation('sellAncillaries')
  @ApiTags('Assentos')
  @ApiOperation({
    summary: 'Comprar assento e/ou bagagem na reserva emitida',
    description: [
      '🔴 **Cobra o cartão. Não é idempotente e não tem retry.** Se a resposta se perder, o',
      'caminho é o /retrieve — nunca repetir o pedido.',
      '',
      'O valor cobrado NÃO vem do corpo: é somado a partir do catálogo da própria reserva. Quem',
      'chama escolhe os itens; o preço é da companhia.',
      '',
      'Exige reserva EMITIDA. Numa reserva ainda não paga, pague primeiro pelo /issue.',
      '',
      'Cartão é dispensável só quando os opcionais escolhidos somam zero — assento cortesia.',
    ].join('\n'),
  })
  @ApiBody({ type: SellAncillariesDto })
  async sellAncillaries(@Body() dto: SellAncillariesDto, @Req() request: FlightRequest) {
    return this.postSale.execute(dto, contextOf(request));
  }

  @Post('payment-options')
  @Capability('paymentOptions')
  @ApiTags('Não suportado pelo provedor')
  @ApiOperation(NOT_SUPPORTED_ROUTES.paymentOptions)
  paymentOptions(): never { throw notSupported('paymentOptions'); }

  @Post('financing-options')
  @Capability('financingOptions')
  @Operation('financingOptions')
  @ApiTags('Pagamento')
  @ApiOperation({
    summary: 'Parcelas que o cartão aceita',
    description: [
      'Read-only: consulta a operadora, não cobra nada.',
      '',
      '🔴 O `card` é o **número do cartão**. Ele existe no corpo porque a operadora precisa dele',
      'para calcular as parcelas — e **não é logado, não é guardado e não volta na resposta**.',
      '',
      'Lista vazia é resposta válida: o cartão pode não aceitar parcelamento.',
    ].join('\n'),
  })
  @ApiBody({ type: FinancingOptionsDto })
  async financingOptions(@Body() dto: FinancingOptionsDto, @Req() request: FlightRequest) {
    return this.payment.financingOptions(dto, contextOf(request));
  }

  @Post('issue')
  @Capability('issue')
  @Operation('issue')
  @ApiTags('Pagamento')
  @ApiOperation({
    summary: 'Pagar a reserva',
    description: [
      'Mapeia para `OrderChange` com `PaymentFunctions` — paga uma ordem que já existe.',
      'Não confundir com `/order/create/payment`, que cria e paga de uma vez.',
      '',
      '🔴 **Mutação não idempotente e sem retry.** Cobrar duas vezes é o pior erro possível.',
      'Se a resposta se perder, o caminho é o `/retrieve` — nunca pagar de novo.',
      '',
      '🔴 O valor cobrado é **perguntado à companhia**, não aceito do corpo. `amount` é opcional',
      'e serve como declaração do que quem chama espera: se divergir, a cobrança não acontece',
      'e a resposta é `FARE_PRICE_CHANGED`.',
      '',
      '`issued: false` com `status: "pending"` significa aceito e ainda não fechado — consulte',
      'o `/retrieve`, não repita o pagamento.',
      '',
      'A Travelfusion responde **501**: lá o `StartBooking` já cobra, e não há o que emitir depois.',
    ].join('\n'),
  })
  @ApiBody({ type: IssueDto })
  async issue(@Body() dto: IssueDto, @Req() request: FlightRequest) {
    return this.payment.issue(dto, contextOf(request));
  }

  @Post('retrieve-eticket')
  @Capability('retrieveEticket')
  @ApiTags('Não suportado pelo provedor')
  @ApiOperation(NOT_SUPPORTED_ROUTES.retrieveEticket)
  retrieveEticket(): never { throw notSupported('retrieveEticket'); }

  @Post('cancel-eticket')
  @Capability('cancelEticket')
  @ApiTags('Não suportado pelo provedor')
  @ApiOperation(NOT_SUPPORTED_ROUTES.cancelEticket)
  cancelEticket(): never { throw notSupported('cancelEticket'); }
}

export { ERROR_RESPONSES };
