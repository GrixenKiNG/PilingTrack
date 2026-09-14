'use client';

import { cn } from '@/lib/utils';
import type { PileJournalHeader } from '@/modules/reports/application/queries/pile-passport.service';

/**
 * Титул журнала забивки.
 *
 * ЗАЧЕМ ОН ЕСТЬ В ЭКРАНЕ, А НЕ ТОЛЬКО В ВЫГРУЗКЕ. Нормативная форма начинается
 * не со свай, а с того, чем били: копёр, молот, энергия удара, проектный отказ.
 * Без этих величин строка «отказ 1,8» ничего не доказывает — непонятно, чем
 * получена и с чем сравнивается.
 *
 * ПОЧЕМУ ЗНАЧЕНИЙ БЫВАЕТ НЕСКОЛЬКО. Выборка может захватить два объекта или
 * смену молота посреди поля. Показываем всё, что в ней встретилось: одно
 * «главное» значение соврало бы про половину строк.
 */
export function JournalTitleBlock({ header }: { header: PileJournalHeader }) {
  const list = (values: (string | number)[]): string => (values.length ? values.join(', ') : '—');

  return (
    <section className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Журнал забивки свай
        </h2>
        <p className="text-sm font-semibold">{list(header.siteNames)}</p>
        <p className="text-2xs text-muted-foreground">
          Период забивки: {header.dateFrom ?? '—'} — {header.dateTo ?? '—'}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-3 text-2xs sm:grid-cols-4">
        <TitleFact label="Копровая установка" value={list(header.equipmentNames)} />
        <TitleFact label="Молот" value={list(header.hammerTypes)} />
        <TitleFact label="Энергия удара, кДж" value={list(header.hammerEnergyKj)} />
        <TitleFact label="Проектный отказ, мм/уд" value={list(header.designRefusalMm)} />
      </dl>

      <div className="grid grid-cols-2 divide-x divide-border border-t border-border sm:grid-cols-5">
        <Counter label="Свай в журнале" value={header.pilesTotal} />
        <Counter label="Не разобрано" value={header.pending} />
        <Counter label="Отказ выше проектного" value={header.overRefusal} tone="warning" />
        <Counter label="На добивку" value={header.needsRedrive} tone="warning" />
        <Counter label="Принято" value={header.accepted} tone="success" />
      </div>
    </section>
  );
}

function TitleFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Counter({ label, value, tone }: {
  label: string;
  value: number;
  tone?: 'warning' | 'success';
}) {
  return (
    <div className="p-2.5">
      <p className="text-2xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'font-mono text-base font-semibold',
          value > 0 && tone === 'warning' && 'text-warning-strong',
          value > 0 && tone === 'success' && 'text-success-strong',
        )}
      >
        {value}
      </p>
    </div>
  );
}
