import { redirect } from 'next/navigation';
import { readPageSessionUser } from '@/lib/page-session';

const ALLOWED = new Set([
  'ADMIN', 'DISPATCHER', 'MECHANIC', 'OPERATOR', 'FOREMAN', 'SAFETY_ENGINEER',
]);

export default async function ReadinessAdminLayout({ children }: { children: React.ReactNode }) {
  // См. комментарий в admin/layout.tsx: контекст организации обязателен.
  const user = await readPageSessionUser();
  if (!user) redirect('/login');

  // Роли вне раздела (ASSISTANT) видят объяснение отказа, а не молчаливый
  // переход на чужой экран — как в раскладке админки (admin/layout.tsx) и
  // гварде разделов (require-page-ability.ts): W11-NO-ACCESS-SCREEN, W22.
  if (!ALLOWED.has(user.role)) {
    redirect('/no-access');
  }

  return <>{children}</>;
}
