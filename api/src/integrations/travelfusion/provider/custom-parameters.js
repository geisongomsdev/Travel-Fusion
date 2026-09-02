import { env } from '../../../config/env.js';

/**
 * Custom parameters obrigatórios em TODA request — Key Integration Highlights §4.
 * A ausência deles é item de reprova na auditoria de go-live, mesmo com o fluxo
 * funcionando. Por isso vive num só lugar e é injetado pelo client, não pelos
 * comandos: comando novo nasce conforme.
 */
export function buildCustomParameters(context = {}) {
  return {
    EndUserIPAddress: context.endUserIp || '127.0.0.1',
    EndUserBrowserAgent: context.endUserAgent || 'pass-flight-api/0.1',
    UserData: env.customParameters.userData,
    RequestOrigin: env.customParameters.requestOrigin,
    PointOfSale: context.pointOfSale || env.customParameters.pointOfSale,
  };
}
