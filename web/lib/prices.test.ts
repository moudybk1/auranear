import assert from 'node:assert/strict';
import { test } from 'node:test';
import { group } from './prices.ts';

test('order book grouping: bids round down, asks round up, totals run, rows cap', () => {
  const rows = (r: ReturnType<typeof group>) => r.map((x) => [x.k, x.size, x.total]);
  assert.deepEqual(rows(group([[100.4, 1], [100.1, 2], [99.9, 3]], 1, 'bid', 5)), [[100, 3, 3], [99, 3, 6]]);
  assert.deepEqual(rows(group([[100.4, 1], [100.6, 2], [101.2, 3]], 1, 'ask', 1)), [[101, 3, 3]]);
  assert.deepEqual(rows(group([[101, 1]], 1, 'ask', 1)), [[101, 1, 1]]); // an exact step stays put
  assert.equal(group([[3.115, 1]], 0.005, 'bid', 1)[0].k, 623); // float error does not drop a step
});
