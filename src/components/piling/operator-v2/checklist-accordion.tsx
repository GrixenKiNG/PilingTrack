'use client';

/**
 * Один вертикальный сценарий вместо экрана на каждый узел.
 *
 * ЧТО БЫЛО. Разделы стояли на экране развёрнутыми все сразу: список на два
 * экрана прокрутки, в котором не видно ни где ты, ни сколько осталось. По
 * узлам это ещё терпимо, а на площадке с ТБ — уже нет.
 *
 * ЧТО ЗДЕСЬ. Свёрнутые строки разделов со счётчиком «3 из 6», раскрывается
 * ровно один. Закрыл последний пункт раздела — следующий незакрытый
 * открывается сам: человек не ищет, куда нажать дальше, и не листает вверх.
 *
 * ПОЧЕМУ ОДИН РАЗДЕЛ ЗА РАЗ. Оператор в перчатке смотрит на машину, а не в
 * телефон; открытый список из тридцати строк он закрывает не глядя. Один узел
 * на экране — это и есть тот обход, который он делает ногами.
 */

import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight } from '@/components/piling/icons/unified-icons';
import { cn } from '@/lib/utils';
import { groupDone, type CheckGroup } from './checklists';

interface Props {
  groups: readonly CheckGroup[];
  checked: Record<string, boolean>;
  onToggle: (itemId: string) => void;
  /** Отметить весь раздел разом. Нет — раздел закрывается только по пунктам. */
  onToggleGroup?: (group: CheckGroup, next: boolean) => void;
  /** Что дописать под пунктами конкретного раздела (например снимок дефекта). */
  renderGroupFooter?: (group: CheckGroup) => ReactNode;
}

export function ChecklistAccordion({
  groups, checked, onToggle, onToggleGroup, renderGroupFooter,
}: Props) {
  // Открыт первый незакрытый раздел: возвращаясь на шаг, человек попадает
  // туда, где остановился, а не в начало списка.
  const [openId, setOpenId] = useState<string | null>(
    () => groups.find((group) => !groupDone(group, checked))?.id ?? null,
  );

  const doneCount = groups.filter((group) => groupDone(group, checked)).length;
  const totalItems = groups.reduce((sum, group) => sum + group.items.length, 0);

  /** Следующий незакрытый раздел после этого — или ничего, если он последний. */
  const openNextAfter = (group: CheckGroup) => {
    const rest = groups.slice(groups.indexOf(group) + 1);
    setOpenId(rest.find((next) => !groupDone(next, checked))?.id ?? null);
  };

  /** Раздел закрыт последним пунктом — открываем следующий незакрытый. */
  const advanceFrom = (group: CheckGroup, justChecked: string) => {
    const complete = group.items.every((item) => item.id === justChecked || checked[item.id]);
    if (complete) openNextAfter(group);
  };

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {doneCount} из {groups.length} разделов · {totalItems} проверок
      </p>

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {groups.map((group) => {
          const done = groupDone(group, checked);
          const answered = group.items.filter((item) => checked[item.id]).length;
          const open = openId === group.id;
          return (
            <li key={group.id}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : group.id)}
                className="flex min-h-12 w-full items-center gap-3 px-3 text-left active:bg-muted/60"
              >
                <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                  done ? 'border-[#12a150] bg-[#12a150] text-white'
                    : answered > 0 ? 'border-[#1e5bd6] bg-[#1e5bd6]/20' : 'border-border')}>
                  {done && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className={cn('min-w-0 flex-1 truncate text-sm',
                  done ? 'text-muted-foreground' : 'font-medium text-foreground')}>
                  {group.title}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {answered}/{group.items.length}
                </span>
                {open
                  ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </button>

              {open && (
                <div className="border-t border-border bg-background/40">
                  {/* «Всё в норме» — над пунктами, как в осмотре: два экрана
                      подряд обязаны отвечать одинаково, иначе человек ищет
                      кнопку заново на каждом. */}
                  {onToggleGroup && (
                    <div className="px-3 pt-2">
                      <button
                        type="button"
                        aria-pressed={done}
                        onClick={() => {
                          onToggleGroup(group, !done);
                          if (!done) openNextAfter(group);
                        }}
                        className={cn('flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition',
                          done ? 'border-[#12a150] bg-[#12a150] text-white' : 'border-border text-muted-foreground')}
                      >
                        <Check className="h-4 w-4" />
                        Всё в норме
                      </button>
                    </div>
                  )}
                  <ul className="divide-y divide-border">
                    {group.items.map((item) => {
                      const on = Boolean(checked[item.id]);
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            aria-pressed={on}
                            onClick={() => {
                              onToggle(item.id);
                              if (!on) advanceFrom(group, item.id);
                            }}
                            className="flex min-h-12 w-full items-start gap-3 px-3 py-2.5 text-left active:bg-muted/60"
                          >
                            <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                              on ? 'border-[#12a150] bg-[#12a150] text-white' : 'border-border')}>
                              {on && <Check className="h-3.5 w-3.5" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm text-foreground">{item.label}</span>
                              {item.hint && (
                                <span className="mt-0.5 block text-xs text-muted-foreground">{item.hint}</span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {renderGroupFooter?.(group)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
