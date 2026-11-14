# MVP — Aura

MVP adalah semua kebutuhan P0 di `docs/PRD.md` berjalan di mainnet untuk tiga market (BTC-USD, ETH-USD, NEAR-USD), ditambah README, video, dan submission.

## 1. Dalam MVP

| Area | Isi |
|---|---|
| Kontrak | Akun (NEP-145), deposit/tarik, vault LP, buka/tutup posisi, likuidasi, funding, oracle, batas, pause |
| Market | BTC-USD, ETH-USD, NEAR-USD; 10x; eksekusi langsung |
| Layanan | Oracle pusher untuk 3 market, keeper likuidasi, `/health` |
| Web | Header (wallet, jaringan, tema), halaman Trade, halaman Vault, panel akun (aktivasi, deposit, tarik) |
| Operasi | Script deploy, `.env.example`, README yang bisa diikuti |

## 2. Di luar MVP

| Dalam MVP | Ditunda |
|---|---|
| Satu collateral: USDC native | Collateral lain, deposit lintas chain (NEAR Intents) |
| Margin terisolasi | Cross-margin |
| Eksekusi di harga oracle | Orderbook, limit order, TP/SL |
| Tutup posisi penuh | Tutup sebagian, tambah collateral |
| Oracle satu akun | Oracle TEE atau banyak pelapor |
| Owner satu akun | Multisig, timelock |
| 3 market crypto | GPU-H100, agent hedging, halaman Agent |
| Grafik harga sederhana (garis dari riwayat push) | Charting lengkap (candlestick, indikator) |

## 3. Definisi selesai

Keputusan 14 Nov: submission hackathon memakai **testnet saja** (diperbolehkan, lihat `docs/ROADMAP.md` §1). Butir mainnet ditunda sampai bug kontrak yang tercatat di README diperbaiki.

- [x] `cargo test` di `contracts/perps`: 40 lulus (dijalankan ulang 14 Nov)
- [x] Wasm ter-build dan ter-deploy di testnet; 3 market terdaftar (12 Nov)
- [x] Oracle menjaga 3 market tetap segar 30 menit tanpa error (13 Nov, dari laptop)
- [x] Keeper melikuidasi posisi uji di testnet (13 Nov)
- [x] Lewat web di testnet: aktivasi, deposit, buka long, buka short, tutup, tarik, setor LP, tarik LP (buka long 13 Nov dengan akun owner; sisanya 14 Nov dengan akun baru; semuanya lewat wallet NEAR CLI, wallet ekstensi belum dicoba)
- [ ] UI memakai token design system, tema terang dan gelap, satu tombol primary per tampilan
- [ ] Harga basi, pause, dan batas guarded launch tampil jelas di UI (harga basi 12 Nov dan banner pause 14 Nov sudah terlihat; batas guarded launch hanya berlaku di mainnet)
- [ ] Deploy mainnet oleh pemilik; seed vault; satu siklus penuh nominal kecil (ditunda, lihat keputusan di atas)
- [x] Web dan layanan di-hosting; `/health` sehat (14 Nov; `/health` baru bisa dicek dari dalam server)
- [ ] README final + LICENSE; repo publik
- [ ] Video 2–3 menit; post X dengan @NEARProtocol dan #NEARHackathon; form terkirim

## 4. Urutan potong bila waktu habis

1. Dua bahasa → satu bahasa (Inggris).
2. Tema gelap.
3. Grafik harga → cukup angka harga dan umur harga.
4. HTTP API riwayat → cukup `/health`.
5. Halaman Vault disederhanakan (tanpa utilisasi per market).

Tidak boleh dipotong: kontrak di mainnet, oracle + keeper hidup, halaman Trade, README yang bisa direproduksi, video, submission.

## 5. Skenario demo MVP

1. LP menyetor ke vault.
2. Trader A long BTC 5x; trader B short ETH 3x.
3. Harga bergerak; PnL berubah di UI.
4. Posisi leverage 10x mendekati likuidasi, lalu dilikuidasi keeper; transaksi terlihat di explorer.
5. Trader menutup posisi dan menarik USDC.
6. Nilai share LP berubah sesuai hasil trader.
