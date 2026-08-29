import {describe, expect, it} from 'vitest';
import {buildOperatorCommandRequest, operatorFormForAction} from '../api/action-registry';

describe('выполнение серверного действия operator/v3', () => {
  it('использует только маршрут, метод и версию из снимка сервера', () => {
    const request = buildOperatorCommandRequest({
      id: 'start-shift', label: 'Начать смену', kind: 'COMMAND', method: 'POST',
      route: '/api/operator/v3/commands/start-shift', expectedVersion: 7,
      offlinePolicy: 'FORBIDDEN', requiresEvidence: [], confirmation: null,
    }, {commandId: 'cmd-1', deviceId: 'device-1', deviceSequence: 1, occurredAt: '2026-08-27T06:00:00.000Z', payload: {}});

    expect(request).toMatchObject({route: '/api/operator/v3/commands/start-shift', method: 'POST'});
    expect(request.headers).toMatchObject({'Idempotency-Key': 'cmd-1', 'If-Match': 'v7'});
  });
});

describe('справочник форм постоянных действий', () => {
  it('открывает форму по известному коду, не определяя разрешение на клиенте', () => {
    expect(operatorFormForAction({id: 'report-incident', label: 'Сообщить об опасном событии', kind: 'COMMAND', method: 'POST', route: '/api/operator/v3/commands/report-incident', expectedVersion: 3, offlinePolicy: 'CAPTURE_ONLY', requiresEvidence: ['Фотография'], confirmation: null})).toBe('SAFETY_INCIDENT');
    expect(operatorFormForAction({id: 'unknown', label: 'Неизвестное действие', kind: 'SCREEN', offlinePolicy: 'FORBIDDEN', requiresEvidence: [], confirmation: null})).toBeNull();
  });
});
