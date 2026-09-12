import type { MetadataRoute } from 'next';

/**
 * Карта сайта — только публичные страницы.
 *
 * Всё приложение (`/admin`, `/operator`, `/report`, `/api`) закрыто входом и в
 * карту не попадает: индексировать страницы, отвечающие переадресацией на
 * логин, — значит показывать поиску пустоту и раскрывать структуру системы.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://orionpiling.ru';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${siteUrl}/orion`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1,
    },
  ];
}
