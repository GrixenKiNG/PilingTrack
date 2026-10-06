// Execute deploy guard snippets offline. SSH is replaced before any remote step.
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const workflow = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
const lines = workflow.split(/\r?\n/);
function step(name) {
  const start = lines.findIndex(line => line === '      - name: ' + name);
  assert.ok(start >= 0, 'Missing guarded step: ' + name);
  const tail = lines.slice(start + 1);
  const end = tail.findIndex(line => line.startsWith('      - name:'));
  const block = end < 0 ? tail : tail.slice(0, end);
  const run = block.findIndex(line => line === '        run: |');
  assert.ok(run >= 0); return block.slice(run + 1).map(line => line.slice(10)).join('\n').trim();
}
const preflight = step('Confirm external worker barrier');
assert.ok(workflow.indexOf('name: Confirm external worker barrier') < workflow.indexOf('name: Install SSH key'));
const dir = path.resolve('output/codex-t6/ci-shim'); fs.mkdirSync(dir, { recursive: true });
const capture = path.join(dir, 'remote.txt');
fs.writeFileSync(path.join(dir, 'ssh'), '#!/usr/bin/env bash\nnode -e \'require("fs").writeFileSync(process.env.CI_CAPTURE,process.argv[1])\' "${@: -1}"\n');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
cp.execFileSync(bash, ['-c', 'chmod +x output/codex-t6/ci-shim/ssh']);
function run(script, services, confirmed) {
  return cp.spawnSync(bash, ['-c', script], { encoding: 'utf8', env: { ...process.env, SERVICES: services, CONFIRMED: confirmed, CI_CAPTURE: capture }, windowsHide: true });
}
for (const services of ['app', 'workers', 'app workers']) {
  assert.notEqual(run(preflight, services, 'false').status, 0, 'Unconfirmed external workers accepted');
  assert.equal(run(preflight, services, 'true').status, 0);
  const result = run('export PATH="$PWD/output/codex-t6/ci-shim:$PATH"\n' + step('Pull, rebuild, restart'), services, 'true');
  assert.equal(result.status, 0, result.stderr);
  const remote = fs.readFileSync(capture, 'utf8');
  assert.match(remote, /SVCS="app workers"/);
  assert.match(remote, /WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts\/replace-worker-generation.sh app workers/);
  assert.doesNotMatch(remote, /docker compose up/);
  assert.ok(remote.indexOf('docker tag') < remote.indexOf('docker compose build'), 'Rollback images must be saved before build');
}
assert.notEqual(run(preflight, 'ws', 'true').status, 0);
console.log('PASS: three service choices refuse missing external confirmation before SSH; confirmed dispatch always uses app+workers barrier with saved rollback images');
