import {ZodError} from 'zod';
import type {OperatorWorkplace} from './contracts';
import {OperatorV3ApiError} from './api-error';
import {operatorWorkplaceWireSchema} from './wire-contracts';

const unsupportedStateMarkers = ['invalid_value'];

export function normalizeOperatorWorkplace(input: unknown): OperatorWorkplace {
  try {
    const snapshot = operatorWorkplaceWireSchema.parse(input);
    const numbers = snapshot.phases.map((phase) => phase.number);
    if (new Set(numbers).size !== 7 || numbers.some((number, index) => number !== index + 1)) {
      throw new OperatorV3ApiError('Сервер вернул неполный маршрут смены', 'НЕПОЛНЫЙ_МАРШРУТ');
    }
    if (!snapshot.phases.some((phase) => phase.number === snapshot.phase.number && phase.state === snapshot.phase.state)) {
      throw new OperatorV3ApiError('Текущий этап не совпадает с маршрутом смены', 'ЭТАП_НЕ_СОВПАДАЕТ');
    }
    return snapshot;
  } catch (error) {
    if (error instanceof OperatorV3ApiError) throw error;
    if (error instanceof ZodError && error.issues.some((issue) => unsupportedStateMarkers.includes(issue.code))) {
      throw new OperatorV3ApiError('Сервер вернул неподдерживаемое состояние рабочего места', 'НЕПОДДЕРЖИВАЕМОЕ_СОСТОЯНИЕ');
    }
    throw new OperatorV3ApiError('Не удалось проверить данные рабочего места', 'НЕКОРРЕКТНЫЙ_СНИМОК');
  }
}
