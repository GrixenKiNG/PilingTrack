'use client';

/**
 * Переключатель исполняемой роли и полоса «вы смотрите как …».
 *
 * Живёт в оболочке приложения, а не внутри модуля техготовности, потому что
 * режим замещения глобальный: он меняет навигацию и права везде. Пока
 * переключатель стоял в полосе вкладок техготовности, из него нельзя было
 * выйти, включив роль, у которой этого раздела нет в навигации, — например
 * мастера.
 *
 * Показывается только администратору: исполнять чужую роль может лишь он
 * (`canActAs`), и предлагать остальным действие, которое закончится отказом,
 * незачем.
 */

import { usePilingStore } from '@/lib/store';
import { ROLE_LABELS, type ActingRole } from '@/lib/types';
import { ActingRoleSwitch } from '@/components/piling/to/readiness/acting-role-switch';

export function ActingAsBanner() {
  const actingAs = usePilingStore((state) => state.actingAs) as ActingRole | null;
  const setActingAs = usePilingStore((state) => state.setActingAs);
  const currentUser = usePilingStore((state) => state.currentUser);

  if (currentUser?.role !== 'ADMIN') return null;

  /**
   * Полная перезагрузка после смены роли.
   *
   * Права меняются на сервере, а уже открытые страницы держат данные,
   * полученные под прежней ролью, — без перезагрузки экран показывал бы старое
   * содержимое рядом с новой навигацией.
   */
  const change = (role: ActingRole | null) => {
    setActingAs(role);
    window.location.reload();
  };

  return (
    <div className={`flex flex-wrap items-center gap-3 border-b px-4 py-2 text-sm ${
      actingAs ? 'border-warning/40 bg-warning/15' : 'border-border bg-muted/40'
    }`}>
      <ActingRoleSwitch actorRole={currentUser.role} value={actingAs} onChange={change} />
      {actingAs ? (
        <>
          <span className="font-semibold text-warning-strong">
            Просмотр от роли: {ROLE_LABELS[actingAs as keyof typeof ROLE_LABELS] ?? actingAs}
          </span>
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            Разделы и права — как у этой роли. Действия выполняются от вашего имени
            ({currentUser.name}) и записываются в журнал с пометкой о замещении.
          </span>
          <button
            type="button"
            onClick={() => change(null)}
            className="min-h-9 shrink-0 rounded border border-warning-strong px-3 text-xs font-semibold text-warning-strong hover:bg-warning/20"
          >
            Вернуться к своей роли
          </button>
        </>
      ) : (
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">
          Выберите роль, чтобы посмотреть приложение её глазами: разделы и права станут как у неё.
        </span>
      )}
    </div>
  );
}
