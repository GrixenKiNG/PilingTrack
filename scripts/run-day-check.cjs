const cp = require('node:child_process');
// Vite uses BASE_URL internally. Preserve the supervisor's app URL under an
// unreserved name before spawning Vitest; never copy credentials to disk.
const url = new URL(process.env.BASE_URL || 'http://invalid');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !/^codex-pg-[a-f0-9]{12}$/.test(process.env.INTEGRATION_DB_CONTAINER || '')) throw Error('Owned disposable stand required');
const child = cp.spawn(process.execPath, process.argv.slice(2), {env:{...process.env,CODEX_STAND_URL:url.origin},windowsHide:true,stdio:'inherit'});
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
