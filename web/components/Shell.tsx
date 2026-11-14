'use client';

import { ChartCandlestick, ChevronDown, Copy, ExternalLink, Languages, LogOut, Moon, RotateCcw, Sun, Vault, Wallet, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CONTRACT_ID, DEMO, EXPLORER, NETWORK, REPO_URL } from '../lib/config';
import { shortAccount } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useAura, type Toast } from '../lib/store';
import { Logo, LogoMark } from './Logo';
import { Badge, Button, StatusIcon, cx } from './ui';

const icon = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <Header />
      <Notices />
      {children}
      <StatusBar />
      <TabBar />
      <Toasts />
    </div>
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
  const { t, locale, setLocale } = useI18n();
  const nav = useNav();
  return (
    <header className="hdr">
      <Link href="/trade" className="hdr__logo" aria-label="Aura">
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
        <button
          type="button" className="icon-btn" aria-label={t('locale.switch')}
          onClick={() => setLocale(locale === 'en' ? 'id' : 'en')}
        >
          <Languages {...icon} />
          {locale.toUpperCase()}
        </button>
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
  const { accountId, connect, disconnect, resetDemo } = useAura();
  const [open, setOpen] = useState(false);
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
    return (
      <div className="wallet">
        <Button variant="secondary" size="sm" onClick={connect}>
          <Wallet {...icon} />
          {t('wallet.connect')}
        </Button>
      </div>
    );
  }

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
          <button type="button" role="menuitem" onClick={pick(() => void navigator.clipboard?.writeText(accountId))}>
            <Copy {...icon} />
            {t('wallet.copy')}
          </button>
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
      <p className="notice" role="note">
        <StatusIcon tone="warning" size={16} />
        <span>{t(DEMO ? 'banner.demo' : 'banner.prototype')}</span>
      </p>
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
