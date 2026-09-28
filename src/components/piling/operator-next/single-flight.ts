/**
 * Одна команда за раз.
 *
 * ЗАЧЕМ. В перчатке по кнопке попадают дважды. Нажатия приходят в одном такте,
 * а `busy` в состоянии React выставляется асинхронно: второй обработчик ещё
 * видит `busy === false` и отправляет вторую команду. Этот замок ставится
 * СИНХРОННО, до первого `await`, поэтому второе нажатие не входит вовсе.
 *
 * ПОЧЕМУ НЕ ПРОСТО `disabled`. Кнопка гасится по состоянию — то есть на
 * следующем рендере. Между двумя нажатиями в одном такте рендера не было.
 */
export interface SingleFlight {
  /** Идёт ли команда прямо сейчас (синхронно, без состояния React). */
  readonly busy: boolean;
  /**
   * `started === false` — команда уже идёт, повторный вход отклонён без
   * побочных эффектов. `started === true` — задача выполнена, `value` её итог.
   */
  run<T>(task: () => Promise<T>): Promise<{started: boolean; value: T | undefined}>;
}

export function createSingleFlight(): SingleFlight {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    async run<T>(task: () => Promise<T>) {
      if (busy) return {started: false, value: undefined};
      busy = true;
      try {
        return {started: true, value: await task()};
      } finally {
        busy = false;
      }
    },
  };
}
