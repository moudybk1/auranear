# Deployment — Aura

Script `01`–`04` sudah dijalankan di testnet pada 12 Nov 2026 (near-cli-rs 0.30.1, cargo-near 0.23.0, macOS); `05` belum. Bila ada flag near-cli-rs yang berbeda di versimu, perbaiki script lalu commit. Semua langkah mainnet dijalankan oleh pemilik project sendiri.

## 1. Prasyarat (Linux)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.sh | sh
# Node.js 20+ untuk services dan web
```

Impor akun utama ke keychain: `near account import-account` (pilih jaringan, simpan ke legacy keychain).

## 2. Akun

| Akun | Peran | Kunci |
|---|---|---|
| `<owner>` | Akun utama: owner kontrak, LP pertama | Full-access, hanya di wallet/laptop pemilik |
| `perps.<owner>` | Kontrak perps | Dihapus setelah deploy final |
| `oracle.<owner>` | Satu-satunya pemanggil `set_price` | Di hosting layanan |
| `keeper.<owner>` | `liquidate` | Di hosting layanan |
| `agent.<owner>` | Agent hedging (fase berikutnya) | Function-call key di hosting |
| `tusd.<owner>` (testnet saja) | Token tes | - |

## 3. Testnet

```bash
export NETWORK=testnet OWNER=<akun>.testnet
cd contracts/perps && cargo test                 # 44 passed
cd ../.. 
./scripts/01-create-accounts.sh                  # sub-account + tusd
./scripts/02-deploy.sh                           # build wasm, deploy tUSD + perps, init, storage, faucet 1000 tUSD ke owner
./scripts/03-add-markets.sh                      # BTC-USD, ETH-USD, NEAR-USD
AMOUNT=500000000 ./scripts/04-seed-vault.sh      # 500 tUSD ke vault
```

Lalu jalankan layanan (`services/.env` dengan kunci oracle dan keeper dari `~/.near-credentials/testnet/`) dan web (`web/.env`).

## 4. Mainnet

Sebelum mulai: lapis 1 dan 2 di `docs/TEST_PLAN.md` hijau; akun utama punya sekitar 15 NEAR dan 50–100 USDC native.

```bash
export NETWORK=mainnet OWNER=<akun>.near
./scripts/01-create-accounts.sh                  # tiap langkah minta ketik 'yes'
./scripts/02-deploy.sh                           # collateral = USDC native; batas 200 / 20 / 50 USDC
./scripts/03-add-markets.sh
AMOUNT=50000000 ./scripts/04-seed-vault.sh       # 50 USDC
```

Setelah smoke test (lapis 3) lolos dan tidak ada rencana deploy ulang, hapus kunci akun kontrak:

```bash
near account list-keys perps.$OWNER network-config mainnet now
near account delete-keys perps.$OWNER public-keys <PUBLIC_KEY> network-config mainnet sign-with-legacy-keychain send
```

Setelah ini kode tidak bisa diganti. Jangan lakukan sebelum yakin. Sintaks `delete-keys` di atas belum diuji; periksa dengan `near account delete-keys --help`.

## 5. Parameter deploy

`new` menerima `owner`, `oracle`, `collateral_token`, `limits`. Nilai bawaan ada di `scripts/config.sh` (bisa ditimpa lewat env: `VAULT_CAP`, `MAX_USER_COLLATERAL`, `MAX_POSITION_NOTIONAL`, `USDC`, `CONTRACT`, `ORACLE`, `KEEPER`, `AGENT`). Parameter market di `scripts/03-add-markets.sh`.

## 6. Hosting

| Bagian | Tempat | Catatan |
|---|---|---|
| Web | Vercel | Root `web/` (tidak mengimpor apa pun dari luar folder itu; token ada di `web/styles/`); env Production: `NEXT_PUBLIC_NETWORK`, `NEXT_PUBLIC_CONTRACT_ID`, `NEXT_PUBLIC_USDC_ID`. Semua halaman statis. Hidup sejak 14 Nov di <https://aura-perps.vercel.app> (project `aura-perps`, testnet). Belum terhubung ke Git: deploy ulang dengan `vercel deploy --prod` dari `web/`. |
| Layanan | VPS milik pemilik (Ubuntu 24.04) | Hidup sejak 14 Nov. Kode di `/opt/aura` (clone repo ini), dijalankan unit systemd `aura-services` dengan Node 22.23 di `/opt/node22`. Variabel dari `/opt/aura/services/.env` (izin 600, hanya root). Tanpa volume (belum ada SQLite). |
| Pemantauan | Cek `/health` tiap 5 menit (uptime monitor gratis) | Hidup minimal sampai 18 Nov, idealnya 25 Nov. **Belum terpasang:** port 8787 tidak dibuka di firewall VPS, jadi `/health` baru bisa dicek dari dalam server. |

Unit `/etc/systemd/system/aura-services.service` di VPS (tidak ada di repo). systemd membaca `.env` sebagai root; prosesnya sendiri berjalan sebagai pengguna sementara tanpa hak istimewa:

```ini
[Unit]
Description=Aura oracle pusher and keeper (testnet)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/aura/services
EnvironmentFile=/opt/aura/services/.env
ExecStart=/opt/node22/bin/node src/index.ts
DynamicUser=yes
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Perintah harian di VPS:

| Tujuan | Perintah |
|---|---|
| Status | `curl -s localhost:8787/health` |
| Log | `journalctl -u aura-services -f` |
| Deploy ulang | `cd /opt/aura && git pull && systemctl restart aura-services` (tambah `npm ci --omit=dev` di `services/` bila dependensi berubah) |

Hanya satu proses boleh memakai kunci oracle pada satu waktu: jangan jalankan `npm start` di laptop selama layanan di VPS hidup. Akun oracle menghabiskan sekitar 0,27 NEAR per hari di testnet; isi ulang sebelum saldonya di bawah 0,2 NEAR (`/health` melaporkan `balance_near`).

## 7. Perkiraan biaya NEAR (diukur ulang di testnet)

| Pos | Perkiraan | Catatan |
|---|---|---|
| Storage kode kontrak | 2,83 NEAR terkunci (terukur) | 1 NEAR per 100 KB; wasm perps 281 KB, storage akun 282,9 KB setelah 3 market. Token tes: 149 KB = 1,49 NEAR |
| State kontrak | 1–2 NEAR | Akun, posisi, market |
| 4 sub-account | 9 NEAR dialokasikan script (7 + 1 + 0,5 + 0,5) | Sebagian besar di akun kontrak untuk storage |
| Gas oracle + keeper sampai 25 Nov | `set_price` ≈ 0,00026 NEAR per dorong (terukur di testnet, 3 dorong) | × jumlah dorong/hari × 3 market. Keeper belum diukur |
| Cadangan | 3–5 NEAR | Deploy ulang, salah transaksi |

Biaya mainnet tidak diganti panitia hackathon.

## 8. Verifikasi setelah deploy

```bash
near contract call-function as-read-only perps.$OWNER get_config json-args '{}' network-config $NETWORK now
near contract call-function as-read-only perps.$OWNER get_markets json-args '{}' network-config $NETWORK now
near contract call-function as-read-only perps.$OWNER get_vault json-args '{}' network-config $NETWORK now
```

## 9. Rollback

- Sebelum kunci kontrak dihapus: `set_paused(true)`, perbaiki, deploy ulang ke akun yang sama (state lama tetap; bila struktur state berubah, deploy ke akun baru).
- Setelah kunci dihapus: pause permanen, pengguna menutup posisi dan menarik dana, deploy kontrak baru di akun baru, perbarui env web dan layanan.
