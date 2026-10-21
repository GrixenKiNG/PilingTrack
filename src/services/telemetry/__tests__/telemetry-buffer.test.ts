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
describe('буферизация', () => {
 it('складывает записи в буфер и не пишет в БД до сброса', async () => {
  await buffer.ingest(record('a', 1)); await buffer.ingest(record('a', 2));
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(buffer.getStats()).toEqual({buffered: 2, flushed: 0, dropped: 0});
  expect(buffer.getDetailedStats()).toMatchObject({buffered: 2, totalBuffered: 2, circuitBreakerState: 'CLOSED'});
 });
 it('сбрасывает буфер при достижении предельного размера', async () => {
  for (let i = 1; i < 100; i++) await buffer.ingest(record('a', i));
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(buffer.getStats()).toEqual({buffered: 99, flushed: 0, dropped: 0});
  await buffer.ingest(record('a', 100));
  expect(buffer.getStats()).toEqual({buffered: 0, flushed: 100, dropped: 0});
  expect(mocks.create).toHaveBeenCalledTimes(100);
 });
});
describe('порядок записей', () => {
 it('пишет записи в том же порядке, в каком они пришли в буфер', async () => {
  const values = [5, 3, 1, 4, 2];
  for (const value of values) await buffer.ingest(record('a', value));
  await buffer.flush();
  expect(mocks.create.mock.calls.map((call) => call[0].data.value)).toEqual(values);
 });
});
describe('переполнение при открытом предохранителе', () => {
 it('выбрасывает 25% старейших записей вместо записи в БД', async () => {
  const breaker = buffer.getCircuitBreaker();
  for (let i = 0; i < 5; i++) await breaker.execute(async () => { throw new Error('db unavailable'); }).catch(() => undefined);
  expect(breaker.getState().state).toBe('OPEN');
  for (let i = 1; i <= 100; i++) await buffer.ingest(record('a', i));
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(buffer.getStats()).toEqual({buffered: 75, flushed: 0, dropped: 25});
  breaker.reset(); await buffer.flush();
  expect(mocks.create.mock.calls.map((call) => call[0].data.value)).toEqual(Array.from({length: 75}, (_, i) => i + 26));
 });
});
describe('сброс по таймеру', () => {
 it('сбрасывает накопленное по истечении flushIntervalMs', async () => {
  vi.useFakeTimers();
  const timed = new TelemetryBuffer({maxBufferSize: 100, maxBatchSize: 2, flushIntervalMs: 1_000});
  try {
   await timed.ingest(record('a', 1)); await timed.ingest(record('a', 2));
   expect(mocks.transaction).not.toHaveBeenCalled();
   await vi.advanceTimersByTimeAsync(1_000);
   expect(timed.getStats()).toEqual({buffered: 0, flushed: 2, dropped: 0});
  } finally {
   await timed.shutdown(); vi.useRealTimers();
  }
 });
});
