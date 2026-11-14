import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFills, type IndexedTx } from './history.ts';

const C = 'perps.test';
const ME = 'me.test';
const ev = (event: string, data: object) => `EVENT_JSON:${JSON.stringify({ standard: 'aura-perps', version: '1.0.0', event, data })}`;
const tx = (hash: string, ms: number, executor: string, logs: string[]): IndexedTx => ({
  transaction: { hash },
  execution_outcome: { block_timestamp: String(ms * 1e6) },
  receipts: [{ execution_outcome: { outcome: { executor_id: executor, logs } } }],
});

test('trade history: joins closes to opens, prices liquidations, ignores others and look-alikes', () => {
  const fills = parseFills(
    [
      tx('a', 1_000, C, [ev('open', { position_id: '1', owner: ME, market_id: 'BTC-USD', is_long: false, collateral: '10000000', notional: '20000000', price: '67192680000', fee: '20000' })]),
      // The testnet close of position 1: payout 9,979,993 = collateral 10,000,000 − 20,007.
      tx('b', 2_000, C, [ev('close', { position_id: '1', owner: ME, price: '67192680000', pnl: '0', funding: '7', fee: '20000', payout: '9979993' })]),
      tx('c', 3_000, C, [
        ev('open', { position_id: '2', owner: ME, market_id: 'NEAR-USD', is_long: true, collateral: '5000000', notional: '50000000', price: '3000000', fee: '50000' }),
        ev('open', { position_id: '3', owner: 'other.test', market_id: 'ETH-USD', is_long: true, collateral: '1', notional: '1', price: '1', fee: '0' }),
        ev('deposit', { account_id: ME, amount: '5' }),
        'not an event',
      ]),
      tx('d', 4_000, C, [ev('liquidate', { position_id: '2', owner: ME, liquidator: 'keeper.test', price: '2800000', equity: '1', reward: '0', bad_debt: '0', insurance_cover: '0' })]),
      tx('e', 5_000, 'evil.test', [ev('close', { position_id: '9', owner: ME, price: '1', pnl: '999', funding: '0', fee: '0', payout: '0' })]),
    ],
    ME,
    C,
  );
  assert.deepEqual(fills.map((f) => [f.hash, f.kind]), [['d', 'liquidate'], ['c', 'open'], ['b', 'close'], ['a', 'open']]);
  const [liq, , close] = fills;
  assert.equal(close.realized, -20_007n);
  assert.equal(close.marketId, 'BTC-USD');
  assert.equal(close.isLong, false);
  assert.equal(close.notional, '20000000');
  assert.equal(liq.realized, -5_000_000n);
  assert.equal(liq.fee, undefined);
  assert.equal(fills[3].ts, 1_000);
});
