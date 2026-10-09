import type { CurrentReadinessDto, DefectDto, ReadinessShiftDto, WorkPermitDto } from './to/readiness/api/contracts';
import { isOverduePermit } from './to/readiness/screens/permit-role-steps';

/** Строка в блоке «Требует решения сейчас»: что случилось, кто решает, что сделать, куда идти. */
export interface AttentionItem {
  id: string;
  problem: string;
  role: string;
  action: string;
  href: string;
}

export interface DocumentControlRow {
  user: { id: string; name: string };
  expiry: { status: 'ok' | 'expiring' | 'expired' | 'perpetual' };
}

/**
 * Источник `null` — данные не прочитаны (нет права или сбой): по нему ничего не
 * утверждаем. Пустой список — «прочитано, проблем нет».
 */
export interface AttentionInput {
  permits: readonly WorkPermitDto[] | null;
  shifts: readonly ReadinessShiftDto[] | null;
  current: readonly CurrentReadinessDto[] | null;
  defects: readonly DefectDto[] | null;
  documents: readonly DocumentControlRow[] | null;
  equipmentName: (equipmentId: string) => string;
  now: Date;
}

/**
 * Только то, что нельзя оставить на потом: каждая строка называет проблему,
 * роль, которая её решает, и действие. Порядок — от наряда до удостоверений:
 * сначала то, что закрывает допуск техники, потом людей.
 */
export function buildAttentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (input.permits) {
    const overdue = input.permits.filter((permit) => isOverduePermit(permit, input.now));
    if (overdue.length > 0) {
      items.push({
        id: 'permits-overdue',
        problem: `Наряды-допуски: просрочено ${overdue.length}, согласовать нельзя`,
        role: 'Инженер ОТ',
        action: 'Оформить новые',
        href: '/admin/safety?view=permits&filter=overdue',
      });
    }
  }

  if (input.shifts) {
    const inspected = new Map((input.current ?? []).map((item) => [item.equipmentId, item.facts?.inspectionCompleted === true]));
    const seen = new Set<string>();
    for (const shift of input.shifts) {
      if (shift.state !== 'PENDING_ACCEPTANCE' || seen.has(shift.equipmentId)) continue;
      // Без расчёта готовности осмотр неизвестен: утверждать «осмотра нет» нельзя.
      if (input.current === null || inspected.get(shift.equipmentId) !== false) continue;
      seen.add(shift.equipmentId);
      items.push({
        id: `shift-${shift.id}`,
        problem: `${input.equipmentName(shift.equipmentId)}: смена ждёт допуска, осмотра нет`,
        role: 'Диспетчер',
        action: 'Допустить',
        href: `/admin/to?view=shifts&equipmentId=${encodeURIComponent(shift.equipmentId)}`,
      });
    }
  }

  if (input.defects) {
    const seen = new Set<string>();
    for (const defect of input.defects) {
      if (defect.severity !== 'CRITICAL' || (defect.status !== 'OPEN' && defect.status !== 'IN_WORK')) continue;
      if (seen.has(defect.equipmentId)) continue;
      seen.add(defect.equipmentId);
      items.push({
        id: `defect-${defect.id}`,
        problem: `${input.equipmentName(defect.equipmentId)}: критический дефект, установка не допущена`,
        role: 'Механик',
        action: defect.status === 'OPEN' ? 'Взять в работу' : 'Закрыть дефект',
        href: `/admin/to?view=maintenance&equipmentId=${encodeURIComponent(defect.equipmentId)}`,
      });
    }
  }

  if (input.documents) {
    const people = new Set(input.documents.filter((row) => row.expiry.status === 'expired').map((row) => row.user.id));
    if (people.size > 0) {
      items.push({
        id: 'documents-expired',
        problem: `Документы: просрочены у ${people.size} ${people.size === 1 ? 'работника' : 'работников'}`,
        role: 'Инженер ОТ',
        action: 'Открыть документы',
        href: '/admin/safety?view=documents',
      });
    }
  }

  return items;
}
