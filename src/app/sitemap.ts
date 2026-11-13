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
    '/',
    '/orion/site/fleet.html',
    '/orion/site/objects.html',
    '/orion/site/project-m12.html',
    '/orion/site/project-school-university.html',
    '/orion/site/project-microdistrict.html',
    '/orion/site/shift-report.html',
  ].map((pathname) => ({ url: new URL(pathname, siteUrl).href }));
}
