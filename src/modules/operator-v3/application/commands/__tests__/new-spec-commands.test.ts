import {describe, expect, it} from 'vitest';
import {createNewSpecChecklistCommandRegistry} from '../new-spec-checklist-commands';
import {createNewSpecWorkCommandRegistry} from '../new-spec-work-commands';
import {createExistingOperatorCommandRegistry} from '../existing-command-adapters';
import {
  isOperatorV3CaptureOnlyCommand,
  OPERATOR_V3_COMMAND_NAMES,
  type OperatorCommandRegistry,
} from '../operator-command-registry';

const context = {
  tenantId: 'tenant-1', actorId: 'operator-1', actorName: 'Иванов И.И.', actorRole: 'OPERATOR',
  requestId: 'request-1', correlationId: 'correlation-1',
};

function input(payload: Record<string, unknown>, commandId = 'operator-command-1001') {
  return {
    context,
    checksum: 'checksum-1',
    envelope: {
      commandId, aggregateId: 'shift-1', expectedVersion: 7,
      deviceId: 'tablet-1', deviceSequence: 15,
      occurredAt: '2026-08-29T08:00:00.000Z', payload,
    },
  };
}

function requiredCommand(registry: OperatorCommandRegistry, name: string) {
  const command = registry.get(name);
  if (!command) throw new Error(`Команда ${name} не зарегистрирована`);
  return command;
}

describe('команды новой спецификации operator-v3', () => {
  it('подключает каждое нормативное имя к исполняемому серверному адаптеру', () => {
    const registry = createExistingOperatorCommandRegistry({} as never);

    expect([...registry.keys()]).toEqual(OPERATOR_V3_COMMAND_NAMES);
    expect(registry.get('complete-checklist')?.critical).toBe(true);
    expect(registry.get('capture-weather')?.critical).toBe(false);
  });

  it('разрешает offline capture доказательств, но не автономное подтверждение критического решения', () => {
    expect(isOperatorV3CaptureOnlyCommand('start-checklist')).toBe(true);
    expect(isOperatorV3CaptureOnlyCommand('save-checklist-answer')).toBe(true);
    expect(isOperatorV3CaptureOnlyCommand('capture-weather')).toBe(true);
    expect(isOperatorV3CaptureOnlyCommand('record-pile-driving')).toBe(true);
    expect(isOperatorV3CaptureOnlyCommand('complete-checklist')).toBe(false);
    expect(isOperatorV3CaptureOnlyCommand('confirm-site-check')).toBe(false);
    expect(isOperatorV3CaptureOnlyCommand('complete-function-check')).toBe(false);
  });

  it('сохраняет выполнение и ответ чек-листа, а завершение оставляет критическим решением', async () => {
    const calls: Array<{kind: string; value: unknown}> = [];
    const registry = createNewSpecChecklistCommandRegistry({
      startExecution: async (value) => { calls.push({kind: 'start', value}); return {id: value.id}; },
      saveAnswer: async (value) => { calls.push({kind: 'answer', value}); return {id: value.id}; },
      completeExecution: async (value) => { calls.push({kind: 'complete', value}); return {id: value.id}; },
    });

    await requiredCommand(registry, 'start-checklist').execute(input({
      executionId: 'exec-1', shiftId: 'shift-1', equipmentId: 'eq-1', templateId: 'tpl-1',
    }));
    await requiredCommand(registry, 'save-checklist-answer').execute(input({
      executionId: 'exec-1', answer: {itemId: 'item-1', result: 'PASS', value: null,
        note: null, mediaIds: [], answeredAt: '2026-08-29T08:01:00.000Z'},
    }, 'operator-command-1002'));
    await requiredCommand(registry, 'complete-checklist').execute(input({executionId: 'exec-1'}, 'operator-command-1003'));

    expect(registry.get('start-checklist')?.critical).toBe(false);
    expect(registry.get('save-checklist-answer')?.critical).toBe(false);
    expect(registry.get('complete-checklist')?.critical).toBe(true);
    expect(calls).toMatchObject([
      {kind: 'start', value: {id: 'exec-1', tenantId: 'tenant-1', clientCommandId: 'operator-command-1001'}},
      {kind: 'answer', value: {tenantId: 'tenant-1', executionId: 'exec-1', clientCommandId: 'operator-command-1002'}},
      {kind: 'complete', value: {tenantId: 'tenant-1', id: 'exec-1'}},
    ]);
  });

  it('сохраняет автономно собираемые факты смены, но оставляет подтверждения площадки и функций критическими', async () => {
    const records: unknown[] = [];
    const registry = createNewSpecWorkCommandRegistry({
      record: async (value) => { records.push(value); return {id: value.id}; },
    });

    await requiredCommand(registry, 'capture-weather').execute(input({
      shiftId: 'shift-1', equipmentId: 'eq-1', temperatureC: 12, windSpeedMps: 4,
      windGustMps: 7, precipitation: 'NONE', visibilityMeters: 10000,
      thunderstorm: false, observedAt: '2026-08-29T08:00:00.000Z', source: 'SITE',
    }));

    expect(registry.get('capture-weather')?.critical).toBe(false);
    expect(registry.get('record-pile-driving')?.critical).toBe(false);
    expect(registry.get('confirm-site-check')?.critical).toBe(true);
    expect(registry.get('complete-function-check')?.critical).toBe(true);
    expect(records).toMatchObject([{
      id: 'tenant-1:operator-command-1001', tenantId: 'tenant-1', shiftId: 'shift-1',
      equipmentId: 'eq-1', kind: 'WEATHER_SNAPSHOT', clientCommandId: 'operator-command-1001',
      payload: {commandName: 'capture-weather', commandChecksum: 'checksum-1'},
    }]);
  });
});
