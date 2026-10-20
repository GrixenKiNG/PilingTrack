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

/** Что мастер постановил по свае. Значения совпадают с `PileAcceptance`. */
export type PileAcceptanceValue = 'PENDING' | 'ACCEPTED' | 'NEEDS_REDRIVE';

export const PILE_ACCEPTANCE_LABELS: Record<PileAcceptanceValue, string> = {
  PENDING: 'Не разобрана',
  ACCEPTED: 'Принята',
  NEEDS_REDRIVE: 'На добивку',
};

/**
 * Что подсказать мастеру по свае.
 *
 * ПОЧЕМУ ПОДСКАЗКА, А НЕ РЕШЕНИЕ. Отказ больше проектного — сильный довод не
 * принимать сваю, но не приговор: грунт «отдыхает», и добивка через сутки часто
 * даёт нужный отказ; бывает и ошибка замера. Решает человек, который отвечает
 * за участок. Программа обязана показать довод, а не подменять собой мастера —
 * ровно так же, как она не запрещает работу по осмотру.
 *
 * `null` — сказать нечего: без проектного отказа сравнивать не с чем.
 */
export function suggestAcceptance(input: {
  actualRefusalMm: number | null;
  designRefusalMm: number | null;
}): {value: PileAcceptanceValue; reason: string} | null {
  const exceeds = refusalExceedsDesign({
    actual: input.actualRefusalMm,
    design: input.designRefusalMm,
  });
  if (exceeds === null) return null;
  return exceeds
    ? {
      value: 'NEEDS_REDRIVE',
      reason: `Отказ ${input.actualRefusalMm} мм/удар больше проектного ${input.designRefusalMm}`,
    }
    : {
      value: 'ACCEPTED',
      reason: `Отказ ${input.actualRefusalMm} мм/удар в пределах проектного ${input.designRefusalMm}`,
    };
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
  drivenDepthM?: number | null;
  /** Длина сваи из её марки, м. Неизвестна — глубину не с чем сверять. */
  pileLengthM?: number | null;
  /** Погружали добойником: голова ушла ниже уровня грунта. */
  followerUsed?: boolean;
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

  // Свая не уходит глубже собственной длины — ей нечем.
  //
  // Исключение одно: погружение добойником. Инструмент уводит голову ниже
  // уровня грунта, и тогда остриё оказывается глубже, чем длина сваи от
  // поверхности. Без добойника такая глубина — описка в замере, и поймать её
  // здесь дешевле, чем объяснять на приёмке.
  //
  // Длина берётся из марки (`PileGrade.lengthMm`) — единственного источника
  // длины в продукте. Не задана — сверять не с чем, и молчим: выдуманный
  // отказ хуже пропущенной описки.
  if (
    !input.followerUsed
    && input.drivenDepthM != null
    && input.pileLengthM != null
    && input.pileLengthM > 0
    && input.drivenDepthM > input.pileLengthM
  ) {
    problems.push({
      field: 'drivenDepthM',
      message: `Глубина ${input.drivenDepthM} м больше длины сваи ${input.pileLengthM} м. `
        + 'Так бывает только при погружении добойником — отметьте его или поправьте замер',
    });
  }

  return problems;
}

// ============================================================
// Залоги — то, из чего журнал забивки состоит по норме.
//
// ЧТО ТАКОЕ ЗАЛОГ. Серия ударов (обычно десять), после которой по рейке
// снимают, на сколько свая ушла. Нормативная форма журнала (СП 45.13330,
// бывш. СНиП 3.02.01-87) требует не итоговую цифру, а «погружение сваи от
// каждого залога»: по ряду залогов видно, как свая входила — равномерно,
// уткнулась в линзу или провалилась.
//
// ПОЧЕМУ ОТКАЗ БЕРЁТСЯ ПО ТРЁМ ПОСЛЕДНИМ. Один залог — это один замер с
// рейкой и одной оговоркой машиниста. Норма велит мерить погружение в трёх
// последних залогах и брать среднее: случайный удар по валуну или сбитый
// отсчёт так не становится приговором свае.
// ============================================================

/** Сколько последних залогов даёт отказ по норме. */
export const REFUSAL_SET_WINDOW = 3;

/**
 * Сколько суток грунт «отдыхает» перед добивкой.
 *
 * Забивка разжижает грунт вокруг сваи, и отказ выходит завышенным — «ложный
 * отказ». Через двое-трое суток грунт восстанавливается, и добивка показывает
 * настоящее сопротивление. Берём три: нижняя граница (двое) слишком часто даёт
 * повторную добивку, и свая проходит круг заново.
 */
export const SOIL_REST_DAYS = 3;

/** Один залог журнала. */
export interface DrivingSet {
  /** № залога по порядку, с единицы. */
  ordinal: number;
  /** Ударов в залоге. */
  blows: number;
  /** Погружение за залог, мм. */
  penetrationMm: number;
  /** Высота подъёма бойка на залоге, м. Машинист меняет её по ходу. */
  dropHeightM: number | null;
}

/** Отказ на этом залоге, мм/удар. `null` — замер бессмысленный. */
export function setRefusalMm(set: Pick<DrivingSet, 'blows' | 'penetrationMm'>): number | null {
  return actualRefusalMm({penetrationMm: set.penetrationMm, blows: set.blows});
}

/**
 * Отказ сваи по журналу: среднее по трём последним залогам.
 *
 * ПОЧЕМУ СРЕДНЕЕ ПО ОТКАЗАМ, А НЕ ПО СУММАМ. Норма говорит именно о средней
 * величине отказа за залог. При равном числе ударов в залогах это одно и то
 * же; при разном — среднее по отказам не даёт длинному залогу перевесить
 * короткий, а сравнивают с проектным отказом именно отказ за удар.
 *
 * ПОЧЕМУ РАБОТАЕТ И НА ОДНОМ ЗАЛОГЕ. Залоги ведутся не на каждой свае: старые
 * паспорта и быстрая запись с телефона дают один замер. Считать по тому, что
 * есть, честнее, чем молчать: число подписано тем, сколько залогов за ним
 * стоит (`setsUsed`).
 *
 * `null` — залогов нет вовсе.
 */
export function journalRefusalMm(sets: readonly DrivingSet[]): {
  refusalMm: number;
  setsUsed: number;
} | null {
  const measured = sets
    .slice()
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((set) => setRefusalMm(set))
    .filter((refusal): refusal is number => refusal !== null);
  if (measured.length === 0) return null;

  const window = measured.slice(-REFUSAL_SET_WINDOW);
  const sum = window.reduce((total, refusal) => total + refusal, 0);
  return {
    refusalMm: Math.round((sum / window.length) * 100) / 100,
    setsUsed: window.length,
  };
}

/**
 * Свая забита по норме: три последних залога подряд дали отказ не больше
 * проектного.
 *
 * ПОЧЕМУ НЕ ХВАТАЕТ СРЕДНЕГО. Среднее прячет разброс: два тугих залога и один
 * провальный дадут пристойное среднее, хотя свая на последнем ушла вниз —
 * значит опора под ней ещё не найдена. Норма требует именно трёх подряд.
 *
 * `null` — сказать нечего: залогов меньше трёх либо нет проектного отказа.
 */
export function drivingComplete(input: {
  sets: readonly DrivingSet[];
  designRefusalMm: number | null;
}): boolean | null {
  const design = input.designRefusalMm;
  if (design === null) return null;
  const measured = input.sets
    .slice()
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((set) => setRefusalMm(set))
    .filter((refusal): refusal is number => refusal !== null);
  if (measured.length < REFUSAL_SET_WINDOW) return null;
  return measured.slice(-REFUSAL_SET_WINDOW).every((refusal) => refusal <= design);
}

/**
 * Когда сваю, отправленную на добивку, можно добивать.
 *
 * Раньше срока добивка меряет не грунт, а его разжиженное состояние, и вторая
 * запись в журнале выйдет такой же негодной, как первая.
 */
export function redriveReadyAt(decidedAt: Date): Date {
  return new Date(decidedAt.getTime() + SOIL_REST_DAYS * 24 * 60 * 60 * 1000);
}
