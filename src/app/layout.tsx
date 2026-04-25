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
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#3b82f6' },
    { media: '(prefers-color-scheme: dark)', color: '#1e293b' },
  ],
  // Cover the iPhone notch / Dynamic Island when installed as a PWA.
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: `${APP_TITLE} - Управление свайными работами`,
  description: APP_DESCRIPTION,
  manifest: '/manifest.json',
  applicationName: APP_TITLE,
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: APP_TITLE,
  },
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
