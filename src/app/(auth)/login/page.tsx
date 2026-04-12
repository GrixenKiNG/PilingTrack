'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoginPage } from '@/components/piling/login-page';
import { usePilingStore } from '@/lib/store';

export default function LoginPageRoute() {
  const router = useRouter();
  const currentUser = usePilingStore((s) => s.currentUser);

  useEffect(() => {
    if (currentUser) {
      const role = currentUser.role;
      if (role === 'ADMIN' || role === 'DISPATCHER') {
        router.replace('/admin');
      } else {
        router.replace('/operator');
      }
    }
  }, [currentUser, router]);

  if (currentUser) {
    return null;
  }

  return <LoginPage />;
}
