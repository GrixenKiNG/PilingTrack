'use client';

import {useContext} from 'react';
import {OperatorWorkplaceContext} from './operator-workplace-provider';

export function useOperatorWorkplace() {
  const context = useContext(OperatorWorkplaceContext);
  if (!context) throw new Error('Рабочее место оператора используется вне поставщика данных');
  return context;
}
