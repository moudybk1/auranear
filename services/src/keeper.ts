// Keeper (docs/SERVICES_SPEC.md §4): liquidates what get_liquidatable reports. It has no special rights;
// the reward lands in the keeper's free balance on the contract.
// ponytail: liquidations only. Add get_orders -> execute_order when the two-step GPU market ships.
import { setTimeout as sleep } from 'node:timers/promises';
import { call, cfg, keeper, log, status, view } from './near.ts';

const PAGE = 100;
// Someone else got there first, or the price moved back. Not an error.
const SKIP = ['Position is not liquidatable', 'Position not found'];

async function scan() {
  const total = await view<number>('get_num_positions');
  status.lastScanMs = Date.now();
  for (let from = 0; from < total; from += PAGE) {
    for (const id of await view<string[]>('get_liquidatable', { from_index: from, limit: PAGE })) {
      try {
        const hash = await call(keeper, 'liquidate', { position_id: id }, 50);
        status.liquidationsMs.push(Date.now());
        log('info', 'keeper', 'liquidated', { position_id: id, tx_hash: hash });
      } catch (e) {
        const message = String((e as Error).message);
        if (message.includes('Oracle price is stale')) return; // nothing can be liquidated until the oracle is back
        if (!SKIP.some((s) => message.includes(s))) log('error', 'keeper', 'liquidate_failed', { position_id: id, message });
      }
    }
  }
}

export async function runKeeper() {
  for (;;) {
    await scan().catch((e) => log('error', 'keeper', 'scan_failed', { message: String(e) }));
    await sleep(cfg.keeperIntervalSec * 1_000);
  }
}
