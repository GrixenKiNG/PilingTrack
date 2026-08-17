'use client';

/**
 * Напоминание оператору о своих документах.
 *
 * Утверждённый порядок: «прикладывает документы однократно и по истечении
 * срока обновляет, система смотрит сроки». Смотреть-то она смотрела, но
 * результат видел только диспетчер в своём списке — сам работник узнавал о
 * просрочке, когда его не пускали в смену.
 *
 * Показываем только то, что требует действия: просроченное и истекающее.
 * Когда всё в порядке, блока нет вовсе — пустая зелёная плашка каждый день
 * приучает не читать предупреждения.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle } from '@/components/piling/icons/unified-icons';
import { authFetch } from '@/lib/api';
import { usePilingStore } from '@/lib/store';
import { cn } from '@/lib/utils';

interface OwnDocument {
  id: string;
  type: { name: string };
  expiry: { status: 'ok' | 'expiring' | 'expired' | 'perpetual'; daysLeft: number | null };
}

export function OperatorDocumentReminder() {
  const userId = usePilingStore((state) => state.currentUser?.id);
  const [rows, setRows] = useState<OwnDocument[]>([]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await authFetch(`/api/users/${userId}/documents`);
        if (!response.ok) return;
        const documents = ((await response.json()).documents ?? []) as OwnDocument[];
        if (!cancelled) {
          setRows(documents.filter((row) => row.expiry.status === 'expired' || row.expiry.status === 'expiring'));
        }
      } catch {
        // Напоминание — вспомогательный блок: молчим, чтобы не заслонять
        // рабочий экран оператора ошибкой второстепенного запроса.
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (rows.length === 0) return null;

  const expired = rows.filter((row) => row.expiry.status === 'expired');
  const critical = expired.length > 0;

  return (
    <section
      aria-label="Сроки документов"
      className={cn('rounded-xl border p-3',
        critical ? 'border-destructive/40 bg-destructive/10' : 'border-warning/40 bg-warning/10')}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className={cn('mt-0.5 h-5 w-5 shrink-0',
          critical ? 'text-destructive-strong' : 'text-warning-strong')} />
        <div className="min-w-0 flex-1">
          <h2 className={cn('text-sm font-bold', critical ? 'text-destructive-strong' : 'text-warning-strong')}>
            {critical ? 'Документы просрочены' : 'Скоро истекают документы'}
          </h2>
          <ul className="mt-1 space-y-0.5 text-xs text-foreground">
            {rows.slice(0, 3).map((row) => (
              <li key={row.id}>
                {row.type.name} — {row.expiry.status === 'expired'
                  ? `просрочен${row.expiry.daysLeft == null ? '' : ` на ${Math.abs(row.expiry.daysLeft)} дн.`}`
                  : `истекает через ${row.expiry.daysLeft ?? 0} дн.`}
              </li>
            ))}
            {rows.length > 3 && <li className="text-muted-foreground">и ещё {rows.length - 3}</li>}
          </ul>
          {/*
            Кнопки «мои документы» здесь намеренно нет: экрана самообслуживания
            в приложении пока не существует (правило доступа его допускает,
            интерфейс — нет). Ссылка в никуда хуже её отсутствия.
          */}
          <p className="mt-1.5 text-xs text-muted-foreground">
            {critical
              ? 'С просроченным документом к работе не допускают. Обратитесь к диспетчеру или инженеру ОТ.'
              : 'Продлите документ заранее — оформление занимает недели. Скан передайте диспетчеру.'}
          </p>
        </div>
      </div>
    </section>
  );
}
