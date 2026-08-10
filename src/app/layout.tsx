import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
// Sonner, not the Radix toaster: every toast.* call in the app goes through
// sonner, and without its <Toaster/> mounted they all silently no-op (login
// errors and report-submit errors were invisible to users).
import { Toaster } from 'sonner';
import './globals.css';

// Force every HTML route to be rendered per request so the proxy can
// inject a fresh CSP nonce. Without this, client-component pages (login,
// admin, operator) get prerendered at build time with no nonce attribute
// on their <script> tags — the runtime proxy then sends a strict CSP
// that blocks every one of those tags, yielding a blank screen on first
// load (most visible on mobile where Ctrl+Shift+R isn't an option).
export const dynamic = 'force-dynamic';

/**
 * Шрифты продукта. До 2026-08-09 `globals.css` объявлял `Inter` и
 * `JetBrains Mono`, но НИ ОДИН шрифт не загружался: ни next/font, ни
 * @font-face, ни ссылки на Google Fonts. Замер это подтвердил — строка
 * рисовалась шириной Segoe UI (781px), а не Inter (731px). То есть шрифт
 * был «что найдётся в системе»: Segoe UI у диспетчера, Roboto у оператора
 * на Android, SF на iPhone.
 *
 * next/font скачивает файлы на этапе сборки и раздаёт их со своего домена —
 * в рантайме обращений к Google нет, поэтому CSP и приватность не страдают.
 * Подмножество `cyrillic` обязательно: без него кириллица уедет в fallback,
 * и мы вернёмся к той же разнице между устройствами.
 */
const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-jetbrains',
  display: 'swap',
});

const APP_TITLE = 'PilingTrack';
const APP_DESCRIPTION =
  'Платформа учёта и управления свайными работами: объекты, бригады, установки, отчёты и аналитика.';

const DEV_PERFORMANCE_MEASURE_GUARD = `
(() => {
  if (window.__ptPerformanceMeasureGuard) return;
  window.__ptPerformanceMeasureGuard = true;
  const originalMeasure = performance.measure.bind(performance);
  performance.measure = (name, startOrOptions, endMark) => {
    if (
      startOrOptions &&
      typeof startOrOptions === 'object' &&
      typeof startOrOptions.start === 'number' &&
      typeof startOrOptions.end === 'number' &&
      startOrOptions.end < startOrOptions.start
    ) {
      return originalMeasure(name, { ...startOrOptions, end: startOrOptions.start });
    }
    return originalMeasure(name, startOrOptions, endMark);
  };
})();
`;

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  // Бренд-оранжевый `--signal` (oklch(0.55 0.18 48)) в hex — им красится строка
  // браузера и системная обвязка PWA на телефоне оператора. Раньше стоял синий
  // #3b82f6, не принадлежащий палитре продукта, плюс отдельный цвет для тёмной
  // схемы, которой у продукта нет с 2026-08-09. Один цвет на все схемы.
  themeColor: '#c04300',
  // Cover the iPhone notch / Dynamic Island when installed as a PWA.
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: `${APP_TITLE} - Управление свайными работами`,
  description: APP_DESCRIPTION,
  applicationName: APP_TITLE,
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      { url: '/icons/icon-152.png', sizes: '152x152', type: 'image/png' },
      { url: '/icons/icon-167.png', sizes: '167x167', type: 'image/png' },
    ],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === 'development' && (
          <script
            dangerouslySetInnerHTML={{ __html: DEV_PERFORMANCE_MEASURE_GUARD }}
          />
        )}
      </head>
      <body className="font-sans antialiased bg-background text-foreground">
        {children}
        <Toaster richColors position="top-center" closeButton />
      </body>
    </html>
  );
}
