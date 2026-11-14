'use client';

// Reference order book: Hyperliquid perp depth (lib/prices.ts). Aura is a pool, so no order rests here
// and nothing fills at these prices. The middle row is the on-chain oracle price, where every order fills.

import { useEffect, useState } from 'react';
import { num, price } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { fetchDepth, group, type Depth } from '../../lib/prices';
import { Skeleton, cx } from '../ui';
import { usePriceDir } from './MarketBar';

const POLL_MS = 2_000;
const ROWS = 16; // per side; a short panel clips the rows farthest from the middle
// The source already groups to these steps; `group` keeps rows on them if a price crosses a power of ten.
const BOOK: Record<string, { step: number; dp: number; sizeDp: number; base: string }> = {
  'BTC-USD': { step: 10, dp: 0, sizeDp: 3, base: 'BTC' },
  'ETH-USD': { step: 1, dp: 0, sizeDp: 2, base: 'ETH' },
  'NEAR-USD': { step: 0.001, dp: 3, sizeDp: 0, base: 'NEAR' },
};

export function OrderBook({ marketId, oraclePrice, hidden, asTab }: {
  marketId: string; oraclePrice?: string; hidden?: boolean; asTab?: boolean;
}) {
  const { t, locale } = useI18n();
  const dirOf = usePriceDir();
  const [depth, setDepth] = useState<{ marketId: string; data: Depth } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (hidden) return;
    let live = true;
    const load = () => {
      if (document.hidden) return;
      fetchDepth(marketId)
        .then((data) => live && (setDepth({ marketId, data }), setFailed(false)))
        .catch(() => live && setFailed(true));
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [marketId, hidden]);

  const cfg = BOOK[marketId];
  if (!cfg) return null;
  const data = depth?.marketId === marketId ? depth.data : null;
  const asks = data ? group(data.asks, cfg.step, 'ask', ROWS) : [];
  const bids = data ? group(data.bids, cfg.step, 'bid', ROWS) : [];
  const max = Math.max(asks.at(-1)?.total ?? 0, bids.at(-1)?.total ?? 0) || 1;
  const row = (r: (typeof asks)[number]) => (
    <li key={r.k} style={{ '--w': `${(r.total / max) * 100}%` } as React.CSSProperties}>
      <span>{num(r.price, locale, cfg.dp)}</span>
      <span>{num(r.size, locale, cfg.sizeDp)}</span>
      <span>{num(r.total, locale, cfg.sizeDp)}</span>
    </li>
  );
  const loading = !data && <li className="book__wait"><Skeleton width={120} /></li>;

  return (
    <div className="book" role={asTab ? 'tabpanel' : undefined} aria-label={asTab ? t('book.title') : undefined} hidden={hidden}>
      {/* A wide dock lays the sides next to each other (styles/app.css), so each side gets its own header. */}
      <div className="book__head" aria-hidden>
        <span><span className="book__any">{t('book.price')}</span><span className="book__bid">{t('book.bid')}</span></span>
        <span>{t('book.size', { base: cfg.base })}</span>
        <span>{t('book.total', { base: cfg.base })}</span>
      </div>
      <div className="book__head book__head--ask" aria-hidden>
        <span>{t('book.ask')}</span>
        <span>{t('book.size', { base: cfg.base })}</span>
        <span>{t('book.total', { base: cfg.base })}</span>
      </div>
      <ol className="book__side book__side--ask" aria-label={t('book.asks')}>{loading || [...asks].reverse().map(row)}</ol>
      <div className="book__mid">
        <span className={cx('num', dirOf(marketId))}>{oraclePrice && oraclePrice !== '0' ? price(oraclePrice, locale) : <Skeleton width={80} />}</span>
        <span className="muted">{t('book.oracle')}</span>
      </div>
      <ol className="book__side book__side--bid" aria-label={t('book.bids')}>{loading || bids.map(row)}</ol>
      <p className="book__note">{t(failed ? 'book.error' : 'book.note')}</p>
    </div>
  );
}
