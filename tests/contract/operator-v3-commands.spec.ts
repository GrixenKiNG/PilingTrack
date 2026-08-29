import {describe, expect, it} from 'vitest';
import {
  operatorCommandEnvelopeSchema,
  operatorCommandEnvelopeSchemaFor,
} from '@/modules/operator-v3/application/commands/envelope-schema';
import {
  isOperatorV3CommandName,
  OPERATOR_V3_COMMAND_NAMES,
} from '@/modules/operator-v3/application/commands/operator-command-registry';

describe('договор команд оператора v3', () => {
  it('публикует закрытый нормативный перечень команд первого и безопасного срезов', () => {
    // AC: Реестр публикует все команды новой мобильной спецификации и отвергает неизвестные имена.
    // Behavior: Имя команды → проверка закрытого реестра → нормативное имя принято, выдуманное отвергнуто.
    // @category: integration
    // @lane: integration
    // @dependency: operator command registry
    // @complexity: low
    // ROI: 60
    expect(OPERATOR_V3_COMMAND_NAMES).toEqual([
      'accept-assignment', 'accept-equipment', 'create-inspection', 'save-inspection',
      'complete-inspection', 'confirm-work-zone', 'record-meter', 'complete-preparation', 'start-shift',
      'report-defect', 'report-incident', 'confirm-safe-stop',
      'record-production', 'start-break', 'start-downtime', 'finish-interval',
      'complete-repair', 'request-independent-check', 'confirm-independent-check', 'resume-work',
      'complete-report', 'submit-handover', 'accept-handover', 'close-shift-without-recipient',
      'start-checklist', 'save-checklist-answer', 'complete-checklist',
      'submit-knowledge-test', 'capture-weather', 'confirm-site-check',
      'record-startup', 'record-warmup', 'complete-function-check',
      'record-maintenance-action', 'record-fluid-reading',
      'record-pile-driving', 'record-leader-drilling',
    ]);
    expect(isOperatorV3CommandName('start-checklist')).toBe(true);
    expect(isOperatorV3CommandName('client-invented')).toBe(false);
  });

  it('требует полную командную оболочку и запрещает лишние поля', () => {
    // AC: Все команды повторно используют строгий общий конверт, версию и идентификатор идемпотентности.
    // Behavior: Командный конверт → строгий разбор → допустимый принят, лишнее поле и отрицательная версия отвергнуты.
    // @category: integration
    // @lane: integration
    // @dependency: operator command envelope
    // @complexity: low
    // ROI: 55
    const valid = {
      commandId: 'operator-command-0001', aggregateId: 'shift-1', expectedVersion: 2,
      deviceId: 'tablet-1', deviceSequence: 1, occurredAt: '2026-08-27T08:00:00.000Z', payload: {},
    };
    expect(operatorCommandEnvelopeSchema.safeParse(valid).success).toBe(true);
    expect(operatorCommandEnvelopeSchema.safeParse({...valid, tenantId: 'чужая-организация'}).success).toBe(false);
    expect(operatorCommandEnvelopeSchema.safeParse({...valid, expectedVersion: -1}).success).toBe(false);
  });

  it('применяет отдельный строгий контракт полезной нагрузки каждой новой команды', () => {
    // AC: Новые команды принимают только допустимые и полные полезные данные своей операции.
    // Behavior: Имя и конверт новой команды → разбор command-specific payload → полный payload принят, пустой отвергнут.
    // @category: integration
    // @lane: integration
    // @dependency: operator command envelope, new-spec command schemas
    // @complexity: medium
    // ROI: 60
    const base = {
      commandId: 'operator-command-0002', aggregateId: 'shift-1', expectedVersion: 2,
      deviceId: 'tablet-1', deviceSequence: 2, occurredAt: '2026-08-29T08:00:00.000Z',
    };
    const validPayloads = {
      'start-checklist': {executionId: 'exec-1', shiftId: 'shift-1', equipmentId: 'eq-1', templateId: 'tpl-1'},
      'save-checklist-answer': {executionId: 'exec-1', answer: {itemId: 'item-1', result: 'PASS', value: null,
        note: null, mediaIds: [], answeredAt: '2026-08-29T08:01:00.000Z'}},
      'complete-checklist': {executionId: 'exec-1'},
      'submit-knowledge-test': {shiftId: 'shift-1', equipmentId: 'eq-1', correctAnswers: 4, totalQuestions: 5, passed: true},
      'capture-weather': {shiftId: 'shift-1', equipmentId: 'eq-1', temperatureC: 12, windSpeedMps: 4,
        windGustMps: 7, precipitation: 'NONE', visibilityMeters: 10000, thunderstorm: false,
        observedAt: '2026-08-29T08:00:00.000Z', source: 'SITE'},
      'confirm-site-check': {shiftId: 'shift-1', equipmentId: 'eq-1', confirmed: true, issues: [], mediaIds: []},
      'record-startup': {shiftId: 'shift-1', equipmentId: 'eq-1', meterHours: 135,
        startedAt: '2026-08-29T08:10:00.000Z'},
      'record-warmup': {shiftId: 'shift-1', equipmentId: 'eq-1', coolantTemperatureC: 65,
        hydraulicTemperatureC: 42, confirmedAt: '2026-08-29T08:20:00.000Z'},
      'complete-function-check': {shiftId: 'shift-1', equipmentId: 'eq-1',
        checks: [{code: 'emergency-stop', result: 'PASS'}], completedAt: '2026-08-29T08:25:00.000Z'},
      'record-maintenance-action': {shiftId: 'shift-1', equipmentId: 'eq-1', actionCode: 'CLEAN_CAMERA',
        result: 'DONE', quantity: null, unit: null, note: null, mediaIds: []},
      'record-fluid-reading': {shiftId: 'shift-1', equipmentId: 'eq-1', fluidType: 'ENGINE_OIL',
        level: 'NORMAL', addedQuantity: null, unit: 'L', note: null, mediaIds: []},
      'record-pile-driving': {shiftId: 'shift-1', equipmentId: 'eq-1', pileId: 'pile-17', depthMeters: 12.5,
        startedAt: '2026-08-29T09:00:00.000Z', finishedAt: '2026-08-29T09:20:00.000Z'},
      'record-leader-drilling': {shiftId: 'shift-1', equipmentId: 'eq-1', holeId: 'hole-17', depthMeters: 8,
        startedAt: '2026-08-29T09:30:00.000Z', finishedAt: '2026-08-29T09:50:00.000Z'},
    } as const;

    for (const [commandName, payload] of Object.entries(validPayloads)) {
      expect(operatorCommandEnvelopeSchemaFor(commandName).safeParse({...base, payload}).success,
        `${commandName} должен принимать нормативную нагрузку`).toBe(true);
      expect(operatorCommandEnvelopeSchemaFor(commandName).safeParse({...base, payload: {}}).success,
        `${commandName} не должен принимать пустую нагрузку`).toBe(false);
    }
  });
});
