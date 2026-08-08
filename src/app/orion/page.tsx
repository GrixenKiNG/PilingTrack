import type { Metadata } from 'next';
import { OrionHandoffSite } from '@/components/orion/orion-handoff-site';

export const metadata: Metadata = {
  title: 'ОРИОН — свайные работы и аренда тяжёлой техники',
  description: 'Свайные работы, лидерное бурение, шпунтовые ограждения и аренда установок с экипажем. Собственный парк, ППР и цифровой контроль.',
  alternates: { canonical: '/orion' },
  openGraph: {
    title: 'ОРИОН — основания для больших проектов',
    description: 'Свайные работы полного цикла и аренда тяжёлой техники с экипажем.',
    type: 'website',
    locale: 'ru_RU',
  },
};

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'ООО «ОРИОН»',
  url: '/orion',
  email: 'orion02@bk.ru',
  telephone: '+7 961 346-45-14',
  address: {
    '@type': 'PostalAddress',
    postalCode: '428003',
    addressRegion: 'Чувашская Республика',
    addressLocality: 'Чебоксары',
    streetAddress: 'Школьный проезд, д. 1, оф. 412',
    addressCountry: 'RU',
  },
};

export default function OrionPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
      <OrionHandoffSite />
    </>
  );
}
