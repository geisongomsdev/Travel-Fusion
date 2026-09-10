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
import { CancelBookingDto, CreateBookingDto, FareRulesDto, QuoteDto, RetrieveDto } from './dto/booking.dto';
import { PingDto } from './dto/ping.dto';
import { AvailabilityService } from './use-cases/availability.service';
import { BookingService } from './use-cases/booking.service';
import { FareRulesService } from './use-cases/fare-rules.service';
import { PingService } from './use-cases/ping.service';
import { QuoteService } from './use-cases/quote.service';
import { RetrieveService } from './use-cases/retrieve.service';
import { CancelBookingService } from './use-cases/cancel-booking.service';
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
  @ApiTags('Não suportado pelo provedor')
  @ApiOperation(NOT_SUPPORTED_ROUTES.seatMap)
  seatMap(): never { throw notSupported('seatMap'); }

  @Post('mark-seats')
  @Capability('markSeats')
  @ApiTags('Não suportado pelo provedor')
  @ApiOperation(NOT_SUPPORTED_ROUTES.markSeats)
  markSeats(): never { throw notSupported('markSeats'); }

  /** DELETE com corpo — é assim no contrato. */
  @Delete('remove-seats')
  @Capability('removeSeats')
  @ApiTags('Não suportado pelo provedor')
  @ApiOperation(NOT_SUPPORTED_ROUTES.removeSeats)
  removeSeats(): never { throw notSupported('removeSeats'); }

  @Post('ancillaries')
  @Capability('ancillaries')
  @ApiTags('Não suportado pelo provedor')
  @ApiOperation(NOT_SUPPORTED_ROUTES.ancillaries)
  ancillaries(): never { throw notSupported('ancillaries'); }

  @Post('sell-ancillaries')
  @Capability('sellAncillaries')
  @ApiTags('Não suportado pelo provedor')
  @ApiOperation(NOT_SUPPORTED_ROUTES.sellAncillaries)
  sellAncillaries(): never { throw notSupported('sellAncillaries'); }

  @Post('payment-options')
  @Capability('paymentOptions')
  @ApiTags('Não suportado pelo provedor')
  @ApiOperation(NOT_SUPPORTED_ROUTES.paymentOptions)
  paymentOptions(): never { throw notSupported('paymentOptions'); }

  @Post('financing-options')
  @Capability('financingOptions')
  @ApiTags('Não suportado pelo provedor')
  @ApiOperation(NOT_SUPPORTED_ROUTES.financingOptions)
  financingOptions(): never { throw notSupported('financingOptions'); }

  @Post('issue')
  @Capability('issue')
  @ApiTags('Não suportado pelo provedor')
  @ApiOperation(NOT_SUPPORTED_ROUTES.issue)
  issue(): never { throw notSupported('issue'); }

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
