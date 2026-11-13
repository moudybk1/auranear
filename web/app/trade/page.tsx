'use client';

import { useState } from 'react';
import { FundsDialog, type FundsKind } from '../../components/Funds';
import { Chart } from '../../components/trade/Chart';
import { MarketBar } from '../../components/trade/MarketBar';
import { MarketInfo } from '../../components/trade/MarketInfo';
import { AccountPanel, OrderForm } from '../../components/trade/OrderForm';
import { Positions } from '../../components/trade/Positions';
import { useAura } from '../../lib/store';

export default function TradePage() {
  const { markets, positions } = useAura();
  const [marketId, setMarketId] = useState('BTC-USD');
  const [funds, setFunds] = useState<FundsKind | null>(null);
  const market = markets.find((m) => m.id === marketId);

  return (
    <main className="terminal">
      <MarketBar marketId={marketId} onSelect={setMarketId} />
      <Chart
        marketId={marketId} onMarketChange={setMarketId} oraclePrice={market?.price}
        positions={positions.filter((p) => p.market_id === marketId)}
      />
      <MarketInfo market={market} />
      <div className="order">
        <OrderForm market={market} onFund={() => setFunds('deposit')} />
        <AccountPanel onDeposit={() => setFunds('deposit')} onWithdraw={() => setFunds('withdraw')} />
      </div>
      <Positions onSelectMarket={setMarketId} />
      <FundsDialog kind={funds} onClose={() => setFunds(null)} />
    </main>
  );
}
