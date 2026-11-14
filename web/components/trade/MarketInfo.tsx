'use client';

import { TrendingDown, TrendingUp } from 'lucide-react';
import { leverage, num, usd } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { bpsOf } from '../../lib/math';
import { useAura } from '../../lib/store';
import type { MarketView } from '../../lib/types';
import { Row, Skeleton, Unit, cx } from '../ui';

/** Open interest on one side against its cap. Long is teal, short is neutral, and both are labelled. */
export function Capacity({ side, used, cap }: { side: 'long' | 'short'; used: bigint; cap: bigint }) {
  const { t, locale } = useI18n();
  const width = cap > 0n ? Math.min(100, Number((used * 10_000n) / cap) / 100) : 0;
  const Icon = side === 'long' ? TrendingUp : TrendingDown;
  const name = t(side === 'long' ? 'order.long' : 'order.short');
  const usage = t('info.used', { used: usd(used, locale, 0), cap: usd(cap, locale, 0) });
  return (
    <div className={cx('cap', `cap--${side}`)}>
      <div className="cap__row">
        <span className="cap__side">
          <Icon size={14} strokeWidth={1.75} aria-hidden />
          {name}
        </span>
        <span className="num">{usage}<Unit /></span>
      </div>
      <div className="cap__bar" role="img" aria-label={`${name}: ${usage} USDC`}>
        <i style={{ '--w': `${width}%` } as React.CSSProperties} />
      </div>
    </div>
  );
}

export function MarketInfo({ market, hidden }: { market?: MarketView; hidden?: boolean }) {
  const { t, locale } = useI18n();
  const { vault, config } = useAura();
  const pct = (bps: number, dp = 1) => `${num(bps / 100, locale, dp)}%`;

  if (!market || !vault) {
    return (
      <div className="info" role="tabpanel" aria-label={t('info.title')} hidden={hidden}>
        <div className="info__groups">
          <div className="info__group"><Skeleton width={120} /><Skeleton width={200} /><Skeleton width={160} /></div>
        </div>
      </div>
    );
  }

  const cfg = market.config;
  const cap = bpsOf(BigInt(vault.nav), cfg.max_oi_bps_of_nav);
  const staleAfter = cfg.stale_after_sec >= 3_600
    ? t('unit.hours', { n: Math.round(cfg.stale_after_sec / 3_600) })
    : t('unit.minutes', { n: Math.round(cfg.stale_after_sec / 60) });

  return (
    <div className="info" role="tabpanel" aria-label={t('info.title')} hidden={hidden}>
      <div className="info__groups">
        <div className="info__group">
          <h3>{t('info.liquidity')}</h3>
          <Capacity side="long" used={BigInt(market.long_notional)} cap={cap} />
          <Capacity side="short" used={BigInt(market.short_notional)} cap={cap} />
          <p className="info__note">{t('info.liquidity.note', { pct: num(cfg.max_oi_bps_of_nav / 100, locale, 0) })}</p>
        </div>
        <div className="info__group">
          <h3>{t('info.rules')}</h3>
          <dl className="kv">
            <Row label={t('info.rules.maxLev')}>{leverage(cfg.max_leverage_bps, locale)}</Row>
            <Row label={t('info.rules.mm')}>{pct(cfg.maintenance_margin_bps, 0)}</Row>
            <Row label={t('info.rules.fee')}>{pct(cfg.fee_bps, 1)}</Row>
            <Row label={t('info.rules.exec')}>
              <span style={{ fontFamily: 'var(--font-sans)' }}>
                {t(cfg.two_step ? 'info.rules.exec.twoStep' : 'info.rules.exec.instant')}
              </span>
            </Row>
            <Row label={t('info.funding.cap')}>±{pct(cfg.max_funding_bps_per_hour, 2)}</Row>
            <Row label={t('info.oracle.staleAfter')}>{staleAfter}</Row>
            <Row label={t('info.oracle.maxMove')}>{pct(cfg.max_price_jump_bps, 0)}</Row>
            {config && (
              <>
                <Row label={t('info.rules.minCollateral')}>{usd(config.limits.min_collateral, locale, 0)}<Unit /></Row>
                <Row label={t('info.rules.maxPosition')}>{usd(config.limits.max_position_notional, locale, 0)}<Unit /></Row>
              </>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}
