// Execute workflow guards offline; every SSH, Docker and smoke command is replaced.
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');
const workflow = yaml.load(fs.readFileSync('.github/workflows/deploy.yml', 'utf8'));
const job = workflow.jobs.deploy;
function step(name) {
  const found = job.steps.find(item => item.name === name);
  assert.ok(found?.run, 'Missing guarded step: ' + name);
  return found.run;
}
const sha = 'a'.repeat(40);
const parent = path.resolve('.tmp-check'); fs.mkdirSync(parent, { recursive: true });
const dir = fs.mkdtempSync(path.join(parent, 'deploy-workflow-'));
const log = path.join(dir, 'commands.log');
const remote = path.join(dir, 'remote.sh');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const stubs = `
  cd() { return 0; }
  git() {
    printf 'git %s\\n' "$*" >> "$TEST_LOG"
    case "$*" in
      'rev-parse origin/main') printf '%s\\n' "$MAIN_SHA" ;;
      'rev-parse HEAD') printf '%s\\n' "$HEAD_SHA" ;;
      'branch --show-current') printf '%s\\n' "$BRANCH" ;;
      'diff --quiet'|'diff --cached --quiet') return "$DIRTY" ;;
      'merge --ff-only origin/main') HEAD_SHA="$MAIN_SHA" ;;
      'fetch origin main') return 0 ;;
      *) return 99 ;;
    esac
  }
  docker() {
    printf 'docker %s\\n' "$*" >> "$TEST_LOG"
    case "$1" in
      build) return "$BUILD_EXIT" ;;
      save) printf 'offline image stream'; return "$SAVE_EXIT" ;;
      inspect) printf 'sha256:%064d\\n' 1 ;;
      tag) return 0 ;;
      *) return 99 ;;
    esac
  }
  bash() {
    printf 'bash %s\\n' "$*" >> "$TEST_LOG"
    case "$1" in
      scripts/smoke-workers-image.sh) return "$SMOKE_EXIT" ;;
      scripts/replace-worker-generation.sh) printf 'barrier external=%s\n' "$WORKER_GENERATION_EXTERNAL_STOPPED" >> "$TEST_LOG"; return "$BARRIER_EXIT" ;;
      *) return 99 ;;
    esac
  }
  ssh() {
    printf 'ssh %s\\n' "$*" >> "$TEST_LOG"
    if [[ "$*" == *gunzip* ]]; then cat >/dev/null; else cat > "$TEST_REMOTE"; fi
  }
`;
function run(script, env = {}) {
  fs.writeFileSync(log, '');
  const result = cp.spawnSync(bash, ['-e', '-o', 'pipefail', '-c', stubs + '\n' + script, '--', sha], {
    encoding: 'utf8', timeout: 10000, windowsHide: true,
    env: { ...process.env, DEPLOY_SHA: sha, MAIN_SHA: sha, HEAD_SHA: sha, BRANCH: 'main', DIRTY: '0',
      BUILD_EXIT: '0', SMOKE_EXIT: '0', SAVE_EXIT: '0', BARRIER_EXIT: '0',
      TEST_LOG: log.replaceAll('\\', '/'), TEST_REMOTE: remote.replaceAll('\\', '/'), ...env },
  });
  assert.ifError(result.error);
  return { ...result, commands: fs.readFileSync(log, 'utf8') };
}
let checks = 0;
function expectExit(result, success) {
  assert.equal(result.status === 0, success, result.stderr);
  checks++;
}
try {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(Object.keys(workflow.jobs), ['deploy']);
  assert.equal(job.environment, 'production');
  assert.ok(job.if, 'Missing owner/main gate');
  const owner = 'owner';
  const allowed = { ref: 'refs/heads/main', actor: owner, triggering_actor: owner };
  for (const [github, configuredOwner, expected] of [
    [allowed, owner, true], [allowed, '', false], [{ ...allowed, ref: 'refs/heads/feature' }, owner, false],
    [{ ...allowed, actor: 'other' }, owner, false], [{ ...allowed, triggering_actor: 'other' }, owner, false],
  ]) {
    assert.equal(vm.runInNewContext(job.if, { github, vars: { PROD_DEPLOY_OWNER: configuredOwner } }), expected);
    checks++;
  }
  const preflight = step('Confirm external worker barrier');
  for (const services of ['app', 'workers', 'app workers']) {
    const refused = run(preflight + '\n' + step('Save rollback images'), { SERVICES: services, CONFIRMED: 'false' });
    expectExit(refused, false);
    assert.doesNotMatch(refused.commands, /ssh/);
    expectExit(run(preflight, { SERVICES: services, CONFIRMED: 'true' }), true);
  }
  expectExit(run(preflight, { SERVICES: 'ws', CONFIRMED: 'true' }), false);
  const main = step('Verify main SHA');
  expectExit(run(main), true);
  for (const env of [{ MAIN_SHA: 'b'.repeat(40) }, { HEAD_SHA: 'b'.repeat(40) }, { BRANCH: 'feature' }, { DIRTY: '1' }]) {
    expectExit(run(main, env), false);
  }
  const build = step('Build SHA images + workers smoke');
  const built = run(build); expectExit(built, true);
  assert.match(built.commands, new RegExp('docker build -f Dockerfile.workers --target runner --build-arg APP_VERSION=' + sha + ' -t pilingtrack-workers:' + sha));
  assert.match(built.commands, new RegExp('bash scripts/smoke-workers-image.sh pilingtrack-workers:' + sha));
  assert.match(built.commands, new RegExp('docker build -f Dockerfile --target runner --build-arg APP_VERSION=' + sha));
  assert.match(built.commands, /docker build -f Dockerfile --target migrate/);
  assert.doesNotMatch(built.commands, /ssh|docker compose/);
  for (const env of [{ BUILD_EXIT: '1' }, { SMOKE_EXIT: '1' }]) {
    const failed = run(build + '\n' + step('Save rollback images'), env); expectExit(failed, false);
    assert.doesNotMatch(failed.commands, /ssh|--target migrate/);
  }
  expectExit(run(step('Save rollback images')), true);
  const saveRemote = fs.readFileSync(remote, 'utf8');
  expectExit(run(saveRemote, { HEAD_SHA: 'b'.repeat(40) }), true);
  for (const env of [{ MAIN_SHA: 'b'.repeat(40) }, { BRANCH: 'feature' }, { DIRTY: '1' }]) {
    const failed = run(saveRemote, env); expectExit(failed, false);
    assert.doesNotMatch(failed.commands, /docker tag/);
  }
  const transfer = step('Transfer SHA images');
  expectExit(run(transfer), true);
  const failedTransfer = run(transfer + '\n' + step('Switch main + replace generation'), { SAVE_EXIT: '1' });
  expectExit(failedTransfer, false);
  assert.doesNotMatch(failedTransfer.commands, /bash -se/);
  expectExit(run(step('Switch main + replace generation')), true);
  const switchRemote = fs.readFileSync(remote, 'utf8');
  const switched = run(switchRemote, { HEAD_SHA: 'b'.repeat(40) }); expectExit(switched, true);
  assert.ok(switched.commands.indexOf('git merge --ff-only') < switched.commands.indexOf('docker tag'));
  assert.match(switched.commands, /bash scripts\/replace-worker-generation.sh app workers/);
  assert.match(switched.commands, /barrier external=1/);
  for (const env of [{ MAIN_SHA: 'b'.repeat(40) }, { BRANCH: 'feature' }, { DIRTY: '1' }]) {
    const failed = run(switchRemote, env); expectExit(failed, false);
    assert.doesNotMatch(failed.commands, /docker tag|replace-worker-generation/);
  }
  expectExit(run(switchRemote, { BARRIER_EXIT: '1' }), false);
  assert.doesNotMatch(saveRemote + switchRemote, /docker (compose build|build|builder prune)|checkout --detach|docker compose up/);
  assert.match(saveRemote, /docker inspect --format '{{.Image}}'/);
  assert.match(switchRemote, /WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts\/replace-worker-generation.sh app workers/);
  assert.ok(job.steps.findIndex(item => item.name === 'Build SHA images + workers smoke') < job.steps.findIndex(item => item.name === 'Save rollback images'));
  assert.doesNotMatch(step('Install SSH key'), /ssh-keyscan/);
  assert.equal(job.steps.find(item => item.name === 'Install SSH key').env.SSH_KNOWN_HOSTS, '${{ secrets.PROD_SSH_KNOWN_HOSTS }}');
  console.log('PASS: ' + checks + ' offline scenarios; owner/main gate, worker confirmation, SHA builds/smoke, rollback, transfer and generation barrier; no network or Docker executed');
} finally {
  assert.equal(path.dirname(dir), parent);
  fs.rmSync(dir, { recursive: true, force: true });
}
