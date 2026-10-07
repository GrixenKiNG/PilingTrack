import { redirect } from 'next/navigation';
import { readPageSessionUser } from '@/lib/page-session';
import { can, type Ability } from '@/services/auth/authorization-service';

/**
 * Гвард серверных раскладок раздела.
 *
 * При отказе в праве уводит на страницу «Нет доступа» (`/no-access`) — человек
 * видит объяснение и кнопку возврата, а не молчаливую смену экрана. Раньше здесь
 * был `redirect(roleHomeRoute(user.role))`: адрес из закладки или письма
 * открывался как «страница исчезла» (W11-NO-ACCESS-SCREEN, W15).
 *
 * `redirect` ПРЕРЫВАЕТ рендер (бросает служебное исключение), поэтому раскладке
 * не нужно и не следует что-либо проверять после вызова — забытая строка не
 * может показать закрытый раздел.
 *
 * Отсутствие сессии — по-прежнему вход на `/login`.
 */
export async function requirePageAbility(ability: Ability) {
  const user = await readPageSessionUser();
  if (!user) redirect('/login');
  if (!can(user, ability)) redirect('/no-access');
}
