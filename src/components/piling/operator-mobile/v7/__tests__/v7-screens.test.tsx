import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {HomeScreen} from '../v7-screens';
import {workStateFixture} from '../../__tests__/fixtures';

vi.mock('../../operator-concept.css', () => ({}));

describe('v7: закрытая смена', () => {
  const closed = (submittedAt: string | null) => workStateFixture({
    phase: 'CLOSED',
    operator: {id: 'op-1', name: 'Митрофанов Алексей Геннадьевич'},
    receipt: {reportId: 'RM-1', submittedAt, closedAt: '2026-10-16T15:00:00.000Z', timezone: 'Europe/Moscow'},
  } as Partial<ReturnType<typeof workStateFixture>>);

  it('благодарит по имени и отчеству и показывает квитанцию отчёта', () => {
    render(<HomeScreen state={closed('2026-10-16T15:01:00.000Z')} busy={false} onStep={vi.fn()} onFinishWork={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Спасибо за работу!');
    expect(screen.getByRole('status')).toHaveTextContent('Алексей Геннадьевич, смена закрыта, отчёт ушёл диспетчеру. Хорошего отдыха.');
    expect(screen.getByText('RM-1')).toBeInTheDocument();
  });

  it('не обещает отправку, пока отчёт не принят сервером', () => {
    render(<HomeScreen state={closed(null)} busy={false} onStep={vi.fn()} onFinishWork={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Спасибо за работу!');
    expect(screen.getByRole('status')).not.toHaveTextContent('ушёл диспетчеру');
  });

  it('в работе благодарности нет', () => {
    render(<HomeScreen state={workStateFixture({phase: 'WORK'})} busy={false} onStep={vi.fn()} onFinishWork={vi.fn()} />);
    expect(screen.queryByText('Спасибо за работу!')).not.toBeInTheDocument();
  });
});
