// Self-check for the oracle's pure math (docs/SERVICES_SPEC.md §7). Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregate, moveBps, nextPush, toMicro } from '../src/price.ts';

const USD = 1_000_000n;
const rule = { pushBps: 30n, maxAgeSec: 300 };
const onchain = (ageSec = 10) => ({ price: 100n * USD, ageSec, maxJumpBps: 500n });

test('decimal strings become micro-USD without floats', () => {
  assert.equal(toMicro('103245.67'), 103_245_670_000n);
  assert.equal(toMicro('3.1'), 3_100_000n);
  assert.equal(toMicro('0.000001'), 1n);
  assert.equal(toMicro('69420.00000000'), 69_420_000_000n);
  for (const bad of ['', '0', '0.0000001', '-1', '1e5', 'undefined', '3.']) assert.equal(toMicro(bad), null, bad);
});

test('median drops outliers and needs two sources that agree', () => {
  assert.equal(aggregate([100n * USD, 102n * USD, 101n * USD]), 101n * USD);
  assert.equal(aggregate([100n * USD, 101n * USD]), 100_500_000n);
  assert.equal(aggregate([100n * USD]), null);
  assert.equal(aggregate([]), null);
  // one source 3% off the median is ignored
  assert.equal(aggregate([100n * USD, 100_500_000n, 103_500_000n]), 100_250_000n);
  // two sources that disagree by 5% are both off the median: no price
  assert.equal(aggregate([100n * USD, 105n * USD]), null);
});

test('pushes at 30 bps or after 300 seconds', () => {
  assert.equal(nextPush(onchain(), 100_290_000n, rule), null);
  assert.equal(nextPush(onchain(), 100_300_000n, rule), 100_300_000n);
  assert.equal(nextPush(onchain(), 99_700_000n, rule), 99_700_000n);
  assert.equal(nextPush(onchain(299), 100n * USD, rule), null);
  assert.equal(nextPush(onchain(300), 100n * USD, rule), 100n * USD);
  assert.equal(nextPush({ ...onchain(), price: 0n }, 3n * USD, rule), 3n * USD);
});

test('a move above the jump limit is walked in steps the contract accepts', () => {
  assert.equal(nextPush(onchain(), 110n * USD, rule), 104_900_000n);
  assert.equal(nextPush(onchain(), 90n * USD, rule), 95_100_000n);
  assert.equal(nextPush(onchain(), 105n * USD, rule), 105n * USD); // exactly at the limit goes in one push
  // an awkward price still lands inside the limit after the contract rounds up
  const from = { price: 71_979_990_001n, ageSec: 10, maxJumpBps: 500n };
  const step = nextPush(from, 60_000n * USD, rule)!;
  assert.ok(moveBps(from.price, step) <= 500n && moveBps(from.price, step) >= 489n);
});
