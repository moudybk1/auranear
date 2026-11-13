# API — Aura

Dua antarmuka: (A) kontrak perps di NEAR, sudah ada dan teruji; (B) HTTP API layanan, rancangan yang harus dibangun.

## Konvensi

- Jumlah dikirim sebagai **string** (U128/U64/I128 dalam JSON).
- USDC: 6 desimal (`"5000000"` = 5 USDC). Harga: micro-USD (`"3000000"` = $3,00). Leverage: basis point (`20000` = 2x). Persen lain: bps (`500` = 5%).
- Waktu harga dan order: detik unix.
- `1 yocto` = `attachedDeposit: "1"`; menandakan butuh full-access key.
- Gas default 50 Tgas; `ft_transfer_call` 100 Tgas; `withdraw`/`lp_withdraw` 60 Tgas.

## A. Kontrak perps

### A1. Dana

| Method | Argumen | Deposit | Pemanggil | Hasil |
|---|---|---|---|---|
| `storage_deposit` | `account_id?: AccountId`, `registration_only?: bool` | ≥ 0,02 NEAR | Siapa saja | `StorageBalance`; kelebihan dikembalikan; akun yang sudah ada → deposit dikembalikan |
| `storage_unregister` | `force?: bool` | 1 yocto | Pemilik | `true` bila akun kosong dihapus (0,02 NEAR kembali) |
| `storage_balance_of` (view) | `account_id` | - | - | `{total, available}` atau `null` |
| `storage_balance_bounds` (view) | - | - | - | `{min, max}` = 0,02 NEAR |
| `ft_on_transfer` | `sender_id`, `amount`, `msg` | - | **Hanya kontrak USDC** | Mengembalikan jumlah yang direfund (`"0"` bila diterima) |
| `withdraw` | `amount: U128` | 1 yocto | Pemilik akun | Promise; saldo dipulihkan bila transfer gagal |
| `lp_withdraw` | `shares: U128` | 1 yocto | LP | Promise; shares dipulihkan bila transfer gagal |
| `on_withdraw` | `account_id`, `amount`, `lp_shares` | - | Kontrak sendiri | `bool` |

Deposit (dipanggil di kontrak USDC, bukan di perps):

```json
{
  "receiverId": "<USDC>",
  "methodName": "ft_transfer_call",
  "args": { "receiver_id": "<perps>", "amount": "5000000", "msg": "deposit" },
  "deposit": "1",
  "gas": "100000000000000"
}
```

`msg`: `"deposit"` → saldo trading; `"lp"` → shares vault. Deposit direfund penuh (tanpa error) bila: pause, akun belum terdaftar, jumlah 0, di atas `max_user_collateral` / `vault_cap`, `msg` tidak dikenal, atau (untuk `lp`) ada harga basi di market yang punya posisi.

### A2. Trading

| Method | Argumen | Pemanggil | Hasil |
|---|---|---|---|
| `open_position` | `market_id: String`, `is_long: bool`, `collateral: U128`, `leverage_bps: u32` | Akun terdaftar | `{ position_id: U64?, order_id: U64? }` (market langsung → `position_id`) |
| `close_position` | `position_id: U64` | Pemilik posisi | `null` (langsung) atau id order tutup (dua langkah) |
| `liquidate` | `position_id: U64` | Akun terdaftar | Reward (U128) |
| `execute_order` | `order_id: U64` | Siapa saja | `bool` |
| `cancel_order` | `order_id: U64` | Pemilik order | - |

```json
{ "methodName": "open_position",
  "args": { "market_id": "BTC-USD", "is_long": true, "collateral": "5000000", "leverage_bps": 30000 } }
```

Aturan `open_position`: tidak pause; `10000 ≤ leverage_bps ≤ max_leverage_bps`; `collateral ≥ min_collateral`; `notional = collateral × leverage_bps / 10000 ≤ max_position_notional`; `free ≥ collateral + fee`; posisi + order < `max_positions_per_account`; harga segar; OI sisi + notional ≤ `max_oi_bps_of_nav × NAV`.

### A3. Oracle dan admin

| Method | Argumen | Deposit | Pemanggil |
|---|---|---|---|
| `set_price` | `market_id`, `price: U128`, `ts_sec: U64` | - | Akun oracle |
| `set_price_force` | sama | 1 yocto | Owner (melewati batas loncatan) |
| `add_market` | `market_id`, `config: MarketConfig` | 1 yocto | Owner |
| `update_market_config` | `market_id`, `config` | 1 yocto | Owner |
| `update_limits` | `limits: Limits` | 1 yocto | Owner |
| `set_paused` | `paused: bool` | 1 yocto | Owner |
| `set_oracle` | `oracle: AccountId` | 1 yocto | Owner |
| `set_owner` | `owner: AccountId` | 1 yocto | Owner |
| `new` (init) | `owner`, `oracle`, `collateral_token`, `limits` | - | Sekali saat deploy |

`set_price` menolak bila: bukan oracle; `price = 0`; `ts_sec ≤` timestamp terakhir; `ts_sec >` waktu blok + 60 detik; loncatan > `max_price_jump_bps`.

```ts
type MarketConfig = {
  max_leverage_bps: number;          // 100000 = 10x
  maintenance_margin_bps: number;    // 500 = 5%
  fee_bps: number;                   // 10 = 0,1%
  max_oi_bps_of_nav: number;         // 3000 = 30% NAV per sisi
  stale_after_sec: number;           // 600
  max_price_jump_bps: number;        // 500
  funding_k_bps_per_hour: number;    // 10
  max_funding_bps_per_hour: number;  // 5
  two_step: boolean;                 // false
};
type Limits = {
  vault_cap: string; max_user_collateral: string; max_position_notional: string; min_collateral: string;
  max_positions_per_account: number; liquidator_reward_bps: number; insurance_fee_share_bps: number;
};
```

### A4. View method

| Method | Argumen | Mengembalikan |
|---|---|---|
| `get_config` | - | `ConfigView` |
| `get_vault` | - | `VaultView` |
| `get_markets` | - | `MarketView[]` |
| `get_market` | `market_id` | `MarketView \| null` |
| `get_account` | `account_id` | `AccountView \| null` |
| `get_position` | `position_id` | `PositionView \| null` |
| `get_positions_of` | `account_id` | `PositionView[]` |
| `get_positions` | `from_index?: u32`, `limit?: u32` (bawaan 100) | `PositionView[]` |
| `get_liquidatable` | `from_index?`, `limit?` | `U64[]` (yang liquidatable pada halaman itu) |
| `get_orders` | `from_index?`, `limit?` | `OrderView[]` |
| `get_num_positions` | - | `u32` |

```ts
type ConfigView = { owner: string; oracle: string; collateral_token: string; paused: boolean; limits: Limits; storage_deposit_yocto: string };
type VaultView = { assets: string; insurance: string; total_shares: string; nav: string; share_price: string /* ×1e6 */; pending_funding: string /* bertanda */ };
type MarketView = { id: string; config: MarketConfig; price: string; price_ts_sec: string; is_fresh: boolean;
  long_notional: string; short_notional: string; funding_index: string; funding_rate_bps_per_hour_x1e6: string /* bertanda; positif = long membayar */ };
type AccountView = { free: string; locked: string; lp_shares: string; lp_value: string; positions: string[]; orders: string[] };
type PositionView = { id: string; owner: string; market_id: string; is_long: boolean; collateral: string; notional: string;
  entry_price: string; mark_price: string; pnl: string; funding_owed: string /* positif = trader membayar */; equity: string;
  maintenance_margin: string; liquidation_price: string; liquidatable: boolean; opened_at_sec: string };
type OrderView = { id: string; owner: string; market_id: string;
  kind: { Open: { is_long: boolean; collateral: string; leverage_bps: number } } | { Close: { position_id: string } };
  created_at_sec: string; reserved: string; executable: boolean };
```

Contoh panggilan view lewat RPC:

```json
{ "jsonrpc": "2.0", "id": "1", "method": "query",
  "params": { "request_type": "call_function", "finality": "final",
    "account_id": "<perps>", "method_name": "get_markets", "args_base64": "e30=" } }
```

### A5. Event

Log: `EVENT_JSON:{"standard":"aura-perps","version":"1.0.0","event":"<nama>","data":{…}}`

| Event | Data |
|---|---|
| `deposit`, `withdraw` | `account_id`, `amount` |
| `lp_deposit`, `lp_withdraw` | `account_id`, `amount`, `shares` |
| `withdraw_refunded` | `account_id`, `amount`, `lp_shares` |
| `open` | `position_id`, `owner`, `market_id`, `is_long`, `collateral`, `notional`, `price`, `fee` |
| `close` | `position_id`, `owner`, `price`, `pnl`, `funding`, `fee`, `payout` |
| `liquidate` | `position_id`, `owner`, `liquidator`, `price`, `equity`, `reward`, `bad_debt`, `insurance_cover` |
| `order_created` | `order_id`, `owner`, `market_id` |
| `order_cancelled` | `order_id`, `reason` (`user` / `limits` / `position gone`) |
| `price` | `market_id`, `price`, `ts_sec`, `forced` |
| `market_added` | `market_id` |
| `paused` | `paused` |

### A6. Pesan error → teks untuk pengguna

Cocokkan dengan `includes()` pada pesan panic.

| Pesan kontrak | Arti | Saran teks UI (en) |
|---|---|---|
| `Account not registered, call storage_deposit first` | Akun belum terdaftar | "Activate your account first. It takes 0.02 NEAR." |
| `Not enough free balance for collateral + fee` | Saldo kurang | "Not enough balance. You need {total} USDC including the fee." |
| `Not enough free balance` | Tarik > saldo bebas | "You can withdraw up to {free} USDC." |
| `Oracle price is stale` | Harga basi | "Price is out of date. Trading resumes when a fresh price arrives." |
| `Open interest limit reached for this side` | OI penuh | "This side is full. Try a smaller size or the other side." |
| `Position notional above limit` | Di atas batas posisi | "Position too large. Maximum is {max} USDC during the guarded launch." |
| `Collateral below minimum` | Di bawah minimum | "Use at least {min} USDC as collateral." |
| `Leverage above market maximum` / `Leverage must be at least 1x` | Leverage salah | "Choose leverage between 1x and {max}x." |
| `Too many open positions or orders` | > 5 | "You have 5 open positions. Close one to open another." |
| `Position is liquidatable, it can only be liquidated` | Tutup ditolak | "This position is below maintenance margin and will be liquidated." |
| `Not your position` | Bukan pemilik | "This position belongs to another account." |
| `Paused` | Pause | "Trading is paused. You can still close positions and withdraw." |
| `Withdrawal would push open interest over the limit` | Tarik LP terlalu besar | "The vault needs this liquidity for open positions. Try a smaller amount." |
| `A market with open interest has a stale price, try again later` | Aksi LP saat harga basi | "Vault value can't be calculated right now. Try again in a minute." |
| `Vault liquidity is locked, try a smaller amount` | Aset vault kurang | "Try a smaller amount." |
| `Requires attached deposit of exactly 1 yoctoNEAR` | Lupa 1 yocto | (bug klien; jangan sampai muncul) |

Keeper mengabaikan: `Position is not liquidatable`, `Position not found`, `Waiting for the next oracle price`.

## B. HTTP API layanan (rancangan)

Hanya baca, hanya GET, tanpa autentikasi (semua data publik), CORS dibatasi ke domain web, batas laju 60 permintaan/menit per IP. Tidak pernah mengembalikan kunci atau isi `.env`. Jumlah tetap string.

| Endpoint | Query | Respons |
|---|---|---|
| `GET /health` | - | Lihat contoh |
| `GET /prices/:market` | `from?`, `to?` (detik unix), `limit?` (≤ 1000, bawaan 300) | `[{ ts_sec, price, tx_hash }]` urut naik |
| `GET /keeper/log` | `limit?` (≤ 200) | `[{ ts_sec, kind, target_id, result, reward, tx_hash }]` |
| `GET /stats` | - | `{ markets: [{ id, price, is_fresh, long_notional, short_notional }], vault: VaultView, positions: number }` (cache 5 detik dari view kontrak) |
| `GET /agent/status`, `/agent/log`, `/agent/pnl` | - | Fase berikutnya |

```json
{
  "ok": true,
  "network": "mainnet",
  "contract": "perps.example.near",
  "oracle": { "ok": true, "last_push": { "BTC-USD": 1794460000, "ETH-USD": 1794460001, "NEAR-USD": 1794460002 }, "balance_near": "0.84" },
  "keeper": { "ok": true, "last_scan": 1794460010, "liquidations_24h": 1, "balance_near": "0.41" }
}
```

Error HTTP: `400 {"error":"bad_request","message":…}`, `404 {"error":"unknown_market"}`, `429`, `500 {"error":"internal"}`.

## C. Sumber data oracle

| Market | Sumber | Metode | Frekuensi dorong |
|---|---|---|---|
| BTC-USD, ETH-USD, NEAR-USD | ≥ 3 API harga bursa publik (pilih yang tanpa API key, verifikasi endpoint dan batas lajunya saat implementasi) | Median; buang sumber yang menyimpang > 2% dari median; butuh ≥ 2 sumber sehat | Bergerak ≥ 30 bps, atau 300 detik sejak dorong terakhir |
| GPU-H100 | Belum ditetapkan | Indeks $/GPU-jam, metode ditulis di README | Fase berikutnya |
