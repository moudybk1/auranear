'use client';

import { ChartCandlestick, Check, ChevronDown, ChevronRight, Copy, ExternalLink, LogOut, Moon, RotateCcw, Sun, Vault, Wallet, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CONTRACT_ID, DEMO, EXPLORER, NETWORK, REPO_URL } from '../lib/config';
import { shortAccount } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { listWallets, type WalletInfo } from '../lib/near';
import { useAura, type Toast } from '../lib/store';
import { Logo, LogoMark } from './Logo';
import { Badge, Button, Dialog, Skeleton, StatusIcon, cx } from './ui';

const icon = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

export function Shell({ children }: { children: React.ReactNode }) {
  // The landing page brings its own navigation and footer.
  if (usePathname() === '/') return children;
  return (
    <div className="app">
      <Header />
      <Notices />
      {children}
      <StatusBar />
      <TabBar />
      <Toasts />
      <WalletPicker />
    </div>
  );
}

/** Aura's own wallet picker over NEAR Connect's wallet list. Every "Connect wallet" button opens it (lib/store.tsx). */
function WalletPicker() {
  const { t } = useI18n();
  const { picker, closePicker, connectWith } = useAura();
  const [wallets, setWallets] = useState<WalletInfo[] | null>(null);

  useEffect(() => {
    if (!picker || wallets?.length) return;
    let live = true;
    listWallets().then((w) => live && setWallets(w), () => live && setWallets([]));
    return () => {
      live = false;
    };
  }, [picker, wallets]);

  return (
    <Dialog open={picker} onClose={closePicker} title={t('wallet.pick.title')} closeLabel={t('dialog.close')}>
      <p className="dlg__text">{t('wallet.pick.body')}</p>
      {wallets?.length === 0 ? (
        <p className="dlg__error" role="alert"><StatusIcon tone="danger" size={14} />{t('wallet.pick.empty')}</p>
      ) : (
        <ul className="wlist" aria-busy={!wallets}>
          {(wallets ?? [null, null, null]).map((w, i) => (
            <li key={w?.id ?? i}>
              {w ? (
                <button type="button" className="wlist__item" onClick={() => connectWith(w)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- wallet icons come from the NEAR Connect manifest */}
                  <img src={w.icon} alt="" width={32} height={32} />
                  <span className="wlist__name">
                    <b>{w.name}</b>
                    <small>{w.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</small>
                  </span>
                  <ChevronRight {...icon} />
                </button>
              ) : (
                <div className="wlist__item"><Skeleton width={160} /></div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function useNav() {
  const { t } = useI18n();
  const path = usePathname();
  return [
    { href: '/trade', label: t('nav.trade'), Icon: ChartCandlestick },
    { href: '/vault', label: t('nav.vault'), Icon: Vault },
  ].map((link) => ({ ...link, current: path.startsWith(link.href) ? ('page' as const) : undefined }));
}

function Header() {
  const { t } = useI18n();
  const nav = useNav();
  return (
    <header className="hdr">
      <Link href="/" className="hdr__logo" aria-label="Aura">
        <Logo className="logo-full" />
        <LogoMark className="logo-mark" />
      </Link>
      <nav className="hdr__nav" aria-label={t('nav.label')}>
        {nav.map(({ href, label, current }) => (
          <Link key={href} href={href} aria-current={current}>{label}</Link>
        ))}
      </nav>
      <div className="hdr__right">
        <Badge tone={DEMO ? 'warning' : 'neutral'} dot>{t(DEMO ? 'net.demo' : `net.${NETWORK}`)}</Badge>
        <ThemeToggle />
        <WalletButton />
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { t } = useI18n();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const device = matchMedia('(prefers-color-scheme: dark)');
    const read = () => setDark((document.documentElement.dataset.theme ?? (device.matches ? 'dark' : 'light')) === 'dark');
    read();
    device.addEventListener('change', read);
    return () => device.removeEventListener('change', read);
  }, []);

  const toggle = () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('aura.theme', next);
    } catch {}
    setDark(!dark);
    window.dispatchEvent(new Event('aura:theme')); // the chart repaints from the new tokens
  };

  return (
    <button type="button" className="icon-btn" aria-label={t(dark ? 'theme.toLight' : 'theme.toDark')} onClick={toggle}>
      {dark ? <Sun {...icon} /> : <Moon {...icon} />}
    </button>
  );
}

function WalletButton() {
  const { t } = useI18n();
  const { accountId, connecting, connect, disconnect, resetDemo } = useAura();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!accountId) {
    // While a wallet signs in the button says which one. It stays clickable: if that wallet's window was closed
    // without an answer, the user can pick again.
    return (
      <div className="wallet">
        <Button variant="secondary" size="sm" onClick={connect}>
          {connecting ? <span className="aura-spinner" aria-hidden /> : <Wallet {...icon} />}
          {connecting ? t('wallet.connecting', { wallet: connecting }) : t('wallet.connect')}
        </Button>
      </div>
    );
  }

  // "Copied" only shows when the browser actually allowed the copy.
  const copy = () =>
    navigator.clipboard?.writeText(accountId).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1_500);
      },
      () => {},
    );

  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="wallet" ref={root}>
      <Button variant="secondary" size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="wallet__id">
          <span className="dot" aria-hidden />
          <span className="num">{shortAccount(accountId)}</span>
        </span>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
      </Button>
      {open && (
        <div className="menu" role="menu">
          <p className="menu__id num">{accountId}</p>
          {/* Copy keeps the menu open, so the "Copied" confirmation is seen. */}
          <button type="button" role="menuitem" onClick={copy}>
            {copied ? <Check {...icon} /> : <Copy {...icon} />}
            <span aria-live="polite">{t(copied ? 'wallet.copied' : 'wallet.copy')}</span>
          </button>
          {!DEMO && (
            <a role="menuitem" href={`${EXPLORER}/address/${accountId}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
              <ExternalLink {...icon} />
              {t('wallet.explorer')}
            </a>
          )}
          {DEMO && (
            <button type="button" role="menuitem" onClick={pick(resetDemo)}>
              <RotateCcw {...icon} />
              {t('wallet.reset')}
            </button>
          )}
          <button type="button" role="menuitem" onClick={pick(disconnect)}>
            <LogOut {...icon} />
            {t('wallet.disconnect')}
          </button>
        </div>
      )}
    </div>
  );
}

function Notices() {
  const { t } = useI18n();
  const { config, offline } = useAura();
  return (
    <>
      {/* Only demo mode gets a standing banner: it says the balances are simulated. */}
      {DEMO && (
        <p className="notice" role="note">
          <StatusIcon tone="warning" size={16} />
          <span>{t('banner.demo')}</span>
        </p>
      )}
      {config?.paused && (
        <p className="notice" role="alert">
          <StatusIcon tone="warning" size={16} />
          <span><b>{t('paused.title')}.</b> {t('paused.body')}</span>
        </p>
      )}
      {offline && (
        <p className="notice" role="alert">
          <StatusIcon tone="warning" size={16} />
          <span><b>{t('offline.title')}.</b> {t('offline.body')}</span>
        </p>
      )}
    </>
  );
}

function StatusBar() {
  const { t } = useI18n();
  const { markets } = useAura();
  const state = markets.length === 0 ? 'wait' : markets.every((m) => m.is_fresh) ? 'live' : 'stale';
  return (
    <footer className="sbar">
      <span className={cx(state === 'live' && 'is-live', state === 'stale' && 'is-stale')}>
        <span className="dot" aria-hidden />
        {t(`status.oracle.${state}`)}
      </span>
      <span>{t(DEMO ? 'net.demo' : `net.${NETWORK}`)}</span>
      <a href={REPO_URL} target="_blank" rel="noreferrer">
        {t('status.source')}
        <ExternalLink size={12} strokeWidth={1.75} aria-hidden />
      </a>
      {DEMO ? (
        <span className="sbar__end">{t('status.simulated')}</span>
      ) : (
        <a className="sbar__end" href={`${EXPLORER}/address/${CONTRACT_ID}`} target="_blank" rel="noreferrer">
          {t('status.contract')} <span className="num">{CONTRACT_ID}</span>
          <ExternalLink size={12} strokeWidth={1.75} aria-hidden />
        </a>
      )}
    </footer>
  );
}

function TabBar() {
  const { t } = useI18n();
  const nav = useNav();
  return (
    <nav className="tabbar" aria-label={t('nav.label')}>
      {nav.map(({ href, label, current, Icon }) => (
        <Link key={href} href={href} aria-current={current}>
          <Icon size={20} strokeWidth={1.75} aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}

function Toasts() {
  const { toasts } = useAura();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} />)}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const { t } = useI18n();
  const { dismiss } = useAura();
  const { id, tone } = toast;

  // Errors stay until dismissed; everything else leaves after six seconds.
  useEffect(() => {
    if (tone === 'danger') return;
    const timer = setTimeout(() => dismiss(id), 6_000);
    return () => clearTimeout(timer);
  }, [id, tone, dismiss]);

  return (
    <div className={cx('aura-alert', `aura-alert--${tone}`, 'toast')} role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}>
      <StatusIcon tone={tone} />
      <div className="aura-alert__content">
        <p className="aura-alert__title">{toast.title}</p>
        {toast.body && <div className="aura-alert__body">{toast.body}</div>}
        {toast.hash && (
          <a href={`${EXPLORER}/txns/${toast.hash}`} target="_blank" rel="noreferrer">
            {t('tx.view')}
            <ExternalLink size={12} strokeWidth={1.75} aria-hidden />
          </a>
        )}
      </div>
      <button type="button" className="icon-btn" aria-label={t('toast.dismiss')} onClick={() => dismiss(id)}>
        <X {...icon} />
      </button>
    </div>
  );
}
