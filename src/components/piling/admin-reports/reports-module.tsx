'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { usePilingStore } from '@/lib/store';
import { can } from '@/services/auth/authorization-service';
import { PileJournal } from '@/components/piling/pile-journal';
import { AdminReports } from './admin-reports';

/**
 * «Отчёты» — раздел о том, что сделано на объекте. Две вкладки:
 *
 *   Отчёты смен   — сколько сделано за смену: сваи пачкой, бурение, простои.
 *   Журнал забивки — что стало с каждой сваей по отдельности.
 *
 * ПОЧЕМУ ОНИ В ОДНОМ РАЗДЕЛЕ. Паспорт сваи приходит из отчёта смены: это одна
 * и та же работа, записанная с разной подробностью. Мастер открывает их
 * подряд — сначала смену, потом сваи этой смены, — и отдельный пункт меню
 * заставлял его выходить из раздела и возвращаться.
 *
 * ПОЧЕМУ ВКЛАДКА В АДРЕСЕ. `?view=piles` — то, что кладут в закладку и
 * присылают ссылкой: «посмотри сваю С-130». Вкладка в состоянии компонента
 * такую ссылку не переживает.
 */

type ReportsView = 'shifts' | 'piles';

export function ReportsModule() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentUser = usePilingStore((state) => state.currentUser);
  const actingAs = usePilingStore((state) => state.actingAs);
  const mayJournal = can({ role: currentUser?.role ?? '', actingAs }, 'piles.manage');

  // Адрес — единственный хозяин вкладки. Своё состояние здесь означало бы
  // второй ответ на вопрос «какая вкладка открыта», и «назад» показывал бы не
  // то, что в адресе.
  //
  // Журнал закрыт тому, кому он закрыт на сервере (`piles.manage`): роль без
  // этого права получила бы по прямой ссылке пустой экран с ошибкой доступа
  // вместо отчётов, за которыми пришла.
  const view: ReportsView = searchParams.get('view') === 'piles' && mayJournal ? 'piles' : 'shifts';

  const openView = (next: ReportsView) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'piles') params.set('view', 'piles');
    else params.delete('view');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  if (!mayJournal) return <AdminReports />;

  const tabs: Array<{ id: ReportsView; label: string }> = [
    { id: 'shifts', label: 'Отчёты смен' },
    { id: 'piles', label: 'Журнал забивки' },
  ];

  return (
    <div>
      <nav className="flex gap-1 border-b border-border px-4 pt-3">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => openView(tab.id)}
            className={cn(
              'rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-medium',
              view === tab.id
                ? 'border-border bg-card text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {view === 'piles' ? <PileJournal /> : <AdminReports />}
    </div>
  );
}
