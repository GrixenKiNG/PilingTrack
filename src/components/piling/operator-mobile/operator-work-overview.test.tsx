import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile';
vi.mock('./operator-concept.css', () => ({}));
import {OperatorWorkOverview} from './operator-work-overview';

const state = {
  phase: 'WORK', productionDate: '2026-09-20', assignment: {equipmentName: 'Установка 12', siteName: 'Площадка А'},
  identity: {ppe: {confirmed: true, missing: []}, briefing: {ok: true}, knowledge: {ok: true}, documents: []},
  checklists: ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE'].map(stage => ({stage, done: true})),
  permit: {allowed: true, blocks: []}, production: {piles: {count: 12}, drilling: {count: 4, meters: 24}, downtimeHours: 0.25}, entries: [],
} as unknown as OperatorMobileState;

function show(value = state, busy = false) {
  const onAction = vi.fn();
  render(<OperatorWorkOverview state={value} variant="v7" busy={busy} onAction={onAction} onFinish={vi.fn()} />);
  return onAction;
}

describe('рабочий обзор оператора', () => {
  it.each(['v2', 'v5', 'v7'] as const)('%s показывает поправку у последней записи', (variant) => {
    render(<OperatorWorkOverview state={{...state, entries: [{id: 'entry-1', kind: 'DOWNTIME', label: 'Ожидание', value: 2,
      meters: null, occurredAt: '2026-09-20T08:00:00.000Z', corrections: []}]}} variant={variant}
      onAction={vi.fn()} onFinish={vi.fn()} onCorrect={vi.fn().mockResolvedValue(true)} />);
    expect(screen.getByRole('button', {name: 'Поправить'})).toBeInTheDocument();
  });
  it.each(['v2', 'v5', 'v7'] as const)('%s скрывает поправку закрытой смены', (variant) => {
    render(<OperatorWorkOverview state={{...state, phase: 'CLOSED', entries: [{id: 'entry-1', kind: 'DOWNTIME', label: 'Ожидание', value: 2,
      meters: null, occurredAt: '2026-09-20T08:00:00.000Z', corrections: []}]}} variant={variant}
      onAction={vi.fn()} onFinish={vi.fn()} onCorrect={vi.fn()} />);
    expect(screen.queryByRole('button', {name: 'Поправить'})).not.toBeInTheDocument();
  });
  it('не отправляет пустой итог или короткую причину и сохраняет отказ в форме', async () => {
    const onCorrect = vi.fn().mockResolvedValue(false);
    render(<OperatorWorkOverview state={{...state, entries: [{id: 'entry-1', kind: 'DOWNTIME', label: 'Ожидание', value: 2,
      meters: null, occurredAt: '2026-09-20T08:00:00.000Z', corrections: []}]}} variant="v7"
      onAction={vi.fn()} onFinish={vi.fn()} onCorrect={onCorrect} correctionError="Смена уже закрыта" />);
    fireEvent.click(screen.getByRole('button', {name: 'Поправить'}));
    const form = within(screen.getByRole('group', {name: 'Поправка записи'}));
    expect(form.getByRole('button', {name: 'Записать поправку'})).toBeDisabled();
    fireEvent.change(form.getByLabelText('Сколько часов простоя было на самом деле'), {target: {value: '1,5'}});
    expect(form.getByRole('button', {name: 'Записать поправку'})).toBeDisabled();
    fireEvent.change(form.getByLabelText('Что случилось'), {target: {value: 'Ошибка ввода'}});
    fireEvent.click(form.getByRole('button', {name: 'Записать поправку'}));
    expect(onCorrect).toHaveBeenCalledWith({entryId: 'entry-1', kind: 'DOWNTIME', actual: 1.5, reason: 'Ошибка ввода'});
    expect(form.getByRole('alert')).toHaveTextContent('Смена уже закрыта');
    expect(form.getByLabelText('Что случилось')).toHaveValue('Ошибка ввода');
  });
  it.each([
    ['PILES', 'Сколько свай было на самом деле'], ['DRILLING', 'Сколько скважин было на самом деле'],
  ] as const)('передаёт итог и причину поправки %s', async (kind, label) => {
    const onCorrect = vi.fn().mockResolvedValue(true);
    render(<OperatorWorkOverview state={{...state, entries: [{id: 'entry-1', kind, label: 'Выработка', value: 2,
      meters: 12, occurredAt: '2026-09-20T08:00:00.000Z', corrections: []}]}} variant="v2"
      onAction={vi.fn()} onFinish={vi.fn()} onCorrect={onCorrect} />);
    fireEvent.click(screen.getByRole('button', {name: 'Поправить'}));
    fireEvent.change(screen.getByLabelText(label), {target: {value: '1'}});
    fireEvent.change(screen.getByLabelText('Что случилось'), {target: {value: 'Ошибка ввода'}});
    fireEvent.click(screen.getByRole('button', {name: 'Записать поправку'}));
    expect(onCorrect).toHaveBeenCalledWith({entryId: 'entry-1', kind, actual: 1, reason: 'Ошибка ввода'});
    await waitFor(() => expect(screen.queryByRole('group', {name: 'Поправка записи'})).not.toBeInTheDocument());
  });
  it('v10 называет действия глаголами и передаёт исходные виды записи', () => {
    const onAction = vi.fn();
    render(<OperatorWorkOverview state={state} variant="v10" onAction={onAction} onFinish={vi.fn()} />);
    for (const [label, kind] of [
      ['Добавить сваю', 'PILES'], ['Добавить бурение', 'DRILLING'],
      ['Записать простой', 'DOWNTIME'], ['Записать паспорт сваи', 'PASSPORT'],
    ]) {
      fireEvent.click(screen.getByRole('button', {name: label}));
      expect(onAction).toHaveBeenLastCalledWith(kind);
    }
  });
  it('показывает дату открытой смены, а не сегодняшнюю дату старого отчёта', () => {
    show({...state, shift: {id: 'old-shift', productionDate: '2026-09-19'}} as OperatorMobileState);
    expect(screen.getByText('19.09.2026')).toBeInTheDocument();
    expect(screen.queryByText('20.09.2026')).not.toBeInTheDocument();
  });
  it('показывает метры бурения и простой в часах, а не в минутах', () => {
    show();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('0,25')).toBeInTheDocument();
    expect(screen.getByText('ч')).toBeInTheDocument();
    expect(screen.queryByText('мин')).not.toBeInTheDocument();
    expect(screen.getByText('К работе допущен')).toBeInTheDocument();
  });
  it('в последних записях простой тоже в часах', () => {
    show({...state, entries: [{id: 'e1', kind: 'DOWNTIME', label: 'Ожидание бетона', value: 1.5, occurredAt: '2026-09-20T08:00:00.000Z', corrections: []}]} as unknown as OperatorMobileState);
    expect(screen.getByText('1,5 ч')).toBeInTheDocument();
    expect(screen.queryByText(/мин/)).not.toBeInTheDocument();
  });
  it('не объявляет готовность только по разрешению сервера при незавершённом осмотре', () => {
    show({...state, checklists: state.checklists.map(c => ({...c, done: false}))});
    expect(screen.queryByText('К работе допущен')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Добавить сваю'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Простой'})).toBeEnabled();
  });
  it('передаёт выбранное действие форме', () => {
    const action = show();
    fireEvent.click(screen.getByRole('button', {name: 'Добавить бурение'}));
    expect(action).toHaveBeenCalledWith('DRILLING');
  });
  it('не допускает повторное действие во время отправки', () => {
    const action = show(state, true);
    fireEvent.click(screen.getByRole('button', {name: 'Добавить сваю'}));
    expect(action).not.toHaveBeenCalled();
    for (const button of screen.getAllByRole('button', {name: 'Завершить работу'})) expect(button).toBeDisabled();
  });
});

