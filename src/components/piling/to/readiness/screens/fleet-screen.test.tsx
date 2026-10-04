import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentReadinessDto } from '../api/contracts';
import type { EquipmentOption } from '../../to-module-bits';
import type { ReferenceUiProps } from './types';
import { bootstrapEnvelope } from '../api/__tests__/fixtures';
import { formatDateTimeInTimezone } from '@/lib/timezone';
import { FleetScreen } from './fleet-screen';
import { buildFleetItems, countFleetGroups, DEFAULT_FLEET_VIEW, filterFleetItems, readFleetViewState, writeFleetViewState } from './fleet-workspace-model';

const fetchDefects = vi.hoisted(() => vi.fn());
vi.mock('../api/client', async (original) => ({ ...await original<typeof import('../api/client')>(), fetchReadinessDefects: fetchDefects }));
// Подменяем только фото (next/image + защищённый URL) и выгрузку; KPI-плитки
// остаются настоящими, иначе тест не увидит счётчики парка.
vi.mock('./shared', async (original) => ({
  ...await original<typeof import('./shared')>(),
  EquipmentPhoto: () => null,
  downloadReadinessExport: vi.fn(),
}));

const equipment = (id: string, name = id): EquipmentOption => ({
  id, name, model: 'Модель', hammerKind: 'NONE', isCombined: false, isActive: true, crewCount: 0, engineHoursTotal: 100,
});
const snapshot = (id: string, overrides: Partial<CurrentReadinessDto> = {}): CurrentReadinessDto => ({
  equipmentId: id, snapshotId: 'snapshot-' + id, status: 'READY', score: 66,
  calculatedAt: '2026-09-05T20:00:00Z', ruleSetVersion: 'v1', triggerType: 'INSPECTION_COMPLETED',
  blockers: [], warnings: [],
  facts: { inspectionCompleted: true, inspectionProgress: 1, healthScore: 90, meterKnown: true,
    permitValid: null, permitExpired: false, maintenanceConfigured: true,
    maintenanceOverdueHours: 0, maintenanceOverdueDays: 0, accepted: true, criticalDefect: false, findings: 0 },
  evidence: { equipmentId: id, inspectionId: 'source-inspection', inspectionSource: 'OPERATOR_CHECKLIST',
    permitId: null, maintenanceRecordIds: [], evaluatedAt: '2026-09-05T20:00:00Z' },
  ...overrides,
});
const propsFor = (overrides: Partial<ReferenceUiProps> = {}): ReferenceUiProps => ({
  equipment: [equipment('rig-1', 'Установка 1'), equipment('rig-2', 'Установка 2')],
  fleetCards: [], currentReadiness: [snapshot('rig-1')], authoritativeReadinessError: null,
  selectedId: 'rig-1', onSelect: vi.fn(), onViewChange: vi.fn(), onRetry: vi.fn(),
  loading: false, maintenance: [], defects: [], permits: [], details: {
    'rig-1': { equipment: { id: 'rig-1', name: 'Установка 1' }, documents: [],
      latestInspection: { id: 'different-inspection', status: 'COMPLETED', inspectionDate: '2026-09-06T08:00:00Z', itemsTotal: 10, itemsAnswered: 10 } },
  },
  outOfRoleSources: [], workspaceIssues: [], bootstrap: bootstrapEnvelope().data, ...overrides,
} as ReferenceUiProps);

beforeEach(() => {
  window.history.replaceState({}, '', '/admin/to?view=fleet');
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  fetchDefects.mockReset();
});
afterEach(cleanup);

describe('Fleet readiness integrity', () => {
  it('never substitutes a legacy ready result when snapshot is missing or service failed', () => {
    const props = propsFor();
    expect(buildFleetItems(props).map((item) => item.group)).toEqual(['ready', 'unknown']);
    expect(buildFleetItems({ ...props, authoritativeReadinessError: 'unavailable' }).every((item) => item.group === 'unknown')).toBe(true);
  });
  it('counts every machine once, including incomplete and blocked snapshots', () => {
    const items = buildFleetItems(propsFor({
      equipment: [equipment('a'), equipment('b'), equipment('c')],
      currentReadiness: [snapshot('a', { facts: null }), snapshot('b', { status: 'BLOCKED' }), snapshot('c')],
    }));
    expect(countFleetGroups(items)).toEqual({ ready: 1, attention: 0, blocked: 1, unknown: 1 });
    expect(filterFleetItems(items, DEFAULT_FLEET_VIEW).map((item) => item.equipment.id)).toEqual(['b', 'a', 'c']);
  });
  it('treats a high score requiring a decision as attention, not green', () => {
    const items = buildFleetItems(propsFor({ currentReadiness: [snapshot('rig-1', { score: 99, verdict: 'CONFIRMATION_REQUIRED' })] }));
    expect(items[0].group).toBe('attention');
  });
  it('retains module and selected-machine parameters while saving local filters', () => {
    const next = { ...DEFAULT_FLEET_VIEW, query: 'КБУРГ', site: 'Объект 1', status: 'unknown' as const };
    const query = writeFleetViewState('?view=fleet&equipmentId=rig-1&risk=NORMAL', next);
    expect(readFleetViewState(query)).toEqual(next);
    expect(new URLSearchParams(query).get('equipmentId')).toBe('rig-1');
    expect(new URLSearchParams(query).get('risk')).toBe('NORMAL');
    expect(readFleetViewState('?fleetStatus=bad&fleetSort=bad')).toEqual(DEFAULT_FLEET_VIEW);
    // Ссылка со старым режимом карточек не должна тащить мёртвый параметр дальше.
    expect(new URLSearchParams(writeFleetViewState('?fleetLayout=cards', DEFAULT_FLEET_VIEW)).get('fleetLayout')).toBeNull();
  });
});

describe('Fleet evidence interactions', () => {
  it('shows empty documents inside the selected-machine panel without navigation', () => {
    render(<FleetScreen {...propsFor()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Документы' }));
    expect(screen.getByText(/Документы не загружены/)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin/to');
    expect(screen.getByRole('link', { name: /Открыть документы в карточке/ })).toHaveAttribute('href', '/admin/equipment/rig-1#documents');
    expect(screen.getByRole('link', { name: /Открыть документы в карточке/ })).toHaveAttribute('target', '_blank');
  });
  it('distinguishes unavailable details from missing documents', () => {
    render(<FleetScreen {...propsFor({ details: {}, outOfRoleSources: ['Карточка установки'] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Документы' }));
    expect(screen.getByText('Текущей роли недоступна карточка установки.')).toBeInTheDocument();
    expect(screen.queryByText(/Документы не загружены/)).not.toBeInTheDocument();
  });
  it('does not link an operator checklist id to the inspections journal', () => {
    render(<FleetScreen {...propsFor()} />);
    expect(document.querySelector('a[href="/inspections/source-inspection"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Осмотры' }));
    expect(screen.getByText('Это другая запись, не источник выбранной оценки.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Открыть этот осмотр/ })).toHaveAttribute('href', '/inspections/different-inspection');
  });
  it('filters by the KPI tile and shows which slice is selected', () => {
    render(<FleetScreen {...propsFor()} />);
    const unconfirmed = screen.getByRole('button', { name: /Не подтверждено 1/ });
    expect(unconfirmed).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(unconfirmed);
    expect(screen.getByRole('button', { name: /Не подтверждено 1/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Показано 1 из 2 установок');
  });
  it('hides a selected machine excluded by a filter instead of leaving an unrelated panel', () => {
    render(<FleetScreen {...propsFor()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Поиск установки' }), { target: { value: 'Установка 2' } });
    expect(screen.queryByRole('complementary', { name: 'Подробности Установка 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выбрать Установка 2' })).toBeInTheDocument();
    expect(screen.getByText(/Выберите установку из результатов/)).toBeInTheDocument();
  });
  it('does not show no defects when the request is forbidden', async () => {
    fetchDefects.mockRejectedValue(new Error('Недостаточно прав'));
    render(<FleetScreen {...propsFor()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Дефекты' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Недостаточно прав'));
    expect(screen.queryByText(/В ответе журнала нет дефектов/)).not.toBeInTheDocument();
    expect(fetchDefects).toHaveBeenCalledWith(expect.any(AbortSignal), { equipmentId: 'rig-1' });
  });
  /**
   * F-N1004-SELECTED-SOURCES (R151 №3): отказ догрузки журнала выбранной
   * установки должен быть виден в панели, а не выдаваться за пустой журнал.
   */
  it('shows the journal load failure for the selected machine instead of an empty journal', () => {
    render(<FleetScreen {...propsFor({ workspaceIssues: [
      { source: 'Журнал «Установка 1»', message: 'Источник временно недоступен (код 500).' },
    ] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Обслуживание' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Источник временно недоступен (код 500).');
    expect(screen.queryByText(/В загруженном журнале нет записей/)).not.toBeInTheDocument();
  });
  /**
   * F-N1004-SELECTED-SOURCES: отказ загрузки карточки выбранной установки
   * показывается её причиной, а не общей подсказкой «подробности ещё не
   * получены».
   */
  it('shows the card load failure reason for the selected machine', () => {
    render(<FleetScreen {...propsFor({ details: {}, workspaceIssues: [
      { source: 'Карточка «Установка 1»', message: 'Недостаточно прав для загрузки данных.' },
    ] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Документы' }));
    expect(screen.getByText('Недостаточно прав для загрузки данных.')).toBeInTheDocument();
    expect(screen.queryByText(/Подробности установки ещё не получены/)).not.toBeInTheDocument();
  });
});

/**
 * R141 №2: в панели все блокеры рисовались красным, хотя домен различает
 * запрет пуска (`DENY_START`) и возврат оператору (`RETURN_TO_OPERATOR`) —
 * второй это незакрытый шаг, а не критический дефект.
 */
describe('Панель парка: блокеры показаны по действию (R141 №2)', () => {
  const withBlocker = (action: string, label: string, actionLabel: string) =>
    snapshot('rig-1', { blockers: [{ condition: 'INSPECTION_BELOW_80', action, label, actionLabel }] });
  const panelFor = () => within(screen.getByRole('complementary', { name: 'Подробности Установка 1' }));

  it('возврат оператору не красится как запрет пуска', () => {
    render(<FleetScreen {...propsFor({ currentReadiness: [withBlocker('RETURN_TO_OPERATOR', 'Нет осмотра за сегодня', 'Вернуть оператору')] })} />);

    const item = panelFor().getByText('Нет осмотра за сегодня').closest('li');
    expect(item).toHaveClass('bg-warning/10');
    expect(item).not.toHaveClass('bg-destructive/10');
    expect(panelFor().getByText('Вернуть оператору')).toBeInTheDocument();
  });

  it('запрет пуска остаётся красным', () => {
    render(<FleetScreen {...propsFor({ currentReadiness: [withBlocker('DENY_START', 'Критический дефект гидравлики', 'Запретить запуск')] })} />);

    expect(panelFor().getByText('Критический дефект гидравлики').closest('li')).toHaveClass('bg-destructive/10');
  });
});

/**
 * R141 №5: в строке парка не было видно, когда сделана оценка — машина с
 * недельным и свежим снимком выглядели одинаково. Время берём из снимка в
 * поясе организации, порог устаревания не вводим (владелец 04.10.2026).
 */
describe('Время оценки в строке парка (R141 №5)', () => {
  it('различает две оценки с разным временем без открытия панели', () => {
    const older = '2026-09-01T06:00:00Z';
    const fresher = '2026-09-05T20:00:00Z';
    render(<FleetScreen {...propsFor({ currentReadiness: [
      snapshot('rig-1', { calculatedAt: older }),
      snapshot('rig-2', { calculatedAt: fresher }),
    ] })} />);

    expect(screen.getByText(formatDateTimeInTimezone(fresher, 'Europe/Moscow'))).toBeInTheDocument();
    expect(screen.getAllByText(formatDateTimeInTimezone(older, 'Europe/Moscow')).length).toBeGreaterThan(0);
  });

  it('пустое время оценки показывается словами, а не свежей датой', () => {
    render(<FleetScreen {...propsFor({ currentReadiness: [] })} />);

    expect(screen.getAllByText('Время оценки не указано').length).toBeGreaterThan(0);
  });
});

/**
 * R141 №3: в строке парка была видна только первая причина из нескольких
 * (`blockers[0] ?? warnings[0]`), остальные — лишь после выбора машины.
 * Первую краткую причину оставляем, а число остальных ведёт в ту же панель
 * «Основания оценки» выбранной установки.
 */
describe('Несколько причин блокировки видны в списке (R141 №3)', () => {
  const blocker = (label: string, action = 'DENY_START') => ({ condition: 'CRITICAL_DEFECT', label, action, actionLabel: 'Запретить запуск' });
  const warning = (message: string) => ({ message, action: 'REQUIRE_CONFIRMATION', actionLabel: 'Требуется подтверждение' });

  it('0 и 1 причина не показывают счётчик «ещё»', () => {
    expect(buildFleetItems(propsFor())[0].extraReasonCount).toBe(0);
    const one = buildFleetItems(propsFor({ currentReadiness: [snapshot('rig-1', {
      status: 'BLOCKED', verdict: 'DENIED', blockers: [blocker('Критический дефект')],
    })] }))[0];
    expect(one.reason).toBe('Критический дефект');
    expect(one.extraReasonCount).toBe(0);
  });

  it('три причины дают «ещё 2 причины», первая остаётся краткой', () => {
    const props = propsFor({ currentReadiness: [snapshot('rig-1', {
      status: 'BLOCKED', verdict: 'DENIED',
      blockers: [blocker('Критический дефект гидравлики'), blocker('Нет осмотра за сегодня', 'RETURN_TO_OPERATOR')],
      warnings: [warning('Просрочено ТО по дате')],
    })] });
    const item = buildFleetItems(props)[0];
    expect(item.reason).toBe('Критический дефект гидравлики');
    expect(item.extraReasonCount).toBe(2);

    const onSelect = vi.fn();
    render(<FleetScreen {...props} selectedId="rig-2" onSelect={onSelect} />);
    const more = screen.getByRole('button', { name: /Открыть основания оценки Установка 1: ещё 2 причины/ });
    more.focus();
    expect(more).toHaveFocus();
    fireEvent.click(more);
    expect(onSelect).toHaveBeenCalledWith('rig-1');
  });

  it('неизвестный снимок не показывает счётчик причин', () => {
    render(<FleetScreen {...propsFor({ currentReadiness: [] })} />);

    expect(screen.queryByRole('button', { name: /Открыть основания оценки/ })).not.toBeInTheDocument();
  });
});
