import type {OperatorWorkplace} from '../api/contracts';

export type WorkplaceState =
  | {status: 'ЗАГРУЗКА'; snapshot: null; message: null}
  | {status: 'ГОТОВО'; snapshot: OperatorWorkplace; message: null}
  | {status: 'ОШИБКА'; snapshot: null; message: string};

export type WorkplaceAction =
  | {type: 'ЗАГРУЗКА_НАЧАТА'}
  | {type: 'СНИМОК_ПОЛУЧЕН'; snapshot: OperatorWorkplace}
  | {type: 'ЗАГРУЗКА_ОШИБКА'; message: string};

export const initialWorkplaceState: WorkplaceState = {status: 'ЗАГРУЗКА', snapshot: null, message: null};

export function workplaceReducer(_state: WorkplaceState, action: WorkplaceAction): WorkplaceState {
  if (action.type === 'СНИМОК_ПОЛУЧЕН') return {status: 'ГОТОВО', snapshot: action.snapshot, message: null};
  if (action.type === 'ЗАГРУЗКА_ОШИБКА') return {status: 'ОШИБКА', snapshot: null, message: action.message};
  return initialWorkplaceState;
}
