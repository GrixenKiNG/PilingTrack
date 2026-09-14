/**
 * Приёмка техники машинистом: осмотр на месте и снятие моточасов.
 *
 * Вторая дверь допуска. Первая — человек (`./admission`), эта — машина.
 */
import {randomUUID} from 'node:crypto';
import {withReadinessTenantTransaction} from '@/modules/readiness/server';
import {requestReadinessSnapshot} from '@/modules/readiness/server';
import type {ShiftCondition} from '../../domain/checklist-types';
import {resolveShiftConditions} from '../../domain/shift-conditions';
import type {ReadWeather} from '../../domain/view-contracts';
import {shiftWindow} from '../../domain/shift-window';
import {OperatorCommandError, requireCrew, productionDateOf, recordEvidence} from './shared';

/**
 * Приём установки: оператор подтверждает машину и объект.
 *
 * Это и есть открытие смены. Моточасы здесь не спрашиваем: на приборной панели
 * их всё равно снимут при пуске, а два ввода подряд про одно и то же оператор
 * заполняет не глядя.
 */
export async function acceptEquipment(input: {
  tenantId: string;
  operatorId: string;
  equipmentId: string;
  shiftType: 'DAY' | 'NIGHT';
  clientCommandId: string;
  readWeather?: ReadWeather;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    const crew = await requireCrew(tx, input.tenantId, input.operatorId, input.equipmentId);
    const profile = await tx.user.findFirst({
      where: {tenantId: input.tenantId, id: input.operatorId}, select: {timezone: true},
    });
    const timezone = profile?.timezone ?? 'Europe/Moscow';
    const productionDate = productionDateOf(timezone, now);

    // В базе есть частичный уникальный индекс Shift_one_active_per_equipment_key:
    // у машины может быть только одна смена в состоянии STARTED или
    // HANDOVER_PENDING — на любую дату. Незакрытая вчерашняя смена блокирует
    // открытие сегодняшней, и сказать об этом надо словами, а не ошибкой
    // уникальности из драйвера.
    const active = await tx.shift.findFirst({
      where: {
        tenantId: input.tenantId,
        equipmentId: input.equipmentId,
        state: {in: ['STARTED', 'HANDOVER_PENDING']},
      },
      select: {id: true, state: true, productionDate: true, plannedStartAt: true, plannedEndAt: true},
    });
    if (active && active.productionDate.getTime() !== productionDate.getTime()) {
      throw new OperatorCommandError(
        409,
        `По этой установке не закрыта смена за ${active.productionDate.toISOString().slice(0, 10)}. `
        + 'Сдайте её, прежде чем открывать новую.',
      );
    }

    const existing = active ?? await tx.shift.findFirst({
      where: {
        tenantId: input.tenantId,
        equipmentId: input.equipmentId,
        productionDate,
        state: {in: ['PLANNED', 'PENDING_ACCEPTANCE']},
      },
      select: {id: true, state: true, productionDate: true, plannedStartAt: true, plannedEndAt: true},
    });

    const planned = shiftWindow(productionDate, input.shiftType, timezone);
    const shiftId = existing?.id ?? randomUUID();
    if (existing) {
      if (existing.state !== 'STARTED') {
        await tx.shift.update({
          where: {tenantId_id: {tenantId: input.tenantId, id: shiftId}},
          data: {
            state: 'STARTED', startedAt: now,
            startedById: input.operatorId, lastEditedById: input.operatorId,
            // У смены, заведённой диспетчером заранее, план уже свой — не трогаем.
            plannedStartAt: existing.plannedStartAt ?? planned.plannedStartAt,
            plannedEndAt: existing.plannedEndAt ?? planned.plannedEndAt,
          },
        });
      }
    } else {
      await tx.shift.create({
        data: {
          id: shiftId,
          tenantId: input.tenantId,
          equipmentId: input.equipmentId,
          type: input.shiftType,
          state: 'STARTED',
          productionDate,
          timezone,
          createdById: input.operatorId,
          lastEditedById: input.operatorId,
          startedAt: now,
          startedById: input.operatorId,
          // Плановое окно по расписанию продукта: без него смена не рисуется
          // на шкале центра готовности — есть в списке, нет на графике.
          plannedStartAt: planned.plannedStartAt,
          plannedEndAt: planned.plannedEndAt,
        },
      });
    }

    // Условия смены снимаются ОДИН РАЗ, здесь, и дальше не пересматриваются.
    //
    // ПОЧЕМУ НЕ ПО ХОДУ. Состав осмотра обязан быть одинаковым на экране и на
    // сервере. Пока условия вычислялись при каждом чтении, потеплело за час —
    // и зимний пункт исчезал из списка между показом и отправкой. Хуже того,
    // серверная сборка списка опиралась на то, какие условные пункты телефон
    // соизволил прислать: не прислал зимний — значит зимы нет, осмотр «полный».
    // Снимок на момент открытия смены закрывает обе дыры разом.
    //
    // Предупреждения так не замораживаются: порыв ветра должен быть виден
    // сейчас, а не таким, каким был утром.
    const site = await tx.site.findFirst({
      where: {tenantId: input.tenantId, id: crew.siteId},
      select: {latitude: true, longitude: true},
    });
    const reading = input.readWeather && site?.latitude != null && site.longitude != null
      ? await input.readWeather(site.latitude, site.longitude)
      : null;
    const conditions: ShiftCondition[] = resolveShiftConditions({
      temperatureC: reading?.temperatureC ?? null,
      windMs: reading?.windMs ?? null,
      precipitationMmPerHour: reading?.precipitationMmPerHour ?? null,
      daylight: reading?.isDay ?? null,
    });

    await recordEvidence(tx, {
      tenantId: input.tenantId,
      shiftId,
      equipmentId: input.equipmentId,
      kind: 'STARTUP_READING',
      payload: {siteId: crew.siteId, conditions, weather: reading ?? null},
      operatorId: input.operatorId,
      clientCommandId: input.clientCommandId,
      now,
    });

    // Открытие смены закрывает шаг «Приёмка» в готовности — просим пересчёт.
    await requestReadinessSnapshot(tx as unknown as Parameters<typeof requestReadinessSnapshot>[0], {
      tenantId: input.tenantId,
      equipmentId: input.equipmentId,
      aggregateId: shiftId,
      aggregateType: 'Shift',
      triggerType: 'SHIFT_STARTED',
      triggerId: shiftId,
      occurredAt: now,
      shiftId,
    });

    return {shiftId};
  });
}

