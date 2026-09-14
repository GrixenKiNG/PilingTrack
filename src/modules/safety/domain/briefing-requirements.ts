/**
 * Что работнику осталось пройти по инструктажам: чистый расчёт, без базы.
 *
 * ДВА РАЗНЫХ ВОПРОСА, КОТОРЫЕ ЛЕГКО ПЕРЕПУТАТЬ.
 *
 * 1. ОЗНАКОМЛЕНИЕ. Читал ли человек ДЕЙСТВУЮЩУЮ редакцию. Отметка о прочтении
 *    привязана к версии: подняли версию — текст изменился, и старая отметка
 *    говорит о другом документе. Отсюда плитка «ожидают ознакомления»: она про
 *    новые редакции, а не про сроки.
 *
 * 2. ПОВТОРНЫЙ ИНСТРУКТАЖ. Сколько прошло с ПОСЛЕДНЕГО инструктажа по этой
 *    инструкции, независимо от редакции. Норматив требует повторять его по
 *    графику, даже если текст не менялся: человек забывает.
 *
 * Человек может быть ознакомлен с текущей редакцией и одновременно просрочить
 * повторный — это разные нарушения с разными действиями, и сводить их в одно
 * число нельзя.
 *
 * ПОЧЕМУ ЗДЕСЬ ЧИСТЫЕ ФУНКЦИИ. Тот же расчёт нужен сводке по всем работникам,
 * личному разделу «Мой допуск» и — со временем — экрану оператора перед
 * сменой. Разъехавшись, они скажут человеку и инженеру ОТ разное об одном и
 * том же дне.
 */

import type { SafetyInstruction } from '../instructions';

export interface BriefingHistoryEntry {
  documentCode: string;
  documentVersion: string;
  recordedAt: Date | string;
}

/** Почему инструкция числится непройденной. */
export type PendingReason =
  /** Не читал никогда — ни одной редакции. */
  | 'never'
  /** Читал прошлую редакцию, действующую не открывал. */
  | 'outdated';

export interface PendingAcquaintance {
  code: string;
  title: string;
  version: string;
  reason: PendingReason;
}

export interface OverdueRepeat {
  code: string;
  title: string;
  /** Когда инструктаж должен был состояться. */
  dueAt: string;
  /** На сколько дней просрочен. Всегда положительное. */
  daysOverdue: number;
}

export interface BriefingRequirements {
  /** Инструкции, обязательные этой роли. Пусто — требований к ней нет. */
  required: SafetyInstruction[];
  pending: PendingAcquaintance[];
  overdue: OverdueRepeat[];
  /** Когда человек последний раз проходил хоть какой-то инструктаж. */
  lastBriefingAt: string | null;
}

const DAY_MS = 24 * 3600 * 1000;

function toTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Прибавить месяцы, не переехав в следующий месяц.
 *
 * 30 ноября плюс три месяца — это 28 (или 29) февраля, а не 2 марта: иначе
 * срок повторного инструктажа у части людей молча уезжал бы на пару дней,
 * и «просрочен» наступал позже, чем на самом деле.
 */
export function addMonths(from: Date, months: number): Date {
  const day = from.getDate();
  const shifted = new Date(from);
  shifted.setDate(1);
  shifted.setMonth(shifted.getMonth() + months);
  const lastDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
  shifted.setDate(Math.min(day, lastDay));
  return shifted;
}

/**
 * @param instructions весь каталог; фильтрация по роли — забота этой функции
 * @param history записи ОЗНАКОМЛЕНИЙ работника (kind INSTRUCTION), любые редакции
 */
export function evaluateBriefingRequirements(
  instructions: readonly SafetyInstruction[],
  role: string,
  history: readonly BriefingHistoryEntry[],
  now: Date = new Date(),
): BriefingRequirements {
  const required = instructions.filter((item) => item.requiredForRoles.includes(role));
  const pending: PendingAcquaintance[] = [];
  const overdue: OverdueRepeat[] = [];

  let lastBriefingTime = -Infinity;
  for (const entry of history) {
    const time = toTime(entry.recordedAt);
    if (!Number.isNaN(time) && time > lastBriefingTime) lastBriefingTime = time;
  }

  for (const instruction of required) {
    const own = history.filter((entry) => entry.documentCode === instruction.code);

    const readCurrent = own.some((entry) => entry.documentVersion === instruction.version);
    if (!readCurrent) {
      pending.push({
        code: instruction.code,
        title: instruction.title,
        version: instruction.version,
        // «Читал прошлую редакцию» и «не читал вовсе» требуют разного
        // разговора с человеком: первому напомнить, второго не пускать.
        reason: own.length === 0 ? 'never' : 'outdated',
      });
    }

    // Просрочку повторного считаем по последнему инструктажу ЛЮБОЙ редакции:
    // человек слушал инструктаж, и с этого дня пошёл срок. Тот, кто не
    // проходил его ни разу, просрочки не имеет — он в «ожидают ознакомления»,
    // и считать ему ещё и просрочку значит наказывать дважды за одно.
    const latest = own.reduce<number>((best, entry) => {
      const time = toTime(entry.recordedAt);
      return !Number.isNaN(time) && time > best ? time : best;
    }, -Infinity);
    if (latest === -Infinity) continue;

    const dueAt = addMonths(new Date(latest), instruction.repeatMonths);
    if (dueAt.getTime() < now.getTime()) {
      overdue.push({
        code: instruction.code,
        title: instruction.title,
        dueAt: dueAt.toISOString(),
        daysOverdue: Math.max(1, Math.floor((now.getTime() - dueAt.getTime()) / DAY_MS)),
      });
    }
  }

  return {
    required,
    pending,
    overdue,
    lastBriefingAt: lastBriefingTime === -Infinity
      ? null
      : new Date(lastBriefingTime).toISOString(),
  };
}
