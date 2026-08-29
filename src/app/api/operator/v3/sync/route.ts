import {NextResponse,type NextRequest} from 'next/server';
import {withOperatorV3Command} from '../_shared/command-route';
import {synchronizeOperatorCommands} from '@/modules/operator-v3/application/sync/sync-commands';
import {operatorCommandEnvelopeSchema} from '@/modules/operator-v3/application/commands/envelope-schema';
import {
  isOperatorV3CaptureOnlyCommand,
  isOperatorV3CommandName,
} from '@/modules/operator-v3/application/commands/operator-command-registry';
import {executeOperatorCommand} from '@/modules/operator-v3/application/commands/execute-operator-command';
import {createExistingOperatorCommandRegistry} from '@/modules/operator-v3/application/commands/existing-command-adapters';
import {PrismaCommandIdempotencyRepository} from '@/modules/readiness/infrastructure/command-pipeline/idempotency-repository';
import {withReadinessSerializableTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {DeviceSyncRepository} from '@/modules/operator-v3/infrastructure/device-sync-repository';
import {OperatorCommandError} from '@/modules/operator-v3/application/commands/operator-command-errors';
import {verifyServerSignedOfflineWorkAuthorization} from '@/modules/operator-v3/domain/server-offline-work-authorization';
import type {SignedOfflineWorkAuthorization} from '@/modules/operator-v3/domain/offline-work-authorization';

type Item={route:string;attachmentIds?:string[];authorization?:unknown}&Record<string,unknown>;
async function payload(request:NextRequest):Promise<Item[]>{
  if(request.headers.get('content-type')?.includes('multipart/form-data')){
    const form=await request.formData(); const raw=form.get('command');
    if(typeof raw!=='string')throw new OperatorCommandError('VALIDATION_ERROR',422,'Не передана команда синхронизации');
    return [{...JSON.parse(raw),route:String(form.get('route')??'/api/operator/v3/commands/record-production')}];
  }
  const raw=await request.json(); return Array.isArray(raw?.commands)?raw.commands:[raw];
}

export const POST=withOperatorV3Command(async(request,context)=>{
  const rawCommands=await payload(request);
  const commands=rawCommands.map((raw)=>{
    const parsed=operatorCommandEnvelopeSchema.safeParse(raw);
    if(!parsed.success)throw new OperatorCommandError('VALIDATION_ERROR',422,'Некорректная команда синхронизации');
    const commandName=String(raw.route??'').split('/').pop()??'';
    if(!isOperatorV3CommandName(commandName))throw new OperatorCommandError('NOT_FOUND',404,'Неизвестная команда синхронизации');
    return {...parsed.data,commandName,authorization:raw.authorization as SignedOfflineWorkAuthorization|undefined,
      attachmentIds:Array.isArray(raw.attachmentIds)?raw.attachmentIds.filter((v):v is string=>typeof v==='string'):[]};
  });
  const report=await synchronizeOperatorCommands(commands,async(command)=>withReadinessSerializableTransaction(context.tenantId,async(tx)=>{
    const sequence=new DeviceSyncRepository(tx);
    const device=await sequence.requireNext(context.tenantId,context.actorId,command.deviceId,command.deviceSequence);
    if(!isOperatorV3CaptureOnlyCommand(command.commandName)){
      if(!command.authorization)throw new OperatorCommandError('FORBIDDEN',403,'Для этой команды требуется серверное разрешение на работу без связи');
      const shift=await tx.shift.findFirst({where:{tenantId:context.tenantId,id:command.aggregateId}});
      const assignment=shift?await tx.crew.findFirst({where:{operatorId:context.actorId,equipmentId:shift.equipmentId,isActive:true}}):null;
      const rules=await tx.readinessRuleSet.findFirst({where:{tenantId:context.tenantId,status:'PUBLISHED'},orderBy:{updatedAt:'desc'}});
      const key=await tx.serverOfflineAuthorizationKey.findUnique({where:{keyId:command.authorization.keyId}});
      if(!shift||!assignment)throw new OperatorCommandError('FORBIDDEN',403,'Не найдена действующая смена или назначение для автономной команды');
      const decision=verifyServerSignedOfflineWorkAuthorization(command.authorization,{
        id:device.id,tenantId:device.tenantId,operatorId:device.operatorId,keyId:device.keyId,publicKeyPem:device.publicKeyPem,
        state:device.state==='ACTIVE'?'ACTIVE':'REVOKED',registeredAt:device.registeredAt.toISOString(),revokedAt:device.revokedAt?.toISOString()??null,
      },()=>key?{keyId:key.keyId,algorithm:'Ed25519',publicKeyPem:key.publicKeyPem,state:key.state==='ACTIVE'?'ACTIVE':'REVOKED',tenantId:key.tenantId}:null,{
        tenantId:context.tenantId,operatorId:context.actorId,assignmentId:assignment.id,equipmentId:shift.equipmentId,
        shiftId:shift.id,deviceId:device.id,rulesVersion:rules?.version??'нет-опубликованных-правил',
        commandName:command.commandName,serverReceivedAt:new Date(),
      });
      if(!decision.valid)throw new OperatorCommandError('FORBIDDEN',403,decision.label,{authorityCode:decision.code});
    }
    const result=await executeOperatorCommand({commandName:command.commandName,envelope:command,idempotencyKey:command.commandId,
      ifMatch:`"shift-${command.aggregateId}-v${command.expectedVersion}"`,context,
      repository:new PrismaCommandIdempotencyRepository(tx),registry:createExistingOperatorCommandRegistry(tx),readWorkplace:async()=>null});
    const confirmed=command.attachmentIds.length?await tx.media.findMany({where:{id:{in:command.attachmentIds},tenantId:context.tenantId,userId:context.actorId,uploadStatus:'completed',isDeleted:false},select:{id:true}}):[];
    await sequence.accept(device.id,device.lastAcceptedSequence);
    return {...result,confirmedAttachmentIds:confirmed.map(item=>item.id)};
  }));
  return NextResponse.json({...report,confirmedAttachmentIds:report.results.flatMap(item=>item.status==='CONFIRMED'&&item.data&&typeof item.data==='object'&&'confirmedAttachmentIds' in item.data?(item.data as {confirmedAttachmentIds:string[]}).confirmedAttachmentIds:[])},{status:200});
},{domain:'operator-v3-sync',rateLimit:{maxAttempts:20,windowMs:60_000,blockDurationMs:60_000}});
