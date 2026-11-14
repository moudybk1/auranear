// Transaction builders (docs/FRONTEND_SPEC.md §5). Amounts are integer strings.
import { CONTRACT_ID, USDC_ID } from './config.ts';
import type { Tx } from './types.ts';

const tgas = (n: number) => `${n}${'0'.repeat(12)}`;
const ONE_YOCTO = '1';

export const activate = (storageDepositYocto: string): Tx => ({
  receiverId: CONTRACT_ID, method: 'storage_deposit', args: {}, gas: tgas(30), deposit: storageDepositYocto,
});

/** msg "deposit" credits the trading balance, "lp" mints vault shares. */
export const deposit = (amount: bigint, msg: 'deposit' | 'lp'): Tx => ({
  receiverId: USDC_ID,
  method: 'ft_transfer_call',
  args: { receiver_id: CONTRACT_ID, amount: String(amount), msg },
  gas: tgas(100),
  deposit: ONE_YOCTO,
});

/** Testnet only: 1,000 test tokens, the most contracts/mock-ft mints per call. */
export const faucet = (accountId: string): Tx => ({
  receiverId: USDC_ID, method: 'faucet', args: { account_id: accountId, amount: '1000000000' }, gas: tgas(30), deposit: '0',
});

export const openPosition = (marketId: string, isLong: boolean, collateral: bigint, leverageBps: number): Tx => ({
  receiverId: CONTRACT_ID,
  method: 'open_position',
  args: { market_id: marketId, is_long: isLong, collateral: String(collateral), leverage_bps: leverageBps },
  gas: tgas(50),
  deposit: '0',
});

export const closePosition = (positionId: string): Tx => ({
  receiverId: CONTRACT_ID, method: 'close_position', args: { position_id: positionId }, gas: tgas(50), deposit: '0',
});

export const withdraw = (amount: bigint): Tx => ({
  receiverId: CONTRACT_ID, method: 'withdraw', args: { amount: String(amount) }, gas: tgas(60), deposit: ONE_YOCTO,
});

export const lpWithdraw = (shares: bigint): Tx => ({
  receiverId: CONTRACT_ID, method: 'lp_withdraw', args: { shares: String(shares) }, gas: tgas(60), deposit: ONE_YOCTO,
});
