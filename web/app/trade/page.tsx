'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FundsDialog, type FundsKind } from '../../components/Funds';
import { Chart } from '../../components/trade/Chart';
import { MarketBar } from '../../components/trade/MarketBar';
import { MarketInfo } from '../../components/trade/MarketInfo';
import { AccountPanel, OrderForm } from '../../components/trade/OrderForm';
import { OrderBook } from '../../components/trade/OrderBook';
import { History } from '../../components/trade/History';
import { Positions } from '../../components/trade/Positions';
import { Badge, Segmented } from '../../components/ui';
import { useI18n } from '../../lib/i18n';
import { useAura } from '../../lib/store';

// From this width the order book is its own column (styles/app.css); below it, a dock tab.
const WIDE = '(min-width: 1280px)';
const onWidth = (cb: () => void) => {
  const m = matchMedia(WIDE);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};

export default function TradePage() {
  const { t } = useI18n();
  const { markets, positions } = useAura();
  const [marketId, setMarketId] = useState('BTC-USD');
  const [funds, setFunds] = useState<FundsKind | null>(null);
  const [picked, setTab] = useState<'positions' | 'history' | 'market' | 'book'>('positions');
  const wide = useSyncExternalStore(onWidth, () => matchMedia(WIDE).matches, () => false);
  const tab = wide && picked === 'book' ? 'positions' : picked;
  const market = markets.find((m) => m.id === marketId);

  // /trade?market=ETH-USD (the landing page links this way) opens on that market, once the markets are known.
  const fromUrl = useRef(false);
  useEffect(() => {
    if (fromUrl.current || markets.length === 0) return;
    fromUrl.current = true;
    const wanted = new URLSearchParams(location.search).get('market');
    if (markets.some((m) => m.id === wanted)) setMarketId(wanted!);
  }, [markets]);

  return (
    <main className="terminal">
      <MarketBar marketId={marketId} onSelect={setMarketId} />
      <Chart
        marketId={marketId} onMarketChange={setMarketId}
        positions={positions.filter((p) => p.market_id === marketId)}
      />
      {wide && (
        <section className="panel bookcol" aria-labelledby="book-title">
          <div className="panel__head"><h2 id="book-title" className="panel__title">{t('book.title')}</h2></div>
          <OrderBook marketId={marketId} oraclePrice={market?.price} />
        </section>
      )}
      <div className="order">
        <OrderForm market={market} onFund={() => setFunds('deposit')} />
        <AccountPanel onDeposit={() => setFunds('deposit')} onWithdraw={() => setFunds('withdraw')} />
      </div>
      {/* Both panels stay mounted, so a tab switch keeps their state. */}
      <section className="panel dock">
        <Segmented
          className="dock__tabs" itemClassName="dock__tab" label={t('dock.label')} value={tab} onChange={setTab}
          options={[
            { value: 'positions', label: <>{t('positions.title')}{positions.length > 0 && <Badge>{positions.length}</Badge>}</> },
            { value: 'history', label: t('history.title') },
            { value: 'market', label: <>{t('info.title')}<span className="muted">{marketId}</span></> },
            ...(wide ? [] : [{ value: 'book' as const, label: t('book.title') }]),
          ]}
        />
        <Positions hidden={tab !== 'positions'} onSelectMarket={setMarketId} />
        <History hidden={tab !== 'history'} />
        <MarketInfo hidden={tab !== 'market'} market={market} />
        {!wide && <OrderBook asTab hidden={tab !== 'book'} marketId={marketId} oraclePrice={market?.price} />}
      </section>
      <FundsDialog kind={funds} onClose={() => setFunds(null)} />
    </main>
  );
}
