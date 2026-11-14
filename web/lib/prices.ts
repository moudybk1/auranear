// Reference market data from Hyperliquid's perps: 24h stats and last prices here, the order book below, candles in
// lib/chartfeed.ts. Public info API, no key, nothing about the user is sent. Orders never fill at these prices:
// execution is always at the on-chain oracle price.

const HL = 'https://api.hyperliquid.xyz/info';
const MARKETS = ['BTC-USD', 'ETH-USD', 'NEAR-USD'];

export type Ticker = { last: string; changePct: number; high: number; low: number };

async function info<T>(body: object): Promise<T> {
  const res = await fetch(HL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Market data request failed (${res.status})`);
  return res.json();
}

type Level = [price: number, size: number];
export type Depth = { bids: Level[]; asks: Level[] };

/**
 * Reference perp depth from Hyperliquid's public info API (no key, open CORS), best level first on both sides.
 * Up to 20 levels a side. nSigFigs 4 groups them on their side: $10 for BTC, $1 for ETH, $0.001 for NEAR at
 * today's prices.
 */
export async function fetchDepth(marketId: string): Promise<Depth> {
  const { levels } = await info<{ levels: { px: string; sz: string }[][] }>({ type: 'l2Book', coin: marketId.split('-')[0], nSigFigs: 4 });
  const parse = (rows: { px: string; sz: string }[]) => rows.map((r): Level => [Number(r.px), Number(r.sz)]);
  return { bids: parse(levels[0]), asks: parse(levels[1]) };
}

/** Groups best-first levels into `step`-wide rows (bids round down, asks up), with a running total. */
export function group(levels: Level[], step: number, side: 'bid' | 'ask', rows: number) {
  const out: { k: number; price: number; size: number; total: number }[] = [];
  for (const [p, q] of levels) {
    // The epsilon keeps float error (3.115 / 0.005) from snapping a level one step off.
    const k = side === 'bid' ? Math.floor(p / step + 1e-9) : Math.ceil(p / step - 1e-9);
    const last = out[out.length - 1];
    if (last?.k === k) last.size += q;
    else if (out.length === rows) break;
    else out.push({ k, price: k * step, size: q, total: 0 });
  }
  let total = 0;
  for (const r of out) r.total = total += r.size;
  return out;
}

/** 24h high and low from the last 24 hourly candles, refreshed once a minute (each candle request costs more). */
let range: { at: number; byId: Record<string, { high: number; low: number }> } = { at: 0, byId: {} };
async function dayRange() {
  if (Date.now() - range.at < 60_000) return range.byId;
  const end = Date.now();
  const rows = await Promise.all(
    MARKETS.map((id) =>
      info<{ h: string; l: string }[]>({ type: 'candleSnapshot', req: { coin: id.split('-')[0], interval: '1h', startTime: end - 86_400_000, endTime: end } }),
    ),
  );
  const byId: Record<string, { high: number; low: number }> = {};
  rows.forEach((candles, i) => {
    if (candles.length) byId[MARKETS[i]] = { high: Math.max(...candles.map((c) => Number(c.h))), low: Math.min(...candles.map((c) => Number(c.l))) };
  });
  range = { at: Date.now(), byId };
  return byId;
}

/** Last price and 24h change from Hyperliquid's asset contexts (one request for every market). */
export async function fetchTickers(): Promise<Record<string, Ticker>> {
  const [[meta, ctxs], highLow] = await Promise.all([
    info<[{ universe: { name: string }[] }, { markPx: string; prevDayPx: string }[]]>({ type: 'metaAndAssetCtxs' }),
    dayRange().catch(() => range.byId),
  ]);
  const out: Record<string, Ticker> = {};
  for (const id of MARKETS) {
    const i = meta.universe.findIndex((a) => a.name === id.split('-')[0]);
    const ctx = ctxs[i];
    if (!ctx) continue;
    const last = Number(ctx.markPx);
    const prev = Number(ctx.prevDayPx);
    const hl = highLow[id] ?? { high: last, low: last };
    out[id] = { last: ctx.markPx, changePct: prev ? ((last - prev) / prev) * 100 : 0, high: Math.max(hl.high, last), low: Math.min(hl.low, last) };
  }
  return out;
}
