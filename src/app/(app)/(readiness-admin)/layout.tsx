import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/services/auth/session-service';
import { db } from '@/lib/db';

export default async function ReadinessAdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) redirect('/login');

  const payload = await verifySessionToken(token);
  if (!payload) redirect('/login');

  const user = await db.user.findUnique({
    where: { id: payload.sub },
    select: { role: true, isActive: true, sessionVersion: true },
  });
  if (!user || !user.isActive || (payload.sv ?? 0) !== user.sessionVersion) {
    redirect('/login');
  }

  if (
    user.role !== 'ADMIN'
    && user.role !== 'DISPATCHER'
    && user.role !== 'MECHANIC'
    && user.role !== 'OPERATOR'
    && user.role !== 'FOREMAN'
    && user.role !== 'SAFETY_ENGINEER'
  ) {
    redirect('/operator');
  }

  return <>{children}</>;
}
