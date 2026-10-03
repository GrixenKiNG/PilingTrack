const fs = require('node:fs');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const https = require('node:https');
const http = require('node:http');
const path = require('node:path');
const dir='output/codex-t5';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const names=[];const processes=[];const sensitive=[];let s3Proxy;let s3CaFile;
const env={...process.env,DATABASE_URL:process.env.INTEGRATION_DATABASE_URL_APP,DATABASE_URL_POSTGRES:process.env.INTEGRATION_DATABASE_URL_APP,DATABASE_PROVIDER:'postgres',DB_IDENTITY_ROLE:'pilingtrack_identity',SESSION_SECRET:crypto.randomBytes(32).toString('hex'),DEVICE_KEY_LOOKUP_SECRET:crypto.randomBytes(32).toString('hex'),NODE_OPTIONS:'--trace-warnings',LOG_LEADER_ELECTION:'true',HOSTNAME:'0.0.0.0',TRUST_PROXY:'true'};
for(const role of ['ADMIN','DISPATCHER','OPERATOR','ASSISTANT','OPERATOR_B']){env['E2E_'+role+'_EMAIL']='codex-'+role.toLowerCase()+'@example.invalid';env['E2E_'+role+'_PASSWORD']=crypto.randomBytes(20).toString('hex');}
for(const [key,value] of Object.entries(env)){if(/PASSWORD|SECRET|DATABASE_URL/.test(key)&&value)sensitive.push(value);}
function redact(s){for(const value of sensitive)s=s.split(value).join('[redacted]');return s;}
function spawn(exe,args,label,extra={}){const log=fs.createWriteStream(dir+'/'+label+'.log',{flags:'w'});const child=cp.spawn(exe,args,{env:{...env,...extra},windowsHide:true,stdio:['ignore','pipe','pipe']});processes.push(child);child.stdout.on('data',b=>log.write(redact(b.toString())));child.stderr.on('data',b=>log.write(redact(b.toString())));child.on('close',()=>log.end());return child;}
function wait(child){return new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve(code??(signal?1:0)));});}
const docker=args=>cp.execFileSync('docker',args,{env:{...process.env,MINIO_ROOT_USER:env.S3_ACCESS_KEY_ID,MINIO_ROOT_PASSWORD:env.S3_SECRET_ACCESS_KEY},encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
(async()=>{try{
for(const kind of ['state','cache']){const name='codex-redis-'+kind+'-'+crypto.randomBytes(6).toString('hex');docker(['run','-d','--name',name,'--label','pilingtrack.codex.day-stand=1','-p','127.0.0.1::6379','redis:7-alpine','redis-server','--maxmemory','128mb','--maxmemory-policy',kind==='state'?'noeviction':'allkeys-lru']);names.push(name);const mapped=docker(['port',name,'6379/tcp']).split(':').pop();env[kind==='state'?'REDIS_URL':'REDIS_URL_CACHE']='redis://127.0.0.1:'+mapped;}
if(process.env.CODEX_WITH_S3==='true') {
  const name='codex-s3-'+crypto.randomBytes(6).toString('hex');
  env.S3_ACCESS_KEY_ID='codex'+crypto.randomBytes(6).toString('hex');env.S3_SECRET_ACCESS_KEY=crypto.randomBytes(24).toString('hex');sensitive.push(env.S3_ACCESS_KEY_ID,env.S3_SECRET_ACCESS_KEY);
  docker(['run','-d','--name',name,'--label','pilingtrack.codex.day-stand=1','-p','127.0.0.1::9000','-e','MINIO_ROOT_USER','-e','MINIO_ROOT_PASSWORD','-e','MINIO_API_CORS_ALLOW_ORIGIN=*','codex-s3-t5:e7','server','/data']);names.push(name);
  const mapped=docker(['port',name,'9000/tcp']).split(':').pop();let healthy=false;
  for(let i=0;i<30;i++){try{if((await fetch('http://127.0.0.1:'+mapped+'/minio/health/ready')).ok){healthy=true;break;}}catch{}await sleep(1000);}if(!healthy)throw Error('Own S3 not ready');
  const pem=cp.execFileSync('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost','-keyout','-','-out','-'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']});
  const key=pem.match(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/)[0];const cert=pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)[0];
  s3CaFile=path.resolve(dir,name+'-public-ca.pem');fs.writeFileSync(s3CaFile,cert);env.NODE_EXTRA_CA_CERTS=s3CaFile;
  s3Proxy=https.createServer({key,cert},(req,res)=>{const target=http.request({hostname:'127.0.0.1',port:mapped,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});target.on('error',()=>{res.writeHead(502);res.end('Own S3 unavailable');});res.on('close',()=>target.destroy());req.pipe(target);});
  await new Promise(r=>s3Proxy.listen(0,'127.0.0.1',r));env.S3_ENDPOINT='https://127.0.0.1:'+s3Proxy.address().port;env.S3_REGION='us-east-1';env.S3_BUCKET='codex-photos';
  const code=await wait(spawn(process.execPath,['e2e/fixtures/disposable-s3.mjs'],'stand-s3'));if(code!==0)throw Error('Own S3 verification failed');env.E2E_S3_READY='true';
}
const appPort=await port();env.PORT=String(appPort);env.BASE_URL='http://127.0.0.1:'+appPort;env.WORKER_HEALTH_PORT=String(await port());
fs.writeFileSync(dir+'/stand-public.json',JSON.stringify({baseURL:env.BASE_URL,workerHealthPort:env.WORKER_HEALTH_PORT,redis:names.filter(n=>n.startsWith('codex-redis-')),s3:env.E2E_S3_READY==='true'},null,2));
const seed=await wait(spawn(process.execPath,['e2e/fixtures/disposable-seed.mjs'],'seed'));
for(const fixture of ['disposable-to-seed.mjs','disposable-extra-seed.mjs']) { const code=await wait(spawn(process.execPath,['e2e/fixtures/'+fixture],fixture)); if(code!==0)throw Error('fixture failed'); } console.log('SEED exit '+seed);if(seed!==0)throw Error('seed failed');
const build=await wait(spawn('C:/Program Files/Git/bin/bash.exe',['-c','npm run build'],'stand-build'));
console.log('BUILD exit '+build);if(build!==0)throw Error('build failed');
spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',env.PORT,'-H','127.0.0.1'],'stand-app',{NODE_ENV:'production'});
spawn(process.execPath,['--import','tsx','src/workers/unified-worker.ts'],'stand-workers',{NODE_ENV:'production'});
let ready=false;for(let i=0;i<90;i++){try{const r=await fetch(env.BASE_URL+'/api/health');if(r.ok){ready=true;break;}}catch{}await sleep(1000);}if(!ready)throw Error('app not ready');
console.log('READY '+env.BASE_URL);
while(true){const f=dir+'/stand-command.json';if(!fs.existsSync(f)){await sleep(300);continue;}const command=JSON.parse(fs.readFileSync(f,'utf8'));fs.unlinkSync(f);if(command.stop)break;const result=await wait(spawn(command.exe||process.execPath,command.args,command.id));fs.writeFileSync(dir+'/'+command.id+'-result.json',JSON.stringify({exit:result}));console.log(command.id+' exit '+result);}
}finally{if(s3Proxy){s3Proxy.closeAllConnections();s3Proxy.close();}if(s3CaFile)fs.rmSync(s3CaFile,{force:true});for(const child of processes){if(child.exitCode===null){if(process.platform==='win32')cp.spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGTERM');}}for(const name of names){try{docker(['rm','-f',name]);}catch{}}console.log('CLEANUP done');}})().catch(e=>{console.error(redact(e.message));process.exitCode=1;});
