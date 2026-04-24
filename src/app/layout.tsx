import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/toaster';
import { ServiceWorkerRegistration } from '@/components/piling/service-worker-registration';
import { OfflineInitializer } from '@/mobile/ui-adapters/offline-initializer';
import './globals.css';

const APP_TITLE = 'PilingTrack';
const APP_DESCRIPTION =
  'Платформа учёта и управления свайными работами: объекты, бригады, установки, отчёты и аналитика.';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#3b82f6',
};

export const metadata: Metadata = {
  title: `${APP_TITLE} - Управление свайными работами`,
  description: APP_DESCRIPTION,
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: APP_TITLE,
  },
  icons: {
    icon: '/icon-192.svg',
    apple: '/icon-192.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="font-sans antialiased bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <ServiceWorkerRegistration />
          <OfflineInitializer />
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
