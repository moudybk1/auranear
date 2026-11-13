# Aura

**Perpetual futures on NEAR in one small contract: deposit USDC, go long or short BTC, ETH and NEAR with leverage, with an LP vault as the counterparty.** Next: a market on the rental price of GPU compute, so AI agents can lock in what they pay for compute.

Built at NEAR HACKATHON (1–14 Nov 2026).

> Hackathon prototype. **Not audited.** Mainnet runs with small hard caps (vault ≤ 200 USDC, ≤ 20 USDC per trader, ≤ 50 USDC per position). Use tiny amounts only.

| | |
|---|---|
| Live demo | _coming soon_ |
| Demo video / X post | _coming soon_ |
| Contract | Testnet: [`perps.aura-perps.testnet`](https://testnet.nearblocks.io/address/perps.aura-perps.testnet). Mainnet: _coming soon_ |

## Status (12 Nov 2026)

| Part | Where | Status |
|---|---|---|
| Perps contract | `contracts/perps` | 40 unit tests pass. Built to wasm (281 KB) and deployed on **testnet** at `perps.aura-perps.testnet` with 3 markets and a 500 tUSD seeded vault. One deposit, open, close, withdraw and LP withdraw cycle ran there and the token balance matched the accounting. Not on mainnet |
| Test token | `contracts/mock-ft` | Deployed on testnet at `tusd.aura-perps.testnet` (testnet only, no value) |
| Deploy scripts | `scripts/` | `01`–`04` run on testnet (near-cli-rs 0.30.1, cargo-near 0.23.0). `05` not run yet. `06-push-prices.sh` pushes one manual testnet price per market until the oracle exists |
| Design system | `design-system/` | Complete |
| Specs | `docs/`, `AGENTS.md` | Complete |
| Oracle, keeper, HTTP API | `services/` | Not built yet (spec: `docs/SERVICES_SPEC.md`). Until then testnet prices are pushed by hand and go stale after 10 minutes, which disables opening and closing |
| Web app | `web/` | Trade and Vault built. With `web/.env.local` it reads the testnet contract; without it, it runs in demo mode (in-browser simulator). Deposit, open, close and withdraw were signed from the UI on testnet through the NEAR CLI wallet. See `web/README.md` |

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

### Contract tests (no NEAR account needed)

```bash
cd contracts/perps
cargo test        # test result: ok. 40 passed
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
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md), [`design-system/`](design-system/) | Aura design system and how to apply it |
| [`docs/FRONTEND_SPEC.md`](docs/FRONTEND_SPEC.md), [`docs/SERVICES_SPEC.md`](docs/SERVICES_SPEC.md) | Build specs |
| [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md), [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), [`docs/ROADMAP.md`](docs/ROADMAP.md) | Testing, deployment, schedule |

The docs are written in Indonesian. Code is in English; the UI is specified in English (default) and Indonesian.

## Trust assumptions and known limitations

- Not audited. Caps are deliberately tiny.
- The oracle is a single account run by the team.
- The owner can pause, change parameters and force a price. There is no code-upgrade function; the contract account's keys are deleted after the final deploy.
- On instant-execution markets a trader who sees an exchange price move before the oracle pushes it can profit at the vault's expense; the 0.1% fee per side only partly covers this.
- Full list: [`docs/SECURITY.md`](docs/SECURITY.md).

## Disclosure

- All code was written during the hackathon (from 12 Nov 2026), with AI coding assistance (Claude).
- Libraries: [near-sdk-rs](https://github.com/near/near-sdk-rs), near-contract-standards.
- Web app: Next.js, React, [Vela](https://github.com/LuxAlgo/Vela) by LuxAlgo (the chart), lucide-react, [NEAR Connect](https://github.com/hot-dao/near-selector). Chart candles and 24h stats are reference data from Binance's public market-data API.
- Fonts in the design system: Funnel Display, Funnel Sans, Fragment Mono (SIL OFL).

## License

MIT
