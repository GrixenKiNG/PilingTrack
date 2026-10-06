import { redirect } from 'next/navigation';
import { readPageSessionUser } from '@/lib/page-session';

export default async function AdminSectionLayout({ children }: { children: React.ReactNode }) {
  // Проверка сессии вынесена в readPageSessionUser: она открывает контекст
  // организации, без которого строгая политика RLS не отдаёт строку
  // пользователя и раздел уходит в круг переходов /admin ⇄ /login.
  const user = await readPageSessionUser();
  if (!user) redirect('/login');

  // Роли вне раздела (OPERATOR, ASSISTANT) видят объяснение отказа, а не
  // молчаливый переход на свой экран — как в гварде разделов
  // (`require-page-ability.ts`): W11-NO-ACCESS-SCREEN, W17.
  if (!['ADMIN', 'DISPATCHER', 'FOREMAN', 'MECHANIC', 'SAFETY_ENGINEER'].includes(user.role)) {
    redirect('/no-access');
  }

  return <>{children}</>;
}
