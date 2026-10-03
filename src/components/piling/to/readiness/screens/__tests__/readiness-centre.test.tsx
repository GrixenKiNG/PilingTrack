import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceUiProps } from '../types';
import { DEFAULT_READINESS_RULES } from '@/modules/readiness';
import { ReadinessCentre } from '../readiness-centre';
import { PermitsScreen } from '../permits-screen';
import { ReportsScreen } from '../reports-screen';
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
