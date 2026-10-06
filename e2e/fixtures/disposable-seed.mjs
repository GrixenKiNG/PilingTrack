import pg from 'pg'; const {Client}=pg;import bcrypt from 'bcryptjs';
const url=new URL(process.env.INTEGRATION_DATABASE_URL_OWNER||'http://invalid');if(url.hostname!=='127.0.0.1'||url.pathname!=='/codex_test'||url.username!=='piling')throw Error('Only disposable owner allowed');
const client=new Client({connectionString:url.toString()});
(async()=>{await client.connect();try{await client.query('BEGIN');
async function insert(table,row){const keys=Object.keys(row);await client.query('INSERT INTO "'+table+'" ('+keys.map(x=>'"'+x+'"').join(',')+') VALUES ('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',Object.values(row));}
const now=new Date();for(const tenant of ['codex-e1-a','codex-e1-b']){await insert('Tenant',{id:tenant,slug:tenant,name:tenant,updatedAt:now});await insert('TenantSettings',{id:tenant+'-settings',tenantId:tenant,companyName:'Codex test',notifications:{criticalDefect:false},updatedAt:now});}
for(const role of ['ADMIN','DISPATCHER','OPERATOR','ASSISTANT','OPERATOR_B']){const actual=role==='OPERATOR_B'?'OPERATOR':role;await insert('User',{id:'codex-e1-'+role.toLowerCase(),tenantId:role==='OPERATOR_B'?'codex-e1-b':'codex-e1-a',email:process.env['E2E_'+role+'_EMAIL'],password:await bcrypt.hash(process.env['E2E_'+role+'_PASSWORD'],10),name:'Codex '+role,role:actual,updatedAt:now});}
for(const suffix of ['a','b']){const tenant='codex-e1-'+suffix;const operator='codex-e1-'+(suffix==='a'?'operator':'operator_b');
await insert('Site',{id:tenant+'-site',tenantId:tenant,name:'Codex объект '+suffix,updatedAt:now});await insert('PileField',{id:tenant+'-field',siteId:tenant+'-site',name:'Codex поле '+suffix,updatedAt:now});await insert('Cluster',{id:tenant+'-cluster',fieldId:tenant+'-field',name:'Codex куст '+suffix,updatedAt:now});
await insert('Equipment',{id:tenant+'-equipment',tenantId:tenant,name:'Codex установка '+suffix,kind:'PILE_DRIVER',model:'Codex test',updatedAt:now});
await insert('Crew',{id:tenant+'-crew',name:'Codex бригада '+suffix,siteId:tenant+'-site',equipmentId:tenant+'-equipment',operatorId:operator,updatedAt:now});
await insert('UserSiteAssignment',{id:tenant+'-assignment',userId:operator,siteId:tenant+'-site',updatedAt:now});
await insert('PileGrade',{id:tenant+'-grade',tenantId:tenant,name:'Codex C60',normalizedName:'codexc60',lengthMm:6000,updatedAt:now});
for(let i=1;i<=5;i++)await insert('Picket',{id:tenant+'-picket-'+i,clusterId:tenant+'-cluster',name:'Codex ПК '+i,updatedAt:now});
}
await insert('CrewAssistant',{id:'codex-e1-assistant-link',crewId:'codex-e1-a-crew',userId:'codex-e1-assistant',name:'Codex ASSISTANT',updatedAt:now});
await insert('ChecklistTemplate',{id:'codex-e1-checklist',tenantId:'codex-e1-a',name:'Codex EO',level:'EO',updatedAt:now});
await client.query('COMMIT');console.log('Seed: 2 tenants, 5 own accounts, sites/fields/clusters/pickets/crews/equipment/grades');}catch(e){await client.query('ROLLBACK');throw e;}finally{await client.end();}})().catch(e=>{console.error(e.message);process.exitCode=1});
