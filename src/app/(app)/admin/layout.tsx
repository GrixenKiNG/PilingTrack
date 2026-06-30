import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/services/auth/session-service';
import { db } from '@/lib/db';

export default async function AdminSectionLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) redirect('/login');

  const payload = await verifySessionToken(token);
  if (!payload) redirect('/login');

  // Mirrors lib/auth.ts's requireAuth() check: verifySessionToken only
  // checks signature + the jti revocation denylist, not whether the role
  // claim is still current. Without this, a deactivated/downgraded user
  // (sessionVersion bumped) sees the admin shell render until the JWT's
  // natural 12h expiry, even though every real API call underneath already
  // 401s/403s on the same check.
  const user = await db.user.findUnique({
    where: { id: payload.sub },
    select: { role: true, isActive: true, sessionVersion: true },
  });
  if (!user || !user.isActive || (payload.sv ?? 0) !== user.sessionVersion) {
    redirect('/login');
  }

  if (user.role !== 'ADMIN' && user.role !== 'DISPATCHER') {
    redirect('/operator');
  }

  return <>{children}</>;
}
