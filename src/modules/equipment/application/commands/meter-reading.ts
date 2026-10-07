/**
 * MeterReading — журнал показаний наработки (моточасы).
 *
 * Источник истины наработки — история показаний. Equipment.engineHoursTotal
 * остаётся денормализованным кэшем и ВСЕГДА равен последнему показанию
 * (по recordedAt, затем createdAt) — тому же, с которым сверяется следующее.
 * Раньше кэш держал максимум (GREATEST): замена счётчика и правка наработки в
 * карточке «не сохранялись» — старая большая цифра возвращалась после любого
 * нового показания (владелец 07.10.2026). Кэш пересчитывается запросом самой
 * базы под блокировкой строки установки на каждое добавление и удаление.
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
import { requestReadinessSnapshot } from '@/modules/readiness/server';

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
  /**
   * Пометка `note` — идентификатор события, а не свободный текст.
   *
   * Так пишет сменный отчёт: пометка «Показание из сменного отчёта за <дату>»
   * одна и та же при повторной отправке формы. Второе показание с тем же
   * значением и той же пометкой — это повтор запроса, а не новое событие.
   * Другое значение за ту же дату — правка, её пишем.
   *
   * Остальным вызывающим (осмотр, карточка установки) флаг не ставят: там та
   * же цифра во второй раз — законное показание (машина могла не работать).
   */
  dedupeByNote?: boolean;
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

/** Последнее показание по recordedAt — с ним сверяется новое (правило «назад не идёт»). */
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

/**
 * Блокировка строки установки на время записи показания.
 *
 * Две одновременные записи по одной установке выстраиваются в очередь: вторая
 * видит уже закоммиченное показание первой, и кэш не остаётся на старой цифре
 * (аудит F-R38-4 — тот же риск, который раньше закрывал GREATEST). Tenant в
 * условии — строгим равенством (IDOR guard).
 */
async function lockEquipmentRow(tx: typeof db, equipmentId: string, tenantId: string): Promise<void> {
  await tx.$executeRaw`
    SELECT 1 FROM "Equipment"
    WHERE id = ${equipmentId} AND "tenantId" = ${tenantId}
    FOR UPDATE
  `;
}

/**
 * Кэш наработки = последнее показание, посчитанное базой в той же транзакции.
 *
 * Порядок тот же, что у `latestReading`: recordedAt, затем createdAt. Показаний
 * нет — кэш пуст. Выполняется после блокировки строки установки, поэтому
 * видит все закоммиченные показания.
 */
async function syncEngineHoursTotal(
  tx: typeof db,
  equipmentId: string,
  tenantId: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Equipment"
    SET "engineHoursTotal" = (
      SELECT m."engineHours" FROM "MeterReading" m
      WHERE m."equipmentId" = ${equipmentId} AND m."tenantId" = ${tenantId}
      ORDER BY m."recordedAt" DESC, m."createdAt" DESC, m.id DESC
      LIMIT 1
    )
    WHERE id = ${equipmentId} AND "tenantId" = ${tenantId}
  `;
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
  const note = input.note?.trim() ?? '';

  // Строка установки заблокирована до конца транзакции: проверка «назад не идёт»
  // и пересчёт кэша видят одно и то же состояние журнала.
  await lockEquipmentRow(tx, equipmentId, ctx.tenantId);

  // Повтор запроса не должен плодить показания: если у машины уже есть
  // показание с тем же значением и той же пометкой-идентификатором события
  // (сменный отчёт за дату), вторую запись не создаём. Значение другое —
  // это правка, её пишем ниже обычным путём.
  if (ctx.dedupeByNote && note) {
    const duplicate = await tx.meterReading.findFirst({
      where: { tenantId: ctx.tenantId, equipmentId, engineHours: input.engineHours, note },
      select: { id: true, engineHours: true, recordedAt: true },
    });
    if (duplicate) return { reading: duplicate, warning: null };
  }

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
      note,
    },
    select: { id: true, engineHours: true, recordedAt: true },
  });

  // Кэш наработки — последнее показание (в том числе меньшее прежнего: замена
  // счётчика, правка в карточке). Считает сама база, не значение из JS.
  await syncEngineHoursTotal(tx, equipmentId, ctx.tenantId);

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
  if (!ctx.tenantId) throw new ServiceError('Не определена организация пользователя', 400);
  if (!Number.isInteger(input.engineHours) || input.engineHours < 0) {
    throw new ServiceError('Показание моточасов должно быть целым числом ≥ 0', 400);
  }

  const equipment = await db.equipment.findUnique({
    where: { id: equipmentId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!equipment) throw new ServiceError('Установка не найдена', 404);

  return db.$transaction((tx) => recordMeterReadingInTx(tx as typeof db, equipmentId, input, ctx));
}

export async function deleteMeterReading(
  equipmentId: string,
  readingId: string,
  ctx: { tenantId: string },
): Promise<void> {
  if (!ctx.tenantId) throw new ServiceError('Не определена организация пользователя', 400);
  const existing = await db.meterReading.findUnique({
    where: { id: readingId },
    select: { id: true, equipmentId: true, tenantId: true },
  });
  if (!existing || existing.equipmentId !== equipmentId || existing.tenantId !== ctx.tenantId) {
    throw new ServiceError('Показание моточасов не найдено', 404);
  }

  await db.$transaction(async (tx) => {
    await lockEquipmentRow(tx as typeof db, equipmentId, ctx.tenantId);
    await tx.meterReading.delete({ where: { id: readingId } });
    // Кэш пересчитывает база в той же транзакции: последнее из оставшихся показаний.
    await syncEngineHoursTotal(tx as typeof db, equipmentId, ctx.tenantId);
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
