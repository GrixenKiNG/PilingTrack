import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/services/auth/session-service';

export default async function AdminSectionLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) redirect('/login');

  const payload = await verifySessionToken(token);
  if (!payload) redirect('/login');

  if (payload.role !== 'ADMIN' && payload.role !== 'DISPATCHER') {
    redirect('/operator');
  }

  return <>{children}</>;
}
