import type { Metadata } from 'next';
import { OrionSite } from '@/components/orion/orion-site';

export const metadata: Metadata = {
  title: 'ОРИОН — свайные работы и аренда техники',
  description: 'Инженерная оценка свайных работ, лидерное бурение и аренда установок с экипажем.',
};

export default function OrionPage() {
  return <OrionSite />;
}
