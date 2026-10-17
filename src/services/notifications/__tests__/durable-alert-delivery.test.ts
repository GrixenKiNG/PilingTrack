import {beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({send:vi.fn(),enabled:vi.fn(),find:vi.fn(),update:vi.fn(),lock:vi.fn(),create:vi.fn(),inTx:false,enabledInsideTx:false,redisClient:vi.fn(),redisGet:vi.fn(),redisSet:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{$transaction:async(fn:(tx:unknown)=>Promise<void>)=>{m.inTx=true;try{return await fn({$queryRaw:m.lock,outboxEvent:{findFirst:m.find,update:m.update}})}finally{m.inTx=false}}}}));
vi.mock('@/core/notifications/telegram',()=>({telegramNotifier:{sendAlert:m.send}}));
vi.mock('@/lib/redis-cache',()=>({getRedisClient:m.redisClient}));
vi.mock('@/lib/logger',()=>({logger:{warn:vi.fn(),error:vi.fn(),info:vi.fn()}}));
vi.mock('@/modules/settings',()=>({isNotificationEnabled:m.enabled}));
import {deliverQueuedAlert} from '../durable-alert-delivery';
import {enqueueCriticalDefects} from '@/core/notifications/durable-alert';
const event={id:'event-1',tenantId:'tenant-a',data:{severity:'critical',message:'Stop machine',ruleId:'criticalDefect'}};
beforeEach(()=>{vi.clearAllMocks();m.inTx=false;m.enabledInsideTx=false;m.find.mockResolvedValue({id:'event-1',published:false});m.send.mockResolvedValue(true);m.enabled.mockResolvedValue(true)});
describe('durable alert delivery',()=>{
 it('propagates false so the outbox retries rather than marking published',async()=>{m.send.mockResolvedValue(false);await expect(deliverQueuedAlert(event)).rejects.toThrow('retained');expect(m.update).not.toHaveBeenCalled()});
 it('marks delivery only after a successful send and locks the tenant row',async()=>{await deliverQueuedAlert(event);expect(m.lock).toHaveBeenCalled();expect(m.find).toHaveBeenCalledWith({where:{id:event.id,tenantId:event.tenantId}});expect(m.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({published:true})}));expect(m.send).toHaveBeenCalledWith(expect.objectContaining({message:expect.stringContaining(event.id)}),expect.objectContaining({confirm:expect.any(Function)}))});
 it('does not send an already published event again',async()=>{m.find.mockResolvedValue({id:'event-1',published:true});await deliverQueuedAlert(event);expect(m.send).not.toHaveBeenCalled()});
 it('respects a disabled critical-defect notification',async()=>{m.enabled.mockResolvedValue(false);await deliverQueuedAlert(event);expect(m.send).not.toHaveBeenCalled();expect(m.update).toHaveBeenCalled()});
 it('reads the notification switch outside the transaction (R85 §2)',async()=>{
  m.enabled.mockImplementation(async()=>{m.enabledInsideTx=m.inTx;return true});
  await deliverQueuedAlert(event);
  expect(m.enabled).toHaveBeenCalledWith('tenant-a','criticalDefect');
  expect(m.enabledInsideTx).toBe(false);
  expect(m.send).toHaveBeenCalled();
 });
 it('suppresses an incident by the incidents key, not by criticalDefect',async()=>{
  m.enabled.mockImplementation(async(_t:string,key:string)=>key==='criticalDefect');
  const incident={id:'event-2',tenantId:'tenant-a',data:{severity:'high',message:'Происшествие: требуется прекратить работы',ruleId:'incident'}};
  await deliverQueuedAlert(incident);
  expect(m.enabled).toHaveBeenCalledWith('tenant-a','incidents');
  expect(m.send).not.toHaveBeenCalled();
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({published:true})}));
 });
 it('sends a stop-work incident even when incidents are switched off',async()=>{
  m.enabled.mockResolvedValue(false);
  const urgent={id:'event-4',tenantId:'tenant-a',data:{severity:'critical',message:'Происшествие: требуется прекратить работы',ruleId:'incidentStopWork'}};
  await deliverQueuedAlert(urgent);
  expect(m.enabled).not.toHaveBeenCalled();
  expect(m.send).toHaveBeenCalled();
 });
 it('sends an old-format critical incident even when incidents are switched off',async()=>{
  m.enabled.mockResolvedValue(false);
  const queued={id:'event-5',tenantId:'tenant-a',data:{severity:'critical',message:'Происшествие: требуется прекратить работы',ruleId:'incident'}};
  await deliverQueuedAlert(queued);
  expect(m.enabled).not.toHaveBeenCalled();
  expect(m.send).toHaveBeenCalled();
 });
 it('sends an alert whose rule has no switch of its own',async()=>{
  const other={id:'event-3',tenantId:'tenant-a',data:{severity:'low',message:'Прочее',ruleId:'unknownRule'}};
  await deliverQueuedAlert(other);
  expect(m.enabled).not.toHaveBeenCalled();
  expect(m.send).toHaveBeenCalled();
 });
 it('enqueues critical defects into the caller transaction',async()=>{const tx={outboxEvent:{create:m.create}};await enqueueCriticalDefects(tx as never,{tenantId:'a',aggregateId:'d',equipmentId:'rig',reportedBy:'operator',defects:[{severity:'CRITICAL',title:'brake failure'}]});expect(m.create).toHaveBeenCalledWith({data:expect.objectContaining({type:'NotificationDeliveryRequested',tenantId:'a',projected:true,payload:expect.objectContaining({severity:'critical'})})});});
});

it('I08: partial receipts commit before retry; confirmed recipients survive another attempt', async () => {
  let row = { id: event.id, published: false, payload: { severity: 'critical', message: 'batch' } as Record<string, unknown> };
  m.find.mockImplementation(async () => row);
  m.update.mockImplementation(async ({ data }) => { row = { ...row, ...data }; });
  m.send.mockImplementationOnce(async (_alert, progress) => { await progress.confirm('A'); return false; });
  await expect(deliverQueuedAlert(event)).rejects.toThrow('retained');
  expect(m.inTx).toBe(false);
  expect(row.published).toBe(false);
  expect(row.payload).toMatchObject({ telegramDeliveredChatIds: ['A'] });
  m.send.mockImplementationOnce(async (_alert, progress) => {
    expect([...progress.deliveredChatIds]).toEqual(['A']);
    await progress.confirm('B'); return true;
  });
  await deliverQueuedAlert(event);
  expect(row.published).toBe(true);
  expect(row.payload).toMatchObject({ telegramDeliveredChatIds: ['A', 'B'] });
});

it('I08: queued Alertmanager notifications use systemAlerts, not a matching domain rule name', async () => {
  const queued = { ...event, data: { ...event.data, notificationKey: 'systemAlerts' } };
  await deliverQueuedAlert(queued);
  expect(m.enabled).toHaveBeenCalledWith(event.tenantId, 'systemAlerts');
});

/*
  F-R33-2 + F7: дедуп алерта о простое переехал сюда вместе с отправкой.
  Ключ Redis читается до отправки, ставится только после успешной отправки,
  при недоступном Redis шлём без дедупа (дубль лучше молчания).
*/
describe('durable alert: дедуп по ключу Redis', () => {
  const key = 'alert:downtime:tenant-a:RM-1:reason-1:3';
  const downtime = {
    id: 'event-6', tenantId: 'tenant-a',
    data: {
      severity: 'medium', message: 'Простой 3 ч зафиксирован в отчёте', reportId: 'RM-1', siteId: 'site-1',
      siteName: 'Северный', reportNumber: 'RM-1', timeZone: 'Asia/Krasnoyarsk',
      notificationKey: 'downtime30', dedupeKey: key,
    },
  };
  const sent = new Map<string, string>();

  beforeEach(() => {
    sent.clear();
    m.redisGet.mockImplementation(async (k: string) => sent.get(k) ?? null);
    m.redisSet.mockImplementation(async (k: string, v: string) => { sent.set(k, v); return 'OK'; });
    m.redisClient.mockResolvedValue({ get: m.redisGet, set: m.redisSet });
    m.find.mockResolvedValue({ id: 'event-6', published: false });
  });

  it('передаёт в Telegram название объекта, номер отчёта и часовой пояс', async () => {
    await deliverQueuedAlert(downtime);
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({
      siteName: 'Северный', reportNumber: 'RM-1', timeZone: 'Asia/Krasnoyarsk',
    }), expect.anything());
  });

  it('проверяет признак «Простой» по ключу downtime30', async () => {
    await deliverQueuedAlert(downtime);
    expect(m.enabled).toHaveBeenCalledWith('tenant-a', 'downtime30');
  });

  it('выключенный признак: не шлёт, ключ не ставит, строку закрывает', async () => {
    m.enabled.mockResolvedValue(false);
    await deliverQueuedAlert(downtime);
    expect(m.send).not.toHaveBeenCalled();
    expect(m.redisSet).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ published: true }) }));
  });

  it('ставит ключ на 48 ч только после успешной отправки', async () => {
    m.send.mockResolvedValue(false);
    await expect(deliverQueuedAlert(downtime)).rejects.toThrow('retained');
    expect(m.redisSet).not.toHaveBeenCalled();

    m.send.mockResolvedValue(true);
    await deliverQueuedAlert(downtime);
    expect(m.redisSet).toHaveBeenCalledWith(key, '1', 'EX', 48 * 60 * 60);
  });

  it('тот же простой уже отправлен: повторно не шлёт, строку закрывает', async () => {
    sent.set(key, '1');
    await deliverQueuedAlert(downtime);
    expect(m.send).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ published: true }) }));
  });

  it('при недоступном Redis шлёт без дедупа', async () => {
    m.redisClient.mockResolvedValue(null);
    await deliverQueuedAlert(downtime);
    expect(m.send).toHaveBeenCalledTimes(1);
  });

  it('сбой чтения ключа не глушит алерт', async () => {
    m.redisGet.mockRejectedValue(new Error('redis down'));
    await deliverQueuedAlert(downtime);
    expect(m.send).toHaveBeenCalledTimes(1);
  });

  it('алерт без ключа дедупа Redis не трогает', async () => {
    await deliverQueuedAlert(event);
    expect(m.redisClient).not.toHaveBeenCalled();
  });

  it('повтор уже опубликованной строки не шлёт и ключ не ставит', async () => {
    m.find.mockResolvedValue({ id: 'event-6', published: true });
    await deliverQueuedAlert(downtime);
    expect(m.send).not.toHaveBeenCalled();
    expect(m.redisSet).not.toHaveBeenCalled();
  });
});
