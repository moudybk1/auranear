# Spesifikasi layanan — oracle, keeper, HTTP API

Satu proses Node.js (TypeScript) menjalankan loop oracle, loop keeper, dan satu server HTTP. Baca bersama `docs/API.md` dan `docs/DATABASE.md`.

**Status 13 Nov 2026:** oracle, keeper, dan `GET /health` sudah dibangun di `services/` dan dijalankan ke testnet (hasil: `AGENTS.md` §2). Yang berbeda dari dokumen ini:

| Di spec | Yang dibangun |
|---|---|
| Struktur §1 (10 file), `tsx`, `npm run build` | Lima file: `src/index.ts` (start, `/health`), `near.ts` (env, RPC, log), `price.ts` (matematika murni), `oracle.ts`, `keeper.ts`. Node ≥ 22.22 menjalankan TypeScript langsung, tanpa build |
| SQLite, `/prices`, `/keeper/log`, `/stats`, batas laju | Belum ada. `/health` membaca state di memori, jadi `liquidations_24h` kembali 0 saat proses restart |
| Sumber harga: ≥ 3, dipilih saat implementasi | Binance (mirror data publik), Gate, HTX: yang terjangkau dan terverifikasi dari jaringan pemilik pada 13 Nov. Semuanya pasangan USDT |
| Ambang dorong 10 bps (dibulatkan ke bawah; 30 sampai 15 Nov, lalu diturunkan karena selisih ke harga bursa terukur 30–47 bps) | Gerak dibulatkan ke atas seperti `move_bps` di kontrak, supaya keputusan dorong bertahap selalu cocok dengan kontrak |
| Keeper mencatat reward dari nilai kembali | Log hanya memuat `position_id` dan `tx_hash`; reward ada di event `liquidate` |
| Unit test §7 | `npm test`: 4 test untuk parse desimal, median dan pencilan, keputusan dorong, dorong bertahap. Uji "matikan 2 sumber" belum dijalankan |

## 1. Struktur

```
services/
  package.json  tsconfig.json  .env.example
  src/
    index.ts          start: muat config, buka DB, jalankan oracle + keeper + http; tangani SIGTERM
    config.ts         baca dan validasi env (gagal start bila yang wajib kosong)
    near.ts           koneksi near-api-js, akun oracle dan keeper, view() dan call() dengan fallback RPC
    db.ts             better-sqlite3, skema dari docs/DATABASE.md §B
    oracle/
      sources.ts      satu fungsi per sumber: (symbol) => Promise<bigint>  (micro-USD)
      aggregate.ts    median + buang pencilan
      loop.ts         loop dorong harga
    keeper/loop.ts    loop likuidasi (+ eksekusi order di fase berikutnya)
    http/server.ts    endpoint GET
    log.ts            log JSON satu baris, tanpa rahasia
  test/               unit test aggregate, parser harga, keputusan dorong
```

Skrip: `npm run dev` (tsx watch), `npm run build`, `npm start`, `npm test`.

## 2. Konfigurasi

Lihat tabel `services/.env` di `docs/BLUEPRINT.md` §9. Kunci privat berformat `ed25519:…`, dimuat ke `InMemoryKeyStore`. Jangan pernah mencetaknya.

## 3. Oracle pusher

### Sumber harga

- Minimal **3 sumber publik tanpa API key** per simbol (BTC, ETH, NEAR terhadap USD atau USDT/USDC). Pilih bursa besar dengan endpoint ticker publik; **verifikasi URL, format respons, dan batas laju dari dokumentasi resmi masing-masing saat implementasi** (jangan mengandalkan ingatan).
- Tiap sumber: timeout 3 detik, parse string desimal → micro-USD dengan `BigInt` (tanpa float), tolak nilai ≤ 0.
- Harga terhadap stablecoin diperlakukan sebagai USD (ditulis di README sebagai asumsi).

### Agregasi (`aggregate.ts`)

```
prices  = hasil sumber yang sukses
jika prices.length < 2 → tidak ada harga (jangan dorong)
median0 = median(prices)
sehat   = prices yang |p − median0| / median0 ≤ 2%
jika sehat.length < 2 → tidak ada harga
harga   = median(sehat)          // jumlah genap: rata-rata dua tengah, dibulatkan ke bawah
```

### Loop (tiap 5 detik, per market)

```
onchain = view get_market(market)                // price, price_ts_sec, config
baru    = agregasi()
jika tidak ada baru → catat peringatan, lanjut   // harga akan basi sendiri
gerak   = |baru − onchain.price| × 10000 / onchain.price     (bps; bila onchain.price = 0 → dorong)
umur    = now − onchain.price_ts_sec
dorong jika gerak ≥ PRICE_PUSH_BPS (10) ATAU umur ≥ PRICE_PUSH_MAX_SEC (300)
```

Saat mendorong:

1. **Batas loncatan.** Bila `gerak > max_price_jump_bps` (500), kontrak akan menolak. Dorong bertahap: kirim harga yang berjarak tepat `max_price_jump_bps − 10` bps ke arah target, ulangi di putaran berikutnya. Catat peringatan. Jangan pernah memanggil `set_price_force` (itu hak owner).
2. `ts_sec = Math.floor(Date.now()/1000)`; pastikan `> onchain.price_ts_sec` (bila tidak, pakai `price_ts_sec + 1`) dan tidak lebih dari 60 detik di depan waktu blok.
3. `call set_price({market_id, price: String(harga), ts_sec: String(ts)})`, gas 30 Tgas.
4. Tulis baris `price_pushes` (`sent` → `confirmed`/`failed`), perbarui `service_state`.

Ketahanan: satu market gagal tidak menghentikan market lain; error RPC → coba RPC cadangan; backoff eksponensial sampai 60 detik; nonce ditangani berurutan (satu transaksi oracle pada satu waktu, atau satu access key per market).

Biaya: 3 market × (≥ 288 dorong heartbeat/hari + dorong karena gerak). **Ukur gas per `set_price` di testnet** dan hitung kebutuhan NEAR sampai 25 Nov sebelum mainnet; naikkan `PRICE_PUSH_BPS` bila terlalu mahal.

## 4. Keeper

Loop tiap `KEEPER_INTERVAL_SEC` (15):

```
n = view get_num_positions()
untuk from = 0; from < n; from += 100:
    ids = view get_liquidatable({from_index: from, limit: 100})
    untuk tiap id:
        coba call liquidate({position_id: id})     // gas 50 Tgas
        sukses → keeper_actions(ok, reward dari nilai kembali)
        error "Position is not liquidatable" / "Position not found" → skipped
        error "Oracle price is stale" → hentikan putaran ini
        error lain → failed + pesan
```

- Akun keeper harus terdaftar di kontrak perps (`storage_deposit`; dilakukan `scripts/02-deploy.sh`).
- Reward menumpuk di saldo bebas keeper di kontrak; penarikan manual oleh pemilik.
- Fase berikutnya: `get_orders` → `execute_order` untuk yang `executable`.

## 5. HTTP API

Kerangka ringan (Fastify atau `node:http`). Endpoint dan bentuk respons: `docs/API.md` §B.

- Hanya GET; CORS `CORS_ORIGIN`; batas laju 60/menit per IP; validasi `market` terhadap `MARKETS`; `limit` dibatasi.
- `/health`: `ok = false` bila dorong terakhir suatu market > `stale_after_sec` lalu, atau pindai keeper terakhir > 60 detik lalu. Status HTTP tetap 200 dengan `ok:false` (pemantau membaca isi).
- `/stats`: cache 5 detik dari view kontrak.
- Tidak ada endpoint tulis. Tidak ada data rahasia. Tanpa stack trace di respons.

## 6. Log dan pemantauan

- Log JSON: `{ts, level, component, event, market?, tx_hash?, message?}`.
- Peringatan: sumber harga gagal, sumber sehat < 3, dorong bertahap aktif, saldo NEAR oracle/keeper < 0,2 NEAR, likuidasi gagal.
- Restart otomatis oleh platform hosting; `SIGTERM` menutup DB dengan rapi.

## 7. Pengujian layanan

- [ ] Unit: median dan pembuangan pencilan (termasuk 2 sumber, 1 sumber, sumber menyimpang 3%)
- [ ] Unit: parse string desimal → micro-USD tanpa float (`"103245.67"`, `"3.1"`, `"0.000001"`)
- [ ] Unit: keputusan dorong (gerak 29 bps tidak, 30 bps ya, umur 300 detik ya)
- [ ] Unit: dorong bertahap saat gerak > batas loncatan
- [ ] Integrasi testnet: 3 market segar 30 menit; matikan 2 sumber → tetap jalan; matikan semua → harga basi dan trading terblokir
- [ ] Integrasi testnet: posisi 10x dibuat, harga digeser (owner `set_price_force`), keeper melikuidasi dalam ≤ 30 detik

## 8. Fase berikutnya: agent hedging (`agent/loop.ts`)

- Kunci: function-call key akun agent, hanya `open_position`, `close_position`, `cancel_order` (dibuat `scripts/05-fund-agent.sh`).
- Loop tiap 5 menit: `target = AGENT_GPU_HOURS_PER_DAY × 30 × harga_indeks × AGENT_HEDGE_RATIO_BPS / 10000`, dibatasi `max_position_notional`; bila posisi menyimpang > 10% dari target → buat order tutup lalu order buka dengan ukuran baru; catat `agent_decisions` dengan alasan.
- Endpoint: `/agent/status`, `/agent/log`, `/agent/pnl`.
