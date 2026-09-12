import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({create: vi.fn(), transaction: vi.fn()}));
vi.mock('@/lib/db', () => ({db: {telemetryRecord: {create: mocks.create}, $transaction: mocks.transaction}}));
vi.mock('@/lib/logger', () => ({logger: {info: vi.fn(), error: vi.fn(), warn: vi.fn()}}));
import {TelemetryBuffer} from '../telemetry-buffer';
let buffer: TelemetryBuffer;
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockImplementation(({data}) => data); mocks.transaction.mockResolvedValue([]);
 buffer = new TelemetryBuffer({maxBufferSize: 100, maxBatchSize: 2}); });
afterEach(async () => { await buffer.shutdown(); });
const record = (tenantId: string, value: number) => ({tenantId, equipmentId: 'rig', type: 'temperature' as const, value, latitude: 0, longitude: 0});
describe('buffer recovery', () => {
 it('retains the failed batch and every unattempted batch', async () => {
  for(let i=0;i<5;i++) await buffer.ingest(record('a',i));
  mocks.transaction.mockRejectedValueOnce(new Error('database unavailable'));
  await buffer.flush(); expect(buffer.getStats()).toEqual({buffered:5,flushed:0,dropped:0});
  await buffer.flush(); expect(buffer.getStats()).toEqual({buffered:0,flushed:5,dropped:0});
  expect(mocks.create.mock.calls[0][0].data).toMatchObject({latitude:0,longitude:0});
 });
 it('does not replay a committed tenant batch after another tenant fails',async()=>{
  await buffer.ingest(record('a',1)); await buffer.ingest(record('b',2));
  mocks.transaction.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('db'));
  await buffer.flush(); expect(buffer.getStats()).toEqual({buffered:1,flushed:1,dropped:0});
  await buffer.flush(); expect(mocks.create.mock.calls.map(c=>c[0].data.tenantId)).toEqual(['a','b','b']);
 });
 it('serializes concurrent flushes and retains newly arriving records',async()=>{
  let release!:()=>void; mocks.transaction.mockImplementationOnce(()=>new Promise<void>(r=>{release=r}));
  await buffer.ingest(record('a',1)); const first=buffer.flush();
  await vi.waitFor(()=>expect(mocks.transaction).toHaveBeenCalledOnce());
  await buffer.ingest(record('a',2)); const second=buffer.flush(); release(); await Promise.all([first,second]);
  expect(buffer.getStats()).toEqual({buffered:1,flushed:1,dropped:0}); await buffer.flush();
  expect(buffer.getStats().flushed).toBe(2);
 });
});
