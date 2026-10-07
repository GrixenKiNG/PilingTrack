import { describe, it, expect } from 'vitest';
import { withoutUnchangedHours } from '../equipment-form';

describe('withoutUnchangedHours — форма не откатывает свежие моточасы', () => {
  it('наработку не меняли — ключ не уходит на сервер', () => {
    expect(withoutUnchangedHours({ name: 'А', engineHoursTotal: 3000 }, 3000)).toEqual({ name: 'А' });
  });

  it('наработку изменили — ключ остаётся', () => {
    expect(withoutUnchangedHours({ name: 'А', engineHoursTotal: 3100 }, 3000)).toEqual({ name: 'А', engineHoursTotal: 3100 });
  });

  it('поле очистили у установки с наработкой — null уходит (наработка неизвестна)', () => {
    expect(withoutUnchangedHours({ engineHoursTotal: null }, 3000)).toEqual({ engineHoursTotal: null });
  });

  it('у установки не было наработки и поле пусто — ключ не уходит', () => {
    expect(withoutUnchangedHours({ engineHoursTotal: null }, null)).toEqual({});
    expect(withoutUnchangedHours({ engineHoursTotal: null }, undefined)).toEqual({});
  });

  it('исходный объект не мутируется', () => {
    const payload = { engineHoursTotal: 5 };
    withoutUnchangedHours(payload, 5);
    expect(payload).toEqual({ engineHoursTotal: 5 });
  });
});
