// @vitest-environment node

import {describe, expect, it, vi} from 'vitest';
import type {OperatorCommandAdapterInput} from '@/modules/operator-v3/application/commands/operator-command-registry';
import {createProductionCommandRegistry} from '@/modules/operator-v3/application/commands/production-commands';

const input = (payload: Record<string, unknown>, commandId: string): OperatorCommandAdapterInput => ({
  envelope: {commandId, aggregateId: 'shift-1', expectedVersion: 7, deviceId: 'tablet-1', deviceSequence: 1,
    occurredAt: '2026-08-27T09:00:00.000Z', payload},
  context: {tenantId: 'tenant-1', actorId: 'operator-1', actorName: 'Иванов И.И.', actorRole: 'OPERATOR',
    requestId: 'request-1', correlationId: 'correlation-1'},
  checksum: 'checksum-1',
});

function fakeTransaction() {
  const shift = {id: 'shift-1', tenantId: 'tenant-1', equipmentId: 'equipment-1', productionDate: new Date('2026-08-27'), type: 'DAY', state: 'STARTED', version: 7};
  const reports: any[] = [];
  const piles: any[] = [];
  const drillings: any[] = [];
  const intervals: any[] = [];
  const outbox: any[] = [];
  const tx: any = {
    $executeRaw: vi.fn().mockResolvedValue(1), $queryRaw: vi.fn().mockResolvedValue([{lastSequence: BigInt(0), headHash: null}]),
    auditLog: {create: vi.fn(async ({data}: any) => data)}, tenantAuditChain: {updateMany: vi.fn().mockResolvedValue({count: 1})},
    crew: {findFirst: vi.fn().mockResolvedValue({id: 'crew-1', siteId: 'site-1', equipmentId: 'equipment-1'})},
    shift: {findFirst: vi.fn().mockImplementation(async () => ({...shift})), updateMany: vi.fn(async ({where}: any) => {
      if (where.version !== shift.version) return {count: 0}; shift.version += 1; return {count: 1};
    })},
    safetyIncident: {findFirst: vi.fn().mockResolvedValue(null)},
    report: {findFirst: vi.fn(async () => reports[0] ?? null), create: vi.fn(async ({data}: any) => {
      const row = {id: 'report-1', ...data}; reports.push(row); return row;
    })},
    pileGrade: {findFirst: vi.fn().mockResolvedValue({id: 'pile-1', name: 'Свая 12 м'})},
    drillingType: {findFirst: vi.fn().mockResolvedValue({id: 'work-1', name: 'Лидерное бурение'})},
    picket: {findFirst: vi.fn().mockResolvedValue({id: 'picket-1', name: 'Пикет 1'})},
    pileWork: {findUnique: vi.fn(async ({where}: any) => piles.find((row) => row.clientCommandId === where.tenantId_clientCommandId.clientCommandId) ?? null),
      create: vi.fn(async ({data}: any) => {const row={id:`pile-row-${piles.length+1}`,...data}; piles.push(row); return row;})},
    leaderDrilling: {create: vi.fn(async ({data}: any) => {const row={id:`drill-${drillings.length+1}`,...data}; drillings.push(row); return row;})},
    reportDowntime: {
      findUnique: vi.fn(async ({where}: any) => intervals.find((row) => row.clientCommandId === where.tenantId_clientCommandId.clientCommandId) ?? null),
      findFirst: vi.fn(async ({where}: any) => intervals.find((row) => row.shiftId === where.shiftId && row.status === 'OPEN') ?? null),
      create: vi.fn(async ({data}: any) => {const row={id:`interval-${intervals.length+1}`,version:1,...data}; intervals.push(row); return row;}),
      updateMany: vi.fn(async ({where,data}: any) => {const row=intervals.find((item) => item.id===where.id && item.status==='OPEN'); if(!row)return {count:0}; Object.assign(row,data,{version:row.version+1}); return {count:1};}),
    },
    outboxEvent: {createMany: vi.fn(async ({data}: any) => {outbox.push(...data); return {count:data.length};})},
  };
  return {tx, shift, reports, piles, drillings, intervals, outbox};
}

describe('производство и интервалы оператора v3', () => {
  it('сохраняет производственную строку один раз вместе с аудитом и outbox', async () => {
    const state = fakeTransaction(); const execute = createProductionCommandRegistry(state.tx).get('record-production')!.execute;
    const command = input({pileId:'pile-1',picketId:'picket-1',workTypeId:'work-1',depth:12,startedAt:'2026-08-27T08:00:00.000Z',endedAt:'2026-08-27T08:30:00.000Z',result:'Выполнено'}, 'prod-1');
    const first = await execute(command); command.envelope.expectedVersion = 8; const replay = await execute(command);
    expect(first.createdEvents).toEqual(['Производственная работа сохранена']);
    expect(replay.createdEvents).toEqual(['Производственная работа уже сохранена']);
    expect(state.piles).toHaveLength(1); expect(state.drillings).toHaveLength(1);
    expect(state.piles[0]).toMatchObject({tenantId:'tenant-1',shiftId:'shift-1',clientCommandId:'prod-1'});
    expect(state.outbox).toHaveLength(1);
  });

  it('не допускает производство при требовании остановки', async () => {
    const state = fakeTransaction(); state.tx.safetyIncident.findFirst.mockResolvedValue({id:'incident-1',state:'STOP_REQUIRED'});
    await expect(createProductionCommandRegistry(state.tx).get('record-production')!.execute(input({pileId:'pile-1',workTypeId:'work-1',depth:1,startedAt:'2026-08-27T08:00:00.000Z',endedAt:'2026-08-27T08:10:00.000Z',result:'Выполнено'},'prod-stop'))).rejects.toMatchObject({code:'INVALID_TRANSITION'});
    expect(state.piles).toHaveLength(0);
  });

  it('не открывает второй интервал и считает длительность на сервере', async () => {
    const state = fakeTransaction(); const registry = createProductionCommandRegistry(state.tx);
    await registry.get('start-downtime')!.execute(input({kind:'DOWNTIME',reason:'Отказ гидравлики',category:'TECHNICAL'},'interval-start'));
    const second = input({kind:'BREAK'},'interval-second'); second.envelope.expectedVersion=8;
    await expect(registry.get('start-break')!.execute(second)).rejects.toMatchObject({code:'INVALID_TRANSITION'});
    const finish = input({},'interval-finish'); finish.envelope.expectedVersion=8; finish.envelope.occurredAt='2026-08-27T09:05:42.000Z';
    await registry.get('finish-interval')!.execute(finish);
    expect(state.intervals[0]).toMatchObject({status:'CLOSED',durationSeconds:342});
  });
});
