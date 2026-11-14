# Aura web app

Landing page, Trade and Vault for the Aura perps contract. Next.js (App Router) + TypeScript, styled with the Aura brand kit tokens.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # math, simulator, prices and history self-checks (6 tests)
npm run typecheck
npm run build
```

`npm test` runs the TypeScript directly, so it needs an official Node.js 22.22+ build. A Node compiled without
TypeScript support (Ubuntu's `nodejs` 22.22.1, for one) fails with `ERR_NO_TYPESCRIPT`; `dev`, `typecheck` and
`build` still work there.

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

- Landing page at `/` (15 Nov, `components/Landing.tsx`, copy in `lib/landing-copy.ts`, styles and motion in
  `styles/landing.css`). Five parts: a hero with a working order preview, the three markets, terminal screenshots,
  four steps and one action. It reads the same store as the terminal and always renders on the dark theme. Run in
  headless Chrome against testnet at 1440 / 768 / 390 px: the order preview (market, side, leverage) and its
  self-playing demo, which stops at the first touch; the market rows and their `/trade?market=` links; the
  scroll-linked animations; and reduced motion (nothing moves, nothing stays hidden). The terminal screenshots in
  `public/landing/` were taken from this app on 15 Nov. Hosted since 15 Nov: on
  <https://aura-perps.vercel.app> the page loads without console errors, the order preview plays and the market
  rows read the testnet contract, the screenshots load, and `/trade?market=NEAR-USD` opens on that market.
  **Not run:** demo mode, Firefox and Safari (where the browser cannot link an
  animation to scroll, the terminal and the steps' bar animate once on entry instead).
- Run in the browser (demo): connect, activate + deposit, open long, close dialog, both themes, English and
  Indonesian, 1440 / 1024 / 375 px. On 14 Nov the whole cycle ran in demo mode in one session: activate + deposit,
  open long, open short, close, withdraw, vault deposit, vault withdraw, each ending in its success toast.
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
- Full cycle with a new account (14 Nov 2026, `trader1.aura-perps.testnet`, NEAR CLI wallet, on a local copy of the
  code that is hosted): the faucet button for an account the token had never seen, Activate account with a 100 test
  USDC deposit (`storage_deposit`, then `ft_transfer_call`), open short on BTC-USD, close, vault deposit, full vault
  withdraw, full withdraw. Each one ended in the right toast and refreshed balances. Afterwards the contract's token
  balance equalled user balances + vault assets + insurance.
- Liquidation and pause (14 Nov 2026, owner account): after the owner forced NEAR-USD down 20%, a 10x long showed
  the At risk chip with Close disabled, and about 16 s later the "Position liquidated" notice, once the hosted keeper
  had liquidated it. With trading paused by the owner, the banner showed and Open long was disabled with the reason.
- **Not run on testnet:** a browser-extension or popup wallet (Meteor, Intear, ...), and signing on the hosted site
  (<https://aura-perps.vercel.app> was checked for loading, reading the contract, and connecting the NEAR CLI wallet).
- Response headers (`next.config.ts`): `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`. There is no Content-Security-Policy yet.
- Test tokens: on testnet the Deposit and vault deposit dialogs have a "Get 1,000 test USDC" button that calls the
  public `faucet` of the test token (`tusd.aura-perps.testnet`). Run once from the UI with the owner account on
  13 Nov: the wallet balance went up and the dialog came back with it. It is shown on any live testnet build, so it
  assumes the token is `contracts/mock-ft`. Not shown on mainnet or in demo mode.

## Notes

- The chart is [Vela by LuxAlgo](https://velacharts.dev) (`@luxalgo/vela`, Apache-2.0), mounted as its full chart
  app: timeframes, chart styles, indicators and drawing tools. It is loaded only when the chart mounts (about 1.1 MB
  of JavaScript before compression). The Vela mark in the chart's corner is the attribution its license asks for;
  leave it on.
- Aura adds three things to it (`components/trade/Chart.tsx`, `lib/chartfeed.ts`): a data feed limited to the three
  Aura markets, a theme built from the brand tokens, and a layer that draws the entry and liquidation levels of the
  user's positions. The oracle price is not drawn on the chart (removed 15 Nov at the owner's request); the market
  bar and the order book's middle row show it. The page's market picker (a native `<select>` drawn as the selected market and its oracle price, since 15 Nov) and
  the chart's symbol search stay in step.
- Candles, the order book and the market bar's 24h stats are reference data from Hyperliquid's perps (public info
  API; 24h high and low come from the last 24 hourly candles, refreshed once a minute), fetched by the browser; the chart names its source beside the
  symbol. Hyperliquid keeps only the newest ~5,000 candles per interval (1m reaches back about 3.5 days) and has no
  6h candles. Orders never fill at those prices. Execution is at the oracle price.
- The chart saves the user's timeframe, chart style, indicators and drawings in `localStorage` (`aura.chart`).
  Colours are not restored from it: they always follow the Aura theme.
- Money is `bigint` end to end (`lib/math.ts`). `Number` appears only in `lib/format.ts` and the chart.
- Trade history (dock tab, 15 Nov): the account's opens, closes and liquidations, read from Aura's own events in
  transaction logs through FastNEAR's public transaction index (`lib/history.ts`, `components/trade/History.tsx`):
  the account's newest 40 transactions plus the keeper's newest 20, because the index does not link a keeper's
  liquidation to the trader. Realized PnL is pnl − funding − close fee for a close and the whole collateral for a
  liquidation. Checked against `aura-perps.testnet` (12 rows, three liquidations). Demo mode shows none.
- Up is green and down is red (`--up`, `--down` in `styles/app.css`, at the owner's request on 15 Nov): candles and
  volume, order book bids and asks, 24h change and PnL (with an arrow or sign), and the oracle price, which takes
  the direction of its last move (the 24h change until the first move is seen). The Long button stays teal.

## Where it differs from `docs/FRONTEND_SPEC.md`

- Layout is a full-width trading terminal instead of the 1200 px 8/4 grid, at the owner's request: a one-row
  market bar, the chart over a tabbed dock (open positions, market details), and the order form and account in a
  rail on the right. Panels sit flush, split by hairlines. From 1024 px wide and 640 px tall it fills the viewport
  and panels scroll on their own; below that the page scrolls. A pool model has no order book of its own, so the
  Trade page shows a reference one (added 15 Nov): Hyperliquid perp depth (public `l2Book`, 20 levels a side,
  grouped to 4 significant figures), polled every 2 s while visible, with the oracle price as the middle row because
  that is where every order fills. From 1280 px it is a
  column between the chart and the rail; below that it is a dock tab, with bids and asks side by side when the dock
  is 560 px or wider. Checked 15 Nov at 1440, 1024 and 375 px. Checked 14 Nov at 1440, 1280, 1024, 900 and 375 px, in both themes, in demo mode and against testnet.
- NEAR Connect instead of `@near-wallet-selector/*`, whose last release was December 2025.
  Since 15 Nov Aura draws its own wallet picker (`WalletPicker` in `components/Shell.tsx`) from NEAR Connect's
  wallet list and opens the chosen wallet with `connect({ walletId })`, so NEAR Connect's own selector never shows.
  The header says which wallet is signing in, a closed or refused sign-in shows a toast, and the account menu has
  Copy (with a "Copied" confirmation) and View on explorer. Checked on a local production build: the picker on
  desktop and at 375 px, and a NEAR CLI sign-in closed without an answer. A completed sign-in was not redone.
- The chart is the Vela chart app with candles, at the owner's request, instead of a line from `/prices/:market`.
- One polling provider instead of SWR. Fonts are self-hosted from the brand kit, not loaded from Google Fonts.
- The brand kit's `design-system/` folder is not in this repo. Its tokens and component styles are copied to
  `styles/aura-tokens.css` and `styles/aura-components.css`; nothing is imported from outside `web/`.
- The footer is a status bar: oracle state (from the contract's own freshness flag), network, a source link and the
  contract on the explorer. It does not read the services' `/health`.
- RPC (15 Nov): `NEXT_PUBLIC_RPC_URL` lists a QuickNode testnet endpoint first and FastNEAR's public one as the
  fallback (`lib/near.ts` tries them in order). It is set in `web/.env.local` and in the Vercel project's production
  env. The QuickNode token sits in that URL, so the browser sees it: limit the endpoint to the site's domains in
  QuickNode. Without the variable the app uses FastNEAR alone, which rate-limits busy IPs (HTTP 429).
- Skipped until needed: `/prices/:market` (not built), the `/health` status, redirect-wallet URL handling, two-step
  (GPU-H100) orders, ESLint (`next lint` no longer exists in Next 16).
