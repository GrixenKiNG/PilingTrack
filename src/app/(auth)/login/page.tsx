'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoginPage } from '@/components/piling/login-page';
import { roleHomeRoute } from '@/lib/routes';
import { usePilingStore } from '@/lib/store';

export default function LoginPageRoute() {
  const router = useRouter();
  const currentUser = usePilingStore((s) => s.currentUser);

  useEffect(() => {
    if (currentUser) {
      router.replace(roleHomeRoute(currentUser.role));
    }
  }, [currentUser, router]);

  if (currentUser) {
    return null;
  }

  return <LoginPage />;
}
