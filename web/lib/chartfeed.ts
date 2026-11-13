// Candle feed for the Vela chart: the three Aura markets, with reference candles from Binance's
// public market-data mirror (no key, nothing about the user is sent). Loaded only with the chart.
// Orders never fill at these prices; execution is at the on-chain oracle price.
// ponytail: no `subscribe`, so Vela polls getBars for the forming candle. Add a kline WebSocket if ticks should be instant.

import { DataUnavailableError, type DataProvider, type OHLCV } from '@luxalgo/vela';

const API = 'https://data-api.binance.vision/api/v3';
const PAGE = 1000; // Binance's cap per request
const MAX_PAGES = 10;

const MARKETS: Record<string, { symbol: string; description: string; mintick: number }> = {
  'BTC-USD': { symbol: 'BTCUSDT', description: 'Bitcoin / US Dollar', mintick: 0.1 },
  'ETH-USD': { symbol: 'ETHUSDT', description: 'Ethereum / US Dollar', mintick: 0.01 },
  'NEAR-USD': { symbol: 'NEARUSDT', description: 'NEAR Protocol / US Dollar', mintick: 0.001 },
};
const MINUTES: Record<number, string> = {
  1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h', 360: '6h', 480: '8h', 720: '12h',
};
const TIMEFRAMES = ['1', '3', '5', '15', '30', '60', '120', '240', '360', '480', '720', '1D', '3D', '1W', '1M'];

/** Vela timeframe to Binance interval. A bare number or `m` is minutes; `M` is a month. */
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

async function klines(symbol: string, iv: string, params: { startTime?: number; endTime?: number; limit: number }) {
  const q = new URLSearchParams({ symbol, interval: iv });
  for (const [key, value] of Object.entries(params)) if (value !== undefined) q.set(key, String(Math.floor(value)));
  const res = await fetch(`${API}/klines?${q}`);
  if (!res.ok) throw new Error(`Candle request failed (${res.status})`);
  const rows: (string | number)[][] = await res.json();
  return rows.map((r): OHLCV => ({
    time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]),
  }));
}

export const auraFeed: DataProvider = {
  // The chart shows this next to the symbol, so the candles' source is always on screen.
  info: () => ({
    name: 'binance',
    displayName: 'Binance spot (reference)',
    supportedTimeframes: TIMEFRAMES,
    capabilities: { enumerate: true, stream: false, symbolInfo: true },
  }),

  async getBars(ticker, timeframe, range) {
    const market = MARKETS[ticker.toUpperCase()];
    if (!market) return [];
    const iv = interval(timeframe);
    if (!iv) throw new DataUnavailableError({ reason: 'timeframe', finest: '1', default: '15' });

    const bars: OHLCV[] = [];
    if (range.from !== undefined) {
      // A window: walk forward from its start.
      let start = range.from;
      for (let page = 0; page < MAX_PAGES; page++) {
        const chunk = await klines(market.symbol, iv, { startTime: start, endTime: range.to, limit: PAGE });
        bars.push(...chunk);
        if (chunk.length < PAGE) break;
        start = chunk[chunk.length - 1].time + 1;
      }
      return bars;
    }
    // The newest `limit` bars ending at `to`: walk backward.
    const want = Math.min(range.limit ?? PAGE, PAGE * MAX_PAGES);
    let end = range.to;
    while (bars.length < want) {
      const ask = Math.min(PAGE, want - bars.length);
      const chunk = await klines(market.symbol, iv, { endTime: end, limit: ask });
      bars.unshift(...chunk);
      if (chunk.length < ask) break; // reached the start of the market's history
      end = chunk[0].time - 1;
    }
    return bars;
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
