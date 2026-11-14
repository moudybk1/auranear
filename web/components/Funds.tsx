'use client';

import { useId, useState } from 'react';
import { FAUCET } from '../lib/config';
import { num, usd } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { fromBase, toBase } from '../lib/math';
import { useAura } from '../lib/store';
import { activate, deposit, faucet, lpWithdraw, withdraw } from '../lib/tx';
import { Button, Dialog, StatusIcon, cx } from './ui';
import { nearAmount } from './trade/OrderForm';

export type FundsKind = 'deposit' | 'withdraw' | 'lpDeposit' | 'lpWithdraw';

const NEAR_FAUCET_URL = 'https://docs.near.org/getting-started/faucet';

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const floor0 = (v: bigint) => (v > 0n ? v : 0n);

/** Moves USDC between the wallet, the trading balance and the vault. One dialog, four directions. */
export function FundsDialog({ kind, onClose }: { kind: FundsKind | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { accountId, account, config, vault, walletUsdc, send } = useAura();
  if (!kind || !config || !vault) return <Dialog open={false} onClose={onClose} title="" closeLabel="">{null}</Dialog>;

  const wallet = BigInt(walletUsdc ?? 0);
  const free = BigInt(account?.free ?? 0);
  const lpValue = BigInt(account?.lp_value ?? 0);
  const lpShares = BigInt(account?.lp_shares ?? 0);
  const newAccount = account === null; // first deposit also pays the one-time storage deposit
  const join = newAccount ? [activate(config.storage_deposit_yocto)] : [];
  const near = num(nearAmount(config.storage_deposit_yocto), locale, 2);

  const view = {
    deposit: {
      title: t(newAccount ? 'account.activate.title' : 'deposit.title'),
      body: newAccount ? t('account.activate.body', { near }) : t('deposit.body'),
      maxLabel: t('account.wallet'),
      max: min(wallet, floor0(BigInt(config.limits.max_user_collateral) - free - BigInt(account?.locked ?? 0))),
      cta: (amount: bigint) => t(!newAccount ? 'account.deposit' : amount > 0n ? 'account.activate.and' : 'account.activate.cta'),
      run: (amount: bigint) =>
        send([...join, ...(amount > 0n ? [deposit(amount, 'deposit')] : [])], t(amount > 0n ? 'tx.ok.deposit' : 'tx.ok.activate')),
    },
    withdraw: {
      title: t('withdraw.title'),
      body: t('withdraw.body'),
      maxLabel: t('account.free'),
      max: free,
      cta: () => t('account.withdraw'),
      run: (amount: bigint) => send([withdraw(amount)], t('tx.ok.withdraw')),
    },
    lpDeposit: {
      title: t('vault.deposit'),
      body: t('vault.deposit.body', { price: num(Number(vault.share_price) / 1e6, locale, 4) }),
      maxLabel: t('account.wallet'),
      max: min(wallet, floor0(BigInt(config.limits.vault_cap) - BigInt(vault.nav))),
      cta: () => t('vault.deposit'),
      run: (amount: bigint) => send([...join, deposit(amount, 'lp')], t('tx.ok.lpDeposit')),
    },
    lpWithdraw: {
      title: t('vault.withdraw'),
      body: t('vault.withdraw.body'),
      maxLabel: t('vault.value'),
      max: lpValue,
      cta: () => t('vault.withdraw'),
      // The contract takes shares. Withdrawing everything burns every share, so no dust is left behind.
      run: (amount: bigint) =>
        send([lpWithdraw(amount >= lpValue ? lpShares : (amount * lpShares) / lpValue)], t('tx.ok.lpWithdraw')),
    },
  }[kind];

  return (
    <Dialog open onClose={onClose} title={view.title} closeLabel={t('dialog.close')}>
      <AmountForm
        {...view} allowEmpty={kind === 'deposit' && newAccount} onClose={onClose}
        help={FAUCET && newAccount && kind === 'deposit'}
        // The dialog stays open: it steps aside for the wallet and comes back with the new wallet balance.
        onFaucet={FAUCET && accountId && kind !== 'withdraw' && kind !== 'lpWithdraw' ? () => void send([faucet(accountId)], t('tx.ok.faucet')) : undefined}
      />
    </Dialog>
  );
}

function AmountForm({
  body, maxLabel, max, cta, run, allowEmpty, onClose, onFaucet, help,
}: {
  body: string; maxLabel: string; max: bigint; cta: (amount: bigint) => string;
  run: (amount: bigint) => Promise<boolean>; allowEmpty: boolean; onClose: () => void; onFaucet?: () => void;
  help?: boolean;
}) {
  const { t, locale } = useI18n();
  const { pending } = useAura();
  const [input, setInput] = useState('');
  const id = useId();
  const amount = toBase(input) ?? 0n;
  const over = amount > max;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(amount)) onClose();
      }}
    >
      <p className="dlg__text">{body}</p>
      {help && (
        <p className="dlg__hint">
          {t('faucet.help')}{' '}
          <a href={NEAR_FAUCET_URL} target="_blank" rel="noreferrer">{t('faucet.help.link')}</a>
        </p>
      )}
      <div style={{ marginTop: 'var(--space-4)' }}>
        <div className="field__top">
          <label className="field__label" htmlFor={id}>{t('dialog.amount')}</label>
          <span className="field__aside">{maxLabel} <span className="num">{usd(max, locale)}</span></span>
        </div>
        <div className={cx('amount', over && 'is-invalid')}>
          <input
            id={id} inputMode="decimal" autoComplete="off" placeholder="0.00" value={input}
            aria-invalid={over || undefined} aria-describedby={`${id}-msg`}
            onChange={(e) => {
              const v = e.target.value.replace(',', '.');
              if (/^\d*\.?\d{0,6}$/.test(v)) setInput(v);
            }}
          />
          <span className="amount__unit">USDC</span>
          <Button variant="secondary" size="sm" disabled={max === 0n} onClick={() => setInput(fromBase(max))}>{t('order.max')}</Button>
        </div>
        <div id={`${id}-msg`}>
          {over ? (
            <p className="dlg__error" role="alert">
              <StatusIcon tone="danger" size={14} />
              {t('amount.over', { max: usd(max, locale) })}
            </p>
          ) : allowEmpty ? (
            <p className="dlg__hint">{t('account.activate.optional')}</p>
          ) : null}
        </div>
        {onFaucet && (
          <div className="dlg__hint">
            <Button variant="ghost" size="sm" disabled={pending} onClick={onFaucet}>{t('faucet.cta')}</Button>
          </div>
        )}
      </div>
      <div className="dlg__foot">
        <Button variant="ghost" onClick={onClose}>{t('dialog.cancel')}</Button>
        <Button type="submit" loading={pending} disabled={over || (amount === 0n && !allowEmpty)}>
          {pending ? t('tx.pending') : cta(amount)}
        </Button>
      </div>
    </form>
  );
}
