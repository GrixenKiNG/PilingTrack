import {Prisma} from '@/generated/postgres-client/client';
import {db} from '@/lib/db';

/**
 * ЕО и предсменный осмотр, которые машинист проходит на своём экране.
 *
 * Эти осмотры живут в `OperatorChecklistExecution`, а не в журнале осмотров
 * механика (`Inspection`) и не в журнале ТО (`MaintenanceRecord`): с переходом
 * экрана машиниста на чек-листы смены записи в старые журналы перестали
 * попадать (последняя — 19.09.2026), хотя осмотр проходят каждую смену.
 * Карточка установки читает этот список рядом с прежними журналами, ничего в
 * них не дублируя: у осмотра механика побочные эффекты (дефекты, моточасы,
 * наряд ТО), и повторять их здесь значило бы записать всё дважды.
 */
const KIND_LABEL: Record<string, string> = {
  EO_BEFORE: 'ЕО до смены',
  EO_AFTER: 'ЕО после смены',
  PRESHIFT_INSPECTION: 'Предсменный осмотр',
};

export interface EquipmentChecklistRow {
  id: string;
  shiftId: string;
  templateKey: string;
  label: string;
  completedAt: string | null;
  performerName: string | null;
  counts: {ok: number; remark: number; fault: number; na: number};
  /** Снятое машинистом: моточасы, остаток топлива, долив. null — осмотр ничего не снимал. */
  readings: EquipmentChecklistReadings | null;
}

export interface EquipmentChecklistReadings {
  engineHours: number | null;
  fuelPercent: number | null;
  topUps: {coolantL: number | null; hydraulicOilL: number | null; engineOilL: number | null; dieselL: number | null};
}

/** Пункт каталога → его собственный ключ значения (по нему сервер проверяет границы). */
const TOP_UP_ITEM_KEY = {
  'topup-coolant': 'coolantL',
  'topup-hydraulic': 'hydraulicOilL',
  'topup-engine-oil': 'engineOilL',
  'topup-diesel': 'dieselL',
} as const;

/**
 * Показание берём только с «своего» пункта и только по его собственному ключу:
 * моточасы — со снятия счётчика (`meter-*`), остаток — с `fuel-level`, литры — с
 * `topup-*`. Значение с чужого пункта или лишний ключ показывать нельзя: границы
 * проверены сервером именно у этих.
 */
function readingsOf(rows: Array<{itemId: string; value: unknown}>): EquipmentChecklistReadings | null {
  const readings: EquipmentChecklistReadings = {
    engineHours: null, fuelPercent: null,
    topUps: {coolantL: null, hydraulicOilL: null, engineOilL: null, dieselL: null},
  };
  let any = false;
  for (const {itemId, value} of rows) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const num = (key: string) => (typeof record[key] === 'number' && Number.isFinite(record[key]) ? (record[key] as number) : null);
    if (itemId.startsWith('meter')) {
      const hours = num('engineHours');
      if (hours !== null) { readings.engineHours = hours; any = true; }
    } else if (itemId === 'fuel-level') {
      const fuel = num('fuelPercent');
      if (fuel !== null) { readings.fuelPercent = fuel; any = true; }
    } else if (itemId in TOP_UP_ITEM_KEY) {
      const key = TOP_UP_ITEM_KEY[itemId as keyof typeof TOP_UP_ITEM_KEY];
      const liters = num(key);
      if (liters !== null) { readings.topUps[key] = liters; any = true; }
    }
  }
  return any ? readings : null;
}

export async function listEquipmentChecklistHistory(input: {
  tenantId: string; equipmentId: string; limit?: number;
}): Promise<EquipmentChecklistRow[]> {
  const executions = await db.operatorChecklistExecution.findMany({
    where: {
      tenantId: input.tenantId, equipmentId: input.equipmentId, status: 'COMPLETED',
      template: {templateKey: {in: Object.keys(KIND_LABEL)}},
    },
    orderBy: {completedAt: 'desc'},
    take: input.limit ?? 50,
    select: {id: true, shiftId: true, startedById: true, completedAt: true, template: {select: {templateKey: true}}},
  });
  if (executions.length === 0) return [];

  const [answers, valueRows, users] = await Promise.all([
    db.operatorChecklistAnswerRecord.groupBy({
      by: ['executionId', 'result'],
      _count: {_all: true},
      // «Долил за смену» (`topup-*`) — запись литров, а не вердикт осмотра: в «норму»
      // он не считается.
      where: {
        tenantId: input.tenantId,
        executionId: {in: executions.map((item) => item.id)},
        NOT: {itemId: {startsWith: 'topup-'}},
      },
    }),
    // Снятые значения лежат в value ответа: моточасы, остаток топлива, литры долива.
    db.operatorChecklistAnswerRecord.findMany({
      where: {tenantId: input.tenantId, executionId: {in: executions.map((item) => item.id)}, NOT: {value: {equals: Prisma.DbNull}}},
      select: {executionId: true, itemId: true, value: true},
    }),
    db.user.findMany({
      where: {tenantId: input.tenantId, id: {in: [...new Set(executions.map((item) => item.startedById))]}},
      select: {id: true, name: true},
    }),
  ]);
  const names = new Map(users.map((user) => [user.id, user.name]));
  const countsOf = (executionId: string) => {
    const counts = {ok: 0, remark: 0, fault: 0, na: 0};
    for (const row of answers) {
      if (row.executionId !== executionId) continue;
      const key = ({OK: 'ok', REMARK: 'remark', FAULT: 'fault', NA: 'na'} as const)[row.result as 'OK'];
      if (key) counts[key] += row._count._all;
    }
    return counts;
  };

  return executions.map((item) => ({
    id: item.id,
    shiftId: item.shiftId,
    templateKey: item.template.templateKey,
    label: KIND_LABEL[item.template.templateKey] ?? item.template.templateKey,
    completedAt: item.completedAt ? item.completedAt.toISOString() : null,
    performerName: names.get(item.startedById) ?? null,
    counts: countsOf(item.id),
    readings: readingsOf(valueRows.filter((row) => row.executionId === item.id)),
  }));
}
