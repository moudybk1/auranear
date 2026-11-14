'use client';

// The landing page at "/": a headline, the app's own order ticket working on live testnet prices, the three
// markets, real screenshots of the terminal, four steps and one action. It shows only what runs today.
// The ticket is a real fragment of the app (same classes, same strings, same math) fed by the same store
// as the terminal. Copy lives in lib/landing-copy.ts, styles and motion in styles/landing.css.

import { ArrowRight, ArrowUpRight, ChevronDown, TrendingDown, TrendingUp } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { CONTRACT_ID, DEMO, EXPLORER, REPO_URL } from '../lib/config';
import { age, leverage, num, price, signedPct, usd } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { LANDING, fill } from '../lib/landing-copy';
import { quoteOpen, toBase } from '../lib/math';
import { useAura } from '../lib/store';
import { Logo } from './Logo';
import { MARKET_IDS, NAMES } from './trade/MarketBar';
import { Delta, Row, Segmented, Skeleton, Unit, cx, useNow } from './ui';

const icon = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const;
const vars = (v: Record<string, string | number>) => v as React.CSSProperties;
/** Entrance order inside a revealed block (styles/landing.css staggers on --i). */
const rv = (i: number) => vars({ '--i': i });

type MarketProps = { marketId: string; onMarket: (id: string) => void };

export function Landing() {
  const root = useReveal();
  const [marketId, setMarketId] = useState('BTC-USD');
  return (
    <div className="lp" data-theme="dark" ref={root}>
      <Nav />
      <main>
        <Hero marketId={marketId} onMarket={setMarketId} />
        <Markets />
        <Shot />
        <How />
        <Cta marketId={marketId} onMarket={setMarketId} />
      </main>
      <Footer />
    </div>
  );
}

/** Marks each [data-rv] block once it scrolls into view. Without script nothing is hidden. */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.add('lp--js');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    el.querySelectorAll('[data-rv]').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
  return ref;
}

function useCopy() {
  const { locale } = useI18n();
  return LANDING[locale];
}

function useMarketIds() {
  const { markets } = useAura();
  return markets.length ? markets.map((m) => m.id) : MARKET_IDS;
}

function Nav() {
  const c = useCopy().nav;
  return (
    <nav className="lp-nav lp-wrap" aria-label={c.label}>
      <Link href="/" className="lp-nav__logo" aria-label="Aura"><Logo /></Link>
      <div className="lp-nav__links">
        <a className="lp-link" href="#markets">{c.markets}</a>
        <a className="lp-link" href="#how">{c.how}</a>
      </div>
      <Link href="/trade" className="aura-btn aura-btn--secondary aura-btn--md lp-nav__go">{c.launch}</Link>
    </nav>
  );
}

function Hero(props: MarketProps) {
  const c = useCopy().hero;
  return (
    <header className="lp-hero lp-wrap">
      <div className="lp-hero__top">
        {/* Each word rises out of its own mask (styles/landing.css). */}
        <h1 className="lp-hero__title">
          {c.title.split(' ').map((word, i) => (
            <Fragment key={i}>
              <span className="lp-word"><span style={rv(i)}>{word}</span></span>{' '}
            </Fragment>
          ))}
        </h1>
        <div className="lp-hero__side">
          <p className="lp-hero__sub">{c.sub}</p>
          <div className="lp-hero__actions">
            <Link href="/trade" className="aura-btn aura-btn--primary aura-btn--lg lp-go lp-glow">
              {c.launch}
              <ArrowRight {...icon} />
            </Link>
            <a className="lp-link" href={REPO_URL} target="_blank" rel="noreferrer">
              {c.source}
              <ArrowUpRight {...icon} />
            </a>
          </div>
          <p className="lp-hero__note">{c.note}</p>
        </div>
      </div>
      <Stage {...props} />
    </header>
  );
}

// What the ticket does on its own until someone touches it: sweep the leverage, flip the side, repeat.
const DEMO_SCRIPT: ['long' | 'short', number][] = [
  ['long', 100_000], ['short', 100_000], ['short', 20_000], ['short', 100_000], ['long', 100_000], ['long', 20_000],
];
const DEMO_START = 50_000;

/**
 * The app's order ticket, previewing a trade at the price the oracle last pushed, with the contract's own
 * math (lib/math.ts). The ruler beside it is the logo laid flat: long to the left, short to the right,
 * the mark-price dot between them.
 */
function Stage({ marketId, onMarket }: MarketProps) {
  const { t, locale } = useI18n();
  const c = useCopy().ticket;
  const { markets } = useAura();
  const ids = useMarketIds();
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [input, setInput] = useState('100');
  const [wanted, setWanted] = useState(DEMO_START);
  const [auto, setAuto] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const inputId = useId();

  // The self-playing demo. It moves the same state the controls do, one 0.5x step every 50 ms, only while the
  // stage is on screen, and never under reduced motion.
  useEffect(() => {
    const el = stage.current;
    if (!auto || !el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let seen = false;
    const io = new IntersectionObserver(([e]) => (seen = e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    let step = 0;
    let hold = 36; // ticks to wait: the hero's entrance first
    let lev = DEMO_START;
    const timer = setInterval(() => {
      if (document.hidden || !seen) return;
      if (hold > 0) return void hold--;
      const [nextSide, target] = DEMO_SCRIPT[step];
      setSide(nextSide);
      if (lev === target) {
        step = (step + 1) % DEMO_SCRIPT.length;
        hold = 28;
        return;
      }
      lev += Math.sign(target - lev) * 5_000;
      setWanted(lev);
    }, 50);
    return () => {
      clearInterval(timer);
      io.disconnect();
    };
  }, [auto]);
  const stop = () => setAuto(false);

  const market = markets.find((m) => m.id === marketId);
  const maxLev = market?.config.max_leverage_bps ?? 100_000;
  const lev = Math.min(wanted, maxLev);
  const isLong = side === 'long';
  const oracle = BigInt(market?.price ?? 0);
  const collateral = toBase(input) ?? 0n;
  const quote = market && oracle > 0n && collateral > 0n ? quoteOpen(collateral, lev, isLong, oracle, market.config) : null;
  // Display only: the liquidation price as a signed distance from the oracle price, in percent.
  const away = quote ? (Number(quote.liquidation) / Number(oracle) - 1) * 100 : 0;
  const show = (value: bigint | undefined, format: (v: bigint) => React.ReactNode) => (value === undefined ? '—' : format(value));

  return (
    <div className="lp-stage" ref={stage}>
      <section className="panel order__form lp-ticket" data-ui aria-label={c.label} onPointerDown={stop} onKeyDown={stop} onFocus={stop}>
        <Segmented
          className="seg seg--full seg--sm" label={c.market} value={marketId} onChange={onMarket}
          options={ids.map((id) => ({ value: id, label: id }))}
        />
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
          </div>
          <div className="amount">
            <input
              id={inputId} inputMode="decimal" autoComplete="off" placeholder="0.00" value={input}
              onChange={(e) => {
                const v = e.target.value.replace(',', '.');
                if (/^\d{0,7}\.?\d{0,6}$/.test(v)) setInput(v);
              }}
            />
            <span className="amount__unit">USDC</span>
          </div>
        </div>
        <div>
          <div className="field__top">
            <span className="field__label">{t('order.leverage')}</span>
            <span className="num">{leverage(lev, locale)}</span>
          </div>
          <input
            type="range" className="slider" min={10_000} max={maxLev} step={5_000} value={lev}
            aria-label={t('order.leverage')} aria-valuetext={leverage(lev, locale)}
            style={vars({ '--frac': maxLev > 10_000 ? (lev - 10_000) / (maxLev - 10_000) : 0 })}
            onChange={(e) => setWanted(Number(e.target.value))}
          />
          <div className="ticks">
            {[1, 2, 5, 10].filter((x) => x * 10_000 <= maxLev).map((x) => (
              <button
                key={x} type="button" className="num" aria-pressed={lev === x * 10_000}
                style={vars({ '--frac': (x * 10_000 - 10_000) / (maxLev - 10_000) })}
                onClick={() => setWanted(x * 10_000)}
              >
                {x}x
              </button>
            ))}
          </div>
        </div>
        <dl className="kv order__summary">
          <Row label={t('order.summary.notional')}>{show(quote?.notional, (v) => <>{usd(v, locale)}<Unit /></>)}</Row>
          <Row label={t('order.summary.entry')}>{oracle > 0n ? price(oracle, locale) : '—'}</Row>
          <Row label={t('order.summary.liq')}>{show(quote?.liquidation, (v) => price(v, locale))}</Row>
          <Row label={t('order.summary.fee', { pct: num((market?.config.fee_bps ?? 10) / 100, locale, 1) })}>
            {show(quote?.fee, (v) => <>{usd(v, locale)}<Unit /></>)}
          </Row>
          <Row label={t('order.summary.mm')}>{show(quote?.maintenance, (v) => <>{usd(v, locale)}<Unit /></>)}</Row>
        </dl>
        <Link href={`/trade?market=${marketId}`} className="aura-btn aura-btn--secondary aura-btn--md order__cta">
          {fill(c.open, { market: marketId })}
        </Link>
      </section>

      {/* No live region here: the demo changes these numbers many times a second. */}
      <div className={cx('lp-ruler', isLong ? 'is-long' : 'is-short')}>
        <div>
          <p className="lp-ruler__value num">{oracle === 0n ? <Skeleton width={220} /> : quote ? price(quote.liquidation, locale) : '—'}</p>
          <p className="lp-ruler__say">
            {oracle === 0n ? c.waiting : <>{c.liq}{quote && <>, {fill(c.away, { pct: signedPct(away, locale, 1) })}</>}</>}
          </p>
        </div>
        <div>
          <div className="lp-ruler__scale" style={vars({ '--d': away, '--a': Math.min(Math.abs(away), 100) })} aria-hidden>
            <div className="lp-ruler__track"><i className="lp-ruler__room" /></div>
            <i className="lp-ruler__liq" />
            <i className="lp-ruler__dot" />
          </div>
          <div className="lp-ruler__ends">
            <span>{c.falls}</span>
            <span>{c.oracle} <b className="num">{oracle > 0n ? price(oracle, locale) : '—'}</b></span>
            <span>{c.rises}</span>
          </div>
        </div>
        <p className="lp-ruler__caption">{c.caption}</p>
      </div>
    </div>
  );
}

/** One row per market, read from the contract every few seconds. The whole row opens that market. */
function Markets() {
  const { locale } = useI18n();
  const c = useCopy().markets;
  const { markets, tickers } = useAura();
  const ids = useMarketIds();
  const now = useNow();
  return (
    <section id="markets" className="lp-sec lp-wrap lp-markets" data-rv>
      <h2 className="rv"><span className="soft">{c.titleSoft}</span> <span>{c.title}</span></h2>
      <div className="lp-rows">
        <div className="lp-row lp-row--head rv" style={rv(1)} aria-hidden>
          <span>{c.market}</span>
          <span>{c.price}</span>
          <span>{c.change}</span>
          <span>{c.leverage}</span>
          <span>{c.update}</span>
        </div>
        {ids.map((id, i) => {
          const m = markets.find((x) => x.id === id);
          const ticker = tickers[id];
          const shown = m && m.price !== '0' ? price(m.price, locale) : null;
          return (
            <Link key={id} href={`/trade?market=${id}`} className="lp-row rv" style={rv(i + 2)} title={fill(c.trade, { market: id })}>
              <span className="lp-row__name"><b>{id}</b><small>{NAMES[id]}</small></span>
              {/* Re-keyed on every new price, so the figure ticks in. */}
              <span className="lp-row__price num">{shown ? <span key={shown} className="lp-tick">{shown}</span> : <Skeleton width={110} />}</span>
              <span>{ticker ? <Delta sign={ticker.changePct}>{signedPct(ticker.changePct, locale)}</Delta> : <Skeleton />}</span>
              <span className="lp-row__lev num">{m ? leverage(m.config.max_leverage_bps, locale) : <Skeleton />}</span>
              <span className={cx('lp-row__live', m && !m.is_fresh && 'is-stale')}>
                {m && (
                  <>
                    <span className="lp-pulse" aria-hidden />
                    {!m.is_fresh && `${c.stale} · `}
                    <span className="num">{fill(c.ago, { age: age(now - Number(m.price_ts_sec)) })}</span>
                  </>
                )}
              </span>
              <ArrowRight {...icon} className="lp-row__go" />
            </Link>
          );
        })}
      </div>
      <p className="lp-markets__note rv" style={rv(5)}>{c.note}</p>
    </section>
  );
}

/** Real screenshots of the terminal, one framing, three markets. They crossfade, and the frame stands up as it scrolls in. */
function Shot() {
  const c = useCopy().shot;
  return (
    <section className="lp-sec lp-wrap lp-shot" data-rv>
      <div className="lp-split">
        <h2 className="rv">{c.title}</h2>
        <p className="rv" style={rv(1)}>{c.body}</p>
      </div>
      <figure className="lp-shot__fig">
        <div className="lp-shot__frame">
          {MARKET_IDS.map((id) => (
            <Image
              key={id} src={`/landing/terminal-${id.split('-')[0].toLowerCase()}.webp`} width={2880} height={1800}
              sizes="(min-width: 1520px) 1448px, 100vw" alt={fill(c.alt, { market: id })}
            />
          ))}
        </div>
        <figcaption className="rv" style={rv(2)}>{c.caption}</figcaption>
      </figure>
    </section>
  );
}

function How() {
  const c = useCopy().how;
  return (
    <section id="how" className="lp-sec lp-wrap lp-how" data-rv>
      <h2 className="rv">{c.title}</h2>
      <div className="lp-steps">
        {/* Fills from the top as the list scrolls through the screen. */}
        <i className="lp-steps__bar" aria-hidden />
        <ol>
          {c.steps.map((s, i) => (
            <li key={s.title} className="rv" style={rv(i + 1)}>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              {i === 2 && (
                <Link className="lp-link" href="/vault">
                  {c.vault}
                  <ArrowRight {...icon} />
                </Link>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Cta({ marketId, onMarket }: MarketProps) {
  const c = useCopy().cta;
  const ids = useMarketIds();
  return (
    <section className="lp-sec lp-wrap lp-cta" data-rv>
      <h2 className="rv">
        {c.lead}{' '}
        <span className="lp-cta__pick">
          <select aria-label={c.market} value={marketId} onChange={(e) => onMarket(e.target.value)}>
            {ids.map((id) => <option key={id}>{id}</option>)}
          </select>
          <ChevronDown aria-hidden />
        </span>
      </h2>
      <Link href={`/trade?market=${marketId}`} className="lp-cta__go rv" style={rv(2)}>
        {c.go}
        <ArrowRight aria-hidden />
      </Link>
      <p className="lp-cta__note rv" style={rv(4)}>{c.note}</p>
    </section>
  );
}

function Footer() {
  const c = useCopy().footer;
  return (
    <footer className="lp-foot lp-wrap">
      <p>{c.what}</p>
      <nav aria-label="Aura">
        <a className="lp-link" href={REPO_URL} target="_blank" rel="noreferrer">{c.source}</a>
        {!DEMO && <a className="lp-link" href={`${EXPLORER}/address/${CONTRACT_ID}`} target="_blank" rel="noreferrer">{c.contract}</a>}
        <Link className="lp-link" href="/trade">{c.trade}</Link>
        <Link className="lp-link" href="/vault">{c.vault}</Link>
      </nav>
      <p>2026 · <a className="lp-link" href={`${REPO_URL}/blob/HEAD/LICENSE`} target="_blank" rel="noreferrer">{c.licence}</a></p>
    </footer>
  );
}
