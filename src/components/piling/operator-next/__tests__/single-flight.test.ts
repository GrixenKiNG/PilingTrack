import {describe, expect, it} from 'vitest';
import {createSingleFlight} from '../single-flight';

/**
 * Неподтверждённая гарантия ревью: «двойное нажатие любой кнопки команды шлёт
 * ОДНУ команду».
 *
 * Поля гасятся состоянием React, а оно выставляется асинхронно. Два нажатия в
 * одном такте успевают оба увидеть `busy === false`. Замок берётся синхронно и
 * второй вход отклоняет.
 */
describe('одна команда за раз', () => {
  it('второй вход в том же такте не запускает задачу повторно', async () => {
    const flight = createSingleFlight();
    let calls = 0;
    const task = async () => {
      calls += 1;
      return 'отправлено';
    };

    const first = flight.run(task);
    const second = flight.run(task);
    const [a, b] = await Promise.all([first, second]);

    expect(calls).toBe(1);
    expect(a).toEqual({started: true, value: 'отправлено'});
    expect(b.started).toBe(false);
    expect(b.value).toBeUndefined();
  });

  it('после завершения команды следующая проходит', async () => {
    const flight = createSingleFlight();
    await flight.run(async () => 'раз');
    const second = await flight.run(async () => 'два');
    expect(second).toEqual({started: true, value: 'два'});
  });

  it('отказ снимает замок: следующая попытка не блокируется навсегда', async () => {
    const flight = createSingleFlight();
    await expect(flight.run(async () => {
      throw new Error('сеть');
    })).rejects.toThrow('сеть');
    expect(flight.busy).toBe(false);
    expect(await flight.run(async () => 'после отказа')).toEqual({started: true, value: 'после отказа'});
  });
});
