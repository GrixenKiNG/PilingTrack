import { redirect } from 'next/navigation';
import { readPageSessionUser } from '@/lib/page-session';

const ALLOWED = new Set([
  'ADMIN', 'DISPATCHER', 'MECHANIC', 'OPERATOR', 'FOREMAN', 'SAFETY_ENGINEER',
]);

export default async function ReadinessAdminLayout({ children }: { children: React.ReactNode }) {
  // См. комментарий в admin/layout.tsx: контекст организации обязателен.
  const user = await readPageSessionUser();
  if (!user) redirect('/login');

  if (!ALLOWED.has(user.role)) {
    redirect('/operator');
  }

  return <>{children}</>;
}
