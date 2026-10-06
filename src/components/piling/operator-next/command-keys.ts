import {newCommandId} from '@/components/piling/operator-mobile/api';

/**
 * Ключи команд по видам.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Раньше ключи лежали в состоянии оболочки и обновлялись
 * все разом после ЛЮБОЙ удачной команды. Это ломало идемпотентность: записал
 * сваю — сменился и ключ чек-листа, и ключ происшествия, и ключ поправки. Ключ,
 * который «обновился просто так», перестаёт защищать от повтора: тот же человек
 * с тем же намерением отправит команду с НОВЫМ ключом, и сервер второй раз её
 * примет, потому что узнаёт повтор именно по ключу.
 *
 * Здесь ключ обновляется ровно у той команды, которая прошла.
 */
export type CommandKind = 'accept' | 'checklist' | 'production' | 'incident' | 'correction';

export const COMMAND_KINDS: readonly CommandKind[] = [
  'accept', 'checklist', 'production', 'incident', 'correction',
];

export interface CommandKeys {
  /** Ключ команды на момент вызова. Меняется только через `renew`. */
  get(kind: CommandKind): string;
  /** Новый ключ ровно у одного вида команды — после подтверждённой удачи. */
  renew(kind: CommandKind): void;
  /** Новые ключи у всех: вход/выход из смены, полное обновление контура. */
  renewAll(): void;
}

export function createCommandKeys(make: () => string = newCommandId): CommandKeys {
  const keys = {} as Record<CommandKind, string>;
  for (const kind of COMMAND_KINDS) keys[kind] = make();
  return {
    get: (kind) => keys[kind],
    renew: (kind) => {
      keys[kind] = make();
    },
    renewAll: () => {
      for (const kind of COMMAND_KINDS) keys[kind] = make();
    },
  };
}
