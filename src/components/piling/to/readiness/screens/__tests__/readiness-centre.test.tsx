import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceUiProps } from '../types';
import { DEFAULT_READINESS_RULES } from '@/modules/readiness';
import { ReadinessCentre } from '../readiness-centre';
import { PermitsScreen } from '../permits-screen';
import { ReportsScreen } from '../reports-screen';
import type { CurrentReadinessDto, ReadinessAbility, ReadinessShiftDto } from '../../api/contracts';
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

describe('J9 inactive current facts', () => {
  it('does not present historical acceptance as a completed dispatcher step', () => {
    render(<ReadinessCentre {...propsFor({
      currentReadiness: [{
        ...readinessRow('eq-1', 96), equipmentActive: false,
        facts: {inspectionCompleted: true, inspectionProgress: 1, healthScore: 96,
          meterKnown: true, permitValid: true, permitExpired: false,
          maintenanceConfigured: true, maintenanceOverdueHours: 0, maintenanceOverdueDays: 0,
          accepted: true, criticalDefect: false, findings: 0},
      }],
    })} />);
    expect(screen.getAllByText('Выведена из работы').length).toBeGreaterThan(0);
    const dispatcher = screen.getByRole('heading', {name: 'Диспетчер'}).closest('article');
    if (!dispatcher) throw new Error('Карточка диспетчера отсутствует');
    expect(within(dispatcher).getByText('0/3 шагов')).toBeInTheDocument();
    expect(within(dispatcher).queryByText('1/3 шагов')).not.toBeInTheDocument();
  });
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

/**
 * F-N1004-BLOCKER-LABELS (остаток MR-CHECK-1004 №3): плитка «Замечания и
 * дефекты» считала ЛЮБОЙ блокер «Критическими», а блок называл их
 * «Критические блокеры». Возврат оператору (`RETURN_TO_OPERATOR`) и
 * «нужно подтверждение» (`REQUIRE_CONFIRMATION`) — не критический дефект;
 * счётчики и цвет теперь идут по действию блокера, как плашка «Что держит
 * допуск». Все условия допуска остаются блокерами, обычные замечания —
 * отдельным числом.
 */
describe('Центр готовности: счётчики блокеров по действию, а не все «критические» (F-N1004-BLOCKER-LABELS)', () => {
  const snapshotWithActions = (
    blockers: Array<{ condition: string; action: string; label: string; actionLabel: string }>,
  ): CurrentReadinessDto => ({
    snapshotId: 'snap-eq-1', equipmentId: 'eq-1', status: 'BLOCKED', verdict: 'RETURN_TO_OPERATOR', score: 60,
    calculatedAt: '2026-10-01T06:00:00.000Z', ruleSetVersion: 'v1', triggerType: null,
    blockers,
    warnings: [],
    facts: { inspectionCompleted: false, inspectionProgress: 0, healthScore: 50, meterKnown: true,
      permitValid: null, permitExpired: false, maintenanceConfigured: true,
      maintenanceOverdueHours: 0, maintenanceOverdueDays: 0, accepted: true, criticalDefect: false, findings: 3 },
    evidence: { equipmentId: 'eq-1', inspectionId: null, permitId: null, maintenanceRecordIds: [], evaluatedAt: '2026-10-01T06:00:00.000Z' },
  });

  /** Значение строки плитки по её подписи-термину (столбец «caption»). */
  const tileValue = (caption: string) => screen.getByText(caption, { selector: 'dt' }).nextElementSibling;

  it('один возврат оператору — не критический счётчик, а «Требует решения»', () => {
    render(<ReadinessCentre {...propsFor({ currentReadiness: [snapshotWithActions([
      { condition: 'INSPECTION_BELOW_80', action: 'RETURN_TO_OPERATOR', label: 'Нет осмотра за сегодня', actionLabel: 'Вернуть оператору' },
    ])] })} />);

    expect(tileValue('Критические')).toHaveTextContent('0');
    expect(tileValue('Требует решения')).toHaveTextContent('1');
    expect(tileValue('Обычные')).toHaveTextContent('3');
    expect(screen.getByText('Критические блокеры').querySelector('b')).toHaveTextContent('0');

    // Плитка больше не красная: возврат — не запрет пуска.
    const pill = screen.getByText('Есть');
    expect(pill.className).toContain('text-warning-strong');
    expect(pill.className).not.toContain('text-destructive-strong');
  });

  it('одно подтверждение — «Требует подтверждения», критических нет', () => {
    render(<ReadinessCentre {...propsFor({ currentReadiness: [snapshotWithActions([
      { condition: 'ACCEPTANCE_UNCONFIRMED', action: 'REQUIRE_CONFIRMATION', label: 'Приёмка не подтверждена', actionLabel: 'Подтвердить' },
    ])] })} />);

    expect(tileValue('Критические')).toHaveTextContent('0');
    expect(tileValue('Требует подтверждения')).toHaveTextContent('1');
    expect(screen.queryByText('Требует решения', { selector: 'dt' })).not.toBeInTheDocument();
  });

  it('смешанные действия показаны верными количествами и названиями', () => {
    render(<ReadinessCentre {...propsFor({ currentReadiness: [snapshotWithActions([
      { condition: 'CRITICAL_DEFECT', action: 'DENY_START', label: 'Критический дефект', actionLabel: 'Запретить запуск' },
      { condition: 'INSPECTION_BELOW_80', action: 'RETURN_TO_OPERATOR', label: 'Нет осмотра за сегодня', actionLabel: 'Вернуть оператору' },
    ])] })} />);

    expect(tileValue('Критические')).toHaveTextContent('1');
    expect(tileValue('Требует решения')).toHaveTextContent('1');
    expect(screen.getByText('Критические блокеры').querySelector('b')).toHaveTextContent('1');

    const pill = screen.getByText('Есть');
    expect(pill.className).toContain('text-destructive-strong');
  });

  it('неизвестное действие считается строгим запретом (критическим)', () => {
    render(<ReadinessCentre {...propsFor({ currentReadiness: [snapshotWithActions([
      { condition: 'NEW_RULE', action: 'SOMETHING_NEW', label: 'Новое условие из правил', actionLabel: 'Разобраться' },
    ])] })} />);

    expect(tileValue('Критические')).toHaveTextContent('1');
    expect(screen.queryByText('Требует решения', { selector: 'dt' })).not.toBeInTheDocument();
    expect(screen.queryByText('Требует подтверждения', { selector: 'dt' })).not.toBeInTheDocument();
  });
});

/**
 * R141 №4: у причины блокировки на доске не было адреса — кто снимает и куда
 * идти; `actionLabel` («Вернуть оператору») описывает реакцию системы, а не
 * действие человека. Рядом с причиной показываем маршрутизацию из
 * существующего `blockerGuidance` и кнопку перехода на нужную вкладку; код,
 * которого нет в карте, остаётся видимым без выдуманной подсказки.
 */
describe('Центр готовности: у причины есть адресат и переход (R141 №4)', () => {
  const blockedSnapshot = (condition: string, label: string): CurrentReadinessDto => ({
    snapshotId: 'snap-eq-1', equipmentId: 'eq-1', status: 'BLOCKED', verdict: 'RETURN_TO_OPERATOR', score: 60,
    calculatedAt: '2026-10-01T06:00:00.000Z', ruleSetVersion: 'v1', triggerType: null,
    blockers: [{ condition, action: 'RETURN_TO_OPERATOR', label, actionLabel: 'Вернуть оператору' }],
    warnings: [],
    facts: { inspectionCompleted: false, inspectionProgress: 0, healthScore: 50, meterKnown: true,
      permitValid: null, permitExpired: false, maintenanceConfigured: true,
      maintenanceOverdueHours: 0, maintenanceOverdueDays: 0, accepted: true, criticalDefect: false, findings: 0 },
    evidence: { equipmentId: 'eq-1', inspectionId: null, permitId: null, maintenanceRecordIds: [], evaluatedAt: '2026-10-01T06:00:00.000Z' },
  });

  it('известный блокер: кто снимает, куда идти, и кнопка ведёт на нужную вкладку', () => {
    const onViewChange = vi.fn();
    render(<ReadinessCentre {...propsFor({
      currentReadiness: [blockedSnapshot('INSPECTION_BELOW_80', 'Нет осмотра за сегодня')],
      onViewChange,
    })} />);

    expect(screen.getByText('оператор')).toBeInTheDocument();
    expect(screen.getByText('вкладка «Смены» → провести осмотр за сегодня')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Перейти к снятию/ }));
    expect(onViewChange).toHaveBeenCalledWith('shifts');
  });

  it('неизвестный блокер остаётся видимым, но без выдуманной подсказки и кнопки', () => {
    render(<ReadinessCentre {...propsFor({
      currentReadiness: [blockedSnapshot('UNKNOWN_CODE', 'Новая причина из правил')],
    })} />);

    expect(screen.getByText('Новая причина из правил')).toBeInTheDocument();
    expect(screen.queryByText('Снимает')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Перейти к снятию/ })).not.toBeInTheDocument();
  });

  it('вкладка, закрытая роли, не обещает переход — подсказка остаётся видимой', () => {
    const base = bootstrapEnvelope().data;
    const bootstrap = { ...base, capabilities: { ...base.capabilities, screens: { ...base.capabilities.screens, shifts: false } } };
    render(<ReadinessCentre {...propsFor({
      currentReadiness: [blockedSnapshot('INSPECTION_BELOW_80', 'Нет осмотра за сегодня')],
      bootstrap,
    })} />);

    expect(screen.getByText('вкладка «Смены» → провести осмотр за сегодня')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Перейти к снятию/ })).not.toBeInTheDocument();
  });
});

/**
 * W60 собрал тексты и адреса шагов ролей; W61 рисует саму подсказку «что делать
 * сейчас» по нажатию на карточку роли. Состояния шагов берутся из того же
 * снимка (`roleProgress`), что и цепочка; право шага — из полномочий смотрящего.
 */
describe('Роли: подсказка «что делать сейчас» (W61)', () => {
  const bootstrapWith = (abilities: ReadinessAbility[]) => {
    const base = bootstrapEnvelope().data;
    return { ...base, capabilities: { ...base.capabilities, abilities } };
  };

  const openRole = (label: string) =>
    fireEvent.click(screen.getByRole('button', { name: `${label}: что делать сейчас` }));

  it('нажатие на карточку роли открывает панель подсказки', () => {
    render(<ReadinessCentre {...propsFor()} />);

    expect(screen.queryByRole('region', { name: 'Что делать сейчас: Оператор' })).not.toBeInTheDocument();
    openRole('Оператор');
    expect(screen.getByRole('region', { name: 'Что делать сейчас: Оператор' })).toBeInTheDocument();
  });

  it.each([['Оператор', 5], ['Диспетчер', 3], ['Механик', 3], ['Администратор', 3]])(
    'у роли «%s» — %i шагов',
    (label, count) => {
      render(<ReadinessCentre {...propsFor()} />);
      openRole(label);
      const panel = screen.getByRole('region', { name: `Что делать сейчас: ${label}` });
      expect(within(panel).getAllByRole('listitem')).toHaveLength(count);
    },
  );

  it('первый невыполненный шаг подсвечен и подписан «Сделайте это сейчас»', () => {
    render(<ReadinessCentre {...propsFor()} />);
    openRole('Оператор');
    const panel = screen.getByRole('region', { name: 'Что делать сейчас: Оператор' });
    const items = within(panel).getAllByRole('listitem');

    expect(within(items[0]).getByText('Сделайте это сейчас')).toBeInTheDocument();
    expect(items[0].className).toContain('ring-signal');
    expect(within(items[1]).queryByText('Сделайте это сейчас')).not.toBeInTheDocument();
    expect(within(items[1]).getByText('Впереди')).toBeInTheDocument();
  });

  it('кнопка шага ведёт по адресу из W60', () => {
    const onViewChange = vi.fn();
    render(<ReadinessCentre {...propsFor({
      onViewChange,
      bootstrap: bootstrapWith(['readiness.read', 'readiness.inspection.manage']),
    })} />);
    openRole('Оператор');

    fireEvent.click(screen.getByRole('button', { name: 'Провести осмотр: перейти' }));
    expect(onViewChange).toHaveBeenCalledWith('shifts');
  });

  it('чужой шаг не обещает кнопку — видно, кто его выполняет', () => {
    render(<ReadinessCentre {...propsFor({ bootstrap: bootstrapWith(['readiness.read']) })} />);
    openRole('Оператор');

    expect(screen.getByText('Выполняет инженер по охране труда')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Допуск: перейти' })).not.toBeInTheDocument();
  });
});

/**
 * W66: у шага должен быть свой проверяемый факт и понятный адрес. Оператору
 * карточка установки закрыта (нет `equipment.read`) и потому не даёт ссылку в
 * тупик; журнал заявок отдают только с `maintenance.manage`, поэтому без него
 * шаг механика «нет данных», а не «выполнено»; «Открыть смену» диспетчеру не
 * под силу — этот шаг помечен исполнителем и не загорается чужим событием.
 */
describe('Шаги ролей: тупики и ложные «выполнено» (W66)', () => {
  const open = (label: string) =>
    fireEvent.click(screen.getByRole('button', { name: `${label}: что делать сейчас` }));

  const bootstrapWithEquipmentRead = (read: boolean) => {
    const base = bootstrapEnvelope().data;
    return { ...base, capabilities: { ...base.capabilities, entities: { ...base.capabilities.entities, equipment: { read } } } };
  };

  const snapshot = (accepted: boolean): CurrentReadinessDto => ({
    snapshotId: 'snap-eq-1', equipmentId: 'eq-1', status: 'READY', verdict: 'ALLOWED', score: 90,
    calculatedAt: '2026-10-01T06:00:00.000Z', ruleSetVersion: 'v1', triggerType: null,
    blockers: [], warnings: [],
    facts: { inspectionCompleted: true, inspectionProgress: 1, healthScore: 90, meterKnown: true, permitValid: true,
      permitExpired: false, maintenanceConfigured: true, maintenanceOverdueHours: 0, maintenanceOverdueDays: 0,
      accepted, criticalDefect: false, findings: 0 },
    evidence: { equipmentId: 'eq-1', inspectionId: null, permitId: null, maintenanceRecordIds: [], evaluatedAt: '2026-10-01T06:00:00.000Z' },
  });

  const startedShift = (): ReadinessShiftDto => ({
    id: 'sh1', equipmentId: 'eq-1', type: 'DAY', state: 'STARTED', productionDate: '2026-10-01',
    timezone: 'Europe/Moscow', plannedStartAt: null, plannedEndAt: null, requestedAt: null,
    declinedAt: null, declineReason: null, startedAt: '2026-10-01T06:00:00.000Z', closedAt: null,
    version: 1, handovers: [],
  });

  it('без права equipment.read шаг «Моточасы» не ссылается на карточку установки', () => {
    render(<ReadinessCentre {...propsFor({ bootstrap: bootstrapWithEquipmentRead(false) })} />);

    expect(screen.queryByRole('link', { name: 'Моточасы: открыть' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Моточасы снимаются в осмотре перед работой').length).toBeGreaterThan(0);
  });

  it('с правом equipment.read шаг «Моточасы» ведёт в карточку установки', () => {
    render(<ReadinessCentre {...propsFor({ bootstrap: bootstrapWithEquipmentRead(true) })} />);

    const links = screen.getAllByRole('link', { name: 'Моточасы: открыть' });
    expect(links[0]).toHaveAttribute('href', '/admin/equipment/eq-1');
  });

  it('карточка оператора перечисляет те же 5 шагов, что считает счётчик', () => {
    render(<ReadinessCentre {...propsFor()} />);
    const card = screen.getByRole('button', { name: 'Оператор: что делать сейчас' });

    expect(within(card).getByText('0/5 шагов')).toBeInTheDocument();
    for (const title of ['Провести осмотр', 'Зафиксировать моточасы', 'Допуск', 'Техническое обслуживание', 'Приёмка']) {
      expect(within(card).getByText(title)).toBeInTheDocument();
    }
  });

  it('чужие шаги оператора подписаны исполнителем и без кнопки «сделать»', () => {
    render(<ReadinessCentre {...propsFor({ bootstrap: bootstrapWithEquipmentRead(true) })} />);
    open('Оператор');

    expect(screen.getByText('Выполняет инженер по охране труда')).toBeInTheDocument();
    expect(screen.getByText('Выполняет механик')).toBeInTheDocument();
    expect(screen.getByText('Выполняет диспетчер')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Приёмка: перейти' })).not.toBeInTheDocument();
  });

  it('диспетчер: «Открыть смену» не загорается запуском смены и подписан исполнителем', () => {
    render(<ReadinessCentre {...propsFor({
      currentReadiness: [snapshot(true)],
      shifts: [startedShift()],
    })} />);
    open('Диспетчер');
    const panel = screen.getByRole('region', { name: 'Что делать сейчас: Диспетчер' });
    const items = within(panel).getAllByRole('listitem');

    expect(within(items[1]).getByText('Выполнено')).toBeInTheDocument();
    expect(within(items[2]).queryByText('Выполнено')).not.toBeInTheDocument();
    expect(within(items[2]).getByText('Выполняет оператор')).toBeInTheDocument();
  });

  it('механик: без загруженного журнала «Подтвердить работы» — «нет данных», а не «выполнено»', () => {
    render(<ReadinessCentre {...propsFor({ journals: {} })} />);
    open('Механик');
    const panel = screen.getByRole('region', { name: 'Что делать сейчас: Механик' });
    const items = within(panel).getAllByRole('listitem');

    expect(within(items[2]).getByText('Нет данных')).toBeInTheDocument();
    expect(within(items[2]).queryByText('Выполнено')).not.toBeInTheDocument();
  });

  it('механик: с загруженным пустым журналом «Подтвердить работы» — выполнено', () => {
    render(<ReadinessCentre {...propsFor({ journals: { 'eq-1': [] } })} />);
    open('Механик');
    const panel = screen.getByRole('region', { name: 'Что делать сейчас: Механик' });
    const items = within(panel).getAllByRole('listitem');

    expect(within(items[2]).getByText('Выполнено')).toBeInTheDocument();
  });
});
