/**
 * 🔴 O `.env` é carregado AQUI, não pelo ConfigModule.
 *
 * Este módulo expõe `env` como constante avaliada no import. O
 * `ConfigModule.forRoot()` só roda quando o Nest instancia o AppModule — depois
 * deste import. Confiar nele deixaria `env` congelado com os defaults, e o
 * sintoma seria "credencial ausente" mesmo com o `.env` correto no lugar.
 *
 * O ConfigModule continua no AppModule para quem quiser injetar ConfigService;
 * este import é o que garante a ordem.
 */
import 'dotenv/config';

/**
 * 🔴 `PROVIDER` continua existindo só para não quebrar quem importa, mas NÃO é
 * mais "o provedor" — é o nome do provedor Travelfusion. Quem precisa saber de
 * quem veio uma oferta lê o campo do próprio provedor.
 */
export const PROVIDER = 'travelfusion' as const;
export const LATAM = 'latam' as const;

/**
 * Ordem importa: é a ordem em que os provedores aparecem no evento `start` e em
 * que são consultados. O primeiro da lista é o padrão de quem não escolhe.
 */
const providerList = (process.env.PROVIDERS ?? 'latam,travelfusion')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);

export const env = {
  port: Number(process.env.PORT ?? 3010),

  providers: providerList,

  latam: {
    /** Apigee sandbox. Produção troca só isto e as credenciais. */
    endpoint: process.env.LATAM_ENDPOINT ?? 'https://sandbox.api.latam.com/api/ndc/v192',
    tokenEndpoint: process.env.LATAM_TOKEN_ENDPOINT ?? 'https://sandbox.api.latam.com/oauth/cc/token',
    apiKey: process.env.LATAM_API_KEY ?? '',
    apiSecret: process.env.LATAM_API_SECRET ?? '',
    /** Vão nos headers obrigatórios X-latam-* de toda chamada. */
    clientName: process.env.LATAM_CLIENT_NAME ?? 'Pass',
    applicationName: process.env.LATAM_APPLICATION_NAME ?? 'Pass-Dev',
    country: process.env.LATAM_COUNTRY ?? 'BR',
    lang: process.env.LATAM_LANG ?? 'PT',
    apiVersion: process.env.LATAM_API_VERSION ?? 'V2',
    /** Identificação da agência no corpo do AirShopping. */
    agencyId: process.env.LATAM_AGENCY_ID ?? '',
    agencyIata: process.env.LATAM_AGENCY_IATA ?? '',
    agencyName: process.env.LATAM_AGENCY_NAME ?? 'Pass',
    /**
     * O token vive 59 min. Renovamos antes para não perder uma busca por um
     * token que expirou entre o cabeçalho e a resposta.
     */
    tokenTtlMs: Number(process.env.LATAM_TOKEN_TTL_MS ?? 55 * 60 * 1000),
  },

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
