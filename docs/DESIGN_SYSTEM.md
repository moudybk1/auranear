# Design system — penerapan ke aplikasi Aura

Sumber kebenaran ada di `design-system/` (salinan identik dari design system Aura milik pemilik project). File ini menjelaskan cara memakainya untuk layar perps. Bila ada pertentangan, `design-system/README.md` yang menang.

**Status 14 Nov 2026:** folder `design-system/` tidak ikut di repo ini, jadi §1 dan §2 menjelaskan kit aslinya, bukan file yang bisa dibuka di sini. Yang ada di repo:

| Di kit | Di repo ini |
|---|---|
| `tokens.css` | `web/styles/aura-tokens.css` |
| `components/bundle.css` | `web/styles/aura-components.css` |
| `components/bundle.js` (port ke TSX) | `web/components/ui.tsx` |
| `assets/logos/*.svg` | `web/components/Logo.tsx`, `web/app/icon.svg` |
| Font lewat `next/font/google` | Self-hosted di `web/app/fonts/`, dimuat dengan `next/font/local` di `web/app/layout.tsx` |
| Impor `../../design-system/...` di `globals.css` | `web/app/globals.css` mengimpor dari `../styles/` |

## 1. Isi `design-system/`

| File | Isi | Cara pakai |
|---|---|---|
| `README.md` | Prinsip, suara, warna, tipografi, spasi, radius, elevasi, logo, ikon | Baca seluruhnya sebelum menulis UI |
| `tokens.json` | Semua token (warna 2 tema, tipe, spasi, radius, shadow) | Sumber data |
| `tokens.css` | Token sebagai CSS variable (dibuat dari `tokens.json`) | Impor sekali di `web/app/globals.css` |
| `components/bundle.css` | Gaya Button, Badge, TextField, Card, Alert | Impor setelah `tokens.css` |
| `components/bundle.js` | Implementasi referensi (`window.Aura`, React 18 tanpa JSX) | **Port ke komponen TSX** di `web/components/ui/`, pertahankan nama class dan perilaku |
| `components/index.d.ts` | Tipe props | Pakai sebagai kontrak props |
| `components/README.md` | Aturan pakai tiap komponen | Ikuti |
| `assets/logos/*.svg` | 6 file logo | Salin ke `web/public/brand/` |
| `fonts/README.md` | Cara memuat font | `next/font/google` |

## 2. Pemasangan di Next.js

```tsx
// web/app/layout.tsx
import { Funnel_Display, Funnel_Sans, Fragment_Mono } from 'next/font/google';
const display = Funnel_Display({ subsets: ['latin'], weight: ['500','600','700','800'], variable: '--font-display-face' });
const sans = Funnel_Sans({ subsets: ['latin'], weight: ['400','500','600','700'], style: ['normal','italic'], variable: '--font-sans-face' });
const mono = Fragment_Mono({ subsets: ['latin'], weight: '400', variable: '--font-mono-face' });
// <html lang={locale} data-theme={theme} className={`${display.variable} ${sans.variable} ${mono.variable}`}>
```

```css
/* web/app/globals.css */
@import '../../design-system/tokens.css';
@import '../../design-system/components/bundle.css';
:root {
  --font-display: var(--font-display-face), "Funnel Sans", system-ui, sans-serif;
  --font-sans: var(--font-sans-face), system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: var(--font-mono-face), ui-monospace, "SFMono-Regular", Menlo, monospace;
}
```

- Tema: atribut `data-theme="light" | "dark"` di `<html>`. Default terang; ikuti `prefers-color-scheme` pada kunjungan pertama; simpan pilihan di `localStorage` (`aura.theme`).
- Jangan pakai hex langsung di komponen. Bila memakai Tailwind, petakan warna ke `var(--token)`; jangan memakai palet bawaan Tailwind.
- Ikon: `lucide-react`, `strokeWidth={1.75}`, ukuran 16–20px.

## 3. Aturan brand yang paling sering dilanggar di aplikasi trading

| Aturan design system | Konsekuensi untuk layar perps |
|---|---|
| Satu tombol primary per tampilan | Di Trade: hanya tombol kirim order ("Open long"/"Open short"). "Connect wallet" menjadi primary hanya saat belum terhubung. Deposit, withdraw, close = `secondary` |
| Merah = brand, bukan "rugi" atau "bahaya" | **Jangan mewarnai PnL negatif atau Short dengan merah `aura`.** Lihat §4 |
| Status tidak hanya lewat warna | PnL selalu bertanda `+`/`−` dan ikon panah; Long/Short selalu berlabel kata |
| Tombol destruktif pakai `danger` | "Close position" di dialog konfirmasi = `danger` (berbingkai), bukan primary |
| Satu `glow` per halaman | Trade: kartu form order. Vault: kartu "Your position". Tidak ada glow lain |
| Tidak ada emoji, satu tanda seru maksimal | Berlaku untuk semua teks UI dan toast |
| Angka rata kolom pakai mono | Harga, jumlah, PnL, alamat, hash → `font-mono` 13px + `font-variant-numeric: tabular-nums` |
| Funnel Display hanya ≥ 28px | Judul halaman dan angka besar (NAV, harga utama); sisanya Funnel Sans |

## 4. Warna semantik trading

Design system tidak punya hijau; `success` sengaja teal, dan merah dicadangkan untuk brand. Pemetaan untuk aplikasi ini:

| Makna | Token | Penanda non-warna (wajib) |
|---|---|---|
| Long / naik / PnL positif | `success` di atas `success-soft` | Kata "Long", tanda `+`, ikon `trending-up` / `arrow-up-right` |
| Short / turun / PnL negatif | `ink` (teks) dengan Badge `neutral` | Kata "Short", tanda `−`, ikon `trending-down` / `arrow-down-right` |
| Mendekati likuidasi | `warning` + `warning-soft` | Badge "At risk" dengan `dot` |
| Harga basi, pause | `warning` | Alert/Badge dengan ikon + kata |
| Error transaksi | `danger` (= `aura-text`) | Alert `danger` dengan ikon ✕ + judul |
| Info (order menunggu, memproses) | `info` | Alert/Badge `info` |
| Aksi utama, item aktif, tab terpilih | `aura` / `aura-soft` / `aura-text` | - |

Alasan: bila PnL negatif diwarnai merah brand, pengguna tidak bisa membedakan "ini tombol utama" dari "ini kerugian", dan aturan "error dikenali dari ikon dan teks, bukan merahnya" dilanggar. Ini penafsiran saya atas design system; pemilik project boleh menggantinya dengan token baru (misalnya `loss`) di design system.

## 5. Pemetaan komponen

| Elemen aplikasi | Komponen / gaya |
|---|---|
| Tombol kirim order | `Button primary lg`, `loading` saat menunggu wallet |
| Deposit, Withdraw, Close, Max | `Button secondary` (`sm` di tabel) |
| Cancel, Dismiss | `Button ghost` |
| Konfirmasi tutup posisi | `Button danger` |
| Input jumlah | `TextField mono` dengan `label`, `hint` (saldo tersedia), `error` |
| Kartu form order, kartu posisi LP | `Card glow` (satu per halaman) |
| Kartu statistik (NAV, OI, harga) | `Card` biasa; angka `heading-2`, label `overline` |
| Arah posisi, status market | `Badge` (`success` + dot untuk Long, `neutral` untuk Short, `warning` untuk basi/at risk, `aura` untuk market terpilih) |
| Pesan sistem (pause, harga basi, refund, error, sukses) | `Alert` dengan `title` (apa yang terjadi) + isi (apa yang harus dilakukan) |
| Banner prototipe | `Alert warning` ringkas di bawah header, selalu terlihat |

Komponen yang belum ada di design system dan perlu dibuat mengikuti token yang sama: `Tabs` (pemilih market dan Long/Short), `Slider` (leverage), `Table` (posisi), `Dialog` (konfirmasi, deposit, withdraw), `Toast`, `Skeleton`, `ThemeToggle`, `LocaleToggle`. Spesifikasinya di `docs/FRONTEND_SPEC.md` §6.

## 6. Layout

- Lebar konten maksimum 1200px; grid 12 kolom desktop, 4 kolom mobile; gutter `space-5`; jarak antar section `space-7`.
- Header: tinggi 64px, `surface-raised`, garis bawah `line`. Kiri: `aura-logo.svg` (tema gelap: `aura-logo-reversed.svg`), tinggi mark 24px. Tengah: navigasi (Trade, Vault). Kanan: tema, bahasa, tombol wallet.
- Mobile (< 768px): logo menjadi `aura-mark.svg`; navigasi menjadi tab bawah; tabel posisi menjadi daftar kartu.
- Favicon dan ikon aplikasi: `aura-app-icon.svg`.
- Tidak ada hero `garnet` di halaman aplikasi; `garnet` hanya untuk footer atau halaman landing bila dibuat.

## 7. Suara dan bahasa

Design system menetapkan Bahasa Indonesia ("kamu"/"kami"). Karena juri hackathon internasional, aplikasi memakai dua bahasa dengan aturan suara yang sama: `en` (default) dan `id` (lewat tombol). Ini keputusan terbuka di `AGENTS.md`.

- Kapital hanya di awal label: "Open long", "Connect wallet", "Hubungkan wallet".
- Tombol diawali kata kerja. Tidak ada "OK" atau "Submit".
- Error = apa yang salah + cara memperbaiki.
- Format angka: `en` → `$1,234.56`, `4.2%`; `id` → `US$ 1.234,56`, `4,2%`. Mata uang aplikasi ini USDC, jadi contoh `Rp` di design system tidak dipakai.
- Daftar teks lengkap dua bahasa ada di `docs/FRONTEND_SPEC.md` §8.

## 8. Aksesibilitas

- Ring fokus 2px `focus` + offset 2px di semua elemen interaktif (sudah ada di `bundle.css` untuk Button dan TextField; terapkan ke komponen baru).
- Kontras AA sudah dijamin oleh pasangan token; jangan membuat pasangan baru (misalnya `ink-muted` di atas `aura-soft`) tanpa mengecek.
- `Alert` `danger`/`warning` memakai `role="alert"`; perubahan PnL tidak diumumkan terus-menerus (`aria-live="off"` di tabel).
- Hormati `prefers-reduced-motion`; transisi 150ms ease.
- Target sentuh minimal 40px di mobile (`Button md`/`lg`).
