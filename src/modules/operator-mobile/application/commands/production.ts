/**
 * Выработка смены: сваи, лидерное бурение, простои, журнал забивки, поправки.
 *
 * Самый крупный из шести файлов, и это по делу: выработка — то, ради чего
 * смену открывают. Разрезать его дальше есть смысл только вместе с разбором
 * самой команды logProduction, а не ради числа строк.
 */
import type {Prisma} from '@/generated/postgres-client/client';
import {withReadinessTenantTransaction} from '@/modules/readiness/server';
import {DOWNTIME_MAX_HOURS, downtimeHoursBetween} from '@/modules/reports';
import {validatePassport} from '../../domain/pile-passport';
import {safetyChecklistPeriod} from '../../domain/safety-checklist-period';
import type {ReadWeather} from '../../domain/view-contracts';
import {
  OperatorCommandError, requireCrew, requireOpenShift, ensureReport,
  requireDowntimeReason, requireDrillingType, requirePileGrade, requireProductionPermit,
} from './shared';
import type {Tx} from './shared';

/** Один залог: серия ударов и погружение сваи за неё. */
export interface PileDrivingSetEntry {
  blows: number;
  penetrationMm: number;
  dropHeightM?: number | null;
}

/** Замеры и отметки журнала забивки. Обязателен только номер сваи. */
export interface PilePassportEntry {
  pileNumber: string;
  /**
   * Залоги по порядку — построчная часть журнала забивки.
   *
   * Номер залога не приходит с телефона: порядок задаёт сам массив, и
   * присланная нумерация означала бы второй источник правды о порядке.
   */
  sets?: PileDrivingSetEntry[];
  picketId?: string;
  designHeadLevelM?: number | null;
  actualHeadLevelM?: number | null;
  drivenDepthM?: number | null;
  refusalSetPenetrationMm?: number | null;
  refusalSetBlows?: number | null;
  designRefusalMm?: number | null;
  totalBlows?: number | null;
  blowsLastMeter?: number | null;
  redriven?: boolean;
  followerUsed?: boolean;
  headCutOff?: boolean;
  planDeviationMm?: number | null;
  tiltPercent?: number | null;
  dropHeightM?: number | null;
  mediaIds?: string[];
  note?: string;
}

export type ProductionEntry =
  | {kind: 'PILES'; pileGradeId: string; count: number; comment?: string}
  /**
   * Одна свая с паспортом.
   *
   * ПОЧЕМУ ЭТО РАЗНОВИДНОСТЬ ВЫРАБОТКИ, А НЕ ОТДЕЛЬНАЯ КОМАНДА. Забитая свая
   * есть забитая свая: она подчиняется тем же правилам, что и пачка, — ветер
   * выше 15 м/с запрещает, чек-лист ТБ по забивке обязателен, ключ команды
   * защищает от двойной записи при обрыве, очередь на устройстве откладывает
   * до связи. Отдельная команда означала бы второй набор тех же правил, и
   * первое же расхождение дало бы сваю, записанную в грозу.
   */
  | {kind: 'PILE_PASSPORT'; pileGradeId: string; passport: PilePassportEntry}
  | {kind: 'DRILLING'; typeId: string; count: number; metersPerUnit: number}
  | {kind: 'DOWNTIME'; reasonId: string; startedAt: string; endedAt: string; comment?: string};

/**
 * Запись выработки по ходу смены, а не одним отчётом в конце.
 *
 * ПОЧЕМУ ПО ХОДУ. Отчёт, заполняемый в 19:00 по памяти, — это оценка, а не
 * учёт. Свая, отмеченная сразу, помнит время; простой, отмеченный сразу,
 * помнит причину.
 *
 * ПОЧЕМУ БУРЕНИЕ СЧИТАЕТСЯ КАК В ОТЧЁТЕ. Оператор вводит количество скважин и
 * метры на одну, объём считается умножением. Так это устроено в отчёте за
 * смену, и вводить те же данные двумя разными способами в одном продукте — это
 * два разных числа в аналитике.
 */
export async function logProduction(input: {
  tenantId: string;
  operatorId: string;
  shiftId: string;
  entry: ProductionEntry;
  clientCommandId: string;
  readWeather?: ReadWeather;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    // Повтор уже принятой команды отсекаем ДО всех остальных правил.
    //
    // Ниже стоит перехват P2002 — он спасает мгновенный повтор при обрыве. Но
    // между первой отправкой и повтором проходит время, а правила ниже от
    // времени зависят: смена успевает закрыться. Тогда
    // повтор отвергается ещё до `create`, и машинист получает отказ по записи,
    // которая давно принята. Для отложенной отправки с телефона это обычный
    // случай, а не редкость.
    //
    // Запись уже есть — значит команда выполнена, и время её больше не судит.
    const duplicate = await findByCommand(
      tx, input.tenantId, input.entry.kind, input.clientCommandId,
    );
    if (duplicate) return {reportId: ''};

    const shift = await requireOpenShift(tx, input.tenantId, input.shiftId);
    const crew = await requireCrew(tx, input.tenantId, input.operatorId, shift.equipmentId);

    // Работа кончилась — выработка больше не пишется. Это тоже сервер, а не
    // только экран.
    //
    // `finishWork` переводит смену в HANDOVER_PENDING, и на экране кнопки
    // выработки исчезают. Прямой запрос к API их не спрашивал: после
    // «Завершить работу» сваи продолжали записываться в уже сдаваемую смену.
    // `requireOpenShift` пропускает HANDOVER_PENDING сознательно — в этом
    // состоянии ещё сдают ЕО после работы и закрывают смену, — поэтому
    // правило стоит здесь, а не там.
    //
    // Простой не запрещаем: им машинист объясняет остановку, и последний
    // отрезок простоя обычно вносится уже при сдаче. Тот же довод, что у
    // погодного запрета ниже.
    //
    // Отложенная отправка не страдает: очередь офлайна строго по порядку, а
    // `finishWork` в неё не попадает вовсе (нужен живой ответ сервера), так
    // что записи, сделанные до завершения, уходят раньше него. Повтор уже
    // принятой команды отсекается выше по clientCommandId и сюда не доходит.
    if (shift.state !== 'STARTED' && input.entry.kind !== 'DOWNTIME') {
      /*
        Два разных состояния — два разных сообщения.

        Раньше здесь на оба случая стоял один ответ «работа завершена». Для
        смены, которая ещё НЕ начата, он говорил ровно противоположное правде:
        машинист читал, что работа кончилась, хотя не принял установку
        (поймано на бою 12.09.2026 — см. `admissionAccepted` в
        mobile-shift-query). Экран эту дорогу больше не открывает, но
        сообщение остаётся последней защитой: оно обязано называть
        действие, а не вводить в заблуждение.
      */
      const notStarted = shift.state === 'PLANNED' || shift.state === 'PENDING_ACCEPTANCE';
      throw new OperatorCommandError(
        409,
        notStarted
          ? 'Смена ещё не начата: примите установку на экране приёма, и запись выработки откроется.'
          : 'Работа по смене завершена — выработку больше не записать. '
            + 'Если запись пропущена, её вносит мастер в журнале забивки.',
      );
    }

    // Погода не блокирует запись на сервере. На установках нет телеметрии и
    // удалённого управления, а внешний метеосервис может быть устаревшим или
    // измерять не в точке работ. Критический порог остаётся красным
    // предупреждением в состоянии смены; решение об остановке принимает
    // ответственный на площадке. readWeather сохранён во входном контракте
    // на время совместимого обновления API-клиентов.

    // Чек-лист ТБ — пропуск к работе этого вида, а не бумажка «на потом».
    // Забивка и бурение опасны по-разному, и общий инструктаж эти различия
    // стирает, поэтому пропуска два.
    //
    // СРОК, А НЕ СМЕНА (решение владельца 18.09.2026). Раньше пропуск истекал
    // в полночь и список правил проходили заново каждое утро — сорок раз в
    // месяц. Норматив требует повторять инструктаж по графику, и срок берётся
    // у той же инструкции, которой управляет инженер по охране труда.
    const requiredSafety = input.entry.kind === 'PILES' || input.entry.kind === 'PILE_PASSPORT'
      ? 'TB_PILING'
      : input.entry.kind === 'DRILLING' ? 'TB_DRILLING' : null;
    if (requiredSafety) {
      // Срок принадлежит человеку и ходит с ним между машинами и объектами,
      // поэтому ищем по работнику, а не по смене или установке.
      const passed = await tx.operatorChecklistExecution.findFirst({
        where: {
          tenantId: input.tenantId,
          startedById: input.operatorId,
          status: 'COMPLETED',
          template: {templateKey: requiredSafety},
        },
        select: {startedAt: true},
        orderBy: {startedAt: 'desc'},
      });
      const period = safetyChecklistPeriod(requiredSafety, passed?.startedAt ?? null, input.now);
      if (period.due) {
        throw new OperatorCommandError(
          409,
          requiredSafety === 'TB_PILING'
            ? 'Подошёл срок чек-листа ТБ по забивке свай — пройдите его'
            : 'Подошёл срок чек-листа ТБ по лидерному бурению — пройдите его',
        );
      }
    }

    const reportId = await ensureReport(tx, {
      tenantId: input.tenantId,
      shiftId: input.shiftId,
      operatorId: input.operatorId,
      siteId: crew.siteId,
      equipmentId: shift.equipmentId,
      crewId: crew.id,
      productionDate: shift.productionDate.toISOString().slice(0, 10),
      shiftType: shift.type,
    });

    const {entry} = input;

    /*
      ЗАПРЕТ ПРОВЕРЯЕТСЯ ЗДЕСЬ И ТОЛЬКО ДЛЯ ВЫРАБОТКИ.

      Сваи, паспорт и бурение — это продолжение операции: их запрещает
      неустранённый критический дефект, просроченный обязательный документ,
      нехватка СИЗ, выведенная из эксплуатации машина и неразобранное
      происшествие с требованием остановки.

      Простой намеренно проходит без проверки. Он и есть честная запись о том,
      что машина стоит, — в том числе стоит из-за этого самого запрета. Закрыв
      простой вместе с выработкой, мы получили бы смену, где работа запрещена,
      а сказать об этом нечем: четыре часа ожидания механика просто исчезли бы
      из отчёта.
    */
    if (entry.kind !== 'DOWNTIME') {
      await requireProductionPermit(tx, {
        tenantId: input.tenantId,
        operatorId: input.operatorId,
        equipmentId: shift.equipmentId,
        shiftId: input.shiftId,
        productionDate: shift.productionDate,
        now,
      });
    }

    if (entry.kind === 'PILES') {
      if (entry.count <= 0) throw new OperatorCommandError(400, 'Количество свай должно быть больше нуля');
      // Марка — только своей организации (см. requirePileGrade): чужая
      // записывалась молча и портила расчёт погонных метров.
      await requirePileGrade(tx, input.tenantId, entry.pileGradeId);
      await tx.pileWork.create({
        data: {
          reportId,
          tenantId: input.tenantId,
          shiftId: input.shiftId,
          clientCommandId: input.clientCommandId,
          pileGradeId: entry.pileGradeId,
          count: entry.count,
          comment: entry.comment ?? null,
          occurredAt: now,
        },
      });
    } else if (entry.kind === 'PILE_PASSPORT') {
      // Длину сваи берём из её марки — единственного источника длины в
      // продукте (см. lib/pile-length). Она нужна правилу глубины: свая не
      // уходит глубже собственной длины, кроме погружения добойником.
      const grade = await requirePileGrade(tx, input.tenantId, entry.pileGradeId);

      const problems = validatePassport({
        pileNumber: entry.passport.pileNumber,
        refusalSetPenetrationMm: entry.passport.refusalSetPenetrationMm ?? null,
        refusalSetBlows: entry.passport.refusalSetBlows ?? null,
        drivenDepthM: entry.passport.drivenDepthM ?? null,
        pileLengthM: grade?.lengthMm != null ? grade.lengthMm / 1000 : null,
        followerUsed: entry.passport.followerUsed ?? false,
      });
      if (problems.length > 0) {
        throw new OperatorCommandError(400, 'Паспорт заполнен не полностью', problems);
      }

      // Залог без ударов или с отрицательным погружением — не замер, а мусор,
      // из которого потом посчитается отказ и уедет решение по свае. Ноль
      // погружения законен: свая встала.
      const sets = entry.passport.sets ?? [];
      for (const [index, set] of sets.entries()) {
        const bad = !Number.isFinite(set.blows) || set.blows <= 0
          || !Number.isFinite(set.penetrationMm) || set.penetrationMm < 0;
        if (bad) {
          throw new OperatorCommandError(400, `Залог № ${index + 1} заполнен неверно`, [
            {field: 'sets', message: 'В залоге нужны число ударов больше нуля и погружение от нуля'},
          ]);
        }
      }

      // Молот снимаем с карточки установки: позднейшая замена молота не должна
      // переписывать журнал уже забитых свай.
      const equipment = await tx.equipment.findFirst({
        where: {tenantId: input.tenantId, id: shift.equipmentId},
        select: {hammerType: true, hammerEnergyKj: true},
      });

      const work = await tx.pileWork.create({
        data: {
          reportId,
          tenantId: input.tenantId,
          shiftId: input.shiftId,
          clientCommandId: input.clientCommandId,
          pileGradeId: entry.pileGradeId,
          // Одна свая — одна запись. Учёт, планы и погонные метры считают по
          // этой строке ровно как по пачке и о паспорте ничего не знают.
          count: 1,
          picketId: entry.passport.picketId ?? null,
          depth: entry.passport.drivenDepthM ?? null,
          occurredAt: now,
        },
        select: {id: true},
      });

      await tx.pilePassport.create({
        data: {
          tenantId: input.tenantId,
          pileWorkId: work.id,
          clientCommandId: input.clientCommandId,
          pileNumber: entry.passport.pileNumber.trim(),
          designHeadLevelM: entry.passport.designHeadLevelM ?? null,
          actualHeadLevelM: entry.passport.actualHeadLevelM ?? null,
          drivenDepthM: entry.passport.drivenDepthM ?? null,
          refusalSetPenetrationMm: entry.passport.refusalSetPenetrationMm ?? null,
          refusalSetBlows: entry.passport.refusalSetBlows ?? null,
          designRefusalMm: entry.passport.designRefusalMm ?? null,
          totalBlows: entry.passport.totalBlows ?? null,
          blowsLastMeter: entry.passport.blowsLastMeter ?? null,
          redriven: entry.passport.redriven ?? false,
          followerUsed: entry.passport.followerUsed ?? false,
          headCutOff: entry.passport.headCutOff ?? false,
          planDeviationMm: entry.passport.planDeviationMm ?? null,
          tiltPercent: entry.passport.tiltPercent ?? null,
          hammerType: equipment?.hammerType ?? null,
          hammerEnergyKj: equipment?.hammerEnergyKj ?? null,
          dropHeightM: entry.passport.dropHeightM ?? null,
          mediaIds: (entry.passport.mediaIds ?? []) as Prisma.InputJsonValue,
          note: entry.passport.note?.trim() || null,
          drivenAt: now,
          recordedById: input.operatorId,
          // Залоги пишутся одной вставкой вместе с паспортом: журнал без хода
          // забивки и ход забивки без журнала одинаково бесполезны, и
          // разорванная запись оставила бы одно без другого при сбое.
          sets: sets.length > 0
            ? {
              create: sets.map((set, index) => ({
                tenantId: input.tenantId,
                ordinal: index + 1,
                blows: set.blows,
                penetrationMm: set.penetrationMm,
                dropHeightM: set.dropHeightM ?? null,
              })),
            }
            : undefined,
        },
      });
    } else if (entry.kind === 'DRILLING') {
      if (entry.count <= 0) throw new OperatorCommandError(400, 'Количество скважин должно быть больше нуля');
      if (entry.metersPerUnit <= 0) throw new OperatorCommandError(400, 'Глубина скважины должна быть больше нуля');
      await requireDrillingType(tx, input.tenantId, entry.typeId);
      await tx.leaderDrilling.create({
        data: {
          reportId,
          tenantId: input.tenantId,
          shiftId: input.shiftId,
          clientCommandId: input.clientCommandId,
          typeId: entry.typeId,
          count: entry.count,
          metersPerUnit: entry.metersPerUnit,
          meters: entry.count * entry.metersPerUnit,
          occurredAt: now,
        },
      });
    } else {
      const startedAt = new Date(entry.startedAt);
      const endedAt = new Date(entry.endedAt);
      if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
        throw new OperatorCommandError(400, 'Не разобрать время простоя');
      }

      // Длительность считает сервер по интервалу — округления нет вовсе
      // (см. reports/domain/downtime-hours). Переход через полночь разобран там же.
      const hours = downtimeHoursBetween(startedAt, endedAt);
      if (hours <= 0) {
        throw new OperatorCommandError(400, 'Конец простоя совпадает с началом. Укажите, когда машина снова пошла.');
      }
      if (hours > DOWNTIME_MAX_HOURS) {
        throw new OperatorCommandError(400, `Простой длиннее суток (${Math.round(hours)} ч). Проверьте время.`);
      }

      /*
        БУДУЩЕЕ ВРЕМЯ ОТВЕРГАЕМ, ПРОШЛОЕ — НЕТ.

        Часы на телефоне идут своим ходом, и небольшое расхождение с сервером
        нормально; допуск в пять минут закрывает его, не мешая записать простой
        сразу, как машина пошла. А вот простой, «закончившийся» через два часа
        после сейчас, — это опечатка в поле времени, и принять её значит
        получить смену, где машина стояла в своё будущее.

        Начало в прошлом не ограничиваем: вспомнить утренний простой после
        обеда — нормальный ход смены, ради которого журнал и ведётся.
      */
      if (endedAt.getTime() > now.getTime() + 5 * 60_000) {
        throw new OperatorCommandError(400, 'Простой не может заканчиваться в будущем');
      }

      await requireDowntimeReason(tx, input.tenantId, entry.reasonId);
      await tx.reportDowntime.create({
        data: {
          reportId,
          tenantId: input.tenantId,
          shiftId: input.shiftId,
          clientCommandId: input.clientCommandId,
          reasonId: entry.reasonId,
          // `duration` — часы дробным числом: единица хранения одна на всё
          // приложение. Рядом лежит сам интервал, ради которого всё и затеяно:
          // из числа часов нельзя узнать, КОГДА машина стояла.
          duration: hours,
          startedAt,
          endedAt,
          durationSeconds: Math.round(hours * 3600),
          kind: 'DOWNTIME',
          status: 'CLOSED',
          comment: entry.comment ?? null,
          occurredAt: startedAt,
        },
      });
    }

    return {reportId};
  }).catch((error: unknown) => {
    // Повтор той же команды при обрыве сети — не ошибка: запись уже есть.
    if (typeof error === 'object' && error !== null && (error as {code?: string}).code === 'P2002') {
      return {reportId: ''};
    }
    throw error;
  });
}

/** Повтор команды при обрыве сети: поправка уже записана — вернём её. */
export async function findByCommand(
  tx: Tx, tenantId: string, kind: ProductionEntry['kind'], clientCommandId: string,
): Promise<string | null> {
  const where = {tenantId_clientCommandId: {tenantId, clientCommandId}};
  // Паспорт лежит в PileWork той же строкой, что и пачка: свая с паспортом —
  // это запись выработки на одну сваю.
  const row = kind === 'PILES' || kind === 'PILE_PASSPORT'
    ? await tx.pileWork.findUnique({where, select: {id: true}})
    : kind === 'DRILLING'
      ? await tx.leaderDrilling.findUnique({where, select: {id: true}})
      : await tx.reportDowntime.findUnique({where, select: {id: true}});
  return row?.id ?? null;
}
