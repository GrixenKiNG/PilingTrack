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
  it('показывает метры бурения и переводит часы простоя в минуты', () => {
    show();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('К работе допущен')).toBeInTheDocument();
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


