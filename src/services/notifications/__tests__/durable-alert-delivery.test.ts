import {beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({send:vi.fn(),enabled:vi.fn(),find:vi.fn(),update:vi.fn(),lock:vi.fn(),create:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{$transaction:async(fn:(tx:unknown)=>Promise<void>)=>fn({$queryRaw:m.lock,outboxEvent:{findFirst:m.find,update:m.update}})}}));
vi.mock('@/core/notifications/telegram',()=>({telegramNotifier:{sendAlert:m.send}}));
vi.mock('@/modules/settings',()=>({isNotificationEnabled:m.enabled}));
import {deliverQueuedAlert} from '../durable-alert-delivery';
import {enqueueCriticalDefects} from '@/core/notifications/durable-alert';
const event={id:'event-1',tenantId:'tenant-a',data:{severity:'critical',message:'Stop machine',ruleId:'criticalDefect'}};
beforeEach(()=>{vi.clearAllMocks();m.find.mockResolvedValue({id:'event-1',published:false});m.send.mockResolvedValue(true);m.enabled.mockResolvedValue(true)});
describe('durable alert delivery',()=>{
 it('propagates false so the outbox retries rather than marking published',async()=>{m.send.mockResolvedValue(false);await expect(deliverQueuedAlert(event)).rejects.toThrow('retained');expect(m.update).not.toHaveBeenCalled()});
 it('marks delivery only after a successful send and locks the tenant row',async()=>{await deliverQueuedAlert(event);expect(m.lock).toHaveBeenCalled();expect(m.find).toHaveBeenCalledWith({where:{id:event.id,tenantId:event.tenantId}});expect(m.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({published:true})}));expect(m.send).toHaveBeenCalledWith(expect.objectContaining({message:expect.stringContaining(event.id)}))});
 it('does not send an already published event again',async()=>{m.find.mockResolvedValue({id:'event-1',published:true});await deliverQueuedAlert(event);expect(m.send).not.toHaveBeenCalled()});
 it('respects a disabled critical-defect notification',async()=>{m.enabled.mockResolvedValue(false);await deliverQueuedAlert(event);expect(m.send).not.toHaveBeenCalled();expect(m.update).toHaveBeenCalled()});
 it('enqueues critical defects into the caller transaction',async()=>{const tx={outboxEvent:{create:m.create}};await enqueueCriticalDefects(tx as never,{tenantId:'a',aggregateId:'d',equipmentId:'rig',reportedBy:'operator',defects:[{severity:'CRITICAL',title:'brake failure'}]});expect(m.create).toHaveBeenCalledWith({data:expect.objectContaining({type:'NotificationDeliveryRequested',tenantId:'a',projected:true,payload:expect.objectContaining({severity:'critical'})})});});
});
