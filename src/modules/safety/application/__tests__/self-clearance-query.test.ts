// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';

/*
  «МОЙ ДОПУСК» ПОКАЗЫВАЕТ РЕАЛЬНОЕ СОСТОЯНИЕ ВТОРОЙ ОТМЕТКИ (аудит 16.10.2026, P1 R78-41).

  Инструктаж — встреча двоих. Инструктор ставит отметку сразу, работник — сам,
  по этой же записи. Раньше личная история не отдавала ни id записи с отметками,
  ни имени инструктора, и экран рисовал «✓» у любой строки: работник не видел,
  что инструктаж ждёт его, и подтвердить его было нечем.
*/
const mocks = vi.hoisted(() => ({userFind: vi.fn(), recordsFind: vi.fn(), clearance: vi.fn()}));
vi.mock('@/lib/db', () => ({db: {user: {findFirst: mocks.userFind}, briefingRecord: {findMany: mocks.recordsFind}}}));
vi.mock('@/modules/users', () => ({getOperatorClearance: mocks.clearance}));

import {querySelfSafetyView} from '../self-clearance-query';

const NOW = new Date('2026-10-16T08:00:00Z');
const record = (over: Record<string, unknown> = {}) => ({
  id: 'rec-1', kind: 'INSTRUCTION', recordedAt: new Date('2026-10-16T05:00:00Z'),
  documentTitle: 'Безопасность при свайных работах', documentVersion: '1.0',
  correct: null, total: null, validUntil: null,
  instructorId: null, instructorName: null, instructorSignedAt: null, employeeSignedAt: null,
  ...over,
});

const view = async (rows: Array<Record<string, unknown>>) => {
  mocks.recordsFind.mockImplementation(async (args: {take?: number}) => (args.take ? rows : []));
  return querySelfSafetyView({tenantId: 'tenant-a', userId: 'operator-a', now: NOW});
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFind.mockResolvedValue({role: 'OPERATOR'});
  mocks.clearance.mockResolvedValue({cleared: true, blockers: [], warnings: [], documents: []});
});

describe('личная история инструктажей: состояние отметок', () => {
  it('инструктаж, проведённый инженером ОТ, ждёт отметки работника и называет инструктора', async () => {
    const {history} = await view([record({
      instructorId: 'safety-1', instructorName: 'Петров П.П.',
      instructorSignedAt: new Date('2026-10-16T05:00:00Z'), employeeSignedAt: null,
    })]);

    expect(history[0]).toMatchObject({
      id: 'rec-1', awaitingEmployeeSignature: true, instructorName: 'Петров П.П.',
      employeeSignedAt: null, instructorSignedAt: '2026-10-16T05:00:00.000Z',
    });
  });

  it('когда работник подписал, запись больше ничего не ждёт', async () => {
    const {history} = await view([record({
      instructorId: 'safety-1', instructorName: 'Петров П.П.',
      instructorSignedAt: new Date('2026-10-16T05:00:00Z'), employeeSignedAt: new Date('2026-10-16T06:00:00Z'),
    })]);

    expect(history[0]).toMatchObject({awaitingEmployeeSignature: false, employeeSignedAt: '2026-10-16T06:00:00.000Z'});
  });

  it('собственное ознакомление без инструктора ничего не ждёт, даже у старой записи без отметки', async () => {
    const {history} = await view([record({instructorId: null, employeeSignedAt: null})]);

    expect(history[0]).toMatchObject({awaitingEmployeeSignature: false, instructorName: null});
  });

  it('запись, которую инструктор ещё не подписал, работник подписывать не просит', async () => {
    const {history} = await view([record({instructorId: 'safety-1', instructorSignedAt: null})]);

    expect(history[0]?.awaitingEmployeeSignature).toBe(false);
  });

  it('проверка знаний отметки работника не ждёт', async () => {
    const {history} = await view([record({kind: 'KNOWLEDGE', correct: 8, total: 8})]);

    expect(history[0]).toMatchObject({kind: 'KNOWLEDGE', result: '8 из 8', awaitingEmployeeSignature: false});
  });

  it('читает только записи самого работника из своей организации', async () => {
    await view([]);

    for (const [args] of mocks.recordsFind.mock.calls) {
      expect(args.where).toMatchObject({tenantId: 'tenant-a', userId: 'operator-a'});
    }
  });
});
