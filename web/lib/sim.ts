// Demo mode only: an in-browser stand-in for contracts/perps/src/lib.rs.
// Same accounting, same rounding, same panic messages, so the UI behaves the way it
// will against the deployed contract. Nothing here touches the network.
// ponytail: instant-execution markets only (no two-step orders); port execute_order when GPU-H100 ships.

import type { AccountView, ConfigView, MarketConfig, MarketView, PositionView, VaultView } from './types.ts';
import {
  BPS, FUNDING, USDC, bpsOf, fundingOwed, fundingRatePerHour, liquidationPrice, positionPnl, unitsFor, valueOf,
} from './math.ts';

export const SIM_CONTRACT = 'perps.aura-demo.testnet';
export const SIM_TOKEN = 'tusd.aura-demo.testnet';
export const SIM_ACCOUNT = 'trader.aura-demo.testnet';
const KEEPER = 'keeper.aura-demo.testnet';
const LP = 'lp.aura-demo.testnet';
const MS_PER_HOUR = 3_600_000n;

// scripts/03-add-markets.sh and the testnet caps in scripts/config.sh
const CRYPTO: MarketConfig = {
  max_leverage_bps: 100_000,
  maintenance_margin_bps: 500,
  fee_bps: 10,
  max_oi_bps_of_nav: 3_000,
  stale_after_sec: 600,
  max_price_jump_bps: 500,
  funding_k_bps_per_hour: 10,
  max_funding_bps_per_hour: 5,
  two_step: false,
};
const LIMITS = {
  vault_cap: 100_000n * USDC,
  max_user_collateral: 10_000n * USDC,
  max_position_notional: 10_000n * USDC,
  min_collateral: 1n * USDC,
  max_positions_per_account: 5,
  liquidator_reward_bps: 2_000,
  insurance_fee_share_bps: 1_000,
};

type Market = {
  config: MarketConfig;
  price: bigint;
  priceTsSec: number;
  longNotional: bigint;
  shortNotional: bigint;
  longUnits: bigint;
  shortUnits: bigint;
  fundingIndex: bigint;
  lastFundingMs: number;
};
type Account = { free: bigint; locked: bigint; lpShares: bigint; positions: number[] };
type Position = {
  owner: string;
  marketId: string;
  isLong: boolean;
  collateral: bigint;
  notional: bigint;
  units: bigint;
  entryPrice: bigint;
  fundingIndexOpen: bigint;
  openedAtSec: number;
};
type State = {
  paused: boolean;
  vault: { assets: bigint; totalShares: bigint; insurance: bigint; pendingFunding: bigint };
  accounts: Record<string, Account>;
  markets: Record<string, Market>;
  positions: Record<string, Position>;
  nextId: number;
  /** Token balances outside the contract. */
  wallets: Record<string, bigint>;
  /** Tokens the contract holds. Must equal trader balances + vault assets + insurance. */
  held: bigint;
  seeded: boolean;
};

const fail = (message: string): never => {
  throw new Error(message);
};

export class Sim {
  s: State;
  now: () => number;

  constructor(now: () => number = Date.now, saved?: string | null) {
    this.now = now;
    const market = (): Market => ({
      config: CRYPTO, price: 0n, priceTsSec: 0, longNotional: 0n, shortNotional: 0n,
      longUnits: 0n, shortUnits: 0n, fundingIndex: 0n, lastFundingMs: now(),
    });
    this.s = saved
      ? JSON.parse(saved, (_, v) => (typeof v === 'string' && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v))
      : {
          paused: false,
          vault: { assets: 0n, totalShares: 0n, insurance: 0n, pendingFunding: 0n },
          accounts: {},
          markets: { 'BTC-USD': market(), 'ETH-USD': market(), 'NEAR-USD': market() },
          positions: {},
          nextId: 0,
          wallets: {},
          held: 0n,
          seeded: false,
        };
  }

  serialize() {
    return JSON.stringify(this.s, (_, v) => (typeof v === 'bigint' ? `${v}n` : v));
  }

  // ---------- Oracle, keeper, faucet ----------

  /** Oracle push for every market, then a keeper pass over all positions. */
  pushPrices(prices: Record<string, bigint>) {
    for (const [id, price] of Object.entries(prices)) {
      if (!this.s.markets[id] || price <= 0n) continue;
      this.accrue(id);
      this.s.markets[id].price = price;
      this.s.markets[id].priceTsSec = this.nowSec();
    }
    if (!this.s.seeded && Object.values(this.s.markets).every((m) => m.price > 0n)) this.seed();
    for (const id of Object.keys(this.s.positions)) {
      if (this.positionView(id).liquidatable) this.liquidate(id, KEEPER);
    }
  }

  prices(): Record<string, bigint> {
    return Object.fromEntries(Object.entries(this.s.markets).map(([id, m]) => [id, m.price]));
  }

  /** Test tokens for a wallet the first time it connects. */
  faucet(id: string, amount = 10_000n * USDC) {
    this.s.wallets[id] ??= amount;
  }

  /** An LP and a few resting positions, so open interest, funding and capacity are not all zero. */
  private seed() {
    const s = this.s;
    const join = (id: string, tokens: bigint) => {
      s.wallets[id] = tokens;
      this.call(id, SIM_CONTRACT, 'storage_deposit', {});
    };
    join(KEEPER, 0n);
    join(LP, 60_000n * USDC);
    this.call(LP, SIM_TOKEN, 'ft_transfer_call', { amount: String(60_000n * USDC), msg: 'lp' });
    const book: [market: string, isLong: boolean, collateral: bigint, leverageBps: number][] = [
      ['BTC-USD', true, 1_400n, 40_000],
      ['BTC-USD', false, 900n, 30_000],
      ['ETH-USD', true, 650n, 30_000],
      ['ETH-USD', false, 1_100n, 40_000],
      ['NEAR-USD', true, 520n, 50_000],
      ['NEAR-USD', false, 300n, 30_000],
    ];
    book.forEach(([market, isLong, collateral, leverageBps], i) => {
      const id = `mm-${i + 1}.aura-demo.testnet`;
      const deposit = collateral * USDC * 2n;
      join(id, deposit);
      this.call(id, SIM_TOKEN, 'ft_transfer_call', { amount: String(deposit), msg: 'deposit' });
      this.call(id, SIM_CONTRACT, 'open_position', {
        market_id: market, is_long: isLong, collateral: String(collateral * USDC), leverage_bps: leverageBps,
      });
    });
    s.seeded = true;
  }

  // ---------- Change methods ----------

  /** Runs one function call. Returns the transaction logs; throws with the contract's panic message. */
  call(signer: string, receiverId: string, method: string, args: Record<string, unknown>): string[] {
    const s = this.s;
    const logs: string[] = [];
    if (receiverId === SIM_TOKEN) {
      if (method !== 'ft_transfer_call') fail(`Unknown token method ${method}`);
      const amount = BigInt(args.amount as string);
      if ((s.wallets[signer] ?? 0n) < amount) fail("The account doesn't have enough balance");
      s.wallets[signer] -= amount;
      s.held += amount;
      const refund = this.onTransfer(signer, amount, args.msg as string, logs);
      s.held -= refund;
      s.wallets[signer] += refund;
      return logs;
    }
    switch (method) {
      case 'storage_deposit':
        s.accounts[signer] ??= { free: 0n, locked: 0n, lpShares: 0n, positions: [] };
        break;
      case 'open_position':
        this.open(
          signer, args.market_id as string, args.is_long as boolean,
          BigInt(args.collateral as string), args.leverage_bps as number,
        );
        break;
      case 'close_position': {
        const id = String(args.position_id);
        if (this.position(id).owner !== signer) fail('Not your position');
        this.close(id);
        break;
      }
      case 'withdraw': {
        const amount = BigInt(args.amount as string);
        if (amount <= 0n) fail('Amount must be positive');
        const acc = this.account(signer);
        if (acc.free < amount) fail('Not enough free balance');
        acc.free -= amount;
        this.payOut(signer, amount);
        break;
      }
      case 'lp_withdraw':
        this.lpWithdraw(signer, BigInt(args.shares as string));
        break;
      default:
        fail(`Unknown method ${method}`);
    }
    return logs;
  }

  /** ft_on_transfer: returns the refunded amount. */
  private onTransfer(sender: string, amount: bigint, msg: string, logs: string[]): bigint {
    const s = this.s;
    const refund = (reason: string) => {
      logs.push(`Refunding deposit: ${reason}`);
      return amount;
    };
    if (s.paused) return refund('paused');
    const acc = s.accounts[sender];
    if (!acc) return refund('account not registered, call storage_deposit first');
    if (amount === 0n) return refund('zero amount');
    if (msg === 'deposit') {
      if (acc.free + acc.locked + amount > LIMITS.max_user_collateral) return refund('over per-user collateral cap');
      acc.free += amount;
      return 0n;
    }
    if (msg === 'lp') {
      if (!this.navReliable()) return refund('a market with open interest has a stale price, try again later');
      this.accrueAll();
      const nav = this.nav();
      if (nav + amount > LIMITS.vault_cap) return refund('over vault cap');
      const shares = s.vault.totalShares === 0n || nav === 0n ? amount : (amount * s.vault.totalShares) / nav;
      if (shares === 0n) return refund('amount too small');
      acc.lpShares += shares;
      s.vault.totalShares += shares;
      s.vault.assets += amount;
      return 0n;
    }
    return refund('unknown msg, use "deposit" or "lp"');
  }

  private open(owner: string, marketId: string, isLong: boolean, collateral: bigint, leverageBps: number) {
    const s = this.s;
    if (s.paused) fail('Paused');
    const m = this.market(marketId);
    if (BigInt(leverageBps) < BPS) fail('Leverage must be at least 1x');
    if (leverageBps > m.config.max_leverage_bps) fail('Leverage above market maximum');
    if (collateral < LIMITS.min_collateral) fail('Collateral below minimum');
    const notional = (collateral * BigInt(leverageBps)) / BPS;
    if (notional > LIMITS.max_position_notional) fail('Position notional above limit');
    const fee = bpsOf(notional, m.config.fee_bps);
    const acc = this.account(owner);
    if (acc.positions.length >= LIMITS.max_positions_per_account) fail('Too many open positions or orders');
    if (acc.free < collateral + fee) fail('Not enough free balance for collateral + fee');

    this.accrue(marketId);
    if (!this.isFresh(m)) fail('Oracle price is stale');
    const side = isLong ? m.longNotional : m.shortNotional;
    if (side + notional > bpsOf(this.nav(), m.config.max_oi_bps_of_nav)) {
      fail('Open interest limit reached for this side');
    }

    const units = unitsFor(notional, m.price);
    if (isLong) {
      m.longNotional += notional;
      m.longUnits += units;
    } else {
      m.shortNotional += notional;
      m.shortUnits += units;
    }
    const insurance = bpsOf(fee, LIMITS.insurance_fee_share_bps);
    s.vault.insurance += insurance;
    s.vault.assets += fee - insurance;
    const id = s.nextId++;
    s.positions[id] = {
      owner, marketId, isLong, collateral, notional, units,
      entryPrice: m.price, fundingIndexOpen: m.fundingIndex, openedAtSec: this.nowSec(),
    };
    acc.free -= collateral + fee;
    acc.locked += collateral;
    acc.positions.push(id);
  }

  private close(id: string) {
    const s = this.s;
    const pos = this.position(id);
    this.accrue(pos.marketId);
    const m = this.market(pos.marketId);
    if (!this.isFresh(m)) fail('Oracle price is stale');
    const pnl = positionPnl(pos.isLong, pos.units, pos.notional, m.price);
    const funding = fundingOwed(pos.isLong, pos.notional, pos.fundingIndexOpen, m.fundingIndex);
    const fee = bpsOf(pos.notional, m.config.fee_bps);
    const maintenance = bpsOf(pos.notional, m.config.maintenance_margin_bps);
    const equity = pos.collateral + pnl - funding;
    if (equity <= maintenance) fail('Position is liquidatable, it can only be liquidated');
    let payout = equity - fee;
    if (payout < 0n) fail('Payout negative');
    const insurance = bpsOf(fee, LIMITS.insurance_fee_share_bps);
    const available = s.vault.assets + pos.collateral - insurance;
    if (payout > available) payout = available;
    s.vault.assets = available - payout;
    s.vault.insurance += insurance;
    s.vault.pendingFunding -= funding;
    this.removePosition(id, pos);
    const acc = this.account(pos.owner);
    acc.locked -= pos.collateral;
    acc.free += payout;
  }

  private liquidate(id: string, liquidator: string) {
    const s = this.s;
    const pos = this.position(id);
    this.accrue(pos.marketId);
    const m = this.market(pos.marketId);
    if (!this.isFresh(m)) fail('Oracle price is stale');
    const pnl = positionPnl(pos.isLong, pos.units, pos.notional, m.price);
    const funding = fundingOwed(pos.isLong, pos.notional, pos.fundingIndexOpen, m.fundingIndex);
    const equity = pos.collateral + pnl - funding;
    if (equity > bpsOf(pos.notional, m.config.maintenance_margin_bps)) fail('Position is not liquidatable');
    const reward = bpsOf(equity > 0n ? equity : 0n, LIMITS.liquidator_reward_bps);
    const badDebt = equity < 0n ? -equity : 0n;
    const cover = badDebt < s.vault.insurance ? badDebt : s.vault.insurance;
    s.vault.insurance -= cover;
    s.vault.pendingFunding -= funding;
    s.vault.assets += pos.collateral - reward + cover;
    this.removePosition(id, pos);
    this.account(pos.owner).locked -= pos.collateral;
    this.account(liquidator).free += reward;
  }

  private lpWithdraw(id: string, shares: bigint) {
    const s = this.s;
    if (shares <= 0n) fail('Shares must be positive');
    const acc = this.account(id);
    if (acc.lpShares < shares) fail('Not enough LP shares');
    if (!this.navReliable()) fail('A market with open interest has a stale price, try again later');
    this.accrueAll();
    const nav = this.nav();
    const amount = (shares * nav) / s.vault.totalShares;
    if (amount <= 0n) fail('Nothing to withdraw');
    if (amount > s.vault.assets) fail('Vault liquidity is locked, try a smaller amount');
    for (const m of Object.values(s.markets)) {
      const largest = m.longNotional > m.shortNotional ? m.longNotional : m.shortNotional;
      if (largest > bpsOf(nav - amount, m.config.max_oi_bps_of_nav)) {
        fail('Withdrawal would push open interest over the limit');
      }
    }
    acc.lpShares -= shares;
    s.vault.totalShares -= shares;
    s.vault.assets -= amount;
    this.payOut(id, amount);
  }

  private payOut(to: string, amount: bigint) {
    this.s.held -= amount;
    this.s.wallets[to] = (this.s.wallets[to] ?? 0n) + amount;
  }

  private removePosition(id: string, pos: Position) {
    const m = this.market(pos.marketId);
    if (pos.isLong) {
      m.longNotional -= pos.notional;
      m.longUnits -= pos.units;
    } else {
      m.shortNotional -= pos.notional;
      m.shortUnits -= pos.units;
    }
    delete this.s.positions[id];
    const acc = this.account(pos.owner);
    acc.positions = acc.positions.filter((p) => String(p) !== id);
  }

  // ---------- Shared internals ----------

  private nowSec() {
    return Math.floor(this.now() / 1000);
  }

  private account(id: string): Account {
    return this.s.accounts[id] ?? fail('Account not registered, call storage_deposit first');
  }

  private market(id: string): Market {
    return this.s.markets[id] ?? fail('Unknown market');
  }

  private position(id: string): Position {
    return this.s.positions[id] ?? fail('Position not found');
  }

  private isFresh(m: Market) {
    return m.price > 0n && this.nowSec() <= m.priceTsSec + m.config.stale_after_sec;
  }

  private navReliable() {
    return Object.values(this.s.markets).every(
      (m) => (m.longNotional === 0n && m.shortNotional === 0n) || this.isFresh(m),
    );
  }

  /** NAV = assets - traders' unrealised PnL + funding owed to the vault. Never negative. */
  private nav() {
    let pnl = 0n;
    for (const m of Object.values(this.s.markets)) {
      pnl += valueOf(m.longUnits, m.price, false) - m.longNotional;
      pnl += m.shortNotional - valueOf(m.shortUnits, m.price, true);
    }
    const nav = this.s.vault.assets - pnl + this.s.vault.pendingFunding;
    return nav > 0n ? nav : 0n;
  }

  private navProjected() {
    const nav = this.nav();
    let extra = 0n;
    for (const m of Object.values(this.s.markets)) {
      extra += (this.fundingDelta(m, nav) * (m.longNotional - m.shortNotional)) / FUNDING;
    }
    return nav + extra > 0n ? nav + extra : 0n;
  }

  private fundingDelta(m: Market, nav: bigint) {
    const elapsed = this.now() - m.lastFundingMs;
    if (elapsed <= 0) return 0n;
    return (fundingRatePerHour(m.config, m.longNotional, m.shortNotional, nav) * BigInt(elapsed)) / MS_PER_HOUR;
  }

  private accrue(id: string) {
    const m = this.market(id);
    const delta = this.fundingDelta(m, this.nav());
    if (delta !== 0n) {
      m.fundingIndex += delta;
      this.s.vault.pendingFunding += (delta * (m.longNotional - m.shortNotional)) / FUNDING;
    }
    m.lastFundingMs = this.now();
  }

  private accrueAll() {
    for (const id of Object.keys(this.s.markets)) this.accrue(id);
  }

  // ---------- Views (same JSON as the contract) ----------

  view(method: string, args: Record<string, string> = {}): unknown {
    const s = this.s;
    switch (method) {
      case 'get_config':
        return {
          owner: 'aura-demo.testnet',
          oracle: 'oracle.aura-demo.testnet',
          collateral_token: SIM_TOKEN,
          paused: s.paused,
          limits: {
            ...LIMITS,
            vault_cap: String(LIMITS.vault_cap),
            max_user_collateral: String(LIMITS.max_user_collateral),
            max_position_notional: String(LIMITS.max_position_notional),
            min_collateral: String(LIMITS.min_collateral),
          },
          storage_deposit_yocto: '20000000000000000000000',
        } satisfies ConfigView;
      case 'get_vault': {
        const nav = this.navProjected();
        return {
          assets: String(s.vault.assets),
          insurance: String(s.vault.insurance),
          total_shares: String(s.vault.totalShares),
          nav: String(nav),
          share_price: String(s.vault.totalShares === 0n ? USDC : (nav * USDC) / s.vault.totalShares),
          pending_funding: String(s.vault.pendingFunding),
        } satisfies VaultView;
      }
      case 'get_markets': {
        const nav = this.nav();
        return Object.entries(s.markets).map(
          ([id, m]): MarketView => ({
            id,
            config: m.config,
            price: String(m.price),
            price_ts_sec: String(m.priceTsSec),
            is_fresh: this.isFresh(m),
            long_notional: String(m.longNotional),
            short_notional: String(m.shortNotional),
            funding_index: String(m.fundingIndex),
            funding_rate_bps_per_hour_x1e6: String(
              fundingRatePerHour(m.config, m.longNotional, m.shortNotional, nav) / 100n,
            ),
          }),
        );
      }
      case 'get_account': {
        const a = s.accounts[args.account_id];
        if (!a) return null;
        return {
          free: String(a.free),
          locked: String(a.locked),
          lp_shares: String(a.lpShares),
          lp_value: String(s.vault.totalShares === 0n ? 0n : (a.lpShares * this.navProjected()) / s.vault.totalShares),
          positions: a.positions.map(String),
          orders: [],
        } satisfies AccountView;
      }
      case 'get_positions_of':
        return (s.accounts[args.account_id]?.positions ?? []).map((id) => this.positionView(String(id)));
      case 'ft_balance_of':
        return String(s.wallets[args.account_id] ?? 0n);
      default:
        return fail(`Unknown view ${method}`);
    }
  }

  private positionView(id: string): PositionView {
    const p = this.position(id);
    const m = this.market(p.marketId);
    const indexNow = m.fundingIndex + this.fundingDelta(m, this.nav());
    const pnl = positionPnl(p.isLong, p.units, p.notional, m.price);
    const funding = fundingOwed(p.isLong, p.notional, p.fundingIndexOpen, indexNow);
    const equity = p.collateral + pnl - funding;
    const maintenance = bpsOf(p.notional, m.config.maintenance_margin_bps);
    return {
      id,
      owner: p.owner,
      market_id: p.marketId,
      is_long: p.isLong,
      collateral: String(p.collateral),
      notional: String(p.notional),
      entry_price: String(p.entryPrice),
      mark_price: String(m.price),
      pnl: String(pnl),
      funding_owed: String(funding),
      equity: String(equity),
      maintenance_margin: String(maintenance),
      liquidation_price: String(liquidationPrice(p.isLong, p.collateral, p.notional, p.units, funding, maintenance)),
      liquidatable: this.isFresh(m) && equity <= maintenance,
      opened_at_sec: String(p.openedAtSec),
    };
  }

  /** The contract's accounting invariant. Used by the self-check. */
  balanced() {
    const s = this.s;
    const traders = Object.values(s.accounts).reduce((sum, a) => sum + a.free + a.locked, 0n);
    return traders + s.vault.assets + s.vault.insurance === s.held;
  }
}
