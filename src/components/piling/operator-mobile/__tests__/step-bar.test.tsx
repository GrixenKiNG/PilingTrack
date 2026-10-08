import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {NextStepDock, NextStepSlotProvider, NextStepTab, useNextStepSlot} from '../step-bar';
import type {NextStep} from '../shift-next-step';

const step = (patch: Partial<NextStep> = {}): NextStep => ({
  action: {kind: 'ACCEPT_EQUIPMENT'}, title: 'Принять установку', hint: 'Выберите установку.',
  enabled: true, index: 2, total: 7, ...patch,
});

function renderTab(props: Partial<React.ComponentProps<typeof NextStepTab>> = {}) {
  const handlers = {onNext: vi.fn(), onFinishWork: vi.fn()};
  render(<NextStepTab step={step()} {...handlers} {...props} />);
  return handlers;
}

// Владелец 09.10.2026: одна круглая кнопка «Следующий шаг» в нижнем меню вместо
// панели «Главная / Следующий шаг / Завершить смену».
describe('NextStepTab', () => {
  it('показывает одну кнопку с названием шага и номером шага', () => {
    renderTab();
    const button = screen.getByRole('button', {name: 'Следующий шаг: Принять установку'});
    expect(button).toHaveAttribute('title', 'Шаг 2 из 7: Принять установку');
    expect(screen.queryByRole('button', {name: 'Главная'})).toBeNull();
    expect(screen.queryByRole('button', {name: 'Завершить смену'})).toBeNull();
  });

  it('нажатие ведёт к следующему шагу', () => {
    const handlers = renderTab();
    fireEvent.click(screen.getByRole('button', {name: /Следующий шаг/}));
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
    expect(handlers.onFinishWork).not.toHaveBeenCalled();
  });

  it('шаг «Завершить работу» просит подтверждение и не идёт одним нажатием', () => {
    const handlers = renderTab({step: step({action: {kind: 'FINISH_WORK'}, title: 'Завершить работу'})});
    fireEvent.click(screen.getByRole('button', {name: /Следующий шаг/}));

    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(handlers.onFinishWork).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Да, завершить'}));
    expect(handlers.onFinishWork).toHaveBeenCalledTimes(1);
    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('«Продолжить работу» закрывает вопрос и ничего не завершает', () => {
    const handlers = renderTab({step: step({action: {kind: 'FINISH_WORK'}, title: 'Завершить работу'})});
    fireEvent.click(screen.getByRole('button', {name: /Следующий шаг/}));
    fireEvent.click(screen.getByRole('button', {name: 'Продолжить работу'}));

    expect(handlers.onFinishWork).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('недоступный шаг (смена закрыта) показывает причину и ничего не вызывает', () => {
    const handlers = renderTab({step: step({
      action: {kind: 'NONE'}, title: 'Смена закрыта', hint: 'Отчёт сдан.', enabled: false,
    })});
    fireEvent.click(screen.getByRole('button', {name: /Следующий шаг/}));

    expect(screen.getByRole('status')).toHaveTextContent('Отчёт сдан.');
    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(handlers.onFinishWork).not.toHaveBeenCalled();
  });

  it('пока идёт запрос, кнопка не срабатывает', () => {
    const handlers = renderTab({busy: true, step: step({action: {kind: 'FINISH_WORK'}, title: 'Завершить работу'})});
    fireEvent.click(screen.getByRole('button', {name: /Следующий шаг/}));

    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('NextStepDock', () => {
  it('одна кнопка в нижней полосе, когда нижних вкладок нет', () => {
    render(<NextStepDock step={step()} onNext={() => undefined} onFinishWork={() => undefined} />);
    expect(screen.getByRole('navigation', {name: 'Следующий шаг смены'})).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('NextStepSlot', () => {
  function Probe() {
    return <div data-testid="slot">{useNextStepSlot()}</div>;
  }

  it('отдаёт кнопку экранам модуля', () => {
    render(<NextStepSlotProvider value={<b>КНОПКА</b>}><Probe /></NextStepSlotProvider>);
    expect(screen.getByTestId('slot')).toHaveTextContent('КНОПКА');
  });

  it('без провайдера пусто', () => {
    render(<Probe />);
    expect(screen.getByTestId('slot')).toBeEmptyDOMElement();
  });
});
