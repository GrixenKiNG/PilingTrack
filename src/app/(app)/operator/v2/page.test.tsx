import {render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {UserRole} from '@/lib/types';

const auth = vi.hoisted(() => ({currentUser: null as {role: UserRole} | null}));
vi.mock('@/lib/store', () => ({usePilingStore: (select: (state: typeof auth) => unknown) => select(auth)}));
vi.mock('@/components/piling/operator-v2/operator-shift-v2', () => ({OperatorShiftV2: () => <div>Рабочая смена</div>}));
import OperatorV2Page from './page';

describe('доступ к экрану v2', () => {
  beforeEach(() => { auth.currentUser = null; });

  it.each(['DISPATCHER', 'FOREMAN', 'MECHANIC', 'SAFETY_ENGINEER', 'ASSISTANT'] as UserRole[])(
    '%s видит отказ, рабочее место не открывается', (role) => {
      auth.currentUser = {role};
      render(<OperatorV2Page />);
      expect(screen.getByText('Экран доступен только машинисту')).toBeInTheDocument();
      expect(screen.queryByText('Рабочая смена')).not.toBeInTheDocument();
    },
  );

  it('машинист открывает рабочее место', () => {
    auth.currentUser = {role: 'OPERATOR'};
    render(<OperatorV2Page />);
    expect(screen.getByText('Рабочая смена')).toBeInTheDocument();
  });

  it('не открывает рабочее место до определения пользователя', () => {
    render(<OperatorV2Page />);
    expect(screen.queryByText('Рабочая смена')).not.toBeInTheDocument();
  });
});
