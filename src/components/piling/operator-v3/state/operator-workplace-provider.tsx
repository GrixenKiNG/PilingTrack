'use client';

import {createContext, useCallback, useEffect, useMemo, useReducer} from 'react';
import type {OperatorWorkplace} from '../api/contracts';
import {fetchOperatorWorkplace} from '../api/operator-v3-client';
import {safeOperatorError} from '../api/api-error';
import {initialWorkplaceState, workplaceReducer, type WorkplaceState} from './workplace-reducer';

export interface OperatorWorkplaceContextValue {
  state: WorkplaceState;
  refresh: () => void;
  acceptSnapshot: (snapshot: OperatorWorkplace) => void;
}

export const OperatorWorkplaceContext = createContext<OperatorWorkplaceContextValue | null>(null);

export function OperatorWorkplaceProvider({children}: {children: React.ReactNode}) {
  const [state, dispatch] = useReducer(workplaceReducer, initialWorkplaceState);
  const [requestNumber, requestRefresh] = useReducer((value: number) => value + 1, 0);
  const refresh = useCallback(() => requestRefresh(), []);
  const acceptSnapshot = useCallback((snapshot: OperatorWorkplace) => {
    dispatch({type: 'СНИМОК_ПОЛУЧЕН', snapshot});
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    dispatch({type: 'ЗАГРУЗКА_НАЧАТА'});
    void fetchOperatorWorkplace(controller.signal)
      .then((snapshot) => dispatch({type: 'СНИМОК_ПОЛУЧЕН', snapshot}))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) dispatch({type: 'ЗАГРУЗКА_ОШИБКА', message: safeOperatorError(error)});
      });
    return () => controller.abort();
  }, [requestNumber]);

  const value = useMemo(() => ({state, refresh, acceptSnapshot}), [state, refresh, acceptSnapshot]);
  return <OperatorWorkplaceContext.Provider value={value}>{children}</OperatorWorkplaceContext.Provider>;
}
