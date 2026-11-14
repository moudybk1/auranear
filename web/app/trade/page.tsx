'use client';

import { useState } from 'react';
import { FundsDialog, type FundsKind } from '../../components/Funds';
import { Chart } from '../../components/trade/Chart';
import { MarketBar } from '../../components/trade/MarketBar';
import { MarketInfo } from '../../components/trade/MarketInfo';
import { AccountPanel, OrderForm } from '../../components/trade/OrderForm';
import { Positions } from '../../components/trade/Positions';
import { Badge, Segmented } from '../../components/ui';
import { useI18n } from '../../lib/i18n';
import { useAura } from '../../lib/store';

export default function TradePage() {
  const { t } = useI18n();
  const { markets, positions } = useAura();
  const [marketId, setMarketId] = useState('BTC-USD');
  const [funds, setFunds] = useState<FundsKind | null>(null);
  const [tab, setTab] = useState<'positions' | 'market'>('positions');
  const market = markets.find((m) => m.id === marketId);

  return (
    <main className="terminal">
      <MarketBar marketId={marketId} onSelect={setMarketId} />
      <Chart
        marketId={marketId} onMarketChange={setMarketId} oraclePrice={market?.price}
        positions={positions.filter((p) => p.market_id === marketId)}
      />
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
            { value: 'market', label: <>{t('info.title')}<span className="muted">{marketId}</span></> },
          ]}
        />
        <Positions hidden={tab !== 'positions'} onSelectMarket={setMarketId} />
        <MarketInfo hidden={tab !== 'market'} market={market} />
      </section>
      <FundsDialog kind={funds} onClose={() => setFunds(null)} />
    </main>
  );
}
