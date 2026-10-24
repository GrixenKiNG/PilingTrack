// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';

/*
  ДВЕ ОДНОВРЕМЕННЫЕ ОТПРАВКИ ЧЕК-ЛИСТА РАЗВОДЯТСЯ ADVISORY-ЗАМКОМ.

  Дедупликация дефектов в `submitChecklist` — «прочитал открытые по ключу →
  создал недостающие» — на одновременности не работает: у `sourceKey` нет
  уникального ограничения, и повтор с телефона или вторая вкладка успевают оба
  прочитать «открытых по этому пункту нет» и оба создать запись (F-R38-5b).
  Замок берётся ДО цикла, по отсортированным уникальным ключам `drafts`, и
  снимается сам при коммите или откате.

  Домен подменён: проверяется не сбор дефектов, а порядок и состав замков в
  команде. `collectDefectDrafts` возвращает заведомо неотсортированный набор с
  повтором, `selectChecklistItems`/`validateChecklistRun` — тривиальные.
*/
const {withReadinessTenantTransaction, requestReadinessSnapshot, createRepairOrderForDefect} = vi.hoisted(() => ({
  withReadinessTenantTransaction: vi.fn(),
  requestReadinessSnapshot: vi.fn(),
  createRepairOrderForDefect: vi.fn(),
}));
vi.mock('@/modules/readiness/server', () => ({
  withReadinessTenantTransaction, requestReadinessSnapshot, createRepairOrderForDefect,
}));

const {enqueueCriticalDefects} = vi.hoisted(() => ({enqueueCriticalDefects: vi.fn()}));
vi.mock('@/core/notifications/durable-alert', () => ({enqueueCriticalDefects}));

const {getChecklist} = vi.hoisted(() => ({getChecklist: vi.fn()}));
vi.mock('../../../domain/checklist-catalog', () => ({getChecklist}));

const {collectDefectDrafts, validateChecklistRun} = vi.hoisted(() => ({
  collectDefectDrafts: vi.fn(),
  validateChecklistRun: vi.fn(),
}));
vi.mock('../../../domain/checklist-run', () => ({collectDefectDrafts, validateChecklistRun}));

const {selectChecklistItems} = vi.hoisted(() => ({selectChecklistItems: vi.fn()}));
vi.mock('../../../domain/shift-conditions', () => ({selectChecklistItems}));

const {missingPrerequisites} = vi.hoisted(() => ({missingPrerequisites: vi.fn()}));
vi.mock('../../../domain/shift-phases', () => ({missingPrerequisites}));

import {submitChecklist} from '../checklist';
import type {ChecklistStage} from '../../../domain/checklist-types';
import type {ChecklistAnswer} from '../../../domain/checklist-run';

const input = {
  tenantId: 'tenant-a',
  operatorId: 'operator-a',
  shiftId: 'shift-1',
  equipmentId: 'eq-1',
  stage: 'PRESHIFT_INSPECTION' as ChecklistStage,
  answers: [] as ChecklistAnswer[],
  clientCommandId: 'cmd-1',
  now: new Date('2026-09-26T06:00:00.000Z'),
};

/** Клиент транзакции: только то, до чего доходит `submitChecklist`. */
const tx = {
  shift: {findFirst: vi.fn()},
  crew: {findFirst: vi.fn()},
  report: {findFirst: vi.fn()},
  operatorChecklistExecution: {findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn()},
  operatorChecklistTemplate: {findUnique: vi.fn(), create: vi.fn()},
  operatorChecklistAnswerRecord: {create: vi.fn()},
  operatorShiftEvidence: {findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn()},
  equipmentDefect: {findFirst: vi.fn(), create: vi.fn()},
  meterReading: {findFirst: vi.fn(), create: vi.fn()},
  fuelLog: {create: vi.fn()},
  equipment: {findFirst: vi.fn(), update: vi.fn()},
  $executeRaw: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  withReadinessTenantTransaction.mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: фиктивный клиент транзакции вместо Prisma
    async (_tenantId: string, work: (client: any) => Promise<unknown>) => work(tx),
  );
  requestReadinessSnapshot.mockResolvedValue(undefined);
  enqueueCriticalDefects.mockResolvedValue(undefined);

  tx.shift.findFirst.mockResolvedValue({
    id: input.shiftId, state: 'STARTED', equipmentId: 'eq-1',
    productionDate: new Date('2026-09-26T00:00:00.000Z'), type: 'DAY',
  });
  tx.crew.findFirst.mockResolvedValue({
    id: 'crew-1', siteId: 'site-1',
    equipment: {isActive: true, hammerKind: 'NONE', isCombined: false},
  });
  tx.report.findFirst.mockResolvedValue(null);
  tx.operatorChecklistExecution.findMany.mockResolvedValue([]);
  tx.operatorChecklistExecution.findUnique.mockResolvedValue(null);
  tx.operatorChecklistExecution.create.mockResolvedValue({id: 'exec-1'});
  tx.operatorChecklistTemplate.findUnique.mockResolvedValue(null);
  tx.operatorChecklistTemplate.create.mockResolvedValue({id: 'tpl-1'});
  tx.operatorShiftEvidence.findFirst.mockResolvedValue(null);

  getChecklist.mockReturnValue({stage: 'PRESHIFT_INSPECTION', version: '1.0', title: 'ЕО до работы'});
  selectChecklistItems.mockReturnValue([]);
  validateChecklistRun.mockReturnValue([]);
  missingPrerequisites.mockReturnValue([]);
  // Ключи намеренно не отсортированы и с повтором: команда обязана взять по
  // одному замку на ключ и в фиксированном порядке.
  collectDefectDrafts.mockReturnValue([
    {sourceKey: 'eq-1:PRESHIFT_INSPECTION:leaks-ground', title: 'Течь', description: '', severity: 'HIGH', mediaIds: []},
    {sourceKey: 'eq-1:PRESHIFT_INSPECTION:cab-dirty', title: 'Грязь', description: '', severity: 'NORMAL', mediaIds: []},
    {sourceKey: 'eq-1:PRESHIFT_INSPECTION:leaks-ground', title: 'Течь', description: '', severity: 'HIGH', mediaIds: []},
  ]);
  tx.equipmentDefect.findFirst.mockResolvedValue(null);
  tx.equipmentDefect.create.mockResolvedValue({id: 'defect-1'});
  tx.meterReading.findFirst.mockResolvedValue({engineHours: 3000});
  tx.meterReading.create.mockResolvedValue({id: 'meter-1'});
  tx.equipment.findFirst.mockResolvedValue({engineHoursTotal: 3000});
  tx.equipment.update.mockResolvedValue({});
});

describe('submitChecklist — пометка замены счётчика', () => {
  it.each(['Счётчик заменён', 'Счётчик заменён; Установлен новый прибор'])('передаёт явную пометку %s в журнал', async (note) => {
    await submitChecklist({...input, answers: [{itemId: 'meter-after', answer: 'OK', measures: {engineHours: 99}, note}]});
    expect(tx.meterReading.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      engineHours: 99, note: `${note}; ЕО до работы`,
    })}));
    // Кэш наработки теперь пересчитывает сама база под блокировкой строки установки.
    expect(tx.$executeRaw).toHaveBeenCalled();
  });

  it.each(['Проверил показание', 'Счётчик заменён ли?'])('обычное примечание %s не разрешает уменьшить показание', async (note) => {
    await expect(submitChecklist({...input, answers: [{itemId: 'meter-after', answer: 'OK', measures: {engineHours: 99}, note}]})).rejects.toMatchObject({status: 400});
    expect(tx.meterReading.create).not.toHaveBeenCalled();
  });

  it('пометка другого пункта не подтверждает замену счётчика', async () => {
    await expect(submitChecklist({...input, answers: [
      {itemId: 'meter-after', answer: 'OK', measures: {engineHours: 99}},
      {itemId: 'glass', answer: 'OK', note: 'Счётчик заменён'},
    ]})).rejects.toMatchObject({status: 400});
    expect(tx.meterReading.create).not.toHaveBeenCalled();
  });
});

describe('submitChecklist — топливо из ЕО после работы', () => {
  const fuelAnswers = (measures: Record<string, number>[]): ChecklistAnswer[] => measures.map((m, i) => (
    {itemId: i === 0 ? 'fuel-level' : 'topup-diesel', answer: 'OK', measures: m}
  ));

  it('остаток и долив дизеля уходят в журнал топлива установки двумя записями', async () => {
    await submitChecklist({...input, answers: fuelAnswers([{fuelPercent: 62}, {dieselL: 120}])});
    const rows = tx.fuelLog.create.mock.calls.map(([arg]) => arg.data);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({tenantId: 'tenant-a', equipmentId: 'eq-1', tankPercent: 62, litersAdded: null, recordedById: 'operator-a'});
    expect(rows[1]).toMatchObject({tankPercent: null, litersAdded: 120});
  });

  it('без остатка и долива журнал топлива не трогается', async () => {
    await submitChecklist({...input, answers: []});
    expect(tx.fuelLog.create).not.toHaveBeenCalled();
  });

  it('масло и антифриз в журнал ТОПЛИВА не попадают', async () => {
    await submitChecklist({...input, answers: [{itemId: 'topup-engine-oil', answer: 'OK', measures: {engineOilL: 3}}]});
    expect(tx.fuelLog.create).not.toHaveBeenCalled();
  });
});

describe('submitChecklist — заявка ТО по дефекту', () => {
  it('дефект высокого уровня получает заявку ТО и привязку, обычный — нет (решение 18.10.2026)', async () => {
    createRepairOrderForDefect.mockResolvedValue('rec-repair');

    await submitChecklist(input);

    expect(createRepairOrderForDefect).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      severity: 'HIGH', defectTitle: 'Течь', actorId: input.operatorId,
    }));
    expect(tx.equipmentDefect.create).toHaveBeenCalledWith({data: expect.objectContaining({
      severity: 'HIGH', maintenanceRecordId: 'rec-repair',
    })});
  });
});

describe('submitChecklist — advisory-замки на ключи дефектов', () => {
  it('берёт замок до чтения открытых дефектов', async () => {
    await submitChecklist(input);

    expect(tx.$executeRaw.mock.invocationCallOrder[0])
      .toBeLessThan(tx.equipmentDefect.findFirst.mock.invocationCallOrder[0]);
  });

  it('берёт по одному замку на отсортированный уникальный ключ', async () => {
    await submitChecklist(input);

    // Первый замок — на строку смены (requireOpenShift), его здесь не считаем.
    // Второй аргумент вызова — значение, подставленное в шаблон тега.
    const defectLocks = tx.$executeRaw.mock.calls.map((call) => call[1]).filter((value) => String(value).startsWith('defect:'));
    expect(defectLocks).toHaveLength(2);
    expect(defectLocks).toEqual([
      'defect:tenant-a:eq-1:PRESHIFT_INSPECTION:cab-dirty',
      'defect:tenant-a:eq-1:PRESHIFT_INSPECTION:leaks-ground',
    ]);
  });
});

describe('submitChecklist — «долил за смену» (ЕО после работы)', () => {
  const topUpItems = [
    {id: 'topup-coolant', text: 'Антифриз', topUp: true, measure: {key: 'coolantL', unit: 'л'}},
    {id: 'topup-diesel', text: 'Дизельное топливо', topUp: true, measure: {key: 'dieselL', unit: 'л'}},
  ];

  beforeEach(() => {
    getChecklist.mockReturnValue({stage: 'EO_AFTER', version: '3.2', title: 'ЕО после работы'});
    selectChecklistItems.mockReturnValue(topUpItems);
    collectDefectDrafts.mockReturnValue([]);
  });

  it('пишет литры событием парка вместе с ключом дизельного топлива и не заводит дефектов', async () => {
    await submitChecklist({...input, stage: 'EO_AFTER', answers: [
      {itemId: 'topup-coolant', answer: 'OK', measures: {coolantL: 2}},
      {itemId: 'topup-diesel', answer: 'OK', measures: {dieselL: 120}},
    ]});

    const fluids = tx.operatorShiftEvidence.create.mock.calls
      .map(([call]) => call.data)
      .find((data: {clientCommandId: string}) => data.clientCommandId === 'cmd-1:fluids');
    expect(fluids).toMatchObject({kind: 'FLUID_READING', shiftId: 'shift-1', equipmentId: 'eq-1'});
    expect(fluids.payload).toEqual({
      stage: 'EO_AFTER',
      fluids: [
        {itemId: 'topup-coolant', coolantL: 2},
        {itemId: 'topup-diesel', dieselL: 120},
      ],
    });
    expect(tx.equipmentDefect.create).not.toHaveBeenCalled();
    expect(tx.operatorChecklistAnswerRecord.create).toHaveBeenCalledTimes(2);
  });

  it('без долива не пишет событие о жидкостях', async () => {
    await submitChecklist({...input, stage: 'EO_AFTER', answers: []});

    const kinds = tx.operatorShiftEvidence.create.mock.calls.map(([call]) => call.data.clientCommandId);
    expect(kinds).not.toContain('cmd-1:fluids');
  });
});
