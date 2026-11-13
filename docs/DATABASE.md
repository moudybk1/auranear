# Model data — Aura

Sumber kebenaran adalah **state kontrak**. Database off-chain (SQLite) hanya menyimpan riwayat untuk tampilan dan bisa dibangun ulang.

## A. State on-chain (`contracts/perps/src/types.rs`)

### Satuan

| Besaran | Tipe | Skala |
|---|---|---|
| Jumlah USDC | `u128` | 10^6 |
| Harga | `u128` | 10^6 (micro-USD per unit aset) |
| Unit posisi | `u128` | 10^12; `units = notional × 10^12 / entry_price` |
| Indeks funding | `i128` | 10^12 (pecahan dari notional) |
| Persentase | `u32` | bps; leverage 10x = 100000 |
| Waktu | `u64` | detik unix (harga, order), nanodetik (funding) |

### Koleksi

| Koleksi | Kunci | Nilai | Struktur |
|---|---|---|---|
| `accounts` | `AccountId` | `Account` | `LookupMap` |
| `markets` | `String` | `Market` | `IterableMap` |
| `positions` | `u64` (naik dari 0) | `Position` | `IterableMap` |
| `orders` | `u64` | `Order` | `IterableMap` |
| `vault` | - | `Vault` | tunggal |
| config | - | `owner`, `oracle`, `collateral_token`, `paused`, `limits`, `next_position_id`, `next_order_id` | tunggal |

### Account

| Field | Tipe | Arti |
|---|---|---|
| `free` | u128 | Collateral bebas, bisa ditarik |
| `locked` | u128 | Collateral di posisi dan order |
| `lp_shares` | u128 | Shares vault |
| `positions` | Vec<u64> | Id posisi terbuka |
| `orders` | Vec<u64> | Id order menunggu |

### Market

| Field | Tipe | Arti |
|---|---|---|
| `config` | MarketConfig | Parameter (lihat `docs/API.md`) |
| `price`, `price_ts_sec` | u128, u64 | Harga oracle terakhir |
| `long_notional`, `short_notional` | u128 | Total notional saat buka, per sisi |
| `long_units`, `short_units` | u128 | Total unit per sisi |
| `funding_index` | i128 | Funding kumulatif yang dibayar long per notional |
| `last_funding_ns` | u64 | Akrual funding terakhir |

### Position

| Field | Tipe | Arti |
|---|---|---|
| `owner` | AccountId | Pemilik |
| `market_id` | String | Market |
| `is_long` | bool | Arah |
| `collateral`, `notional`, `units` | u128 | Margin, ukuran, unit |
| `entry_price` | u128 | Harga oracle saat buka |
| `funding_index_open` | i128 | Indeks funding saat buka |
| `opened_at_sec` | u64 | Waktu buka |

### Order (hanya market dua langkah)

| Field | Tipe | Arti |
|---|---|---|
| `owner`, `market_id` | AccountId, String | Pemilik, market |
| `kind` | `Open { is_long, collateral, leverage_bps }` / `Close { position_id }` | Jenis |
| `created_at_sec` | u64 | Hanya dieksekusi pada harga yang lebih baru dari ini |
| `reserved` | u128 | Collateral + fee yang dikunci |

### Vault

| Field | Tipe | Arti |
|---|---|---|
| `assets` | u128 | USDC milik vault LP |
| `total_shares` | u128 | Total shares |
| `insurance` | u128 | Dana asuransi |
| `pending_funding` | i128 | Funding bersih yang terutang posisi terbuka ke vault |

### Relasi

```
Account 1 ──< Position >── 1 Market
Account 1 ──< Order    >── 1 Market        Order(Close) ── 1 Position
Vault (tunggal) ◀── semua Position sebagai lawan
```

### Invarian (nomor 1 diperiksa unit test di akhir skenario; sisanya berlaku dari cara kode ditulis)

1. `Σ(free + locked) + vault.assets + vault.insurance = saldo USDC kontrak`.
2. `Σ notional` dan `Σ units` posisi per sisi = agregat di Market.
3. `NAV = assets − Σ PnL belum terealisasi + pending_funding ≥ 0`.
4. `Σ lp_shares akun = vault.total_shares`.

### Rumus turunan (untuk frontend; hasilnya juga ada di view)

```
notional        = collateral × leverage_bps / 10000
fee             = notional × fee_bps / 10000
pnl_long        = floor(units × price / 1e12) − notional
pnl_short       = notional − ceil(units × price / 1e12)
equity          = collateral + pnl − funding_owed
maintenance     = notional × maintenance_margin_bps / 10000
liq_price_long  = (notional + funding + maintenance − collateral) × 1e12 / units
liq_price_short = (collateral + notional − funding − maintenance) × 1e12 / units
share_price     = nav × 1e6 / total_shares
kapasitas_sisi  = nav × max_oi_bps_of_nav / 10000 − notional_sisi
```

Perkiraan sebelum buka (belum ada `units`): `liq_long ≈ entry × (1 − 1/L + m)`, `liq_short ≈ entry × (1 + 1/L − m)`.

### Biaya storage

Tiap akun mengunci 0,02 NEAR (tarif NEAR 1 NEAR per 100 KB → sekitar 2 KB): satu Account dan sampai 5 Position/Order.

## B. Database off-chain: SQLite (`services/data/aura.db`)

Dibuat otomatis saat layanan start (`CREATE TABLE IF NOT EXISTS`). Mode WAL. Jumlah disimpan sebagai TEXT.

```sql
CREATE TABLE IF NOT EXISTS price_pushes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id  TEXT    NOT NULL,
  ts_sec     INTEGER NOT NULL,           -- timestamp yang dikirim ke kontrak
  price      TEXT    NOT NULL,           -- micro-USD
  sources    TEXT    NOT NULL,           -- JSON: [{name, price, used}]
  tx_hash    TEXT,
  status     TEXT    NOT NULL CHECK (status IN ('sent','confirmed','failed')),
  error      TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_price_market_ts ON price_pushes (market_id, ts_sec);

CREATE TABLE IF NOT EXISTS keeper_actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_sec     INTEGER NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('liquidate','execute_order')),
  target_id  TEXT    NOT NULL,
  result     TEXT    NOT NULL CHECK (result IN ('ok','skipped','failed')),
  message    TEXT,
  reward     TEXT,
  tx_hash    TEXT
);
CREATE INDEX IF NOT EXISTS idx_keeper_ts ON keeper_actions (ts_sec);

CREATE TABLE IF NOT EXISTS service_state (
  key        TEXT PRIMARY KEY,           -- mis. 'oracle.last_push.BTC-USD', 'keeper.last_scan'
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Fase berikutnya (agent hedging)
CREATE TABLE IF NOT EXISTS agent_decisions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_sec           INTEGER NOT NULL,
  index_price      TEXT    NOT NULL,
  target_notional  TEXT    NOT NULL,
  current_notional TEXT    NOT NULL,
  action           TEXT    NOT NULL CHECK (action IN ('open','close','hold')),
  reason           TEXT    NOT NULL,
  tx_hash          TEXT
);
CREATE TABLE IF NOT EXISTS agent_cost_series (
  ts_sec        INTEGER PRIMARY KEY,
  gpu_hours     REAL    NOT NULL,        -- simulasi, ditandai di UI
  unhedged_cost TEXT    NOT NULL,
  hedge_pnl     TEXT    NOT NULL,
  hedged_cost   TEXT    NOT NULL
);
```

Retensi: tanpa penghapusan selama hackathon (≈ 1.000–3.000 baris harga per hari). Cadangan: salin file harian. Kehilangan file ini tidak memengaruhi dana.

## C. Penyimpanan di browser

Hanya preferensi: `aura.theme` (`light`/`dark`), `aura.locale` (`en`/`id`), `aura.lastMarket`. Akses `localStorage` dibungkus try/catch. Tidak ada data dana atau kunci (kunci dikelola wallet selector).
