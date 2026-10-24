


import { AlertCircle, AlertTriangle, CheckCircle2, FileText, Gauge, Send, Wrench } from '@/components/piling/icons/unified-icons';


import { formatDateTimeInTimezone } from '@/lib/timezone';


import { type HandoverEventKind } from '../handover-journal';

import type { AuthoritativeReadinessFactsDto } from '../api/contracts';
import { type AuthoritativeReadinessPresentation, type PresentationEvidence, type PresentationNotice, type PresentationStage } from '../authoritative-presentation';
import { blockerTone, type BlockerTone, BLOCKER_TONE_LABEL } from './shared';

import type { EquipmentDetailSnapshot, ReferenceView } from './types';

/**
 * Состояние шага читается пилюлей справа, а не из текста значения — так строка
 * чек-листа сканируется одним взглядом, как в утверждённом макете.
 */
export const STAGE_PILL: Record<PresentationStage['state'], { label: string; cls: string }> = {
  pass: { label: 'Выполнено', cls: 'bg-success/10 text-success-strong' },
  warning: { label: 'Есть замечания', cls: 'bg-warning/10 text-warning-strong' },
  fail: { label: 'Не выполнено', cls: 'bg-destructive/10 text-destructive-strong' },
  unknown: { label: 'Ожидает', cls: 'bg-muted text-muted-foreground' },
};

/**
 * Кто отвечает за шаг. По незакрытому шагу видно, на ком стоит процесс:
 * подпись под цепочкой и подсветка карточки в нижней ленте ролей берутся
 * отсюда. Названия обязаны совпадать с ROLE_FLOW — по ним идёт сопоставление.
 */
export const STAGE_OWNER: Record<PresentationStage['key'], string> = {
  INSPECTION: 'Оператор',
  ENGINE_HOURS: 'Оператор',
  PERMIT: 'Администратор',
  MAINTENANCE: 'Механик',
  ACCEPTANCE: 'Диспетчер',
};

/**
 * Моточасы снимает осмотр перед работой, а карточка установки закрыта ролям без
 * права `equipment.read`. Вместо ссылки в тупик такому зрителю показываем, где
 * шаг закрывается: `W66`.
 */
export const ENGINE_HOURS_NOTE = 'Моточасы снимаются в осмотре перед работой';

/** Иконка события журнала передачи. Кружок в ленте вместо безымянной точки. */
export const HANDOVER_ICON: Record<HandoverEventKind, typeof Send> = {
  SUBMITTED: Send,
  REWORKED: AlertCircle,
  ACCEPTED: CheckCircle2,
};

/** Сколько событий передачи видно сразу; остальное — под «полным журналом». */
export const HANDOVER_PREVIEW = 4;

export const HANDOVER_PILL: Record<HandoverEventKind, { label: string; cls: string }> = {
  SUBMITTED: { label: 'Передано', cls: 'border-signal/40 text-signal-strong' },
  REWORKED: { label: 'На доработке', cls: 'border-warning/40 text-warning-strong' },
  ACCEPTED: { label: 'Принято', cls: 'border-border text-muted-foreground' },
};

/**
 * Счёт блокеров по тону действия — тому же, которым блокер красится.
 *
 * Правило «нет осмотра за сегодня» (`RETURN_TO_OPERATOR`) — незакрытый шаг, а
 * не критический дефект; «нужно подтверждение» (`REQUIRE_CONFIRMATION`) —
 * решение ответственного. Раньше плитка и блок называли ЛЮБОЙ блокер
 * критическим. Неизвестное действие `blockerTone` относит к строгому запрету,
 * поэтому в «Критические» попадает и оно: недооценить блокировку пуска хуже,
 * чем перестраховаться. Сами условия допуска остаются блокерами — меняется
 * лишь подпись и цвет счётчика.
 */
export function countBlockersByTone(blockers: readonly PresentationNotice[]): Record<BlockerTone, number> {
  const counts: Record<BlockerTone, number> = { critical: 0, attention: 0, info: 0 };
  for (const notice of blockers) counts[blockerTone(notice.action)] += 1;
  return counts;
}

/** Слово-итог счётчика по тону блокера: «Критическое» — только строгий запрет. */
export const BLOCKER_COUNT_LABEL: Record<BlockerTone, string> = {
  critical: 'Критические',
  attention: BLOCKER_TONE_LABEL.attention,
  info: BLOCKER_TONE_LABEL.info,
};

/** Заливка счётчика по тону блокера: красная — только у запрета пуска. */
export const BLOCKER_COUNT_CLASS: Record<BlockerTone, string> = {
  critical: 'bg-destructive/10 text-destructive-strong',
  attention: 'bg-warning/10 text-warning-strong',
  info: 'bg-info/10 text-info-strong',
};

interface ReadinessMetricTile {
  key: string;
  label: string;
  icon: typeof FileText;
  pill: { label: string; cls: string };
  rows: Array<{ caption: string; value: string }>;
  href?: string;
  view?: ReferenceView;
  /** Строка вместо кнопки, когда адреса нет: например, моточасы без карточки установки. */
  note?: string;
}

/**
 * Плитки доказательств: показатель, а не идентификатор.
 *
 * Раньше здесь печатались ссылки на сущности («Установка», «Расчёт выполнен»)
 * и до семи строк «Заявка N» подряд — по ним нельзя было понять состояние, не
 * открыв каждую. Метрики берутся из фактов авторитетного снимка; сами
 * идентификаторы никуда не делись — они под «Смотреть всё».
 */
export function buildReadinessMetricTiles(
  facts: AuthoritativeReadinessFactsDto | null,
  presentation: AuthoritativeReadinessPresentation,
  equipmentId: string,
  engineHoursTotal: number | null | undefined,
  detail: EquipmentDetailSnapshot | undefined,
  inspectionHref: string | null,
  mayOpenEquipmentCard: boolean,
): ReadinessMetricTile[] {
  const inspectionStage = presentation.stages.find((stage) => stage.key === 'INSPECTION');
  const maintenanceStage = presentation.stages.find((stage) => stage.key === 'MAINTENANCE');
  const lastInspection = detail?.latestInspection ?? null;
  // Пункты, а не процент: доля из facts — это флаг «завершён / начат / нет»,
  // по ней нельзя сказать, сколько строк чек-листа реально заполнено.
  // Пустая карточка машины — это незнание, а не факт о технике: деталь могла
  // не загрузиться отказом по правам или сбоем сети.
  const inspectionItems = !detail
    ? 'нет данных'
    : !lastInspection
      ? 'осмотра ещё не было'
      : lastInspection.itemsTotal === 0
        ? 'пункты не заданы'
        : `${lastInspection.itemsAnswered} из ${lastInspection.itemsTotal}`;
  const nextAtHours = detail?.equipment?.nextMaintenanceAtHours;
  const hoursLeft = nextAtHours != null && engineHoursTotal != null
    ? Math.round(nextAtHours - engineHoursTotal)
    : null;
  const nextDate = detail?.equipment?.nextMaintenanceDate;
  const daysLeft = nextDate
    ? Math.ceil((new Date(nextDate).getTime() - Date.now()) / 86_400_000)
    : null;
  // Блокеры одного вердикта разных исходов — «критический» только запрет пуска.
  const blockerTones = countBlockersByTone(presentation.blockers);

  return [
    {
      key: 'inspection',
      label: 'Чек-лист осмотра',
      icon: FileText,
      pill: STAGE_PILL[inspectionStage?.state ?? 'unknown'],
      rows: [{ caption: 'Выполнено пунктов', value: inspectionItems }],
      // Source-aware ссылка из доказательства (журнал ЕО/ТО открывается,
      // чек-лист машиниста — без ссылки). Иначе последний реальный осмотр
      // (валидная сущность /inspections), иначе список. Никогда не сырой
      // inspectionId: он может быть id чек-листа машиниста и вести в 404.
      href: inspectionHref
        ?? (lastInspection ? `/inspections/${lastInspection.id}` : '/inspections'),
    },
    {
      key: 'meter',
      label: 'Моточасы',
      icon: Gauge,
      pill: facts?.meterKnown
        ? { label: 'Выполнено', cls: 'bg-success/10 text-success-strong' }
        : { label: 'Нет показаний', cls: 'bg-muted text-muted-foreground' },
      rows: [{
        caption: 'Текущие моточасы',
        value: engineHoursTotal != null ? `${engineHoursTotal.toLocaleString('ru-RU')} м/ч` : '—',
      }],
      // Карточка установки закрыта роли без `equipment.read` — вместо ссылки в
      // тупик показываем, где моточасы на самом деле снимаются.
      href: mayOpenEquipmentCard ? `/admin/equipment/${equipmentId}` : undefined,
      note: mayOpenEquipmentCard ? undefined : ENGINE_HOURS_NOTE,
    },
    {
      key: 'findings',
      label: 'Замечания и дефекты',
      icon: AlertTriangle,
      pill: blockerTones.critical > 0
        ? { label: 'Есть', cls: BLOCKER_COUNT_CLASS.critical }
        : blockerTones.attention > 0
          ? { label: 'Есть', cls: BLOCKER_COUNT_CLASS.attention }
          : blockerTones.info > 0
            ? { label: 'Есть', cls: BLOCKER_COUNT_CLASS.info }
            : presentation.warnings.length > 0
              ? { label: 'Есть замечания', cls: 'bg-warning/10 text-warning-strong' }
              : { label: 'Нет', cls: 'bg-success/10 text-success-strong' },
      rows: [
        { caption: BLOCKER_COUNT_LABEL.critical, value: String(blockerTones.critical) },
        ...(blockerTones.attention > 0 ? [{ caption: BLOCKER_COUNT_LABEL.attention, value: String(blockerTones.attention) }] : []),
        ...(blockerTones.info > 0 ? [{ caption: BLOCKER_COUNT_LABEL.info, value: String(blockerTones.info) }] : []),
        { caption: 'Обычные', value: String(facts?.findings ?? presentation.warnings.length) },
      ],
      view: 'maintenance',
    },
    {
      key: 'maintenance',
      label: 'Обслуживание ТО',
      icon: Wrench,
      pill: maintenanceStage?.state === 'pass'
        ? { label: 'Актуально', cls: 'bg-success/10 text-success-strong' }
        : { label: 'Требует внимания', cls: 'bg-warning/10 text-warning-strong' },
      rows: [
        {
          caption: 'Ближайшее ТО',
          value: hoursLeft != null
            ? hoursLeft > 0 ? `через ${hoursLeft.toLocaleString('ru-RU')} м/ч` : `перепробег ${Math.abs(hoursLeft).toLocaleString('ru-RU')} м/ч`
            : detail ? 'регламент не задан' : 'нет данных',
        },
        {
          caption: 'Плановое ТО',
          value: daysLeft != null
            ? daysLeft > 0 ? `через ${daysLeft} дн.` : `просрочено на ${Math.abs(daysLeft)} дн.`
            : 'дата не задана',
        },
      ],
      view: 'maintenance',
    },
  ];
}

/**
 * Что показать в карточке доказательства. `reference` — это внутренний
 * идентификатор записи; сам по себе он диспетчеру ничего не говорит, поэтому
 * на видном месте стоит состояние соответствующего критерия, а ссылка ниже
 * ведёт к самой записи.
 */
const EVIDENCE_STAGE: Partial<Record<PresentationEvidence['key'], PresentationStage['key']>> = {
  inspection: 'INSPECTION',
  permit: 'PERMIT',
  maintenance: 'MAINTENANCE',
};

export function evidenceMetric(
  evidence: PresentationEvidence,
  stages: readonly PresentationStage[],
  timezone: string | undefined,
): string {
  if (evidence.key === 'evaluation') {
    return formatDateTimeInTimezone(evidence.reference, timezone);
  }
  if (evidence.key === 'equipment') return 'Запись справочника техники';
  const stageKey = EVIDENCE_STAGE[evidence.key];
  const stage = stageKey ? stages.find((item) => item.key === stageKey) : undefined;
  if (!stage) return evidence.reference;
  return evidence.key === 'maintenance' && evidence.links
    ? `${stage.value} · записей: ${evidence.links.length}`
    : stage.value;
}
