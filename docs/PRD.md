# PRD — Aura

## 1. Ringkasan

Aura memberi trader di NEAR cara long/short BTC, ETH, dan NEAR dengan leverage lewat satu kontrak sederhana, dan pada fase berikutnya memberi AI agent cara mengunci biaya compute lewat market harga sewa GPU.

## 2. Masalah

- Perps yang tersedia lewat NEAR saat ini merutekan ke venue luar; belum ada mesin perps sederhana yang berjalan sebagai kontrak NEAR sendiri dan bisa dipanggil langsung oleh agent.
- Harga sewa GPU berubah besar dari bulan ke bulan, sehingga agent yang membayar compute sendiri tidak bisa merencanakan anggaran. Futures compute sudah muncul di bursa tradisional dan beberapa venue crypto, tetapi belum ada di NEAR.

## 3. Persona

| Persona | Kebutuhan | Ukuran berhasil |
|---|---|---|
| Trader | Long/short BTC, ETH, NEAR dengan leverage | Posisi terbuka dalam satu konfirmasi wallet |
| LP | Imbal hasil dari fee dan funding | Nilai share naik saat ada volume |
| Keeper | Reward likuidasi | Reward masuk saldo bebas |
| Owner | Menjalankan sistem dengan aman | Bisa pause dan mengubah batas |
| Juri hackathon | Menilai dalam beberapa menit | Mengikuti README dan melihat hasil yang dijanjikan |
| AI agent (fase berikutnya) | Mengunci biaya GPU-jam tanpa kunci penuh | Biaya bersih stabil saat indeks naik |

## 4. Tujuan

1. Mesin perps berfungsi penuh di NEAR mainnet untuk tiga market (BTC-USD, ETH-USD, NEAR-USD) dengan batas kecil.
2. Web app yang mengikuti design system Aura: Trade dan Vault.
3. Layanan oracle dan keeper yang berjalan terus selama penjurian.
4. Bisa direproduksi: test, script deploy, README.
5. Fase berikutnya: market GPU-H100 (dua langkah) dan agent hedging.

## 5. Bukan tujuan

Orderbook, limit order, TP/SL, cross-margin, banyak collateral, tutup sebagian, tambah margin, token protokol, listing market tanpa izin, aplikasi mobile native, skala dana besar.

## 6. Kebutuhan fungsional

Kolom "Kontrak" menunjukkan status di kontrak. Web dan layanan belum dibangun.

| ID | Kebutuhan | Kriteria penerimaan | Prioritas | Kontrak |
|---|---|---|---|---|
| F1 | Registrasi akun | `storage_deposit` 0,02 NEAR membuat akun; akun kosong bisa dihapus dan deposit kembali | P0 | Teruji |
| F2 | Deposit collateral | `ft_transfer_call` msg `deposit` menambah saldo bebas; token lain ditolak; di atas batas, akun belum terdaftar, atau saat pause → dikembalikan penuh | P0 | Teruji |
| F3 | Tarik collateral | `withdraw` mengurangi saldo bebas, mengirim USDC; transfer gagal memulihkan saldo; butuh 1 yocto | P0 | Teruji |
| F4 | Setor/tarik LP | Setoran pertama 1:1, berikutnya ikut NAV; penarikan ditolak bila melanggar batas OI atau harga basi | P0 | Teruji |
| F5 | Buka posisi | Long/short, leverage 1x sampai maksimum; fee dipotong; batas OI, notional, jumlah posisi ditegakkan | P0 | Teruji |
| F6 | Tutup posisi | Pemilik menerima collateral + PnL − funding − fee; posisi yang sudah liquidatable tidak bisa ditutup biasa | P0 | Teruji |
| F7 | Likuidasi | Siapa pun yang terdaftar bisa melikuidasi saat equity ≤ maintenance margin; reward 20% sisa equity | P0 | Teruji |
| F8 | Oracle | Hanya akun oracle; timestamp maju; loncatan > batas ditolak; harga basi memblokir trading | P0 | Teruji |
| F9 | Batas dan pause | Owner bisa pause dan ubah batas; tutup posisi dan tarik dana tetap jalan saat pause | P0 | Teruji |
| F10 | Funding | Sisi mayoritas membayar; posisi baru tidak menanggung funding lama | P0 | Teruji |
| F11 | Tiga market | BTC-USD, ETH-USD, NEAR-USD terdaftar, presisi benar pada harga besar | P0 | Teruji |
| F12 | Web: Trade | Pilih market, arah, collateral, leverage; ringkasan (notional, fee, harga likuidasi) sebelum konfirmasi; daftar posisi + PnL | P0 | - |
| F13 | Web: Vault | Setor/tarik LP; NAV, harga share, utilisasi OI per market | P0 | - |
| F14 | Web: akun | Connect wallet, aktivasi akun, deposit, tarik, saldo bebas/terkunci | P0 | - |
| F15 | Oracle pusher | Median ≥3 sumber; dorong saat bergerak ≥30 bps atau tiap 300 detik | P0 | - |
| F16 | Keeper | Pindai tiap 15 detik dan melikuidasi | P0 | - |
| F17 | HTTP API | `/health`, riwayat harga, log keeper | P1 | - |
| F18 | Tema terang/gelap dan dua bahasa | Sesuai design system | P1 | - |
| F19 | Order dua langkah | Order dieksekusi pada harga oracle yang lebih baru dari order | Fase berikutnya | Teruji |
| F20 | Market GPU-H100 + agent hedging + halaman Agent | Lihat `docs/ROADMAP.md` | Fase berikutnya | Sebagian |

## 7. Kebutuhan non-fungsional

| Aspek | Kebutuhan |
|---|---|
| Kebenaran | Saldo pengguna + aset vault + insurance = USDC yang dipegang kontrak, selalu |
| Gas | Setiap method < 300 Tgas; tidak ada loop atas semua posisi di method yang mengubah state |
| Ketersediaan | Dana bisa ditarik walau layanan mati; trading berhenti sendiri saat harga basi |
| Keterbukaan | Semua parameter terbaca lewat view; semua aksi mengeluarkan event |
| Reproduksi | `cargo test` tanpa akun NEAR; deploy dengan script |
| Aksesibilitas | WCAG AA untuk teks; ring fokus di semua kontrol; status tidak hanya lewat warna |
| Kinerja web | Data utama tampil < 2 detik; polling 5 detik untuk harga dan posisi |
| Responsif | Layak pakai dari lebar 360px |
| Biaya | Sekitar 15 NEAR untuk deploy dan operasi sampai 25 Nov (perkiraan, diukur di testnet) |

## 8. Metrik sukses hackathon

| Metrik | Target |
|---|---|
| Unit test lulus | 100% |
| Siklus penuh di mainnet (setor LP, buka, tutup, likuidasi, tarik) | ≥ 1 kali, terlihat di explorer |
| Waktu juri dari buka demo sampai posisi pertama | < 2 menit |
| Harga oracle basi selama penjurian | 0 kejadian di luar batas market |
| Selisih akuntansi | 0 |

## 9. Risiko produk

| Risiko | Mitigasi |
|---|---|
| Dianggap mirip perps NEAR yang sudah ada | Tonjolkan: kontrak sendiri, bisa dipanggil agent dengan kunci terbatas, jalur ke market GPU |
| Latensi harga merugikan LP | Ambang dorong kecil, fee, batas kecil; tulis terbuka |
| Juri tidak punya USDC di NEAR | README menjelaskan cara mendapatkannya; sediakan juga demo testnet dengan faucet tUSD |
