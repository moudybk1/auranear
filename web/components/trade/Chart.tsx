'use client';

// The chart is Vela by LuxAlgo (@luxalgo/vela, Apache-2.0): its full chart app with timeframes, chart
// styles, indicators and drawing tools. Aura adds three things: a data feed limited to its own markets,
// a theme built from the brand tokens, and a layer that draws the oracle price and the user's entry and
// liquidation levels. The library is loaded in the browser only, when the chart mounts.

import type { RendererLayerDefinition } from '@luxalgo/vela/plugin';
import type { VelaWorkspace } from '@luxalgo/vela/workspace';
import { useEffect, useRef, useState } from 'react';
import { price } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import type { PositionView } from '../../lib/types';

/** The chart draws on canvas, so it needs the resolved token values rather than var(). */
function palette() {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    raised: token('--surface-raised'),
    ink: token('--ink'),
    muted: token('--ink-muted'),
    line: token('--line'),
    aura: token('--aura'),
    up: token('--success'),
    warning: token('--warning'),
    sans: token('--font-sans'),
    mono: token('--font-mono'),
  };
}

type Level = { price: number; text: string; color: string; dash: number[] };
/** What the levels layer paints. The component replaces the list; the layer reads it every frame. */
const board: { levels: Level[]; ink: string; font: string } = { levels: [], ink: '#000', font: 'monospace' };

const levelsLayer: RendererLayerDefinition = {
  id: 'aura-levels',
  placement: 'above-data',
  create() {
    let canvas: HTMLCanvasElement | null = null;
    return {
      mount(el) {
        canvas = el;
      },
      render({ coords, scale, bounds }) {
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(coords.dpr, 0, 0, coords.dpr, 0, 0);
        ctx.font = `11px ${board.font}`;
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 1;
        for (const level of board.levels) {
          const y = Math.round(coords.priceToY(level.price, scale, bounds)) + 0.5;
          if (y < bounds.top || y > bounds.top + bounds.height) continue;
          ctx.strokeStyle = level.color;
          ctx.setLineDash(level.dash);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(coords.width, y);
          ctx.stroke();
          // Label chip at the right edge of the plot, next to the price axis.
          const width = ctx.measureText(level.text).width + 12;
          ctx.setLineDash([]);
          ctx.fillStyle = level.color;
          ctx.beginPath();
          ctx.roundRect(coords.width - width - 4, y - 9, width, 18, 4);
          ctx.fill();
          ctx.fillStyle = board.ink;
          ctx.fillText(level.text, coords.width - width + 2, y);
        }
      },
    };
  },
};

// Saved chart state keeps the user's timeframe, chart style, indicators and drawings. Colours are dropped on
// the way back in: they always come from the Aura theme, so a chart saved in one theme never returns wearing
// the other. The market is replaced with the page's, because the page's market tabs decide it. It must be
// replaced, not removed: Vela 0.10.6 looks up a restored chart without a symbol as "" and shows
// `No registered provider serves ""`.
// ponytail: this also forgets cosmetic tweaks made in Vela's settings dialog; keep `rendererConfig` minus its colours if users miss them.
const chartStorage = (marketId: string) => ({
  get(key: string) {
    try {
      const doc = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (!doc) return null;
      for (const chart of doc.charts ?? []) {
        delete chart.rendererConfig;
        chart.symbol = marketId;
      }
      return JSON.stringify(doc);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
});

/** "binance:BTC-USD" or "btc-usd" to "BTC-USD". */
const marketOf = (symbol: string | undefined) => (symbol ?? '').split(':').pop()!.toUpperCase();

type Props = {
  marketId: string;
  onMarketChange: (id: string) => void;
  oraclePrice?: string;
  positions: PositionView[];
};

export function Chart({ marketId, onMarketChange, oraclePrice, positions }: Props) {
  const { t, locale } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<VelaWorkspace | null>(null);
  const [mounted, setMounted] = useState(0);
  const [theme, setTheme] = useState(0);
  const latest = useRef({ marketId, onMarketChange, locale });
  latest.current = { marketId, onMarketChange, locale };

  useEffect(() => {
    let cancelled = false;
    const cleanup: (() => void)[] = [];

    (async () => {
      const [{ VelaWorkspace }, { createTheme }, { registerLocale, registerRendererLayer }, { auraFeed }, indonesian] =
        await Promise.all([
          import('@luxalgo/vela/workspace'),
          import('@luxalgo/vela'),
          import('@luxalgo/vela/plugin'),
          import('../../lib/chartfeed'),
          import('@luxalgo/vela/locales/id'),
        ]);
      if (cancelled || !host.current) return;

      registerLocale(indonesian.default);
      registerRendererLayer(levelsLayer);

      // Long and up are teal, short and down are neutral: red stays the brand colour, never "loss".
      const auraTheme = () => {
        const p = palette();
        return createTheme({
          colors: { background: p.raised, text: p.ink, grid: p.line, border: p.line, up: p.up, down: p.ink, accent: p.aura },
          font: p.sans,
          radius: 'md',
        });
      };

      const ws = new VelaWorkspace(host.current, {
        layout: false,
        symbol: latest.current.marketId,
        timeframe: '15',
        live: true,
        providers: { binance: () => auraFeed }, // the key is the venue label the chart shows beside the symbol
        theme: auraTheme(),
        locale: latest.current.locale,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        persist: 'aura.chart',
        storage: chartStorage(latest.current.marketId),
        watermark: false,
      });
      workspace.current = ws;
      cleanup.push(() => {
        workspace.current = null;
        ws.destroy();
      });

      // The page's market tabs and the chart's own symbol search stay in step, both ways.
      cleanup.push(
        ws.chart.on('market:changed', ({ symbol }) => {
          const id = marketOf(symbol);
          if (id !== latest.current.marketId) latest.current.onMarketChange(id);
        }),
      );

      // Vela's volume bars default to green and red. Recolour them like the candles, and only if the
      // user still has the volume indicator on the chart.
      const paintVolume = () => {
        if (!ws.chart.presentNativeIndicators().includes('volume')) return;
        const p = palette();
        ws.chart.addNativeIndicator('volume').setInputs({ upColor: p.up, downColor: p.muted }); // returns the existing one
      };
      paintVolume();
      cleanup.push(ws.chart.on('indicator:added', paintVolume));

      const retheme = () => {
        ws.setTheme(auraTheme());
        // Vela 0.10.6 moves the candle colours on a theme switch but does not refresh the status line's
        // O/H/L/C ink (it re-reads them only when the renderer config changes). Re-applying the config
        // fires that change; without it the values keep the old theme's colour, near-invisible on the new one.
        const config = ws.chart.renderer.getConfig();
        if (config) ws.chart.renderer.applyConfig(config);
        paintVolume();
        setTheme((n) => n + 1);
      };
      const device = matchMedia('(prefers-color-scheme: dark)');
      window.addEventListener('aura:theme', retheme);
      device.addEventListener('change', retheme);
      cleanup.push(() => {
        window.removeEventListener('aura:theme', retheme);
        device.removeEventListener('change', retheme);
      });

      setMounted((n) => n + 1);
    })();

    return () => {
      cancelled = true;
      for (const fn of cleanup) fn();
    };
  }, []);

  useEffect(() => {
    const chart = workspace.current?.chart;
    if (chart && marketOf(chart.market.symbol) !== marketId) void chart.setMarket({ symbol: marketId });
  }, [marketId, mounted]);

  useEffect(() => {
    workspace.current?.setLocale(locale);
  }, [locale, mounted]);

  // Oracle price plus entry and liquidation levels of the user's positions in this market.
  const levelsKey = positions.map((p) => `${p.id}:${p.liquidation_price}`).join(',');
  useEffect(() => {
    const p = palette();
    const list: Level[] = [];
    const add = (value: string | undefined, label: string, color: string, dash: number[]) => {
      if (!value || value === '0') return;
      list.push({ price: Number(value) / 1e6, text: `${label} ${price(value, locale)}`, color, dash });
    };
    add(oraclePrice, t('chart.oracle'), p.ink, [5, 4]);
    for (const pos of positions) {
      add(pos.entry_price, `${t('chart.entry')} ${t(pos.is_long ? 'order.long' : 'order.short')}`, p.muted, [2, 3]);
      add(pos.liquidation_price, t('chart.liq'), p.warning, []);
    }
    board.levels = list;
    board.ink = p.raised;
    board.font = p.mono;
    workspace.current?.chart.resize(); // repaint the layer with the new levels
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oraclePrice, levelsKey, locale, t, mounted, theme]);

  return (
    <section className="panel chart" aria-label={t('chart.label')}>
      <div className="chart__canvas" ref={host} />
    </section>
  );
}
