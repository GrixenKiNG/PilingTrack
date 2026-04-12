import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/toaster';
import { ServiceWorkerRegistration } from '@/components/piling/service-worker-registration';
import { OfflineInitializer } from '@/mobile/ui-adapters/offline-initializer';
import './globals.css';

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#3b82f6',
};

export const metadata: Metadata = {
  title: 'PilingTrack - Управление свайными работами',
  description:
    'Платформа учёта и управления свайными работами: объекты, бригады, установки, отчёты и аналитика.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'PilingTrack',
  },
  icons: {
    icon: 'https://z-cdn.chatglm.cn/z-ai/static/logo.svg',
    apple: 'https://z-cdn.chatglm.cn/z-ai/static/logo.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased bg-background text-foreground`}
        style={{
          fontFamily:
            'var(--font-sans), system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif',
        }}
      >
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
