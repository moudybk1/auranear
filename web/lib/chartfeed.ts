// Candle feed for the Vela chart: the three Aura markets, with reference candles from Hyperliquid's perps
// (public info API, no key, nothing about the user is sent), the same venue as the order book. Loaded only
// with the chart. Hyperliquid serves only the newest ~5,000 candles per interval, so 1m reaches back about
// three and a half days and 15m about seven weeks. Orders never fill at these prices; execution is at the
// on-chain oracle price.
// ponytail: no `subscribe`, so Vela polls getBars for the forming candle. Add Hyperliquid's candle WebSocket if ticks should be instant.

import { DataUnavailableError, type DataProvider, type OHLCV } from '@luxalgo/vela';

const API = 'https://api.hyperliquid.xyz/info';
const MAX = 5_000; // Hyperliquid's cap per request, and all the history it keeps

// Hyperliquid prices carry at most five significant figures, which sets the smallest step at today's prices.
const MARKETS: Record<string, { description: string; mintick: number }> = {
  'BTC-USD': { description: 'Bitcoin / US Dollar', mintick: 1 },
  'ETH-USD': { description: 'Ethereum / US Dollar', mintick: 0.1 },
  'NEAR-USD': { description: 'NEAR Protocol / US Dollar', mintick: 0.0001 },
};
// Hyperliquid has no 6h candles.
const MINUTES: Record<number, string> = {
  1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h', 480: '8h', 720: '12h',
};
const TIMEFRAMES = ['1', '3', '5', '15', '30', '60', '120', '240', '480', '720', '1D', '3D', '1W', '1M'];
const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, M: 2_678_400_000 };

/** Vela timeframe to Hyperliquid interval. A bare number or `m` is minutes; `M` is a month. */
export function interval(timeframe: string): string | undefined {
  const m = /^(\d*)([a-zA-Z]?)$/.exec(timeframe.trim());
  if (!m) return undefined;
  const n = Number(m[1] || 1);
  switch (m[2]) {
    case '':
    case 'm': return MINUTES[n];
    case 'h':
    case 'H': return MINUTES[n * 60];
    case 'd':
    case 'D': return n === 1 ? '1d' : n === 3 ? '3d' : undefined;
    case 'w':
    case 'W': return n === 1 ? '1w' : undefined;
    case 'M': return n === 1 ? '1M' : undefined;
    default: return undefined;
  }
}

async function candles(coin: string, iv: string, startTime: number, endTime: number) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'candleSnapshot', req: { coin, interval: iv, startTime: Math.floor(startTime), endTime: Math.floor(endTime) } }),
  });
  if (!res.ok) throw new Error(`Candle request failed (${res.status})`);
  const rows: { t: number; o: string; h: string; l: string; c: string; v: string }[] = await res.json();
  return rows.map((r): OHLCV => ({
    time: r.t, open: Number(r.o), high: Number(r.h), low: Number(r.l), close: Number(r.c), volume: Number(r.v),
  }));
}

export const auraFeed: DataProvider = {
  // The chart shows this next to the symbol, so the candles' source is always on screen.
  info: () => ({
    name: 'hyperliquid',
    displayName: 'Hyperliquid perps (reference)',
    supportedTimeframes: TIMEFRAMES,
    capabilities: { enumerate: true, stream: false, symbolInfo: true },
  }),

  // One request covers any window: Hyperliquid keeps no more than one request's worth of history.
  async getBars(ticker, timeframe, range) {
    const id = ticker.toUpperCase();
    if (!MARKETS[id]) return [];
    const iv = interval(timeframe);
    if (!iv) throw new DataUnavailableError({ reason: 'timeframe', finest: '1', default: '15' });
    const coin = id.split('-')[0];
    const to = range.to ?? Date.now();
    if (range.from !== undefined) return candles(coin, iv, range.from, to);
    // The newest `limit` bars ending at `to`.
    const want = Math.min(range.limit ?? 1_000, MAX);
    const span = Number(iv.slice(0, -1)) * UNIT_MS[iv.slice(-1)];
    const bars = await candles(coin, iv, to - want * span, to);
    return bars.slice(-want);
  },

  async listSymbols() {
    return Object.entries(MARKETS).map(([ticker, m]) => ({ ticker, description: m.description, type: 'crypto' }));
  },

  async getSymbolInfo(ticker) {
    const market = MARKETS[ticker.toUpperCase()];
    if (!market) return undefined;
    return {
      ticker: ticker.toUpperCase(),
      description: market.description,
      type: 'crypto',
      currency: 'USD',
      timezone: 'Etc/UTC',
      session: '24x7',
      mintick: market.mintick,
      timeframes: { finest: '1', default: '15', list: TIMEFRAMES },
    };
  },
};
