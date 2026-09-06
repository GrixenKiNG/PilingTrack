import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { roleHomeRoute } from '@/lib/routes';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/services/auth/session-service';

/**
 * Root page — redirects to role-appropriate dashboard if authenticated,
 * otherwise to /login. Server Component — zero client JS.
 */
export default async function Home() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    redirect('/login');
  }

  const payload = await verifySessionToken(token);
  if (!payload) {
    redirect('/login');
  }

  redirect(roleHomeRoute(payload.role));
}
