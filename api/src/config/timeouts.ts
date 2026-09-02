/**
 * Read timeouts por comando — spec Travelfusion v1.3, pág. 43-44.
 *
 * 🔴 A coluna `retries` não é sugestão. `ProcessTerms` e `StartBooking` são
 * MUTAÇÕES NÃO IDEMPOTENTES: retentar cria reserva duplicada, e a Travelfusion
 * audita a quantidade de chamadas antes do go-live. Depois do StartBooking o
 * caminho é sempre CheckBooking — nunca repetir o StartBooking.
 */
export interface CommandTimeout {
  readMs: number;
  retries: number;
  retryReadMs?: number;
}

export const COMMAND_TIMEOUTS: Record<string, CommandTimeout> = {
  Login:                 { readMs: 10000,  retries: 1 },
  GetBranchSupplierList: { readMs: 15000,  retries: 1 },
  ListSupplierRoutes:    { readMs: 30000,  retries: 1 },
  StartRouting:          { readMs: 4000,   retries: 1, retryReadMs: 15000 },
  CheckRouting:          { readMs: 7000,   retries: 1 },
  ProcessDetails:        { readMs: 150000, retries: 0 },
  ProcessTerms:          { readMs: 150000, retries: 0 },
  StartBooking:          { readMs: 20000,  retries: 0 },
  CheckBooking:          { readMs: 10000,  retries: 0 },
};

export const CONNECT_TIMEOUT_MS = 2000;

export function timeoutFor(command: string): CommandTimeout {
  return COMMAND_TIMEOUTS[command] ?? { readMs: 15000, retries: 0 };
}
