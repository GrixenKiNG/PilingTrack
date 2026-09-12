import { redirect } from 'next/navigation';
import { readPageSessionUser } from '@/lib/page-session';
import { roleHomeRoute } from '@/lib/routes';
import { can, type Ability } from '@/services/auth/authorization-service';

export async function requirePageAbility(ability: Ability) {
  const user = await readPageSessionUser();
  if (!user) redirect('/login');
  if (!can(user, ability)) redirect(roleHomeRoute(user.role));
}
