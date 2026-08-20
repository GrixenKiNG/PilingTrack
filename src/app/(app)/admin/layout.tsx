import { redirect } from 'next/navigation';
import { readPageSessionUser } from '@/lib/page-session';

export default async function AdminSectionLayout({ children }: { children: React.ReactNode }) {
  // Проверка сессии вынесена в readPageSessionUser: она открывает контекст
  // организации, без которого строгая политика RLS не отдаёт строку
  // пользователя и раздел уходит в круг переходов /admin ⇄ /login.
  const user = await readPageSessionUser();
  if (!user) redirect('/login');

  if (user.role !== 'ADMIN' && user.role !== 'DISPATCHER') {
    redirect('/operator');
  }

  return <>{children}</>;
}
