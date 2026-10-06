'use client';

import {SAFETY_BRIEFING} from '@/modules/operator-mobile/contracts';
import {BigButton, ErrorNote, Panel, Screen} from '../ui';

/**
 * Инструкция целиком на одном экране.
 *
 * Девять разделов, две минуты чтения. Длиннее не делаем намеренно: инструкцию
 * на двадцать листов пролистывают и ставят отметку, а здесь каждое правило
 * такое, нарушение которого убивает или ломает машину.
 */
/** Форма инструкции: код, название, версия и разделы с правилами. */
export interface BriefingText {
  readonly code: string;
  readonly title: string;
  readonly version: string;
  readonly readingMinutes: number;
  readonly sections: readonly {
    readonly id: string;
    readonly title: string;
    readonly rules: readonly string[];
  }[];
}

export function BriefingScreen({busy, error, onAcknowledge, onBack, briefing = SAFETY_BRIEFING}: {
  busy: boolean;
  /**
   * Текст отказа сервера. Инструктаж — обязательный шаг допуска, и без причины
   * отказа кнопка «Прочитал и ознакомлен» просто отпускается: машинист жмёт её
   * подряд и остаётся без допуска, не понимая почему (F-V1-BRIEFING-ERROR).
   * Показываем текст сервера как есть, своих формулировок не придумываем.
   */
  error?: string | null;
  onAcknowledge: () => void;
  onBack: () => void;
  /**
   * Какую инструкцию читаем. По умолчанию — свайные работы: её читает
   * машинист. Помощник читает свою, про стропальные работы, и различаются
   * они текстом, а не устройством экрана.
   */
  briefing?: BriefingText;
}) {
  return (
    <Screen
      title={briefing.title}
      subtitle={`${briefing.code} · версия ${briefing.version} · ${briefing.readingMinutes} мин чтения`}
      footer={(
        <>
          {/* Отказ — в футере, рядом с кнопкой: разделов девять, и заметка
              в теле экрана осталась бы за границей прокрутки. */}
          <ErrorNote message={error ?? null} />
          <BigButton onClick={onAcknowledge} disabled={busy}>
            {busy ? 'Записываем…' : 'Прочитал и ознакомлен'}
          </BigButton>
          <BigButton tone="ghost" onClick={onBack}>Назад</BigButton>
        </>
      )}
    >
      {briefing.sections.map((section) => (
        <Panel key={section.id}>
          <h2 className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
            {section.title}
          </h2>
          <ul className="mt-2 space-y-2">
            {section.rules.map((rule) => (
              <li key={rule} className="flex gap-2 text-sm leading-snug">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-signal" />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ))}

      <Panel tone="warning">
        <p className="text-sm">
          Отметка о прочтении привязана к версии текста. Инструкцию перепишут — попросим прочитать
          заново.
        </p>
      </Panel>
    </Screen>
  );
}
