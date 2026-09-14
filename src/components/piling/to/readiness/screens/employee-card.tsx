'use client';

/**
 * «Карточка сотрудника — ТБ и допуски».
 *
 * Один человек — всё, что о нём знает охрана труда: личные данные, матрица
 * допусков к технике, обязательные требования, проверка знаний, ознакомление с
 * инструкциями и история инструктажей. Экран открывается из списка
 * «Сотрудники» и не заменяет его: закрыл карточку — вернулся к списку.
 *
 * ЧТО ПОКАЗЫВАЕТСЯ ЧЕСТНО. Данные приходят готовой строкой допуска
 * (`ClearanceRow`) — тем же расчётом, что видит сам работник и по которому
 * сервер пускает смену. Полей «объект» и «установка» в этом расчёте нет, и
 * выдумывать их нельзя: вместо значения стоит прочерк. Так же и с
 * требованиями — если по требованию нет данных, статус «Нет данных», а не
 * зелёное «пройдено».
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatRuDate } from '@/lib/format';
import { ROLE_LABELS, type UserRole } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { PilingIcon, type PilingIconName } from '@/components/piling/icons';
import { card, ScreenTitle, StatusPill } from '../settings/shared-ui';
import { SAFETY_INSTRUCTIONS } from '@/modules/safety/instructions';
import { EquipmentPermitMatrix } from './equipment-permit-matrix';

/**
 * Строка допуска работника. Живёт здесь, рядом с карточкой: список
 * «Сотрудники» и карточка показывают один и тот же расчёт, и типу нельзя
 * разойтись между двумя файлами.
 */
export interface ClearanceRow {
  userId: string;
  name: string;
  role: string;
  cleared: boolean;
  blockers: string[];
  warnings: string[];
  nextExpiryAt: string | null;
  knowledge: { status: 'valid' | 'expired' | 'never'; validUntil: string | null; result: string | null };
  lastInstructionAt: string | null;
  acquainted: boolean;
  pendingInstructions: string[];
  overdueBriefings: string[];
}

type EmployeeCardTab =
  | 'profile' | 'permits' | 'briefings' | 'medical'
  | 'knowledge' | 'acquaintance' | 'documents';

const TABS: ReadonlyArray<{ id: EmployeeCardTab; label: string }> = [
  { id: 'profile', label: 'Профиль' },
  { id: 'permits', label: 'Допуски' },
  { id: 'briefings', label: 'Инструктажи' },
  { id: 'medical', label: 'Медосмотр' },
  { id: 'knowledge', label: 'Проверка знаний' },
  { id: 'acquaintance', label: 'Ознакомление с инструкциями' },
  { id: 'documents', label: 'Документы' },
];

const KNOWLEDGE_LABEL: Record<ClearanceRow['knowledge']['status'], string> = {
  valid: 'Пройдено',
  expired: 'Просрочено',
  never: 'Не сдавал',
};

const ACTION_TONE_CLASS: Record<'danger' | 'warning', string> = {
  danger: 'bg-destructive/10 text-destructive-strong',
  warning: 'bg-warning/10 text-warning-strong',
};

interface AttentionAction {
  text: string;
  tone: 'danger' | 'warning';
  icon: PilingIconName;
}

export function EmployeeCard({
  row,
  editable,
  onBack,
  onGoTo,
}: {
  row: ClearanceRow;
  /** Может ли текущий пользователь выдавать допуски (`users.manage`). */
  editable: boolean;
  onBack: () => void;
  onGoTo: (view: 'knowledge' | 'briefings' | 'instructions' | 'documents' | 'employees') => void;
}) {
  // Допуск открывается первым: это главный вопрос карточки — «на чём он вправе
  // работать и что делать».
  const [tab, setTab] = useState<EmployeeCardTab>('permits');

  const roleLabel = ROLE_LABELS[row.role as UserRole] ?? row.role;
  const medicalLine = [...row.blockers, ...row.warnings]
    .find((text) => text.toLocaleLowerCase('ru-RU').includes('медосмотр')) ?? null;

  // Препятствия и предупреждения — уже готовые строки из расчёта допуска.
  // Порядок — это срочность: препятствия выше предупреждений.
  const actions: AttentionAction[] = [
    ...row.blockers.map((text): AttentionAction => ({ text, tone: 'danger', icon: 'defect' })),
    ...row.overdueBriefings.map((text): AttentionAction => ({ text, tone: 'danger', icon: 'risk' })),
    ...row.pendingInstructions.map((text): AttentionAction => ({ text, tone: 'warning', icon: 'documents' })),
    ...row.warnings.map((text): AttentionAction => ({ text, tone: 'warning', icon: 'risk' })),
  ];

  const hasBlocker = row.blockers.length > 0;
  const hasWarning = row.warnings.length > 0
    || row.overdueBriefings.length > 0
    || row.pendingInstructions.length > 0;
  const riskTone: 'success' | 'warning' | 'danger' = hasBlocker ? 'danger' : hasWarning ? 'warning' : 'success';
  const riskLabel = hasBlocker ? 'Высокий риск' : hasWarning ? 'Средний риск' : 'Низкий риск';
  const riskPercent = hasBlocker ? 75 : hasWarning ? 45 : 20;

  const checklist: Array<{ label: string; ok: boolean; detail?: string }> = [
    { label: 'Все обязательные требования пройдены', ok: row.blockers.length === 0 },
    { label: 'Действующие допуски', ok: row.cleared },
    { label: 'Нет просроченных документов', ok: row.blockers.length === 0 },
    { label: 'Следующее событие', ok: Boolean(row.nextExpiryAt), detail: row.nextExpiryAt ? formatRuDate(row.nextExpiryAt) : '—' },
  ];

  // Пять обязательных требований. Где расчёт допуска не даёт данных — честный
  // «Нет данных», и цвет нейтральный: зелёный здесь означал бы проверенность,
  // которой нет.
  const requirementTone = (issue: boolean, warning: boolean): 'success' | 'warning' | 'danger' | 'neutral' =>
    issue ? 'danger' : warning ? 'warning' : 'neutral';
  const requirements: Array<{ title: string; status: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; detail: string }> = [
    {
      title: 'Медосмотр',
      status: medicalLine ? (row.blockers.includes(medicalLine) ? 'Просрочен' : 'Скоро истекает') : 'Нет данных',
      tone: requirementTone(row.blockers.includes(medicalLine ?? ''), Boolean(medicalLine)),
      detail: row.nextExpiryAt ? `до ${formatRuDate(row.nextExpiryAt)}` : 'срок не указан',
    },
    {
      title: 'Удостоверение оператора',
      status: row.blockers.some((text) => text.toLocaleLowerCase('ru-RU').includes('удостовер')) ? 'Просрочено' : 'Нет данных',
      tone: requirementTone(row.blockers.some((text) => text.toLocaleLowerCase('ru-RU').includes('удостовер')), false),
      detail: 'по данным обязательных документов',
    },
    {
      title: 'СИЗ',
      status: 'Нет данных',
      tone: 'neutral',
      detail: 'выдача СИЗ не ведётся в этом контуре',
    },
    {
      title: 'Инструктажи',
      status: row.overdueBriefings.length > 0 ? 'Просрочен' : row.lastInstructionAt ? 'В норме' : 'Нет данных',
      tone: row.overdueBriefings.length > 0 ? 'danger' : row.lastInstructionAt ? 'success' : 'neutral',
      detail: row.lastInstructionAt ? `последний ${formatRuDate(row.lastInstructionAt)}` : 'записей нет',
    },
    {
      title: 'Проверка знаний',
      status: KNOWLEDGE_LABEL[row.knowledge.status],
      tone: row.knowledge.status === 'valid' ? 'success' : row.knowledge.status === 'expired' ? 'danger' : 'neutral',
      detail: row.knowledge.validUntil ? `до ${formatRuDate(row.knowledge.validUntil)}` : 'срок не указан',
    },
  ];

  return (
    <>
      <ScreenTitle
        heading="Карточка сотрудника — ТБ и допуски"
        subtitle="Личные данные, допуски, документы и прохождение требований по технике безопасности"
        actions={(
          <Button variant="outline" onClick={onBack}>← Назад к списку</Button>
        )}
      />

      <div role="tablist" aria-label="Разделы карточки сотрудника"
        className="mb-3 flex h-11 items-center gap-1 overflow-x-auto border-b border-border">
        {TABS.map((item) => {
          const selected = tab === item.id;
          return (
            <button key={item.id} type="button" role="tab" aria-selected={selected}
              onClick={() => setTab(item.id)}
              className={cn(
                'relative flex h-11 flex-none items-center whitespace-nowrap px-3 text-sm transition-colors',
                selected ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground hover:text-foreground',
              )}>
              {item.label}
              {selected && <span aria-hidden="true" className="absolute inset-x-1 bottom-0 h-0.5 bg-signal" />}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[320px_minmax(0,1fr)_300px]">
        {/* Левая колонка — профиль и обязательные требования. */}
        <div className="space-y-3">
          <section className={cn(card, 'p-3')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold">{row.name}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{roleLabel}</p>
              </div>
              <StatusPill tone={row.cleared ? 'success' : 'danger'}>
                {row.cleared ? 'Допущен' : 'Нет допуска'}
              </StatusPill>
            </div>
            <dl className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Объект</dt>
                <dd className="font-medium">—</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Установка (основная)</dt>
                <dd className="font-medium">—</dd>
              </div>
            </dl>
          </section>

          <section className={cn(card, 'p-3')}>
            <h2 className="font-bold">Обязательные требования</h2>
            <ul className="mt-2 space-y-2">
              {requirements.map((item) => (
                <li key={item.title} className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">{item.title}</div>
                    <div className="text-2xs text-muted-foreground">{item.detail}</div>
                  </div>
                  <StatusPill tone={item.tone}>{item.status}</StatusPill>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Центральная колонка — содержимое выбранной вкладки. */}
        <div className="min-w-0 space-y-3">
          {tab === 'permits' && (
            <EquipmentPermitMatrix userId={row.userId} userName={row.name} editable={editable} />
          )}

          {tab === 'profile' && (
            <section className={cn(card, 'p-3')}>
              <h2 className="font-bold">Профиль</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Данные карточки берутся из учётной записи и расчёта допуска. Объект и основную
                установку ведёт кадровый раздел — здесь они появятся, когда попадут в допуск.
              </p>
              <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-border bg-muted/30 p-2">
                  <dt className="text-2xs text-muted-foreground">ФИО</dt>
                  <dd className="mt-0.5 font-medium">{row.name}</dd>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2">
                  <dt className="text-2xs text-muted-foreground">Должность</dt>
                  <dd className="mt-0.5 font-medium">{roleLabel}</dd>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2">
                  <dt className="text-2xs text-muted-foreground">Статус допуска</dt>
                  <dd className="mt-0.5 font-medium">{row.cleared ? 'Допущен' : 'Нет допуска'}</dd>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2">
                  <dt className="text-2xs text-muted-foreground">Ближайший срок</dt>
                  <dd className="mt-0.5 font-medium">{row.nextExpiryAt ? formatRuDate(row.nextExpiryAt) : '—'}</dd>
                </div>
              </dl>
            </section>
          )}

          {tab === 'briefings' && (
            <section className={cn(card, 'p-3')}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold">История инструктажей</h2>
                <button type="button" onClick={() => onGoTo('briefings')} className="text-xs font-medium text-info hover:underline">
                  Вся история →
                </button>
              </div>
              {row.lastInstructionAt === null && row.overdueBriefings.length === 0 && row.pendingInstructions.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Записей пока нет.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border text-sm">
                  {row.lastInstructionAt && (
                    <li className="py-2">Последний инструктаж: {formatRuDate(row.lastInstructionAt)}</li>
                  )}
                  {row.overdueBriefings.map((text) => (
                    <li key={text} className="py-2 text-destructive-strong">{text}</li>
                  ))}
                  {row.pendingInstructions.map((text) => (
                    <li key={text} className="py-2 text-warning-strong">{text}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {tab === 'medical' && (
            <section className={cn(card, 'p-3')}>
              <h2 className="font-bold">Медосмотр</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Медосмотр ведётся как обязательный документ. Отдельного заключения в этом контуре нет —
                статус собирается из сроков документа.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <StatusPill tone={requirementTone(row.blockers.includes(medicalLine ?? ''), Boolean(medicalLine))}>
                  {medicalLine ? (row.blockers.includes(medicalLine) ? 'Просрочен' : 'Скоро истекает') : 'Нет данных'}
                </StatusPill>
                <span className="text-xs text-muted-foreground">
                  {row.nextExpiryAt ? `ближайший срок ${formatRuDate(row.nextExpiryAt)}` : 'срок не указан'}
                </span>
              </div>
              {medicalLine && <p className="mt-2 text-xs text-destructive-strong">{medicalLine}</p>}
            </section>
          )}

          {tab === 'knowledge' && (
            <section className={cn(card, 'p-3')}>
              <h2 className="font-bold">Проверка знаний по ТБ</h2>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-border bg-muted/30 p-2">
                  <div className="text-2xs text-muted-foreground">Последний результат</div>
                  <div className="mt-0.5 font-semibold">{KNOWLEDGE_LABEL[row.knowledge.status]}</div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2">
                  <div className="text-2xs text-muted-foreground">Балл</div>
                  <div className="mt-0.5 font-semibold">{row.knowledge.result ?? '—'}</div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2">
                  <div className="text-2xs text-muted-foreground">Дата проверки</div>
                  <div className="mt-0.5 font-semibold">{row.lastInstructionAt ? formatRuDate(row.lastInstructionAt) : '—'}</div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2">
                  <div className="text-2xs text-muted-foreground">Действительна до</div>
                  <div className="mt-0.5 font-semibold">{row.knowledge.validUntil ? formatRuDate(row.knowledge.validUntil) : '—'}</div>
                </div>
              </div>
              <Button variant="outline" className="mt-3" onClick={() => onGoTo('knowledge')}>
                Назначить повторно
              </Button>
            </section>
          )}

          {tab === 'acquaintance' && (
            <section className={cn(card, 'p-3')}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold">Ознакомление с инструкциями</h2>
                <button type="button" onClick={() => onGoTo('briefings')} className="text-xs font-medium text-info hover:underline">
                  Открыть журнал →
                </button>
              </div>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-2xs uppercase text-muted-foreground">
                      <th scope="col" className="py-2 pr-3 font-semibold">Инструкция</th>
                      <th scope="col" className="py-2 pr-3 font-semibold">Версия</th>
                      <th scope="col" className="py-2 font-semibold">Статус</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {SAFETY_INSTRUCTIONS.map((instruction) => {
                      const pending = row.pendingInstructions.some((text) => text.includes(instruction.title));
                      return (
                        <tr key={instruction.code}>
                          <td className="py-2 pr-3">
                            <div className="font-medium">{instruction.title}</div>
                            <div className="text-2xs text-muted-foreground">{instruction.code} · {instruction.audience}</div>
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap text-xs">в. {instruction.version}</td>
                          <td className="py-2 whitespace-nowrap">
                            <StatusPill tone={pending ? 'warning' : 'success'}>
                              {pending ? 'Ожидает' : 'Ознакомлен'}
                            </StatusPill>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!row.acquainted && (
                <p className="mt-2 text-2xs text-muted-foreground">
                  Отметка означает ознакомление с действующей редакцией. Новая редакция требует
                  повторного прочтения.
                </p>
              )}
            </section>
          )}

          {tab === 'documents' && (
            <section className={cn(card, 'p-3')}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold">Документы ТБ</h2>
                <button type="button" onClick={() => onGoTo('documents')} className="text-xs font-medium text-info hover:underline">
                  Все документы →
                </button>
              </div>
              {row.blockers.length === 0 && row.warnings.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Замечаний по документам нет.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border text-sm">
                  {row.blockers.map((text) => (
                    <li key={text} className="py-2 text-destructive-strong">{text}</li>
                  ))}
                  {row.warnings.map((text) => (
                    <li key={text} className="py-2 text-warning-strong">{text}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        {/* Правая колонка — ближайшие действия и риск допуска. */}
        <div className="space-y-3">
          <section className={cn(card, 'p-3')}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold">Ближайшие действия</h2>
              <button type="button" onClick={() => onGoTo('employees')} className="text-xs font-medium text-info hover:underline">
                Все действия →
              </button>
            </div>
            {actions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Ничего не требует решения.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {actions.map((item, index) => (
                  <li key={`${item.text}-${index}`} className="flex gap-2 py-2">
                    <span className={cn('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full', ACTION_TONE_CLASS[item.tone])}>
                      <PilingIcon name={item.icon} size={13} decorative />
                    </span>
                    <div className="min-w-0 text-sm leading-snug">{item.text}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={cn(card, 'p-3')}>
            <h2 className="font-bold">Риск допуска</h2>
            <div className="mt-2 flex items-center gap-2">
              <StatusPill tone={riskTone}>{riskLabel}</StatusPill>
              <span className="text-xs text-muted-foreground">{riskPercent}%</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div
                className={cn('h-full rounded-full',
                  riskTone === 'success' ? 'bg-success' : riskTone === 'warning' ? 'bg-warning' : 'bg-destructive')}
                style={{ width: `${riskPercent}%` }}
              />
            </div>
            <ul className="mt-3 space-y-1.5 text-xs">
              {checklist.map((item) => (
                <li key={item.label} className="flex items-center gap-2">
                  <PilingIcon name={item.ok ? 'accepted' : 'risk'} size={12}
                    tone={item.ok ? 'primary' : 'neutral'} decorative />
                  <span className={item.ok ? '' : 'text-warning-strong'}>{item.label}</span>
                  {item.detail && <span className="ml-auto text-muted-foreground">{item.detail}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
