/**
 * Простой вводится началом и концом. Здесь — разбор «ЧЧ:ММ» в метки времени.
 *
 * ПОЧЕМУ ОДИН ФАЙЛ НА ВСЕ ЭКРАНЫ. Форм ввода простоя в продукте пять, и у
 * каждой своя вёрстка. Расчёт при этом обязан быть один: разойдясь на
 * переходе через полночь, они дали бы одной и той же остановке разную
 * длительность в зависимости от того, с какого экрана её записали.
 *
 * ПОЧЕМУ «БЛИЖАЙШЕЕ ПРОШЛОЕ», А НЕ СЕГОДНЯШНЯЯ ДАТА. Ночная смена переходит
 * через полночь посреди работы. Если привязывать оба времени к календарному
 * «сегодня», простой с 23:40 до 00:10 превратится в минус двадцать три часа, а
 * записанный в 00:30 простой «с 23:40» уедет на сегодняшний вечер, которого
 * ещё не было. Поэтому конец — это последний момент с таким временем, который
 * уже наступил, а начало — последний такой момент до конца. Дату машинист не
 * вводит вовсе: в три часа ночи спрашивать у него, какое сегодня число, —
 * плохая идея.
 */

/** Время «ЧЧ:ММ» — то, что показывает и принимает поле `<input type="time">`. */
export function hhmm(at: Date): string {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** «ЧЧ:ММ» столько-то минут назад — разумное начало по умолчанию. */
export function hhmmAgo(minutes: number, now: Date = new Date()): string {
  return hhmm(new Date(now.getTime() - minutes * 60_000));
}

/** Последний момент с таким временем суток, наступивший не позже `bound`. */
function latestBefore(value: string, bound: Date): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  const at = new Date(bound);
  at.setHours(hours, minutes, 0, 0);
  // Час ещё не наступил сегодня — значит это вчерашний.
  if (at.getTime() > bound.getTime()) at.setDate(at.getDate() - 1);
  return at;
}

export interface DowntimeInterval {
  startedAt: string;
  endedAt: string;
  /** Длительность в минутах — для подсказки под полями. */
  minutes: number;
}

/**
 * Интервал из двух полей. `null` — поля пустые, не разбираются либо начало
 * совпадает с концом; кнопку в этом случае держат неактивной.
 */
export function downtimeInterval(
  startValue: string, endValue: string, now: Date = new Date(),
): DowntimeInterval | null {
  // Минута допуска: машинист ставит конец «сейчас», и секунды на его часах
  // успевают уйти вперёд серверных, пока он жмёт кнопку.
  const bound = new Date(now.getTime() + 60_000);
  const ended = latestBefore(endValue, bound);
  if (!ended) return null;
  const started = latestBefore(startValue, ended);
  if (!started) return null;

  const minutes = Math.round((ended.getTime() - started.getTime()) / 60_000);
  if (minutes <= 0) return null;

  return {startedAt: started.toISOString(), endedAt: ended.toISOString(), minutes};
}

/** Подпись под полями: сколько получилось. */
export function formatIntervalMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} мин`;
  if (rest === 0) return `${hours} ч`;
  return `${hours} ч ${rest} мин`;
}
