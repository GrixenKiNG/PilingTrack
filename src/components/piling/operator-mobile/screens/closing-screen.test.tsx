import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {ClosedScreen, ClosingScreen} from './closing-screen';

describe('закрытие смены с неотправленными записями', () => {
  const state = {
    assignment: {equipmentName: 'Liebherr LRH 100 №1'},
    checklists: [{stage: 'EO_AFTER', done: true}],
    warnings: [],
    production: {piles: {count: 3, meters: 42}, drilling: {count: 0, meters: 0}, downtimeHours: 0},
  } as unknown as OperatorMobileState;

  it('не даёт закрыть смену, пока на телефоне ждут отправки записи, и предлагает отправить их', () => {
    const onClose = vi.fn();
    const onSendNow = vi.fn();
    render(<ClosingScreen state={state} busy={false} error={null} onOpenService={vi.fn()}
      onClose={onClose} pending={2} onSendNow={onSendNow} />);

    expect(screen.getByText('На телефоне ждут отправки: 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Закрыть смену и отправить отчёт'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Отправить записи с телефона'}));
    expect(onSendNow).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('зовёт разобрать отклонённые записи и не прячет закрытие смены навсегда', () => {
    const onClose = vi.fn();
    const onRetryFailed = vi.fn();
    render(<ClosingScreen state={state} busy={false} error={null} onOpenService={vi.fn()}
      onClose={onClose} failed={2} onRetryFailed={onRetryFailed} />);

    expect(screen.getByText('Сервер не принял 2 записи')).toBeInTheDocument();
    expect(screen.getByText(/Причина — в списке вверху/)).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Отправить записи с телефона'})).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Повторить отклонённые'}));
    expect(onRetryFailed).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', {name: 'Закрыть смену и отправить отчёт'}));
    expect(onClose).toHaveBeenCalled();
  });

  it('закрывает смену, когда очередь пуста', () => {
    const onClose = vi.fn();
    render(<ClosingScreen state={state} busy={false} error={null} onOpenService={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', {name: 'Закрыть смену и отправить отчёт'}));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('закрытая смена оператора', () => {
  it('показывает проверяемую серверную квитанцию отчёта', () => {
    const state = {
      assignment: {equipmentName: 'Liebherr LRH 100 №1'},
      receipt: {
        reportId: 'RM-12345678-2026-09-13',
        submittedAt: '2026-09-13T15:35:00.000Z',
        closedAt: '2026-09-13T15:35:00.000Z',
        timezone: 'Europe/Moscow',
      },
      production: {
        piles: {count: 20, meters: 280},
        drilling: {count: 12, meters: 180},
        downtimeHours: 6,
      },
    } as unknown as OperatorMobileState;

    render(<ClosedScreen state={state} />);

    expect(screen.getByText('Принято сервером')).toBeInTheDocument();
    expect(screen.getByText('RM-12345678-2026-09-13')).toBeInTheDocument();
    expect(screen.getByText(/13 сент\. 2026 г\., 18:35/)).toBeInTheDocument();
  });

  it('не заявляет о принятом отчёте, если сервер не вернул квитанцию', () => {
    const state = {
      assignment: {equipmentName: 'Liebherr LRH 100 №1'},
      receipt: null,
      production: {
        piles: {count: 0, meters: 0},
        drilling: {count: 0, meters: 0},
        downtimeHours: 0,
      },
    } as unknown as OperatorMobileState;

    render(<ClosedScreen state={state} />);

    expect(screen.queryByText('Принято сервером')).not.toBeInTheDocument();
    expect(screen.getByText('Номер отчёта пока недоступен')).toBeInTheDocument();
    // Без отказа на экране закрытой смены ничего лишнего: строка отказа не рисуется.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  /**
   * Отказ, из-за которого экран закрылся, не теряется (аудит R82, находка 5).
   *
   * Смену закрыли на другом устройстве, машинист ещё был в фазе работы, ввёл
   * сваю и получил 409 «Смена уже закрыта». Без строки отказа итог смены молча
   * отличался бы от введённого.
   */
  it('показывает строку отказа с подробностями, если отказ был', () => {
    const state = {
      assignment: {equipmentName: 'Liebherr LRH 100 №1'},
      receipt: null,
      production: {
        piles: {count: 12, meters: 60},
        drilling: {count: 0, meters: 0},
        downtimeHours: 0,
      },
    } as unknown as OperatorMobileState;

    render(<ClosedScreen state={state} error="Смена уже закрыта"
      errorDetails={['Записи за эту смену сервер не принимает']} />);

    // Итог смены на месте — строка отказа над ним, а не вместо него.
    expect(screen.getByText('Номер отчёта пока недоступен')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Смена уже закрыта');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent))
      .toContain('Записи за эту смену сервер не принимает');
  });
});
