import {
  OUTCOME_LABELS,
  resolveReadinessOutcome,
  type ReadinessOutcome,
} from '@/modules/readiness';
import type {
  CurrentReadinessDto,
  ReadinessSnapshotDto,
} from './api/contracts';

export interface PresentationNotice {
  code: string;
  label: string;
  actionLabel: string | null;
}

export interface PresentationStage {
  key: 'INSPECTION' | 'ENGINE_HOURS' | 'PERMIT' | 'MAINTENANCE' | 'ACCEPTANCE';
  label: string;
  value: string;
  state: 'pass' | 'warning' | 'fail' | 'unknown';
}

export interface PresentationEvidence {
  key: 'equipment' | 'inspection' | 'permit' | 'maintenance' | 'evaluation';
  label: string;
  reference: string;
  /**
   * Ссылки на исходные записи. Без них доказательство оставалось голым
   * идентификатором: проверить, на чём основано решение, было не по чему.
   * Пусто там, где отдельной страницы у сущности нет.
   */
  links?: readonly { text: string; href: string }[];
}

export interface AuthoritativeReadinessPresentation {
  mode: 'authoritative' | 'historical-incomplete' | 'missing' | 'malformed';
  status: 'READY' | 'BLOCKED' | 'UNCONFIRMED';
  /**
   * Исход для человека: готова / готова с замечанием / требует решения /
   * заблокирована. `status` остаётся двоичным для совместимости со старыми
   * снимками и внешними потребителями.
   */
  outcome: ReadinessOutcome | 'UNCONFIRMED';
  score: number | null;
  title: string;
  description: string;
  nextAction: string;
  blockers: readonly PresentationNotice[];
  warnings: readonly PresentationNotice[];
  stages: readonly [PresentationStage, PresentationStage, PresentationStage, PresentationStage, PresentationStage];
  evidence: readonly PresentationEvidence[];
  calculatedAt: string | null;
  ruleSetVersion: string | null;
}

type Snapshot = CurrentReadinessDto | ReadinessSnapshotDto;

interface EvidenceRecord {
  equipmentId: string;
  inspectionId: string | null;
  permitId: string | null;
  maintenanceRecordIds: string[];
  evaluatedAt: string;
}

const UNKNOWN_STAGES: AuthoritativeReadinessPresentation['stages'] = [
  {key: 'INSPECTION', label: 'Осмотр', value: 'Нет подтверждённых фактов', state: 'unknown'},
  {key: 'ENGINE_HOURS', label: 'Моточасы', value: 'Нет подтверждённых фактов', state: 'unknown'},
  {key: 'PERMIT', label: 'Допуск', value: 'Нет подтверждённых фактов', state: 'unknown'},
  {key: 'MAINTENANCE', label: 'Техническое обслуживание', value: 'Нет подтверждённых фактов', state: 'unknown'},
  {key: 'ACCEPTANCE', label: 'Приёмка', value: 'Нет подтверждённых фактов', state: 'unknown'},
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function evidenceRecord(value: unknown): EvidenceRecord | null {
  if (!isRecord(value)
    || typeof value.equipmentId !== 'string'
    || (value.inspectionId !== null && typeof value.inspectionId !== 'string')
    || (value.permitId !== null && typeof value.permitId !== 'string')
    || !Array.isArray(value.maintenanceRecordIds)
    || !value.maintenanceRecordIds.every((item) => typeof item === 'string')
    || typeof value.evaluatedAt !== 'string') return null;
  return value as unknown as EvidenceRecord;
}

function notices(value: unknown, warning = false): PresentationNotice[] | null {
  if (!Array.isArray(value)) return null;
  const result: PresentationNotice[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const label = warning ? item.message : item.label;
    if (typeof label !== 'string') return null;
    const code = typeof item.code === 'string'
      ? item.code
      : typeof item.condition === 'string' ? item.condition : 'READINESS_NOTICE';
    result.push({
      code,
      label,
      actionLabel: typeof item.actionLabel === 'string' ? item.actionLabel : null,
    });
  }
  return result;
}

function unconfirmed(
  mode: Exclude<AuthoritativeReadinessPresentation['mode'], 'authoritative'>,
  snapshot: Snapshot | null,
): AuthoritativeReadinessPresentation {
  const copy = mode === 'historical-incomplete'
    ? {
        title: 'Исторические доказательства неполны',
        description: 'Снимок создан до сохранения точных фактов. Его балл нельзя использовать как полное доказательство решения.',
        nextAction: 'Выполнить новую авторитетную оценку',
      }
    : mode === 'missing'
      ? {
          title: 'Авторитетная оценка ещё не выполнена',
          description: 'Для выбранной установки нет подтверждённого снимка готовности.',
          nextAction: 'Запустить авторитетную оценку',
        }
      : {
          title: 'Авторитетная оценка недоступна',
          description: 'Снимок не прошёл проверку контракта доказательств и не может подтверждать готовность.',
          nextAction: 'Обновить оценку и проверить источник данных',
        };
  return {
    mode,
    status: 'UNCONFIRMED',
    outcome: 'UNCONFIRMED',
    score: null,
    ...copy,
    blockers: [],
    warnings: [],
    stages: UNKNOWN_STAGES,
    evidence: [],
    calculatedAt: snapshot?.calculatedAt ?? null,
    ruleSetVersion: snapshot?.ruleSetVersion ?? null,
  };
}

export function buildAuthoritativeReadinessPresentation(
  snapshot: Snapshot | null,
): AuthoritativeReadinessPresentation {
  if (!snapshot) return unconfirmed('missing', null);
  if (!snapshot.facts) return unconfirmed('historical-incomplete', snapshot);

  const evidence = evidenceRecord(snapshot.evidence);
  const blockers = notices(snapshot.blockers);
  const warnings = notices(snapshot.warnings, true);
  if (!evidence || !blockers || !warnings) return unconfirmed('malformed', snapshot);

  const facts = snapshot.facts;
  const stages: AuthoritativeReadinessPresentation['stages'] = [
    {
      key: 'INSPECTION', label: 'Осмотр',
      value: facts.inspectionCompleted
        ? `Завершён · ${Math.round(facts.inspectionProgress * 100)}%`
        : `Не завершён · ${Math.round(facts.inspectionProgress * 100)}%`,
      state: facts.inspectionCompleted ? 'pass' : facts.inspectionProgress > 0 ? 'warning' : 'fail',
    },
    {
      key: 'ENGINE_HOURS', label: 'Моточасы',
      value: facts.meterKnown ? 'Показания подтверждены' : 'Показания отсутствуют',
      state: facts.meterKnown ? 'pass' : 'fail',
    },
    {
      key: 'PERMIT', label: 'Допуск',
      value: facts.permitValid === null
        ? 'Не требуется правилами'
        : facts.permitValid && !facts.permitExpired ? 'Действует' : facts.permitExpired ? 'Просрочен' : 'Не подтверждён',
      state: facts.permitValid === null ? 'pass' : facts.permitValid && !facts.permitExpired ? 'pass' : 'fail',
    },
    {
      key: 'MAINTENANCE', label: 'Техническое обслуживание',
      value: !facts.maintenanceConfigured
        ? 'Регламент не настроен'
        : facts.maintenanceOverdueHours > 0
          ? `Перепробег ${facts.maintenanceOverdueHours} м/ч`
          : facts.maintenanceOverdueDays > 0 ? `Просрочено на ${facts.maintenanceOverdueDays} дн.` : 'Срок не нарушен',
      state: facts.maintenanceConfigured
        && facts.maintenanceOverdueHours === 0
        && facts.maintenanceOverdueDays === 0 ? 'pass' : 'fail',
    },
    {
      key: 'ACCEPTANCE', label: 'Приёмка',
      value: facts.accepted ? 'Подтверждена' : 'Не подтверждена',
      state: facts.accepted ? 'pass' : 'fail',
    },
  ];

  const evidenceCards: PresentationEvidence[] = [
    {key: 'equipment', label: 'Установка', reference: evidence.equipmentId,
      links: [{text: 'Открыть карточку установки', href: `/admin/equipment/${evidence.equipmentId}`}]},
    {key: 'evaluation', label: 'Расчёт выполнен', reference: evidence.evaluatedAt},
  ];
  if (evidence.inspectionId) {
    evidenceCards.push({key: 'inspection', label: 'Осмотр', reference: evidence.inspectionId,
      links: [{text: 'Открыть осмотр', href: `/inspections/${evidence.inspectionId}`}]});
  }
  if (evidence.permitId) {
    // Отдельной страницы у наряда нет — ведём на реестр внутри контура.
    evidenceCards.push({key: 'permit', label: 'Допуск', reference: evidence.permitId,
      links: [{text: 'Открыть реестр нарядов', href: '/admin/to?view=permits'}]});
  }
  if (evidence.maintenanceRecordIds.length > 0) {
    evidenceCards.push({key: 'maintenance', label: 'Записи ТО',
      reference: evidence.maintenanceRecordIds.join(', '),
      links: evidence.maintenanceRecordIds.map((id, index) => ({
        text: `Заявка ${index + 1}`, href: `/admin/maintenance/${id}`,
      }))});
  }

  // Исход из полного вердикта, если снимок его знает. У снимков до 2026-08-13
  // колонки нет — для них остаётся прежнее двоичное прочтение.
  const outcome: ReadinessOutcome = snapshot.verdict
    ? resolveReadinessOutcome({verdict: snapshot.verdict, warningCount: warnings.length})
    : snapshot.status === 'READY'
      ? (warnings.length > 0 ? 'READY_WITH_WARNING' : 'READY')
      : 'BLOCKED';

  const OUTCOME_DESCRIPTION: Record<ReadinessOutcome, string> = {
    READY: 'Решение подтверждено сохранёнными фактами и доказательствами.',
    READY_WITH_WARNING: 'Работать можно. Есть замечания, которые не останавливают запуск, но требуют внимания.',
    ATTENTION: 'Запуск не запрещён, но решение не закрыто: требуется действие ответственного.',
    BLOCKED: 'До запуска необходимо устранить авторитетные блокирующие условия.',
  };

  const OUTCOME_NEXT: Record<ReadinessOutcome, string> = {
    READY: 'Авторитетная оценка подтверждает готовность к работе',
    READY_WITH_WARNING: 'Можно работать — разберите замечания в ближайшую смену',
    ATTENTION: 'Требуется решение ответственного',
    BLOCKED: 'Устранить блокирующие условия и выполнить новую оценку',
  };

  return {
    mode: 'authoritative',
    status: snapshot.status,
    outcome,
    score: snapshot.score,
    title: OUTCOME_LABELS[outcome],
    description: OUTCOME_DESCRIPTION[outcome],
    nextAction: blockers[0]?.actionLabel ?? OUTCOME_NEXT[outcome],
    blockers,
    warnings,
    stages,
    evidence: evidenceCards,
    calculatedAt: snapshot.calculatedAt,
    ruleSetVersion: snapshot.ruleSetVersion,
  };
}

export function buildUnavailableReadinessPresentation(
  snapshot: Snapshot | null,
): AuthoritativeReadinessPresentation {
  return unconfirmed('malformed', snapshot);
}
