'use client';

import { cn } from '@/lib/utils';
import { REFUSAL_SET_WINDOW } from '@/modules/operator-mobile/domain/pile-passport';
import type { PilePassportRow } from '@/modules/reports/application/queries/pile-passport.service';

/**
 * Ход забивки по залогам — главная графа нормативного журнала.
 *
 * ЧТО ЗДЕСЬ ВИДНО, ЧЕГО НЕ ВИДНО В ИТОГОВОМ ОТКАЗЕ. Ряд залогов показывает,
 * КАК свая входила: ровно затухала, уткнулась в линзу и снова пошла, или на
 * последнем залоге провалилась. Один итоговый отказ всё это стирает, а
 * принимать сваю по стёртому — значит принимать вслепую.
 *
 * ПОЧЕМУ ПОСЛЕДНИЕ ТРИ ВЫДЕЛЕНЫ. Отказ по норме — среднее по трём последним
 * залогам. Мастер должен видеть, какие именно строки дали то число, по
 * которому он решает.
 */
export function DrivingSets({ row }: { row: PilePassportRow }) {
  if (row.sets.length === 0) {
    return (
      <p className="rounded-md bg-muted px-2.5 py-2 text-2xs text-muted-foreground">
        Залоги не записаны. Отказ посчитан по одному замеру из паспорта
        {row.refusalSetBlows !== null
          ? `: ${row.refusalSetPenetrationMm ?? '—'} мм за ${row.refusalSetBlows} ударов.`
          : ' — замера нет.'}
      </p>
    );
  }

  const windowStart = Math.max(0, row.sets.length - REFUSAL_SET_WINDOW);
  const maxPenetration = Math.max(...row.sets.map((set) => set.penetrationMm), 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-2xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-2 font-medium">№ залога</th>
            <th className="py-1 pr-2 font-medium">Ударов</th>
            <th className="py-1 pr-2 font-medium">Погружение, мм</th>
            <th className="py-1 pr-2 font-medium">Высота, м</th>
            <th className="py-1 pr-2 font-medium">Отказ, мм/уд</th>
            <th className="py-1 font-medium">Ход</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {row.sets.map((set, index) => {
            const counted = index >= windowStart;
            const exceeds = set.refusalMm !== null
              && row.designRefusalMm !== null
              && set.refusalMm > row.designRefusalMm;
            return (
              <tr
                key={set.ordinal}
                className={cn('border-t border-border', counted && 'bg-muted/60')}
              >
                <td className="py-1 pr-2">{set.ordinal}</td>
                <td className="py-1 pr-2">{set.blows}</td>
                <td className="py-1 pr-2">{set.penetrationMm}</td>
                <td className="py-1 pr-2">{set.dropHeightM ?? '—'}</td>
                <td className={cn('py-1 pr-2', exceeds && 'font-semibold text-warning-strong')}>
                  {set.refusalMm ?? '—'}
                </td>
                <td className="py-1">
                  {/* Полоса — не украшение: по ней ряд читается одним взглядом,
                      а затухание видно раньше, чем прочитаны цифры. */}
                  <span
                    className={cn('block h-2 rounded-sm', exceeds ? 'bg-warning' : 'bg-info')}
                    style={{ width: `${Math.max(4, (set.penetrationMm / maxPenetration) * 100)}%` }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-3xs text-muted-foreground">
        Подсвечены последние {Math.min(REFUSAL_SET_WINDOW, row.sets.length)} залога — по ним
        считается отказ сваи (СП 45.13330).
      </p>
    </div>
  );
}
