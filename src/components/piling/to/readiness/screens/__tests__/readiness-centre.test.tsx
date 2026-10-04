import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceUiProps } from '../types';
import { DEFAULT_READINESS_RULES } from '@/modules/readiness';
import { ReadinessCentre } from '../readiness-centre';
import { PermitsScreen } from '../permits-screen';
import { ReportsScreen } from '../reports-screen';
import type { CurrentReadinessDto } from '../../api/contracts';
import { SettingsWorkspace } from '../settings-workspace';
import { bootstrapEnvelope } from '../../api/__tests__/fixtures';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ authFetch }));

const { downloadReadinessExport } = vi.hoisted(() => ({ downloadReadinessExport: vi.fn() }));
// Подменяем только саму выгрузку: остальные помощники экранов (KPI-плитки,
// фото) остаются настоящими, иначе тест не увидит реальную разметку кнопок.
vi.mock('../shared', async (original) => ({
  ...await original<typeof import('../shared')>(),
  downloadReadinessExport,
}));

const { toastWarning } = vi.hoisted(() => ({ toastWarning: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: toastWarning, info: vi.fn() } }));

/**
 * Два разных показателя были подписаны похоже: доля шагов процедуры («3 из 5 ·
 * 60 %») и балл готовности (0–100) читались как одно число. Совпадение
 * процентов случайно. Здесь проверяется, что доля процедуры названа своим
 * именем и слово «готовность» из этой подписи ушло.
 */
const propsFor = (overrides: Partial<ReferenceUiProps> = {}): ReferenceUiProps => ({
  view: 'readiness', onViewChange: vi.fn(), settingsSection: 'rules', onSettingsSectionChange: vi.fn(),
  equipment: [{ id: 'eq-1', name: 'Свая-1', model: 'X', hammerKind: 'HYDRAULIC', isCombined: false }],
  selectedId: 'eq-1', onSelect: vi.fn(), readinessByEquipment: {}, factsByEquipment: {},
  scoresByEquipment: {}, rulesState: { published: DEFAULT_READINESS_RULES, draft: null, pendingChanges: 0, publishedInDb: true }, onRulesStateChange: vi.fn(), journals: {},
  crews: [], maintenance: [], fleetCards: [], details: {}, loading: false,
  workspaceError: null, workspaceIssues: [], outOfRoleSources: [], rulesAvailable: false,
  bootstrap: null, shifts: [], permits: [], defects: [], currentReadiness: [],
  authoritativeReadinessError: null, readinessHistory: [], audit: null, filters: {},
  onFiltersChange: vi.fn(), showInternalNavigation: false, onRetry: vi.fn(),
  ...overrides,
} as ReferenceUiProps);

afterEach(() => {
  cleanup();
  authFetch.mockReset();
  downloadReadinessExport.mockReset();
  toastWarning.mockReset();
});

/** Ответ-отказ выгрузки: функция читает только ok/status/json. */
const failedExport = (status: number, body: unknown = null) =>
  ({ ok: false, status, json: async () => body }) as unknown as Response;

/** Настоящая downloadReadinessExport в обход подмены модуля — для текстов отказа. */
const realDownload = async () => (await vi.importActual<typeof import('../shared')>('../shared')).downloadReadinessExport;

describe('ReadinessCentre — доля шагов процедуры не подписана «готовностью»', () => {
  it('называет долю шагов «Пройдено шагов процедуры» и убирает слово «готовность»', () => {
    render(<ReadinessCentre {...propsFor()} />);

    expect(screen.getByText('Пройдено шагов процедуры')).toBeInTheDocument();
    expect(screen.queryByText('Готовность чек-листа смены')).not.toBeInTheDocument();

    expect(
      screen.getByText('Сколько этапов предсменного контроля уже пройдено. Это не балл готовности.'),
    ).toBeInTheDocument();
  });
});

describe('downloadReadinessExport — отказ объясняется понятным текстом (F-R115-2)', () => {
  it('обрыв связи отличается от отказа выгрузки', async () => {
    authFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect((await realDownload())('reports', {})).rejects.toThrow('Нет связи с сервером');
  });

  it('истёкшая сессия (401) просит войти заново, а не «не удалось сформировать»', async () => {
    authFetch.mockResolvedValue(failedExport(401));
    await expect((await realDownload())('reports', {})).rejects.toThrow('Сессия истекла');
  });

  it('отказ по правам (403) показывает текст сервера', async () => {
    authFetch.mockResolvedValue(failedExport(403, { error: { message: 'Нет прав на выгрузку' } }));
    await expect((await realDownload())('reports', {})).rejects.toThrow('Нет прав на выгрузку');
  });

  it('сбой сервера (5xx) объясняется отдельно от ошибки данных', async () => {
    authFetch.mockResolvedValue(failedExport(500, { error: 'Внутренняя ошибка сервера. Повторите попытку; если повторится — сообщите администратору.' }));
    await expect((await realDownload())('reports', {})).rejects.toThrow('Внутренняя ошибка сервера');
  });
});

/**
 * F-R115-11: пустой набор сервер отдаёт как 200 — CSV из одной шапки. Клиент не
 * читал `x-export-row-count`, и файл без строк выглядел как успешная выгрузка.
 */
describe('downloadReadinessExport — пустой набор не выдаётся за успех (F-R115-11)', () => {
  it('x-export-row-count: 0 → предупреждение; непустой набор — без предупреждения', async () => {
    const urlGlobal = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    const originalCreate = urlGlobal.createObjectURL;
    const originalRevoke = urlGlobal.revokeObjectURL;
    urlGlobal.createObjectURL = vi.fn(() => 'blob:export');
    urlGlobal.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      authFetch.mockResolvedValue(new Response('Шапка\n', {
        status: 200,
        headers: { 'x-export-row-count': '0', 'content-disposition': 'attachment; filename="pilingtrack-readiness-audit.csv"' },
      }));
      await (await realDownload())('audit', {});
      expect(toastWarning).toHaveBeenCalledWith('В выгрузке нет строк данных — по выбранному фильтру ничего не найдено.');

      toastWarning.mockClear();
      authFetch.mockResolvedValue(new Response('Шапка\n1,2,3\n', {
        status: 200,
        headers: { 'x-export-row-count': '3' },
      }));
      await (await realDownload())('audit', {});
      expect(toastWarning).not.toHaveBeenCalled();
    } finally {
      urlGlobal.createObjectURL = originalCreate;
      urlGlobal.revokeObjectURL = originalRevoke;
      click.mockRestore();
    }
  });
});

describe('Экспорт технической готовности — индикатор и защита от повторного нажатия (F-R115-1)', () => {
  it('«Наряд-допуски»: кнопка «Экспорт» блокируется и показывает ход выгрузки', async () => {
    let finish: () => void = () => {};
    downloadReadinessExport.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    render(<PermitsScreen {...propsFor()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Экспорт' }));
    expect(await screen.findByRole('button', { name: 'Готовим файл…' })).toBeDisabled();

    await act(async () => { finish(); });
    expect(await screen.findByRole('button', { name: 'Экспорт' })).toBeEnabled();
  });

  it('«Отчёты»: кнопка «Экспорт отчёта» блокируется и показывает ход выгрузки', async () => {
    let finish: () => void = () => {};
    downloadReadinessExport.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    render(<ReportsScreen {...propsFor()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Экспорт отчёта' }));
    expect(await screen.findByRole('button', { name: 'Готовим файл…' })).toBeDisabled();

    await act(async () => { finish(); });
    expect(await screen.findByRole('button', { name: 'Экспорт отчёта' })).toBeEnabled();
  });
});

describe('Экспорт справочника и журнала аудита — индикатор и защита от повторного нажатия (F-R115-3)', () => {
  it('«Справочники»: кнопка «Экспорт» блокируется и показывает ход выгрузки', async () => {
    authFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    let finish: () => void = () => {};
    downloadReadinessExport.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    render(<SettingsWorkspace {...propsFor({ settingsSection: 'dictionaries' })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Экспорт' }));
    expect(await screen.findByRole('button', { name: 'Готовим файл…' })).toBeDisabled();

    await act(async () => { finish(); });
    expect(await screen.findByRole('button', { name: 'Экспорт' })).toBeEnabled();
  });

  it('«Аудит»: кнопка «Экспорт журнала» блокируется и показывает ход выгрузки', async () => {
    const base = bootstrapEnvelope().data;
    const bootstrap = { ...base, capabilities: { ...base.capabilities, entities: { ...base.capabilities.entities, audit: { read: true, export: true } } } };
    let finish: () => void = () => {};
    downloadReadinessExport.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    render(<SettingsWorkspace {...propsFor({ settingsSection: 'audit', bootstrap })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Экспорт журнала' }));
    expect(await screen.findByRole('button', { name: 'Готовим файл…' })).toBeDisabled();

    await act(async () => { finish(); });
    expect(await screen.findByRole('button', { name: 'Экспорт журнала' })).toBeEnabled();
  });
});

/** Снимок готовности установки — минимум полей, которые читает экран отчётов. */
const readinessRow = (equipmentId: string, score: number): CurrentReadinessDto => ({
  snapshotId: `snap-${equipmentId}`,
  equipmentId,
  status: 'READY',
  verdict: 'ALLOWED',
  score,
  calculatedAt: '2026-10-01T06:00:00.000Z',
  blockers: [],
  warnings: null,
  evidence: null,
  facts: null,
  triggerType: null,
  ruleSetVersion: null,
});

/**
 * R129 #6: «Готовность парка» печаталась сырым числом — «87.5%» точкой, тогда
 * как в отчёте техготовности десятичная часть показана запятой.
 */
describe('Отчёты: готовность парка с запятой (R129 #6)', () => {
  it('десятичная часть процента печатается по-русски', () => {
    render(<ReportsScreen {...propsFor({
      equipment: [
        { id: 'eq-1', name: 'Свая-1', model: 'X', hammerKind: 'HYDRAULIC', isCombined: false, isActive: true, crewCount: 0 },
        { id: 'eq-2', name: 'Свая-2', model: 'X', hammerKind: 'HYDRAULIC', isCombined: false, isActive: true, crewCount: 0 },
      ],
      currentReadiness: [readinessRow('eq-1', 85), readinessRow('eq-2', 90)],
    })} />);

    expect(screen.getAllByText('87,5%').length).toBeGreaterThan(0);
    expect(screen.queryByText('87.5%')).not.toBeInTheDocument();
  });
});

/**
 * R141 №2: любой активный блокер звался «критическим замечанием» и красился
 * красным. Для блокера «нет осмотра за сегодня» (действие `RETURN_TO_OPERATOR`)
 * это незакрытый шаг, а не критический дефект. Панель нейтральна, тон — по
 * действию блокера, и запрет пуска (`DENY_START`) отличается от возврата.
 */
describe('Центр готовности: блокер показан по действию, а не всё «критическим» (R141 №2)', () => {
  const snapshotWithBlocker = (action: string, label: string, actionLabel: string): CurrentReadinessDto => ({
    snapshotId: 'snap-eq-1', equipmentId: 'eq-1', status: 'BLOCKED', verdict: 'RETURN_TO_OPERATOR', score: 60,
    calculatedAt: '2026-10-01T06:00:00.000Z', ruleSetVersion: 'v1', triggerType: null,
    blockers: [{ condition: 'INSPECTION_BELOW_80', action, label, actionLabel }],
    warnings: [],
    facts: { inspectionCompleted: false, inspectionProgress: 0, healthScore: 50, meterKnown: true,
      permitValid: null, permitExpired: false, maintenanceConfigured: true,
      maintenanceOverdueHours: 0, maintenanceOverdueDays: 0, accepted: true, criticalDefect: false, findings: 0 },
    evidence: { equipmentId: 'eq-1', inspectionId: null, permitId: null, maintenanceRecordIds: [], evaluatedAt: '2026-10-01T06:00:00.000Z' },
  });

  it('возврат оператору — не «критическое»: нейтральный заголовок и рекомендация без «критических замечаний»', () => {
    render(<ReadinessCentre {...propsFor({ currentReadiness: [snapshotWithBlocker('RETURN_TO_OPERATOR', 'Нет осмотра за сегодня', 'Вернуть оператору')] })} />);

    expect(screen.getByText('Что держит допуск')).toBeInTheDocument();
    expect(screen.getByText('Нет осмотра за сегодня')).toBeInTheDocument();
    expect(screen.getAllByText('Вернуть оператору').length).toBeGreaterThan(0);
    expect(screen.queryByText('Критическое замечание')).not.toBeInTheDocument();
    expect(screen.queryByText('Критическое')).not.toBeInTheDocument();
    expect(screen.getByText('Рекомендация: закрыть условие допуска — требуется действие ответственного.')).toBeInTheDocument();
  });

  it('запрет пуска (DENY_START) остаётся критическим и в тексте, и в плашке', () => {
    render(<ReadinessCentre {...propsFor({ currentReadiness: [snapshotWithBlocker('DENY_START', 'Критический дефект', 'Запретить запуск')] })} />);

    expect(screen.getByText('Критический дефект')).toBeInTheDocument();
    expect(screen.getByText('Критическое')).toBeInTheDocument();
    expect(screen.getByText('Рекомендация: устранить блокирующие условия для допуска к работе.')).toBeInTheDocument();
  });
});
