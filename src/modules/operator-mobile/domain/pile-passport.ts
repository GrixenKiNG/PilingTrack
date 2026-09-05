/**
 * Паспорт забитой сваи — правила и счёт.
 *
 * ЗАЧЕМ ОН НУЖЕН. Свая под землёй, и увидеть её больше нельзя. Единственное
 * доказательство, что она держит, — то, что записали в момент забивки. Отсюда
 * и слово «паспорт»: документ выдаётся один раз и навсегда.
 *
 * ЧТО ДОКАЗЫВАЕТ НЕСУЩУЮ СПОСОБНОСТЬ. Отказ — насколько свая уходит вниз за
 * один удар в конце забивки. Чем меньше отказ, тем плотнее грунт держит сваю.
 * Проектировщик считает, какой отказ должен получиться; машинист меряет, какой
 * получился. Расхождение — повод не принимать сваю, а не примечание в конце
 * журнала.
 *
 * ПОЧЕМУ ОТКАЗ СЧИТАЕТСЯ, А НЕ ВВОДИТСЯ. Меряют его залогом: делают серию
 * ударов (обычно десять) и смотрят по рейке, на сколько свая ушла. Отказ —
 * частное от этих двух чисел. Если хранить и замеры, и результат, они разойдутся
 * на первой же правке, и станет непонятно, какому числу верить.
 */

/** Сколько ударов в залоге по умолчанию: серия, по которой меряют отказ. */
export const DEFAULT_SET_BLOWS = 10;

export interface RefusalMeasurement {
  /** Погружение за залог, мм. */
  penetrationMm: number | null;
  /** Ударов в залоге. */
  blows: number | null;
}

/**
 * Фактический отказ, мм на удар. `null` — замеров нет либо они бессмысленны.
 *
 * Округляем до сотых: рейкой точнее не мерят, а хвост из знаков создаёт
 * впечатление точности, которой нет.
 */
export function actualRefusalMm(measurement: RefusalMeasurement): number | null {
  const {penetrationMm, blows} = measurement;
  if (penetrationMm === null || blows === null) return null;
  if (!Number.isFinite(penetrationMm) || !Number.isFinite(blows)) return null;
  if (blows <= 0 || penetrationMm < 0) return null;
  return Math.round((penetrationMm / blows) * 100) / 100;
}

/**
 * Отказ больше проектного — свая не добита: грунт держит слабее, чем считал
 * проектировщик. Меньше либо равен — норма.
 *
 * `null`, когда сравнивать нечего: без проектного отказа приговор вынести
 * нельзя, а показать «норма» на пустом месте хуже, чем промолчать.
 */
export function refusalExceedsDesign(input: {
  actual: number | null;
  design: number | null;
}): boolean | null {
  if (input.actual === null || input.design === null) return null;
  return input.actual > input.design;
}

export interface PassportProblem {
  field: string;
  message: string;
}

/**
 * Проверка паспорта перед записью.
 *
 * ПОЧЕМУ ТАК МАЛО ОБЯЗАТЕЛЬНОГО. Обязателен только номер сваи: без него запись
 * не документ, а заметка. Остальное машинист заполняет по ходу, и половина
 * замеров появляется уже после забивки — требовать всё сразу значило бы
 * заставить его врать в поля, которые он пока не знает.
 *
 * ЧТО ВСЁ-ТАКИ ПРОВЕРЯЕМ — согласованность. Залог без числа ударов не
 * превращается в отказ, и наоборот: половина замера бесполезна и выглядит как
 * заполненное поле.
 */
export function validatePassport(input: {
  pileNumber: string;
  refusalSetPenetrationMm: number | null;
  refusalSetBlows: number | null;
}): PassportProblem[] {
  const problems: PassportProblem[] = [];

  if (!input.pileNumber.trim()) {
    problems.push({field: 'pileNumber', message: 'Укажите номер сваи по проекту'});
  }

  const hasPenetration = input.refusalSetPenetrationMm !== null;
  const hasBlows = input.refusalSetBlows !== null;
  if (hasPenetration !== hasBlows) {
    problems.push({
      field: hasPenetration ? 'refusalSetBlows' : 'refusalSetPenetrationMm',
      message: 'Отказ считается по залогу: нужны и погружение, и число ударов',
    });
  }

  return problems;
}
