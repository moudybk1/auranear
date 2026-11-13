'use client';

import { useState } from 'react';
import { FundsDialog, type FundsKind } from '../../components/Funds';
import { Capacity } from '../../components/trade/MarketInfo';
import { Alert, Button, Card, Row, Skeleton } from '../../components/ui';
import { num, usd } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { bpsOf } from '../../lib/math';
import { useAura } from '../../lib/store';

export default function VaultPage() {
  const { t, locale } = useI18n();
  const { accountId, account, config, vault, markets, connect } = useAura();
  const [funds, setFunds] = useState<FundsKind | null>(null);

  const nav = BigInt(vault?.nav ?? 0);
  const cap = BigInt(config?.limits.vault_cap ?? 0);
  const insuranceShare = (config?.limits.insurance_fee_share_bps ?? 0) / 100;
  const shares = BigInt(account?.lp_shares ?? 0);
  const totalShares = BigInt(vault?.total_shares ?? 0);
  const ready = vault && config;

  return (
    <main className="page">
      <header>
        <h1 className="page__title">{t('vault.title')}</h1>
        <p className="page__lede">{t('vault.lede')}</p>
      </header>

      <div className="vault">
        <div className="vault__main">
          <section className="band" aria-label={t('vault.title')}>
            <dl>
              <div>
                <dt>{t('vault.nav')}</dt>
                <dd>{ready ? usd(nav, locale) : <Skeleton width={120} />}</dd>
                <dd className="band__note">USDC</dd>
              </div>
              <div>
                <dt>{t('vault.sharePrice')}</dt>
                <dd>{ready ? num(Number(vault.share_price) / 1e6, locale, 4) : <Skeleton width={90} />}</dd>
                <dd className="band__note">USDC</dd>
              </div>
              <div>
                <dt>{t('vault.cap')}</dt>
                <dd>{ready ? `${num(cap > 0n ? Number((nav * 10_000n) / cap) / 100 : 0, locale, 1)}%` : <Skeleton width={70} />}</dd>
                <dd className="band__note">{ready ? t('vault.capOf', { cap: usd(cap, locale, 0) }) : ' '}</dd>
              </div>
              <div>
                <dt>{t('vault.insurance')}</dt>
                <dd>{ready ? usd(vault.insurance, locale) : <Skeleton width={70} />}</dd>
                <dd className="band__note">{ready ? `USDC · ${t('vault.insurance.note', { pct: num(insuranceShare, locale, 0) })}` : ' '}</dd>
              </div>
            </dl>
          </section>

          <section className="panel section">
            <div className="panel__head">
              <h2 className="panel__title">{t('vault.util.title')}</h2>
            </div>
            <div className="util">
              {markets.map((m) => {
                const limit = bpsOf(nav, m.config.max_oi_bps_of_nav);
                return (
                  <div className="util__row" key={m.id}>
                    <p className="util__name">
                      {m.id}
                      <small>{t('vault.util.limit')} <span className="num">{usd(limit, locale, 0)}</span></small>
                    </p>
                    <Capacity side="long" used={BigInt(m.long_notional)} cap={limit} />
                    <Capacity side="short" used={BigInt(m.short_notional)} cap={limit} />
                  </div>
                );
              })}
              {markets.length === 0 && <p className="panel__empty"><Skeleton width={220} /></p>}
            </div>
          </section>

          <section className="panel section">
            <div className="panel__head">
              <h2 className="panel__title">{t('vault.how.title')}</h2>
            </div>
            <dl className="facts">
              <div>
                <dt>{t('vault.how.fees')}</dt>
                <dd>{t('vault.how.fees.body', { vault: num(100 - insuranceShare, locale, 0), insurance: num(insuranceShare, locale, 0) })}</dd>
              </div>
              <div>
                <dt>{t('vault.how.pnl')}</dt>
                <dd>{t('vault.how.pnl.body')}</dd>
              </div>
              <div>
                <dt>{t('vault.how.funding')}</dt>
                <dd>{t('vault.how.funding.body')}</dd>
              </div>
              <div>
                <dt>{t('vault.how.badDebt')}</dt>
                <dd>{t('vault.how.badDebt.body')}</dd>
              </div>
            </dl>
          </section>
        </div>

        <aside className="vault__main">
          <Card glow title={t('vault.yours')} className="lp">
            {!accountId ? (
              <p>{t('vault.connect')}</p>
            ) : (
              <>
                <p className="lp__value">
                  {account === undefined ? <Skeleton width={110} /> : usd(account?.lp_value ?? '0', locale)}
                  <small>USDC</small>
                </p>
                {shares > 0n ? (
                  <dl className="kv" style={{ marginTop: 'var(--space-3)' }}>
                    <Row label={t('vault.shares')}>{usd(shares, locale)}</Row>
                    <Row label={t('vault.share')}>
                      {num(totalShares > 0n ? Number((shares * 10_000n) / totalShares) / 100 : 0, locale, 2)}%
                    </Row>
                  </dl>
                ) : (
                  account !== undefined && <p style={{ marginTop: 'var(--space-1)' }}>{t('vault.none')}</p>
                )}
              </>
            )}
            <div className="lp__actions" style={{ marginTop: 'var(--space-4)' }}>
              {accountId ? (
                <>
                  <Button disabled={!ready || account === undefined} onClick={() => setFunds('lpDeposit')}>{t('vault.deposit')}</Button>
                  {shares > 0n && <Button variant="secondary" onClick={() => setFunds('lpWithdraw')}>{t('vault.withdraw')}</Button>}
                </>
              ) : (
                <Button onClick={connect}>{t('wallet.connect')}</Button>
              )}
            </div>
          </Card>
          <Alert tone="info" title={t('vault.risk.title')}>{t('vault.risk')}</Alert>
        </aside>
      </div>

      <FundsDialog kind={funds} onClose={() => setFunds(null)} />
    </main>
  );
}
