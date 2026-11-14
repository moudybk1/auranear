'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { age, price, signedPct, usd } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useAura } from '../../lib/store';
import { Badge, Delta, Skeleton, cx, useNow } from '../ui';

export const MARKET_IDS = ['BTC-USD', 'ETH-USD', 'NEAR-USD'];
export const NAMES: Record<string, string> = { 'BTC-USD': 'Bitcoin', 'ETH-USD': 'Ethereum', 'NEAR-USD': 'NEAR Protocol' };

/** Colour for a market's price: the direction of its last oracle move, else its 24h change until a move is seen. */
export function usePriceDir() {
  const { priceDir, tickers } = useAura();
  return (id: string) => {
    const change = tickers[id]?.changePct ?? 0;
    return priceDir[id] ?? (change > 0 ? 'up' : change < 0 ? 'down' : undefined);
  };
}

/** Market dropdown: a listbox with the oracle price and 24h change per market. Arrows move, Enter picks, Esc closes. */
export function MarketPicker({ ids, marketId, onSelect }: { ids: string[]; marketId: string; onSelect: (id: string) => void }) {
  const { t, locale } = useI18n();
  const { markets, tickers } = useAura();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const priceOf = (id: string) => {
    const m = markets.find((x) => x.id === id);
    return m && m.price !== '0' ? price(m.price, locale) : null;
  };

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus();
    const onPointer = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!open) {
      if (step) (e.preventDefault(), setOpen(true));
      return;
    }
    if (e.key === 'Escape') return close();
    if (e.key === 'Tab') return setOpen(false);
    if (!step) return;
    e.preventDefault();
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    items[(items.indexOf(document.activeElement as HTMLElement) + step + items.length) % items.length]?.focus();
  };

  return (
    <div className="mpick" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={trigger} type="button" className="mpick__face" aria-haspopup="listbox" aria-expanded={open}
        aria-label={`${t('markets.label')}: ${marketId}`} onClick={() => setOpen(!open)}
      >
        <span className="mpick__sym">{marketId}</span>
        <span className="mpick__px num">{priceOf(marketId) ?? <Skeleton width={56} />}</span>
        <ChevronDown className="mpick__chev" size={16} strokeWidth={2} aria-hidden />
      </button>
      {open && (
        <div className="mpick__panel">
          <div className="mpick__head" aria-hidden>
            <span>{t('markets.label')}</span>
            <span>{t('col.price')}</span>
            <span>{t('stat.change')}</span>
          </div>
          <div role="listbox" aria-label={t('markets.label')}>
            {ids.map((id) => {
              const ticker = tickers[id];
              return (
                <button
                  key={id} type="button" role="option" aria-selected={id === marketId} className="mpick__opt"
                  onClick={() => (onSelect(id), close())}
                >
                  <span className="mpick__name"><b>{id}</b><small>{NAMES[id] ?? ''}</small></span>
                  <span className="num">{priceOf(id) ?? '–'}</span>
                  {/* Neutral in the list, at the owner's request: the arrow and sign carry the direction. */}
                  <span className="num">{ticker ? <Delta sign={ticker.changePct}>{signedPct(ticker.changePct, locale)}</Delta> : '–'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Signed funding rate in percent per hour (the view reports bps/hour × 1e6). */
export const fundingPct = (x1e6: string) => Number(x1e6) / 1e8;

export function MarketBar({ marketId, onSelect }: { marketId: string; onSelect: (id: string) => void }) {
  const { t, locale } = useI18n();
  const { markets, tickers } = useAura();
  const dirOf = usePriceDir();
  const now = useNow();
  const market = markets.find((m) => m.id === marketId);
  const ticker = tickers[marketId];
  const ids = markets.length ? markets.map((m) => m.id) : MARKET_IDS;
  const funding = market ? fundingPct(market.funding_rate_bps_per_hour_x1e6) : 0;
  const hasPrice = market && market.price !== '0';

  return (
    <section className="panel mbar">
      <MarketPicker ids={ids} marketId={marketId} onSelect={onSelect} />
      <dl className="stats">
        <div className="stat stat--price">
          {/* No visible label, at the owner's request: the big number is the price. Screen readers still hear it. */}
          <dt className="sr-only">{t('stat.price')}</dt>
          <dd className={cx('num', dirOf(marketId))}>{hasPrice ? price(market.price, locale) : <Skeleton width={96} />}</dd>
        </div>
        {ticker && (
          <>
            <div className="stat">
              <dt>{t('stat.change')}</dt>
              <dd><Delta sign={ticker.changePct}>{signedPct(ticker.changePct, locale)}</Delta></dd>
            </div>
            <div className="stat stat--minor">
              <dt>{t('stat.high')}</dt>
              <dd className="num">{price(ticker.high, locale)}</dd>
            </div>
            <div className="stat stat--minor">
              <dt>{t('stat.low')}</dt>
              <dd className="num">{price(ticker.low, locale)}</dd>
            </div>
          </>
        )}
        <div className="stat">
          <dt>{t('stat.funding')}</dt>
          <dd>
            {market ? (
              <>
                <span className="num">{signedPct(funding, locale, 4)}</span>
                <span className="stat__note">
                  {t(funding > 0 ? 'funding.longPays' : funding < 0 ? 'funding.shortPays' : 'funding.flat')}
                </span>
              </>
            ) : <Skeleton />}
          </dd>
        </div>
        <div className="stat">
          <dt>{t('stat.oiLong')}</dt>
          <dd className="num">{market ? usd(market.long_notional, locale, 0) : <Skeleton />}</dd>
        </div>
        <div className="stat">
          <dt>{t('stat.oiShort')}</dt>
          <dd className="num">{market ? usd(market.short_notional, locale, 0) : <Skeleton />}</dd>
        </div>
        <div className="stat">
          <dt>{t('stat.updated')}</dt>
          <dd>
            {!hasPrice ? (
              <span className="muted">{t('price.waiting')}</span>
            ) : market.is_fresh ? (
              <>
                <span className="dot is-live" aria-hidden />
                <span className="num">{t('price.ago', { age: age(now - Number(market.price_ts_sec)) })}</span>
              </>
            ) : (
              <>
                <Badge tone="warning" dot>{t('price.stale')}</Badge>
                <span className="num muted">{t('price.ago', { age: age(now - Number(market.price_ts_sec)) })}</span>
              </>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
