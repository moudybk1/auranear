// Reference 24h stats and last prices from Binance's public market-data mirror (candles: lib/chartfeed.ts).
// It needs no key and sends nothing about the user. Orders never fill at these prices:
// execution is always at the on-chain oracle price.

const API = 'https://data-api.binance.vision/api/v3';
const SYMBOL: Record<string, string> = { 'BTC-USD': 'BTCUSDT', 'ETH-USD': 'ETHUSDT', 'NEAR-USD': 'NEARUSDT' };

export type Ticker = { last: string; changePct: number; high: number; low: number };

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`Market data request failed (${res.status})`);
  return res.json();
}

export async function fetchTickers(): Promise<Record<string, Ticker>> {
  const symbols = encodeURIComponent(JSON.stringify(Object.values(SYMBOL)));
  const rows = await get<Record<string, string>[]>(`/ticker/24hr?symbols=${symbols}`);
  const out: Record<string, Ticker> = {};
  for (const [id, symbol] of Object.entries(SYMBOL)) {
    const r = rows.find((x) => x.symbol === symbol);
    if (r) out[id] = { last: r.lastPrice, changePct: Number(r.priceChangePercent), high: Number(r.highPrice), low: Number(r.lowPrice) };
  }
  return out;
}
