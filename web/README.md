# Aura web app

Trade and Vault for the Aura perps contract. Next.js (App Router) + TypeScript, styled with the Aura brand kit tokens.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # math + simulator self-check (4 tests)
npm run typecheck
npm run build
```

## Two modes

| | Demo (default) | Live |
|---|---|---|
| When | `NEXT_PUBLIC_CONTRACT_ID` is unset or still the `yourname` placeholder | `.env.local` points at a deployed contract (see `.env.example`) |
| Contract | `lib/sim.ts`, a TypeScript port of `contracts/perps/src/lib.rs` running in the browser | View calls over JSON-RPC (`lib/near.ts`) |
| Wallet | A built-in test account with 10,000 test USDC | NEAR Connect (`@hot-labs/near-connect`) |
| Oracle | The reference price is pushed into the simulator every 5 s; a keeper pass liquidates | The on-chain oracle price |

The UI is the same code in both modes; only `view` and `send` in `lib/store.tsx` switch. The simulator keeps the
contract's accounting, rounding and panic messages, and `npm test` checks the invariant
`trader balances + vault assets + insurance = tokens held` plus "the order form's quote equals the opened position".
Demo state lives in `localStorage`; "Reset demo data" in the wallet menu clears it.

## What has been run, and what has not

- Run in the browser (demo): connect, activate + deposit, open long, close dialog, both themes, English and
  Indonesian, 1440 / 1024 / 375 px.
- Run in the browser (chart): market switching from the page and from the chart, live theme switch, Indonesian,
  saved state restored under the other theme, the mobile layout, and the oracle and entry lines.
- Run against testnet (12 Nov 2026, contract `perps.aura-perps.testnet`, `.env.local` as in `.env.example`): the
  header badge and status bar switch to Testnet, `/trade` and `/vault` show the three markets, the oracle prices and
  the vault read from the contract. Signed from the UI through the NEAR CLI wallet of NEAR Connect (the wallet shows a
  `near` command, you run it and paste the transaction hash): deposit, open long, close, withdraw. Each one ended in
  the right toast and refreshed balances. Ten minutes after the last price push the Oracle update cell showed Stale and
  Open long was disabled with "Price is out of date".
- Dialogs and in-page wallets: `Dialog` is a modal `<dialog>` (browser top layer), and NEAR Connect draws a wallet's
  signing step as a normal element in `body`, which a modal dialog covers and makes inert. So `Dialog` steps aside
  while a live transaction waits for the wallet and comes back, with the typed amount, if it fails. Checked on
  testnet with the NEAR CLI wallet in Deposit, Withdraw and Close position, including a cancelled request.
- **Not run:** a browser-extension or popup wallet (Meteor, Intear, ...), activation of a new account
  (`storage_deposit` from the UI), vault deposit and withdraw from the UI, the liquidation toast, the paused banner.
  There is no test-token faucet in live mode: a new testnet account gets tUSD from the `faucet` method of
  `tusd.aura-perps.testnet` by CLI.

## Notes

- The chart is [Vela by LuxAlgo](https://velacharts.dev) (`@luxalgo/vela`, Apache-2.0), mounted as its full chart
  app: timeframes, chart styles, indicators and drawing tools. It is loaded only when the chart mounts (about 1.1 MB
  of JavaScript before compression). The Vela mark in the chart's corner is the attribution its license asks for;
  leave it on.
- Aura adds three things to it (`components/trade/Chart.tsx`, `lib/chartfeed.ts`): a data feed limited to the three
  Aura markets, a theme built from the brand tokens, and a layer that draws the oracle price and the entry and
  liquidation levels of the user's positions. The page's market tabs and the chart's symbol search stay in step.
- Candles and 24h stats are reference data from Binance's public market-data API, fetched by the browser; the chart
  names that source beside the symbol. Orders never fill at those prices. Execution is at the oracle price, which
  the chart draws as its own line.
- The chart saves the user's timeframe, chart style, indicators and drawings in `localStorage` (`aura.chart`).
  Colours are not restored from it: they always follow the Aura theme.
- Money is `bigint` end to end (`lib/math.ts`). `Number` appears only in `lib/format.ts` and the chart.
- Long and up are teal with an arrow and a plus sign; short and down are neutral with an arrow and a minus sign.
  On the chart, up candles are teal and down candles are the ink colour. Red is reserved for the brand: the primary
  action, the active market, focus.

## Where it differs from `docs/FRONTEND_SPEC.md`

- Layout is a full-width trading terminal (chart, market details, order form, positions) instead of the 1200 px
  8/4 grid, at the owner's request. The market details panel takes the slot an order book would have, since a
  pool model has none.
- NEAR Connect instead of `@near-wallet-selector/*`, whose last release was December 2025.
- The chart is the Vela chart app with candles, at the owner's request, instead of a line from `/prices/:market`.
- One polling provider instead of SWR. Fonts are self-hosted from the brand kit, not loaded from Google Fonts.
- Skipped until needed: `/prices/:market` and `/health` from the services API (not built), redirect-wallet URL
  handling, two-step (GPU-H100) orders, ESLint (`next lint` no longer exists in Next 16).
