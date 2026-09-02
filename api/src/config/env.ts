export const PROVIDER = 'travelfusion' as const;

export const env = {
  port: Number(process.env.PORT ?? 3010),

  travelfusion: {
    endpoint: process.env.TF_ENDPOINT ?? 'https://api.travelfusion.com/Xml',
    // A senha expira a cada 90 dias e 6 tentativas erradas bloqueiam o usuário —
    // nunca em código, sempre em env/cofre.
    xmlLoginId: process.env.TF_XML_LOGIN_ID ?? '',
    password: process.env.TF_PASSWORD ?? '',
  },

  // Obrigatórios em toda request. Ausência reprova na auditoria de go-live.
  customParameters: {
    requestOrigin: process.env.TF_REQUEST_ORIGIN ?? 'pass-br',
    pointOfSale: process.env.TF_POINT_OF_SALE ?? 'BR',
    userData: process.env.TF_USER_DATA ?? 'pass-flight-api',
  },

  routing: {
    pollIntervalMs: Number(process.env.TF_ROUTING_POLL_INTERVAL_MS ?? 2000),
    cutoffMs: Number(process.env.TF_ROUTING_CUTOFF_MS ?? 40000),
  },
};
