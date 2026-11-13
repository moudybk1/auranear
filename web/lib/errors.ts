// Contract panic messages and deposit refund reasons, mapped to UI copy (docs/API.md §A6).
// Order matters: the first match wins, so longer messages come before their prefixes.
import type { Key } from './i18n.tsx';

const PANICS: [needle: string, key: Key][] = [
  ['Account not registered', 'err.notRegistered'],
  ['Not enough free balance for collateral + fee', 'err.balanceFee'],
  ['Not enough free balance', 'err.balance'],
  ["doesn't have enough balance", 'err.wallet'],
  ['Oracle price is stale', 'err.stale'],
  ['Open interest limit reached', 'err.oiFull'],
  ['Position notional above limit', 'err.notional'],
  ['Collateral below minimum', 'err.minCollateral'],
  ['Leverage above market maximum', 'err.leverage'],
  ['Leverage must be at least 1x', 'err.leverage'],
  ['Too many open positions', 'err.tooMany'],
  ['Position is liquidatable', 'err.liquidatable'],
  ['Not your position', 'err.notYours'],
  ['Withdrawal would push open interest', 'err.lpOi'],
  ['A market with open interest has a stale price', 'err.lpStale'],
  ['Vault liquidity is locked', 'err.lpLocked'],
  ['Paused', 'err.paused'],
];

const REFUNDS: [needle: string, key: Key][] = [
  ['paused', 'err.paused'],
  ['account not registered', 'err.notRegistered'],
  ['over per-user collateral cap', 'err.userCap'],
  ['over vault cap', 'err.vaultCap'],
  ['stale price', 'err.lpStale'],
];

export function errorKey(e: unknown): Key {
  const message = e instanceof Error ? e.message : String(e);
  const hit = PANICS.find(([needle]) => message.includes(needle));
  if (hit) return hit[1];
  return /reject|cancel|denied|closed/i.test(message) ? 'err.rejected' : 'err.unknown';
}

/** `log` is the "Refunding deposit: <reason>" line of a refunded deposit. */
export function refundKey(log: string): Key {
  return REFUNDS.find(([needle]) => log.includes(needle))?.[1] ?? 'err.unknown';
}
