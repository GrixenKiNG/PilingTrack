import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
const scale = Number(process.argv[2]);
if (![1, 5, 20].includes(scale)) throw Error('Scale must be 1, 5 or 20');
const replay = process.argv[3] === 'explain-replay'
  ? JSON.parse(readFileSync(`output/perf-1023/config-x${scale}.json`, 'utf8')) : null;
function integer(name, fallback, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > max) throw Error(`Invalid ${name}`);
  return value;
}
const config = {
  scale, tenantId: 'codex-perf-1023',
  equipment: replay ? replay.equipment : integer('PERF_BASE_EQUIPMENT', 10, 25) * scale,
  sites: replay ? replay.sites : integer('PERF_BASE_SITES', 2, 10) * scale,
  days: replay ? replay.days : integer('PERF_HISTORY_DAYS', 30, 90),
  pilesPerReport: replay ? replay.pilesPerReport : integer('PERF_PILES_PER_REPORT', 20, 30),
  photosPerEquipment: replay ? replay.photosPerEquipment : integer('PERF_PHOTOS_PER_EQUIPMENT', 10, 30),
};
if (replay && (replay.scale !== scale || replay.tenantId !== config.tenantId)) throw Error('Replay identity mismatch');
for (const [key, max] of [['equipment', 25 * scale], ['sites', 10 * scale], ['days', 90], ['pilesPerReport', 30], ['photosPerEquipment', 30]]) {
  if (!Number.isInteger(config[key]) || config[key] < 1 || config[key] > max) throw Error(`Invalid replay ${key}`);
}
config.reports = config.equipment * config.days;
config.pileRows = config.reports * config.pilesPerReport;
config.photos = config.equipment * config.photosPerEquipment;
config.today = replay ? replay.today : new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
if (!/^\d{4}-\d{2}-\d{2}$/.test(config.today) || new Date(config.today + 'T12:00:00Z').toISOString().slice(0, 10) !== config.today) throw Error('Invalid seed date');
config.dateFrom = new Date(new Date(config.today + 'T12:00:00Z').getTime() - (config.days - 1) * 86400000).toISOString().slice(0, 10);
if (replay && replay.dateFrom !== config.dateFrom) throw Error('Replay date range mismatch');
const url = new URL(process.env.INTEGRATION_DATABASE_URL_OWNER || 'http://invalid');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/codex_test' || url.username !== 'piling') throw Error('Disposable owner required');
const client = new pg.Client({ connectionString: url.toString(), statement_timeout: 30000 });
const t = config.tenantId;
await client.connect();
try {
  const existing = await client.query('SELECT count(*)::int AS count FROM "Tenant"');
  if (existing.rows[0].count !== 0) throw Error('Fresh empty disposable database required');
  await client.query('BEGIN');
  await client.query('INSERT INTO "Tenant" (id,slug,name,"updatedAt") VALUES ($1,$1,$1,now())', [t]);
  await client.query(`INSERT INTO "User" (id,"tenantId",email,name,role,"updatedAt")
    SELECT 'perf-user-'||i,$1,'perf-'||i||'@example.invalid','Synthetic operator '||i,'OPERATOR',now() FROM generate_series(1,$2::int) i`, [t, config.equipment]);
  await client.query(`INSERT INTO "Site" (id,"tenantId",name,"plannedPiles","plannedDrilling","updatedAt")
    SELECT 'perf-site-'||i,$1,'Synthetic site '||i,100000,100000,now() FROM generate_series(1,$2::int) i`, [t, config.sites]);
  await client.query(`INSERT INTO "Equipment" (id,"tenantId",name,model,kind,"engineHoursTotal","updatedAt")
    SELECT 'perf-equipment-'||i,$1,'Synthetic rig '||i,'Synthetic 1023','PILE_DRIVER',1000,now() FROM generate_series(1,$2::int) i`, [t, config.equipment]);
  await client.query(`INSERT INTO "Crew" (id,name,"operatorId","equipmentId","siteId","updatedAt")
    SELECT 'perf-crew-'||i,'Synthetic crew '||i,'perf-user-'||i,'perf-equipment-'||i,'perf-site-'||(1+(i-1)%$2::int),now() FROM generate_series(1,$1::int) i`, [config.equipment, config.sites]);
  await client.query(`INSERT INTO "PileGrade" (id,"tenantId",name,"normalizedName","lengthMm","updatedAt") VALUES ('perf-grade',$1,'Synthetic C60','syntheticc60',6000,now())`, [t]);
  await client.query(`INSERT INTO "DrillingType" (id,"tenantId",name,"normalizedName","updatedAt") VALUES ('perf-drill',$1,'Synthetic drilling','syntheticdrilling',now())`, [t]);
  await client.query(`INSERT INTO "DowntimeReason" (id,"tenantId",name,"normalizedName","updatedAt") VALUES ('perf-downtime',$1,'Synthetic wait','syntheticwait',now())`, [t]);
  await client.query(`INSERT INTO "SitePilePlan" (id,"siteId","pileGradeId",count,"metersPerUnit","updatedAt")
    SELECT 'perf-plan-'||i,'perf-site-'||i,'perf-grade',100000,6,now() FROM generate_series(1,$1::int) i`, [config.sites]);
  await client.query(`INSERT INTO "SiteDrillingPlan" (id,"siteId",count,"metersPerUnit","updatedAt")
    SELECT 'perf-drill-plan-'||i,'perf-site-'||i,100000,6,now() FROM generate_series(1,$1::int) i`, [config.sites]);
  await client.query(`INSERT INTO "Report" (id,"tenantId","reportId","userId","crewId","equipmentId","siteId",date,status,"submittedAt","updatedAt")
    SELECT 'perf-report-'||i||'-'||d,$1,'perf-report-'||i||'-'||d,'perf-user-'||i,'perf-crew-'||i,'perf-equipment-'||i,
    'perf-site-'||(1+(i-1)%$3::int),($4::date-d)::text,'submitted',now(),now()
    FROM generate_series(1,$2::int) i CROSS JOIN generate_series(0,$5::int-1) d`, [t, config.equipment, config.sites, config.today, config.days]);
  await client.query(`INSERT INTO "PileWork" (id,"tenantId","reportId","pileGradeId",count,"occurredAt","receivedAt")
    SELECT 'perf-pile-'||r.id||'-'||n,$1,r.id,'perf-grade',1,r.date::date+time '09:00',r.date::date+time '09:00'
    FROM "Report" r CROSS JOIN generate_series(1,$2::int) n`, [t, config.pilesPerReport]);
  await client.query(`INSERT INTO "PilePassport" (id,"tenantId","pileWorkId","clientCommandId","pileNumber","hammerType","hammerEnergyKj","designRefusalMm",acceptance,"drivenAt","recordedById","updatedAt")
    SELECT 'perf-passport-'||pw.id,$1,pw.id,'cmd-'||pw.id,pw.id,'Synthetic hammer',50,2,
    CASE WHEN right(pw.id,1)='1' THEN 'PENDING'::"PileAcceptance" ELSE 'ACCEPTED'::"PileAcceptance" END,pw."occurredAt",r."userId",now()
    FROM "PileWork" pw JOIN "Report" r ON r.id=pw."reportId"`, [t]);
  await client.query(`INSERT INTO "LeaderDrilling" (id,"tenantId","reportId","typeId",count,"metersPerUnit",meters,"occurredAt")
    SELECT 'perf-drilling-'||id,$1,id,'perf-drill',2,6,12,date::date+time '08:00' FROM "Report"`, [t]);
  await client.query(`INSERT INTO "ReportDowntime" (id,"tenantId","reportId","reasonId",duration,comment)
    SELECT 'perf-downtime-'||id,$1,id,'perf-downtime',0.5,'Synthetic waiting' FROM "Report"`, [t]);
  await client.query(`INSERT INTO "Media" (id,"tenantId","userId","fileName","contentType",key,"entityType","entityId","uploadStatus","updatedAt","createdAt")
    SELECT 'perf-media-'||i||'-'||n,$1,'perf-user-'||i,'synthetic.jpg','image/jpeg','synthetic/'||i||'/'||n,
    'equipment','perf-equipment-'||i,'completed',now(),now()-n*interval '1 hour'
    FROM generate_series(1,$2::int) i CROSS JOIN generate_series(1,$3::int) n`, [t, config.equipment, config.photosPerEquipment]);
  await client.query(`INSERT INTO "TelemetryRecord" (id,"tenantId","equipmentId","siteId",type,value,timestamp)
    SELECT 'perf-fuel-'||i||'-'||d,$1,'perf-equipment-'||i,'perf-site-'||(1+(i-1)%$3::int),'fuel_total',1000+($5::int-d)*40,($4::date-d)+time '12:00'
    FROM generate_series(1,$2::int) i CROSS JOIN generate_series(0,$5::int-1) d`, [t, config.equipment, config.sites, config.today, config.days]);
  await client.query('COMMIT');
  await client.query('ANALYZE');
  const counts = await client.query(`SELECT
    (SELECT count(*)::int FROM "Equipment") equipment,(SELECT count(*)::int FROM "Site") sites,
    (SELECT count(*)::int FROM "Report") reports,(SELECT count(*)::int FROM "PileWork") "pileRows",
    (SELECT count(*)::int FROM "PilePassport") passports,(SELECT count(*)::int FROM "Media") photos,
    pg_database_size(current_database())::bigint "databaseBytes"`);
  config.actual = counts.rows[0];
  for (const key of ['equipment', 'sites', 'reports', 'pileRows', 'photos']) {
    if (config.actual[key] !== config[key]) throw Error(`Wrong ${key}: ${config.actual[key]} vs ${config[key]}`);
  }
  const suffix = process.argv[3] === 'explain-replay' ? '-explain-replay' : '';
  writeFileSync(`output/perf-1023/config-x${scale}${suffix}.json`, JSON.stringify(config, null, 2));
  console.log(JSON.stringify(config));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally { await client.end(); }
