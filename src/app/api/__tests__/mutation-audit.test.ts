/** W117: фактические изменения попадают в журнал, отказы и повторы — нет. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { ServiceError } from '@/lib/service-error';

const m = vi.hoisted(() => ({
  auth: vi.fn(), can: vi.fn(), audit: vi.fn(), createTemplate: vi.fn(), updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(), saveAnswers: vi.fn(), createDocument: vi.fn(), addFuel: vi.fn(),
  createPlan: vi.fn(), conductBriefing: vi.fn(), signBriefing: vi.fn(), review: vi.fn(),
  retry: vi.fn(), discard: vi.fn(), findMedia: vi.fn(), deleteMedia: vi.fn(), accessMedia: vi.fn(),
  crew: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireAuth: m.auth }));
vi.mock('@/services/auth/authorization-service', () => ({ assertCan: m.can, can: () => true }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: m.audit }));
// Здесь проверяется порядок в обработчике, обёртка защищена своим набором тестов.
vi.mock('@/core/api-wrapper', () => ({
  withMutation: (handler: unknown) => handler,
  withApi: (handler: unknown) => handler,
  readJsonBody: (request: Request) => request.json(),
}));
vi.mock('@/modules/inspections', () => ({
  createTemplate: m.createTemplate, updateTemplate: m.updateTemplate,
  deleteTemplate: m.deleteTemplate, saveAnswers: m.saveAnswers,
}));
vi.mock('@/modules/equipment', () => ({
  createEquipmentDocument: m.createDocument, addFuelEntry: m.addFuel, createMaintenancePlan: m.createPlan,
}));
vi.mock('@/modules/safety', () => ({ conductBriefing: m.conductBriefing, signBriefingRecord: m.signBriefing }));
vi.mock('@/modules/crews', () => ({ getCrewForOperator: m.crew }));
vi.mock('@/lib/db', () => ({
  db: { safetyIncident: { updateMany: m.review }, media: { findUnique: m.findMedia } },
}));
vi.mock('@/core/outbox/dead-letter-queue', () => ({ retryDlqEntry: m.retry, discardDlqEntry: m.discard }));
vi.mock('@/core/media/media-service', () => ({ getMediaService: () => ({ softDelete: m.deleteMedia }) }));
vi.mock('@/core/media/media-auth', () => ({ assertCanAccessMedia: m.accessMedia }));

import { POST as createTemplate } from '../checklist-templates/route';
import { PUT as updateTemplate, DELETE as deleteTemplate } from '../checklist-templates/[id]/route';
import { PUT as saveAnswers } from '../inspections/[id]/route';
import { POST as createDocument } from '../equipment/[id]/documents/route';
import { POST as addFuel } from '../equipment/[id]/fuel/route';
import { POST as createPlan } from '../maintenance-plans/route';
import { POST as conductBriefing } from '../briefings/route';
import { POST as signBriefing } from '../briefings/[id]/sign/route';
import { POST as reviewIncident } from '../admin/incidents/route';
import { POST as dlq } from '../admin/dlq/route';
import { DELETE as deleteMedia } from '../media/[id]/route';

const actor = { id: 'admin-1', name: 'Иван', role: 'ADMIN', tenantId: 'orion' };
const template = { name: 'Осмотр', level: 'EO', sections: [] };
const context = { params: Promise.resolve({ id: 'entity-1' }) };
type Handler = (request: NextRequest, routeContext: typeof context) => Promise<Response>;
const cases: Array<{ label: string; handler: unknown; mock: typeof m.audit; method: string;
  body?: unknown; result: unknown; action: string; targetId: string }> = [
  { label: 'создание шаблона', handler: createTemplate, mock: m.createTemplate, method: 'POST',
    body: template, result: { id: 'created-1', name: 'Осмотр' }, action: 'inspection.template.created', targetId: 'created-1' },
  { label: 'замена шаблона', handler: updateTemplate, mock: m.updateTemplate, method: 'PUT',
    body: template, result: { id: 'created-1', name: 'Осмотр' }, action: 'inspection.template.replaced', targetId: 'entity-1' },
  { label: 'деактивация шаблона', handler: deleteTemplate, mock: m.deleteTemplate, method: 'DELETE',
    result: {}, action: 'inspection.template.deactivated', targetId: 'entity-1' },
  { label: 'сохранение ответов', handler: saveAnswers, mock: m.saveAnswers, method: 'PUT',
    body: { answers: [{ itemId: 'item-1', result: 'YES' }] }, result: { id: 'entity-1' },
    action: 'inspection.answers_saved', targetId: 'entity-1' },
  { label: 'создание документа', handler: createDocument, mock: m.createDocument, method: 'POST',
    body: { type: 'PASSPORT', title: 'Паспорт' }, result: { id: 'created-1', type: 'PASSPORT', title: 'Паспорт' },
    action: 'equipment.document.created', targetId: 'created-1' },
  { label: 'создание записи топлива', handler: addFuel, mock: m.addFuel, method: 'POST',
    body: { litersAdded: 80, tankPercent: 50 }, result: { id: 'created-1', recordedAt: new Date('2026-10-08') },
    action: 'equipment.fuel.created', targetId: 'created-1' },
  { label: 'создание регламента ТО', handler: createPlan, mock: m.createPlan, method: 'POST',
    body: { equipmentId: 'rig-1', title: 'ТО-1', triggerType: 'HOURS', intervalHours: 100 },
    result: { id: 'created-1', title: 'ТО-1' }, action: 'maintenance.plan.created', targetId: 'created-1' },
  { label: 'проведение инструктажа', handler: conductBriefing, mock: m.conductBriefing, method: 'POST',
    body: { userId: 'employee-1', type: 'PRIMARY', documentCode: 'OT-1', documentTitle: 'Охрана труда', documentVersion: '1' },
    result: { id: 'created-1' }, action: 'briefing.conducted', targetId: 'created-1' },
  { label: 'подписание инструктажа', handler: signBriefing, mock: m.signBriefing, method: 'POST',
    result: { alreadySigned: false }, action: 'briefing.signed', targetId: 'entity-1' },
  { label: 'разбор происшествия', handler: reviewIncident, mock: m.review, method: 'POST',
    body: { id: 'incident-1', note: 'Проведён разбор обстоятельств' }, result: { count: 1 },
    action: 'incident.reviewed', targetId: 'incident-1' },
  { label: 'повтор события очереди', handler: dlq, mock: m.retry, method: 'POST',
    body: { id: 'queue-1', action: 'retry' }, result: true, action: 'dlq.retried', targetId: 'queue-1' },
  { label: 'отказ от события очереди', handler: dlq, mock: m.discard, method: 'POST',
    body: { id: 'queue-1', action: 'discard' }, result: undefined, action: 'dlq.discarded', targetId: 'queue-1' },
  { label: 'удаление вложения', handler: deleteMedia, mock: m.deleteMedia, method: 'DELETE',
    result: undefined, action: 'media.deleted', targetId: 'entity-1' },
];

function request(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/audit-contract', {
    method, headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ user: actor, error: null });
  m.audit.mockResolvedValue(undefined);
  m.findMedia.mockResolvedValue({ entityType: 'inspection', entityId: 'inspection-1', tenantId: 'orion', isDeleted: false, userId: actor.id });
});

describe.each(cases)('$label — аудит', (entry) => {
  it('пишет одно событие только после успешной записи, от имени актора с фактическим id', async () => {
    entry.mock.mockResolvedValue(entry.result);
    const response = await (entry.handler as Handler)(request(entry.method, entry.body), context);
    expect(response.status).toBeLessThan(300);
    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: entry.action, actorId: actor.id, targetId: entry.targetId, tenantId: actor.tenantId,
    }));
    expect(m.audit.mock.invocationCallOrder[0]).toBeGreaterThan(entry.mock.mock.invocationCallOrder[0]);
  });

  it('ошибка основной записи не создаёт события об успехе', async () => {
    entry.mock.mockRejectedValue(new ServiceError('Отказ записи', 409));
    const result = (entry.handler as Handler)(request(entry.method, entry.body), context)
      .then((response) => response, (error: unknown) => error);
    // Часть маршрутов делегирует ошибку общей обёртке; остальные возвращают ответ сами.
    const outcome = await result;
    if (outcome instanceof Response) expect(outcome.status).toBe(409);
    else {
      expect(outcome).toBeInstanceOf(ServiceError);
      expect(outcome).toEqual(expect.objectContaining({ status: 409 }));
    }
    expect(m.audit).not.toHaveBeenCalled();
  });

  it('без входа нет ни записи, ни события', async () => {
    m.auth.mockResolvedValue({ user: null, error: NextResponse.json({ error: 'Войдите' }, { status: 401 }) });
    const response = await (entry.handler as Handler)(request(entry.method, entry.body), context);
    expect(response.status).toBe(401);
    expect(entry.mock).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
});

it('повторная подпись не создаёт нового события', async () => {
  m.signBriefing.mockResolvedValue({ alreadySigned: true });
  expect((await signBriefing(request('POST'), context)).status).toBe(200);
  expect(m.audit).not.toHaveBeenCalled();
});
it('повторный разбор происшествия не создаёт события', async () => {
  m.review.mockResolvedValue({ count: 0 });
  expect((await reviewIncident(request('POST', { id: 'incident-1', note: 'Повторный разбор обстоятельств' }))).status).toBe(409);
  expect(m.audit).not.toHaveBeenCalled();
});
it('неудачный retry не создаёт события', async () => {
  m.retry.mockResolvedValue(false);
  expect((await dlq(request('POST', { id: 'queue-1', action: 'retry' }))).status).toBe(400);
  expect(m.audit).not.toHaveBeenCalled();
});
it('повторное удаление вложения не создаёт события', async () => {
  m.findMedia.mockResolvedValue({ isDeleted: true });
  expect((await deleteMedia(request('DELETE'), context)).status).toBe(200);
  expect(m.deleteMedia).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
});
it('оператор не может создать топливо чужой установки и событие об этом', async () => {
  m.auth.mockResolvedValue({ user: { ...actor, role: 'OPERATOR' }, error: null });
  m.crew.mockResolvedValue({ equipmentId: 'other-rig' });
  expect((await addFuel(request('POST', { litersAdded: 80 }), context)).status).toBe(403);
  expect(m.addFuel).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
});
it('запрет доступа к вложению сохраняется и не создаёт события', async () => {
  m.accessMedia.mockImplementation(() => { throw new ServiceError('Нет доступа', 403); });
  expect((await deleteMedia(request('DELETE'), context)).status).toBe(403);
  expect(m.deleteMedia).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
});
it.each(cases.filter((entry) => entry.body !== undefined))('$label: неверные данные не создают события', async (entry) => {
  const response = await (entry.handler as Handler)(request(entry.method, {}), context);
  expect(response.status).toBe(400);
  expect(entry.mock).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
});

it.each(cases.filter((entry) => ![conductBriefing, signBriefing, deleteMedia].some((handler) => handler === entry.handler)))
  ('$label: запрет роли не создаёт записи и события', async (entry) => {
    m.can.mockImplementation(() => { throw new ServiceError('Нет права', 403); });
    await expect((entry.handler as Handler)(request(entry.method, entry.body), context)).rejects.toThrow('Нет права');
    expect(entry.mock).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

it.each(cases.filter((entry) => ![dlq, deleteMedia].some((handler) => handler === entry.handler)))
  ('$label: отсутствие организации не создаёт записи и события', async (entry) => {
    m.auth.mockResolvedValue({ user: { ...actor, tenantId: null }, error: null });
    const outcome = await (entry.handler as Handler)(request(entry.method, entry.body), context)
      .then((response) => response, (error: unknown) => error);
    if (outcome instanceof Response) expect(outcome.status).toBe(400);
    else {
      expect(outcome).toBeInstanceOf(ServiceError);
      expect(outcome).toEqual(expect.objectContaining({ status: 403 }));
    }
    expect(entry.mock).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
