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
}

export interface AuthoritativeReadinessPresentation {
  mode: 'authoritative' | 'historical-incomplete' | 'missing' | 'malformed';
  status: 'READY' | 'BLOCKED' | 'UNCONFIRMED';
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
    {key: 'equipment', label: 'Установка', reference: evidence.equipmentId},
    {key: 'evaluation', label: 'Расчёт выполнен', reference: evidence.evaluatedAt},
  ];
  if (evidence.inspectionId) evidenceCards.push({key: 'inspection', label: 'Осмотр', reference: evidence.inspectionId});
  if (evidence.permitId) evidenceCards.push({key: 'permit', label: 'Допуск', reference: evidence.permitId});
  if (evidence.maintenanceRecordIds.length > 0) {
    evidenceCards.push({key: 'maintenance', label: 'Записи ТО', reference: evidence.maintenanceRecordIds.join(', ')});
  }

  return {
    mode: 'authoritative',
    status: snapshot.status,
    score: snapshot.score,
    title: snapshot.status === 'READY' ? 'Готовность подтверждена' : 'Запуск заблокирован',
    description: snapshot.status === 'READY'
      ? 'Решение подтверждено сохранёнными фактами и доказательствами.'
      : 'До запуска необходимо устранить авторитетные блокирующие условия.',
    nextAction: blockers[0]?.actionLabel
      ?? (snapshot.status === 'READY'
        ? 'Авторитетная оценка подтверждает готовность к работе'
        : 'Устранить блокирующие условия и выполнить новую оценку'),
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
