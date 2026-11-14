import { SIM_CONTRACT, SIM_TOKEN } from './sim.ts';

// All values are public (NEXT_PUBLIC_*). See .env.example.
const contract = process.env.NEXT_PUBLIC_CONTRACT_ID ?? '';

/** No contract configured: run against the in-browser simulator. */
export const DEMO = !contract || contract.includes('yourname');

export const NETWORK: 'mainnet' | 'testnet' = process.env.NEXT_PUBLIC_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
export const CONTRACT_ID = DEMO ? SIM_CONTRACT : contract;
export const USDC_ID = DEMO ? SIM_TOKEN : (process.env.NEXT_PUBLIC_USDC_ID ?? '');
/** Show the test-token faucet. ponytail: assumes the testnet token is contracts/mock-ft; add an env flag if a testnet deploy ever uses a token without `faucet`. */
export const FAUCET = !DEMO && NETWORK === 'testnet';
export const EXPLORER = NETWORK === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io';
export const RPC_URLS = (
  process.env.NEXT_PUBLIC_RPC_URL ??
  (NETWORK === 'mainnet'
    ? 'https://rpc.mainnet.fastnear.com,https://free.rpc.fastnear.com'
    : 'https://rpc.testnet.fastnear.com,https://test.rpc.fastnear.com')
).split(',');
