import Link from 'next/link';
import { redirect } from 'next/navigation';
import { readPageSessionUser } from '@/lib/page-session';
import { roleHomeRoute } from '@/lib/routes';
import { ShieldAlert, ArrowLeft } from '@/components/piling/icons/unified-icons';

/**
 * Экран «Нет доступа к разделу».
 *
 * Сюда ведёт гвард раскладки раздела (`require-page-ability.ts`) при отказе в
 * праве. Раньше отказ был молчаливым редиректом на домашний маршрут роли:
 * человек открывал адрес из закладки или письма и оказывался на другом экране
 * без объяснения — выглядело как «страница исчезла» (W11-NO-ACCESS-SCREEN, W15).
 *
 * Кнопка ведёт на `roleHomeRoute(user.role)` — цель считается на сервере по
 * настоящей роли, а не гадается на клиенте.
 *
 * Параметр `from` (адрес, с которого пришли) показывается ТОЛЬКО как текст:
 * никаких ссылок по нему не строим, иначе это открытый переход на любой адрес.
 */
export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const user = await readPageSessionUser();
  if (!user) redirect('/login');

  const { from } = await searchParams;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-signal/10 text-signal-strong">
        <ShieldAlert className="h-8 w-8" />
      </div>
      <h1 className="mt-6 text-lg font-semibold text-foreground">Нет доступа к разделу</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Этот раздел недоступен для вашей роли. Если доступ нужен — обратитесь к администратору.
      </p>
      {from ? (
        <p className="mt-2 text-xs text-muted-foreground">{`Запрошенный адрес: ${from}`}</p>
      ) : null}
      <Link
        href={roleHomeRoute(user.role)}
        className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-signal-strong px-5 text-sm font-semibold text-white transition-colors hover:bg-signal-strong"
      >
        <ArrowLeft className="h-4 w-4" />
        На мой главный экран
      </Link>
    </div>
  );
}
