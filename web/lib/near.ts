// Live mode: view calls over JSON-RPC and signing through NEAR Connect.
// The frontend holds no keys; every change goes through the user's wallet.

import type { NearConnector } from '@hot-labs/near-connect';
import { NETWORK, RPC_URLS } from './config.ts';
import type { Tx } from './types.ts';

export async function viewCall<T>(contractId: string, method: string, args: object = {}): Promise<T> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 'aura',
    method: 'query',
    params: {
      request_type: 'call_function',
      finality: 'final',
      account_id: contractId,
      method_name: method,
      args_base64: btoa(JSON.stringify(args)),
    },
  });
  let last: unknown;
  for (const url of RPC_URLS) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      const json = await res.json();
      if (json.error) throw new Error(json.error.data ?? json.error.message);
      if (json.result.error) throw new Error(json.result.error);
      return JSON.parse(new TextDecoder().decode(new Uint8Array(json.result.result)));
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

let connector: NearConnector | undefined;

/** Loads the connector in the browser only and reports the signed-in account, now and on every change. */
export async function initWallet(onAccount: (id: string | null) => void) {
  const { NearConnector } = await import('@hot-labs/near-connect');
  connector = new NearConnector({
    network: NETWORK,
    features: { signAndSendTransactions: true, ...(NETWORK === 'testnet' && { testnet: true }) },
  });
  connector.on('wallet:signIn', (e) => onAccount(e.accounts[0]?.accountId ?? null));
  connector.on('wallet:signOut', () => onAccount(null));
  try {
    const { accounts } = await connector.getConnectedWallet();
    onAccount(accounts[0].accountId);
  } catch {
    onAccount(null);
  }
}

export const connectWallet = async () => void (await connector?.connect());
export const disconnectWallet = async () => void (await connector?.disconnect());

type Outcome = {
  status?: { Failure?: unknown };
  transaction?: { hash?: string };
  receipts_outcome?: { outcome: { logs: string[]; status?: { Failure?: unknown } } }[];
};

/** One wallet approval for all transactions. Throws with the contract's panic message on failure. */
export async function sendTxs(txs: Tx[]): Promise<{ logs: string[]; hash?: string }> {
  if (!connector) throw new Error('Wallet is not ready');
  const wallet = await connector.wallet();
  const result: unknown = await wallet.signAndSendTransactions({
    transactions: txs.map((tx) => ({
      receiverId: tx.receiverId,
      actions: [{ type: 'FunctionCall', params: { methodName: tx.method, args: tx.args, gas: tx.gas, deposit: tx.deposit } }],
    })),
  });
  const outcomes = (Array.isArray(result) ? result : [result]) as Outcome[];
  const logs: string[] = [];
  for (const o of outcomes) {
    const receipts = o?.receipts_outcome ?? [];
    const failure = o?.status?.Failure ?? receipts.find((r) => r.outcome.status?.Failure)?.outcome.status?.Failure;
    if (failure) throw new Error(JSON.stringify(failure));
    for (const r of receipts) logs.push(...r.outcome.logs);
  }
  return { logs, hash: outcomes.at(-1)?.transaction?.hash };
}
