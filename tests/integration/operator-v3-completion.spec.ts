// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import {createCompletionCommandRegistry} from '@/modules/operator-v3/application/commands/completion-commands';
const envelope=(payload:Record<string,unknown>,actorId='operator-1',role='OPERATOR')=>({envelope:{commandId:`cmd-${actorId}`,aggregateId:'shift-1',expectedVersion:7,deviceId:'d',deviceSequence:1,occurredAt:'2026-08-28T10:00:00Z',payload},context:{tenantId:'tenant-1',actorId,actorName:'Иванов',actorRole:role,requestId:'r',correlationId:'c'},checksum:'x'} as const);
describe('завершение и передача смены v3',()=>{
 it('запрещает самоприёмку передачи',async()=>{const tx:any={shiftHandover:{findFirst:vi.fn().mockResolvedValue({id:'h-1',shiftId:'shift-1',submittedById:'operator-1',state:'SUBMITTED',version:1})}};await expect(createCompletionCommandRegistry(tx).get('accept-handover')!.execute(envelope({handoverId:'h-1'}) as any)).rejects.toMatchObject({code:'FORBIDDEN'});});
 it('не завершает отчёт без проверки после работ',async()=>{const tx:any={shift:{findFirst:vi.fn().mockResolvedValue({id:'shift-1',tenantId:'tenant-1',state:'STARTED',version:7,equipmentId:'eq-1',startedAt:new Date()})},crew:{findFirst:vi.fn().mockResolvedValue({id:'crew-1'})},inspection:{findFirst:vi.fn().mockResolvedValue(null)},reportDowntime:{findFirst:vi.fn().mockResolvedValue(null)}};await expect(createCompletionCommandRegistry(tx).get('complete-report')!.execute(envelope({endingEngineHours:101}) as any)).rejects.toMatchObject({code:'REQUIRED_ACTION_INCOMPLETE'});});
});
