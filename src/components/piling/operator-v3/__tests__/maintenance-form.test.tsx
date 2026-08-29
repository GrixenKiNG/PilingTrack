import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {OperatorAction} from '../api/contracts';
import {MaintenanceForm} from '../forms/maintenance-form';

const action: OperatorAction = {
  id: 'record-operator-maintenance', label: 'Записать обслуживание', kind: 'COMMAND',
  offlinePolicy: 'FORBIDDEN', requiresEvidence: [], confirmation: null, method: 'POST',
  route: '/api/operator/v3/commands/record-operator-maintenance', expectedVersion: 2,
};

describe('обслуживание operator/v3', () => {
  it('показывает ремонт только для чтения без административного действия', () => {
    render(<MaintenanceForm tasks={[]} state={{repairStatus: 'VERIFICATION_REQUIRED', responsibleLabel: 'Механик Сидоров', verificationLabel: 'Инженер по безопасности'}} action={null} onAction={vi.fn()} />);

    expect(screen.getByText('Требуется независимая проверка')).toBeInTheDocument();
    expect(screen.getByText(/Подтверждение ремонта выполняет уполномоченный сотрудник/u)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('позволяет записать только выбранную разрешённую операцию', () => {
    const onAction = vi.fn();
    render(<MaintenanceForm tasks={[{id: 'task-1', label: 'Очистить защитное стекло', instruction: 'Остановите установку и очистите стекло мягкой салфеткой.'}]} state={{repairStatus: 'NOT_REQUIRED', responsibleLabel: null, verificationLabel: null}} action={action} onAction={onAction} />);

    const submit = screen.getByRole('button', {name: 'Записать выполненное обслуживание'});
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Разрешённая операция обслуживания'), {target: {value: 'task-1'}});
    fireEvent.click(submit);
    expect(onAction).toHaveBeenCalledWith(action, {taskId: 'task-1', comment: null});
  });

  it('не отправляет обслуживание повторно, пока сервер не ответил', () => {
    const onAction = vi.fn(() => new Promise<boolean>(() => undefined));
    render(<MaintenanceForm tasks={[{id: 'task-1', label: 'Очистить защитное стекло', instruction: 'Остановите установку.'}]} state={{repairStatus: 'NOT_REQUIRED', responsibleLabel: null, verificationLabel: null}} action={action} onAction={onAction} />);
    fireEvent.change(screen.getByLabelText('Разрешённая операция обслуживания'), {target: {value: 'task-1'}});
    const submit = screen.getByRole('button', {name: 'Записать выполненное обслуживание'});
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', {name: 'Обслуживание отправляется'})).toBeDisabled();
  });
});
