import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
describe('disposable database cleanup boundaries', () => {
  it.each(['', 'pilingtrack-postgres', 'codex-pg-../../owner'])('refuses unsafe container name %j before Docker', (name) => {
    const result = spawnSync(bash, ['scripts/test-db-down.sh', name], { encoding: 'utf8' });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain('codex-pg-');
  });
});
