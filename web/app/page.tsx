import type { Metadata } from 'next';
import { Landing } from '../components/Landing';

export const metadata: Metadata = { title: { absolute: 'Aura · Perpetual futures on NEAR' } };

export default function Home() {
  return <Landing />;
}
