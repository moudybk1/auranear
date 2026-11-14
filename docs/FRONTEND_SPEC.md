# Spesifikasi frontend — Aura web app

Dokumen ini adalah kontrak untuk membangun `web/`. Baca bersama `docs/DESIGN_SYSTEM.md`, `docs/USERFLOW.md`, `docs/API.md`.

**Status 14 Nov 2026:** Trade dan Vault sudah dibangun di `web/`. Yang berbeda dari dokumen ini (layout, wallet, chart, struktur file, letak token) dan apa yang sudah serta belum dijalankan: `web/README.md`.

## 1. Stack

- Next.js (App Router) + TypeScript, React 18+.
- `@near-wallet-selector/core` + modal UI + minimal dua modul wallet (mis. MyNearWallet dan Meteor). Verifikasi nama paket dan API versi terbaru saat implementasi.
- `near-api-js` (atau `fetch` JSON-RPC langsung) untuk view call.
- Data fetching: SWR atau TanStack Query, `refetchInterval` 5000 ms.
- Gaya: CSS variable dari `design-system/tokens.css` + `bundle.css` (di repo ini: `web/styles/aura-tokens.css` + `aura-components.css`). Ikon `lucide-react`.
- Tanpa backend sendiri. HTTP API layanan (`NEXT_PUBLIC_SERVICES_URL`) opsional; aplikasi harus tetap berfungsi bila API itu mati.

## 2. Struktur

```
web/
  app/
    layout.tsx            font, tema, provider, header, banner
    page.tsx              redirect ke /trade
    trade/page.tsx
    vault/page.tsx
    globals.css
  components/
    ui/                   Button, Badge, TextField, Card, Alert (port dari design system) + Tabs, Slider, Table, Dialog, Toast, Skeleton
    layout/               Header, WalletButton, ThemeToggle, LocaleToggle, PrototypeBanner, Footer
    trade/                MarketTabs, PriceHeader, OrderForm, OrderSummary, PositionsTable, ClosePositionDialog, PriceChart
    account/              AccountPanel, ActivateCard, DepositDialog, WithdrawDialog
    vault/                VaultStats, MarketUtilization, LpPositionCard, LpDepositDialog, LpWithdrawDialog
  lib/
    config.ts             env, id kontrak, daftar market
    near/rpc.ts           viewCall<T>(method, args) dengan fallback RPC
    near/wallet.tsx       WalletProvider, useWallet()
    near/tx.ts            pembangun transaksi (lihat §5)
    contract/types.ts     tipe dari docs/API.md §A4
    contract/hooks.ts     useConfig, useMarkets, useVault, useAccount, usePositions
    math.ts               BigInt: toBase, fromBase, notional, fee, liqPrice, capacity
    format.ts             formatUsd, formatPrice, formatPct, formatAge, shortAccount
    errors.ts             peta pesan kontrak → kunci teks (docs/API.md §A6)
    i18n/en.ts, id.ts, index.tsx
  public/brand/           logo SVG
```

## 3. Halaman

### 3.1 Trade (`/trade`)

Desktop (≥ 1024px): kiri 8 kolom, kanan 4 kolom.

| Area | Isi |
|---|---|
| MarketTabs | Tiga tab: BTC-USD, ETH-USD, NEAR-USD; tiap tab: nama + harga; tab aktif `aura-soft` + `aura-text` |
| PriceHeader | Harga (`heading-1`, mono), umur harga ("updated 12s ago"), Badge "Stale" bila `!is_fresh`, funding rate per jam bertanda + siapa yang membayar, OI long/short |
| PriceChart | Garis dari `GET /prices/:market` (24 jam). Bila API tidak tersedia: sembunyikan, jangan error |
| PositionsTable | Kolom: Market, Side, Size (notional), Entry, Mark, PnL (jumlah dan %), Funding, Liq. price, aksi "Close". Kosong: "No open positions yet. Open your first one from the form." |
| OrderForm (kanan, `Card glow`) | Tabs Long/Short → TextField collateral (mono, hint "Available: X USDC", tombol Max) → Slider leverage 1x–maks → OrderSummary → tombol primary |
| OrderSummary | Notional, Fee (0,1%), Est. liquidation price, Maintenance margin, Side capacity left |
| AccountPanel (kanan, di bawah form) | Free, Locked, tombol Deposit dan Withdraw (`secondary`) |

Mobile: MarketTabs → PriceHeader → OrderForm → AccountPanel → posisi sebagai kartu.

Label tombol primary mengikuti keadaan (hanya satu yang tampil): belum terhubung → "Connect wallet"; belum terdaftar → "Activate account"; saldo 0 → "Deposit USDC"; selain itu → "Open long" / "Open short".

### 3.2 Vault (`/vault`)

| Area | Isi |
|---|---|
| VaultStats | 4 kartu: NAV, Share price, Vault cap used (NAV / `vault_cap`), Insurance fund |
| MarketUtilization | Per market: OI long dan short terhadap batas (`nav × max_oi_bps / 10000`), sebagai bar + angka |
| LpPositionCard (`Card glow`) | Shares, nilai sekarang (`lp_value`), tombol primary "Deposit to vault", `secondary` "Withdraw" |
| Penjelasan risiko | Alert info: LP menjadi lawan semua trader; nilai share bisa turun |

### 3.3 Header dan global

- PrototypeBanner (selalu): "Unaudited hackathon prototype. Use small amounts only."
- Alert pause global bila `paused`.
- Footer: alamat kontrak (mono, tautan explorer), jaringan, tautan repo, status layanan dari `/health` (opsional).

## 4. State dan data

| Hook | Sumber | Interval |
|---|---|---|
| `useConfig()` | `get_config` | 60 detik |
| `useMarkets()` | `get_markets` | 5 detik |
| `useVault()` | `get_vault` | 5 detik |
| `useAccount(id)` | `get_account` | 5 detik + setelah transaksi |
| `usePositions(id)` | `get_positions_of` | 5 detik + setelah transaksi |
| `useUsdcBalance(id)` | `ft_balance_of` di USDC | 15 detik + setelah transaksi |
| `usePriceHistory(market)` | `GET /prices/:market` | 60 detik, boleh gagal |

Setelah transaksi sukses: invalidasi `account`, `positions`, `vault`, `markets`, `usdcBalance`. Wallet berbasis redirect: baca `transactionHashes` / `errorMessage` dari URL saat kembali, tampilkan toast, bersihkan URL.

## 5. Transaksi

| Aksi | Transaksi |
|---|---|
| Aktivasi | perps `storage_deposit({})`, deposit `0.02 NEAR`, gas 30 Tgas |
| Aktivasi + deposit | Dua transaksi dalam satu `signAndSendTransactions`: (1) aktivasi, (2) deposit |
| Deposit | USDC `ft_transfer_call({receiver_id: perps, amount, msg: "deposit"})`, deposit `1`, gas 100 Tgas |
| Setor LP | sama, `msg: "lp"` |
| Buka | perps `open_position({market_id, is_long, collateral, leverage_bps})`, gas 50 Tgas |
| Tutup | perps `close_position({position_id})`, gas 50 Tgas |
| Tarik | perps `withdraw({amount})`, deposit `1`, gas 60 Tgas |
| Tarik LP | perps `lp_withdraw({shares})`, deposit `1`, gas 60 Tgas |

Deposit yang direfund tidak gagal sebagai transaksi: setelah deposit, bandingkan saldo sebelum/sesudah atau baca log `Refunding deposit:` dan tampilkan Alert warning.

## 6. Komponen UI baru (tidak ada di design system)

| Komponen | Spesifikasi |
|---|---|
| Tabs | Kontainer `surface-sunken`, radius `radius-md`, padding `space-1`; item tinggi 32px `label`; aktif: `surface-raised` + `shadow-sm`, teks `ink`; untuk market: aktif `aura-soft` + `aura-text`. Keyboard: panah kiri/kanan, `role="tablist"` |
| Slider | Track 4px `surface-sunken`, isi `aura`, thumb 20px `surface-raised` border `line-strong`, fokus ring; tanda di 1x, 2x, 5x, 10x; nilai tampil sebagai `label` mono |
| Table | Header `caption` `ink-muted`, baris 48px, garis `line`, angka mono rata kanan; baris hover `surface-sunken` |
| Dialog | `surface-raised`, `radius-xl`, `shadow-lg`, lebar maks 440px, overlay `rgba(31,18,20,0.5)`; fokus terkunci, Esc menutup; satu primary |
| Toast | Kanan bawah, memakai gaya Alert, hilang 6 detik (error tetap sampai ditutup); berisi tautan transaksi |
| Skeleton | Blok `surface-sunken` berdenyut pelan (mati bila reduced motion) |
| ThemeToggle / LocaleToggle | `Button ghost sm` dengan ikon + `aria-label` |

## 7. Matematika klien (`lib/math.ts`, semua `bigint`)

```ts
const USDC = 10n ** 6n, BPS = 10_000n, UNIT = 10n ** 12n;
toBase("12.5")            // 12_500_000n  (parse string desimal, maksimal 6 digit pecahan, tanpa float)
notional = collateral * BigInt(leverageBps) / BPS
fee      = notional * BigInt(feeBps) / BPS
required = collateral + fee
// perkiraan sebelum buka (entry = harga oracle sekarang):
units    = notional * UNIT / price
maint    = notional * BigInt(mmBps) / BPS
liqLong  = (notional + maint - collateral) * UNIT / units
liqShort = (collateral + notional - maint) * UNIT / units
capacity = nav * BigInt(maxOiBps) / BPS - sideNotional      // boleh negatif → 0
pnlPct   = pnl * 10_000n / collateral                         // bps dari collateral
atRisk   = equity * 2n <= maintenance * 3n                    // equity ≤ 1,5 × maintenance
```

Setelah posisi terbuka, pakai nilai dari `PositionView` (jangan hitung ulang).

## 8. Teks UI (dua bahasa)

| Kunci | en | id |
|---|---|---|
| nav.trade / nav.vault | Trade / Vault | Trading / Vault |
| wallet.connect | Connect wallet | Hubungkan wallet |
| wallet.disconnect | Disconnect | Putuskan wallet |
| banner.prototype | Unaudited hackathon prototype. Use small amounts only. | Prototipe hackathon, belum diaudit. Pakai nominal kecil saja. |
| account.activate.title | Activate your account | Aktifkan akun kamu |
| account.activate.body | A one-time 0.02 NEAR deposit covers storage. You get it back if you close your account. | Deposit 0,02 NEAR sekali saja untuk biaya penyimpanan. Dana kembali bila akun ditutup. |
| account.activate.cta | Activate account | Aktifkan akun |
| account.free / account.locked | Available / In positions | Tersedia / Di posisi |
| account.deposit / account.withdraw | Deposit USDC / Withdraw USDC | Deposit USDC / Tarik USDC |
| order.long / order.short | Long / Short | Long / Short |
| order.collateral | Collateral | Collateral |
| order.available | Available: {amount} USDC | Tersedia: {amount} USDC |
| order.leverage | Leverage | Leverage |
| order.summary.notional | Position size | Ukuran posisi |
| order.summary.fee | Fee (0.1%) | Biaya (0,1%) |
| order.summary.liq | Est. liquidation price | Perkiraan harga likuidasi |
| order.summary.capacity | Capacity left on this side | Sisa kapasitas sisi ini |
| order.cta.long / order.cta.short | Open long / Open short | Buka long / Buka short |
| positions.title | Open positions | Posisi terbuka |
| positions.empty | No open positions yet. Open your first one from the form. | Belum ada posisi. Buka posisi pertamamu dari formulir. |
| positions.close | Close position | Tutup posisi |
| positions.close.confirm | You will receive about {amount} USDC after the 0.1% fee. | Kamu akan menerima sekitar {amount} USDC setelah biaya 0,1%. |
| positions.atRisk | At risk | Berisiko |
| price.updated | Updated {age} ago | Diperbarui {age} lalu |
| price.stale.title | Price is out of date | Harga belum diperbarui |
| price.stale.body | Trading resumes when a fresh price arrives. You can still withdraw. | Trading lanjut saat harga baru masuk. Kamu tetap bisa menarik dana. |
| paused.title | Trading is paused | Trading sedang dijeda |
| paused.body | You can still close positions and withdraw. | Kamu tetap bisa menutup posisi dan menarik dana. |
| funding.longPays / funding.shortPays | Longs pay {rate}% per hour | Long membayar {rate}% per jam |
| vault.nav / vault.sharePrice | Vault value / Share price | Nilai vault / Harga share |
| vault.cap | Vault cap used | Kapasitas vault terpakai |
| vault.insurance | Insurance fund | Dana asuransi |
| vault.yours | Your position | Posisi kamu |
| vault.deposit / vault.withdraw | Deposit to vault / Withdraw from vault | Setor ke vault / Tarik dari vault |
| vault.risk | The vault takes the other side of every trade. Share price can go down when traders win. | Vault menjadi lawan semua trader. Harga share bisa turun saat trader untung. |
| tx.pending | Waiting for your wallet | Menunggu wallet kamu |
| tx.success | Done. View transaction | Berhasil. Lihat transaksi |
| tx.refunded.title | Deposit returned | Deposit dikembalikan |
| liquidated.title | Position liquidated | Posisi dilikuidasi |
| liquidated.body | It fell below maintenance margin. Remaining collateral went to the vault. | Posisi turun di bawah maintenance margin. Sisa collateral masuk ke vault. |

Teks error: lihat `docs/API.md` §A6 (terjemahkan ke `id` dengan pola yang sama: apa yang salah + cara memperbaiki).

## 9. Kriteria penerimaan

- [ ] Halaman terbaca tanpa wallet (harga, market, vault)
- [ ] Siklus penuh lewat UI di testnet: aktivasi, deposit, buka long, buka short, tutup, tarik, setor LP, tarik LP
- [ ] Angka di ringkasan order sama dengan hasil di `PositionView` setelah dibuka (selisih pembulatan ≤ 1 unit terkecil yang ditampilkan)
- [ ] Tombol kirim nonaktif dengan alasan yang terbaca untuk setiap pelanggaran validasi
- [ ] Harga basi dan pause: buka/tutup nonaktif, tarik tetap aktif
- [ ] Satu tombol primary per tampilan; tidak ada hex langsung; tidak ada merah untuk PnL negatif
- [ ] Tema terang dan gelap benar; logo berganti versi reversed di tema gelap
- [ ] Bisa dipakai penuh dengan keyboard; ring fokus terlihat
- [ ] Lebar 360px tidak ada scroll horizontal
- [ ] Tidak ada `Number` untuk jumlah uang di jalur transaksi
- [ ] `npm run build` tanpa error; `npm run lint` bersih
