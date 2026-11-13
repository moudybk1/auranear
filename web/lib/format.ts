// Display only. Converting to Number here is fine; nothing formatted is ever sent in a transaction.

export type Locale = 'en' | 'id';

const cache = new Map<string, Intl.NumberFormat>();

export function num(value: number, locale: Locale, dp = 2) {
  const key = `${locale}:${dp}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale === 'id' ? 'id-ID' : 'en-US', {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    });
    cache.set(key, f);
  }
  return f.format(value);
}

const MINUS = '−';
const sign = (negative: boolean, positive: boolean) => (negative ? MINUS : positive ? '+' : '');

/** Micro-USDC to "1,234.56". */
export const usd = (value: bigint | string, locale: Locale, dp = 2) => num(Number(value) / 1e6, locale, dp);

/** Signed micro-USDC with a real minus sign: "+12.30", "−4.05". */
export function signedUsd(value: bigint | string, locale: Locale, dp = 2) {
  const v = BigInt(value);
  return sign(v < 0n, v > 0n) + usd(v < 0n ? -v : v, locale, dp);
}

export const priceDp = (price: number) => (price >= 10_000 ? 1 : price >= 100 ? 2 : price >= 1 ? 3 : 5);

/** Micro-USD price with precision that follows its magnitude. */
export function price(value: bigint | string | number, locale: Locale) {
  const n = typeof value === 'number' ? value : Number(value) / 1e6;
  return num(n, locale, priceDp(n));
}

export function signedPct(value: number, locale: Locale, dp = 2) {
  return `${sign(value < 0, value > 0)}${num(Math.abs(value), locale, dp)}%`;
}

export const leverage = (bps: number, locale: Locale) => `${num(bps / 10_000, locale, 1)}x`;

export function age(seconds: number) {
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export const shortAccount = (id: string) => (id.length > 22 ? `${id.slice(0, 10)}…${id.slice(-8)}` : id);
