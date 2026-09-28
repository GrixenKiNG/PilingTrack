import {describe, expect, it} from 'vitest';
import {COMMAND_KINDS, createCommandKeys} from '../command-keys';

/**
 * Находка ревью: «успех любой команды обновляет ключи всех типов команд».
 *
 * Ключ — это защита от двойной записи: сервер узнаёт повтор по нему. Значит,
 * ключ обязан меняться РОВНО у той команды, которая прошла. Иначе повтор той же
 * команды уйдёт с новым ключом и сервер запишет её второй раз.
 */
describe('ключи команд', () => {
  it('прошедшая команда получает новый ключ, остальные сохраняют свои', () => {
    let counter = 0;
    const keys = createCommandKeys(() => `key-${++counter}`);
    const before = Object.fromEntries(COMMAND_KINDS.map((kind) => [kind, keys.get(kind)]));

    keys.renew('production');

    for (const kind of COMMAND_KINDS) {
      if (kind === 'production') expect(keys.get(kind), kind).not.toBe(before[kind]);
      else expect(keys.get(kind), kind).toBe(before[kind]);
    }
  });

  it('ключи разных команд различаются с самого начала', () => {
    const keys = createCommandKeys();
    const values = COMMAND_KINDS.map((kind) => keys.get(kind));
    expect(new Set(values).size).toBe(COMMAND_KINDS.length);
  });

  it('полное обновление меняет ключи всех команд', () => {
    let counter = 0;
    const keys = createCommandKeys(() => `key-${++counter}`);
    const before = COMMAND_KINDS.map((kind) => keys.get(kind));
    keys.renewAll();
    COMMAND_KINDS.forEach((kind, index) => expect(keys.get(kind)).not.toBe(before[index]));
  });
});
