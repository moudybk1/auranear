# Keamanan — Aura

Kontrak **belum diaudit**. Pertahanan utamanya adalah batas dana yang kecil; kontrol di bawah memperkecil peluang dan dampak, bukan menghilangkan risiko.

## 1. Aset yang dilindungi

USDC pengguna dan LP di kontrak; kunci owner; kunci oracle; kebenaran harga; ketersediaan penarikan.

## 2. Model ancaman dan kontrol

| Ancaman | Pelaku | Kontrol | Bukti |
|---|---|---|---|
| Token palsu memanggil `ft_on_transfer` untuk mencetak saldo | Siapa saja | Hanya menerima panggilan dari kontrak collateral | Unit test `fake_token_is_rejected` |
| Saldo hilang saat transfer keluar gagal | - | Saldo dipotong dulu; callback memulihkan bila gagal; transfer sukses tidak dikredit dua kali | `withdraw_and_failed_transfer_restores_balance`, `successful_transfer_does_not_credit_twice` |
| Menarik collateral yang sedang dipakai | Trader | `free` dan `locked` dipisah | `cannot_withdraw_locked_collateral` |
| Pengurasan storage | Siapa saja | 0,02 NEAR per akun; maks 5 posisi + order | `max_positions_per_account` |
| Kunci layanan bocor (keeper) | Peretas server | Keeper hanya punya saldo NEAR kecil dan reward | Rancangan |
| Kunci oracle bocor / oracle salah | Peretas, bug | Batas loncatan per update, timestamp maju, cek basi, `set_oracle`, pause | `price_jump_rejected`, `old_timestamp_rejected`, `only_oracle_sets_price` |
| Vault terkuras posisi satu arah | Trader besar | Batas OI per sisi, notional per posisi, cap vault | `open_interest_cap`, `position_notional_cap`, `vault_cap_is_enforced` |
| LP masuk/keluar dengan NAV dari harga basi | LP | Aksi LP ditolak bila market berposisi berharga basi | `lp_actions_need_fresh_prices_when_there_is_open_interest` |
| Bad debt saat harga melompat | Pasar | Insurance fund dulu, lalu vault | `bad_debt_is_covered_by_insurance_first` |
| Overflow / pembulatan menguntungkan trader | - | `overflow-checks = true`; pembulatan ke arah vault | Test `math.rs` |
| Mengintip update indeks (market dua langkah) | Trader | Eksekusi pada harga yang lebih baru dari order | `two_step_open_and_close` |
| Owner menyalahgunakan wewenang | Owner | Tidak ada fungsi upgrade atau penarikan dana oleh owner; wewenang ditulis di README | Tinjauan kode |
| Frontend palsu / diubah | Penyerang web | Tidak ada rahasia di frontend; wallet menampilkan kontrak dan method | Rancangan |
| XSS di web | Penyerang | React escaping bawaan; tidak ada `dangerouslySetInnerHTML`; tidak merender string dari chain sebagai HTML | Tinjauan |
| Penyalahgunaan HTTP API | Siapa saja | Hanya GET, CORS terbatas, batas laju, tanpa data rahasia | Rancangan |

## 3. Wewenang tiap peran

| Peran | Bisa | Tidak bisa |
|---|---|---|
| Owner | Pause, ubah batas dan parameter market, tambah market, paksa harga, ganti oracle/owner | Menarik dana pengguna atau vault; mengubah kode setelah kunci kontrak dihapus |
| Oracle | Mengirim harga dalam batas loncatan | Melompati batas; menyentuh dana |
| Keeper | Likuidasi, eksekusi order (sama seperti siapa pun) | Melikuidasi posisi sehat |
| Trader/LP | Mengelola dana dan posisinya sendiri | Menyentuh akun lain |
| Agent (fase berikutnya) | `open_position`, `close_position`, `cancel_order` untuk akunnya | Menarik dana (butuh 1 yocto → full-access key) |

## 4. Manajemen kunci

| Kunci | Disimpan di | Jika bocor |
|---|---|---|
| Owner (akun utama) | Wallet pribadi saja | Risiko tertinggi: bisa memaksa harga. Jangan pernah di server atau repo |
| Akun kontrak | Dihapus setelah deploy final | Selama masih ada: kode bisa diganti |
| Oracle | Env var di hosting layanan | Harga bisa digeser sampai batas loncatan per update → pause + `set_oracle` |
| Keeper | Env var di hosting layanan | Hanya saldo NEAR kecil dan reward |

Aturan: tidak ada kunci atau seed phrase di repo, chat, log, atau screenshot. `.env` di `.gitignore`. Saldo NEAR akun layanan dijaga kecil. Layanan tidak pernah mencetak isi env.

## 5. Daftar periksa keamanan untuk yang membangun

**Layanan**
- [ ] Kunci hanya dari env; proses gagal start bila env wajib kosong
- [ ] Semua jumlah `BigInt`/string; tidak ada `Number` untuk uang
- [ ] Oracle: median ≥ 3 sumber, buang pencilan > 2%, minimal 2 sumber sehat, tolak harga ≤ 0, timeout 3 detik per sumber
- [ ] Oracle tidak pernah memanggil `set_price_force`
- [ ] Retry dengan backoff; tidak mengirim ulang transaksi yang mungkin sudah masuk tanpa cek state
- [ ] HTTP: hanya GET, CORS ke domain web, batas laju, validasi parameter, tanpa stack trace di respons
- [ ] Log tidak memuat kunci

**Web**
- [ ] Tidak ada rahasia di `NEXT_PUBLIC_*`
- [ ] Tidak ada `dangerouslySetInnerHTML`; id market dan akun dari chain dirender sebagai teks
- [ ] Jumlah dikonversi ke base unit dengan `BigInt`, bukan perkalian float
- [ ] `withdraw`, `lp_withdraw`, `ft_transfer_call` selalu melampirkan 1 yocto
- [ ] Alamat kontrak dari env, ditampilkan di footer dengan tautan explorer
- [ ] Banner "Unaudited prototype" selalu terlihat
- [x] Header keamanan: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` (14 Nov, `web/next.config.ts`)
- [ ] CSP (butuh daftar host RPC, data chart, dan wallet; belum ada)

**Kontrak (bila diubah)**
- [ ] State diperbarui sebelum promise; callback memulihkan bila gagal
- [ ] Method admin dan penarikan: `assert_one_yocto`
- [ ] Tidak menambah loop atas semua posisi di method yang mengubah state
- [ ] Tambah test dan jalankan invarian `assert_solvent`

## 6. Pemantauan harian (sampai 25 Nov)

- [ ] `/health` sehat untuk oracle dan keeper
- [ ] Umur harga tiap market < batas basi
- [ ] Saldo NEAR oracle dan keeper cukup
- [ ] Saldo USDC kontrak = Σ saldo pengguna + vault + insurance
- [ ] Tidak ada posisi liquidatable yang tertinggal

## 7. Runbook insiden

| Kejadian | Langkah |
|---|---|
| Harga salah terkirim | `set_paused(true)` → perbaiki sumber → `set_price_force` ke harga benar → periksa posisi terdampak → buka pause |
| Kunci oracle bocor | `set_paused(true)` → akun oracle baru → `set_oracle` → ganti kunci di hosting → buka pause |
| Layanan mati | Trading berhenti sendiri (harga basi) → hidupkan ulang → bila lama, tulis di README |
| Selisih akuntansi | `set_paused(true)` → jangan tambah dana → telusuri event → pengguna tetap bisa tutup dan tarik |
| Bug kontrak sebelum kunci dihapus | Pause → perbaiki → uji → deploy ulang |
| Bug kontrak setelah kunci dihapus | Pause permanen → pengguna tutup dan tarik → kontrak baru di akun baru |

## 8. Keterbatasan yang diketahui (ditulis juga di README)

| Keterbatasan | Dampak | Rencana |
|---|---|---|
| Belum diaudit; wasm belum pernah di-build; script deploy belum pernah dijalankan | Bisa ada bug yang tidak tertangkap unit test | Gladi testnet; batas dana kecil |
| Owner bisa memaksa harga dan mengganti oracle | Owner jahat/diretas bisa merugikan vault lewat harga palsu | Batas kecil; multisig + timelock nanti |
| Oracle satu akun | Satu titik gagal untuk harga | TEE atau banyak pelapor |
| **Latensi harga di market langsung** | Trader yang melihat harga bursa bergerak sebelum oracle mendorong bisa mengambil untung dari vault; fee 0,1% per sisi hanya menutup sebagian | Ambang dorong lebih kecil; atau dua langkah untuk semua market; atau spread dinamis |
| Tiga market crypto saling berkorelasi | Vault bisa menanggung satu arah sampai 90% NAV | Batas OI 30% per market; pertimbangkan batas OI global |
| Likuidasi bergantung pada keeper | Tanpa pemanggil, posisi rugi menjadi bad debt | Reward 20% untuk siapa pun; keeper kita berjalan terus |
| Payout dibatasi aset vault | Dalam kasus ekstrem trader untung menerima kurang | Batas OI membuat ini sangat tidak mungkin |
| Cek order tutup ganda memindai semua order | Gas naik bila order sangat banyak (hanya market dua langkah) | Ganti dengan penanda di posisi |
| Posisi liquidatable tidak bisa ditutup pemiliknya | Pemilik kehilangan sisa equity | Disengaja; ditampilkan di UI |
| Tidak ada tutup sebagian / tambah margin | Harus tutup lalu buka ulang | Fase lanjut |
