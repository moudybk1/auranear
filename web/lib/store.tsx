'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CONTRACT_ID, DEMO, USDC_ID } from './config.ts';
import { errorKey, refundKey } from './errors.ts';
import { useI18n } from './i18n.tsx';
import { toBase } from './math.ts';
import * as near from './near.ts';
import { fetchTickers, type Ticker } from './prices.ts';
import { SIM_ACCOUNT, Sim } from './sim.ts';
import type { AccountView, ConfigView, MarketView, PositionView, Tx, VaultView } from './types.ts';

const POLL_MS = 5_000;
const CONFIG_MS = 60_000;
const SIM_KEY = 'aura.sim.v1';
const DEMO_SESSION = 'aura.demo.connected';
// Only used when the reference feed is unreachable on the very first load of demo mode (12 Nov 2026 levels).
const FALLBACK_PRICES = { 'BTC-USD': 72_900_000_000n, 'ETH-USD': 2_020_000_000n, 'NEAR-USD': 3_400_000n };

export type Toast = {
  id: number;
  tone: 'info' | 'success' | 'warning' | 'danger';
  title: string;
  body?: string;
  hash?: string;
};

type Data = {
  config?: ConfigView;
  markets: MarketView[];
  vault?: VaultView;
  /** undefined = not loaded, null = wallet connected but not registered on the contract. */
  account?: AccountView | null;
  positions: PositionView[];
  walletUsdc?: string;
  /** Direction of each market's last oracle price move seen in this tab. */
  priceDir: Record<string, 'up' | 'down'>;
};

type Store = Data & {
  accountId: string | null;
  tickers: Record<string, Ticker>;
  /** The last refresh failed; values on screen may be old. */
  offline: boolean;
  /** A transaction is with the wallet. */
  pending: boolean;
  toasts: Toast[];
  /** Live mode: the wallet picker is open. */
  picker: boolean;
  /** Live mode: the name of the wallet that is signing the user in. */
  connecting: string | null;
  /** Demo mode connects the test account; live mode opens the wallet picker. */
  connect: () => void;
  connectWith: (wallet: near.WalletInfo) => void;
  closePicker: () => void;
  disconnect: () => void;
  resetDemo: () => void;
  /** Sends transactions in one wallet approval. Resolves true when they were accepted. */
  send: (txs: Tx[], okTitle: string, closesPosition?: string) => Promise<boolean>;
  dismiss: (id: number) => void;
};

const Ctx = createContext<Store>(null!);
export const useAura = () => useContext(Ctx);

let sim: Sim | undefined;
function getSim() {
  if (!sim) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(SIM_KEY);
    } catch {}
    try {
      sim = new Sim(Date.now, saved);
    } catch {
      sim = new Sim();
    }
  }
  return sim;
}
function saveSim() {
  try {
    localStorage.setItem(SIM_KEY, getSim().serialize());
  } catch {}
}

function view<T>(contractId: string, method: string, args: Record<string, string> = {}): Promise<T> {
  return DEMO ? Promise.resolve(getSim().view(method, args) as T) : near.viewCall<T>(contractId, method, args);
}

export function AuraProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [data, setData] = useState<Data>({ markets: [], positions: [], priceDir: {} });
  const [tickers, setTickers] = useState<Record<string, Ticker>>({});
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [picker, setPicker] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);

  const account = useRef<string | null>(null);
  const seenPositions = useRef<Set<string> | null>(null);
  const closing = useRef(new Set<string>());
  const configAt = useRef(0);
  const toastId = useRef(0);
  const tRef = useRef(t);
  tRef.current = t;

  const notify = useCallback((toast: Omit<Toast, 'id'>) => {
    setToasts((list) => [...list.slice(-3), { ...toast, id: ++toastId.current }]);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((x) => x.id !== id)), []);

  const refresh = useCallback(async () => {
    const id = account.current;
    const fresh = await fetchTickers().catch(() => null);
    if (fresh) setTickers(fresh);
    try {
      if (DEMO) {
        // The demo oracle: push the reference price, or hold the last one if the feed is down.
        const s = getSim();
        const held = s.prices();
        s.pushPrices(
          fresh
            ? Object.fromEntries(Object.entries(fresh).map(([m, x]) => [m, toBase(x.last) ?? 0n]))
            : Object.values(held).every((p) => p > 0n) ? held : FALLBACK_PRICES,
        );
        saveSim();
      }
      const wantConfig = Date.now() - configAt.current > CONFIG_MS;
      const [config, markets, vault, acc, positions, walletUsdc] = await Promise.all([
        wantConfig ? view<ConfigView>(CONTRACT_ID, 'get_config') : undefined,
        view<MarketView[]>(CONTRACT_ID, 'get_markets'),
        view<VaultView>(CONTRACT_ID, 'get_vault'),
        id ? view<AccountView | null>(CONTRACT_ID, 'get_account', { account_id: id }) : undefined,
        id ? view<PositionView[]>(CONTRACT_ID, 'get_positions_of', { account_id: id }) : [],
        id ? view<string>(USDC_ID, 'ft_balance_of', { account_id: id }) : undefined,
      ]);
      if (id !== account.current) return; // the wallet changed while this was in flight
      if (config) configAt.current = Date.now();

      // A position that vanished without the user closing it was liquidated.
      const ids = new Set(positions.map((p) => p.id));
      for (const old of seenPositions.current ?? []) {
        if (!ids.has(old) && !closing.current.delete(old)) {
          notify({ tone: 'info', title: tRef.current('liquidated.title'), body: tRef.current('liquidated.body') });
        }
      }
      seenPositions.current = id ? ids : null;

      setData((d) => {
        const priceDir = { ...d.priceDir };
        for (const m of markets) {
          const prev = d.markets.find((x) => x.id === m.id)?.price;
          if (prev && prev !== '0' && m.price !== '0' && prev !== m.price) priceDir[m.id] = BigInt(m.price) > BigInt(prev) ? 'up' : 'down';
        }
        return { config: config ?? d.config, markets, vault, account: acc, positions, walletUsdc, priceDir };
      });
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [notify]);

  useEffect(() => {
    account.current = accountId;
    seenPositions.current = null;
    setData((d) => ({ ...d, account: undefined, positions: [], walletUsdc: undefined }));
    refresh();
    const timer = setInterval(() => !document.hidden && refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [accountId, refresh]);

  useEffect(() => {
    if (!DEMO) {
      near.initWallet(setAccountId);
      return;
    }
    try {
      if (sessionStorage.getItem(DEMO_SESSION)) setAccountId(SIM_ACCOUNT);
    } catch {}
  }, []);

  const connect = useCallback(() => {
    if (!DEMO) return setPicker(true);
    getSim().faucet(SIM_ACCOUNT);
    saveSim();
    try {
      sessionStorage.setItem(DEMO_SESSION, '1');
    } catch {}
    setAccountId(SIM_ACCOUNT);
  }, []);

  const closePicker = useCallback(() => setPicker(false), []);

  const connectWith = useCallback(
    async (wallet: near.WalletInfo) => {
      // The picker closes first: a wallet draws its sign-in window in the page, and a modal dialog would cover it.
      setPicker(false);
      setConnecting(wallet.name);
      try {
        await near.connectWallet(wallet.id);
        notify({ tone: 'success', title: tRef.current('wallet.connected', { wallet: wallet.name }) });
      } catch {
        notify({ tone: 'warning', title: tRef.current('wallet.failed.title'), body: tRef.current('wallet.failed.body', { wallet: wallet.name }) });
      } finally {
        setConnecting(null);
      }
    },
    [notify],
  );

  const disconnect = useCallback(() => {
    if (!DEMO) return void near.disconnectWallet().catch(() => {});
    try {
      sessionStorage.removeItem(DEMO_SESSION);
    } catch {}
    setAccountId(null);
  }, []);

  const resetDemo = useCallback(() => {
    try {
      localStorage.removeItem(SIM_KEY);
      sessionStorage.removeItem(DEMO_SESSION);
    } catch {}
    location.reload();
  }, []);

  const send = useCallback(
    async (txs: Tx[], okTitle: string, closesPosition?: string) => {
      const id = account.current;
      if (!id) return false;
      setPending(true);
      if (closesPosition) closing.current.add(closesPosition);
      try {
        let result: { logs: string[]; hash?: string };
        if (DEMO) {
          await new Promise((r) => setTimeout(r, 600)); // stands in for the wallet approval
          const s = getSim();
          result = { logs: txs.flatMap((tx) => s.call(id, tx.receiverId, tx.method, tx.args)) };
          saveSim();
        } else {
          result = await near.sendTxs(txs);
        }
        // A rejected deposit is refunded by the contract rather than failing the transaction.
        const refund = result.logs.find((l) => l.startsWith('Refunding deposit:'));
        notify(
          refund
            ? { tone: 'warning', title: tRef.current('tx.refunded.title'), body: tRef.current(refundKey(refund)) }
            : { tone: 'success', title: okTitle, hash: result.hash },
        );
        await refresh();
        return !refund;
      } catch (e) {
        if (closesPosition) closing.current.delete(closesPosition);
        notify({ tone: 'danger', title: tRef.current('tx.failed'), body: tRef.current(errorKey(e)) });
        await refresh();
        return false;
      } finally {
        setPending(false);
      }
    },
    [notify, refresh],
  );

  const store = useMemo<Store>(
    () => ({
      ...data, accountId, tickers, offline, pending, toasts, picker, connecting,
      connect, connectWith, closePicker, disconnect, resetDemo, send, dismiss,
    }),
    [data, accountId, tickers, offline, pending, toasts, picker, connecting, connect, connectWith, closePicker, disconnect, resetDemo, send, dismiss],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
