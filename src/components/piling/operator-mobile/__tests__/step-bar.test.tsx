import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {StepBar, StepBarSlotProvider, useStepBarSlot} from '../step-bar';
import type {FinishShift, NextStep} from '../shift-next-step';

const step = (patch: Partial<NextStep> = {}): NextStep => ({
  action: {kind: 'ACCEPT_EQUIPMENT'}, title: 'Принять установку', hint: 'Выберите установку.',
  enabled: true, index: 2, total: 7, ...patch,
});
const finish = (patch: Partial<FinishShift> = {}): FinishShift => ({
  action: {kind: 'FINISH_WORK'}, enabled: true, hint: 'Работа закончится.', ...patch,
});

function renderBar(props: Partial<React.ComponentProps<typeof StepBar>> = {}) {
  const handlers = {onHome: vi.fn(), onNext: vi.fn(), onFinishWork: vi.fn(), onGoClosing: vi.fn()};
  render(<StepBar step={step()} finish={finish()} {...handlers} {...props} />);
  return handlers;
}

// Владелец 07.10.2026: большие кнопки «Главная», «Следующий шаг» и «Завершить смену».
describe('StepBar', () => {
  it('показывает три кнопки и номер шага', () => {
    renderBar();
    expect(screen.getByRole('button', {name: 'Главная'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Следующий шаг: Принять установку'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Завершить смену'})).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Шаг 2 из 7');
  });

  it('«Главная» и «Следующий шаг» зовут свои обработчики', () => {
    const handlers = renderBar();
    fireEvent.click(screen.getByRole('button', {name: 'Главная'}));
    fireEvent.click(screen.getByRole('button', {name: /Следующий шаг/}));
    expect(handlers.onHome).toHaveBeenCalledTimes(1);
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
  });

  it('завершение работы просит подтверждение и не идёт одним нажатием', () => {
    const handlers = renderBar();
    fireEvent.click(screen.getByRole('button', {name: 'Завершить смену'}));

    expect(handlers.onFinishWork).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Да, завершить'}));
    expect(handlers.onFinishWork).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('«Продолжить работу» закрывает вопрос и ничего не завершает', () => {
    const handlers = renderBar();
    fireEvent.click(screen.getByRole('button', {name: 'Завершить смену'}));
    fireEvent.click(screen.getByRole('button', {name: 'Продолжить работу'}));

    expect(handlers.onFinishWork).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('шаг «Завершить работу» тоже идёт через подтверждение, а не мимо него', () => {
    const handlers = renderBar({step: step({action: {kind: 'FINISH_WORK'}, title: 'Завершить работу'})});
    fireEvent.click(screen.getByRole('button', {name: /Следующий шаг/}));

    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(handlers.onFinishWork).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('в сдаче «Завершить смену» ведёт к закрытию без подтверждения', () => {
    const handlers = renderBar({finish: finish({action: {kind: 'GO_CLOSING'}})});
    fireEvent.click(screen.getByRole('button', {name: 'Завершить смену'}));

    expect(handlers.onGoClosing).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('недоступное «Завершить смену» объясняет, что сделать сначала, и ничего не вызывает', () => {
    const handlers = renderBar({finish: finish({
      action: {kind: 'NONE'}, enabled: false, hint: 'Смену можно завершить, когда начнётся работа. Сейчас: принять установку.',
    })});
    fireEvent.click(screen.getByRole('button', {name: 'Завершить смену'}));

    expect(screen.getByRole('status')).toHaveTextContent('Сейчас: принять установку');
    expect(handlers.onFinishWork).not.toHaveBeenCalled();
    expect(handlers.onGoClosing).not.toHaveBeenCalled();
  });

  it('недоступный «Следующий шаг» (смена закрыта) показывает причину', () => {
    const handlers = renderBar({step: step({
      action: {kind: 'NONE'}, title: 'Смена закрыта', hint: 'Отчёт сдан.', enabled: false,
    })});
    fireEvent.click(screen.getByRole('button', {name: /Следующий шаг/}));

    expect(screen.getByRole('status')).toHaveTextContent('Отчёт сдан.');
    expect(handlers.onNext).not.toHaveBeenCalled();
  });

  it('пока идёт запрос, кнопки действий не срабатывают', () => {
    const handlers = renderBar({busy: true});
    fireEvent.click(screen.getByRole('button', {name: /Следующий шаг/}));
    fireEvent.click(screen.getByRole('button', {name: 'Завершить смену'}));

    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('«Главная» закрывает открытый вопрос о завершении', () => {
    const handlers = renderBar();
    fireEvent.click(screen.getByRole('button', {name: 'Завершить смену'}));
    fireEvent.click(screen.getByRole('button', {name: 'Главная'}));

    expect(handlers.onHome).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('StepBarSlot', () => {
  function Probe() {
    return <div data-testid="slot">{useStepBarSlot()}</div>;
  }

  it('отдаёт панель экранам модуля', () => {
    render(<StepBarSlotProvider value={<b>ПАНЕЛЬ</b>}><Probe /></StepBarSlotProvider>);
    expect(screen.getByTestId('slot')).toHaveTextContent('ПАНЕЛЬ');
  });

  it('без провайдера пусто', () => {
    render(<Probe />);
    expect(screen.getByTestId('slot')).toBeEmptyDOMElement();
  });
});
