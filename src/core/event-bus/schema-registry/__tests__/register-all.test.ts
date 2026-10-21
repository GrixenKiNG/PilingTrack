/**
 * registerAllEventSchemas — ошибка регистрации не должна теряться (находка Codex XP45).
 *
 * Раньше каждая ошибка глоталась комментарием «уже зарегистрирована», а флаг
 * _schemasRegistered выставлялся даже при сбое: несовместимая схема молча
 * пропадала, и повторить инициализацию было нельзя. Теперь повторная
 * регистрация той же версии пропускается, любая другая ошибка собирается и
 * выбрасывается после прохода, а флаг остаётся невыставленным.
 *
 * Режим validate для неизвестной версии (fail-open) здесь не проверяется:
 * это решение владельца.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import type { SchemaDef } from '../registry';

const mocks = vi.hoisted(() => ({
  getEventSchemas: vi.fn(),
}));

vi.mock('../schemas', () => ({
  getEventSchemas: mocks.getEventSchemas,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function schema(version: number, requireCount: boolean): SchemaDef {
  return {
    id: 'XP45',
    version,
    compatibility: 'BACKWARD',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        count: { type: 'integer' },
      },
      required: requireCount ? ['code', 'count'] : ['code'],
      additionalProperties: false,
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
});

it('сообщает об отказе и позволяет повторить незавершённую регистрацию', async () => {
  mocks.getEventSchemas.mockReturnValue([
    schema(1, false),
    schema(2, true),
  ]);

  const { registerAllEventSchemas, schemaRegistry } =
    await import('../index');

  expect(() => registerAllEventSchemas()).toThrow(
    'Schema XP45.v2 is not BACKWARD-compatible with v1',
  );
  expect(schemaRegistry.getSchema('XP45', 1)).not.toBeNull();
  expect(schemaRegistry.getSchema('XP45', 2)).toBeNull();

  // Исправляем источник схем и повторяем инициализацию.
  mocks.getEventSchemas.mockReturnValue([
    schema(1, false),
    schema(2, false),
  ]);

  expect(() => registerAllEventSchemas()).not.toThrow();
  expect(mocks.getEventSchemas).toHaveBeenCalledTimes(2);
  expect(schemaRegistry.getAllVersions('XP45')).toEqual([1, 2]);

  expect(() => schemaRegistry.validate('XP45', 2, {})).toThrow(
    'Event validation failed for XP45.v2',
  );

  // Успешная инициализация остаётся идемпотентной.
  registerAllEventSchemas();
  expect(mocks.getEventSchemas).toHaveBeenCalledTimes(2);
});
