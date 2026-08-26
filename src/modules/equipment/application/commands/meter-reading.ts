/**
 * MeterReading — журнал показаний наработки (моточасы).
 *
 * Источник истины наработки — история показаний. Equipment.engineHoursTotal
 * остаётся денормализованным кэшем «последнего показания» (по recordedAt),
 * который синхронизируется здесь на каждое добавление/удаление.
 *
 * Монотонность форсируется для тех, кто снимает показание с машины: счётчик
 * назад не идёт, и цифра меньше предыдущей — это опечатка, а не событие.
 * Исключение остаётся у администратора и механика (`allowDecrease`): счётчик
 * физически меняют, и новый начинает с нуля. Им снижение проходит с warning.
 *
 * Скачок вверх больше `METER_JUMP_WARN_HOURS` не запрещаем — смена столько не
 * идёт, но пропущенный день или ввод задним числом дают законную прибавку.
 * Поэтому предупреждение, а не отказ. Tenant — строгим равенством (IDOR guard).
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { requestReadinessSnapshot } from '@/modules/readiness/application/projection/request-snapshot';

export type MeterSource = 'MANUAL' | 'TELEMETRY';

/**
 * Прибавка за одно показание, выше которой цифра выглядит опечаткой.
 * Двадцать часов — заведомо больше самой длинной смены, так что честная запись
 * в такую прибавку не укладывается почти никогда.
 */
export const METER_JUMP_WARN_HOURS = 20;

export interface MeterReadingInput {
  engineHours: number;
  recordedAt?: string | Date | null;
  source?: MeterSource;
  note?: string | null;
}

/**
 * Кто пишет показание — от этого зависит, разрешено ли снижение.
 *
 * Роль сюда не передаём намеренно: команда не должна знать состав ролей, это
 * дело слоя запроса. Он и решает, положено ли этому актору снижать счётчик.
 */
export interface MeterReadingContext {
  tenantId: string;
  recordedById?: string | null;
  /** Снижение разрешено (замена счётчика). Для оператора — никогда. */
  allowDecrease?: boolean;
}

/**
 * Кому позволено снижать счётчик. Замену счётчика оформляет администратор или
 * механик; оператор и помощник только снимают показание с прибора.
 *
 * Правило живёт здесь, чтобы у двух точек входа — журнала и карточки установки
 * — оно было одно, а не две разъезжающиеся копии.
 */
export const canDecreaseMeter = (role: string | null | undefined): boolean =>
  role === 'ADMIN' || role === 'MECHANIC';

const toDate = (v: string | Date | null | undefined): Date | null => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Latest reading by recordedAt — the value Equipment.engineHoursTotal mirrors. */
async function latestReading(
  tx: typeof db,
  equipmentId: string,
): Promise<{ engineHours: number } | null> {
  return tx.meterReading.findFirst({
    where: { equipmentId },
    orderBy: [{ recordedAt: 'desc' }, { createdAt: 'desc' }],
    select: { engineHours: true },
  });
}

export interface AddMeterReadingResult {
  reading: { id: string; engineHours: number; recordedAt: Date };
  /** Показание принято, но выглядит подозрительно — текст для оператора. */
  warning: string | null;
}

/**
 * Проверка показания против предыдущего. Чистая — чтобы правило можно было
 * покрыть тестами и переиспользовать на форме, не открывая транзакцию.
 *
 * Возвращает `reject`, если показание принимать нельзя, либо текст
 * предупреждения, либо ничего.
 */
export function checkMeterReading(
  engineHours: number,
  previousHours: number | null,
  options: { allowDecrease?: boolean } = {},
): { reject: string | null; warning: string | null } {
  if (previousHours == null) return { reject: null, warning: null };

  if (engineHours < previousHours) {
    const text = `Показание ${engineHours} м/ч меньше предыдущего (${previousHours} м/ч). Счётчик назад не идёт — проверьте цифру.`;
    return options.allowDecrease
      ? { reject: null, warning: text }
      : { reject: text, warning: null };
  }

  const jump = engineHours - previousHours;
  if (jump > METER_JUMP_WARN_HOURS) {
    return {
      reject: null,
      warning: `Прибавка ${jump} м/ч за одно показание — больше ${METER_JUMP_WARN_HOURS} м/ч. Проверьте, не опечатка ли.`,
    };
  }

  return { reject: null, warning: null };
}

/**
 * Ядро добавления показания: работает внутри уже открытой транзакции.
 *
 * Выделено, чтобы осмотр мог записать снятые моточасы той же механикой, что и
 * ручной ввод, — с историей и синхронизацией кэша. Вкладывать `addMeterReading`
 * в чужую транзакцию нельзя: Prisma не поддерживает вложенный `$transaction`.
 */
export async function recordMeterReadingInTx(
  tx: typeof db,
  equipmentId: string,
  input: MeterReadingInput,
  ctx: MeterReadingContext,
): Promise<AddMeterReadingResult> {
  const recordedAt = toDate(input.recordedAt) ?? new Date();
  const prev = await latestReading(tx, equipmentId);
  const verdict = checkMeterReading(input.engineHours, prev?.engineHours ?? null, {
    allowDecrease: ctx.allowDecrease,
  });
  // 422, а не 400: число само по себе корректно, его отвергает правило учёта.
  if (verdict.reject) throw new ServiceError(verdict.reject, 422);
  const warning = verdict.warning;

  const reading = await tx.meterReading.create({
    data: {
      tenantId: ctx.tenantId,
      equipmentId,
      engineHours: input.engineHours,
      recordedAt,
      source: input.source ?? 'MANUAL',
      recordedById: ctx.recordedById ?? null,
      note: input.note?.trim() ?? '',
    },
    select: { id: true, engineHours: true, recordedAt: true },
  });

  // Sync the engineHoursTotal cache to the latest reading (which may be this
  // one, or an earlier one if this reading was backdated).
  const latest = await latestReading(tx, equipmentId);
  if (latest) {
    await tx.equipment.update({
      where: { id: equipmentId },
      data: { engineHoursTotal: latest.engineHours },
    });
  }

  // Наработка — 15 баллов готовности и вход в расчёт просрочки ТО, поэтому
  // новое показание обязано пересчитать снимок. Заказываем в этой же
  // транзакции: точка одна на ручной ввод и на моточасы, снятые осмотром.
  await requestReadinessSnapshot(tx, {
    tenantId: ctx.tenantId,
    equipmentId,
    aggregateId: reading.id,
    aggregateType: 'MeterReading',
    triggerType: 'METER_READING_RECORDED',
    triggerId: reading.id,
    occurredAt: recordedAt,
  });

  return { reading, warning };
}

export async function addMeterReading(
  equipmentId: string,
  input: MeterReadingInput,
  ctx: MeterReadingContext,
): Promise<AddMeterReadingResult> {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  if (!Number.isInteger(input.engineHours) || input.engineHours < 0) {
    throw new ServiceError('Показание моточасов должно быть целым числом ≥ 0', 400);
  }

  const equipment = await db.equipment.findUnique({
    where: { id: equipmentId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!equipment) throw new ServiceError('Equipment not found', 404);

  return db.$transaction((tx) => recordMeterReadingInTx(tx as typeof db, equipmentId, input, ctx));
}

export async function deleteMeterReading(
  equipmentId: string,
  readingId: string,
  ctx: { tenantId: string },
): Promise<void> {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  const existing = await db.meterReading.findUnique({
    where: { id: readingId },
    select: { id: true, equipmentId: true, tenantId: true },
  });
  if (!existing || existing.equipmentId !== equipmentId || existing.tenantId !== ctx.tenantId) {
    throw new ServiceError('Meter reading not found', 404);
  }

  await db.$transaction(async (tx) => {
    await tx.meterReading.delete({ where: { id: readingId } });
    const latest = await latestReading(tx as typeof db, equipmentId);
    await tx.equipment.update({
      where: { id: equipmentId },
      data: { engineHoursTotal: latest?.engineHours ?? null },
    });
    // Удаление ошибочного показания меняет наработку так же, как ввод нового.
    await requestReadinessSnapshot(tx as typeof db, {
      tenantId: ctx.tenantId,
      equipmentId,
      aggregateId: readingId,
      aggregateType: 'MeterReading',
      triggerType: 'METER_READING_REMOVED',
      triggerId: readingId,
      occurredAt: new Date(),
    });
  });
}
