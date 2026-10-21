/**
 * Поведение реестра схем событий: регистрация версий, проверка совместимости,
 * повторная регистрация и наблюдаемые последствия для validate().
 *
 * Каждый тест работает на своём экземпляре SchemaRegistry — глобальный
 * singleton не трогаем.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SchemaRegistry } from '@/core/event-bus/schema-registry/registry';

afterEach(() => {
  vi.useRealTimers();
});

const v1Schema = {
  type: 'object',
  required: ['id', 'siteId'],
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    siteId: { type: 'string' },
  },
};

describe('SchemaRegistry — регистрация схемы', () => {
  it('регистрирует первую версию: схема видна через getSchema/getAllSchemas, время берётся из часов', () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T10:00:00.000Z') });
    const registry = new SchemaRegistry();

    registry.register({
      id: 'order.created',
      version: 1,
      schema: v1Schema,
      compatibility: 'BACKWARD',
    });

    expect(registry.getSchema('order.created', 1)).toEqual(v1Schema);
    expect(registry.getAllSchemas()).toEqual([
      {
        id: 'order.created',
        version: 1,
        compatibility: 'BACKWARD',
        registeredAt: '2026-10-21T10:00:00.000Z',
      },
    ]);
    expect(registry.getAllVersions('order.created')).toEqual([1]);
    expect(registry.getLatestVersion('order.created')).toBe(1);
    expect(registry.validate('order.created', 1, { id: 'a', siteId: 'b' })).toBe(true);
    expect(() => registry.validate('order.created', 1, { id: 'a' })).toThrow(/validation failed/);
  });

  it('v2 с новым необязательным полем проходит BACKWARD-проверку и принимает старые события', () => {
    const registry = new SchemaRegistry();
    registry.register({
      id: 'order.created',
      version: 1,
      schema: v1Schema,
      compatibility: 'BACKWARD',
    });

    registry.register({
      id: 'order.created',
      version: 2,
      schema: {
        ...v1Schema,
        properties: { ...v1Schema.properties, comment: { type: 'string' } },
      },
      compatibility: 'BACKWARD',
    });

    expect(registry.getLatestVersion('order.created')).toBe(2);
    expect(registry.getAllVersions('order.created')).toEqual([1, 2]);
    // старый payload без нового поля остаётся валидным для новой версии
    expect(registry.validate('order.created', 2, { id: 'a', siteId: 'b' })).toBe(true);
    expect(
      registry.validate('order.created', 2, { id: 'a', siteId: 'b', comment: 'ok' })
    ).toBe(true);
  });

  it('v2 с новым обязательным полем без default отклоняется и не регистрируется', () => {
    const registry = new SchemaRegistry();
    registry.register({
      id: 'order.created',
      version: 1,
      schema: v1Schema,
      compatibility: 'BACKWARD',
    });

    expect(() =>
      registry.register({
        id: 'order.created',
        version: 2,
        schema: {
          ...v1Schema,
          required: [...v1Schema.required, 'source'],
          properties: { ...v1Schema.properties, source: { type: 'string' } },
        },
        compatibility: 'BACKWARD',
      })
    ).toThrow(/not BACKWARD-compatible with v1/);

    expect(registry.getSchema('order.created', 2)).toBeNull();
    expect(registry.getLatestVersion('order.created')).toBe(1);
    expect(registry.getAllVersions('order.created')).toEqual([1]);
  });

  it('в режиме FORWARD удаление обязательного поля отклоняется', () => {
    const registry = new SchemaRegistry();
    registry.register({
      id: 'order.created',
      version: 1,
      schema: v1Schema,
      compatibility: 'FORWARD',
    });

    expect(() =>
      registry.register({
        id: 'order.created',
        version: 2,
        schema: {
          type: 'object',
          required: ['id'],
          additionalProperties: false,
          properties: { id: { type: 'string' } },
        },
        compatibility: 'FORWARD',
      })
    ).toThrow(/not FORWARD-compatible with v1/);

    expect(registry.getLatestVersion('order.created')).toBe(1);
  });

  it('в режиме NONE проверка совместимости не выполняется', () => {
    const registry = new SchemaRegistry();
    registry.register({
      id: 'order.created',
      version: 1,
      schema: v1Schema,
      compatibility: 'NONE',
    });

    expect(() =>
      registry.register({
        id: 'order.created',
        version: 2,
        schema: {
          ...v1Schema,
          required: [...v1Schema.required, 'source'],
          properties: { ...v1Schema.properties, source: { type: 'string' } },
        },
        compatibility: 'NONE',
      })
    ).not.toThrow();

    expect(registry.getLatestVersion('order.created')).toBe(2);
  });

  it('повторная регистрация той же версии бросает ошибку и не затирает уже зарегистрированную схему', () => {
    const registry = new SchemaRegistry();
    registry.register({
      id: 'order.created',
      version: 1,
      schema: v1Schema,
      compatibility: 'BACKWARD',
    });

    const другойВариант = {
      type: 'object',
      required: ['id'],
      additionalProperties: false,
      properties: { id: { type: 'string' } },
    };
    expect(() =>
      registry.register({
        id: 'order.created',
        version: 1,
        schema: другойВариант,
        compatibility: 'BACKWARD',
      })
    ).toThrow(/already exists/);

    expect(registry.getSchema('order.created', 1)).toEqual(v1Schema);
    expect(registry.getAllVersions('order.created')).toEqual([1]);
  });
});

describe('SchemaRegistry — известные дефекты проверки совместимости', () => {
  it.fails(
    'дефект: BACKWARD не замечает сужение типа существующего обязательного поля',
    () => {
      const registry = new SchemaRegistry();
      registry.register({
        id: 'order.created',
        version: 1,
        schema: v1Schema,
        compatibility: 'BACKWARD',
      });

      // дефект: checkCompatibility сравнивает только списки required и наличие
      // свойств, но не их типы, поэтому v2 с id: number считается совместимой;
      // при этом старые события ({ id: 'uuid' }) перестают проходить validate.
      expect(() =>
        registry.register({
          id: 'order.created',
          version: 2,
          schema: {
            ...v1Schema,
            properties: { ...v1Schema.properties, id: { type: 'number' } },
          },
          compatibility: 'BACKWARD',
        })
      ).toThrow(/not BACKWARD-compatible with v1/);
      expect(() => registry.validate('order.created', 2, { id: 'a', siteId: 'b' })).toThrow();
    }
  );

  it.fails(
    'дефект: обязательное поле с default пропускается при регистрации, но старые события без него не валидируются',
    () => {
      const registry = new SchemaRegistry();
      registry.register({
        id: 'order.created',
        version: 1,
        schema: v1Schema,
        compatibility: 'BACKWARD',
      });

      // регистрация проходит: default считается достаточным для совместимости
      registry.register({
        id: 'order.created',
        version: 2,
        schema: {
          ...v1Schema,
          required: [...v1Schema.required, 'source'],
          properties: {
            ...v1Schema.properties,
            source: { type: 'string', default: 'manual' },
          },
        },
        compatibility: 'BACKWARD',
      });

      // дефект: Ajv создан без useDefaults, поэтому default не подставляется
      // и старое событие без source отклоняется, хотя проверка совместимости
      // обещала обратную совместимость.
      expect(registry.validate('order.created', 2, { id: 'a', siteId: 'b' })).toBe(true);
    }
  );
});
