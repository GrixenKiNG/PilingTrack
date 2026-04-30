'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { HardHat, LogOut, Menu } from 'lucide-react';
import { usePilingStore } from '@/lib/store';
import { AppErrorBoundary } from '@/components/piling/app-error-boundary';
import { FeedbackCenter } from '@/components/piling/feedback-center';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { logoutClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/lib/types';

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

const roleNavigation: Record<UserRole, { label: string; href: string }[]> = {
  OPERATOR: [
    { label: 'Главная', href: '/operator' },
    { label: 'Отчёт', href: '/report' },
    { label: 'История', href: '/history' },
  ],
  ASSISTANT: [
    { label: 'Главная', href: '/operator' },
    { label: 'Отчёт', href: '/report' },
    { label: 'История', href: '/history' },
  ],
  ADMIN: [
    { label: 'Дашборд', href: '/admin' },
    { label: 'Объекты', href: '/admin/sites' },
    { label: 'Установки', href: '/admin/equipment' },
    { label: 'Бригады', href: '/admin/crews' },
    { label: 'Отчёты', href: '/admin/reports' },
    { label: 'Справочники', href: '/admin/dictionaries' },
    { label: 'Пользователи', href: '/admin/users' },
    { label: 'Telegram', href: '/admin/telegram' },
  ],
  DISPATCHER: [
    { label: 'Дашборд', href: '/admin' },
    { label: 'Объекты', href: '/admin/sites' },
    { label: 'Установки', href: '/admin/equipment' },
    { label: 'Бригады', href: '/admin/crews' },
    { label: 'Отчёты', href: '/admin/reports' },
    { label: 'Справочники', href: '/admin/dictionaries' },
  ],
};

function isActivePath(currentPath: string, href: string): boolean {
  if (href === '/admin') {
    return currentPath === '/admin' || currentPath.startsWith('/admin?');
  }
  if (href === '/operator') {
    return currentPath === '/operator' || currentPath.startsWith('/operator?');
  }
  return currentPath === href || currentPath.startsWith(href + '/') || currentPath.startsWith(href + '?');
}

function OperatorLayout({ children }: { children: React.ReactNode }) {
  const user = usePilingStore((s) => s.currentUser);
  const pathname = usePathname();
  const navItems = roleNavigation[user?.role || 'OPERATOR'];

  const nav = (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-card/95 backdrop-blur-sm border-t safe-area-bottom">
      <div className="flex items-center justify-around py-2 px-2">
        {navItems.map((item) => {
          const isActive = isActivePath(pathname, item.href);

          return (
            <a
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-all min-w-[64px] no-underline',
                isActive ? 'text-orange-600' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <div
                className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center transition-all relative',
                  isActive ? 'bg-orange-100' : ''
                )}
              >
                <span className={cn('text-lg', isActive && item.href === '/report' && 'text-white')}>
                  {item.href === '/operator' ? '📊' : item.href === '/report' ? '➕' : '📋'}
                </span>
                {isActive && item.href === '/report' && (
                  <div className="absolute inset-0 w-10 h-10 rounded-xl bg-orange-500" />
                )}
              </div>
              <span className="text-xs font-medium">{item.label}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 bg-card border-b">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
              <HardHat className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-sm font-bold text-foreground">PilingTrack</h1>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <FeedbackCenter />
            <span className="text-xs text-muted-foreground hidden sm:block">{user?.name}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void logoutClient()}
              className="h-8 text-muted-foreground hover:text-red-500"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={user?.id}
          initial={pageVariants.initial}
          animate={pageVariants.animate}
          exit={pageVariants.exit}
          transition={{ duration: 0.2 }}
        >
          {children}
        </motion.div>
      </AnimatePresence>

      {nav}
    </div>
  );
}

function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = usePilingStore((s) => s.currentUser);
  const pathname = usePathname();
  const navItems = roleNavigation[user?.role || 'ADMIN'];
  const [mobileOpen, setMobileOpen] = useState(false);

  const isDispatcher = user?.role === 'DISPATCHER';

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-4 py-5">
        <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center">
          <HardHat className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-foreground">PilingTrack</h1>
          <p className="text-xs text-muted-foreground">
            {isDispatcher ? 'Панель диспетчера' : 'Панель администратора'}
          </p>
        </div>
      </div>

      <Separator />

      <nav className="flex-1 px-3 py-3 space-y-0.5">
        {navItems.map((item) => {
          const isActive = isActivePath(pathname, item.href);

          return (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline',
                isActive
                  ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {item.label}
            </a>
          );
        })}
      </nav>

      <Separator />

      <div className="px-4 py-4">
        <div className="flex items-center gap-3 mb-3">
          <FeedbackCenter />
          <ThemeToggle />
          <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center">
            <span className="text-xs font-bold text-purple-600 dark:text-purple-300">{user?.name?.charAt(0) || 'A'}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{user?.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void logoutClient()}
          className="w-full justify-start text-muted-foreground hover:text-red-600 hover:border-red-200"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Выйти
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-60 lg:flex-col bg-card border-r z-30">
        {sidebarContent}
      </aside>

      <div className="lg:hidden sticky top-0 z-30 bg-card border-b">
        <div className="flex items-center gap-3 px-4 py-3">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-muted">
                <Menu className="w-5 h-5 text-muted-foreground" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">Меню навигации</SheetTitle>
              {sidebarContent}
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2 ml-auto">
            <ThemeToggle />
            <FeedbackCenter />
            <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center">
              <HardHat className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-bold text-foreground">PilingTrack</span>
          </div>
        </div>
      </div>

      <main className="lg:ml-60 min-h-screen">
        <AnimatePresence mode="wait">
          <motion.div
            key={user?.id}
            initial={pageVariants.initial}
            animate={pageVariants.animate}
            exit={pageVariants.exit}
            transition={{ duration: 0.2 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function AppLayoutContent({ children }: { children: React.ReactNode }) {
  const currentUser = usePilingStore((s) => s.currentUser);
  
  if (currentUser?.role === 'ADMIN' || currentUser?.role === 'DISPATCHER') {
    return (
      <AppErrorBoundary>
        <AdminLayout>{children}</AdminLayout>
      </AppErrorBoundary>
    );
  }

  return (
    <AppErrorBoundary>
      <OperatorLayout>{children}</OperatorLayout>
    </AppErrorBoundary>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      // Import dynamically to avoid circular deps
      const { fetchSessionUser } = await import('@/lib/api');
      const sessionUser = await fetchSessionUser();
      if (!active) return;

      const existingUser = usePilingStore.getState().currentUser;

      if (sessionUser) {
        if (existingUser) {
          usePilingStore.getState().setCurrentUser(sessionUser);
        } else {
          usePilingStore.getState().login(sessionUser);
        }
      } else if (existingUser) {
        usePilingStore.getState().logout();
        router.replace('/login');
        return;
      }

      if (active) {
        setBootstrapping(false);
      }
    };

    void bootstrap();

    return () => {
      active = false;
    };
  }, [router]);

  // Get current user for redirect check
  const currentUser = usePilingStore((s) => s.currentUser);

  // Redirect to login if session check finished but no user found
  useEffect(() => {
    if (!bootstrapping && !currentUser) {
      router.replace('/login');
    }
  }, [bootstrapping, currentUser, router]);

  if (bootstrapping) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center">
            <HardHat className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-medium">Проверка сессии...</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  return <AppLayoutContent>{children}</AppLayoutContent>;
}
