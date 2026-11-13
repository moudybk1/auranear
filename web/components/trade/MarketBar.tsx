'use client';

import { age, price, signedPct, usd } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useAura } from '../../lib/store';
import { Badge, Delta, Segmented, Skeleton, useNow } from '../ui';

export const MARKET_IDS = ['BTC-USD', 'ETH-USD', 'NEAR-USD'];

/** Signed funding rate in percent per hour (the view reports bps/hour × 1e6). */
export const fundingPct = (x1e6: string) => Number(x1e6) / 1e8;

export function MarketBar({ marketId, onSelect }: { marketId: string; onSelect: (id: string) => void }) {
  const { t, locale } = useI18n();
  const { markets, tickers } = useAura();
  const now = useNow();
  const market = markets.find((m) => m.id === marketId);
  const ticker = tickers[marketId];
  const ids = markets.length ? markets.map((m) => m.id) : MARKET_IDS;
  const funding = market ? fundingPct(market.funding_rate_bps_per_hour_x1e6) : 0;
  const hasPrice = market && market.price !== '0';

  return (
    <section className="panel mbar">
      <Segmented
        className="mtabs" itemClassName="mtab" label={t('markets.label')} value={marketId} onChange={onSelect}
        options={ids.map((id) => {
          const m = markets.find((x) => x.id === id);
          return {
            value: id,
            label: (
              <>
                <span className="mtab__sym">{id}</span>
                <span className="mtab__px num">{m && m.price !== '0' ? price(m.price, locale) : <Skeleton width={48} />}</span>
              </>
            ),
          };
        })}
      />
      <dl className="stats">
        <div className="stat stat--price">
          <dt>{t('stat.price')}</dt>
          <dd className="num">{hasPrice ? price(market.price, locale) : <Skeleton width={96} />}</dd>
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
