'use client';

import {useState} from 'react';
import {PPE_ITEMS} from '@/modules/operator-mobile/contracts';
import {BigButton, ErrorNote, Panel, PanelTitle, Screen} from '../ui';

/**
 * Первый шаг допуска: проверка средств защиты.
 *
 * ПОЧЕМУ ГАЛОЧКИ СТОЯТ ЗАРАНЕЕ. У работника, вышедшего на смену, комплект
 * обычно полон, и шесть обязательных нажатий в шесть утра превращаются в
 * шесть нажатий не глядя. Отмечать нужно ОТСУТСТВИЕ — то есть исключение, а
 * не норму: снять галочку человек снимет осознанно.
 *
 * ПОЧЕМУ КНОПКА НЕ БЛОКИРУЕТСЯ ПРИ НЕХВАТКЕ. Запертый работник вернёт галочку
 * обратно, лишь бы начать смену, и мы получим ложную запись вместо честной.
 * Нехватка уходит в предупреждение, которое видит и он, и диспетчер.
 */
export function PpeScreen({busy, error, onConfirm, onBack}: {
  busy: boolean;
  error: string | null;
  onConfirm: (items: string[]) => void;
  onBack: () => void;
}) {
  const [present, setPresent] = useState<string[]>(() => PPE_ITEMS.map((item) => item.code));

  const toggle = (code: string) => {
    setPresent((current) => current.includes(code)
      ? current.filter((value) => value !== code)
      : [...current, code]);
  };

  const missingCount = PPE_ITEMS.length - present.length;

  return (
    <Screen
      title="Средства защиты"
      subtitle="Проверьте комплект перед сменой. Снимите отметку с того, чего нет."
      footer={(
        <>
          <BigButton onClick={() => onConfirm(present)} disabled={busy}>
            {busy
              ? 'Записываем…'
              : missingCount === 0 ? 'Комплект в порядке' : `Подтвердить (нет: ${missingCount})`}
          </BigButton>
          <button
            type="button"
            onClick={onBack}
            className="mt-2 min-h-11 w-full rounded-xl border border-border bg-card text-base font-medium"
          >
            Назад
          </button>
        </>
      )}
    >
      <ErrorNote message={error} />

      {missingCount > 0 && (
        <Panel tone="warning">
          <PanelTitle tone="warning">Комплект неполный</PanelTitle>
          <p className="mt-1 text-sm">
            Смену это не запирает, но отметка уйдёт диспетчеру. Возьмите недостающее до выхода
            на площадку.
          </p>
        </Panel>
      )}

      <div className="mt-2 grid gap-2">
        {PPE_ITEMS.map((item) => {
          const has = present.includes(item.code);
          return (
            <button
              key={item.code}
              type="button"
              onClick={() => toggle(item.code)}
              aria-pressed={has}
              className={[
                'flex min-h-16 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                has
                  ? 'border-success/40 bg-success/5'
                  : 'border-destructive/40 bg-destructive/5',
              ].join(' ')}
            >
              <span
                aria-hidden="true"
                className={[
                  'grid h-8 w-8 shrink-0 place-items-center rounded-full text-lg font-bold',
                  has ? 'bg-success text-white' : 'bg-destructive text-white',
                ].join(' ')}
              >
                {has ? '✓' : '—'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold">{item.label}</span>
                <span className="block text-xs text-muted-foreground">{item.hint}</span>
              </span>
              <span className="shrink-0 text-xs font-medium text-muted-foreground">
                {has ? 'есть' : 'нет'}
              </span>
            </button>
          );
        })}
      </div>
    </Screen>
  );
}
