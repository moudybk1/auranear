# AGENTS.md — brief untuk agent yang membangun Aura

Baca file ini dulu. Ini menjelaskan apa yang sudah ada, apa yang harus kamu bangun, urutannya, dan kapan sebuah bagian dianggap selesai.

## 1. Apa itu Aura

Aura adalah perps exchange model pool di NEAR. Trader menyetor USDC, membuka long/short dengan leverage, dan LP vault menjadi lawan semua posisi. Harga datang dari oracle yang mendorong harga ke kontrak.

- Market tahap awal: `BTC-USD`, `ETH-USD`, `NEAR-USD` (eksekusi langsung di harga oracle).
- Fase berikutnya: `GPU-H100` (indeks harga sewa GPU, eksekusi dua langkah) dan agent hedging biaya compute. Dukungannya di kontrak sudah ada.
- Konteks: dibangun untuk NEAR Hackathon. Batas submit **Minggu 15 Nov 2026, 06:59 WIB** (14 Nov 23:59 UTC).

## 2. Status (12 Nov 2026, setelah gladi testnet)

| Bagian | Lokasi | Status |
|---|---|---|
| Kontrak perps | `contracts/perps` | `cargo test` = 44 lulus (dua perbaikan bug 15 Nov sudah di-deploy ulang ke testnet tanpa mengubah state). Wasm ter-build tanpa perubahan kode (281 KB) dan **ter-deploy di testnet** (`perps.aura-perps.testnet`): 3 market, vault berisi setoran LP. Satu siklus deposit, buka, tutup, tarik, tarik LP sudah berjalan di sana dan invarian cocok. Belum di mainnet. |
| Token tes tUSD | `contracts/mock-ft` | Ter-deploy di testnet (`tusd.aura-perps.testnet`). Hanya untuk testnet. |
| Script deploy | `scripts/01..06` | `01`–`04` sudah dijalankan di testnet (near-cli-rs 0.30.1, cargo-near 0.23.0, bash 3.2 macOS). `05` **belum pernah dijalankan**. `06-push-prices.sh` mendorong satu harga manual per market (testnet saja); cadangan saat layanan oracle tidak berjalan. `07-force-price.sh` (14 Nov, testnet saja) menurunkan harga satu market sebagai owner untuk adegan likuidasi di demo; lihat runbook di `docs/ROADMAP.md` §4. |
| Design system | `web/styles/`, `web/app/fonts/` | Folder kit `design-system/` **tidak ikut di repo ini**. Yang ada: token di `web/styles/aura-tokens.css`, gaya komponen di `web/styles/aura-components.css`, font self-hosted di `web/app/fonts/`, logo di `web/components/Logo.tsx`, port komponen di `web/components/ui.tsx`. |
| Layanan (oracle, keeper, `/health`) | `services/` | Dibangun 13 Nov: `npm test` = 4 lulus, `npm run typecheck` bersih. Sudah dijalankan ke testnet dari laptop pemilik: oracle mendorong median Binance, Gate, HTX dan ketiga market segar lagi setelah basi 19 jam; keeper melikuidasi posisi uji 10x sekitar 20 detik setelah `set_price_force` −6% di NEAR-USD; oracle lalu mengembalikan harga dalam dua dorongan (dorong bertahap). 14 Nov: di-hosting di VPS pemilik sebagai unit systemd `aura-services`, dan dorongan harga pertama dari sana sudah masuk; `/health` baru bisa dicek dari dalam server (lihat `docs/DEPLOYMENT.md` §6). Belum ada SQLite, `/prices`, `/keeper/log`, `/stats`, batas laju: lihat catatan di awal `docs/SERVICES_SPEC.md`. |
| Web app | `web/` | Trade dan Vault sudah dibangun. Dengan `web/.env.local` membaca kontrak testnet; tanpa itu berjalan dalam mode demo. Deposit, buka, tutup, tarik sudah ditandatangani dari UI di testnet lewat wallet NEAR CLI. Dialog app dulu menutupi wallet yang tampil di dalam halaman; sudah diperbaiki di `Dialog` (`web/components/ui.tsx`) dan diuji di ketiga dialog. 14 Nov: akun baru `trader1.aura-perps.testnet` menjalani siklus penuh dari UI lewat wallet NEAR CLI (faucet, aktivasi + deposit, buka short, tutup, setor vault, tarik vault, tarik), dan invarian token cocok sesudahnya. Toast likuidasi dan banner pause juga sudah terlihat di testnet, dan keeper di VPS melikuidasi dua posisi uji 10x setelah harga digeser −20% (pada −6% oracle memulihkan harga sebelum pindaian keeper). Header keamanan dasar ditambahkan di `web/next.config.ts`. Wallet ekstensi dan penandatanganan di situs yang di-hosting belum dicoba. 13 Nov: dialog deposit dan setor vault punya tombol faucet tUSD di testnet (1.000 per klik, diuji dari UI dengan akun owner), dan chip `No registered provider serves ""` di chart sudah hilang (state chart tersimpan dulu dipulihkan tanpa simbol). 14 Nov: di-hosting di Vercel, <https://aura-perps.vercel.app> (testnet; deploy manual dari `web/`, lihat `docs/DEPLOYMENT.md` §6). Lihat `web/README.md`. |
| Agent hedging + market GPU | - | Fase berikutnya. Jangan dikerjakan sebelum butir 1–6 di bawah selesai. |

### Deploy testnet saat ini

| Akun | Peran |
|---|---|
| `aura-perps.testnet` | Owner, LP pertama (dibuat lewat faucet, 10 NEAR) |
| `perps.aura-perps.testnet` | Kontrak perps |
| `tusd.aura-perps.testnet` | Token tes tUSD (`faucet` publik, maks 1000 tUSD per panggilan) |
| `oracle.` / `keeper.` / `agent.aura-perps.testnet` | Oracle (satu-satunya pemanggil `set_price`), keeper, agent |
| `trader1.aura-perps.testnet` | Akun uji untuk siklus penuh lewat UI (dibuat 14 Nov, 0,15 NEAR dari owner) |

Kunci semua akun ada di `~/.near-credentials/testnet/` pada laptop pemilik, tidak di repo. Faucet hanya memberi 10 NEAR, jadi script 01 dijalankan dengan `CONTRACT_NEAR='4 NEAR' ORACLE_NEAR='0.5 NEAR' KEEPER_NEAR='0.3 NEAR' AGENT_NEAR='0.3 NEAR' USDC_NEAR='2 NEAR'`.

Temuan gladi yang masih terbuka:

- **Harga basi bila layanan mati.** Oracle berjalan di VPS pemilik sejak 14 Nov (systemd, hidup lagi otomatis setelah crash atau reboot); jangan jalankan `npm start` di laptop bersamaan, karena kunci oracle hanya boleh dipakai satu proses. Harga basi 10 menit setelah proses itu berhenti dan belum ada pemantau luar yang memberi tahu; `./scripts/06-push-prices.sh` tetap bisa dipakai sebagai cadangan manual. Satu `set_price` menghabiskan sekitar 0,00026 NEAR: terukur ≈ 0,27 NEAR/hari untuk 3 market, sedangkan saldo akun oracle 2,23 NEAR per 14 Nov (cukup sekitar 8 hari).
- **Sumber harga oracle.** Dari jaringan laptop pemilik hanya Binance (mirror data publik), Gate, dan HTX yang terjangkau; Coinbase, Kraken, dan OKX diblokir ISP sehingga respons mereka belum bisa diverifikasi dan tidak dipakai. Ketiga sumber memakai pasangan USDT. Tambahkan venue USD di `services/src/oracle.ts` setelah dicek dari host.
- **Debu pembulatan funding.** Setelah semua posisi ditutup `get_vault.pending_funding` tersisa −1 sampai −2 micro-USD per posisi yang pernah ditutup atau dilikuidasi (−5 setelah empat posisi), sehingga NAV berada sejumlah itu di bawah aset. Invarian token tetap cocok. Logika akuntansi tidak diubah; putuskan apakah ini diterima.

## 3. Peta dokumen

| File | Isi |
|---|---|
| `docs/BLUEPRINT.md` | Arsitektur, komponen, tech stack, konfigurasi, fase |
| `docs/PRD.md` | Masalah, persona, tujuan, kebutuhan fungsional + kriteria penerimaan |
| `docs/MVP.md` | Batas MVP, definisi selesai, urutan potong |
| `docs/USERFLOW.md` | Alur tiap persona, siklus hidup posisi, penanganan error |
| `docs/API.md` | Semua method kontrak, view, event, error, dan HTTP API layanan |
| `docs/DATABASE.md` | State on-chain dan skema SQLite layanan |
| `docs/SECURITY.md` | Model ancaman, kontrol, kunci, runbook, keterbatasan |
| `docs/DESIGN_SYSTEM.md` | Cara menerapkan design system Aura ke layar aplikasi ini |
| `docs/FRONTEND_SPEC.md` | Halaman, komponen, state, teks UI, rumus tampilan |
| `docs/SERVICES_SPEC.md` | Oracle pusher, keeper, HTTP API: algoritma dan struktur kode |
| `docs/TEST_PLAN.md` | Tiga lapis pengujian dan daftar periksa |
| `docs/DEPLOYMENT.md` | Langkah deploy testnet dan mainnet, hosting, biaya |
| `docs/ROADMAP.md` | Jadwal sampai deadline, submission hackathon, fase lanjut |

## 4. Urutan kerja

1. **Build kontrak ke wasm.** (Selesai 12 Nov.) `cd contracts/perps && cargo near build non-reproducible-wasm`. Perbaiki error build bila ada tanpa mengubah perilaku; `cargo test` harus tetap 44 lulus.
2. **Gladi testnet.** (Selesai 12 Nov, lihat §2.) Jalankan `scripts/01..04` dengan `NETWORK=testnet`. Perbaiki script bila ada flag yang salah. Selesai jika `get_markets` menampilkan 3 market dan `get_vault` menampilkan setoran LP.
3. **Layanan: oracle pusher.** (Selesai 13 Nov: dipantau 30 menit dari laptop, 60 sampel, tidak ada harga basi, umur harga tertua 303 detik, tanpa error di log layanan.) Sesuai `docs/SERVICES_SPEC.md`. Selesai jika ketiga market `is_fresh: true` terus-menerus selama 30 menit di testnet.
4. **Layanan: keeper.** (Selesai 13 Nov, lihat §2.) Selesai jika posisi leverage tinggi yang sengaja dibuat dilikuidasi otomatis setelah harga digeser.
5. **Web app: Trade dan Vault.** (Selesai 14 Nov lewat wallet NEAR CLI, lihat §2.) Sesuai `docs/FRONTEND_SPEC.md` dan `docs/DESIGN_SYSTEM.md`. Selesai jika satu siklus penuh (aktivasi akun, deposit, buka, tutup, tarik, setor LP, tarik LP) berjalan lewat UI di testnet.
6. **HTTP API + SQLite** untuk riwayat harga dan `/health`. (`/health` sudah ada; SQLite dan riwayat belum.) Layanan sudah di-hosting sejak 14 Nov, lihat `docs/DEPLOYMENT.md` §6.
7. **Mainnet** (hanya oleh pemilik project, lihat aturan di bawah), lalu README final, video, submission. Keputusan 14 Nov: submission hackathon memakai testnet saja; mainnet menunggu perbaikan dua bug kontrak yang tercatat di README.
8. Fase berikutnya: market GPU-H100, agent hedging, halaman Agent.

## 5. Aturan yang tidak boleh dilanggar

- **Jangan deploy ke mainnet dan jangan menandatangani transaksi mainnet** tanpa konfirmasi eksplisit dari pemilik project. Siapkan perintahnya, biarkan manusia yang menjalankan.
- **Jangan pernah menulis kunci privat atau seed phrase** ke repo, log, atau output. Semua rahasia lewat `.env` (sudah di `.gitignore`).
- **Jangan mengubah logika akuntansi kontrak** (vault, PnL, funding, likuidasi) tanpa menambah unit test yang membuktikan invarian tetap benar: saldo pengguna + aset vault + insurance = token yang dipegang kontrak.
- Semua angka uang di kode adalah integer string (U128). **Jangan pakai float/Number untuk jumlah** di layanan maupun frontend; pakai `BigInt`. Float hanya untuk tampilan.
- Frontend tidak menyimpan rahasia dan tidak punya backend yang memegang dana. Semua aksi pengguna lewat wallet ke kontrak.
- Ikuti design system: selalu pakai token (CSS variable), jangan hex langsung; satu tombol primary per tampilan; status selalu dengan ikon + kata.
- Jujur di README: tulis apa yang benar-benar berjalan, trust assumption, dan keterbatasan.

## 6. Keputusan yang masih terbuka (tanyakan ke pemilik bila menghalangi)

| Keputusan | Default bila tidak ada jawaban |
|---|---|
| Bahasa UI: design system memakai Bahasa Indonesia ("kamu"), sedangkan juri hackathon internasional | Dua bahasa (`en` default, `id` lewat tombol), dengan aturan suara design system di keduanya |
| Nama akun mainnet (`perps.<akun>.near`) | Menunggu pemilik |
| Sumber indeks harga GPU | Ditunda ke fase berikutnya |
| Ambang dorong harga oracle (kelemahan latensi, lihat `docs/SECURITY.md`) | Dorong saat bergerak ≥ 10 bps, atau tiap 300 detik (diturunkan dari 30 pada 15 Nov setelah selisih ke bursa terukur 30–47 bps, lebih besar dari fee 10 bps) |

## 7. Perintah cepat

```bash
# Kontrak
cd contracts/perps && cargo test                      # harus: 44 passed
cargo near build non-reproducible-wasm                # butuh cargo-near + target wasm32-unknown-unknown

# Deploy testnet
export NETWORK=testnet OWNER=<akun>.testnet
./scripts/01-create-accounts.sh && ./scripts/02-deploy.sh && ./scripts/03-add-markets.sh
AMOUNT=500000000 ./scripts/04-seed-vault.sh
./scripts/06-push-prices.sh                            # testnet saja: satu harga per market, basi setelah 10 menit

# Layanan (butuh services/.env) dan web
cd services && npm i && npm test && npm start         # /health di http://localhost:8787/health
cd web && npm i && npm run dev
```
