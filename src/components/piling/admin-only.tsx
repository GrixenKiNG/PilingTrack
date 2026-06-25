'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePilingStore } from '@/lib/store';

/**
 * Client guard for ADMIN-only screens (Пользователи / Telegram / DLQ).
 *
 * These routes are hidden from the dispatcher's nav, but a dispatcher who types
 * the URL used to land on the page and see a generic "Не удалось загрузить"
 * error (the API correctly 403s — no data leaks, but the UX was confusing).
 * This redirects non-admins back to the dashboard instead.
 */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const role = usePilingStore((s) => s.currentUser?.role);
  const allowed = role === 'ADMIN';

  useEffect(() => {
    if (role && !allowed) router.replace('/admin');
  }, [role, allowed, router]);

  if (!allowed) return null;
  return <>{children}</>;
}
