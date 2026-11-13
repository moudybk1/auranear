# Roadmap dan rencana eksekusi — Aura

## 1. Deadline hackathon

| Hal | Nilai |
|---|---|
| Batas submit | 14 Nov 2026 23:59 UTC = **Sabtu 15 Nov 06:59 WIB** |
| Penjurian | 16–18 Nov 2026 |
| Track | Unstoppable DeFi (utama), Agent Economy (bila agent hedging sempat masuk) |
| Syarat | Repo publik + LICENSE; README yang bisa direproduksi; post X dengan video, @NEARProtocol, #NEARHackathon; form submission; akun mainnet untuk hadiah |
| Catatan | Testnet saja diperbolehkan; demo lokal diterima asal ada video; demo di-hosting adalah nilai tambah dan sebaiknya hidup sampai 25 Nov |

Sumber: nearhackathon.com dan HACKATHON.md di situs yang sama (dibaca 12 Nov 2026).

## 2. Jadwal (WIB)

Jadwal awal sudah mundur: per Kamis 19:30 gladi testnet belum dimulai. Jadwal di bawah adalah versi yang disesuaikan.

| Waktu | Target | Selesai jika |
|---|---|---|
| Kam malam | Build wasm; `scripts/01–04` di testnet | 3 market terdaftar, vault terisi |
| Kam malam – Jum pagi | Layanan: oracle + keeper | Harga segar 30 menit; likuidasi uji berhasil |
| Jum pagi – sore | Web: Trade + panel akun, lalu Vault | Siklus penuh lewat UI di testnet |
| Jum sore | Deploy mainnet (pemilik), seed vault, smoke test | Buka/tutup 1 USDC berhasil |
| Jum malam | Hosting web + layanan; README final | `/health` sehat; README bisa diikuti |
| Jum malam | Video 2–3 menit; post X | Tautan siap |
| Sab 00:00–03:00 | Submit form; cek semua tautan dari browser tanpa login | Tersubmit |
| Sab 03:00–06:59 | Cadangan | - |

Urutan potong bila terlambat: lihat `docs/MVP.md` §4. Bila mainnet tidak sempat aman, submit versi testnet (diperbolehkan) dan tulis jujur di README.

## 3. Daftar periksa submission

- [ ] Repo publik; LICENSE; semua commit setelah 1 Nov
- [ ] README: produk dan masalah, tautan demo/video/post, "coba dalam 2 menit", cara jalan lokal, arsitektur, trust assumption, keterbatasan, pengungkapan library dan bantuan AI
- [ ] Demo di-hosting dan dijaga
- [ ] Post X: "built at NEAR HACKATHON", @NEARProtocol, #NEARHackathon, video
- [ ] Form: nama project (Aura), team lead, email, ukuran tim, track, akun NEAR mainnet, tautan repo, tautan post, deskripsi 20–2.000 karakter

## 4. Naskah video (2–3 menit)

1. 0:00–0:20 — Masalah: perps di NEAR bergantung pada venue luar; agent butuh mesin sederhana yang bisa dipanggil dengan kunci terbatas.
2. 0:20–0:40 — Aura: satu kontrak, vault LP, tiga market, oracle dengan pengaman.
3. 0:40–1:20 — LP menyetor; trader membuka long BTC; ringkasan menampilkan harga likuidasi.
4. 1:20–1:50 — Harga bergerak; keeper melikuidasi posisi 10x; transaksi di explorer.
5. 1:50–2:20 — Tutup posisi, tarik USDC, harga share vault berubah.
6. 2:20–2:50 — Pengaman (batas, pause, cek harga basi), keterbatasan yang diakui, dan langkah berikutnya: market harga sewa GPU untuk hedging biaya compute agent.

## 5. Setelah submit (sampai 25 Nov)

- Pemantauan harian (`docs/SECURITY.md` §6).
- Hanya perbaikan bug kecil; tidak mengubah kontrak mainnet.

## 6. Fase berikutnya

| Urutan | Item | Catatan |
|---|---|---|
| 1 | Market GPU-H100 | Kontrak sudah mendukung (`two_step`); butuh sumber indeks $/GPU-jam yang jelas metodenya, `GPU=1 ./scripts/03-add-markets.sh`, UI order menunggu |
| 2 | Agent hedging + halaman Agent | `scripts/05-fund-agent.sh`, `services/src/agent`, grafik biaya dengan vs tanpa hedge |
| 3 | Perbaikan kelemahan latensi harga | Ambang dorong lebih kecil, spread dinamis, atau dua langkah untuk semua market |
| 4 | Batas OI global lintas market | Tiga market crypto berkorelasi |
| 5 | Oracle di TEE / banyak pelapor | Menghapus satu titik gagal |
| 6 | Multisig + timelock untuk owner | Mengurangi trust assumption |
| 7 | Deposit lintas chain via NEAR Intents | Hanya ada di mainnet |
| 8 | Tutup sebagian, tambah margin, TP/SL | Fitur trader |
| 9 | Audit, lalu batas dinaikkan bertahap | Sebelum dana besar |
| 10 | Listing market tanpa izin, orderbook | Jangka panjang |

## 7. Keputusan yang sudah diambil

| Tanggal | Keputusan |
|---|---|
| 12 Nov | Model pool + oracle, bukan orderbook |
| 12 Nov | Target mainnet dengan guarded launch; collateral USDC native dengan batas 200 / 20 / 50 USDC |
| 12 Nov | Tahap awal 3 market: BTC-USD, ETH-USD, NEAR-USD; GPU-H100 dan agent pindah ke fase berikutnya |
| 12 Nov | Batas OI 30% NAV per sisi per market (turun dari 40% karena tiga market berkorelasi) |
| 12 Nov | Nama project: Aura; design system Aura dipakai untuk web |
