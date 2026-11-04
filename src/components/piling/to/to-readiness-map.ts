import { OUTCOME_STATUS, STAGE_EVIDENCE_KEY, STAGE_EVIDENCE_STATE } from './to-module-config';
import { deriveEquipmentReadiness, type EquipmentReadiness, type ReadinessEvidence } from './readiness-model';
import { buildAuthoritativeReadinessPresentation, buildUnavailableReadinessPresentation } from './readiness/authoritative-presentation';
import type { EquipmentOption } from './to-module-bits';
import type { JournalRecord } from './to-stats';

interface ReadinessMapBindings {
  currentReadiness: { equipmentId: string; status: "READY" | "BLOCKED"; score: number; calculatedAt: string; blockers: { [x: string]: unknown; label: string; action: string; condition?: string | undefined; code?: string | undefined; actionLabel?: string | undefined; }[]; warnings: unknown; evidence: unknown; facts: { inspectionCompleted: boolean; inspectionProgress: number; healthScore: number | null; meterKnown: boolean; permitValid: boolean | null; permitExpired: boolean; maintenanceConfigured: boolean; maintenanceOverdueHours: number; maintenanceOverdueDays: number; accepted: boolean; criticalDefect: boolean; findings: number; permitCloseReason?: "WORK_DONE" | "VALIDITY_ELAPSED" | null | undefined; } | null; triggerType: string | null; ruleSetVersion: string | null; snapshotId: string; verdict?: "ALLOWED" | "CONFIRMATION_REQUIRED" | "RETURN_TO_OPERATOR" | "DENIED" | null | undefined; equipmentActive?: boolean | undefined; }[];
  equipment: EquipmentOption[];
  journals: Record<string, JournalRecord[]>;
  journalLoaded: Record<string, boolean>;
  authoritativeReadinessError: string | null;
}

export function buildToReadinessMap({ currentReadiness, equipment, journals, journalLoaded, authoritativeReadinessError }: ReadinessMapBindings) {
    // Карточка парка собирается из авторитетного снимка целиком.
    //
    // ЧТО БЫЛО НЕ ТАК. Балл и вердикт брались из снимка, а причина, следующее
    // действие и доказательства — из производной оценки по журналу. Журнал
    // грузится только для выбранной установки, поэтому у остальных эти поля
    // просто затирались пустыми строками. Получалась карточка, где зелёная
    // цифра с сервера соседствует с объяснением из другого расчёта или без
    // объяснения вовсе, — и проверить её было не по чему.
    //
    // Вдобавок вердикт схлопывался в «готово»: снимок хранит `status` из двух
    // значений (READY/BLOCKED), а различие «готова», «готова с замечанием» и
    // «требует решения» живёт в `outcome`. Читая `status`, экран красил
    // зелёным и то, что требует решения диспетчера.
    //
    // Производная оценка остаётся ровно для одного случая — снимка нет вовсе.
    // Тогда честный ответ «не подтверждено», а не выдуманная готовность.
    const authoritative = new Map(currentReadiness.map((item) => [item.equipmentId, item]));
    const entries = equipment.map((item) => {
      const snapshot = authoritative.get(item.id);
      const derived = deriveEquipmentReadiness(
        item,
        journals[item.id] ?? [],
        journalLoaded[item.id] === true,
      );

      // Отказ авторитетного чтения не заменяем производной оценкой: журнал
      // может быть полон и дать зелёный READY, хотя сервер вердикта не вынес
      // (R151 №4). Как в парке и центре, показываем «не подтверждено».
      const presentation = authoritativeReadinessError
        ? buildUnavailableReadinessPresentation(snapshot ?? null)
        : snapshot
          ? buildAuthoritativeReadinessPresentation(snapshot)
          : null;
      if (!presentation) return [item.id, derived] as const;

      if (presentation.status === 'UNCONFIRMED') {
        return [item.id, {
          ...derived,
          status: 'NO_DATA',
          canOperate: false,
          score: presentation.score,
          reason: presentation.description,
          nextAction: presentation.nextAction,
          nextActionHref: '',
          evidence: [],
        } satisfies EquipmentReadiness] as const;
      }

      return [item.id, {
        ...derived,
        score: presentation.score,
        status: OUTCOME_STATUS[presentation.outcome] ?? 'READY',
        canOperate: presentation.outcome === 'READY' || presentation.outcome === 'READY_WITH_WARNING',
        reason: presentation.description,
        nextAction: presentation.nextAction,
        nextActionHref: '',
        evidence: presentation.stages.map((stage): ReadinessEvidence => ({
          key: STAGE_EVIDENCE_KEY[stage.key],
          label: stage.label,
          value: stage.value,
          state: STAGE_EVIDENCE_STATE[stage.state],
        })),
      } satisfies EquipmentReadiness] as const;
    });
    return Object.fromEntries(entries) as Record<string, EquipmentReadiness>;
  }
