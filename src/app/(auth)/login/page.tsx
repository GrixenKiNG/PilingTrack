'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoginPage } from '@/components/piling/login-page';
import { ASSISTANT_HOME_ROUTE, OPERATOR_HOME_ROUTE } from '@/lib/routes';
import { usePilingStore } from '@/lib/store';

export default function LoginPageRoute() {
  const router = useRouter();
  const currentUser = usePilingStore((s) => s.currentUser);

  useEffect(() => {
    if (currentUser) {
      const role = currentUser.role;
      if (role === 'ADMIN' || role === 'DISPATCHER' || role === 'FOREMAN') {
        router.replace('/admin');
      } else if (role === 'MECHANIC' || role === 'SAFETY_ENGINEER') {
        router.replace('/admin/to');
      } else if (role === 'ASSISTANT') {
        // Помощник смену не ведёт — рабочее место машиниста отвечает ему
        // отказом. Его место — свой допуск: инструктаж, проверка знаний и
        // документы со сроками.
        router.replace(ASSISTANT_HOME_ROUTE);
      } else {
        router.replace(OPERATOR_HOME_ROUTE);
      }
    }
  }, [currentUser, router]);

  if (currentUser) {
    return null;
  }

  return <LoginPage />;
}
