import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createFixture } from './helpers/disposable-db';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
describe('restore drill input boundaries', () => {
  it('refuses missing input before creating a container', () => {
    const result = spawnSync(bash, ['scripts/restore-drill.sh'], { encoding: 'utf8' });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain('Usage:');
  });
  it('refuses a corrupt compressed dump before creating a container', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'codex-drill-'));
    try {
      const dump = path.join(dir, 'corrupt.sql.gz');
      writeFileSync(dump, 'not a gzip archive');
      writeFileSync(dump + '.manifest.json', '{}');
      expect(existsSync(dump)).toBe(true);
      const result = spawnSync(bash, ['scripts/restore-drill.sh', dump], { encoding: 'utf8' });
      expect(result.status).toBe(65);
      expect(result.stderr).toContain('Invalid gzip');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

const enabled = Boolean(process.env.INTEGRATION_DATABASE_URL_OWNER && process.env.INTEGRATION_DATABASE_URL_APP && process.env.INTEGRATION_DB_CONTAINER);
if (!enabled) console.info('SKIP real restore drill: set both INTEGRATION_DATABASE_URL_* and INTEGRATION_DB_CONTAINER from test-db-up.sh');
describe.skipIf(!enabled)('restore synthetic dump from one consistent snapshot', () => {
  it('restores all tables/migrations/RLS, detects a wrong manifest and removes its target', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'codex-drill-'));
    const fixture = await createFixture();
    const containers = () => {
      const result = spawnSync('docker', ['ps', '-a', '--filter', 'label=pilingtrack.codex.test-db=1', '--format', '{{.Names}}'], { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim().split('\n').sort();
    };
    const before = containers();
    try {
      const dump = path.join(dir, 'synthetic.sql.gz');
      const create = spawnSync(process.execPath, ['scripts/test-db-dump.cjs', process.env.INTEGRATION_DB_CONTAINER!, dump], { encoding: 'utf8' });
      expect(create.status, create.stdout + create.stderr).toBe(0);
      console.info(create.stdout.trim());
      const restored = spawnSync(bash, ['scripts/restore-drill.sh', dump], { encoding: 'utf8' });
      expect(restored.status, restored.stdout + restored.stderr).toBe(0);
      console.info(restored.stdout.trim());
      expect(restored.stdout).toContain('RESTORE OK:');
      for (const table of ['Report', 'Site', 'Equipment', 'Inspection', 'Shift', 'AuditLog']) {
        expect(restored.stdout).toContain(`${table}: source=2, restored=2, app without tenant=0`);
      }
      const wrongManifest = dump + '.wrong.json';
      const data = JSON.parse(readFileSync(dump + '.manifest.json', 'utf8'));
      data.snapshot.counts.Report = '3';
      writeFileSync(wrongManifest, JSON.stringify(data));
      const mismatch = spawnSync(bash, ['scripts/restore-drill.sh', dump, wrongManifest], { encoding: 'utf8' });
      expect(mismatch.status).toBe(1);
      expect(mismatch.stderr).toContain('Restore mismatch in counts');
      expect(containers()).toEqual(before);
    } finally {
      await fixture.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});