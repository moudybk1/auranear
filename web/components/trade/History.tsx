'use client';

// The signed-in account's trades: opens, closes and liquidations, read from the chain (lib/history.ts).

import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEMO, EXPLORER } from '../../lib/config';
import { price, signedUsd, usd } from '../../lib/format';
import { fetchFills, type Fill } from '../../lib/history';
import { useI18n } from '../../lib/i18n';
import { useAura } from '../../lib/store';
import { Badge, Delta, Skeleton } from '../ui';

const time = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const sign = (v: bigint) => (v > 0n ? 1 : v < 0n ? -1 : 0);

export function History({ hidden }: { hidden?: boolean }) {
  const { t, locale } = useI18n();
  const { accountId, positions } = useAura();
  const [state, setState] = useState<{ accountId: string; fills: Fill[] } | 'error' | null>(null);
  // A trade opens or removes a position, so the list reloads when the set of positions changes.
  const version = positions.map((p) => p.id).join(',');

  useEffect(() => {
    if (hidden || !accountId || DEMO) return;
    let live = true;
    const load = () =>
      fetchFills(accountId).then(
        (fills) => live && setState({ accountId, fills }),
        () => live && setState((s) => (s && s !== 'error' && s.accountId === accountId ? s : 'error')),
      );
    load();
    // ponytail: the index trails the chain by a few seconds, so a trade made just now is fetched once more.
    const again = setTimeout(load, 6_000);
    return () => {
      live = false;
      clearTimeout(again);
    };
  }, [hidden, accountId, version]);

  const fills = state && state !== 'error' && state.accountId === accountId ? state.fills : null;
  const message = !accountId ? t('history.connect') : DEMO ? t('history.demo') : state === 'error' && !fills ? t('history.error') : fills?.length === 0 ? t('history.empty') : null;

  return (
    <div className="positions" role="tabpanel" aria-label={t('history.title')} hidden={hidden}>
      {message ? (
        <p className="panel__empty">{message}</p>
      ) : !fills ? (
        <p className="panel__empty"><Skeleton width={220} /></p>
      ) : (
        <div className="positions__scroll">
          <table className="ptable ptable--history">
            <thead>
              <tr>
                <th scope="col">{t('positions.col.market')}</th>
                <th scope="col">{t('history.col.type')}</th>
                <th scope="col">{t('col.price')}</th>
                <th scope="col">{t('positions.col.size')}</th>
                <th scope="col">{t('history.col.fee')}</th>
                <th scope="col">{t('history.col.realized')}</th>
                <th scope="col">{t('history.col.time')}</th>
                <th scope="col"><span className="sr-only">{t('history.col.tx')}</span></th>
              </tr>
            </thead>
            <tbody>
              {fills.map((f) => (
                <tr key={`${f.hash}:${f.kind}:${f.positionId}`}>
                  <td className="is-wide">
                    <span className="ptable__market">
                      <b>{f.marketId ?? `#${f.positionId}`}</b>
                      {f.isLong !== undefined && (
                        <Badge tone={f.isLong ? 'success' : 'neutral'} dot>{t(f.isLong ? 'order.long' : 'order.short')}</Badge>
                      )}
                    </span>
                  </td>
                  <td data-label={t('history.col.type')}>
                    {f.kind === 'liquidate' ? <Badge tone="warning" dot>{t('history.liquidate')}</Badge> : t(f.kind === 'open' ? 'history.open' : 'history.close')}
                  </td>
                  <td className="num" data-label={t('col.price')}>{price(f.price, locale)}</td>
                  <td className="num" data-label={t('positions.col.size')}>{f.notional ? usd(f.notional, locale) : '—'}</td>
                  <td className="num" data-label={t('history.col.fee')}>{f.fee ? usd(f.fee, locale) : '—'}</td>
                  <td data-label={t('history.col.realized')}>
                    {f.realized === undefined ? '—' : <Delta sign={sign(f.realized)}>{signedUsd(f.realized, locale)}</Delta>}
                  </td>
                  <td className="num" data-label={t('history.col.time')}>{time.format(f.ts)}</td>
                  <td>
                    <a className="icon-btn" href={`${EXPLORER}/txns/${f.hash}`} target="_blank" rel="noreferrer" aria-label={t('history.col.tx')}>
                      <ExternalLink size={16} strokeWidth={1.75} aria-hidden />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
