import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Тесты модуля раскладки (src/modules/layout). Риск, который они ловят:
 *  - невалидный/битый шаблон, сохранённый в JSONB, не должен попадать на
 *    экран: валидатор обязан отсеять выход блока за сетку, чужой dataKey,
 *    дубли id и т.п.;
 *  - шаблон по умолчанию обязан проходить СВОЙ же валидатор, иначе каждое
 *    чтение молча падает в умолчание и правки администратора теряются;
 *  - слияние «override -> base -> умолчание» не должно терять уровни и не
 *    должно возвращать общий объект (мутация одного экрана не имеет права
 *    портить следующие).
 */

const { findUniqueMock, findManyMock, upsertMock, deleteManyMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  findManyMock: vi.fn(),
  upsertMock: vi.fn(),
  deleteManyMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    moduleLayoutTemplate: {
      findUnique: findUniqueMock,
      findMany: findManyMock,
      upsert: upsertMock,
      deleteMany: deleteManyMock,
    },
  },
}));

import {
  createTemplateValidator,
  cloneLayoutTemplate,
  LAYOUT_COLUMNS,
  type LayoutBlock,
  type LayoutTemplate,
} from '../domain/layout-template';
import {
  createPageLayoutValidator,
  WIDGET_SIZES,
  type PageLayoutTemplate,
} from '../domain/page-layout-template';
import {
  getSurfaceConfig,
  MONITORING_EQUIPMENT_TILE_SURFACE_ID,
  EQUIPMENT_CARD_SURFACE_ID,
  ANALYTICS_DASHBOARD_SURFACE_ID,
  MAIN_DASHBOARD_SURFACE_ID,
  type LayoutSurfaceConfig,
} from '../domain/surfaces';
import {
  getLayout,
  getLayoutSet,
  saveLayout,
  deleteLayout,
  BASE_ENTITY,
  UnknownSurfaceError,
} from '../application/layout-service';

const ALL_SURFACE_IDS = [
  MONITORING_EQUIPMENT_TILE_SURFACE_ID,
  EQUIPMENT_CARD_SURFACE_ID,
  ANALYTICS_DASHBOARD_SURFACE_ID,
  MAIN_DASHBOARD_SURFACE_ID,
];

/** Поверхность из реестра; отсутствие — ошибка теста, а не тихий null. */
function surface(id: string): LayoutSurfaceConfig {
  const cfg = getSurfaceConfig(id);
  if (!cfg) throw new Error(`surface not registered: ${id}`);
  return cfg;
}

/** Стиль, проходящий isValidStyle: любые отклонения в тесте задаём точечно. */
const validStyle = {
  background: '#ffffff',
  color: '#101010',
  borderColor: '#e2e2e2',
  borderWidth: 1,
  borderRadius: 12,
  padding: 8,
  fontSize: 12,
  fontWeight: 600 as const,
  textAlign: 'left' as const,
  alignItems: 'center' as const,
};

function validBlock(overrides: Partial<LayoutBlock> = {}): LayoutBlock {
  return {
    id: 'b1',
    kind: 'text',
    text: 'привет',
    x: 0,
    y: 0,
    width: 6,
    height: 3,
    visible: true,
    style: { ...validStyle },
    ...overrides,
  };
}

function validCardTemplate(blocks: LayoutBlock[]): LayoutTemplate {
  return {
    version: 1,
    card: {
      width: 272,
      minHeight: 620,
      rowHeight: 24,
      gap: 8,
      background: '#ffffff',
      borderColor: '#e2e2e2',
      borderWidth: 1,
      borderRadius: 16,
      padding: 8,
    },
    blocks,
  };
}

describe('createTemplateValidator — правила сетки карточки', () => {
  const validate = createTemplateValidator(['photo', 'status']);

  it('пропускает корректный шаблон и возвращает копию, а не тот же объект', () => {
    const input = validCardTemplate([validBlock({ kind: 'data', dataKey: 'photo', text: undefined })]);
    const out = validate(input);

    expect(out).not.toBeNull();
    // Копия: мутация результата не имеет права задеть исходный объект (иначе
    // редактор правит модульную константу по умолчанию).
    expect(out).not.toBe(input);
    const copy = out as LayoutTemplate;
    expect(copy.blocks[0]).not.toBe(input.blocks[0]);
    copy.blocks[0].style.fontSize = 99;
    expect(input.blocks[0].style.fontSize).toBe(12);
  });

  it('отсекает блок, вылезающий за 12 колонок (x + width > 12)', () => {
    const t = validCardTemplate([validBlock({ x: 8, width: 6 })]);
    expect(validate(t)).toBeNull();
    // Ровно по краю сетки — ещё допустимо.
    expect(validate(validCardTemplate([validBlock({ x: 6, width: 6 })]))).not.toBeNull();
    expect(LAYOUT_COLUMNS).toBe(12);
  });

  it('отсекает чужой dataKey — каталог поверхности и есть allow-list', () => {
    const ok = validCardTemplate([validBlock({ kind: 'data', dataKey: 'photo', text: undefined })]);
    expect(validate(ok)).not.toBeNull();

    const alien = validCardTemplate([validBlock({ kind: 'data', dataKey: 'unknown-key', text: undefined })]);
    expect(validate(alien)).toBeNull();
  });

  it('отсекает дубли id блоков', () => {
    const t = validCardTemplate([validBlock({ id: 'dup' }), validBlock({ id: 'dup', x: 6 })]);
    expect(validate(t)).toBeNull();
  });

  it('требует version === 1 и массив блоков', () => {
    const t = validCardTemplate([validBlock()]);
    expect(validate({ ...t, version: 2 })).toBeNull();
    expect(validate({ version: 1, card: t.card, blocks: {} })).toBeNull();
    expect(validate(null)).toBeNull();
  });

  it('отсекает блок с нулевой шириной/высотой и x вне 0..11', () => {
    expect(validate(validCardTemplate([validBlock({ width: 0 })]))).toBeNull();
    expect(validate(validCardTemplate([validBlock({ height: 0 })]))).toBeNull();
    expect(validate(validCardTemplate([validBlock({ x: 12, width: 1 })]))).toBeNull();
  });

  it('ограничивает число блоков (<=200), чтобы JSONB не разрастался', () => {
    const blocks = Array.from({ length: 200 }, (_, i) => validBlock({ id: `b${i}`, x: i % 2 === 0 ? 0 : 6 }));
    expect(validate(validCardTemplate(blocks))).not.toBeNull();

    const tooMany = Array.from({ length: 201 }, (_, i) => validBlock({ id: `b${i}`, x: i % 2 === 0 ? 0 : 6 }));
    expect(validate(validCardTemplate(tooMany))).toBeNull();
  });
});

describe('createPageLayoutValidator — правила списка виджетов', () => {
  const validate = createPageLayoutValidator(['a', 'b']);

  it('пропускает корректный список и отсекает виджет вне каталога', () => {
    const ok: PageLayoutTemplate = { version: 1, widgets: [{ id: 'a', visible: true, size: 'md', order: 0 }] };
    expect(validate(ok)).not.toBeNull();

    const alien: PageLayoutTemplate = { version: 1, widgets: [{ id: 'z', visible: true, size: 'md', order: 0 }] };
    expect(validate(alien)).toBeNull();
  });

  it('отсекает дубли id, неверный размер и order вне 0..999', () => {
    expect(
      validate({ version: 1, widgets: [
        { id: 'a', visible: true, size: 'md', order: 0 },
        { id: 'a', visible: true, size: 'md', order: 1 },
      ] }),
    ).toBeNull();
    expect(validate({ version: 1, widgets: [{ id: 'a', visible: true, size: 'xl', order: 0 }] })).toBeNull();
    expect(validate({ version: 1, widgets: [{ id: 'a', visible: true, size: 'md', order: 1000 }] })).toBeNull();
    expect(WIDGET_SIZES).toEqual(['sm', 'md', 'lg']);
  });

  it('отсекает settings, которые раздувают строку JSONB (> 4000 символов)', () => {
    const small = { version: 1, widgets: [{ id: 'a', visible: true, size: 'md', order: 0, settings: { q: 'x' } }] };
    expect(validate(small)).not.toBeNull();

    const huge = {
      version: 1,
      widgets: [{ id: 'a', visible: true, size: 'md', order: 0, settings: { q: 'x'.repeat(4100) } }],
    };
    expect(validate(huge)).toBeNull();
  });
});

describe('surfaces — реестр поверхностей', () => {
  it('каждая зарегистрированная поверхность проходит собственный валидатор', () => {
    // Реальный риск: умолчание, отвергнутое своим же валидатором, тихо
    // подменяется копией умолчания при каждом чтении — правки админа теряются.
    for (const id of ALL_SURFACE_IDS) {
      const cfg = getSurfaceConfig(id);
      expect(cfg, id).not.toBeNull();
      const registered = surface(id);
      expect(registered.id).toBe(id);
      expect(registered.validate(registered.defaultTemplate), id).not.toBeNull();
    }
  });

  it('неизвестная поверхность и ключи прототипа возвращают null', () => {
    expect(getSurfaceConfig('nope')).toBeNull();
    // hasOwnProperty-guard: 'toString' есть в Object.prototype и не должен
    // открывать доступ к незарегистрированной поверхности.
    expect(getSurfaceConfig('toString')).toBeNull();
    expect(getSurfaceConfig('constructor')).toBeNull();
    expect(getSurfaceConfig('__proto__')).toBeNull();
  });
});

describe('layout-service — слияние override -> base -> умолчание', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    findManyMock.mockReset();
    upsertMock.mockReset();
    deleteManyMock.mockReset();
  });

  it('без tenantId падает, не трогая базу (fail closed)', async () => {
    await expect(getLayout('', MONITORING_EQUIPMENT_TILE_SURFACE_ID)).rejects.toThrow(/tenantId/);
    await expect(getLayoutSet('', MONITORING_EQUIPMENT_TILE_SURFACE_ID)).rejects.toThrow(/tenantId/);
    await expect(saveLayout('', MONITORING_EQUIPMENT_TILE_SURFACE_ID, {}, 'u')).rejects.toThrow(/tenantId/);
    await expect(deleteLayout('', MONITORING_EQUIPMENT_TILE_SURFACE_ID)).rejects.toThrow(/tenantId/);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('неизвестная поверхность -> UnknownSurfaceError', async () => {
    await expect(getLayout('t1', 'nope')).rejects.toBeInstanceOf(UnknownSurfaceError);
  });

  it('override конкретной сущности перекрывает базу', async () => {
    const base = surface(MONITORING_EQUIPMENT_TILE_SURFACE_ID).defaultTemplate;
    const override = { ...base, blocks: [] };
    findUniqueMock.mockImplementation(async (args: { where: { tenantId_surfaceId_entityId: { entityId: string } } }) => {
      const { entityId } = args.where.tenantId_surfaceId_entityId;
      if (entityId === 'rig-1') return { template: override };
      if (entityId === BASE_ENTITY) return { template: base };
      return null;
    });

    const out = (await getLayout('t1', MONITORING_EQUIPMENT_TILE_SURFACE_ID, 'rig-1')) as LayoutTemplate;
    expect(out.blocks).toEqual([]);
  });

  it('битый override отбрасывается — берётся база', async () => {
    const base = surface(MONITORING_EQUIPMENT_TILE_SURFACE_ID).defaultTemplate;
    findUniqueMock.mockImplementation(async (args: { where: { tenantId_surfaceId_entityId: { entityId: string } } }) => {
      const { entityId } = args.where.tenantId_surfaceId_entityId;
      if (entityId === 'rig-1') return { template: { version: 99 } }; // мусор в JSONB
      if (entityId === BASE_ENTITY) return { template: base };
      return null;
    });

    const out = (await getLayout('t1', MONITORING_EQUIPMENT_TILE_SURFACE_ID, 'rig-1')) as LayoutTemplate;
    expect(out.blocks.length).toBe((base as LayoutTemplate).blocks.length);
  });

  it('нет ни override, ни базы — возвращается умолчание, и его копия', async () => {
    findUniqueMock.mockResolvedValue(null);
    const tileSurface = surface(MONITORING_EQUIPMENT_TILE_SURFACE_ID);

    const first = await getLayout('t1', MONITORING_EQUIPMENT_TILE_SURFACE_ID);
    // Копия: мутация результата не портит модульную константу умолчания.
    (first as LayoutTemplate).blocks.pop();
    const second = (await getLayout('t1', MONITORING_EQUIPMENT_TILE_SURFACE_ID)) as LayoutTemplate;
    expect(second.blocks.length).toBe((tileSurface.defaultTemplate as LayoutTemplate).blocks.length);
  });

  it('getLayoutSet: валидные строки раскладываются на base + overrides, битые пропускаются', async () => {
    const base = surface(MONITORING_EQUIPMENT_TILE_SURFACE_ID).defaultTemplate;
    findManyMock.mockResolvedValue([
      { entityId: BASE_ENTITY, template: base },
      { entityId: 'rig-1', template: { ...base, blocks: [] } },
      { entityId: 'rig-2', template: { version: 1, card: {}, blocks: [] } }, // битый — отбросить
    ]);

    const set = await getLayoutSet('t1', MONITORING_EQUIPMENT_TILE_SURFACE_ID);
    expect(set.base).toEqual(base);
    expect(Object.keys(set.overrides)).toEqual(['rig-1']);
    expect((set.overrides['rig-1'] as LayoutTemplate).blocks).toEqual([]);
    // Запрос ограничен тенантом и поверхностью.
    expect(findManyMock).toHaveBeenCalledWith({
      where: { tenantId: 't1', surfaceId: MONITORING_EQUIPMENT_TILE_SURFACE_ID },
    });
  });

  it('saveLayout: невалидный шаблон -> TypeError и никакой записи', async () => {
    await expect(saveLayout('t1', MONITORING_EQUIPMENT_TILE_SURFACE_ID, { version: 2 }, 'u')).rejects.toBeInstanceOf(TypeError);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('saveLayout: валидный шаблон пишется и возвращается провалидированным', async () => {
    upsertMock.mockResolvedValue(undefined);
    const template = surface(MONITORING_EQUIPMENT_TILE_SURFACE_ID).defaultTemplate;

    const saved = await saveLayout('t1', MONITORING_EQUIPMENT_TILE_SURFACE_ID, template, 'admin-1', 'rig-1');

    expect(saved).toEqual(template);
    const [call] = upsertMock.mock.calls[0];
    expect(call.where).toEqual({
      tenantId_surfaceId_entityId: { tenantId: 't1', surfaceId: MONITORING_EQUIPMENT_TILE_SURFACE_ID, entityId: 'rig-1' },
    });
    expect(call.create.updatedBy).toBe('admin-1');
  });

  it('deleteLayout: удаляет строго в рамках тенанта, поверхности и сущности', async () => {
    deleteManyMock.mockResolvedValue({ count: 1 });
    await deleteLayout('t1', EQUIPMENT_CARD_SURFACE_ID, 'rig-9');
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { tenantId: 't1', surfaceId: EQUIPMENT_CARD_SURFACE_ID, entityId: 'rig-9' },
    });
  });
});

describe('cloneLayoutTemplate', () => {
  it('даёт глубокую копию без общих вложенных объектов', () => {
    const original = validCardTemplate([validBlock()]);
    const copy = cloneLayoutTemplate(original);
    copy.blocks[0].style.color = '#000000';
    expect(original.blocks[0].style.color).toBe('#101010');
  });
});