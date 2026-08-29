import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {OperatorAction} from '../api/contracts';
import {CorrectiveActionForm} from '../forms/corrective-action-form';
import {CloseWithoutRecipientForm, HandoverForm} from '../forms/handover-form';
import {ShiftReportForm} from '../forms/shift-report-form';
import {ShiftCompletionStep} from '../steps/shift-completion-step';
import {EquipmentHandoverStep} from '../steps/equipment-handover-step';
import type {OperatorWorkplace} from '../api/contracts';

const command = (id: string): OperatorAction => ({
  id,
  label: 'Выполнить действие',
  kind: 'COMMAND',
  offlinePolicy: 'FORBIDDEN',
  requiresEvidence: [],
  confirmation: null,
  method: 'POST',
  route: `/api/operator/v3/commands/${id}`,
  expectedVersion: 4,
});

describe('завершение смены operator/v3', () => {
  it('подтверждает серверный итог без возможности изменить показатели', () => {
    const onAction = vi.fn();
    render(<ShiftReportForm action={command('complete-report')} summary={{piles: 8, drillingMeters: 42, downtimeSeconds: 900}} initialEngineHours={1240} onAction={onAction} />);

    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('8')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Конечные моточасы'), {target: {value: '1242,5'}});
    fireEvent.click(screen.getByRole('button', {name: 'Подтвердить отчёт смены'}));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({id: 'complete-report'}), {endingEngineHours: 1242.5, comment: null});
  });

  it('объясняет, что отправка передачи ещё не закрывает смену', () => {
    const onAction = vi.fn();
    render(<HandoverForm action={command('submit-handover')} onAction={onAction} />);

    expect(screen.getByText(/смена останется открытой до принятия/u)).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Отправить передачу'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Состояние установки и важные замечания'), {target: {value: 'Без замечаний'}});
    fireEvent.click(screen.getByRole('button', {name: 'Отправить передачу'}));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({id: 'submit-handover'}), {summary: 'Без замечаний'});
  });

  it('не отправляет передачу дважды до серверного снимка', () => {
    const onAction = vi.fn(() => new Promise<boolean>(() => undefined));
    render(<HandoverForm action={command('submit-handover')} onAction={onAction} />);
    fireEvent.change(screen.getByLabelText('Состояние установки и важные замечания'), {target: {value: 'Без замечаний'}});
    const submit = screen.getByRole('button', {name: 'Отправить передачу'});
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', {name: 'Передача отправляется'})).toBeDisabled();
  });

  it('не позволяет полномочному закрытию без принимающего без причины', () => {
    const onAction = vi.fn();
    render(<CloseWithoutRecipientForm action={command('close-shift-without-recipient')} onAction={onAction} />);
    const submit = screen.getByRole('button', {name: 'Закрыть смену без принимающего'});
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Причина закрытия без принимающего'), {target: {value: 'На объекте нет следующей смены'}});
    fireEvent.click(submit);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({id: 'close-shift-without-recipient'}), {reason: 'На объекте нет следующей смены'});
  });

  it('не создаёт исправление без значения и причины', () => {
    const onAction = vi.fn();
    render(<CorrectiveActionForm recordId="record-1" recordLabel="Простой 15 минут" action={command('correct-record')} onAction={onAction} />);

    const submit = screen.getByRole('button', {name: 'Зарегистрировать исправление'});
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Правильное значение'), {target: {value: '20 минут'}});
    fireEvent.change(screen.getByLabelText('Причина исправления'), {target: {value: 'Уточнение по журналу'}});
    fireEvent.click(submit);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({id: 'correct-record'}), {
      recordId: 'record-1', correctedValue: '20 минут', reason: 'Уточнение по журналу',
    });
  });

  it('встраивает серверный черновик отчёта в шестую фазу', () => {
    const value = {
      report: {id: 'report-1', status: 'draft', summary: {piles: 8, drillingMeters: 42, downtimeSeconds: 900}, endingEngineHours: null, submittedAt: null},
      meter: {current: 1240}, inspections: [], primaryAction: command('complete-report'),
    } as unknown as OperatorWorkplace;
    render(<ShiftCompletionStep snapshot={value} busyActionId={null} onAction={vi.fn()} />);
    expect(screen.getByLabelText('Конечные моточасы')).toHaveValue('1240');
    expect(screen.getByRole('button', {name: 'Подтвердить отчёт смены'})).toBeInTheDocument();
  });

  it('не показывает самоприёмку и обычное закрытие без полномочия', () => {
    const value = {
      operator: {id: 'operator-1'}, authority: {canCloseWithoutRecipient: false},
      handover: {incoming: null, outgoing: {id: 'handover-1', state: 'SUBMITTED', submittedById: 'operator-1', summary: 'Без замечаний'}},
      primaryAction: command('accept-handover'), shift: {state: 'HANDOVER_PENDING'},
    } as unknown as OperatorWorkplace;
    render(<EquipmentHandoverStep snapshot={value} busyActionId={null} onAction={vi.fn()} />);
    expect(screen.getByText('Передача отправлена. Ожидается принятие другим сотрудником.')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /принять установку/i})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /закрыть смену без принимающего/i})).not.toBeInTheDocument();
  });

  it('показывает исключительное закрытие только при серверном полномочии', () => {
    const value = {
      operator: {id: 'dispatcher-1'}, authority: {canCloseWithoutRecipient: true},
      handover: {incoming: null, outgoing: {id: 'handover-1', state: 'SUBMITTED', submittedById: 'operator-1', summary: 'Без замечаний'}},
      primaryAction: command('close-shift-without-recipient'), shift: {state: 'HANDOVER_PENDING'},
    } as unknown as OperatorWorkplace;
    render(<EquipmentHandoverStep snapshot={value} busyActionId={null} onAction={vi.fn()} />);
    expect(screen.getByLabelText('Причина закрытия без принимающего')).toBeInTheDocument();
  });
});
