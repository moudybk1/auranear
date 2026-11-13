'use client';

import { useState } from 'react';
import { leverage, num, price, signedPct, signedUsd, usd } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { atRisk, bpsOf } from '../../lib/math';
import { useAura } from '../../lib/store';
import { closePosition } from '../../lib/tx';
import type { PositionView } from '../../lib/types';
import { Badge, Button, Delta, Dialog, Row, Unit, cx } from '../ui';

const sign = (v: bigint) => (v > 0n ? 1 : v < 0n ? -1 : 0);
/** Funding from the trader's side: received is positive, paid is negative. Small amounts keep four decimals. */
const fundingText = (owed: string, locale: 'en' | 'id') => {
  const v = -BigInt(owed);
  return signedUsd(v, locale, v > -10_000n && v < 10_000n ? 4 : 2);
};

export function Positions({ onSelectMarket }: { onSelectMarket: (id: string) => void }) {
  const { t, locale } = useI18n();
  const { accountId, positions, markets } = useAura();
  const [closing, setClosing] = useState<string | null>(null);
  const target = positions.find((p) => p.id === closing);

  return (
    <section className="panel positions">
      <div className="panel__head">
        <h2 className="panel__title">{t('positions.title')}</h2>
        {positions.length > 0 && <Badge>{positions.length}</Badge>}
      </div>
      {positions.length === 0 ? (
        <p className="panel__empty">{t(accountId ? 'positions.empty' : 'positions.connect')}</p>
      ) : (
        <div className="positions__scroll">
          <table className="ptable" aria-live="off">
            <thead>
              <tr>
                <th scope="col">{t('positions.col.market')}</th>
                <th scope="col">{t('positions.col.size')}</th>
                <th scope="col">{t('positions.col.collateral')}</th>
                <th scope="col">{t('positions.col.entry')}</th>
                <th scope="col">{t('positions.col.mark')}</th>
                <th scope="col">{t('positions.col.pnl')}</th>
                <th scope="col">{t('positions.col.funding')}</th>
                <th scope="col">{t('positions.col.liq')}</th>
                <th scope="col"><span className="sr-only">{t('positions.close')}</span></th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const pnl = BigInt(p.pnl);
                const collateral = BigInt(p.collateral);
                const stale = markets.find((m) => m.id === p.market_id)?.is_fresh === false;
                const why = p.liquidatable ? t('positions.close.liquidatable') : stale ? t('reason.stale') : undefined;
                return (
                  <tr key={p.id}>
                    <td className="is-wide">
                      <span className="ptable__market">
                        <button type="button" onClick={() => onSelectMarket(p.market_id)}>{p.market_id}</button>
                        <Badge tone={p.is_long ? 'success' : 'neutral'} dot>
                          {t(p.is_long ? 'order.long' : 'order.short')} {leverage(Number((BigInt(p.notional) * 10_000n) / collateral), locale)}
                        </Badge>
                        {atRisk(BigInt(p.equity), BigInt(p.maintenance_margin)) && <Badge tone="warning" dot>{t('positions.atRisk')}</Badge>}
                      </span>
                    </td>
                    <td className="num" data-label={t('positions.col.size')}>{usd(p.notional, locale)}</td>
                    <td className="num" data-label={t('positions.col.collateral')}>{usd(p.collateral, locale)}</td>
                    <td className="num" data-label={t('positions.col.entry')}>{price(p.entry_price, locale)}</td>
                    <td className="num" data-label={t('positions.col.mark')}>{price(p.mark_price, locale)}</td>
                    <td data-label={t('positions.col.pnl')}>
                      <span>
                        <Delta sign={sign(pnl)}>{signedUsd(pnl, locale)}</Delta>
                        <span className="ptable__sub num">{signedPct(Number((pnl * 10_000n) / collateral) / 100, locale)}</span>
                      </span>
                    </td>
                    <td className={cx('num', sign(-BigInt(p.funding_owed)) > 0 ? 'up' : 'down')} data-label={t('positions.col.funding')}>
                      {fundingText(p.funding_owed, locale)}
                    </td>
                    <td className="num" data-label={t('positions.col.liq')}>{p.liquidation_price === '0' ? '—' : price(p.liquidation_price, locale)}</td>
                    <td className="is-wide">
                      <Button variant="secondary" size="sm" disabled={!!why} title={why} onClick={() => setClosing(p.id)}>
                        {t('positions.close.short')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={!!target} onClose={() => setClosing(null)} title={t('positions.close')} closeLabel={t('dialog.close')}>
        {target && <CloseForm position={target} onClose={() => setClosing(null)} />}
      </Dialog>
    </section>
  );
}

function CloseForm({ position: p, onClose }: { position: PositionView; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { markets, pending, send } = useAura();
  const feeBps = markets.find((m) => m.id === p.market_id)?.config.fee_bps ?? 0;
  const fee = bpsOf(BigInt(p.notional), feeBps);
  const payout = BigInt(p.equity) - fee;
  const receive = usd(payout > 0n ? payout : 0n, locale);

  return (
    <>
      <dl className="kv">
        <Row label={`${p.market_id} · ${t(p.is_long ? 'order.long' : 'order.short')}`}>{usd(p.notional, locale)}<Unit /></Row>
        <Row label={t('positions.col.pnl')}>{signedUsd(p.pnl, locale)}<Unit /></Row>
        <Row label={t('positions.col.funding')}>{fundingText(p.funding_owed, locale)}<Unit /></Row>
        <Row label={t('positions.close.fee')}>{signedUsd(-fee, locale)}<Unit /></Row>
        <Row label={t('positions.close.receive')}>{receive}<Unit /></Row>
      </dl>
      <p className="dlg__text">{t('positions.close.confirm', { amount: receive, pct: num(feeBps / 100, locale, 1) })}</p>
      <div className="dlg__foot">
        <Button variant="ghost" onClick={onClose}>{t('dialog.cancel')}</Button>
        <Button
          variant="danger" loading={pending}
          onClick={async () => {
            if (await send([closePosition(p.id)], t('tx.ok.close'), p.id)) onClose();
          }}
        >
          {pending ? t('tx.pending') : t('positions.close')}
        </Button>
      </div>
    </>
  );
}
