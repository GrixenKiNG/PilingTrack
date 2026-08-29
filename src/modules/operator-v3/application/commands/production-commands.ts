import type {Prisma} from '@/generated/postgres-client/client';
import type {AuditJsonValue} from '@/modules/readiness/domain/audit/types';
import {recordChainedReadinessAudit} from '@/modules/readiness/infrastructure/audit/record-audit';
import type {ReadinessTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {finishWorkInterval, startWorkInterval, WorkIntervalError, type WorkIntervalKind} from '../../domain/work-interval';
import {WorkIntervalRepository} from '../../infrastructure/work-interval-repository';
import {OperatorCommandError} from './operator-command-errors';
import type {OperatorCommandAdapterInput, OperatorCommandAdapterResult, OperatorCommandRegistry, OperatorV3CommandName} from './operator-command-registry';

const json = (value: unknown): AuditJsonValue => JSON.parse(JSON.stringify(value)) as AuditJsonValue;
const text = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};
const requiredText = (payload: Record<string, unknown>, key: string, label: string): string => {
  const value = text(payload, key);
  if (!value) throw new OperatorCommandError('VALIDATION_ERROR', 422, `Не заполнено обязательное поле «${label}»`);
  return value;
};
const dateField = (payload: Record<string, unknown>, key: string, label: string): Date => {
  const raw = requiredText(payload, key, label); const value = new Date(raw);
  if (!Number.isFinite(value.getTime())) throw new OperatorCommandError('VALIDATION_ERROR', 422, `Поле «${label}» содержит неверную дату`);
  return value;
};

async function activeShift(tx: ReadinessTransaction, input: OperatorCommandAdapterInput) {
  const shiftId = input.envelope.aggregateId ?? text(input.envelope.payload, 'shiftId');
  if (!shiftId) throw new OperatorCommandError('VALIDATION_ERROR', 422, 'Не указана смена');
  const shift = await tx.shift.findFirst({where: {tenantId: input.context.tenantId, id: shiftId}});
  if (!shift) throw new OperatorCommandError('NOT_FOUND', 404, 'Смена не найдена');
  const assignment = await tx.crew.findFirst({where: {operatorId: input.context.actorId, equipmentId: shift.equipmentId, isActive: true, equipment: {tenantId: input.context.tenantId}}, select: {id:true,siteId:true,equipmentId:true}});
  if (!assignment) throw new OperatorCommandError('FORBIDDEN', 403, 'Эта смена не назначена оператору');
  if (shift.state !== 'STARTED') throw new OperatorCommandError('INVALID_TRANSITION', 409, 'Производственные действия разрешены только в начатой смене');
  if (shift.version !== input.envelope.expectedVersion) throw new OperatorCommandError('VERSION_CONFLICT', 409, 'Смена изменилась. Обновите рабочее место и повторите действие', {currentVersion: shift.version});
  const stop = await tx.safetyIncident.findFirst({where: {tenantId: input.context.tenantId, shiftId, state: {in: ['STOP_REQUIRED','STOPPED']}}});
  if (stop) throw new OperatorCommandError('INVALID_TRANSITION', 409, 'Производственные действия заблокированы до разрешения остановки');
  return {shift, assignment};
}

async function reportForShift(tx: ReadinessTransaction, input: OperatorCommandAdapterInput, shift: Awaited<ReturnType<typeof activeShift>>['shift'], assignment: Awaited<ReturnType<typeof activeShift>>['assignment']) {
  const existing = await tx.report.findFirst({where: {tenantId: input.context.tenantId, shiftId: shift.id}, orderBy: {updatedAt:'desc'}});
  if (existing) return existing;
  return tx.report.create({data: {
    tenantId: input.context.tenantId, reportId: `operator-v3-${shift.id}`, userId: input.context.actorId,
    crewId: assignment.id, equipmentId: shift.equipmentId, siteId: assignment.siteId,
    date: shift.productionDate.toISOString().slice(0,10), shiftType: shift.type,
    status: 'draft', shiftId: shift.id, lastEditedById: input.context.actorId,
    lastEditedByName: input.context.actorName, lastEditedByRole: input.context.actorRole,
  }});
}

async function advance(tx: ReadinessTransaction, input: OperatorCommandAdapterInput, shiftId: string): Promise<number> {
  const changed = await tx.shift.updateMany({where: {tenantId: input.context.tenantId,id:shiftId,version:input.envelope.expectedVersion,state:'STARTED'}, data:{version:{increment:1},lastEditedById:input.context.actorId}});
  if (changed.count !== 1) throw new OperatorCommandError('VERSION_CONFLICT',409,'Смена изменилась. Обновите рабочее место и повторите действие');
  return input.envelope.expectedVersion + 1;
}

async function effects(tx: ReadinessTransaction, name: OperatorV3CommandName, input: OperatorCommandAdapterInput, entityType: string, entityId: string, version: number, result: unknown) {
  const occurredAt = new Date(input.envelope.occurredAt);
  await recordChainedReadinessAudit(tx,{tenantId:input.context.tenantId,action:`operator-v3.${name}`,entityType,entityId,entityVersion:version,actor:{id:input.context.actorId,name:input.context.actorName,role:input.context.actorRole,actingAs:null},requestId:input.context.requestId,correlationId:input.context.correlationId,idempotencyKey:input.envelope.commandId,occurredAt,after:json(result)});
  await tx.outboxEvent.createMany({skipDuplicates:true,data:[{type:name==='record-production'?'OperatorV3ProductionRecorded':'OperatorV3WorkIntervalChanged',tenantId:input.context.tenantId,aggregateId:entityId,aggregateType:entityType,dedupeKey:`operator-v3:${input.context.tenantId}:${input.envelope.commandId}`,occurredAt,payload:{commandName:name,commandId:input.envelope.commandId,shiftId:input.envelope.aggregateId,entityVersion:version} as Prisma.InputJsonValue}]});
}

async function recordProduction(tx: ReadinessTransaction,input:OperatorCommandAdapterInput):Promise<OperatorCommandAdapterResult>{
  const existing=await tx.pileWork.findUnique({where:{tenantId_clientCommandId:{tenantId:input.context.tenantId,clientCommandId:input.envelope.commandId}}});
  if(existing)return {newVersion:input.envelope.expectedVersion,createdEvents:['Производственная работа уже сохранена']};
  const {shift,assignment}=await activeShift(tx,input); const intervals=new WorkIntervalRepository(tx);
  if(await intervals.open(input.context.tenantId,shift.id))throw new OperatorCommandError('INVALID_TRANSITION',409,'Сначала завершите текущий перерыв или простой');
  const pileId=requiredText(input.envelope.payload,'pileId','Тип сваи'); const workTypeId=requiredText(input.envelope.payload,'workTypeId','Вид работы');
  const depth=input.envelope.payload.depth; if(typeof depth!=='number'||!Number.isFinite(depth)||depth<=0)throw new OperatorCommandError('VALIDATION_ERROR',422,'Глубина должна быть положительным числом');
  const startedAt=dateField(input.envelope.payload,'startedAt','Начало работы'); const endedAt=dateField(input.envelope.payload,'endedAt','Окончание работы');
  if(endedAt<=startedAt)throw new OperatorCommandError('VALIDATION_ERROR',422,'Окончание работы должно быть позже начала');
  const [pile,workType]=await Promise.all([tx.pileGrade.findFirst({where:{tenantId:input.context.tenantId,id:pileId,isActive:true}}),tx.drillingType.findFirst({where:{tenantId:input.context.tenantId,id:workTypeId,isActive:true}})]);
  if(!pile)throw new OperatorCommandError('NOT_FOUND',404,'Тип сваи не найден'); if(!workType)throw new OperatorCommandError('NOT_FOUND',404,'Вид работы не найден');
  const picketId=text(input.envelope.payload,'picketId'); if(picketId&&!await tx.picket.findFirst({where:{id:picketId}}))throw new OperatorCommandError('NOT_FOUND',404,'Пикет не найден');
  const report=await reportForShift(tx,input,shift,assignment); const occurredAt=new Date(input.envelope.occurredAt); const receivedAt=new Date();
  const row=await tx.pileWork.create({data:{reportId:report.id,tenantId:input.context.tenantId,shiftId:shift.id,clientCommandId:input.envelope.commandId,picketId,pileGradeId:pileId,count:1,workTypeId,depth,workStartedAt:startedAt,workEndedAt:endedAt,result:requiredText(input.envelope.payload,'result','Результат'),comment:text(input.envelope.payload,'comment'),correctionReason:text(input.envelope.payload,'correctionReason'),occurredAt,receivedAt}});
  await tx.leaderDrilling.create({data:{reportId:report.id,tenantId:input.context.tenantId,shiftId:shift.id,clientCommandId:input.envelope.commandId,picketId,typeId:workTypeId,count:1,metersPerUnit:depth,meters:depth,occurredAt,receivedAt}});
  const version=await advance(tx,input,shift.id); await effects(tx,'record-production',input,'PileWork',row.id,version,{reportId:report.id,depth});
  return {newVersion:version,createdEvents:['Производственная работа сохранена']};
}

function intervalFailure(error:unknown):never{if(error instanceof WorkIntervalError)throw new OperatorCommandError('INVALID_TRANSITION',409,error.message); throw error;}
async function startInterval(tx:ReadinessTransaction,input:OperatorCommandAdapterInput,kind:WorkIntervalKind):Promise<OperatorCommandAdapterResult>{
  const repo=new WorkIntervalRepository(tx); const prior=await repo.byCommand(input.context.tenantId,input.envelope.commandId); if(prior)return {newVersion:input.envelope.expectedVersion,createdEvents:['Интервал уже начат']};
  const {shift,assignment}=await activeShift(tx,input); const report=await reportForShift(tx,input,shift,assignment); const open=await repo.open(input.context.tenantId,shift.id);
  try{const interval=startWorkInterval({id:`operator-interval-${input.envelope.commandId}`,tenantId:input.context.tenantId,shiftId:shift.id,clientCommandId:input.envelope.commandId,kind,shiftState:'ACTIVE',workAllowed:true,startedAt:new Date(input.envelope.occurredAt),receivedAt:new Date(),reason:text(input.envelope.payload,'reason'),category:text(input.envelope.payload,'category'),comment:text(input.envelope.payload,'comment')},open?[open]:[]); await repo.create(report.id,interval); const version=await advance(tx,input,shift.id); await effects(tx,kind==='BREAK'?'start-break':'start-downtime',input,'ReportDowntime',interval.id,version,{kind}); return {newVersion:version,createdEvents:[kind==='BREAK'?'Перерыв начат':'Простой начат']};}catch(error){return intervalFailure(error);}
}
async function finishInterval(tx:ReadinessTransaction,input:OperatorCommandAdapterInput):Promise<OperatorCommandAdapterResult>{
  const {shift}=await activeShift(tx,input); const repo=new WorkIntervalRepository(tx); const open=await repo.open(input.context.tenantId,shift.id); if(!open)throw new OperatorCommandError('INVALID_TRANSITION',409,'Нет открытого перерыва или простоя');
  const requested=text(input.envelope.payload,'intervalId'); if(requested&&requested!==open.id)throw new OperatorCommandError('VERSION_CONFLICT',409,'Открытый интервал изменился. Обновите рабочее место');
  try{const closed=finishWorkInterval(open,new Date(input.envelope.occurredAt)); await repo.close(closed); const version=await advance(tx,input,shift.id); await effects(tx,'finish-interval',input,'ReportDowntime',closed.id,version,{durationSeconds:closed.durationSeconds}); return {newVersion:version,createdEvents:['Интервал завершён']};}catch(error){return intervalFailure(error);}
}

export function createProductionCommandRegistry(tx:ReadinessTransaction):OperatorCommandRegistry{return new Map([
  ['record-production',{critical:false,execute:(input)=>recordProduction(tx,input)}],
  ['start-break',{critical:true,execute:(input)=>startInterval(tx,input,'BREAK')}],
  ['start-downtime',{critical:true,execute:(input)=>startInterval(tx,input,'DOWNTIME')}],
  ['finish-interval',{critical:true,execute:(input)=>finishInterval(tx,input)}],
]);}
