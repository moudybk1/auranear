import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // ponytail: no Content-Security-Policy yet. It needs an allow-list of the RPC, chart-data and wallet hosts,
  // and a wrong one breaks wallet signing; add it once those hosts are listed and each wallet is retested.
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' }, // nobody may frame a page that asks a wallet to sign
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
  ],
};

export default config;
