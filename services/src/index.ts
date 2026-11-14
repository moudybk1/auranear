// One process: oracle pusher, keeper and GET /health (docs/SERVICES_SPEC.md).
// ponytail: no SQLite and no /prices, /keeper/log, /stats. The web app reads the chain directly; add them when a page needs history.
import { createServer } from 'node:http';
import { yoctoToNear } from 'near-api-js';
import { runKeeper } from './keeper.ts';
import { cfg, keeper, log, oracle, status } from './near.ts';
import { runOracle } from './oracle.ts';

const LOW_BALANCE = 2n * 10n ** 23n; // 0.2 NEAR

async function balances() {
  for (const [name, account] of [['oracle', oracle], ['keeper', keeper]] as const) {
    const yocto = await account.getBalance();
    status.balances[name] = yoctoToNear(yocto, 2);
    if (yocto < LOW_BALANCE) log('warn', name, 'low_balance', { balance_near: status.balances[name] });
  }
}

/** Shape from docs/API.md §B. Always HTTP 200: monitors read `ok`. */
function health() {
  const now = Date.now();
  const oracleOk = cfg.markets.every((id) => {
    const m = status.markets[id];
    return !!m && now / 1_000 - m.ts <= m.staleAfter;
  });
  const keeperOk = now - status.lastScanMs <= 60_000;
  return {
    ok: oracleOk && keeperOk,
    network: cfg.network,
    contract: cfg.contract,
    oracle: {
      ok: oracleOk,
      last_push: Object.fromEntries(Object.entries(status.markets).map(([id, m]) => [id, m.ts])),
      balance_near: status.balances.oracle,
    },
    keeper: {
      ok: keeperOk,
      last_scan: Math.floor(status.lastScanMs / 1_000),
      liquidations_24h: status.liquidationsMs.filter((t) => t > now - 86_400_000).length,
      balance_near: status.balances.keeper,
    },
  };
}

createServer((req, res) => {
  const found = req.method === 'GET' && req.url === '/health';
  res.writeHead(found ? 200 : 404, { 'content-type': 'application/json', 'access-control-allow-origin': cfg.corsOrigin });
  res.end(JSON.stringify(found ? health() : { error: 'not_found' }));
}).listen(cfg.port, () => log('info', 'http', 'listening', { port: cfg.port }));

log('info', 'main', 'start', { network: cfg.network, contract: cfg.contract, markets: cfg.markets });
const checkBalances = () => balances().catch((e) => log('error', 'main', 'balance_failed', { message: String(e) }));
checkBalances();
setInterval(checkBalances, 60_000);
runOracle();
runKeeper();
