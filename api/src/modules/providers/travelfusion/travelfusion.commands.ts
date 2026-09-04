import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { env } from '../../../config/env';
import { RequestContext, TravelfusionClient } from './travelfusion.client';
import { asList, bool, text } from '../../../common/xml/xml.util';

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Status finais definitivos: só eles autorizam parar o polling. */
export const FINAL_BOOKING_STATUSES = new Set(['Succeeded', 'Failed', 'Duplicate']);

export interface RoutingPoll {
  durationMs: number;
  routers: Array<{
    name: string | null;
    complete: boolean;
    error: string | null;
  }>;
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

  /**
   * 🔴 Cache NEGATIVO do Login. Seis senhas erradas seguidas DESATIVAM o
   * usuário (Login Handling Guide, pág. 107) — e como `getLoginId` roda em toda
   * busca, uma credencial errada queima as seis tentativas em seis requests,
   * sem ninguém perceber. Depois de uma recusa de credencial, paramos de bater
   * na Travelfusion e devolvemos o mesmo 401 direto.
   *
   * A chave é a própria credencial: trocar o `.env` e reiniciar (ou chamar
   * `clearLoginId`) libera uma nova tentativa. Erro técnico (timeout, 5xx) NÃO
   * entra aqui — esse continua retentável.
   */
  private rejectedCredential: { fingerprint: string; error: AppError } | null = null;

  private static fingerprint(): string {
    return `${env.travelfusion.xmlLoginId}:${env.travelfusion.password}`;
  }

  constructor(private readonly client: TravelfusionClient) {}

  primeLoginId(loginId: string): void {
    this.cachedLoginId = loginId;
  }

  clearLoginId(): void {
    this.cachedLoginId = null;
    this.rejectedCredential = null;
  }

  async getLoginId(context: RequestContext = {}, force = false): Promise<string> {
    if (this.cachedLoginId && !force) return this.cachedLoginId;

    const fingerprint = TravelfusionCommands.fingerprint();
    if (this.rejectedCredential?.fingerprint === fingerprint) throw this.rejectedCredential.error;

    let payload: Record<string, any>;
    try {
      ({ payload } = await this.client.send(
        'Login',
        {
          Username: env.travelfusion.xmlLoginId,
          Password: env.travelfusion.password,
        },
        context,
      ));
    } catch (error) {
      // Só credencial recusada vira cache negativo. Falha técnica continua
      // retentável — senão um 502 passageiro trancaria a API até o restart.
      if (error instanceof AppError && error.code === 'PROVIDER_AUTHENTICATION_FAILED') {
        this.rejectedCredential = { fingerprint, error };
      }
      throw error;
    }

    const loginId = text(payload?.LoginId);
    if (!loginId) {
      const error = new AppError('PROVIDER_AUTHENTICATION_FAILED', {
        metadata: { operation: 'Login' },
      });
      this.rejectedCredential = { fingerprint, error };
      throw error;
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
    return {
      XmlLoginId: env.travelfusion.xmlLoginId,
      LoginId: await this.getLoginId(context),
    };
  }

  /** Fornecedores habilitados na nossa branch. */
  async getBranchSupplierList(context: RequestContext): Promise<Array<{ name: string | null; enabled: boolean }>> {
    const { payload } = await this.client.send('GetBranchSupplierList', await this.auth(context), context);
    return asList(payload?.SupplierList?.Supplier).map((supplier) => ({
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
    const { payload } = await this.client.send(
      'ListSupplierRoutes',
      { ...(await this.auth(context)), Mode: 'plane', SupplierName: supplier },
      context,
    );
    return asList(payload?.RouteList?.Route).map((route) => ({
      origin: text(route?.Origin),
      destination: text(route?.Destination),
    }));
  }

  async startRouting(
    request: Record<string, unknown>,
    context: RequestContext,
  ): Promise<{ routingId: string | null; routers: string[] }> {
    const { payload: response } = await this.client.send(
      'StartRouting',
      { ...(await this.auth(context)), ...request },
      context,
    );

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
    const { payload: response, durationMs } = await this.client.send(
      'CheckRouting',
      { ...(await this.auth(context)), RoutingId: routingId },
      context,
    );

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
    const { payload: response, durationMs } = await this.client.send(
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
    return { response, durationMs };
  }

  /**
   * 🔴 UM ÚNICO ProcessTerms por reserva. Múltiplos só são aceitos em caso de
   * erro de validação de dados — a Travelfusion audita a contagem.
   */
  async processTerms(
    request: Record<string, unknown>,
    context: RequestContext,
  ): Promise<{ response: Record<string, any>; durationMs: number }> {
    const { payload: response, durationMs } = await this.client.send(
      'ProcessTerms',
      { ...(await this.auth(context)), ...request },
      context,
    );
    return { response, durationMs };
  }

  /** Sem retry. Se falhar, o caminho é CheckBooking — nunca repetir. */
  async startBooking(routingId: string, context: RequestContext): Promise<{ bookingId: string }> {
    const { payload } = await this.client.send(
      'StartBooking',
      { ...(await this.auth(context)), Mode: 'plane', RoutingId: routingId },
      context,
    );
    return { bookingId: text(payload?.BookingId) ?? routingId };
  }

  async checkBooking(routingId: string, context: RequestContext): Promise<BookingPoll> {
    const { payload: response, durationMs } = await this.client.send(
      'CheckBooking',
      { ...(await this.auth(context)), Mode: 'plane', RoutingId: routingId },
      context,
    );

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
