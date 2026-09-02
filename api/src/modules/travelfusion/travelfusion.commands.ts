import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { env } from '../../config/env';
import { RequestContext, TravelfusionClient } from './travelfusion.client';
import { asList, bool, text } from './xml.util';

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Status finais definitivos: só eles autorizam parar o polling. */
export const FINAL_BOOKING_STATUSES = new Set(['Succeeded', 'Failed', 'Duplicate']);

export interface RoutingPoll {
  durationMs: number;
  routers: Array<{ name: string | null; complete: boolean; error: string | null }>;
  complete: boolean;
  routes: Record<string, any>[];
}

export interface BookingPoll {
  durationMs: number;
  status: string | null;
  isFinal: boolean;
  succeeded: boolean;
  supplierReference: string | null;
  raw: Record<string, any>;
}

@Injectable()
export class TravelfusionCommands {
  /**
   * O LoginId vale INDEFINIDAMENTE e o Login só pode ser chamado poucas vezes
   * por dia (Login Handling Guide, pág. 107).
   *
   * 🔴 Fazer Login por request derruba a conta. A regra da casa de resolver
   * credencial do banco a cada request vale para usuário/senha — não para
   * refazer o Login. Daí o cache.
   *
   * Hoje é estado de instância: com várias réplicas, cada uma faz o seu Login
   * (ainda dentro do limite). Se o número crescer, isto vira cache compartilhado.
   */
  private cachedLoginId: string | null = null;

  constructor(private readonly client: TravelfusionClient) {}

  primeLoginId(loginId: string): void {
    this.cachedLoginId = loginId;
  }

  clearLoginId(): void {
    this.cachedLoginId = null;
  }

  async getLoginId(context: RequestContext = {}, force = false): Promise<string> {
    if (this.cachedLoginId && !force) return this.cachedLoginId;

    const { parsed } = await this.client.send(
      'Login',
      { Username: env.travelfusion.xmlLoginId, Password: env.travelfusion.password },
      context,
    );

    const loginId = text(parsed?.LoginResponse?.LoginId) ?? text(parsed?.Login?.LoginId);
    if (!loginId) {
      throw new AppError('PROVIDER_AUTHENTICATION_FAILED', { metadata: { operation: 'ping' } });
    }

    this.cachedLoginId = loginId;
    return loginId;
  }

  /**
   * Os dois identificadores que TODO comando carrega como filhos diretos.
   * `XmlLoginId` = a nossa conta XML; `LoginId` = o usuário final — no nosso
   * caso, o mesmo valor.
   */
  private async auth(context: RequestContext): Promise<Record<string, string>> {
    return { XmlLoginId: env.travelfusion.xmlLoginId, LoginId: await this.getLoginId(context) };
  }

  /** Fornecedores habilitados na nossa branch. */
  async getBranchSupplierList(context: RequestContext): Promise<Array<{ name: string | null; enabled: boolean }>> {
    const { parsed } = await this.client.send('GetBranchSupplierList', await this.auth(context), context);
    return asList(parsed?.GetBranchSupplierListResponse?.SupplierList?.Supplier).map((supplier) => ({
      name: text(supplier?.Name),
      enabled: bool(supplier?.Enabled) !== false,
    }));
  }

  /**
   * Rotas atendidas por cada fornecedor.
   *
   * 🔴 Implementação OBRIGATÓRIA para o go-live: buscar rota que o fornecedor
   * não atende é motivo de reprova. O resultado é caro e muda pouco — cachear.
   */
  async listSupplierRoutes(
    supplier: string,
    context: RequestContext,
  ): Promise<Array<{ origin: string | null; destination: string | null }>> {
    const { parsed } = await this.client.send(
      'ListSupplierRoutes',
      { ...(await this.auth(context)), Mode: 'plane', SupplierName: supplier },
      context,
    );
    return asList(parsed?.ListSupplierRoutesResponse?.RouteList?.Route).map((route) => ({
      origin: text(route?.Origin),
      destination: text(route?.Destination),
    }));
  }

  async startRouting(
    request: Record<string, unknown>,
    context: RequestContext,
  ): Promise<{ routingId: string | null; routers: string[] }> {
    const { parsed } = await this.client.send('StartRouting', { ...(await this.auth(context)), ...request }, context);
    const response = parsed?.StartRoutingResponse ?? {};
    return {
      routingId: text(response.RoutingId),
      routers: asList(response.RouterList?.Router)
        .map((router: any) => text(router?.Name))
        .filter((name): name is string => Boolean(name)),
    };
  }

  /**
   * Uma passada do polling.
   *
   * 🔴 Resultados já devolvidos NÃO voltam nas chamadas seguintes. Quem chama
   * acumula; tratar cada resposta como "o total" perde voo.
   */
  async checkRouting(routingId: string, context: RequestContext): Promise<RoutingPoll> {
    const { parsed, durationMs } = await this.client.send(
      'CheckRouting',
      { ...(await this.auth(context)), RoutingId: routingId },
      context,
    );

    const response = parsed?.CheckRoutingResponse ?? {};
    const routers = asList(response.RouterList?.Router).map((router: any) => ({
      name: text(router?.Name),
      complete: bool(router?.Complete) === true,
      error: text(router?.Error),
    }));

    return {
      durationMs,
      routers,
      complete: routers.length > 0 && routers.every((router) => router.complete),
      routes: asList(response.RouteList?.Route),
    };
  }

  async processDetails(
    routingId: string,
    outwardId: string | null | undefined,
    returnId: string | null | undefined,
    context: RequestContext,
  ): Promise<{ response: Record<string, any>; durationMs: number }> {
    const { parsed, durationMs } = await this.client.send(
      'ProcessDetails',
      {
        ...(await this.auth(context)),
        Mode: 'plane',
        RoutingId: routingId,
        OutwardId: outwardId ?? undefined,
        ReturnId: returnId ?? undefined,
      },
      context,
    );
    return { response: parsed?.ProcessDetailsResponse ?? {}, durationMs };
  }

  /**
   * 🔴 UM ÚNICO ProcessTerms por reserva. Múltiplos só são aceitos em caso de
   * erro de validação de dados — a Travelfusion audita a contagem.
   */
  async processTerms(
    payload: Record<string, unknown>,
    context: RequestContext,
  ): Promise<{ response: Record<string, any>; durationMs: number }> {
    const { parsed, durationMs } = await this.client.send(
      'ProcessTerms',
      { ...(await this.auth(context)), ...payload },
      context,
    );
    return { response: parsed?.ProcessTermsResponse ?? {}, durationMs };
  }

  /** Sem retry. Se falhar, o caminho é CheckBooking — nunca repetir. */
  async startBooking(routingId: string, context: RequestContext): Promise<{ bookingId: string }> {
    const { parsed } = await this.client.send(
      'StartBooking',
      { ...(await this.auth(context)), Mode: 'plane', RoutingId: routingId },
      context,
    );
    return { bookingId: text(parsed?.StartBookingResponse?.BookingId) ?? routingId };
  }

  async checkBooking(routingId: string, context: RequestContext): Promise<BookingPoll> {
    const { parsed, durationMs } = await this.client.send(
      'CheckBooking',
      { ...(await this.auth(context)), Mode: 'plane', RoutingId: routingId },
      context,
    );

    const response = parsed?.CheckBookingResponse ?? {};
    const status = text(response.Status) ?? text(response.BookingStatus);

    return {
      durationMs,
      status,
      isFinal: status !== null && FINAL_BOOKING_STATUSES.has(status),
      succeeded: status === 'Succeeded',
      supplierReference: text(response.SupplierReference) ?? text(response.BookingReference),
      raw: response,
    };
  }
}
