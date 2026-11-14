// Oracle pusher (docs/SERVICES_SPEC.md §3): median of public spot prices -> set_price. Never calls set_price_force.
import { setTimeout as sleep } from 'node:timers/promises';
import { call, cfg, log, oracle, status, view } from './near.ts';
import { aggregate, nextPush, toMicro } from './price.ts';

// Public tickers, no API key. URLs and response shapes were checked live on 13 Nov 2026.
// All three quote in USDT, which is treated as USD (a trust assumption, see README).
// ponytail: only venues reachable from the dev network. Add USD venues (Coinbase, Kraken) after checking them from the host.
const SOURCES: [name: string, url: (base: string) => string, pick: (body: string) => unknown][] = [
  ['binance', (b) => `https://data-api.binance.vision/api/v3/ticker/price?symbol=${b}USDT`, (t) => JSON.parse(t).price],
  ['gate', (b) => `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${b}_USDT`, (t) => JSON.parse(t)[0]?.last],
  // HTX sends prices as JSON numbers: read the digits from the text so no float is involved.
  ['htx', (b) => `https://api.huobi.pro/market/detail/merged?symbol=${b.toLowerCase()}usdt`, (t) => /"close":([\d.]+)/.exec(t)?.[1]],
];

const down = new Set<string>();
/** Logs a problem once when it starts and once when it ends, not on every poll. */
function report(what: string, bad: boolean, message?: string) {
  if (bad === down.has(what)) return;
  if (bad) down.add(what);
  else down.delete(what);
  log(bad ? 'warn' : 'info', 'oracle', bad ? 'down' : 'recovered', { what, message });
}

async function quotes(market: string) {
  const base = market.split('-')[0];
  const prices = await Promise.all(
    SOURCES.map(async ([name, url, pick]) => {
      try {
        const res = await fetch(url(base), { signal: AbortSignal.timeout(3_000) });
        const price = toMicro(String(pick(await res.text())));
        if (price === null) throw new Error(`no price in the response (HTTP ${res.status})`);
        report(`${market}/${name}`, false);
        return price;
      } catch (e) {
        report(`${market}/${name}`, true, String(e));
        return null;
      }
    }),
  );
  return prices.filter((p) => p !== null);
}

type Market = { id: string; price: string; price_ts_sec: string; config: { max_price_jump_bps: number; stale_after_sec: number } };

const backoffSec: Record<string, number> = {};
const retryAt: Record<string, number> = {};

async function poll() {
  const markets = await view<Market[]>('get_markets');
  // One market at a time: a single oracle key means one nonce in flight.
  for (const id of cfg.markets) {
    const now = Math.floor(Date.now() / 1000);
    try {
      const m = markets.find((x) => x.id === id);
      if (!m) throw new Error('This market is not on the contract');
      status.markets[id] = { ts: Number(m.price_ts_sec), staleAfter: m.config.stale_after_sec };
      if (now < (retryAt[id] ?? 0)) continue;

      const target = aggregate(await quotes(id));
      report(`${id}/price`, target === null, 'Fewer than two sources agree. Not pushing, so the price will go stale.');
      if (target === null) continue;

      const price = nextPush(
        { price: BigInt(m.price), ageSec: now - Number(m.price_ts_sec), maxJumpBps: BigInt(m.config.max_price_jump_bps) },
        target,
        { pushBps: cfg.pushBps, maxAgeSec: cfg.pushMaxSec },
      );
      if (price === null) continue;

      const ts = Math.max(now, Number(m.price_ts_sec) + 1); // the contract wants a strictly newer timestamp
      const hash = await call(oracle, 'set_price', { market_id: id, price: String(price), ts_sec: String(ts) }, 30);
      status.markets[id].ts = ts;
      backoffSec[id] = 0;
      log(price === target ? 'info' : 'warn', 'oracle', price === target ? 'pushed' : 'pushed_step', {
        market: id, price: String(price), target: String(target), tx_hash: hash,
      });
    } catch (e) {
      backoffSec[id] = Math.min(60, (backoffSec[id] || cfg.oraclePollSec) * 2);
      retryAt[id] = now + backoffSec[id];
      log('error', 'oracle', 'push_failed', { market: id, retry_in_sec: backoffSec[id], message: String((e as Error).message) });
    }
  }
}

export async function runOracle() {
  for (;;) {
    await poll().catch((e) => log('error', 'oracle', 'poll_failed', { message: String(e) }));
    await sleep(cfg.oraclePollSec * 1_000);
  }
}
