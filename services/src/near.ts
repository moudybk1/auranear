// Config, RPC access and logging shared by the loops. Keys come from env only and are never logged.
import { Account, FailoverRpcProvider, JsonRpcProvider, teraToGas, type KeyPairString } from 'near-api-js';
import { HostGuestPanicError } from 'near-api-js/rpc-errors';

function env(name: string, fallback?: string) {
  const value = process.env[name] || fallback;
  if (value === undefined) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  return value;
}

export const cfg = {
  network: env('NETWORK'),
  contract: env('CONTRACT_ID'),
  markets: env('MARKETS').split(',').map((s) => s.trim()).filter(Boolean),
  pushBps: BigInt(env('PRICE_PUSH_BPS', '30')),
  pushMaxSec: Number(env('PRICE_PUSH_MAX_SEC', '300')),
  oraclePollSec: Number(env('ORACLE_POLL_SEC', '5')),
  keeperIntervalSec: Number(env('KEEPER_INTERVAL_SEC', '15')),
  port: Number(env('PORT', '8787')),
  corsOrigin: env('CORS_ORIGIN', '*'),
};

const provider = new FailoverRpcProvider(
  [env('RPC_URL'), process.env.RPC_URL_FALLBACK].filter((url) => !!url).map((url) => new JsonRpcProvider({ url: url! })),
);

export const oracle = new Account(env('ORACLE_ACCOUNT_ID'), provider, env('ORACLE_PRIVATE_KEY') as KeyPairString);
export const keeper = new Account(env('KEEPER_ACCOUNT_ID'), provider, env('KEEPER_PRIVATE_KEY') as KeyPairString);

/** What /health reports. The loops write it. In memory only: the liquidation count restarts with the process. */
export const status = {
  /** Per market: timestamp of the on-chain price as of the last poll, and when the contract calls it stale. */
  markets: {} as Record<string, { ts: number; staleAfter: number }>,
  lastScanMs: 0,
  liquidationsMs: [] as number[],
  balances: {} as Record<string, string>,
};

export function log(level: 'info' | 'warn' | 'error', component: string, event: string, extra: object = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, component, event, ...extra }));
}

type Args = Record<string, unknown>;

export const view = <T>(method: string, args: Args = {}) =>
  provider.callFunction({ contractId: cfg.contract, method, args }) as Promise<T>;

/** Sends one function call and returns the transaction hash. Throws with the contract's panic message. */
export async function call(account: Account, methodName: string, args: Args, tgas: number) {
  try {
    const outcome = await account.callFunctionRaw({ contractId: cfg.contract, methodName, args, gas: teraToGas(tgas) });
    return outcome.transaction.hash as string;
  } catch (e) {
    throw new Error(e instanceof HostGuestPanicError ? e.panicMessage : e instanceof Error ? e.message : String(e));
  }
}
