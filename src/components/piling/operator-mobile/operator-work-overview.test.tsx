import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
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

