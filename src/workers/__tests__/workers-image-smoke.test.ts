import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const script = path.join(root, 'scripts/smoke-workers-image.sh');
const bash = process.platform === 'win32'
  ? path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe')
  : 'bash';
const temporary: string[] = [];

// Проверяем сам скрипт, подменяя только Docker; контейнеров и сети здесь нет.
function runSmoke(output: string, exits = false) {
  const parent = path.join(root, '.tmp-check');
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'workers-smoke-'));
  temporary.push(directory);
  const cleanup = path.join(directory, 'cleanup.log');
  const result = spawnSync(bash, ['-c', `
    docker() {
      case "$1" in
        run) printf '%s\\n' "$SMOKE_OUTPUT"; ${exits ? 'return 1' : 'command sleep 4'} ;;
        inspect) printf 'true\\n' ;;
        rm) printf '%s\\n' "$*" >> "$SMOKE_CLEANUP" ;;
        *) return 1 ;;
      esac
    }
    export -f docker
    source "$1" test-workers:smoke
  `, '--', script.replaceAll('\\', '/')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, SMOKE_OUTPUT: output, SMOKE_CLEANUP: cleanup.replaceAll('\\', '/') },
  });
  return { ...result, cleanup: fs.existsSync(cleanup) ? fs.readFileSync(cleanup, 'utf8') : '' };
}

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('smoke образа workers', () => {
  it('принимает живой процесс только после старта и Arming, удаляет контейнер', () => {
    const result = runSmoke('Unified Worker Service starting\nArming PM scheduler');
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.cleanup).toContain('rm -f codex-workers-smoke-');
  });

  it.each(['Cannot find module', 'MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'SyntaxError', 'ReferenceError'])(
    'отвергает %s даже вместе с обеими строками старта', (fatal) => {
      const result = runSmoke(`Unified Worker Service starting\nArming\n${fatal}`);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(fatal);
      expect(result.cleanup).toContain('rm -f codex-workers-smoke-');
    },
  );

  it('отвергает ранний выход и печатает сохранённый лог после auto-remove', () => {
    const result = runSmoke('early startup failure', true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('early startup failure');
    expect(result.cleanup).toContain('rm -f codex-workers-smoke-');
  });

  it('workers smoke стоит до первого обращения к серверу и сохраняет аварийный обход', () => {
    const deploy = fs.readFileSync(path.join(root, 'scripts/deploy-prod.sh'), 'utf8');
    const smoke = deploy.indexOf('bash "$(dirname "${BASH_SOURCE[0]}")/smoke-workers-image.sh"');
    expect(smoke).toBeGreaterThan(-1);
    expect(smoke).toBeLessThan(deploy.indexOf('OLD=$("${SSH[@]}"'));
    expect(deploy).toContain('SKIP_WORKERS_SMOKE');
  });
});
