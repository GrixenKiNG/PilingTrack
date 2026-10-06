// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { createFixture } from './helpers/disposable-db';

const enabled = Boolean(process.env.INTEGRATION_DATABASE_URL_OWNER && process.env.CODEX_STAND_URL);
const cases: Array<{ method: string; path: string; body?: Record<string, unknown>; safeEmpty?: boolean }> = [
  {method:'GET',path:'/auth/me?userId=U'}, {method:'GET',path:'/crews/my?operatorId=U'},
  {method:'GET',path:'/reports/edit?userId=U&siteId=S&date=2026-10-02'},
  {method:'GET',path:'/reports/single-pdf?reportId=R&sync=1'},
  {method:'POST',path:'/reports/single-pdf',body:{reportId:'R'}},
  {method:'POST',path:'/reports/upsert',body:{reportId:randomUUID(),siteId:'S',userId:'U',date:'2026-10-02',piles:[{pileGradeId:'G',count:1}]}},
  {method:'POST',path:'/reports/upsert',body:{reportId:randomUUID(),siteId:'S',date:'2026-10-02',piles:[{pileGradeId:'G',count:1}]}},
  {method:'GET',path:'/media?entityType=equipment&entityId=E'},
  {method:'POST',path:'/media',body:{entityType:'equipment',entityId:'E',fileName:'codex.png',contentType:'image/png',fileSize:100}},
  {method:'POST',path:'/inspections',body:{equipmentId:'E',templateId:'T',inspectionDate:'2026-10-02'}},
  {method:'POST',path:'/readiness/shifts',body:{equipmentId:'E',type:'DAY'}},
  {method:'POST',path:'/briefings/B1/sign',body:{}},
  {method:'GET',path:'/equipment/E'}, {method:'PUT',path:'/equipment/E',body:{name:'IDOR overwrite'}}, {method:'DELETE',path:'/equipment/E'},
  {method:'GET',path:'/equipment/E/details'}, {method:'GET',path:'/equipment/E/meter-readings'}, {method:'POST',path:'/equipment/E/meter-readings',body:{engineHours:10}},
  {method:'GET',path:'/equipment/E/fuel'}, {method:'POST',path:'/equipment/E/fuel',body:{litersAdded:10}},
  {method:'POST',path:'/equipment/E/documents',body:{type:'OTHER',title:'IDOR'}},
  {method:'PUT',path:'/equipment/E/documents/D1',body:{title:'IDOR'}}, {method:'DELETE',path:'/equipment/E/documents/D1'},
  {method:'GET',path:'/equipment/E/device-keys'}, {method:'POST',path:'/equipment/E/device-keys',body:{}},
  {method:'GET',path:'/equipment/E/maintenance'}, {method:'POST',path:'/equipment/E/maintenance',body:{type:'REPAIR',title:'IDOR'}},
  {method:'PUT',path:'/equipment/E/maintenance/M',body:{title:'IDOR'}}, {method:'DELETE',path:'/equipment/E/maintenance/M'},
  {method:'GET',path:'/sites/S'}, {method:'PUT',path:'/sites/S',body:{name:'IDOR'}}, {method:'DELETE',path:'/sites/S'},
  {method:'POST',path:'/sites/S/hierarchy',body:{type:'field',name:'IDOR'}}, {method:'DELETE',path:'/sites/S/hierarchy',body:{type:'field',itemId:'field'}},
  {method:'POST',path:'/sites/S/assign',body:{userId:'user'}},
  {method:'GET',path:'/crews/C'}, {method:'PUT',path:'/crews/C',body:{name:'IDOR'}}, {method:'DELETE',path:'/crews/C'},
  {method:'GET',path:'/inspections/I'}, {method:'PUT',path:'/inspections/I',body:{answers:[]}}, {method:'POST',path:'/inspections/I/complete',body:{signedByName:'Codex test'}},
  {method:'GET',path:'/checklist-templates/T'}, {method:'DELETE',path:'/checklist-templates/T'},
  {method:'GET',path:'/maintenance/M'}, {method:'POST',path:'/maintenance/M/accept',body:{}},
  {method:'GET',path:'/users/U/documents'}, {method:'POST',path:'/users/U/documents',body:{typeId:'DT'}},
  {method:'PUT',path:'/users/U/documents/U1',body:{notes:'IDOR'}}, {method:'DELETE',path:'/users/U/documents/U1'},
  {method:'GET',path:'/reports/R/history'}, {method:'DELETE',path:'/reports/delete',body:{reportId:'REPORT'}},
  {method:'GET',path:'/media/F/download'}, {method:'POST',path:'/media/F/confirm',body:{}}, {method:'DELETE',path:'/media/F'},
  {method:'GET',path:'/readiness/shifts/H'}, {method:'PATCH',path:'/readiness/shifts/H',body:{expectedVersion:1,type:'NIGHT'}},
  {method:'POST',path:'/readiness/shifts/H/start',body:{expectedVersion:1}},
  {method:'POST',path:'/readiness/shifts/H/request-acceptance',body:{expectedVersion:1}},
  {method:'POST',path:'/readiness/shifts/H/cancel',body:{expectedVersion:1,reason:'IDOR attempt'}},

  {method:'DELETE',path:'/equipment/E/fuel/F1'}, {method:'DELETE',path:'/equipment/E/meter-readings/N1'},
  {method:'PATCH',path:'/maintenance-plans/PM',body:{title:'IDOR'}}, {method:'DELETE',path:'/maintenance-plans/PM'},
  {method:'GET',path:'/readiness/current?equipmentId=E',safeEmpty:true},
  {method:'GET',path:'/readiness/defects?equipmentId=E',safeEmpty:true},
  {method:'POST',path:'/readiness/defects',body:{equipmentId:'E',severity:'NORMAL',title:'IDOR defect'}},
  {method:'POST',path:'/readiness/defects/DF/triage',body:{expectedVersion:1,comment:'IDOR'}},
  {method:'POST',path:'/readiness/defects/DF/resolve',body:{expectedVersion:1,resolution:'IDOR'}},
  {method:'POST',path:'/readiness/defects/DF/reject',body:{expectedVersion:1,reason:'IDOR'}},
  {method:'GET',path:'/readiness/handovers/HO'},
  {method:'POST',path:'/readiness/handovers/HO/accept',body:{expectedVersion:1}},
  {method:'POST',path:'/readiness/handovers/HO/rework',body:{expectedVersion:1,reason:'IDOR'}},
  {method:'GET',path:'/readiness/work-permits/WP'},
  {method:'PATCH',path:'/readiness/work-permits/WP',body:{expectedVersion:1,title:'IDOR'}},
  {method:'POST',path:'/readiness/work-permits/WP/submit',body:{expectedVersion:1}},
  {method:'POST',path:'/readiness/work-permits/WP/approve',body:{expectedVersion:1}},
  {method:'POST',path:'/readiness/work-permits/WP/revoke',body:{expectedVersion:1,reason:'IDOR'}},
  {method:'POST',path:'/readiness/shifts/H/decline',body:{expectedVersion:1,reason:'IDOR'}},
  {method:'POST',path:'/readiness/shifts/H/handover',body:{expectedVersion:1,summary:'IDOR'}},
];

describe.skipIf(!enabled)('E2 HTTP IDOR on disposable production app', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  const sessions: Record<string, string> = {};
  let base: string; let a: string; let b: string; let assistant: string;
  let ids: Record<string, string>;
  const request = async (role: string, method: string, path: string, body?: Record<string, unknown>) => {
    const substitute = (v: unknown): unknown => typeof v==='string' ? (v==='REPORT'?ids.R:v==='user'?ids.U:ids[v] || v) : Array.isArray(v) ? v.map(substitute) : v && typeof v==='object' ? Object.fromEntries(Object.entries(v).map(([k,x])=>[k,substitute(x)])) : v;
    const value = body && substitute(body);
    return fetch(base + '/api' + path, {method,headers:{Cookie:sessions[role],Origin:base,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:method==='GET'?undefined:JSON.stringify(value || {})});
  };
  beforeAll(async () => {
    const url = new URL(process.env.CODEX_STAND_URL || 'http://invalid');
    if (!['127.0.0.1','localhost'].includes(url.hostname)) throw new Error('Only local disposable app'); base=url.origin;
    fixture=await createFixture(); [a,b]=fixture.tenants;
    const equip=fixture.id(a,'Equipment'); const user=fixture.id(a,'User');
    ids={E:equip,S:fixture.id(a,'Site'),I:fixture.id(a,'Inspection'),T:fixture.id(a,'ChecklistTemplate'),R:fixture.id(a,'Report'),U:user,H:fixture.id(a,'Shift'),C:a+'-crew',M:a+'-maintenance',F:a+'-media',G:a+'-grade'};
    Object.assign(ids,{D1:a+'-eqdoc',DT:a+'-doctype',U1:a+'-userdoc',B1:a+'-briefing',F1:a+'-fuel',N1:a+'-meter',PM:a+'-pm',DF:a+'-defect',HO:a+'-handover',WP:a+'-permit'});
    const insert=async(table:string,values:Record<string,unknown>)=>{const keys=Object.keys(values);await fixture.owner.query(`INSERT INTO "${table}" (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(values));};
    const common={tenantId:a,updatedAt:new Date()};
    await insert('ReadinessScoreSnapshot',{id:a+'-snapshot',tenantId:a,equipmentId:equip,ruleSetId:'codex-rule',ruleSetVersion:'1',triggerType:'codex-fixture',triggerId:a,status:'READY',score:100,blockers:'[]',warnings:'[]',evidence:'[]',facts:'{}',factsHash:Buffer.alloc(32)});
    await insert('CurrentReadiness',{tenantId:a,equipmentId:equip,snapshotId:a+'-snapshot',status:'READY',score:100,calculatedAt:new Date()});
    await insert('EquipmentDocument',{...common,id:ids.D1,equipmentId:equip,type:'OTHER',title:'Codex document'});
    await insert('UserDocumentType',{...common,id:ids.DT,name:'Codex document',normalizedName:'codex document'});
    await insert('UserDocument',{...common,id:ids.U1,userId:user,typeId:ids.DT,notes:'Codex'});
    await insert('BriefingRecord',{id:ids.B1,tenantId:a,userId:user,kind:'INSTRUCTION',userName:'Codex',userRole:'OPERATOR',documentCode:'codex',documentTitle:'Codex',documentVersion:'1',recordedAt:new Date()});
    await insert('FuelLog',{id:ids.F1,tenantId:a,equipmentId:equip,recordedAt:new Date(),litersAdded:10});
    await insert('MeterReading',{id:ids.N1,tenantId:a,equipmentId:equip,recordedAt:new Date(),engineHours:10});
    await insert('MaintenancePlan',{...common,id:ids.PM,equipmentId:equip,title:'Codex PM',triggerType:'HOURS',intervalHours:100});
    await insert('EquipmentDefect',{...common,id:ids.DF,equipmentId:equip,title:'Codex defect',reportedById:user});
    await insert('ShiftHandover',{...common,id:ids.HO,shiftId:ids.H,summary:'Codex handover',submittedById:user});
    await insert('WorkPermit',{...common,id:ids.WP,equipmentId:equip,risk:'NORMAL',title:'Codex permit',scope:'Codex scope',validFrom:new Date(),validTo:new Date(Date.now()+3600000),timezone:'Europe/Moscow',authorId:user,lastEditedById:user});
    await fixture.owner.query('INSERT INTO "PileGrade" (id,"tenantId",name,"normalizedName","lengthMm","updatedAt") VALUES ($1,$2,$1,$1,6000,now())',[ids.G,a]);
    await fixture.owner.query('INSERT INTO "Crew" (id,name,"operatorId","equipmentId","siteId","updatedAt") VALUES ($1,$1,$2,$3,$4,now())',[ids.C,user,equip,ids.S]);
    await fixture.owner.query('INSERT INTO "MaintenanceRecord" (id,"tenantId","equipmentId",type,title,"updatedAt") VALUES ($1,$2,$3,$4,$1,now())',[ids.M,a,equip,'REPAIR']);
    await fixture.owner.query('INSERT INTO "Media" (id,"tenantId","userId","entityType","entityId","fileName","contentType",key,"updatedAt") VALUES ($1,$2,$3,$4,$5,$1,$6,$1,now())',[ids.F,a,user,'equipment',equip,'image/png']);
    await fixture.owner.query('INSERT INTO "Crew" (id,name,"operatorId","equipmentId","siteId","updatedAt") VALUES ($1,$1,$2,$3,$4,now())',[b+'-crew',fixture.id(b,'User'),fixture.id(b,'Equipment'),fixture.id(b,'Site')]);
    assistant=b+'-assistant';
    for(const role of ['OPERATOR','ASSISTANT']) {
      const password=randomBytes(20).toString('hex'); const email=b+'-'+role.toLowerCase()+'@example.invalid'; const id=role==='OPERATOR'?fixture.id(b,'User'):assistant;
      if(role==='OPERATOR') await fixture.owner.query('UPDATE "User" SET email=$1,password=$2,role=$3 WHERE id=$4',[email,await bcrypt.hash(password,10),role,id]);
      else await fixture.owner.query('INSERT INTO "User" (id,"tenantId",email,password,name,role,"updatedAt") VALUES ($1,$2,$3,$4,$1,$5,now())',[id,b,email,await bcrypt.hash(password,10),role]);
      await fixture.owner.query('INSERT INTO "UserSiteAssignment" (id,"userId","siteId","updatedAt") VALUES ($1,$2,$3,now())',[id+'-assignment',id,fixture.id(b,'Site')]);
      const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email,password})});
      expect(response.status).toBe(200); const cookie=response.headers.getSetCookie().find(v=>v.startsWith('pt-session=')); expect(cookie).toBeDefined(); sessions[role]=cookie?.split(';')[0] || '';
      expect((await request(role,'GET','/equipment/'+fixture.id(b,'Equipment'))).status).toBe(200);
    }
    await fixture.owner.query('INSERT INTO "CrewAssistant" (id,"crewId","userId",name,"updatedAt") VALUES ($1,$2,$3,$1,now())',[assistant+'-crew',b+'-crew',assistant]);
  });
  afterAll(async () => {
    if(!fixture)return;
    // Immutable history is retained until the owned database container is removed.
    for(const table of ['CurrentReadiness','ShiftHandover','WorkPermit','EquipmentDefect','MaintenancePlan','FuelLog','MeterReading','BriefingRecord','UserDocument','UserDocumentType','EquipmentDocument'])await fixture.owner.query(`DELETE FROM "${table}" WHERE "tenantId"=$1`,[a]);
    await fixture.owner.query('DELETE FROM "Media" WHERE id=$1',[ids.F]);
    await fixture.owner.query('DELETE FROM "MaintenanceRecord" WHERE id=$1',[ids.M]);
    await fixture.owner.query('DELETE FROM "PileGrade" WHERE id=$1',[ids.G]);
    await fixture.owner.query('DELETE FROM "Crew" WHERE id=$1',[ids.C]);
    await fixture.owner.query('DELETE FROM "Crew" WHERE id=$1',[b+'-crew']);
    await fixture.owner.query('DELETE FROM "UserSiteAssignment" WHERE "siteId"=$1',[fixture.id(b,'Site')]);
    await fixture.owner.query('DELETE FROM "User" WHERE id=$1',[assistant]);
    await fixture.close();
  });
  for(const role of ['OPERATOR','ASSISTANT'])for(const c of cases) it(`${role}: ${c.method} ${c.path}`,async()=>{
    const path=c.path.replace(/\b([A-Z][A-Z0-9]*)\b/g,p=>ids[p]||p);
    const response=await request(role,c.method,path,c.body);
    if(c.path.startsWith('/crews/my')) {
      expect(response.status).toBe(200);
      expect((await response.json()).crew.id).toBe(b+'-crew');
      return;
    }
    if(c.safeEmpty&&role==='OPERATOR'){expect(response.status).toBe(200);expect((await response.json()).data).toEqual([]);return;}
    expect([403,404],`${role} ${c.method} ${c.path}: ${response.status} ${await response.text()}`).toContain(response.status);
  });
  it('foreign records remain intact after all denied mutations',async()=>{
    expect((await fixture.owner.query('SELECT title FROM "WorkPermit" WHERE id=$1',[ids.WP])).rows[0].title).toBe('Codex permit');
    expect((await fixture.owner.query('SELECT "employeeSignedAt" FROM "BriefingRecord" WHERE id=$1',[ids.B1])).rows[0].employeeSignedAt).toBe(null);
    expect((await fixture.owner.query('SELECT notes FROM "UserDocument" WHERE id=$1',[ids.U1])).rows[0].notes).toBe('Codex');
    expect((await fixture.owner.query('SELECT name FROM "Equipment" WHERE id=$1',[ids.E])).rows[0].name).toBe('Disposable equipment');
    expect((await fixture.owner.query('SELECT version FROM "Report" WHERE id=$1',[ids.R])).rows[0].version).toBe(1);
    expect((await fixture.owner.query('SELECT "isDeleted" FROM "Media" WHERE id=$1',[ids.F])).rows[0].isDeleted).toBe(false);
  });
});
