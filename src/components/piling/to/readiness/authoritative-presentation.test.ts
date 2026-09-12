import {describe, expect, it} from 'vitest';
import type {CurrentReadinessDto} from './api/contracts';
import {buildAuthoritativeReadinessPresentation} from './authoritative-presentation';

const facts = {
  inspectionCompleted: true,
  inspectionProgress: 1,
  healthScore: 96,
  meterKnown: true,
  permitValid: true,
  permitExpired: false,
  maintenanceConfigured: true,
  maintenanceOverdueHours: 0,
  maintenanceOverdueDays: 0,
  accepted: true,
  criticalDefect: false,
  findings: 0,
} as const;

function snapshot(overrides: Partial<CurrentReadinessDto> = {}): CurrentReadinessDto {
  return {
    equipmentId: 'equipment-1',
    snapshotId: 'snapshot-1',
    status: 'READY',
    score: 96,
    calculatedAt: '2026-08-08T12:00:00.000Z',
    blockers: [],
    warnings: [],
    evidence: {
      equipmentId: 'equipment-1',
      inspectionId: 'inspection-1',
      permitId: 'permit-1',
      maintenanceRecordIds: [],
      evaluatedAt: '2026-08-08T12:00:00.000Z',
    },
    facts,
    triggerType: 'INSPECTION_COMPLETED',
    ruleSetVersion: 'v1',
    ...overrides,
  };
}

describe('buildAuthoritativeReadinessPresentation', () => {
  it('builds READY status, five stages and evidence only from the snapshot', () => {
    const result = buildAuthoritativeReadinessPresentation(snapshot());
    expect(result).toMatchObject({
      mode: 'authoritative', status: 'READY', score: 96,
      nextAction: 'Авторитетная оценка подтверждает готовность к работе',
    });
    expect(result.stages.map((stage) => stage.key)).toEqual([
      'INSPECTION', 'ENGINE_HOURS', 'PERMIT', 'MAINTENANCE', 'ACCEPTANCE',
    ]);
    expect(result.stages.every((stage) => stage.state === 'pass')).toBe(true);
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({key: 'inspection', reference: 'inspection-1'}),
      expect.objectContaining({key: 'permit', reference: 'permit-1'}),
    ]));
  });

  it('links the inspection evidence only for a mechanic inspection, never for an operator checklist', () => {
    // Регресс: `inspectionId` может быть id осмотра механика ИЛИ id чек-листа
    // машиниста. Ссылка /inspections/{id} валидна только для первого; для
    // второго это чужой тип сущности — 404. Источник различает `inspectionSource`.
    const base = {
      equipmentId: 'equipment-1',
      inspectionId: 'inspection-1',
      permitId: null,
      maintenanceRecordIds: [] as string[],
      evaluatedAt: '2026-08-08T12:00:00.000Z',
    };

    const mechanic = buildAuthoritativeReadinessPresentation(
      snapshot({evidence: {...base, inspectionSource: 'INSPECTION'}}),
    ).evidence.find((item) => item.key === 'inspection');
    expect(mechanic?.links).toEqual([{text: 'Открыть осмотр', href: '/inspections/inspection-1'}]);

    const operator = buildAuthoritativeReadinessPresentation(
      snapshot({evidence: {...base, inspectionSource: 'OPERATOR_CHECKLIST'}}),
    ).evidence.find((item) => item.key === 'inspection');
    expect(operator?.label).toBe('Осмотр машиниста');
    expect(operator?.links ?? []).toEqual([]);

    // Старый снимок без источника: проверить ссылку нечем — не даём её.
    const legacy = buildAuthoritativeReadinessPresentation(
      snapshot({evidence: base}),
    ).evidence.find((item) => item.key === 'inspection');
    expect(legacy?.links ?? []).toEqual([]);
  });

  it('takes the inspection type from typed references, ignoring the flat field', () => {
    // Типизированные ссылки — источник истины. Если плоское поле осталось от
    // прежней записи и спорит со ссылкой, верить надо ссылке: только у неё тип
    // неотделим от идентификатора.
    const withRefs = (references: unknown, flat: Record<string, unknown> = {}) =>
      buildAuthoritativeReadinessPresentation(snapshot({
        evidence: {
          references,
          equipmentId: 'equipment-1',
          inspectionId: 'inspection-1',
          permitId: null,
          maintenanceRecordIds: [],
          evaluatedAt: '2026-08-08T12:00:00.000Z',
          ...flat,
        },
      })).evidence.find((item) => item.key === 'inspection');

    // Ссылка говорит «чек-лист машиниста», плоское поле врёт «осмотр механика».
    const operator = withRefs(
      [{type: 'EQUIPMENT', id: 'equipment-1'}, {type: 'OPERATOR_CHECKLIST', id: 'exec-9'}],
      {inspectionSource: 'INSPECTION'},
    );
    expect(operator?.label).toBe('Осмотр машиниста');
    expect(operator?.reference).toBe('exec-9');
    expect(operator?.links ?? []).toEqual([]);

    // Обратный случай: ссылка на журнал ЕО/ТО — открывается по своему id.
    const mechanic = withRefs(
      [{type: 'EQUIPMENT', id: 'equipment-1'}, {type: 'INSPECTION', id: 'insp-7'}],
      {inspectionSource: 'OPERATOR_CHECKLIST'},
    );
    expect(mechanic?.links).toEqual([{text: 'Открыть осмотр', href: '/inspections/insp-7'}]);

    // Испорченные ссылки не принимаем: снимок считается некорректным целиком.
    expect(buildAuthoritativeReadinessPresentation(snapshot({
      evidence: {
        references: [{type: 'NOT_A_TYPE', id: 'x'}],
        equipmentId: 'equipment-1', inspectionId: null, permitId: null,
        maintenanceRecordIds: [], evaluatedAt: '2026-08-08T12:00:00.000Z',
      },
    }))).toMatchObject({mode: 'malformed'});
  });

  it('builds BLOCKED notices and next action from persisted blockers', () => {
    const result = buildAuthoritativeReadinessPresentation(snapshot({
      status: 'BLOCKED', score: 42,
      facts: {...facts, permitValid: false, accepted: false},
      blockers: [{condition: 'VALID_WORK_PERMIT_REQUIRED', action: 'DENY_START',
        label: 'Требуется действующий допуск', actionLabel: 'Оформить допуск'}],
    }));
    expect(result).toMatchObject({
      mode: 'authoritative', status: 'BLOCKED', score: 42,
      nextAction: 'Оформить допуск',
      blockers: [expect.objectContaining({label: 'Требуется действующий допуск'})],
    });
    expect(result.stages.find((stage) => stage.key === 'PERMIT')?.state).toBe('fail');
  });

  /*
    Организация, которая наряды не ведёт, присылает permitValid = null. Шаг
    «Допуск» тогда не «не подтверждён», а выполненный и с объяснением: иначе
    лента роли администратора («Центр готовности») ждёт документ, которого в
    этой организации не выписывают, и навсегда стоит на «2 из 3».
  */
  it('показывает шаг «Допуск» выполненным, когда наряды не требуются', () => {
    const result = buildAuthoritativeReadinessPresentation(snapshot({
      facts: {...facts, permitValid: null},
    }));
    expect(result.stages.find((stage) => stage.key === 'PERMIT')).toMatchObject({
      state: 'pass', value: 'Не требуется правилами',
    });
  });

  it('marks a legacy snapshot without facts as incomplete history', () => {
    expect(buildAuthoritativeReadinessPresentation(snapshot({facts: null}))).toMatchObject({
      mode: 'historical-incomplete',
      status: 'UNCONFIRMED',
      score: null,
      title: 'Исторические доказательства неполны',
    });
  });

  it('uses safe states for missing and malformed snapshots', () => {
    expect(buildAuthoritativeReadinessPresentation(null)).toMatchObject({
      mode: 'missing', status: 'UNCONFIRMED', score: null,
      title: 'Авторитетная оценка ещё не выполнена',
    });
    expect(buildAuthoritativeReadinessPresentation(snapshot({evidence: []}))).toMatchObject({
      mode: 'malformed', status: 'UNCONFIRMED', score: null,
      title: 'Авторитетная оценка недоступна',
    });
  });
});
