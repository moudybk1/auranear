// Integer math, mirrored from contracts/perps/src/math.rs. Money is always bigint:
// USDC has 6 decimals, prices are micro-USD, leverage and rates are basis points.

export const USDC = 1_000_000n;
export const BPS = 10_000n;
export const UNIT = 10n ** 12n;
export const FUNDING = 10n ** 12n;

export const bpsOf = (amount: bigint, bps: bigint | number) => (amount * BigInt(bps)) / BPS;

export const unitsFor = (notional: bigint, price: bigint) => (notional * UNIT) / price;

/** Longs are valued down, shorts are valued up (always against the trader). */
export const valueOf = (units: bigint, price: bigint, roundUp: boolean) =>
  roundUp ? (units * price + UNIT - 1n) / UNIT : (units * price) / UNIT;

export const positionPnl = (isLong: boolean, units: bigint, notional: bigint, price: bigint) =>
  isLong ? valueOf(units, price, false) - notional : notional - valueOf(units, price, true);

/** Positive = the trader pays the vault. */
export function fundingOwed(isLong: boolean, notional: bigint, indexOpen: bigint, indexNow: bigint) {
  const raw = (indexNow - indexOpen) * notional;
  const owed = raw >= 0n ? (raw + FUNDING - 1n) / FUNDING : raw / FUNDING;
  return isLong ? owed : -owed;
}

/** Rate per hour scaled by FUNDING, positive = longs pay. */
export function fundingRatePerHour(
  cfg: { funding_k_bps_per_hour: number; max_funding_bps_per_hour: number },
  long: bigint,
  short: bigint,
  nav: bigint,
) {
  if (nav === 0n) return 0n;
  const perBps = FUNDING / BPS;
  const max = BigInt(cfg.max_funding_bps_per_hour) * perBps;
  const rate = (BigInt(cfg.funding_k_bps_per_hour) * perBps * (long - short)) / nav;
  return rate > max ? max : rate < -max ? -max : rate;
}

/** Price at which equity equals maintenance margin. */
export function liquidationPrice(
  isLong: boolean,
  collateral: bigint,
  notional: bigint,
  units: bigint,
  funding: bigint,
  maintenance: bigint,
) {
  if (units === 0n) return 0n;
  const num = isLong
    ? notional + funding + maintenance - collateral
    : collateral + notional - funding - maintenance;
  return num <= 0n ? 0n : (num * UNIT) / units;
}

// ---------- Client helpers ----------

/** Parses a decimal string without floats. Returns null for anything that is not a plain amount. */
export function toBase(input: string, decimals = 6): bigint | null {
  const s = input.trim().replace(',', '.');
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(frac.slice(0, decimals).padEnd(decimals, '0'));
}

/** Exact decimal string, trailing zeros trimmed. For inputs, not for display. */
export function fromBase(value: bigint, decimals = 6): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const frac = (abs % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${abs / scale}${frac ? `.${frac}` : ''}`;
}

/** What the contract will compute when this order opens at `price`. */
export function quoteOpen(
  collateral: bigint,
  leverageBps: number,
  isLong: boolean,
  price: bigint,
  cfg: { fee_bps: number; maintenance_margin_bps: number },
) {
  const notional = (collateral * BigInt(leverageBps)) / BPS;
  const fee = bpsOf(notional, cfg.fee_bps);
  const maintenance = bpsOf(notional, cfg.maintenance_margin_bps);
  const units = price > 0n ? unitsFor(notional, price) : 0n;
  return {
    notional,
    fee,
    maintenance,
    required: collateral + fee,
    liquidation: liquidationPrice(isLong, collateral, notional, units, 0n, maintenance),
  };
}

/** Room left on one side before the open-interest cap. Never negative. */
export function capacityLeft(nav: bigint, maxOiBps: number, sideNotional: bigint) {
  const left = bpsOf(nav, maxOiBps) - sideNotional;
  return left > 0n ? left : 0n;
}

/** Largest collateral whose collateral + open fee still fits in `free`. */
export function maxCollateral(free: bigint, leverageBps: number, feeBps: number, maxNotional: bigint) {
  const byBalance = (free * BPS * BPS) / (BPS * BPS + BigInt(leverageBps) * BigInt(feeBps));
  const byLimit = (maxNotional * BPS) / BigInt(leverageBps);
  return byBalance < byLimit ? byBalance : byLimit;
}

/** Equity within 1.5x of maintenance margin. */
export const atRisk = (equity: bigint, maintenance: bigint) => equity * 2n <= maintenance * 3n;
