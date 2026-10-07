/**
 * W63: круговой проход полей карточки установки.
 *
 * Проверяем, что каждое поле формы (passport / тех. характеристики /
 * эксплуатация) доходит до сервера и возвращается тем же значением:
 * `equipmentToFormState` (сервер → форма) → `formStateToPayload`
 * (форма → тело PUT). Плюс сверяем ключи тела с серверным whitelist
 * `METADATA_KEYS` и с zod-схемой маршрута `equipmentUpdateSchema`.
 *
 * Тест ничего не пишет в БД и не рендерит компонент — только чистые функции
 * и схемы. `METADATA_KEYS` — приватная константа модуля (не экспортирована),
 * а задача изменения кода не разрешает, поэтому список читаем из исходника
 * файла и парсим литерал массива.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  EMPTY_EQUIPMENT_FORM,
  formStateToPayload,
  equipmentToFormState,
} from '../equipment-form';
import { equipmentUpdateSchema } from '@/lib/validation-schemas';

/** Основные (агрегатные) поля установки — их обрабатывает не metadata-путь. */
const CORE_KEYS = ['name', 'model', 'qty', 'description', 'isActive'] as const;

/** Служебные ключи тела PUT — их добавляет вызывающий код, не форма. */
const SERVICE_KEYS = ['expectedUpdatedAt'] as const;

/**
 * Серверный whitelist полей метаданных. Читаем из исходника
 * `equipment-metadata.ts`, потому что константа модуля приватная
 * (см. комментарий задачи: код не меняем).
 */
const METADATA_MODULE_REL = 'src/modules/equipment/application/commands/equipment-metadata.ts';

/** Ищем корень репозитория вверх от cwd — тесты гоняются из корня проекта. */
function findMetadataModule(): string {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, METADATA_MODULE_REL);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Не найден ${METADATA_MODULE_REL}`);
    dir = parent;
  }
}

function readMetadataKeys(): string[] {
  const source = readFileSync(findMetadataModule(), 'utf8');
  const block = source.match(/const METADATA_KEYS = \[([\s\S]*?)\]\s*as const;/);
  if (!block) throw new Error('Не найден литерал METADATA_KEYS в equipment-metadata.ts');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const METADATA_KEYS = readMetadataKeys();

/** Установка со ВСЕМИ полями формы, заполненными (как их отдаёт сервер). */
const FULL_ITEM: Record<string, unknown> = {
  name: 'Копёр Liebherr LRH 100 №1',
  model: 'LRH 100',
  description: 'Забивная установка на базе гусеничного крана, участок «Север»',
  isActive: true,
  inventoryNumber: 'ИНВ-000123',
  registrationNumber: 'А123ВС 78',
  kind: 'PILE_DRIVER',
  baseVehicle: 'Volvo EC360BLC',
  serialNumber: 'SN-987654',
  manufactureYear: 2014,
  vin: 'XLR12345678901234',
  weightTons: 42.5,
  weightWithEquipmentTons: 55.75,
  heightMm: 12500,
  lengthMm: 9800,
  widthMm: 3200,
  engineBrand: 'Volvo Penta TAD',
  engineSerialNumber: 'ДВС-556677',
  enginePower: 265,
  maxPileLength: 24,
  maxDrillingDepth: 30.5,
  hammerType: 'Junttan HHK-5/7',
  hammerSerialNumber: 'МОЛ-112233',
  hammerEnergyKj: 90.5,
  hammerKind: 'HYDRAULIC',
  isCombined: true,
  purchaseDate: '2018-04-12T00:00:00.000Z',
  purchasePrice: 18500000.5,
  engineHoursTotal: 3000,
  fuelTankLiters: 400,
  nextMaintenanceAtHours: 3200,
  nextMaintenanceDate: '2026-11-01T00:00:00.000Z',
  homeBaseLocation: 'База «Орион», г. Уфа',
};

/** Ожидаемое тело формы: числа — числами, даты — YYYY-MM-DD, как есть. */
const EXPECTED_PAYLOAD: Record<string, unknown> = {
  name: 'Копёр Liebherr LRH 100 №1',
  model: 'LRH 100',
  description: 'Забивная установка на базе гусеничного крана, участок «Север»',
  isActive: true,
  inventoryNumber: 'ИНВ-000123',
  registrationNumber: 'А123ВС 78',
  kind: 'PILE_DRIVER',
  baseVehicle: 'Volvo EC360BLC',
  serialNumber: 'SN-987654',
  manufactureYear: 2014,
  vin: 'XLR12345678901234',
  weightTons: 42.5,
  weightWithEquipmentTons: 55.75,
  heightMm: 12500,
  lengthMm: 9800,
  widthMm: 3200,
  engineBrand: 'Volvo Penta TAD',
  engineSerialNumber: 'ДВС-556677',
  enginePower: 265,
  maxPileLength: 24,
  maxDrillingDepth: 30.5,
  hammerType: 'Junttan HHK-5/7',
  hammerSerialNumber: 'МОЛ-112233',
  hammerEnergyKj: 90.5,
  hammerKind: 'HYDRAULIC',
  isCombined: true,
  purchaseDate: '2018-04-12',
  purchasePrice: 18500000.5,
  engineHoursTotal: 3000,
  fuelTankLiters: 400,
  nextMaintenanceAtHours: 3200,
  nextMaintenanceDate: '2026-11-01',
  homeBaseLocation: 'База «Орион», г. Уфа',
};

/** Тело PUT, как его собирает вызывающий код (форма + служебное поле). */
const BODY = { ...formStateToPayload(equipmentToFormState(FULL_ITEM)), expectedUpdatedAt: '2026-10-07T10:00:00.000Z' };

describe('equipment-form roundtrip (W63)', () => {
  it('whitelist METADATA_KEYS прочитан и непустой', () => {
    expect(METADATA_KEYS.length).toBeGreaterThan(0);
  });

  it('1. каждое поле формы доходит до тела с тем же значением', () => {
    const payload = formStateToPayload(equipmentToFormState(FULL_ITEM));
    expect(payload).toEqual(EXPECTED_PAYLOAD);
  });

  it('1b. пустая форма: строки → null (кроме названия), булевы сохраняются', () => {
    const payload = formStateToPayload(EMPTY_EQUIPMENT_FORM);
    expect(payload.name).toBe('');
    expect(payload.model).toBeNull();
    expect(payload.description).toBeNull();
    expect(payload.isActive).toBe(true);
    expect(payload.kind).toBe('OTHER');
    expect(payload.hammerKind).toBe('NONE');
    expect(payload.isCombined).toBe(false);
    // Все 29 полей метаданных пусты → null.
    for (const key of METADATA_KEYS) {
      if (key === 'kind' || key === 'hammerKind' || key === 'isCombined') continue;
      expect(payload[key as keyof typeof payload]).toBeNull();
    }
  });

  it('2. каждый ключ тела (кроме служебных) обрабатывается на сервере', () => {
    const payload = formStateToPayload(equipmentToFormState(FULL_ITEM));
    const known = new Set<string>([...METADATA_KEYS, ...CORE_KEYS, ...SERVICE_KEYS]);
    const unhandled = Object.keys(payload).filter((key) => !known.has(key));
    // если появится — ключ уйдёт в тело PUT, но сервер его молча отбросит.
    expect(unhandled).toEqual([]);
  });

  it('3. тело PUT проходит equipmentUpdateSchema без ошибок', () => {
    const result = equipmentUpdateSchema.safeParse(BODY);
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('4. «Наработка моточасов» из строки «3000» → число 3000', () => {
    const state = { ...EMPTY_EQUIPMENT_FORM, name: 'Тест', engineHoursTotal: '3000' };
    const payload = formStateToPayload(state);
    expect(payload.engineHoursTotal).toBe(3000);
  });

  // Фактическое поведение: `Number('1,5')` = NaN, а `JSON.stringify` зануляет
  // NaN → поле уходит на сервер как null (молчаливая очистка). Поля объявлены
  // `type="number"`, браузер запятую через value не отдаёт, но чистая функция
  // от такого ввода не защищена — фиксируем.
  it('4b. «1,5» в дробном поле даёт NaN (фактическое поведение)', () => {
    const payload = formStateToPayload({ ...EMPTY_EQUIPMENT_FORM, weightTons: '1,5', enginePower: '1,5' });
    expect(Number.isNaN(payload.weightTons)).toBe(true);
    expect(Number.isNaN(payload.enginePower)).toBe(true);
    // На проводе NaN превращается в null.
    const wire = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    expect(wire.weightTons).toBeNull();
    expect(wire.enginePower).toBeNull();
  });

  it.fails('4c. «1,5» должно читаться как 1,5, но Number даёт NaN (находка)', () => {
    const payload = formStateToPayload({ ...EMPTY_EQUIPMENT_FORM, weightTons: '1,5' });
    expect(payload.weightTons).toBe(1.5);
  });

  it.fails('4d. «1,5» в мощности должно читаться как 1,5, но Number даёт NaN (находка)', () => {
    const payload = formStateToPayload({ ...EMPTY_EQUIPMENT_FORM, enginePower: '1,5' });
    expect(payload.enginePower).toBe(1.5);
  });
});
