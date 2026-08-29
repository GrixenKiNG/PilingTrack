import {fireEvent, render, screen, within} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {OperatorWorkplace} from '../api/contracts';
import {OperatorWorkplaceScreen} from '../operator-workplace-screen';

const snapshot = (): OperatorWorkplace => ({
  revision: 'v3-1', serverTime: '2026-08-27T06:00:00.000Z',
  operator: {id: 'operator-1', name: 'Иванов И.И.', blockers: [], warnings: []},
  assignments: [],
  equipment: {id: 'eq-1', name: 'Сваебойная установка № 7', model: 'СП-49', engineHoursTotal: 1240, nextMaintenanceAtHours: 1250, site: {id: 'site-1', name: 'Северный участок'}},
  shift: {id: 'shift-1', state: 'PLANNED', version: 3, type: 'DAY', productionDate: '2026-08-27', startedAt: null},
  phase: {number: 5, name: 'Запуск и прогрев', state: 'CURRENT', progress: null, explanation: 'Все обязательные данные собраны'},
  phases: ['Личный допуск', 'Принятие установки', 'Предсменный осмотр', 'Проверка площадки', 'Запуск и прогрев', 'Работа', 'После смены', 'Закрытие'].map((name, index) => ({
    number: (index + 1) as 1|2|3|4|5|6|7|8, name,
    state: index < 4 ? 'COMPLETED' : index === 4 ? 'CURRENT' : 'UPCOMING',
    progress: null, explanation: index === 4 ? 'Все обязательные данные собраны' : null,
  })),
  workMode: 'NOT_STARTED',
  eligibility: {status: 'ELIGIBLE', label: 'Личный допуск подтверждён', blockers: [], warnings: [],
    profile: {availability: 'NOT_PROVIDED', phone: null, email: null, employer: null, documents: 'NOT_PROVIDED', training: 'NOT_PROVIDED', medicalClearance: 'NOT_PROVIDED'},
    knowledgeTest: {status: 'NOT_PROVIDED', correctAnswers: null, totalQuestions: null}},
  weather: null, checklistExecutions: [], startup: null,
  service: {status: 'NOT_PROVIDED', actions: 0, fluidReadings: 0, blockers: []},
  work: {piles: 0, drillingMeters: 0, downtimeSeconds: 0},
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
  handover: {incoming: null, outgoing: null}, authority: {canCloseWithoutRecipient: false}, contacts: {
    dispatcher: {availability: 'NOT_PROVIDED', id: null, name: null, role: 'DISPATCHER', phone: null},
    mechanic: {availability: 'NOT_PROVIDED', id: null, name: null, role: 'MECHANIC', phone: null},
    emergency: {availability: 'NOT_PROVIDED', id: null, name: null, role: 'EMERGENCY', phone: null},
  },
  sync: {state: 'SYNCED', pending: 0, authorizationExpiresAt: null},
});

describe('рабочий экран оператора v3', () => {
  it('показывает только вкладки, за которыми есть данные, и одно главное действие', () => {
    render(<OperatorWorkplaceScreen snapshot={snapshot()} onAction={vi.fn()} busyActionId={null} message={null} />);

    // «Дефекты» нет намеренно: в снимке ни дефектов, ни опасных событий.
    const navigation = screen.getByRole('navigation', {name: 'Основная навигация оператора'});
    expect(within(navigation).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Смена', 'Работа', 'Машина',
    ]);
    const dock = screen.getByTestId('operator-primary-action');
    expect(within(dock).getAllByRole('button')).toHaveLength(1);
    expect(screen.getAllByTestId('operator-safety-action')).toHaveLength(3);
  });

  it('переключает содержимое по вкладке, а не только подсветку', () => {
    render(<OperatorWorkplaceScreen snapshot={snapshot()} onAction={vi.fn()} busyActionId={null} message={null} />);

    expect(screen.getByText('Сводка смены')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Машина'}));

    expect(screen.queryByText('Сводка смены')).not.toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Машина'})).toBeInTheDocument();
    expect(screen.getByText('До ТО')).toBeInTheDocument();
  });

  it('добавляет вкладку дефектов, как только по машине есть запись', () => {
    const withDefect: OperatorWorkplace = {...snapshot(), defects: [{
      id: 'defect-1', severity: 'HIGH', status: 'OPEN', title: 'Течь гидравлики',
      description: 'Подтёк под насосом', observedSigns: [], evidenceMediaIds: [],
      reportedAt: '2026-08-27T07:10:00.000Z',
    }]};
    render(<OperatorWorkplaceScreen snapshot={withDefect} onAction={vi.fn()} busyActionId={null} message={null} />);

    const navigation = screen.getByRole('navigation', {name: 'Основная навигация оператора'});
    expect(within(navigation).getAllByRole('button').map((button) => button.textContent)).toContain('Дефекты');

    fireEvent.click(screen.getByRole('button', {name: 'Дефекты'}));
    expect(screen.getByText('Течь гидравлики')).toBeInTheDocument();
  });

  it('показывает текущий этап из восьми и раскрывает весь маршрут по запросу', () => {
    render(<OperatorWorkplaceScreen snapshot={snapshot()} onAction={vi.fn()} busyActionId={null} message={null} />);

    const disclosure = screen.getByRole('button', {name: /этап 5 из 8/i});
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByTestId('operator-phase')).toHaveLength(0);

    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByTestId('operator-phase')).toHaveLength(8);
  });

  it('закрепляет главное действие над навигацией с учётом безопасной области телефона', () => {
    render(<OperatorWorkplaceScreen snapshot={snapshot()} onAction={vi.fn()} busyActionId={null} message={null} />);

    const actionRegion = screen.getByTestId('operator-primary-action-region');
    const navigation = screen.getByRole('navigation', {name: 'Основная навигация оператора'});
    expect(actionRegion).toHaveClass('fixed');
    expect(actionRegion).toHaveStyle({bottom: 'calc(3.75rem + env(safe-area-inset-bottom))'});
    expect(navigation).toHaveStyle({paddingBottom: 'env(safe-area-inset-bottom)'});
    expect(actionRegion.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('объясняет готовность без баллов и процентов', () => {
    render(<OperatorWorkplaceScreen snapshot={snapshot()} onAction={vi.fn()} busyActionId={null} message={null} />);
    expect(screen.getByText('Работа разрешена с замечаниями')).toBeInTheDocument();
    expect(screen.getByText('Проверьте уровень топлива после запуска')).toBeInTheDocument();
    expect(screen.queryByText(/балл|процент|%|score/i)).not.toBeInTheDocument();
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8] as const)('оставляет три действия безопасности доступными на фазе %s', (phaseNumber) => {
    const value = snapshot();
    value.phase = {...value.phases[phaseNumber - 1], state: 'CURRENT'};
    value.phases = value.phases.map((phase) => ({...phase, state: phase.number < phaseNumber ? 'COMPLETED' : phase.number === phaseNumber ? 'CURRENT' : 'UPCOMING'}));
    render(<OperatorWorkplaceScreen snapshot={value} onAction={vi.fn()} busyActionId={null} message={null} />);

    expect(screen.getAllByTestId('operator-safety-action')).toHaveLength(3);
  });
});
