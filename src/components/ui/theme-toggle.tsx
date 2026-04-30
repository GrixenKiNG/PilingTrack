'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun, Monitor } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Three-state theme toggle: light / system / dark.
 * Cycles on click. Renders nothing until mounted to avoid hydration flash.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className={cn('w-9 h-9', className)} aria-hidden />;
  }

  const cycle = () => {
    setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light');
  };

  const Icon = theme === 'dark' ? Moon : theme === 'system' ? Monitor : Sun;
  const label =
    theme === 'dark' ? 'Тёмная тема' : theme === 'system' ? 'Системная тема' : 'Светлая тема';

  return (
    <button
      type="button"
      onClick={cycle}
      title={label}
      aria-label={label}
      className={cn(
        'w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
        className,
      )}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
