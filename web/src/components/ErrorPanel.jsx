import { AlertTriangle } from 'lucide-react';

/**
 * Erro para quem está comprando.
 *
 * 🔴 O código canônico, o status HTTP e o payload do provedor NÃO aparecem
 * aqui. Eles continuam existindo — na resposta da API, no log e no
 * `correlationId` — mas na tela viram uma frase que diz o que aconteceu e o
 * que fazer. `RESOURCE_CONFLICT / 400107002 / OrderReshop` não ajuda ninguém
 * que só quer cancelar uma passagem.
 *
 * O mapa é por CÓDIGO + OPERAÇÃO porque o mesmo código significa coisas
 * diferentes em rotas diferentes: um conflito no cancelamento é "ainda não dá
 * para cancelar"; num quote seria "a oferta expirou".
 */
const MESSAGES = {
  BOOKING_ALREADY_CANCELLED: {
    title: 'Esta passagem já foi cancelada',
    body: 'Não há nada a fazer: a companhia já anulou o bilhete.',
  },
  'RESOURCE_CONFLICT:cancelBooking': {
    title: 'Ainda não dá para cancelar',
    body: 'A companhia está processando algo nesta reserva. Aguarde um instante e tente de novo.',
  },
  'RESOURCE_CONFLICT:quote': {
    title: 'Esta oferta não está mais disponível',
    body: 'O preço ou o assento mudaram desde a busca. Faça a busca de novo para ver as opções atuais.',
  },
  'FARE_PRICE_CHANGED:quote': {
    title: 'O preço mudou',
    body: 'A companhia atualizou o valor desta tarifa. Busque de novo para ver o preço atual.',
  },
  'FARE_UNAVAILABLE:quote': {
    title: 'Esta tarifa acabou',
    body: 'Alguém comprou os últimos lugares nesta tarifa. Escolha outra opção.',
  },
  PAYMENT_DECLINED: {
    title: 'O pagamento não foi autorizado',
    body: 'O banco recusou a cobrança. Nada foi cobrado. Tente outro cartão.',
  },
  'FARE_PRICE_CHANGED:issue': {
    title: 'O valor mudou',
    body: 'A companhia atualizou o total desta reserva. Atualize a reserva e pague pelo valor novo.',
  },
  'FARE_PRICE_CHANGED:sellAncillaries': {
    title: 'O preço do extra mudou',
    body: 'Assentos e bagagens mudam de preço a toda hora. Escolha de novo para ver o valor atual.',
  },
  'RESOURCE_CONFLICT:sellAncillaries': {
    title: 'A reserva está sendo processada',
    body: 'A companhia ainda está fechando uma operação nesta reserva. Aguarde um instante e tente de novo.',
  },
  'RESOURCE_NOT_FOUND:retrieve': {
    title: 'Reserva não encontrada',
    body: 'Confira o localizador. Se acabou de reservar, aguarde um instante e tente de novo.',
  },
  CAPABILITY_NOT_SUPPORTED: {
    title: 'Operação indisponível para esta companhia',
    body: 'Esta companhia não oferece essa ação pelo nosso canal.',
  },
  SEARCH_VALIDATION_ERROR: {
    title: 'Faltou alguma informação',
    body: 'Confira os campos e tente de novo.',
  },
  PROVIDER_AUTHENTICATION_FAILED: {
    title: 'Não foi possível falar com a companhia',
    body: 'A conexão com o sistema da companhia está indisponível. Tente novamente em alguns minutos.',
  },
  PROVIDER_TIMEOUT: {
    title: 'A companhia demorou a responder',
    body: 'Tente novamente. Se você estava reservando, consulte o estado antes de repetir.',
  },
  NO_FLIGHTS: {
    title: 'Nenhum voo para esta rota',
    body: 'Tente outra data ou outro aeroporto.',
  },
};

const FALLBACK = {
  title: 'Algo deu errado',
  body: 'Tente novamente em alguns instantes.',
};

function resolve(error) {
  /**
   * 🔴 A ação vem de QUEM CHAMOU, não do servidor. O corpo do erro traz o nome
   * da mensagem do provedor (`OrderReshop`), que é verdade da integração e não
   * diz qual botão a pessoa apertou — e é o botão que define a frase certa.
   */
  const operation = error.operation ?? error.metadata?.operation ?? null;
  return (
    MESSAGES[`${error.code}:${operation}`]
    ?? MESSAGES[error.code]
    ?? FALLBACK
  );
}

export function ErrorPanel({ error }) {
  if (!error) return null;

  const { title, body } = resolve(error);

  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-500" strokeWidth={1.5} />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{body}</p>

          {/* Campos que a pessoa precisa corrigir — os únicos detalhes que
              sobrevivem, porque são acionáveis. */}
          {error.details?.errors && (
            <ul className="pt-1 text-sm text-muted-foreground">
              {Object.values(error.details.errors).flat().map((message, index) => (
                <li key={index}>· {message}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
