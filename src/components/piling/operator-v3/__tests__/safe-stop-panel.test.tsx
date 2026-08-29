import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {OperatorWorkplace} from '../api/contracts';
import {OperatorWorkplaceScreen} from '../operator-workplace-screen';

const stopSnapshot = (): OperatorWorkplace => ({
  revision: 'v3-stop', serverTime: '2026-08-27T06:00:00.000Z',
  operator: {id: 'operator-1', name: 'Иванов И.И.', blockers: [], warnings: []}, assignments: [],
  equipment: {id: 'eq-1', name: 'Сваебойная установка № 7', model: 'СП-49', engineHoursTotal: 1240, nextMaintenanceAtHours: 1250, site: {id: 'site-1', name: 'Северный участок'}},
  shift: {id: 'shift-1', state: 'STARTED', version: 8, type: 'DAY', productionDate: '2026-08-27', startedAt: '2026-08-27T05:00:00.000Z'},
  phase: {number: 5, name: 'Работа', state: 'CURRENT', progress: null, explanation: 'Зафиксировано опасное событие'},
  phases: ['Допуск оператора', 'Получение установки', 'Проверка до работы', 'Готовность и пуск', 'Работа', 'Завершение', 'Передача'].map((name, index) => ({number: (index + 1) as 1|2|3|4|5|6|7, name, state: index < 4 ? 'COMPLETED' : index === 4 ? 'CURRENT' : 'UPCOMING', progress: null, explanation: null})),
  workMode: 'STOP_REQUIRED',
  readiness: {decision: 'DENIED', freshness: 'CURRENT', label: 'Работа запрещена', calculatedAt: null, ruleVersion: 'правило-3', blockers: [{label: 'Опасное событие', actionLabel: 'Безопасно остановить установку'}], warnings: [], evidence: []},
  primaryAction: {id: 'confirm-safe-stop', label: 'Подтвердить безопасную остановку', kind: 'COMMAND', method: 'POST', route: '/api/operator/v3/commands/confirm-safe-stop', expectedVersion: 8, offlinePolicy: 'AUTHORIZED', requiresEvidence: [], confirmation: 'После подтверждения производственные записи останутся недоступны до новой оценки'},
  persistentActions: [
    {id: 'report-defect', label: 'Сообщить о дефекте', kind: 'COMMAND', method: 'POST', route: '/api/operator/v3/commands/report-defect', expectedVersion: 8, offlinePolicy: 'CAPTURE_ONLY', requiresEvidence: [], confirmation: null},
    {id: 'report-incident', label: 'Сообщить об опасном событии', kind: 'COMMAND', method: 'POST', route: '/api/operator/v3/commands/report-incident', expectedVersion: 8, offlinePolicy: 'CAPTURE_ONLY', requiresEvidence: ['Фотография'], confirmation: null},
    {id: 'add-photo', label: 'Добавить фотографию', kind: 'SCREEN', offlinePolicy: 'CAPTURE_ONLY', requiresEvidence: ['Фотография'], confirmation: null},
  ],
  actions: [], inspections: [], workZone: null,
  meter: {knownToday: true, current: 1240, source: 'reading', recordedAt: '2026-08-27T05:50:00.000Z'},
  activeInterval: null, production: {pilesToday: 12, entries: [], options: {piles: [], pickets: [], workTypes: []}, journal: []}, defects: [],
  incidents: [{id: 'incident-1', state: 'STOP_REQUIRED', category: 'TECHNICAL_HAZARD', severity: 'CRITICAL', description: 'Неконтролируемое движение', observedSigns: ['UNCONTROLLED_MOVEMENT'], stopRequired: true, evidenceMediaIds: ['media-1'], occurredAt: '2026-08-27T06:00:00.000Z', stoppedAt: null, title: 'Опасное событие', instruction: 'Переведите органы управления в нейтральное положение и заглушите двигатель', requiresSafeStop: true, safeStopApplied: false}],
  maintenance: null, report: null, handover: {incoming: null, outgoing: null}, authority: {canCloseWithoutRecipient: false}, contacts: {dispatcher: null, mechanic: null, emergency: null}, sync: {state: 'SYNCED', pending: 0, authorizationExpiresAt: null},
});

describe('прерывание безопасной остановки', () => {
  it('заменяет рабочий экран одной инструкцией и единственным главным действием', () => {
    const onAction = vi.fn();
    render(<OperatorWorkplaceScreen snapshot={stopSnapshot()} onAction={onAction} busyActionId={null} message={null} />);

    expect(screen.getByRole('heading', {name: 'Требуется безопасная остановка'})).toHaveFocus();
    expect(screen.getByText('Переведите органы управления в нейтральное положение и заглушите двигатель')).toBeInTheDocument();
    const [button] = screen.getAllByRole('button', {name: 'Подтвердить безопасную остановку'});
    expect(button).toBeDisabled();
    expect(screen.queryByText('Выполнено свай')).not.toBeInTheDocument();
    expect(screen.queryByText('Добавить выполненную работу')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Текущее безопасное состояние'), {target: {value: 'Двигатель заглушён, рабочая зона ограждена'}});
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({id: 'confirm-safe-stop'}), expect.objectContaining({incidentId: 'incident-1', safeStateDescription: 'Двигатель заглушён, рабочая зона ограждена'}), undefined, 'shift-1');
  });

  it('не объявляет возобновление до новой текущей оценки', () => {
    const value = stopSnapshot();
    value.workMode = 'STOPPED';
    value.primaryAction = null;
    value.maintenance = {
      incidentId: 'incident-1', repairStatus: 'COMPLETED', repairedById: 'mechanic-1',
      repairedAt: '2026-08-27T07:00:00.000Z', repairSummary: 'Заменён повреждённый шланг',
      independentCheck: {id: 'verification-1', status: 'PASSED', revision: 1, verifiedById: 'inspector-1', verifiedAt: '2026-08-27T07:30:00.000Z', note: 'Утечка устранена'},
      readinessRefresh: 'PENDING', canResume: false, blockers: ['Ожидается новая оценка технической готовности'],
    };
    render(<OperatorWorkplaceScreen snapshot={value} onAction={vi.fn()} busyActionId={null} message={null} />);

    expect(screen.getByRole('heading', {name: 'Восстановление безопасной работы'})).toBeInTheDocument();
    expect(screen.getByText('Независимая проверка пройдена')).toBeInTheDocument();
    expect(screen.getByText('Ожидается новая оценка технической готовности')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Возобновить работу'})).not.toBeInTheDocument();
    expect(screen.queryByText('Выполнено свай')).not.toBeInTheDocument();
  });

  it('показывает оператору только разрешённое сервером возобновление', () => {
    const value = stopSnapshot();
    value.workMode = 'STOPPED';
    value.primaryAction = {id: 'resume-work', label: 'Возобновить работу', kind: 'COMMAND', method: 'POST', route: '/api/operator/v3/commands/resume-work', expectedVersion: 8, offlinePolicy: 'FORBIDDEN', requiresEvidence: [], confirmation: null};
    value.maintenance = {
      incidentId: 'incident-1', repairStatus: 'COMPLETED', repairedById: 'mechanic-1',
      repairedAt: '2026-08-27T07:00:00.000Z', repairSummary: 'Заменён повреждённый шланг',
      independentCheck: {id: 'verification-1', status: 'PASSED', revision: 1, verifiedById: 'inspector-1', verifiedAt: '2026-08-27T07:30:00.000Z', note: 'Утечка устранена'},
      readinessRefresh: 'CURRENT', canResume: true, blockers: [],
    };
    const onAction = vi.fn().mockResolvedValue(true);
    render(<OperatorWorkplaceScreen snapshot={value} onAction={onAction} busyActionId={null} message={null} />);
    fireEvent.click(screen.getByRole('button', {name: 'Возобновить работу'}));

    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({id: 'resume-work'}), {incidentId: 'incident-1'}, undefined, 'shift-1');
    expect(screen.queryByText(/подтвердить ремонт/i)).not.toBeInTheDocument();
  });
});
