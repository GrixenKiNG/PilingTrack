import {describe, expect, it} from 'vitest';
import {initialWorkplaceState, workplaceReducer} from '../state/workplace-reducer';

describe('состояние рабочего места оператора v3', () => {
  it('не сохраняет частичный снимок при ошибке загрузки', () => {
    const loading = workplaceReducer(initialWorkplaceState, {type: 'ЗАГРУЗКА_НАЧАТА'});
    const failed = workplaceReducer(loading, {
      type: 'ЗАГРУЗКА_ОШИБКА',
      message: 'Не удалось загрузить рабочее место',
    });
    expect(failed).toEqual({status: 'ОШИБКА', snapshot: null, message: 'Не удалось загрузить рабочее место'});
  });

  it('заменяет состояние только подтверждённым полным снимком', () => {
    const snapshot = {revision: 'v3-1'} as never;
    const ready = workplaceReducer(initialWorkplaceState, {type: 'СНИМОК_ПОЛУЧЕН', snapshot});
    expect(ready).toEqual({status: 'ГОТОВО', snapshot, message: null});
  });
});
