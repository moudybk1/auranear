# User flow — Aura

Setiap langkah menyebut method kontrak yang dipanggil, sehingga dokumen ini juga menjadi naskah uji manual.

## 1. Trader

### 1.1 Pertama kali (onboarding)

1. Buka web app. Halaman Trade tampil dalam mode baca: harga dan market terlihat tanpa wallet.
2. Klik "Connect wallet" → pilih wallet NEAR (wallet selector).
3. Web memanggil `get_account(account_id)`.
   - `null` → tampilkan kartu "Activate account" (butuh 0,02 NEAR).
   - Ada → lanjut ke 1.2.
4. Klik "Activate and deposit": **satu persetujuan wallet berisi dua transaksi**:
   - `storage_deposit` di kontrak perps (deposit 0,02 NEAR), lalu
   - `ft_transfer_call` di kontrak USDC (`receiver_id` = kontrak perps, `amount`, `msg: "deposit"`, deposit 1 yocto, gas 100 Tgas).
   Keduanya menuju kontrak berbeda, jadi dikirim sebagai dua transaksi dalam satu permintaan `signAndSendTransactions`.
5. Setelah sukses: saldo bebas tampil. Bila deposit dikembalikan (lihat §6), tampilkan alasannya.

### 1.2 Buka posisi (market langsung: BTC-USD, ETH-USD, NEAR-USD)

1. Pilih market di pemilih market.
2. Pilih arah: Long atau Short.
3. Isi collateral (USDC) dan leverage (slider 1x–10x, langkah 0,5x).
4. Panel ringkasan menghitung di klien: notional, fee buka, perkiraan harga likuidasi, sisa kapasitas OI sisi itu.
5. Validasi klien (tombol nonaktif + pesan): saldo bebas ≥ collateral + fee; collateral ≥ minimum; notional ≤ batas; jumlah posisi < 5; harga segar; tidak pause; OI cukup.
6. Klik "Open long" / "Open short" → `open_position(market_id, is_long, collateral, leverage_bps)`.
7. Posisi muncul di tabel dengan: market, arah, ukuran, harga masuk, harga sekarang, PnL, funding, equity, harga likuidasi.

### 1.3 Pantau dan tutup

1. Tabel posisi diperbarui tiap 5 detik lewat `get_positions_of`.
2. Bila equity mendekati maintenance margin (rasio margin < 1,5× maintenance) → badge "At risk".
3. Klik "Close position" → dialog konfirmasi menampilkan perkiraan hasil → `close_position(position_id)`.
4. Hasil (collateral + PnL − funding − fee) masuk saldo bebas.
5. Bila posisi sudah liquidatable, tombol tutup nonaktif dengan penjelasan: posisi hanya bisa dilikuidasi.

### 1.4 Tarik dana

1. Buka panel akun → "Withdraw".
2. Isi jumlah (≤ saldo bebas) → `withdraw(amount)` dengan deposit 1 yocto.
3. USDC kembali ke wallet. Bila transfer gagal, saldo dipulihkan otomatis oleh callback; UI memuat ulang saldo.

## 2. LP

1. Buka halaman Vault: NAV, harga share, aset, insurance, OI long/short per market, batas vault.
2. Aktivasi akun bila belum (sama seperti 1.1).
3. Setor: isi jumlah → `ft_transfer_call` USDC dengan `msg: "lp"`. Menerima shares sesuai NAV.
4. Kartu "Your position": shares, nilai sekarang (`lp_value`).
5. Tarik: isi jumlah shares atau persen → `lp_withdraw(shares)` (1 yocto).
6. Penolakan yang mungkin: OI akan melewati batas; harga basi di market yang punya posisi; likuiditas vault terkunci.

## 3. Keeper (layanan)

1. Tiap 15 detik: `get_num_positions`, lalu `get_liquidatable(from_index, limit=100)` berhalaman.
2. Untuk tiap id: `liquidate(position_id)`. Error "Position is not liquidatable" diabaikan.
3. (Fase berikutnya) `get_orders` → `execute_order` untuk yang `executable`.
4. Reward masuk saldo bebas keeper di kontrak; ditarik manual oleh pemilik.

## 4. Oracle (layanan)

1. Tiap 5 detik ambil harga dari ≥3 sumber per market, hitung median.
2. Dorong `set_price(market_id, price, ts_sec)` bila bergerak ≥ 10 bps dari harga on-chain, atau sudah 300 detik sejak dorong terakhir.
3. Bila sumber sehat < 2: tidak mendorong. Harga menjadi basi dan kontrak memblokir trading.

## 5. Owner

1. Deploy: `scripts/01` (akun) → `02` (deploy + init + storage) → `03` (market) → `04` (seed vault).
2. Operasi: `set_paused`, `update_limits`, `update_market_config`, `set_price_force`, `set_oracle`.
3. Setelah deploy final: hapus kunci akun kontrak.

## 6. Siklus hidup order dan posisi

```
                 open_position (BTC/ETH/NEAR: langsung)
        ┌──────────────────────────────────────────────────┐
        │                                                  ▼
 ┌─────────────┐  open (GPU)  ┌────────────────┐ execute ┌────────────────┐
 │ Saldo bebas │ ───────────▶ │ Order menunggu │ ──────▶ │ Posisi terbuka │
 └─────────────┘ ◀─────────── └────────────────┘         └───┬────────┬───┘
        ▲          cancel_order                              │        │ liquidate
        │                                     close_position │        │ (equity ≤ maintenance)
        │   hasil = equity − fee    ┌──────────┐             │        ▼
        └────────────────────────── │ Ditutup  │ ◀───────────┘  ┌──────────────┐
                                    └──────────┘                │ Dilikuidasi  │
                                                                │ 20% reward,  │
                                                                │ sisa → vault │
                                                                └──────────────┘
```

Dana selalu kembali ke saldo bebas, kecuali saat posisi dilikuidasi: pemilik kehilangan seluruh collateral posisi itu.

## 7. Keadaan dan error di UI

| Kondisi | Deteksi | Yang ditampilkan | Aksi UI |
|---|---|---|---|
| Wallet belum terhubung | Tidak ada akun aktif | Mode baca | Tombol primary "Connect wallet" |
| Akun belum terdaftar | `get_account` = null | Kartu aktivasi | Gabungkan `storage_deposit` |
| Belum terdaftar di USDC | `storage_balance_of` di USDC = null | (jarang) | Tambah `storage_deposit` USDC ke transaksi |
| Harga basi | `is_fresh` = false | Badge warning "Price stale" + umur harga | Nonaktifkan buka/tutup; tarik tetap aktif |
| Pause | `get_config().paused` | Alert warning di atas halaman | Nonaktifkan buka dan deposit |
| Batas OI | Dihitung dari `get_market` + `get_vault` | "This side is full" + sisa kapasitas | Nonaktifkan tombol |
| Batas per trader/posisi | `get_config().limits` | Hint di bawah input | Validasi form |
| Deposit dikembalikan | Log transaksi `Refunding deposit: …` | Alert warning dengan alasan | Tidak mengubah saldo |
| Transaksi gagal | Hasil wallet | Alert danger: apa yang salah + cara memperbaiki (peta di `docs/API.md` §5) | Biarkan form terisi |
| Posisi dilikuidasi | Posisi hilang antar polling + event | Alert info "Position liquidated" | Muat ulang saldo |
| Transaksi berjalan | Menunggu wallet | Tombol `loading` | Kunci form |
| Jaringan salah | Jaringan wallet ≠ `NEXT_PUBLIC_NETWORK` | Alert warning | Minta ganti jaringan |

## 8. Fase berikutnya: market dua langkah dan agent

- GPU-H100: `open_position` membuat order (collateral + fee dikunci). Setelah harga oracle baru, keeper memanggil `execute_order`. Sebelum itu trader boleh `cancel_order`. Menutup juga lewat order.
- Agent: owner mendanai akun agent (script 05), membuat function-call key untuk `open_position`, `close_position`, `cancel_order`. Agent menjaga posisi long dalam 10% dari target (`kebutuhan GPU-jam × harga indeks × rasio hedge`) dan mencatat alasannya.
