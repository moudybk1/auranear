# Blueprint sistem Aura

Aura adalah perps exchange model pool di NEAR. Hanya lapisan on-chain yang memegang dana; layanan dan web app bisa mati tanpa membahayakan dana pengguna.

## 1. Gambaran

```
              ┌────────────┐   ┌────────────┐   ┌──────────────────────┐
              │  Trader    │   │    LP      │   │ Agent hedging (fase 2)│
              │ (web app)  │   │ (web app)  │   │ function-call key     │
              └─────┬──────┘   └─────┬──────┘   └──────────┬───────────┘
                    │ wallet         │ wallet              │
                    ▼                ▼                     ▼
        ┌──────────────────────────────────────────────────────────────┐
        │            Kontrak perps Aura (Rust, NEAR)                   │
        │  LP vault │ Posisi & margin │ Market + oracle │ Likuidasi    │
        └───────▲──────────────▲───────────────────▲───────────────────┘
                │              │                   │
        ┌───────┴─────┐  ┌─────┴───────┐   ┌───────┴──────┐
        │ Kontrak USDC│  │Oracle pusher│   │  Keeper bot  │
        │  (NEP-141)  │  │ set_price   │   │ liquidate    │
        └─────────────┘  └─────────────┘   └──────────────┘
                          └── satu proses Node.js + SQLite + HTTP API ──┘
```

## 2. Komponen dan status

| Lapisan | Komponen | Tanggung jawab | Status 12 Nov |
|---|---|---|---|
| On-chain | Kontrak perps (`contracts/perps`) | Memegang USDC, mencatat akun, posisi, order, market, vault; menegakkan semua aturan | Ditulis, 40 unit test lulus; belum di-build ke wasm, belum di-deploy |
| On-chain | USDC native (Circle) | Collateral NEP-141, 6 desimal | Ada di mainnet: `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` |
| On-chain | Token tes tUSD (`contracts/mock-ft`) | Pengganti USDC untuk testnet, ada faucet | Ditulis |
| Layanan | Oracle pusher | Mengambil harga BTC, ETH, NEAR; mendorong `set_price` | Belum dibangun |
| Layanan | Keeper | `liquidate` dan `execute_order` | Belum dibangun |
| Layanan | HTTP API + SQLite | Riwayat harga, log, `/health` | Belum dibangun |
| Layanan | Agent hedging | Hedge biaya compute di GPU-H100 | Fase berikutnya |
| Klien | Web app Next.js (`web/`) | Trade, Vault (lalu Agent) | Belum dibangun |
| Operasi | `scripts/01..05` | Akun, deploy, market, seed vault, dana agent | Ditulis, belum dijalankan |
| Desain | `web/styles/`, `web/app/fonts/` | Token, gaya komponen, font Aura | Disalin ke web app; folder kit `design-system/` tidak ikut di repo |

## 3. Prinsip desain

1. **Satu kontrak, satu sumber kebenaran.** Frontend dan layanan membaca state lewat view method di RPC. Tidak ada backend yang wajib hidup agar pengguna bisa menarik dana.
2. **Tanpa loop atas seluruh posisi** di method yang mengubah state. NAV dan funding dihitung dari agregat per market.
3. **Layanan tanpa hak istimewa**, kecuali oracle (`set_price`). Keeper memakai method yang terbuka untuk siapa pun.
4. **Guarded launch.** Batas keras kecil di mainnet, pause oleh owner, penarikan tetap jalan saat pause.
5. **Integer saja.** Tidak ada float di kontrak maupun di logika layanan.

## 4. Aliran data

| Aliran | Jalur |
|---|---|
| Harga | API bursa → oracle pusher (median) → `set_price` → state Market |
| Dana masuk | Wallet → `ft_transfer_call` di USDC → `ft_on_transfer` di perps (`msg`: `deposit` atau `lp`) |
| Dana keluar | `withdraw` / `lp_withdraw` → `ft_transfer` di USDC → callback `on_withdraw` (pulihkan saldo bila gagal) |
| Trading | Wallet → `open_position` / `close_position` |
| Likuidasi | Keeper → `get_liquidatable` (view) → `liquidate` |
| Baca | Web/keeper → view method lewat RPC; riwayat dari event `EVENT_JSON` dan HTTP API |

## 5. Mekanisme inti

- **Vault LP:** counterparty semua posisi. `NAV = assets − PnL belum terealisasi semua trader + pending_funding`. Share pertama 1:1, berikutnya `shares = amount × total_shares / NAV`.
- **Posisi:** margin terisolasi. `notional = collateral × leverage`. `units = notional × 1e12 / harga`.
- **PnL:** long `units × P / 1e12 − notional`; short `notional − units × P / 1e12`. Pembulatan selalu merugikan trader.
- **Likuidasi:** `equity = collateral + PnL − funding`; bisa dilikuidasi bila `equity ≤ maintenance_margin × notional`. Reward 20% dari sisa equity ke likuidator, sisanya ke vault. Bad debt ditutup insurance fund dulu.
- **Funding:** `rate/jam = k × (OI long − OI short) / NAV`, dibatasi maksimum; lewat indeks kumulatif per market.
- **Oracle:** push; timestamp harus maju; loncatan di atas batas ditolak; harga basi memblokir open/close/liquidate dan aksi LP.
- **Fee:** 0,1% notional saat buka dan saat tutup; 10% dari fee masuk insurance fund.

## 6. Parameter

| Parameter | BTC-USD, ETH-USD, NEAR-USD | GPU-H100 (fase berikutnya) |
|---|---|---|
| Leverage maksimal | 10x (`max_leverage_bps` 100000) | 5x |
| Maintenance margin | 5% | 10% |
| Fee buka/tutup | 0,1% | 0,1% |
| Batas OI per sisi | 30% NAV per market | 20% NAV |
| Harga basi setelah | 600 detik | 93600 detik |
| Batas loncatan per update | 5% | 10% |
| Funding k / maksimum | 10 / 5 bps per jam | 4 / 2 bps per jam |
| Eksekusi | Langsung | Dua langkah |

| Batas global | Mainnet | Testnet |
|---|---|---|
| `vault_cap` | 200 USDC | 100.000 tUSD |
| `max_user_collateral` | 20 USDC | 10.000 tUSD |
| `max_position_notional` | 50 USDC | 10.000 tUSD |
| `min_collateral` | 1 USDC | 1 tUSD |
| `max_positions_per_account` | 5 | 5 |
| `liquidator_reward_bps` | 2000 | 2000 |
| `insurance_fee_share_bps` | 1000 | 1000 |

## 7. Tech stack

| Bagian | Pilihan | Alasan |
|---|---|---|
| Kontrak | Rust, near-sdk 5.30, near-contract-standards, cargo-near | SDK resmi; unit test tanpa jaringan |
| CLI | near-cli-rs + bash | Bisa diulang; langkah mainnet minta konfirmasi |
| Layanan | Node.js 20+, TypeScript, near-api-js, better-sqlite3, satu proses | Satu deploy untuk semua layanan |
| Frontend | Next.js (App Router), TypeScript, `@near-wallet-selector`, CSS variable dari `web/styles/aura-tokens.css`, Lucide | Sesuai design system |
| Hosting | Vercel (web), Railway/VPS kecil (layanan) | Hidup sampai 25 Nov |
| RPC | RPC publik NEAR + satu cadangan | Gratis |

Tidak dipakai: indexer, Postgres, Redis, antrean pesan.

## 8. Struktur repo target

```
aura/
  AGENTS.md  README.md  LICENSE
  contracts/perps/      kontrak (ada)
  contracts/mock-ft/    token tes (ada)
  scripts/              deploy (ada)
  design-system/        token, komponen, logo (tidak ikut di repo; salinannya di web/styles/)
  docs/                 dokumen ini
  services/             oracle, keeper, api, db (dibangun)
  web/                  Next.js (dibangun)
```

## 9. Konfigurasi

`services/.env`:

| Variabel | Isi | Rahasia |
|---|---|---|
| `NETWORK` | `testnet` / `mainnet` | Tidak |
| `RPC_URL`, `RPC_URL_FALLBACK` | Endpoint RPC | Tidak |
| `CONTRACT_ID` | Akun kontrak perps | Tidak |
| `ORACLE_ACCOUNT_ID`, `ORACLE_PRIVATE_KEY` | Akun dan kunci oracle | Ya |
| `KEEPER_ACCOUNT_ID`, `KEEPER_PRIVATE_KEY` | Akun dan kunci keeper | Ya |
| `MARKETS` | `BTC-USD,ETH-USD,NEAR-USD` | Tidak |
| `PRICE_PUSH_BPS` | 30 | Tidak |
| `PRICE_PUSH_MAX_SEC` | 300 | Tidak |
| `KEEPER_INTERVAL_SEC` | 15 | Tidak |
| `PORT`, `CORS_ORIGIN`, `DB_PATH` | HTTP API | Tidak |

`web/.env`: `NEXT_PUBLIC_NETWORK`, `NEXT_PUBLIC_CONTRACT_ID`, `NEXT_PUBLIC_USDC_ID`, `NEXT_PUBLIC_SERVICES_URL`. Tidak ada rahasia.

## 10. Fase

| Fase | Isi | Syarat keluar |
|---|---|---|
| 0. Kontrak | Kontrak + unit test | 40 test lulus (tercapai) |
| 1. Gladi testnet | Build wasm, deploy, oracle, keeper | Likuidasi oleh keeper berhasil di testnet |
| 2. Web app | Trade + Vault di testnet | Siklus penuh lewat UI |
| 3. Mainnet terbatas | Deploy, 3 market, seed vault | Buka/tutup 1 USDC berhasil |
| 4. Submission | README, video, post X, form | Tersubmit sebelum Minggu 15 Nov 06:59 WIB |
| 5. Penjurian | Layanan dijaga hidup sampai 25 Nov | Harga tidak pernah basi di luar batas |
| 6. Lanjutan | GPU-H100, agent hedging, audit, oracle TEE, NEAR Intents | - |
