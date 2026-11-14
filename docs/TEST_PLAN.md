# Rencana pengujian — Aura

Tiga lapis. Tidak ada yang naik ke mainnet sebelum lapis 1 dan 2 hijau.

## Lapis 1: unit test kontrak (sudah ada, 40 lulus)

```bash
cd contracts/perps && cargo test
```

| Area | Test |
|---|---|
| Matematika | `liquidation_price_matches_plan_example`, `short_liquidation_price`, `pnl_long_and_short`, `funding_direction`, `move_bps_works` |
| Deposit | `fake_token_is_rejected`, `unregistered_over_cap_and_paused_deposits_are_refunded`, `vault_cap_is_enforced` |
| Tarik | `withdraw_and_failed_transfer_restores_balance`, `successful_transfer_does_not_credit_twice`, `withdraw_requires_one_yocto`, `cannot_withdraw_locked_collateral` |
| Posisi | `liquidation_price_example_from_plan`, `healthy_position_cannot_be_liquidated`, `realised_pnl_long_and_short`, `fees_split_between_vault_and_insurance` |
| Vault | `lp_shares_track_trader_pnl`, `lp_withdraw_blocked_by_open_interest`, `lp_withdraw_and_failed_transfer_restores_shares`, `lp_actions_need_fresh_prices_when_there_is_open_interest` |
| Batas | `open_interest_cap`, `position_notional_cap`, `max_positions_per_account`, `leverage_cap` |
| Oracle | `stale_price_blocks_open`, `stale_price_blocks_close`, `price_jump_rejected`, `owner_can_force_price`, `only_oracle_sets_price`, `old_timestamp_rejected` |
| Funding | `funding_long_pays_when_skewed_long` |
| Bad debt | `bad_debt_is_covered_by_insurance_first` |
| Dua langkah | `two_step_open_and_close`, `cancel_order_refunds` |
| Admin | `admin_requires_one_yocto`, `admin_requires_owner`, `pause_blocks_open_but_not_close_or_withdraw`, `storage_unregister_only_when_empty` |
| Tiga market | `three_crypto_markets_with_large_prices` (BTC $100.000, ETH $3.500) |
| Skenario | `many_operations_keep_accounting_exact` |

Invarian `assert_solvent` (saldo pengguna + vault + insurance = token yang dipegang) dijalankan di akhir sebagian besar skenario.

**Yang belum tercakup unit test** (harus diuji di lapis 2): build wasm, serialisasi JSON argumen yang sebenarnya, gas tiap method, alur `ft_transfer_call` → `ft_on_transfer` → `ft_resolve_transfer` dengan kontrak token sungguhan, callback `on_withdraw` di jaringan, biaya storage nyata terhadap 0,02 NEAR.

## Lapis 2: gladi testnet

- [ ] `cargo near build non-reproducible-wasm` berhasil; catat ukuran wasm
- [ ] `scripts/01`–`04` berjalan dari nol (perbaiki flag CLI bila perlu, lalu commit)
- [ ] `get_config`, `get_markets` (3 market), `get_vault` benar
- [ ] Deposit lewat `ft_transfer_call` menambah `free`; deposit di atas batas direfund
- [ ] `withdraw` mengirim tUSD kembali; saldo konsisten
- [ ] Buka dan tutup posisi di tiap market; angka cocok dengan rumus
- [x] Oracle menjaga 3 market segar 30 menit (13 Nov, dari laptop)
- [x] Keeper melikuidasi posisi 10x setelah harga digeser (13 Nov, sekitar 20 detik)
- [ ] Setor LP, tarik LP; harga share berubah sesuai PnL trader
- [ ] `set_paused(true)`: buka ditolak, tutup dan tarik jalan
- [ ] Catat gas tiap method (target < 100 Tgas) dan pemakaian storage per akun (≤ 0,02 NEAR)
- [ ] Web: seluruh daftar di `docs/FRONTEND_SPEC.md` §9
- [ ] Rekonsiliasi: `ft_balance_of(perps)` = Σ `free + locked` semua akun uji + `assets` + `insurance`

## Lapis 3: smoke test mainnet (nominal kecil, oleh pemilik)

- [ ] `get_config` menunjukkan token USDC native dan batas guarded launch (200 / 20 / 50 USDC)
- [ ] Seed vault 50 USDC
- [ ] Deposit 2 USDC, buka long 1 USDC 2x di NEAR-USD, tutup, tarik
- [ ] Satu posisi 10x kecil dibiarkan sampai dilikuidasi keeper (dana yang memang dikorbankan untuk demo)
- [ ] Ikuti README dari awal di browser bersih, seperti juri
- [ ] Rekonsiliasi saldo USDC kontrak

## Uji layanan dan web

Lihat `docs/SERVICES_SPEC.md` §7 dan `docs/FRONTEND_SPEC.md` §9.

## Kasus tepi yang perlu dicoba manual

| Kasus | Yang diharapkan |
|---|---|
| Deposit tepat di batas `max_user_collateral` | Diterima; +1 unit → direfund |
| Collateral tepat `min_collateral` | Diterima |
| Leverage 1x | Diterima; harga likuidasi sangat jauh |
| Buka saat harga berumur 599 vs 601 detik | Diterima vs ditolak |
| Dua tab browser mengirim tutup posisi yang sama | Yang kedua gagal "Position not found"; UI menampilkan pesan wajar |
| Tarik LP 100% saat tidak ada posisi | Berhasil; `total_shares` 0 |
| Setor LP setelah vault kosong | Share kembali 1:1 |
| Wallet menolak transaksi | Form tetap terisi, tidak ada perubahan state |
| RPC utama mati | Web dan layanan pindah ke cadangan |
