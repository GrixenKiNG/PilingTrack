import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const report = () => ({
  success: true, numTotalTests: 32, numPassedTests: 32, numFailedTests: 0, numPendingTests: 0,
  testResults: [
    { name: '/tests/integration/disposable-rls.spec.ts', assertionResults: Array.from({ length: 21 }, () => ({ status: 'passed' })) },
    { name: '/tests/integration/tech-readiness-write-pipeline.spec.ts', assertionResults: Array.from({ length: 5 }, () => ({ status: 'passed' })) },
    { name: '/tests/integration/disposable-restore.spec.ts', assertionResults: Array.from({ length: 3 }, () => ({ status: 'passed' })) },
  ],
});
const run = (data: ReturnType<typeof report>) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codex-integration-report-'));
  try {
    const file = path.join(dir, 'result.json');
    writeFileSync(file, JSON.stringify(data));
    return spawnSync(process.execPath, ['scripts/check-integration-results.cjs', file], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
};
describe('CI integration evidence gate', () => {
  it('accepts actual executed RLS, pipeline and restore suites', () => {
    expect(run(report()).status).toBe(0);
  });
  it('rejects a green-looking run containing skips', () => {
    const data = report(); data.numPendingTests = 1; data.numPassedTests = 31;
    const result = run(data);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('All integration tests must actually pass');
  });
  it('rejects a missing suite even if aggregate counters claim success', () => {
    const data = report(); data.testResults.shift();
    const result = run(data);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Required integration suite');
  });
});
