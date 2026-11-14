# Aura

**Perpetual futures on NEAR in one small contract: deposit USDC, go long or short BTC, ETH and NEAR with leverage, with an LP vault as the counterparty.** Next: a market on the rental price of GPU compute, so AI agents can lock in what they pay for compute.

Built at NEAR HACKATHON (1–14 Nov 2026).

> Hackathon prototype. **Not audited.** It runs on NEAR **testnet** only, with a test token that has no value. Nothing is deployed on mainnet.

| | |
|---|---|
| Live demo | <https://aura-perps.vercel.app> (testnet) |
| Demo video / X post | _coming soon_ |
| Contract | Testnet: [`perps.aura-perps.testnet`](https://testnet.nearblocks.io/address/perps.aura-perps.testnet). Not deployed on mainnet |

## Status (15 Nov 2026)

| Part | Where | Status |
|---|---|---|
| Perps contract | `contracts/perps` | 44 unit tests pass (redeployed on testnet 15 Nov with the two bug fixes; state kept, vault, accounts and open positions unchanged). Built to wasm (281 KB) and deployed on **testnet** at `perps.aura-perps.testnet` with 3 markets and a 500 tUSD seeded vault. One deposit, open, close, withdraw and LP withdraw cycle ran there and the token balance matched the accounting. Not on mainnet |
| Test token | `contracts/mock-ft` | Deployed on testnet at `tusd.aura-perps.testnet` (testnet only, no value) |
| Deploy scripts | `scripts/` | `01`–`04` run on testnet (near-cli-rs 0.30.1, cargo-near 0.23.0). `05` not run yet. `07-force-price.sh` is a testnet demo helper: the owner forces a price down so a 10x position gets liquidated. `06-push-prices.sh` pushes one manual testnet price per market, a fallback for when the oracle service is not running |
| Design system | `web/styles/`, `web/app/fonts/` | The Aura brand kit's tokens and component styles, copied into the web app as `aura-tokens.css` and `aura-components.css`, with self-hosted fonts. The kit's own folder is not in this repo |
| Specs | `docs/`, `AGENTS.md` | Complete |
| Oracle, keeper, `/health` | `services/` | Built 13 Nov: one Node.js process. The oracle pushes the median of three public spot tickers (Binance, Gate, HTX) when a price moves 10 bps (30 until 15 Nov, when the gap to Binance spot was measured at 30–47 bps, above the 10 bps fee) or every 300 s, the keeper liquidates, and `GET /health` reports both. Run against testnet from a laptop: the three markets went from 19 hours stale to fresh and stayed fresh through a 30-minute check (60 samples, oldest price 303 s); a 10x test position was liquidated by the keeper about 20 s after the owner forced NEAR-USD down 6%; the oracle then walked the price back in two pushes, inside the contract's 5% jump limit. Hosted on a VPS since 14 Nov under systemd: after a forced kill it was answering `/health` again in 7 s. From there the keeper liquidated two 10x test positions within seconds of the owner forcing NEAR-USD down 20%, and the oracle walked the price back in five pushes. On 15 Nov the VPS was checked again: `PRICE_PUSH_BPS=10` is set there, all three markets are fresh, `/health` reports oracle and keeper ok (oracle 12.01 NEAR, keeper 10.29 NEAR). Prices go stale 10 minutes after that process stops, and nothing outside the server watches `/health` yet. No price-history API yet (see the note at the top of `docs/SERVICES_SPEC.md`) |
| Web app | `web/` | Trade and Vault built, hosted at <https://aura-perps.vercel.app> against the testnet contract. Without `web/.env.local` a local copy runs in demo mode (in-browser simulator). On 14 Nov a brand-new testnet account went through the whole cycle from the UI, on a local copy of the code that is hosted, signing through the NEAR CLI wallet: faucet, activation with a deposit, open short, close, vault deposit, vault withdraw, withdraw. Afterwards the contract's token balance equalled user balances + vault assets + insurance. Open long was signed the same way on 13 Nov. The liquidation notice and the paused banner were checked on testnet too. **Not tried:** browser-extension and web wallets, and signing on the hosted site itself (there it was checked for loading, reading the contract, and connecting the NEAR CLI wallet). See `web/README.md` |

Building this? Start with [`AGENTS.md`](AGENTS.md).

## How it works

```
Trader / LP ──► Aura perps contract (vault, positions, markets + oracle, liquidation) ◄── USDC (NEP-141)
                         ▲                         ▲
                   oracle pusher               keeper bot        (off-chain, one Node.js process)
```

- **Pool model**: the LP vault takes the other side of every trade. NAV = vault assets − traders' unrealised PnL + funding owed to the vault, computed from per-market aggregates (no loops over positions).
- **Markets**: `BTC-USD`, `ETH-USD`, `NEAR-USD`, up to 10x, instant execution at the oracle price. `GPU-H100` (two-step execution) is supported by the engine and planned next.
- **Liquidation**: permissionless when `equity ≤ maintenance margin`. 20% of remaining equity goes to the liquidator, the rest to the vault. Bad debt hits the insurance fund (10% of fees) first.
- **Funding**: skew-based, `rate/hour = k × (long OI − short OI) / NAV`, capped, applied through a cumulative index.
- **Oracle**: push model, one oracle account, stale-price and max-jump checks.
- **Safety**: NEP-145 storage deposits; withdrawals and admin calls require 1 yoctoNEAR (full-access key); owner pause (closing and withdrawing still work); hard caps.

| Parameter | BTC-USD, ETH-USD, NEAR-USD | GPU-H100 (next) |
|---|---|---|
| Max leverage | 10x | 5x |
| Maintenance margin | 5% | 10% |
| Open/close fee | 0.1% | 0.1% |
| Max OI per side | 30% of NAV each | 20% of NAV |
| Price stale after | 10 min | 26 h |
| Max price jump per update | 5% | 10% |
| Max funding | 0.05%/h | 0.02%/h |
| Execution | instant | two-step |

## Run it

### Try the hosted demo (testnet)

Open <https://aura-perps.vercel.app>. Prices, markets and the vault load without a wallet.

To trade you need a NEAR testnet account in a wallet that NEAR Connect lists:

0. No testnet NEAR yet? Get a little (about 0.1 is enough, for the 0.02 storage deposit and gas) from the [NEAR faucet](https://docs.near.org/getting-started/faucet) for your account. The test USDC needs no faucet outside the app: it is minted from the app itself in step 2.
1. Connect the wallet and click **Activate account** (a one-time 0.02 NEAR storage deposit).
2. In the same dialog, **Get 1,000 test USDC** mints test tokens to your wallet. Enter an amount to deposit it.
3. Open a long or a short, close it, and withdraw. The Vault page takes LP deposits and withdrawals.

### Try the web app locally in 2 minutes (demo mode, no NEAR account needed)

```bash
cd web
npm install
npm run dev       # http://localhost:3000
```

With no `web/.env.local` the app runs in demo mode: the contract is simulated in your browser, and "Connect wallet" gives you a test account with 10,000 test USDC. Deposit, open a long or a short, close it, withdraw, and deposit to the vault. Nothing is sent on-chain.

### Web app against the testnet contract

Create `web/.env.local` (all three values are public). A running `npm run dev` reloads it:

```
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_CONTRACT_ID=perps.aura-perps.testnet
NEXT_PUBLIC_USDC_ID=tusd.aura-perps.testnet
```

The header badge switches to Testnet and prices, markets and the vault are read from the contract. To trade you need a NEAR testnet account in a wallet that NEAR Connect lists; the deposit dialog has a button that mints 1,000 test USDC. If the Oracle update cell shows Stale, the oracle service is down and opening positions is disabled until a fresh price arrives. Details and what has been run: [`web/README.md`](web/README.md).

### Contract tests (no NEAR account needed)

Needs Rust 1.95 or newer (near-sdk 5.30).

```bash
cd contracts/perps
cargo test        # test result: ok. 44 passed
```

### Oracle and keeper

Needs Node.js 22.22 or newer (it runs the TypeScript directly, there is no build step). Use an official Node.js build: some distro packages (Ubuntu's `nodejs` 22.22.1, for one) are compiled without TypeScript support, and `npm test` and `npm start` then fail with `ERR_NO_TYPESCRIPT`. The same applies to `npm test` in `web/`.

```bash
cd services
cp .env.example .env     # contract id, plus the oracle and keeper keys from ~/.near-credentials/<network>/
npm install
npm test                 # 4 passed
npm start                # logs one JSON line per push and liquidation; http://localhost:8787/health
```

### Deploy to testnet

Requirements and details: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

```bash
export NETWORK=testnet OWNER=yourname.testnet
./scripts/01-create-accounts.sh
./scripts/02-deploy.sh
./scripts/03-add-markets.sh          # BTC-USD, ETH-USD, NEAR-USD (GPU=1 adds GPU-H100)
AMOUNT=500000000 ./scripts/04-seed-vault.sh
```

## Documentation

| File | Contents |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Build brief: status, order of work, rules |
| [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) | Architecture, components, stack, configuration |
| [`docs/PRD.md`](docs/PRD.md), [`docs/MVP.md`](docs/MVP.md) | Requirements and MVP scope |
| [`docs/USERFLOW.md`](docs/USERFLOW.md) | Flows per persona, position lifecycle, error states |
| [`docs/API.md`](docs/API.md) | Contract methods, views, events, errors, services HTTP API |
| [`docs/DATABASE.md`](docs/DATABASE.md) | On-chain state and SQLite schema |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model, controls, keys, runbook, known limitations |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md), [`web/styles/`](web/styles/) | How the Aura design system is applied, and its tokens and component styles |
| [`web/README.md`](web/README.md) | Web app: modes, what has been run, where it differs from the spec |
| [`docs/FRONTEND_SPEC.md`](docs/FRONTEND_SPEC.md), [`docs/SERVICES_SPEC.md`](docs/SERVICES_SPEC.md) | Build specs |
| [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md), [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), [`docs/ROADMAP.md`](docs/ROADMAP.md) | Testing, deployment, schedule |

The docs are written in Indonesian. Code is in English; the UI is specified in English (default) and Indonesian.

## Trust assumptions and known limitations

- Not audited, and testnet only. The testnet caps are loose (vault 100,000, 10,000 per trader, 10,000 per position, in test USDC). A mainnet launch would start with small hard caps (vault ≤ 200 USDC, ≤ 20 per trader, ≤ 50 per position).
- Two contract bugs found in review are fixed (44 unit tests, 4 of them new) and the fixed code runs on testnet since 15 Nov. The live behaviour was only checked for unchanged state and that `storage_unregister` still refuses a non-empty account; the new refusal while a withdrawal is in flight and the NAV-zero refund are covered by unit tests only:
  - Storage deposit drain: `storage_unregister` is now refused while a withdrawal's token transfer is unresolved, so a failed transfer can no longer re-create an unregistered account without a deposit.
  - Vault dilution: an LP deposit is refunded when the vault still has shares but its NAV is zero.
- Still open:
  - Funding rounding leaves −1 to −2 micro-USD of pending funding per closed position, so NAV sits that far below vault assets. The token balance still matches the accounting.
- Liquidation is permissionless, but the only keeper running is the team's, and it scans every 15 seconds.
- The oracle is a single account run by the team. It pushes the median of three exchange tickers (Binance, Gate, HTX), all quoted in USDT and treated as USD.
- The owner can pause, change parameters and force a price. The contract has no code-upgrade function, but on testnet the contract account still has its key, so the team can redeploy the code. The plan for mainnet is to delete that key after the final deploy.
- On instant-execution markets a trader who sees an exchange price move before the oracle pushes it can profit at the vault's expense; the 0.1% fee per side only partly covers this.
- Full list: [`docs/SECURITY.md`](docs/SECURITY.md).

## Disclosure

- All code was written during the hackathon (from 12 Nov 2026), with AI coding assistance (Claude).
- Libraries: [near-sdk-rs](https://github.com/near/near-sdk-rs), near-contract-standards, [near-api-js](https://github.com/near/near-api-js) (services).
- Web app: Next.js, React, [Vela](https://github.com/LuxAlgo/Vela) by LuxAlgo (the chart), lucide-react, [NEAR Connect](https://github.com/hot-dao/near-selector). Chart candles and 24h stats are reference data from Binance's public market-data API.
- Fonts, self-hosted in `web/app/fonts/`: Funnel Display, Funnel Sans, Fragment Mono (SIL OFL).

## License

MIT
