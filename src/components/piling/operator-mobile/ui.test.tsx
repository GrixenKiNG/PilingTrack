import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {OperatorStatusStrip} from './operator-status-strip';
import {PhaseBar} from './ui';

const progress = [
  {phase: 'IDENTITY', label: 'Допуск', done: true, current: false},
  {phase: 'ADMISSION', label: 'Приём', done: false, current: true},
  {phase: 'PRESHIFT_INSPECTION', label: 'Осмотр', done: false, current: false},
] as const;

describe('рабочая оболочка машиниста', () => {
  it('объясняет текущий этап словами, а не только цветом', () => {
    render(<PhaseBar progress={[...progress]} />);

    expect(screen.getByText('Шаг 2 из 3')).toBeInTheDocument();
    expect(screen.getByRole('listitem', {name: 'Приём — текущий этап'})).toBeInTheDocument();
    expect(screen.getByRole('listitem', {name: 'Допуск — выполнено'})).toBeInTheDocument();
  });

  it('явно показывает, где находятся записи при потере связи', () => {
    const {rerender} = render(<OperatorStatusStrip online items={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('Синхронизировано');
    expect(screen.getByRole('status')).toHaveTextContent('Сервер доступен');

    rerender(<OperatorStatusStrip online={false} items={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('Офлайн');
    expect(screen.getByRole('status')).toHaveTextContent('Выработка и события сохранятся на устройстве');
  });

  it('отличает ожидающие записи от отклонённых сервером', () => {
    const pending = [{
      clientCommandId: 'p1', label: 'Выработка', command: {}, queuedAt: '', attempts: 0,
      state: 'PENDING' as const, lastError: null,
    }];
    const failed = [{
      ...pending[0], clientCommandId: 'f1', state: 'FAILED' as const, lastError: 'смена закрыта',
    }];

    const {rerender} = render(<OperatorStatusStrip online items={pending} />);
    expect(screen.getByRole('status')).toHaveTextContent('Ожидает отправки: 1');

    rerender(<OperatorStatusStrip online items={failed} />);
    expect(screen.getByRole('status')).toHaveTextContent('Нужно проверить: 1');
  });
});
