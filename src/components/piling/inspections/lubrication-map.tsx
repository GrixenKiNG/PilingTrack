'use client';

/**
 * LubricationMap — интерактивная карта смазки установки.
 *
 * Векторный силуэт машины + пронумерованные точки смазки (данные из
 * lubrication-maps.ts). Тап по точке на схеме или по строке списка
 * подсвечивает её и синхронизирует выбор. Рассчитано на планшет/телефон:
 * схема сверху, список снизу.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { getLubeMap, type LubePoint } from '@/modules/inspections/domain/lubrication-maps';
import { PilingIcon } from '@/components/piling/icons';

/** Силуэт гусеничной сваебойной установки (viewBox 0 0 200 240). */
function CrawlerRig() {
  return (
    <g stroke="#94a3b8" strokeWidth={1.5} fill="#e2e8f0">
      {/* гусеницы */}
      <rect x={18} y={205} width={120} height={20} rx={9} />
      {/* поворотная платформа (верхняя конструкция) */}
      <rect x={56} y={158} width={92} height={48} rx={4} fill="#cbd5e1" />
      {/* кабина */}
      <rect x={48} y={150} width={26} height={22} rx={3} fill="#e2e8f0" />
      {/* противовес */}
      <rect x={134} y={166} width={18} height={34} rx={2} fill="#cbd5e1" />
      {/* А-рама */}
      <polygon points="70,160 96,108 108,108 86,160" fill="#cbd5e1" />
      {/* мачта (лидер) */}
      <rect x={100} y={24} width={12} height={140} fill="#cbd5e1" />
      {/* оголовок мачты */}
      <rect x={97} y={22} width={18} height={8} rx={2} fill="#94a3b8" />
    </g>
  );
}

export function LubricationMap({ model }: { model: string | null | undefined }) {
  const map = getLubeMap(model);
  const [sel, setSel] = useState<number>(map?.points[0]?.n ?? 0);
  if (!map) return null;

  const active: LubePoint | undefined = map.points.find((p) => p.n === sel);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-800">
        <PilingIcon name="maintenance-due" size={18} tone="warning" decorative /> Карта смазки
      </div>

      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        {/* Схема */}
        <div className="rounded-md border border-amber-100 bg-white p-2">
          <svg viewBox="0 0 200 240" className="h-56 w-full select-none">
            <CrawlerRig />
            {map.points.map((p) => {
              const on = p.n === sel;
              return (
                <g key={p.n} onClick={() => setSel(p.n)} className="cursor-pointer">
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={on ? 10 : 8}
                    fill={on ? '#ea580c' : '#f59e0b'}
                    stroke="#fff"
                    strokeWidth={2}
                  />
                  <text
                    x={p.x}
                    y={p.y + 3.5}
                    textAnchor="middle"
                    fontSize={9}
                    fontWeight={700}
                    fill="#fff"
                  >
                    {p.n}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Список + деталь активной точки */}
        <div className="min-w-0">
          {active && (
            <div className="mb-2 rounded-md border border-amber-200 bg-white p-2.5">
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-orange-500 text-2xs font-bold text-white">{active.n}</span>
                <span className="text-sm font-semibold text-slate-800">{active.label}</span>
              </div>
              <dl className="mt-1.5 space-y-0.5 text-xs text-slate-600">
                <div><dt className="inline text-slate-400">Чем: </dt><dd className="inline font-medium text-teal-700">{active.lubricant}</dd></div>
                <div><dt className="inline text-slate-400">Как: </dt><dd className="inline">{active.method}</dd></div>
                <div><dt className="inline text-slate-400">Когда: </dt><dd className="inline font-medium text-slate-800">{active.interval}</dd></div>
              </dl>
            </div>
          )}
          <div className="max-h-44 overflow-y-auto rounded-md border border-slate-100 bg-white">
            {map.points.map((p) => (
              <button
                key={p.n}
                type="button"
                onClick={() => setSel(p.n)}
                className={cn(
                  'flex w-full items-center gap-2 border-b border-slate-50 px-2 py-1.5 text-left text-xs last:border-0',
                  p.n === sel ? 'bg-amber-50' : 'hover:bg-slate-50',
                )}
              >
                <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-full text-2xs leading-none font-bold text-white',
                  p.n === sel ? 'bg-orange-500' : 'bg-amber-400')}>{p.n}</span>
                <span className="flex-1 truncate text-slate-700">{p.label}</span>
                <span className="shrink-0 text-2xs text-slate-400">{p.interval}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-2xs text-slate-400">Тап по точке на схеме или в списке — подробности. Данные из таблицы смазки руководства.</p>
    </div>
  );
}
