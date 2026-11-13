// Self-check for the client math and the demo simulator: node --test lib/sim.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { USDC, bpsOf, fromBase, liquidationPrice, maxCollateral, quoteOpen, toBase, unitsFor } from './math.ts';
import { SIM_CONTRACT, SIM_TOKEN, Sim } from './sim.ts';
import type { AccountView, PositionView, VaultView } from './types.ts';

const ME = 'me.testnet';
const PRICES = { 'BTC-USD': 72_900n * USDC, 'ETH-USD': 2_020n * USDC, 'NEAR-USD': 3_400_000n };

test('liquidation price matches the contract unit tests', () => {
  const n = 100n * USDC;
  const u = unitsFor(n, 3n * USDC);
  const long = liquidationPrice(true, 10n * USDC, n, u, 0n, bpsOf(n, 500));
  const short = liquidationPrice(false, 10n * USDC, n, u, 0n, bpsOf(n, 500));
  assert.ok(long >= 2_849_990n && long <= 2_850_010n, `long liq ${long}`);
  assert.ok(short >= 3_149_990n && short <= 3_150_010n, `short liq ${short}`);
});

test('amount parsing never goes through floats', () => {
  assert.equal(toBase('12.5'), 12_500_000n);
  assert.equal(toBase('0,1'), 100_000n);
  assert.equal(toBase('1.2345678'), 1_234_567n);
  assert.equal(toBase('abc'), null);
  assert.equal(toBase(''), null);
  assert.equal(fromBase(12_500_000n), '12.5');
  assert.equal(fromBase(9_007_199_254_740_993_000_001n), '9007199254740993.000001');
});

test('full cycle keeps the accounting invariant and matches the order quote', () => {
  let clock = 1_800_000_000_000;
  const sim = new Sim(() => clock);
  const step = (ms: number, prices = PRICES) => {
    clock += ms;
    sim.pushPrices(prices);
    assert.ok(sim.balanced(), 'balances + vault + insurance = tokens held');
  };
  const me = () => sim.view('get_account', { account_id: ME }) as AccountView;
  const mine = () => sim.view('get_positions_of', { account_id: ME }) as PositionView[];
  const call = (receiver: string, method: string, args: Record<string, unknown>) => {
    const logs = sim.call(ME, receiver, method, args);
    assert.ok(sim.balanced());
    return logs;
  };

  step(0);
  sim.faucet(ME);

  // A deposit before activation is refunded, not lost.
  const refunded = call(SIM_TOKEN, 'ft_transfer_call', { amount: String(500n * USDC), msg: 'deposit' });
  assert.match(refunded[0], /^Refunding deposit: account not registered/);
  assert.equal(sim.view('ft_balance_of', { account_id: ME }), String(10_000n * USDC));

  call(SIM_CONTRACT, 'storage_deposit', {});
  call(SIM_TOKEN, 'ft_transfer_call', { amount: String(500n * USDC), msg: 'deposit' });
  assert.equal(me().free, String(500n * USDC));

  // Open: the form's quote must equal what the position reports.
  const collateral = 100n * USDC;
  const quote = quoteOpen(collateral, 50_000, true, PRICES['NEAR-USD'], {
    fee_bps: 10,
    maintenance_margin_bps: 500,
  });
  call(SIM_CONTRACT, 'open_position', {
    market_id: 'NEAR-USD', is_long: true, collateral: String(collateral), leverage_bps: 50_000,
  });
  const [pos] = mine();
  assert.equal(pos.notional, String(quote.notional));
  assert.equal(pos.maintenance_margin, String(quote.maintenance));
  assert.equal(pos.liquidation_price, String(quote.liquidation));
  assert.equal(me().free, String(500n * USDC - quote.required));

  // +2% on NEAR: a 5x long gains about 10% of collateral, minus funding.
  step(60_000, { ...PRICES, 'NEAR-USD': 3_468_000n });
  const up = mine()[0];
  assert.ok(BigInt(up.pnl) > 9_990_000n && BigInt(up.pnl) <= 10n * USDC, `pnl ${up.pnl}`);

  call(SIM_CONTRACT, 'close_position', { position_id: up.id });
  assert.equal(mine().length, 0);
  assert.equal(me().locked, '0');
  assert.ok(BigInt(me().free) > 500n * USDC, 'closed in profit after fees');

  // LP round trip.
  call(SIM_TOKEN, 'ft_transfer_call', { amount: String(1_000n * USDC), msg: 'lp' });
  assert.ok(BigInt(me().lp_shares) > 0n);
  call(SIM_CONTRACT, 'lp_withdraw', { shares: me().lp_shares });
  assert.equal(me().lp_shares, '0');

  // A 10x long is liquidated by the keeper after a 6% drop; the collateral is gone.
  call(SIM_CONTRACT, 'open_position', {
    market_id: 'BTC-USD', is_long: true, collateral: String(50n * USDC), leverage_bps: 100_000,
  });
  const before = BigInt(me().free);
  step(5_000, { ...PRICES, 'BTC-USD': (PRICES['BTC-USD'] * 94n) / 100n });
  assert.equal(mine().length, 0);
  assert.equal(me().locked, '0');
  assert.equal(BigInt(me().free), before);

  call(SIM_CONTRACT, 'withdraw', { amount: me().free });
  assert.equal(me().free, '0');
  assert.throws(() => sim.call(ME, SIM_CONTRACT, 'withdraw', { amount: '1' }), /Not enough free balance/);

  // State survives a reload.
  const restored = new Sim(() => clock, sim.serialize());
  assert.deepEqual(restored.view('get_vault'), sim.view('get_vault'));
  assert.ok(BigInt((restored.view('get_vault') as VaultView).nav) > 0n);
});

test('max collateral leaves room for the fee', () => {
  const free = 500n * USDC;
  const max = maxCollateral(free, 100_000, 10, 10_000n * USDC);
  const q = quoteOpen(max, 100_000, true, 3n * USDC, { fee_bps: 10, maintenance_margin_bps: 500 });
  assert.ok(q.required <= free);
  assert.ok(free - q.required < 10n, 'uses the whole balance');
});
