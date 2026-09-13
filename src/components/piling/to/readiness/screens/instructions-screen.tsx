'use client';

/**
 * «Инструкции и регламенты» — какие инструкции действуют и кто с ними
 * ознакомлен.
 *
 * ПОЧЕМУ ЗДЕСЬ НЕТ ЗАГРУЗКИ ФАЙЛОВ. Тексты инструкций живут в коде — решение
 * владельца 13.09.2026: меняются они редко, и библиотека PDF с версиями не
 * окупается. Следствие честно написано на экране: новую редакцию выкладывает
 * разработчик, а не инженер ОТ. Показывать кнопку «Добавить инструкцию»,
 * которая ничего не может, хуже, чем её отсутствие.
 *
 * ЧТО СЧИТАЕМ ОЗНАКОМЛЕНИЕМ. Запись журнала с ТЕКУЩЕЙ версией. Прочтение
 * прошлой редакции не засчитывается: версия поднимается тогда, когда текст
 * изменился, и старая отметка говорит о другом документе.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from '@/components/piling/icons/unified-icons';
import { authFetch } from '@/lib/api';
import { formatRuDate } from '@/lib/format';
import { SAFETY_INSTRUCTIONS } from '@/modules/safety/instructions';
import type { BriefingJournalEntry } from '@/modules/operator-mobile/contracts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { COMPACT_KPI_GRID, ScreenTitle, card } from '../settings/shared-ui';
import { kpiGridStyle } from '@/components/piling/kpi-tile';
import { RefKpi } from './shared';

export function InstructionsScreen() {
  const [rows, setRows] = useState<BriefingJournalEntry[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await authFetch('/api/briefings/journal?kind=INSTRUCTION');
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Сервер вернул ${response.status}`);
      }
      setRows(((await response.json()).rows ?? []) as BriefingJournalEntry[]);
      setFailed(null);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'Не удалось загрузить ознакомления');
      setRows(null);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount; the async loader sets state
  useEffect(() => { void load(); }, [load]);

  const stats = SAFETY_INSTRUCTIONS.map((instruction) => {
    const own = (rows ?? []).filter((row) => row.documentCode === instruction.code);
    const current = own.filter((row) => row.documentVersion === instruction.version);
    const people = new Set(current.map((row) => row.userId));
    const latest = current[0]?.recordedAt ?? null;
    return { instruction, acquainted: people.size, readsTotal: own.length, latest };
  });

  return (
    <>
      <ScreenTitle
        heading="Инструкции и регламенты"
        subtitle="Действующие инструкции по охране труда и ознакомление с ними"
        actions={(
          <Button variant="outline" onClick={() => { setRows(null); void load(); }}>Обновить</Button>
        )}
      />

      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(2)}>
        <RefKpi icon="documents" label="Действующих инструкций" tone="info"
          value={SAFETY_INSTRUCTIONS.length} detail="в текущей редакции" />
        <RefKpi icon="accepted" label="Ознакомлений" tone="success"
          value={rows?.length ?? '—'} detail="записей в журнале за всё время" />
      </section>

      {failed && (
        <p role="alert" className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-strong">
          {failed}
        </p>
      )}

      {rows === null && !failed && (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      )}

      {rows !== null && (
        <section className={cn(card, 'mt-2 p-3')}>
          <h2 className="font-bold">Действующие инструкции</h2>
          <div className="mt-2 divide-y divide-border">
            {stats.map(({ instruction, acquainted, readsTotal, latest }) => (
              <div key={instruction.code} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{instruction.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {instruction.code} · редакция {instruction.version} · {instruction.audience}
                  </div>
                </div>
                <div className="w-40 text-xs">
                  <div className="text-muted-foreground">Ознакомлено человек</div>
                  <div className="font-semibold">{acquainted}</div>
                </div>
                <div className="w-40 text-xs">
                  <div className="text-muted-foreground">Последнее прочтение</div>
                  <div className="font-semibold">{latest ? formatRuDate(latest) : 'нет записей'}</div>
                </div>
                <div className="w-36 text-xs">
                  <div className="text-muted-foreground">Всего прочтений</div>
                  <div className="font-semibold">{readsTotal}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="mt-2 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        Тексты инструкций хранятся в самой программе, а не загружаются файлами: так решено, потому
        что редакции меняются редко. Новая редакция выкладывается вместе с обновлением программы —
        после этого прежние отметки об ознакомлении перестают засчитываться, и работников просят
        прочитать заново. Кто и когда читал — на вкладке «Журнал инструктажей».
      </p>
    </>
  );
}
