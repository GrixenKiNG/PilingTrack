import type { Metadata } from 'next';
import { OrionHandoffSite } from '@/components/orion/orion-handoff-site';
import { orionFaqs } from '@/components/orion/orion-content';

/**
 * Базовый адрес для канонической ссылки и карточек в мессенджерах.
 *
 * Без него Next собирает `canonical` от адреса запроса, и на бою в разметку
 * уезжал бы `localhost`. Значение берётся из окружения, чтобы не зашивать
 * домен в код: `NEXT_PUBLIC_SITE_URL=https://orionpiling.ru`.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://orionpiling.ru';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'ОРИОН — свайные работы и аренда тяжёлой техники',
  description: 'Свайные работы, лидерное бурение, шпунтовые ограждения и аренда установок с экипажем. Собственный парк, ППР и цифровой контроль.',
  alternates: { canonical: '/orion' },
  openGraph: {
    title: 'ОРИОН — основания для больших проектов',
    description: 'Свайные работы полного цикла и аренда тяжёлой техники с экипажем.',
    type: 'website',
    locale: 'ru_RU',
    url: '/orion',
    siteName: 'ОРИОН',
    // Ссылку на сайт пересылают внутри заказчика — без картинки она приходит
    // голой строкой. Берём собственную схему, а НЕ фото техники: все снимки
    // установок в `public/orion/equipment` — чужие материалы без лицензии на
    // коммерческое использование (см. SOURCES.md), а карточка ссылки
    // расходится по кэшам мессенджеров и соцсетей необратимо.
    images: [{ url: '/orion/visuals/mobilization-site.webp', width: 1600, height: 900, alt: 'ОРИОН — свайные работы и аренда тяжёлой техники' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ОРИОН — основания для больших проектов',
    description: 'Свайные работы полного цикла и аренда тяжёлой техники с экипажем.',
    images: ['/orion/visuals/mobilization-site.webp'],
  },
};

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'ООО «ОРИОН»',
  url: siteUrl + '/orion',
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

const faqPageSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: orionFaqs.map(([question, answer]) => ({
    '@type': 'Question',
    name: question,
    acceptedAnswer: { '@type': 'Answer', text: answer },
  })),
};

export default function OrionPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageSchema) }} />
      <OrionHandoffSite />
    </>
  );
}
