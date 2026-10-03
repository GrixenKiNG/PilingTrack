// Offline orchestration checks. Docker/Caddy/HTTP are replaced; no SSH or env files.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const dir = path.resolve('output/codex-t7/bluegreen-shim');
fs.mkdirSync(dir, { recursive: true });
const mock = String.raw`
const fs=require('node:fs');
const a=process.argv.slice(2), kind=a.shift(), state=JSON.parse(fs.readFileSync(process.env.BG_STATE,'utf8'));
const save=()=>fs.writeFileSync(process.env.BG_STATE,JSON.stringify(state));
const fail=()=>process.exit(1);
state.events.push([kind,...a].join(' '));
if(kind==='docker') {
 if(a[0]==='ps') { const filters=a.join(' '); if(filters.includes('project=codex-bg-green')||filters.includes('project=pilingtrack-green')) { if(state.candidate) console.log('candidate'); }
 else if(filters.includes('project=codex-bg-blue')||filters.includes('project=pilingtrack-blue')) {if(!state.legacy)console.log('old');}
 else if(filters.includes('project=codex-bg')) {if(state.legacy)console.log('old');} }
 else if(a[0]==='inspect') {const field=a[2], id=a[3]; if(field.includes('EMBEDDED_WORKERS'))console.log(state.unsafe&&id==='old'||state.candidateUnsafe&&id==='candidate'?'default':id==='old'&&state.legacy?'default':'disabled');
 else if(field.includes('State.Health.Status'))console.log(state.failure==='health'&&id==='candidate'?'unhealthy':'healthy');
 else if(field.includes('State.Status'))console.log('exited 143 false');
 else if(field.includes('State.Running'))console.log('true');
 else if(field.includes('com.docker.compose.service'))console.log('app');
 else console.log('sha256:'+ 'a'.repeat(64)); }
 else if(a[0]==='exec'&&state.failure==='local-storage'){save();fail();}
 else if(a[0]==='image'){}
 else if(a[0]==='compose') {if(a.includes('up')||a.includes('create'))state.candidate=true; if(a.includes('down'))state.candidate=false;}
 else if(a[0]==='rm')state.removed=true;
}
if(kind==='caddy') { if(a[0]==='validate'&&(state.failure==='default-invalid'||state.failure==='validate'&&fs.readFileSync(process.env.BLUEGREEN_CADDY_SNIPPET,'utf8').includes('3001'))) {save();fail();}
 if(a[0]==='reload'){state.active=fs.readFileSync(process.env.BLUEGREEN_CADDY_SNIPPET,'utf8').includes('3001')?'new':'old';} }
if(kind==='curl') {const url=a[a.length-1], candidate=url.includes(':3001'), version=candidate||url.includes(':8080')&&state.active==='new'?'bbbbbbbb':'aaaaaaaa';
 if(url.endsWith('/api/health')) console.log(JSON.stringify({status:'ok',version:state.failure==='sha'&&candidate?'cccccccc':version}));
 else if(url.endsWith('/api/ready'))console.log('{"ready":true}');
 else if(a.includes('%{http_code}'))console.log(url.includes('/api/')?'401':'200'); }
if(kind==='barrier'){ if(state.failure==='barrier'){save();fail();}state.barrier=true; }
save();
`;
fs.writeFileSync(path.join(dir, 'mock.cjs'), mock);
for (const kind of ['docker', 'curl', 'caddy']) {
  fs.writeFileSync(path.join(dir, kind), '#!/usr/bin/env bash\nnode "'+dir.replaceAll('\\','/')+'/mock.cjs" '+kind+' "$@"\n');
}
fs.writeFileSync(path.join(dir,'barrier.sh'),'#!/usr/bin/env bash\nnode "'+dir.replaceAll('\\','/')+'/mock.cjs" barrier "$@"\n');
fs.writeFileSync(path.join(dir,'sudo'),'#!/usr/bin/env bash\n[ "$1" != -n ] || shift\nexec "$@"\n');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
cp.execFileSync(bash, ['-c', 'chmod +x output/codex-t7/bluegreen-shim/docker output/codex-t7/bluegreen-shim/curl output/codex-t7/bluegreen-shim/caddy output/codex-t7/bluegreen-shim/sudo']);
for(const scenario of ['ok','legacy','health','sha','validate','barrier','unknown','unsafe','candidate-unsafe','local-storage']){
 const state={events:[],active:'old',legacy:scenario==='legacy'||scenario==='barrier',unsafe:scenario==='unsafe',candidateUnsafe:scenario==='candidate-unsafe',failure:scenario};
 const stateFile=path.join(dir,'state.json'),snippet=path.join(dir,'app-upstream.caddy'),config=path.join(dir,'Caddyfile');
 fs.writeFileSync(stateFile,JSON.stringify(state));fs.writeFileSync(snippet,'reverse_proxy 127.0.0.1:3000\n');
 fs.writeFileSync(config,scenario==='unknown'?':8080 { reverse_proxy localhost:3000 }\n':':8080 {\n handle {\n import app-upstream.caddy\n }\n}\n');
 const result=cp.spawnSync(bash,['-c','export PATH="$PWD/output/codex-t7/bluegreen-shim:$PATH"; bash scripts/replace-app-bluegreen.sh codex-app:bbbbbbbb bbbbbbbb'],{encoding:'utf8',windowsHide:true,env:{...process.env,BG_STATE:stateFile,WORKER_GENERATION_PROJECT:'codex-bg',WORKER_GENERATION_EXTERNAL_STOPPED:'1',BLUEGREEN_CADDY_SUDO:'0',BLUEGREEN_CADDY_SOURCE:config,BLUEGREEN_CADDY_CONFIG:config,BLUEGREEN_CADDY_SNIPPET:snippet,BLUEGREEN_PUBLIC_URL:'http://127.0.0.1:8080',BLUEGREEN_WORKER_HELPER:path.join(dir,'barrier.sh'),BLUEGREEN_TIMEOUT_SECONDS:'1',BLUEGREEN_DRAIN_SECONDS:'0',BLUEGREEN_APP_NETWORK:'codex-bg-net',BLUEGREEN_LOCK:path.join(dir,'lock') }});
 const after=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 if(['ok','legacy'].includes(scenario)){assert.equal(result.status,0,result.stderr);assert.equal(after.active,'new');assert.ok(after.barrier);assert.ok(after.removed);}
 else {assert.notEqual(result.status,0,scenario+' accepted');assert.equal(after.active,'old',scenario+' lost old serving app');assert.ok(!after.removed,scenario+' removed old');}
 if(['unknown','unsafe','local-storage'].includes(scenario))assert.ok(!after.events.some(e=>e.startsWith('docker compose')||e.startsWith('barrier')),'mutation before refusal');
 if(['health','sha'].includes(scenario))assert.ok(!after.events.some(e=>e.startsWith('caddy reload')),'reload before candidate accepted');
 if(scenario==='barrier')assert.ok(after.events.some(e=>e.startsWith('caddy reload')),'failure did not exercise rollback after cutover');
 if(scenario==='candidate-unsafe')assert.ok(!after.events.some(e=>e.startsWith('docker compose')&&/\b(up|start)\b/.test(e)),'unsafe candidate was started before embedded flag verification');
 console.log('PASS '+scenario);
}
// Execute only the read-only legacy refusal block, replacing SSH with local bash.
const deploy = fs.readFileSync('scripts/deploy-prod.sh','utf8').replaceAll('\r\n','\n');
const guardStart=deploy.indexOf('if [ "$REPLACE_GENERATION" = 1 ]; then\n',deploy.indexOf('OLD=$('));
const guardEnd=deploy.indexOf('\necho "сервер:',guardStart);
assert.ok(guardStart>=0&&guardEnd>guardStart,'legacy preflight block missing');
for(const legacy of [false,true]){
 const stateFile=path.join(dir,'state.json');
 fs.writeFileSync(stateFile,JSON.stringify({events:[],legacy,candidate:false}));
 const code='export PATH="$PWD/output/codex-t7/bluegreen-shim:$PATH"\ndie(){ exit 1; }\nREPLACE_GENERATION=1\nSSH=(bash -c)\n'+deploy.slice(guardStart,guardEnd);
 const result=cp.spawnSync(bash,['-c',code],{encoding:'utf8',windowsHide:true,env:{...process.env,BG_STATE:stateFile}});
 assert.equal(result.status,legacy?0:1,result.stderr);
 const after=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 assert.ok(after.events.every(event=>event.startsWith('docker ps ')),'legacy preflight mutated resources');
 console.log('PASS legacy-readonly-'+(legacy?'before-migration':'reject-live-slot'));
}
// Migrate-only must not fall through to compose up with an empty service list.
const migrateStart=deploy.indexOf('# Migrate-only cannot start');
const migrateEnd=deploy.indexOf('# Blue-green app includes',migrateStart);
assert.ok(migrateStart>=0&&migrateEnd>migrateStart,'migrate-only early refusal missing');
assert.ok(migrateStart<deploy.indexOf('step "Предпроверка"'),'migrate-only must fail before git/SSH/build');
for(const services of [[],['app'],['migrate','app'],['workers'],['migrate'],['migrate','migrate']]){
 const code='die(){ exit 1; }\nSERVICES=("$@")\n[ ${#SERVICES[@]} -ne 0 ] || SERVICES=(app workers)\n'+deploy.slice(migrateStart,migrateEnd);
 const result=cp.spawnSync(bash,['-c',code,'guard',...services],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,services.length&&services.every(service=>service==='migrate')?1:0,result.stderr);
 console.log('PASS migrate-selection-'+(services.join('-')||'default'));
}
// Default deployment must inspect the existing host before touching tags/git/DDL.
const hostStart=deploy.indexOf('# Default blue-green host preflight');
const hostEnd=deploy.indexOf('\necho "сервер:',hostStart);
assert.ok(hostStart>=0&&hostEnd>hostStart,'default Caddy preflight missing');
assert.ok(hostStart<deploy.indexOf('NEW_MIGRATIONS='),'host preflight must precede migration/image changes');
for(const scenario of ['ok','unknown','unknown-upstream','default-invalid','missing-config']){
 const stateFile=path.join(dir,'state.json'),snippet=path.join(dir,'app-upstream.caddy'),config=path.join(dir,'Caddyfile');
 fs.writeFileSync(stateFile,JSON.stringify({events:[],failure:scenario}));
 fs.writeFileSync(config,scenario==='unknown'?':8080 { reverse_proxy localhost:3000 }\n':':8080 {\n handle {\n import app-upstream.caddy\n }\n}\n');
 fs.writeFileSync(snippet,'reverse_proxy 127.0.0.1:'+(scenario==='unknown-upstream'?'9999':'3000')+'\n');
 if(scenario==='missing-config')fs.unlinkSync(config);
 const guard=deploy.slice(hostStart,hostEnd).replaceAll('/etc/caddy/Caddyfile',config.replaceAll('\\','/')).replaceAll('/etc/caddy/app-upstream.caddy',snippet.replaceAll('\\','/'));
 const code='export PATH="$PWD/output/codex-t7/bluegreen-shim:$PATH"\ndie(){ exit 1; }\nREPLACE_GENERATION=0\nSERVICES=(app workers)\nSSH=(bash -c)\n'+guard;
 const result=cp.spawnSync(bash,['-c',code],{encoding:'utf8',windowsHide:true,env:{...process.env,BG_STATE:stateFile,BLUEGREEN_CADDY_SNIPPET:snippet}});
 assert.equal(result.status,scenario==='ok'?0:1,result.stderr);
 const after=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 assert.ok(after.events.every(event=>event.startsWith('caddy validate ')),'default host preflight mutated resources');
 console.log('PASS default-readonly-'+scenario);
}
