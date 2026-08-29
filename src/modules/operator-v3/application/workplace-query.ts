import {getOperatorShiftFacts} from '@/modules/readiness/application/operator-shift-query';
import {db} from '@/lib/db';
import {resolveOperatorWorkplace} from '../domain/resolve-operator-workplace';
import type {OperatorWorkplaceSnapshot} from '../domain/contracts';
import {
  isHazardSeverity,
  isObservedHazardSign,
  isSafetyIncidentState,
} from '../domain/safety-incident';

export interface OperatorWorkplaceQuery {
  tenantId: string;
  operatorId: string;
  operatorName: string;
}

export async function queryOperatorWorkplace(
  query: OperatorWorkplaceQuery,
): Promise<OperatorWorkplaceSnapshot> {
  const facts = await getOperatorShiftFacts(query.tenantId, query.operatorId);
  const [incidentRows, defectRows] = facts.equipment
    ? await Promise.all([
        db.safetyIncident.findMany({
          where: {
            tenantId: query.tenantId,
            equipmentId: facts.equipment.id,
            ...(facts.shift ? {OR: [{shiftId: facts.shift.id}, {shiftId: null}]} : {}),
          },
          orderBy: {occurredAt: 'desc'},
          take: 20,
        }),
        db.equipmentDefect.findMany({
          where: {tenantId: query.tenantId, equipmentId: facts.equipment.id, status: {in: ['OPEN', 'IN_WORK']}},
          orderBy: {reportedAt: 'desc'},
          take: 20,
        }),
      ])
    : [[], []];
  const safetyIncidents = incidentRows.map((incident) => {
    const rawSigns = Array.isArray(incident.observedSigns) ? incident.observedSigns : [];
    const rawEvidence = Array.isArray(incident.evidenceMediaIds) ? incident.evidenceMediaIds : [];
    return {
      id: incident.id,
      state: isSafetyIncidentState(incident.state) ? incident.state : 'STOP_REQUIRED' as const,
      category: incident.category,
      severity: isHazardSeverity(incident.severity) ? incident.severity : 'CRITICAL' as const,
      description: incident.description,
      observedSigns: rawSigns.filter((value): value is string => typeof value === 'string')
        .filter(isObservedHazardSign),
      stopRequired: incident.stopRequired || !isSafetyIncidentState(incident.state),
      evidenceMediaIds: rawEvidence.filter((value): value is string => typeof value === 'string'),
      occurredAt: incident.occurredAt.toISOString(),
      stoppedAt: incident.stoppedAt?.toISOString() ?? null,
    };
  });
  const workplace = resolveOperatorWorkplace(facts, {
    operatorId: query.operatorId,
    operatorName: query.operatorName,
    safetyIncidents,
    ...(await productionContext(query.tenantId, facts)),
  });
  workplace.defects = defectRows.map((defect) => ({
    id: defect.id,
    severity: defect.severity,
    status: defect.status,
    title: defect.title,
    description: defect.description,
    observedSigns: Array.isArray(defect.observedSigns)
      ? defect.observedSigns.filter((value): value is string => typeof value === 'string')
      : [],
    evidenceMediaIds: Array.isArray(defect.evidenceMediaIds)
      ? defect.evidenceMediaIds.filter((value): value is string => typeof value === 'string')
      : [],
    reportedAt: defect.reportedAt.toISOString(),
  }));
  const stoppedIncident = incidentRows.find((item) => item.state === 'STOPPED');
  if (stoppedIncident) {
    const repair = await db.repairVerification.findUnique({
      where: {tenantId_incidentId: {tenantId: query.tenantId, incidentId: stoppedIncident.id}},
    });
    if (repair) {
      const current = facts.equipment ? await db.currentReadiness.findFirst({where:{tenantId:query.tenantId,equipmentId:facts.equipment.id}}) : null;
      const currentAfterCheck = Boolean(repair.verifiedAt && current && current.calculatedAt > repair.verifiedAt);
      const canResume = repair.verificationStatus === 'PASSED' && currentAfterCheck && current?.status === 'READY'
        && (current.verdict === 'ALLOWED' || current.verdict === 'ALLOWED_WITH_NOTES');
      workplace.maintenance = {
        incidentId: stoppedIncident.id,
        repairStatus: repair.repairStatus === 'COMPLETED' ? 'COMPLETED' : 'NOT_STARTED',
        repairedById: repair.repairedById, repairedAt: repair.repairedAt?.toISOString() ?? null,
        repairSummary: repair.repairSummary,
        independentCheck: repair.verificationStatus === 'NOT_REQUESTED' ? null : {
          id: repair.id,
          status: repair.verificationStatus === 'PASSED' || repair.verificationStatus === 'FAILED' ? repair.verificationStatus : 'PENDING',
          revision: Math.max(1, repair.verificationRevision), verifiedById: repair.verifiedById,
          verifiedAt: repair.verifiedAt?.toISOString() ?? null, note: repair.verificationNote,
        },
        readinessRefresh: repair.verificationStatus !== 'PASSED' ? 'NOT_REQUESTED' : currentAfterCheck ? 'CURRENT' : 'PENDING',
        canResume,
        blockers: canResume ? [] : [repair.verificationStatus !== 'PASSED' ? 'Ожидается независимая проверка ремонта' : !currentAfterCheck ? 'Ожидается новая оценка готовности' : 'Новая оценка не разрешает работу'],
      };
    }
  }
  if (facts.shift) {
    const [reportDetails, outgoing] = await Promise.all([
      db.report.findFirst({where:{tenantId:query.tenantId,shiftId:facts.shift.id},include:{piles:{select:{count:true}},drillings:{select:{meters:true}},downtimes:{select:{durationSeconds:true,duration:true}}}}),
      db.shiftHandover.findFirst({where:{tenantId:query.tenantId,shiftId:facts.shift.id},orderBy:{createdAt:'desc'}}),
    ]);
    if (reportDetails) workplace.report = {
      id:reportDetails.id,status:reportDetails.status,
      summary:{piles:reportDetails.piles.reduce((sum,row)=>sum+row.count,0),drillingMeters:reportDetails.drillings.reduce((sum,row)=>sum+row.meters,0),downtimeSeconds:reportDetails.downtimes.reduce((sum,row)=>sum+(row.durationSeconds??Math.round(row.duration*3600)),0)},
      endingEngineHours:reportDetails.endingEngineHours,submittedAt:reportDetails.submittedAt?.toISOString()??null,
    };
    if (outgoing) workplace.handover.outgoing = {id:outgoing.id,shiftId:outgoing.shiftId,state:outgoing.state,summary:outgoing.summary,submittedById:outgoing.submittedById,submittedAt:outgoing.submittedAt?.toISOString()??null,acceptedById:outgoing.acceptedById,acceptedAt:outgoing.acceptedAt?.toISOString()??null,version:outgoing.version};
  }
  if (workplace.inspections.length === 0) return workplace;

  const details = await db.inspection.findMany({
    where: {
      tenantId: query.tenantId,
      performedById: query.operatorId,
      id: {in: workplace.inspections.map((inspection) => inspection.id)},
    },
    select: {id: true, templateSnapshot: true, answers: true},
  });
  const byId = new Map(details.map((inspection) => [inspection.id, inspection]));
  workplace.inspections = workplace.inspections.map((summary) => {
    const detail = byId.get(summary.id);
    const rawItems = Array.isArray(detail?.templateSnapshot) ? detail.templateSnapshot : [];
    const items = rawItems.flatMap((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const item = raw as Record<string, unknown>;
      if (typeof item.id !== 'string' || typeof item.text !== 'string') return [];
      if (!['YES_NO', 'STATUS4', 'DONE', 'MEASURE'].includes(String(item.answerType))) return [];
      return [{
        id: item.id,
        text: item.text,
        answerType: item.answerType as 'YES_NO' | 'STATUS4' | 'DONE' | 'MEASURE',
        required: item.required === true,
        photoRequired: item.photoRequired === true,
        unit: typeof item.unit === 'string' ? item.unit : null,
        norm: typeof item.norm === 'string' ? item.norm : null,
      }];
    });
    return {
      ...summary,
      items,
      answers: detail?.answers.map((answer) => ({
        itemId: answer.itemId,
        result: answer.result,
        value: answer.value,
        note: answer.note,
        photoCount: answer.photoCount,
      })) ?? [],
    };
  });
  return workplace;
}

async function productionContext(tenantId: string, facts: Awaited<ReturnType<typeof getOperatorShiftFacts>>) {
  if (!facts.shift || facts.shift.state !== 'STARTED') {
    return {activeInterval: null, productionEntries: [], productionOptions: {piles: [], pickets: [], workTypes: []}, productionJournal: []};
  }
  const siteId = facts.assignments.find((item) => item.equipmentId === facts.equipment?.id)?.siteId;
  const [active, rows, piles, workTypes, pickets] = await Promise.all([
    db.reportDowntime.findFirst({where:{tenantId,shiftId:facts.shift.id,status:'OPEN'},orderBy:{startedAt:'desc'}}),
    db.pileWork.findMany({where:{tenantId,shiftId:facts.shift.id},include:{pileGrade:{select:{name:true}},picket:{select:{name:true}}},orderBy:{occurredAt:'desc'}}),
    db.pileGrade.findMany({where:{tenantId,isActive:true},select:{id:true,name:true},orderBy:{name:'asc'}}),
    db.drillingType.findMany({where:{tenantId,isActive:true},select:{id:true,name:true},orderBy:{name:'asc'}}),
    siteId ? db.picket.findMany({where:{cluster:{field:{site:{id:siteId,tenantId}}}},select:{id:true,name:true},orderBy:{name:'asc'}}) : Promise.resolve([]),
  ]);
  const workTypeNames = new Map(workTypes.map((item) => [item.id,item.name]));
  const entries = rows.flatMap((row) => row.clientCommandId && row.workTypeId && row.depth != null && row.workStartedAt && row.workEndedAt && row.result && row.occurredAt ? [{
    id:row.id,clientCommandId:row.clientCommandId,pileId:row.pileGradeId,pileLabel:row.pileGrade.name,
    picketId:row.picketId,picketLabel:row.picket?.name??null,workTypeId:row.workTypeId,
    workTypeLabel:workTypeNames.get(row.workTypeId)??'Вид работы удалён',depth:row.depth,
    startedAt:row.workStartedAt.toISOString(),endedAt:row.workEndedAt.toISOString(),result:row.result,
    comment:row.comment,correctionReason:row.correctionReason,occurredAt:row.occurredAt.toISOString(),state:'CONFIRMED' as const,
  }] : []);
  const intervalCategory = active?.category;
  const category = intervalCategory === 'TECHNICAL' || intervalCategory === 'ORGANIZATIONAL' || intervalCategory === 'WEATHER' || intervalCategory === 'SAFETY' || intervalCategory === 'OTHER' ? intervalCategory : null;
  const activeInterval = active?.kind && (active.kind === 'BREAK' || active.kind === 'DOWNTIME') && active.startedAt ? {
    id:active.id,kind:active.kind as 'BREAK'|'DOWNTIME',status:'OPEN' as const,startedAt:active.startedAt.toISOString(),reason:active.reasonText,
    category:category as 'TECHNICAL'|'ORGANIZATIONAL'|'WEATHER'|'SAFETY'|'OTHER'|null,
    comment:active.comment,durationSeconds:null,version:active.version,
  } : null;
  const productionJournal = [
    ...entries.map((entry) => ({id:entry.id,occurredAt:entry.occurredAt,title:'Производственная работа',details:`${entry.pileLabel}, ${entry.depth} м`,state:'CONFIRMED' as const})),
    ...(activeInterval ? [{id:activeInterval.id,occurredAt:activeInterval.startedAt,title:activeInterval.kind==='BREAK'?'Начат перерыв':'Начат простой',details:activeInterval.reason,state:'CONFIRMED' as const}] : []),
  ].sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
  return {activeInterval,productionEntries:entries,productionOptions:{piles:piles.map((item)=>({id:item.id,label:item.name})),pickets:pickets.map((item)=>({id:item.id,label:item.name})),workTypes:workTypes.map((item)=>({id:item.id,label:item.name}))},productionJournal};
}
