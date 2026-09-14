/**
 * Исправление уже записанной выработки.
 *
 * Отдельно от записи намеренно: запись добавляет строку, поправка меняет
 * прошлое — у неё свои правила (что можно править, кем и до какого момента)
 * и свой путь повтора команды при обрыве сети.
 */
import {withReadinessTenantTransaction} from '@/modules/readiness/server';
import {roundDowntimeHours} from '@/modules/reports';
import {OperatorCommandError, requireCrew, requireOpenShift} from './shared';
import {findByCommand} from './production';

/**
 * Поправка к записи выработки.
 *
 * ПОЧЕМУ ВСТРЕЧНОЙ ЗАПИСЬЮ, А НЕ ПРАВКОЙ НА МЕСТЕ. Исходная строка остаётся
 * ровно такой, какой её ввёл человек, а рядом ложится разница со ссылкой и
 * причиной. Итог даёт сумма — и это главное следствие: отчёт, аналитика,
 * проекции и экран машиниста уже считают суммой, поэтому верный итог они
 * получают без единой правки в себе. Схема «пометить старую, вставить новую»
 * потребовала бы изменить каждого читателя, и первый же забытый показывал бы
 * двойной объём.
 *
 * ПОЧЕМУ ОПЕРАТОР ВВОДИТ «СКОЛЬКО БЫЛО НА САМОМ ДЕЛЕ», А НЕ РАЗНИЦУ. Разницу
 * считает сервер. Человек, ошибшийся при вводе, знает верное число; заставлять
 * его вычитать в уме — верный способ получить вторую ошибку поверх первой.
 */
export async function correctProduction(input: {
  tenantId: string;
  operatorId: string;
  shiftId: string;
  kind: 'PILES' | 'DRILLING' | 'DOWNTIME';
  entryId: string;
  /** Сколько было на самом деле: свай, скважин либо часов простоя. */
  actual: number;
  reason: string;
  clientCommandId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new OperatorCommandError(400, 'Напишите, почему пришлось поправить');
  }
  if (input.actual < 0) {
    throw new OperatorCommandError(400, 'Итог не может быть отрицательным');
  }

  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    const shift = await requireOpenShift(tx, input.tenantId, input.shiftId);
    await requireCrew(tx, input.tenantId, input.operatorId, shift.equipmentId);

    const duplicate = await findByCommand(tx, input.tenantId, input.kind, input.clientCommandId);
    if (duplicate) return {correctionId: duplicate};

    const scope = {tenantId: input.tenantId, shiftId: input.shiftId, id: input.entryId};
    if (input.kind === 'PILES') {
      const original = await tx.pileWork.findFirst({
        where: scope, select: {id: true, reportId: true, pileGradeId: true, correctsId: true},
      });
      if (!original) throw new OperatorCommandError(404, 'Запись не найдена');
      // Поправку не поправляют: правят исходную, и все поправки к ней
      // складываются. Цепочка «поправка поправки» читается только с
      // калькулятором и первой же теряет смысл.
      if (original.correctsId) {
        throw new OperatorCommandError(409, 'Это уже поправка. Поправьте исходную запись.');
      }
      const corrections = await tx.pileWork.aggregate({
        _sum: {count: true},
        where: {tenantId: input.tenantId, correctsId: original.id},
      });
      const base = await tx.pileWork.findUnique({where: {id: original.id}, select: {count: true}});
      const current = (base?.count ?? 0) + (corrections._sum.count ?? 0);
      const delta = Math.round(input.actual) - current;
      if (delta === 0) throw new OperatorCommandError(400, 'Число не изменилось');
      const created = await tx.pileWork.create({
        data: {
          reportId: original.reportId,
          tenantId: input.tenantId,
          shiftId: input.shiftId,
          clientCommandId: input.clientCommandId,
          pileGradeId: original.pileGradeId,
          count: delta,
          correctsId: original.id,
          correctionNote: reason,
          occurredAt: now,
        },
        select: {id: true},
      });
      return {correctionId: created.id, was: current, now: Math.round(input.actual)};
    }

    if (input.kind === 'DRILLING') {
      const original = await tx.leaderDrilling.findFirst({
        where: scope,
        select: {id: true, reportId: true, typeId: true, metersPerUnit: true, count: true, correctsId: true},
      });
      if (!original) throw new OperatorCommandError(404, 'Запись не найдена');
      if (original.correctsId) {
        throw new OperatorCommandError(409, 'Это уже поправка. Поправьте исходную запись.');
      }
      const corrections = await tx.leaderDrilling.aggregate({
        _sum: {count: true},
        where: {tenantId: input.tenantId, correctsId: original.id},
      });
      const current = original.count + (corrections._sum.count ?? 0);
      const delta = Math.round(input.actual) - current;
      if (delta === 0) throw new OperatorCommandError(400, 'Число не изменилось');
      const created = await tx.leaderDrilling.create({
        data: {
          reportId: original.reportId,
          tenantId: input.tenantId,
          shiftId: input.shiftId,
          clientCommandId: input.clientCommandId,
          typeId: original.typeId,
          count: delta,
          metersPerUnit: original.metersPerUnit,
          // Метры считаются той же глубиной, что и в исходной записи: правят
          // количество скважин, а не то, насколько глубоко бурили.
          meters: delta * original.metersPerUnit,
          correctsId: original.id,
          correctionNote: reason,
          occurredAt: now,
        },
        select: {id: true},
      });
      return {correctionId: created.id, was: current, now: Math.round(input.actual)};
    }

    const original = await tx.reportDowntime.findFirst({
      where: scope, select: {id: true, reportId: true, reasonId: true, duration: true, correctsId: true},
    });
    if (!original) throw new OperatorCommandError(404, 'Запись не найдена');
    if (original.correctsId) {
      throw new OperatorCommandError(409, 'Это уже поправка. Поправьте исходную запись.');
    }
    const corrections = await tx.reportDowntime.aggregate({
      _sum: {duration: true},
      where: {tenantId: input.tenantId, correctsId: original.id},
    });
    const current = original.duration + (corrections._sum.duration ?? 0);
    // Правка простоя подчиняется тому же правилу, что и запись: полные часы,
    // неполный вверх. Схема команды округлить это не может — `actual` там один
    // на сваи, бурение и простой, а часы из них только у простого. Ноль
    // остаётся нулём: «простоя не было» — законный ответ.
    const actual = roundDowntimeHours(input.actual);
    const delta = Math.round((actual - current) * 100) / 100;
    if (delta === 0) throw new OperatorCommandError(400, 'Число не изменилось');
    const created = await tx.reportDowntime.create({
      data: {
        reportId: original.reportId,
        tenantId: input.tenantId,
        shiftId: input.shiftId,
        clientCommandId: input.clientCommandId,
        reasonId: original.reasonId,
        duration: delta,
        kind: 'DOWNTIME',
        status: 'CLOSED',
        correctsId: original.id,
        correctionNote: reason,
        occurredAt: now,
      },
      select: {id: true},
    });
    return {correctionId: created.id, was: current, now: actual};
  });
}
