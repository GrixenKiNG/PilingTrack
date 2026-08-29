import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {OperatorAction} from '../api/contracts';
import {ProductionEntryForm} from '../forms/production-entry-form';
import {WorkIntervalForm} from '../forms/work-interval-form';
import {ShiftJournal} from '../shift-journal';
import {WorkExecutionStep} from '../steps/work-execution-step';
import type {OperatorWorkplace} from '../api/contracts';

const action = (id: string): OperatorAction => ({
  id,
  label: 'Выполнить действие',
  kind: 'COMMAND',
  offlinePolicy: 'FORBIDDEN',
  requiresEvidence: [],
  confirmation: null,
  method: 'POST',
  route: `/api/operator/v3/commands/${id}`,
  expectedVersion: 1,
});

describe('работа, перерыв и простой operator/v3', () => {
  it('не отправляет простой без причины и категории', () => {
    const onAction = vi.fn();
    render(<WorkIntervalForm kind="DOWNTIME" action={action('start-downtime')} active={false} onAction={onAction} />);

    const submit = screen.getByRole('button', {name: 'Начать простой'});
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Причина простоя'), {target: {value: 'Ожидание механика'}});
    fireEvent.change(screen.getByLabelText('Категория простоя'), {target: {value: 'TECHNICAL'}});
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({id: 'start-downtime'}), expect.objectContaining({
      kind: 'DOWNTIME',
      reason: 'Ожидание механика',
      category: 'TECHNICAL',
    }));
  });

  it('отправляет проверенную производственную запись', () => {
    const onAction = vi.fn();
    render(<ProductionEntryForm action={action('record-production')} options={{
      piles: [{id: 'pile-1', label: 'Свая 1'}],
      pickets: [{id: 'picket-1', label: 'Пикет 1'}],
      workTypes: [{id: 'type-1', label: 'Погружение'}],
    }} onAction={onAction} />);

    fireEvent.change(screen.getByLabelText('Свая'), {target: {value: 'pile-1'}});
    fireEvent.change(screen.getByLabelText('Вид работы'), {target: {value: 'type-1'}});
    fireEvent.change(screen.getByLabelText('Глубина, м'), {target: {value: '12,5'}});
    fireEvent.change(screen.getByLabelText('Начало'), {target: {value: '2026-08-27T08:00'}});
    fireEvent.change(screen.getByLabelText('Окончание'), {target: {value: '2026-08-27T08:30'}});
    fireEvent.click(screen.getByRole('button', {name: 'Записать выполненную работу'}));

    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({id: 'record-production'}), expect.objectContaining({
      pileId: 'pile-1',
      workTypeId: 'type-1',
      depth: 12.5,
    }));
  });

  it('не отправляет производственную запись дважды при повторном нажатии', () => {
    const onAction = vi.fn(() => new Promise<boolean>(() => undefined));
    render(<ProductionEntryForm action={action('record-production')} options={{
      piles: [{id: 'pile-1', label: 'Свая 1'}], pickets: [],
      workTypes: [{id: 'type-1', label: 'Погружение'}],
    }} onAction={onAction} />);

    fireEvent.change(screen.getByLabelText('Свая'), {target: {value: 'pile-1'}});
    fireEvent.change(screen.getByLabelText('Вид работы'), {target: {value: 'type-1'}});
    fireEvent.change(screen.getByLabelText('Глубина, м'), {target: {value: '12,5'}});
    fireEvent.change(screen.getByLabelText('Начало'), {target: {value: '2026-08-27T08:00'}});
    fireEvent.change(screen.getByLabelText('Окончание'), {target: {value: '2026-08-27T08:30'}});
    const submit = screen.getByRole('button', {name: 'Записать выполненную работу'});
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();
  });

  it('после обновления показывает только завершение активного интервала', () => {
    const onAction = vi.fn();
    const snapshot = {
      activeInterval: {id: 'interval-1', kind: 'BREAK', status: 'OPEN', startedAt: '2026-08-27T08:00:00.000Z', reason: null, category: null, comment: null, durationSeconds: null, version: 2},
      actions: [action('record-production'), action('start-downtime'), action('finish-interval')],
      primaryAction: {...action('finish-interval'), label: 'Завершить перерыв'},
      production: {pilesToday: 2, entries: [], options: {piles: [], pickets: [], workTypes: []}, journal: []},
      defects: [], incidents: [],
    } as unknown as OperatorWorkplace;

    render(<WorkExecutionStep snapshot={snapshot} busyActionId={null} onAction={onAction} />);

    expect(screen.getByRole('heading', {name: 'Текущий перерыв'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Завершить перерыв'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Записать выполненную работу'})).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Причина простоя')).not.toBeInTheDocument();
  });

  it('различает подтверждённые, ожидающие и спорные записи текстом', () => {
    render(<ShiftJournal entries={[
      {id: '1', occurredAt: '2026-08-27T08:00:00.000Z', title: 'Начало смены', details: null, state: 'CONFIRMED'},
      {id: '2', occurredAt: '2026-08-27T08:10:00.000Z', title: 'Фотография', details: null, state: 'PENDING'},
      {id: '3', occurredAt: '2026-08-27T08:20:00.000Z', title: 'Простой', details: null, state: 'CONFLICT'},
    ]} />);

    expect(screen.getByText('Подтверждено сервером')).toBeInTheDocument();
    expect(screen.getByText('Ожидает отправки')).toBeInTheDocument();
    expect(screen.getByText('Требует проверки')).toBeInTheDocument();
  });
});
