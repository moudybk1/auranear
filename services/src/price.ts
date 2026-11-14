// Pure oracle math, bigint only. Prices are micro-USD (docs/API.md).

/** "103245.67" -> 103245670000n. Truncates past 6 decimals. null for anything that is not a plain positive decimal. */
export function toMicro(s: string): bigint | null {
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const value = BigInt(whole) * 1_000_000n + BigInt(frac.slice(0, 6).padEnd(6, '0'));
  return value > 0n ? value : null;
}

function median(values: bigint[]) {
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2n;
}

/** Median of the sources within 2% of the first median. null unless at least two sources agree. */
export function aggregate(prices: bigint[]): bigint | null {
  if (prices.length < 2) return null;
  const first = median(prices);
  const healthy = prices.filter((p) => (p > first ? p - first : first - p) * 50n <= first);
  return healthy.length < 2 ? null : median(healthy);
}

/** Move in bps, rounded up exactly like the contract's `move_bps`. */
export const moveBps = (from: bigint, to: bigint) => ((from > to ? from - to : to - from) * 10_000n + from - 1n) / from;

/**
 * The price to push now, or null to wait. Push when the price moved `pushBps` or the on-chain price is
 * `maxAgeSec` old. A move above the contract's jump limit is walked in steps of (limit - 10 bps), one per poll.
 */
export function nextPush(
  onchain: { price: bigint; ageSec: number; maxJumpBps: bigint },
  target: bigint,
  rule: { pushBps: bigint; maxAgeSec: number },
): bigint | null {
  if (onchain.price === 0n) return target; // a new market takes any first price
  const move = moveBps(onchain.price, target);
  if (move < rule.pushBps && onchain.ageSec < rule.maxAgeSec) return null;
  if (move <= onchain.maxJumpBps) return target;
  const stepBps = onchain.maxJumpBps > 10n ? onchain.maxJumpBps - 10n : 1n;
  const step = (onchain.price * stepBps) / 10_000n;
  return target > onchain.price ? onchain.price + step : onchain.price - step;
}
