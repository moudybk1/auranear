'use client';

import { Info, TrendingDown, TrendingUp } from 'lucide-react';
import { useId, useState } from 'react';
import { leverage, num, price, usd } from '../../lib/format';
import { useI18n, type Key } from '../../lib/i18n';
import { capacityLeft, fromBase, maxCollateral, quoteOpen, toBase } from '../../lib/math';
import { useAura } from '../../lib/store';
import { openPosition } from '../../lib/tx';
import type { MarketView } from '../../lib/types';
import { Button, Row, Segmented, StatusIcon, Unit, cx } from '../ui';

const STEP_BPS = 5_000; // 0.5x
const TICKS = [1, 2, 5, 10, 20];

/** 0.02 from "20000000000000000000000" yoctoNEAR. Display only. */
export const nearAmount = (yocto: string) => Number(BigInt(yocto) / 10n ** 18n) / 1e6;

export function OrderForm({ market, onFund }: { market?: MarketView; onFund: () => void }) {
  const { t, locale } = useI18n();
  const { accountId, account, config, vault, positions, pending, connect, send } = useAura();
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [input, setInput] = useState('');
  const [wanted, setWanted] = useState(20_000);
  const inputId = useId();

  const isLong = side === 'long';
  const maxLev = market?.config.max_leverage_bps ?? 100_000;
  const lev = Math.min(wanted, maxLev);
  const frac = maxLev > 10_000 ? (lev - 10_000) / (maxLev - 10_000) : 0;
  const collateral = toBase(input) ?? 0n;
  const free = BigInt(account?.free ?? 0);
  const limits = config?.limits;
  const quote = market ? quoteOpen(collateral, lev, isLong, BigInt(market.price), market.config) : null;
  const capacity = market && vault
    ? capacityLeft(BigInt(vault.nav), market.config.max_oi_bps_of_nav, BigInt(isLong ? market.long_notional : market.short_notional))
    : null;
  const most = market && limits ? maxCollateral(free, lev, market.config.fee_bps, BigInt(limits.max_position_notional)) : 0n;

  // One primary action at a time: connect, activate, deposit, then trade.
  const stage = !accountId ? 'connect' : account === null ? 'activate' : account && free === 0n ? 'deposit' : 'trade';

  // First rule the order breaks, in the order the contract checks them.
  let block: { key: Key; vars?: Record<string, string | number>; quiet?: boolean } | null = null;
  if (stage === 'trade' && market && quote && limits) {
    if (config?.paused) block = { key: 'reason.paused' };
    else if (!market.is_fresh) block = { key: 'reason.stale' };
    else if (collateral === 0n) block = { key: 'reason.enter', quiet: true };
    else if (collateral < BigInt(limits.min_collateral)) block = { key: 'reason.min', vars: { min: usd(limits.min_collateral, locale, 0) } };
    else if (quote.notional > BigInt(limits.max_position_notional)) block = { key: 'reason.max', vars: { max: usd(limits.max_position_notional, locale, 0) } };
    else if (quote.required > free) block = { key: 'reason.balance', vars: { total: usd(quote.required, locale) } };
    else if (positions.length >= limits.max_positions_per_account) block = { key: 'reason.count', vars: { n: positions.length } };
    else if (capacity !== null && quote.notional > capacity) block = { key: 'reason.capacity' };
  }
  const amountInvalid = !!block && ['reason.min', 'reason.max', 'reason.balance'].includes(block.key);

  const submit = async () => {
    if (!market) return;
    if (await send([openPosition(market.id, isLong, collateral, lev)], t('tx.ok.open'))) setInput('');
  };

  const cta = {
    connect: { label: t('wallet.connect'), action: connect, hint: t('reason.connect') },
    activate: {
      label: t('account.activate.cta'),
      action: onFund,
      hint: t('account.activate.body', { near: num(nearAmount(config?.storage_deposit_yocto ?? '0'), locale, 2) }),
    },
    deposit: { label: t('order.cta.deposit'), action: onFund, hint: t('reason.deposit') },
    trade: { label: t(isLong ? 'order.cta.long' : 'order.cta.short'), action: submit, hint: block ? t(block.key, block.vars) : null },
  }[stage];

  const fill = (percent: bigint) => setInput(fromBase((((most * percent) / 100n) / 10_000n) * 10_000n));
  const show = (value: bigint | undefined, format: (v: bigint) => React.ReactNode) =>
    value !== undefined && collateral > 0n ? format(value) : '—';

  return (
    <section className="panel order__form" aria-label={t('order.label')}>
      <Segmented
        className="seg seg--full" label={t('order.side')} value={side} onChange={setSide}
        options={[
          { value: 'long', tone: 'long', label: <><TrendingUp size={16} strokeWidth={1.75} aria-hidden />{t('order.long')}</> },
          { value: 'short', label: <><TrendingDown size={16} strokeWidth={1.75} aria-hidden />{t('order.short')}</> },
        ]}
      />

      <div>
        <div className="field__top">
          <label className="field__label" htmlFor={inputId}>{t('order.collateral')}</label>
          {account && <span className="field__aside">{t('order.available')} <span className="num">{usd(free, locale)}</span></span>}
        </div>
        <div className={cx('amount', amountInvalid && 'is-invalid')}>
          <input
            id={inputId} inputMode="decimal" autoComplete="off" placeholder="0.00" value={input}
            aria-invalid={amountInvalid || undefined}
            onChange={(e) => {
              const v = e.target.value.replace(',', '.');
              if (/^\d*\.?\d{0,6}$/.test(v)) setInput(v);
            }}
          />
          <span className="amount__unit">USDC</span>
        </div>
        <div className="chips">
          {[25n, 50n, 75n, 100n].map((p) => (
            <button key={p} type="button" className="chip" disabled={most === 0n} onClick={() => fill(p)}>
              {p === 100n ? t('order.max') : `${p}%`}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="field__top">
          <span className="field__label">{t('order.leverage')}</span>
          <span className="num">{leverage(lev, locale)}</span>
        </div>
        <input
          type="range" className="slider" min={10_000} max={maxLev} step={STEP_BPS} value={lev}
          aria-label={t('order.leverage')} aria-valuetext={leverage(lev, locale)}
          style={{ '--frac': frac } as React.CSSProperties}
          onChange={(e) => setWanted(Number(e.target.value))}
        />
        <div className="ticks">
          {TICKS.filter((x) => x * 10_000 <= maxLev).map((x) => (
            <button
              key={x} type="button" className="num" aria-pressed={lev === x * 10_000}
              style={{ '--frac': (x * 10_000 - 10_000) / (maxLev - 10_000) } as React.CSSProperties}
              onClick={() => setWanted(x * 10_000)}
            >
              {x}x
            </button>
          ))}
        </div>
      </div>

      <dl className="kv order__summary">
        <Row label={t('order.summary.notional')}>{show(quote?.notional, (v) => <>{usd(v, locale)}<Unit /></>)}</Row>
        <Row label={t('order.summary.entry')}>{market && market.price !== '0' ? price(market.price, locale) : '—'}</Row>
        <Row label={t('order.summary.liq')}>{show(quote?.liquidation, (v) => price(v, locale))}</Row>
        <Row label={t('order.summary.fee', { pct: num((market?.config.fee_bps ?? 10) / 100, locale, 1) })}>
          {show(quote?.fee, (v) => <>{usd(v, locale)}<Unit /></>)}
        </Row>
        <Row label={t('order.summary.mm')}>{show(quote?.maintenance, (v) => <>{usd(v, locale)}<Unit /></>)}</Row>
        <Row label={t('order.summary.capacity')}>{capacity === null ? '—' : <>{usd(capacity, locale, 0)}<Unit /></>}</Row>
      </dl>

      <Button
        className="order__cta" loading={pending}
        disabled={stage === 'trade' && (!!block || !market || account === undefined)}
        onClick={cta.action}
      >
        {pending ? t('tx.pending') : cta.label}
      </Button>
      {cta.hint && (
        <p className={cx('order__reason', stage === 'trade' && !block?.quiet && 'is-blocking')} role={stage === 'trade' && !block?.quiet ? 'alert' : undefined}>
          {stage === 'trade' && !block?.quiet ? <StatusIcon tone="warning" size={14} /> : <Info size={14} strokeWidth={1.75} aria-hidden />}
          <span>{cta.hint}</span>
        </p>
      )}
    </section>
  );
}

export function AccountPanel({ onDeposit, onWithdraw }: { onDeposit: () => void; onWithdraw: () => void }) {
  const { t, locale } = useI18n();
  const { accountId, account, walletUsdc } = useAura();
  const amount = (v?: string) => (v === undefined ? '—' : <>{usd(v, locale)}<Unit /></>);
  return (
    <section className="panel acct">
      <h3>{t('account.title')}</h3>
      {!accountId ? (
        <p className="muted">{t('account.empty')}</p>
      ) : (
        <>
          <dl className="kv">
            <Row label={t('account.free')}>{amount(account?.free)}</Row>
            <Row label={t('account.locked')}>{amount(account?.locked)}</Row>
            <Row label={t('account.wallet')}>{amount(walletUsdc)}</Row>
          </dl>
          {account && (
            <div className="acct__actions">
              <Button variant="secondary" size="sm" onClick={onDeposit}>{t('account.deposit')}</Button>
              <Button variant="secondary" size="sm" disabled={account.free === '0'} onClick={onWithdraw}>{t('account.withdraw')}</Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
