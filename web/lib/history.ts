// Trade history read from the chain. FastNEAR's transaction index lists the transactions that involve an account,
// including ones that only name it in an event log (a keeper's liquidation), and returns them with their receipts'
// logs. Aura's own `open`, `close` and `liquidate` events (docs/API.md §A5) are read from those logs.
// ponytail: the newest 40 transactions of the account, fetched when the tab is shown; add paging or a services
// endpoint if accounts trade more than that.

import { CONTRACT_ID, NETWORK } from './config.ts';

const API = NETWORK === 'mainnet' ? 'https://tx.main.fastnear.com/v0' : 'https://tx.test.fastnear.com/v0';
const LIMIT = 40;
const KINDS = ['open', 'close', 'liquidate'] as const;
type Kind = (typeof KINDS)[number];

export type Fill = {
  hash: string;
  /** Block time in ms. */
  ts: number;
  kind: Kind;
  positionId: string;
  /** From the position's `open` event, when it is among the fetched transactions. */
  marketId?: string;
  isLong?: boolean;
  notional?: string;
  price: string;
  fee?: string;
  /** What the trader made or lost when the position ended (micro-USDC). */
  realized?: bigint;
};

export type IndexedTx = {
  transaction: { hash: string };
  execution_outcome: { block_timestamp: number | string };
  receipts?: { execution_outcome: { outcome: { executor_id: string; logs: string[] } } }[];
};

type EventData = Record<string, string | boolean>;

/** The account's trades in those transactions, newest first. Only logs written by the Aura contract count. */
export function parseFills(txs: IndexedTx[], owner: string, contractId: string): Fill[] {
  const events: { hash: string; ts: number; kind: Kind; data: EventData }[] = [];
  for (const tx of txs) {
    for (const r of tx.receipts ?? []) {
      const { executor_id, logs } = r.execution_outcome.outcome;
      if (executor_id !== contractId) continue; // another contract can write a look-alike log
      for (const log of logs) {
        if (!log.startsWith('EVENT_JSON:')) continue;
        let e: { standard?: string; event?: string; data?: EventData };
        try {
          e = JSON.parse(log.slice('EVENT_JSON:'.length));
        } catch {
          continue;
        }
        if (e.standard !== 'aura-perps' || !KINDS.includes(e.event as Kind) || e.data?.owner !== owner) continue;
        events.push({ hash: tx.transaction.hash, ts: Number(tx.execution_outcome.block_timestamp) / 1e6, kind: e.event as Kind, data: e.data });
      }
    }
  }
  const opens = new Map(events.filter((e) => e.kind === 'open').map((e) => [e.data.position_id, e.data]));
  return events
    .map(({ hash, ts, kind, data }): Fill => {
      const open = opens.get(data.position_id);
      const s = (v: string | boolean | undefined) => (v === undefined ? undefined : String(v));
      return {
        hash, ts, kind,
        positionId: String(data.position_id),
        marketId: s(open?.market_id),
        isLong: open ? open.is_long === true : undefined,
        notional: s(open?.notional),
        price: String(data.price),
        fee: kind === 'liquidate' ? undefined : String(data.fee),
        // A close pays out collateral + pnl − funding − fee, so that is the result. A liquidation leaves the
        // trader nothing: the whole collateral is lost.
        realized:
          kind === 'close'
            ? BigInt(String(data.pnl)) - BigInt(String(data.funding)) - BigInt(String(data.fee))
            : kind === 'liquidate' && open
              ? -BigInt(String(open.collateral))
              : undefined,
      };
    })
    .sort((a, b) => b.ts - a.ts);
}

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`History request failed (${res.status})`);
  return res.json();
}

/**
 * A liquidation is sent by the keeper and names the trader only inside the event, which this index does not link to
 * the trader's account. So the keeper's recent transactions are read too.
 * ponytail: assumes the keeper is `keeper.<owner>` next to `perps.<owner>` (scripts/01-create-accounts.sh); a
 * liquidation sent by any other account is missed. Add the contract's own transactions if others start liquidating.
 */
const KEEPER_ID = CONTRACT_ID.replace(/^perps\./, 'keeper.');

const accountTxs = async (accountId: string, n: number) =>
  (await post<{ account_txs: { transaction_hash: string }[] }>('/account', { account_id: accountId })).account_txs
    .slice(0, n)
    .map((t) => t.transaction_hash);

export async function fetchFills(accountId: string): Promise<Fill[]> {
  const [mine, keeper] = await Promise.all([
    accountTxs(accountId, LIMIT),
    KEEPER_ID !== CONTRACT_ID && KEEPER_ID !== accountId ? accountTxs(KEEPER_ID, 20) : [],
  ]);
  const hashes = [...new Set([...mine, ...keeper])];
  // The index answers at most 20 transactions per request.
  const pages = await Promise.all(
    Array.from({ length: Math.ceil(hashes.length / 20) }, (_, i) =>
      post<{ transactions: IndexedTx[] }>('/transactions', { tx_hashes: hashes.slice(i * 20, i * 20 + 20) }),
    ),
  );
  return parseFills(pages.flatMap((p) => p.transactions), accountId, CONTRACT_ID);
}
