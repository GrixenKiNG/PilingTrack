import {render, screen, within} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {OperatorWorkplace} from '../api/contracts';
import {OperatorWorkplaceScreen} from '../operator-workplace-screen';

const snapshot = (): OperatorWorkplace => ({
  revision: 'v3-1', serverTime: '2026-08-27T06:00:00.000Z',
  operator: {id: 'operator-1', name: 'Иванов И.И.', blockers: [], warnings: []},
  assignments: [],
  equipment: {id: 'eq-1', name: 'Сваебойная установка № 7', model: 'СП-49', engineHoursTotal: 1240, nextMaintenanceAtHours: 1250, site: {id: 'site-1', name: 'Северный участок'}},
  shift: {id: 'shift-1', state: 'PLANNED', version: 3, type: 'DAY', productionDate: '2026-08-27', startedAt: null},
  phase: {number: 4, name: 'Готовность и пуск', state: 'CURRENT', progress: null, explanation: 'Все обязательные данные собраны'},
  phases: ['Допуск оператора', 'Получение установки', 'Проверка до работы', 'Готовность и пуск', 'Работа', 'Завершение', 'Передача'].map((name, index) => ({
    number: (index + 1) as 1|2|3|4|5|6|7, name,
    state: index < 3 ? 'COMPLETED' : index === 3 ? 'CURRENT' : 'UPCOMING',
    progress: null, explanation: index === 3 ? 'Все обязательные данные собраны' : null,
  })),
  workMode: 'NOT_STARTED',
  readiness: {decision: 'ALLOWED_WITH_NOTES', freshness: 'CURRENT', label: 'Работа разрешена с замечаниями', calculatedAt: null, ruleVersion: null, blockers: [], warnings: ['Проверьте уровень топлива после запуска'], evidence: []},
  primaryAction: {id: 'start-shift', label: 'Начать смену с замечаниями', kind: 'COMMAND', method: 'POST', route: '/api/operator/v3/commands/start-shift', expectedVersion: 3, offlinePolicy: 'FORBIDDEN', requiresEvidence: [], confirmation: 'Подтвердите ознакомление с замечаниями'},
  persistentActions: [
    {id: 'report-defect', label: 'Сообщить о дефекте', kind: 'SCREEN', offlinePolicy: 'CAPTURE_ONLY', requiresEvidence: [], confirmation: null},
    {id: 'report-incident', label: 'Сообщить об опасном событии', kind: 'SCREEN', offlinePolicy: 'CAPTURE_ONLY', requiresEvidence: [], confirmation: null},
    {id: 'add-photo', label: 'Добавить фотографию', kind: 'SCREEN', offlinePolicy: 'CAPTURE_ONLY', requiresEvidence: ['Фотография'], confirmation: null},
  ],
  actions: [], inspections: [], workZone: null,
  meter: {knownToday: true, current: 1240, source: 'reading', recordedAt: '2026-08-27T05:50:00.000Z'},
  activeInterval: null, production: {pilesToday: 0, entries: [], options: {piles: [], pickets: [], workTypes: []}, journal: []}, defects: [], incidents: [], maintenance: null, report: null,
  handover: {incoming: null, outgoing: null}, authority: {canCloseWithoutRecipient: false}, contacts: {dispatcher: null, mechanic: null, emergency: null},
  sync: {state: 'SYNCED', pending: 0, authorizationExpiresAt: null},
});

describe('рабочий экран оператора v3', () => {
  it('показывает семь фаз, одно главное и три постоянных действия', () => {
    render(<OperatorWorkplaceScreen snapshot={snapshot()} onAction={vi.fn()} busyActionId={null} message={null} />);
    expect(screen.getAllByTestId('operator-phase')).toHaveLength(7);
    const dock = screen.getByTestId('operator-primary-action');
    expect(within(dock).getAllByRole('button')).toHaveLength(1);
    expect(screen.getAllByTestId('operator-safety-action')).toHaveLength(3);
  });

  it('объясняет готовность без баллов и процентов', () => {
    render(<OperatorWorkplaceScreen snapshot={snapshot()} onAction={vi.fn()} busyActionId={null} message={null} />);
    expect(screen.getByText('Работа разрешена с замечаниями')).toBeInTheDocument();
    expect(screen.getByText('Проверьте уровень топлива после запуска')).toBeInTheDocument();
    expect(screen.queryByText(/балл|процент|%|score/i)).not.toBeInTheDocument();
  });

  it.each([1, 2, 3, 4, 5, 6, 7] as const)('оставляет три действия безопасности доступными на фазе %s', (phaseNumber) => {
    const value = snapshot();
    value.phase = {...value.phases[phaseNumber - 1], state: 'CURRENT'};
    value.phases = value.phases.map((phase) => ({...phase, state: phase.number < phaseNumber ? 'COMPLETED' : phase.number === phaseNumber ? 'CURRENT' : 'UPCOMING'}));
    render(<OperatorWorkplaceScreen snapshot={value} onAction={vi.fn()} busyActionId={null} message={null} />);

    expect(screen.getAllByTestId('operator-safety-action')).toHaveLength(3);
  });
});
