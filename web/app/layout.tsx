import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Shell } from '../components/Shell';
import { I18nProvider } from '../lib/i18n';
import { AuraProvider } from '../lib/store';
import './globals.css';

const funnelDisplay = localFont({
  src: [
    { path: './fonts/FunnelDisplay-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/FunnelDisplay-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/FunnelDisplay-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-funnel-display',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

const funnelSans = localFont({
  src: [
    { path: './fonts/FunnelSans-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/FunnelSans-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/FunnelSans-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/FunnelSans-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-funnel-sans',
  display: 'swap',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
});

const fragmentMono = localFont({
  src: [{ path: './fonts/FragmentMono-400.woff2', weight: '400', style: 'normal' }],
  variable: '--font-fragment-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'Menlo', 'monospace'],
});

export const metadata: Metadata = {
  title: { default: 'Aura', template: '%s · Aura' },
  description:
    'Perpetual futures on NEAR. Go long or short BTC, ETH and NEAR with up to 10x leverage against a single liquidity vault.',
};

// Applies a saved theme before first paint. Without a saved choice the tokens follow the device setting.
const themeScript = `try{var t=localStorage.getItem('aura.theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${funnelDisplay.variable} ${funnelSans.variable} ${fragmentMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <I18nProvider>
          <AuraProvider>
            <Shell>{children}</Shell>
          </AuraProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
