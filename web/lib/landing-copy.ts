// Copy for the landing page (app/page.tsx). Like lib/i18n.tsx it keeps an Indonesian set beside the English
// one; the app shows English only since the language button was removed (15 Nov).
// Every figure here comes from the contract parameters and the README: change them there first.
// The order ticket on the page reuses the app's own strings from lib/i18n.tsx.

import type { Locale } from './format.ts';

const en = {
  nav: { label: 'Sections', markets: 'Markets', how: 'How it works', launch: 'Launch app' },

  hero: {
    title: 'Long or short, on NEAR.',
    sub: 'Deposit USDC and trade BTC, ETH and NEAR with up to 10x leverage. One liquidity vault takes the other side of every trade, inside a single 281 KB contract.',
    launch: 'Launch app',
    source: 'Read the contract',
    note: 'Live on NEAR testnet with test tokens.',
  },

  ticket: {
    label: 'Order preview',
    market: 'Market',
    open: 'Open {market} on testnet',
    liq: 'Estimated liquidation price',
    away: '{pct} from the oracle price',
    oracle: 'Oracle price',
    falls: 'Price falls',
    rises: 'Price rises',
    caption: 'The preview runs the contract’s own integer math on the price the oracle last pushed.',
    waiting: 'Waiting for the oracle price',
  },

  markets: {
    titleSoft: 'Three markets, live',
    title: 'from the contract.',
    market: 'Market',
    price: 'Oracle price',
    change: '24h change',
    leverage: 'Max leverage',
    update: 'Oracle update',
    ago: '{age} ago',
    stale: 'Stale',
    trade: 'Trade {market}',
    note: 'Every order fills at once at the oracle price: the median of Binance, Gate and HTX. The fee is 0.1% per side.',
  },

  shot: {
    title: 'The whole trade on one screen.',
    body: 'Chart, reference order book, order form and open positions sit flush in one terminal. Every order fills at the oracle price, with the vault on the other side.',
    alt: 'The Aura trading terminal on the {market} market: price chart, order book, order form and positions.',
    caption: 'The Aura terminal on NEAR testnet, 15 November 2026.',
  },

  how: {
    title: 'How a trade works.',
    vault: 'See the vault',
    steps: [
      { title: 'Deposit USDC', body: 'It moves from your wallet to your trading balance in the contract.' },
      { title: 'Go long or short', body: 'Up to 10x leverage on BTC, ETH and NEAR. Orders fill at once at the oracle price, for a 0.1% fee.' },
      { title: 'The vault takes the other side', body: 'Liquidity providers fund one vault. It pays what traders win and keeps what they lose.' },
      { title: 'Close and withdraw', body: 'Closing pays out your equity, less the 0.1% fee. A position is liquidated if its equity falls to 5% of its size.' },
    ],
  },

  cta: {
    lead: 'Start with',
    market: 'Market',
    go: 'Open the app',
    note: 'Opens the terminal on NEAR testnet. Prices and markets load without a wallet.',
  },

  footer: {
    what: 'Perpetual futures on NEAR',
    source: 'Source code',
    contract: 'Contract',
    trade: 'Trade',
    vault: 'Vault',
    licence: 'MIT licence',
  },
};

const id: typeof en = {
  nav: { label: 'Bagian', markets: 'Market', how: 'Cara kerja', launch: 'Buka aplikasi' },

  hero: {
    title: 'Long atau short, di NEAR.',
    sub: 'Setor USDC lalu trading BTC, ETH, dan NEAR dengan leverage sampai 10x. Satu vault likuiditas menjadi lawan setiap posisi, di dalam satu kontrak berukuran 281 KB.',
    launch: 'Buka aplikasi',
    source: 'Baca kontraknya',
    note: 'Berjalan di NEAR testnet dengan token tes.',
  },

  ticket: {
    label: 'Pratinjau order',
    market: 'Market',
    open: 'Buka {market} di testnet',
    liq: 'Perkiraan harga likuidasi',
    away: '{pct} dari harga oracle',
    oracle: 'Harga oracle',
    falls: 'Harga turun',
    rises: 'Harga naik',
    caption: 'Pratinjau ini memakai hitungan bilangan bulat milik kontrak, pada harga terakhir yang dikirim oracle.',
    waiting: 'Menunggu harga oracle',
  },

  markets: {
    titleSoft: 'Tiga market aktif,',
    title: 'dari kontrak.',
    market: 'Market',
    price: 'Harga oracle',
    change: 'Perubahan 24 jam',
    leverage: 'Leverage maks.',
    update: 'Pembaruan oracle',
    ago: '{age} lalu',
    stale: 'Basi',
    trade: 'Trading {market}',
    note: 'Setiap order langsung terisi di harga oracle: median Binance, Gate, dan HTX. Biayanya 0,1% per sisi.',
  },

  shot: {
    title: 'Seluruh trade dalam satu layar.',
    body: 'Chart, order book acuan, form order, dan posisi terbuka menyatu dalam satu terminal. Setiap order terisi di harga oracle, dengan vault sebagai lawannya.',
    alt: 'Terminal trading Aura di market {market}: chart harga, order book, form order, dan posisi.',
    caption: 'Terminal Aura di NEAR testnet, 15 November 2026.',
  },

  how: {
    title: 'Cara kerja sebuah trade.',
    vault: 'Lihat vault',
    steps: [
      { title: 'Setor USDC', body: 'USDC berpindah dari wallet kamu ke saldo trading di kontrak.' },
      { title: 'Buka long atau short', body: 'Leverage sampai 10x di BTC, ETH, dan NEAR. Order langsung terisi di harga oracle, dengan biaya 0,1%.' },
      { title: 'Vault menjadi lawannya', body: 'Penyedia likuiditas mengisi satu vault. Vault membayar keuntungan trader dan menerima kerugiannya.' },
      { title: 'Tutup dan tarik', body: 'Menutup posisi membayar ekuitas kamu, dikurangi biaya 0,1%. Posisi dilikuidasi bila ekuitasnya turun ke 5% dari ukurannya.' },
    ],
  },

  cta: {
    lead: 'Mulai dari',
    market: 'Market',
    go: 'Buka aplikasi',
    note: 'Membuka terminal di NEAR testnet. Harga dan market tampil tanpa wallet.',
  },

  footer: {
    what: 'Perpetual futures di NEAR',
    source: 'Kode sumber',
    contract: 'Kontrak',
    trade: 'Trade',
    vault: 'Vault',
    licence: 'Lisensi MIT',
  },
};

export const LANDING: Record<Locale, typeof en> = { en, id };

/** Fills `{name}` placeholders, like `t()` in lib/i18n.tsx. */
export const fill = (text: string, vars: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
