import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const prefixSource = readFileSync(path.join(root, 'src/lib/redis-cache.ts'), 'utf8');
const prefixMatches = [...prefixSource.matchAll(/\bkeyPrefix:\s*(['"])([^'"]+)\1/g)];
if (prefixMatches.length !== 1) throw new Error('Не найден единственный литерал keyPrefix');
const prefix = prefixMatches[0][2];
const checker = readFileSync(
  path.join(root, 'src/core/observability/health-tracker/checkers/backup.ts'), 'utf8',
);
const reads = [...checker.matchAll(/\bclient\.get\(\s*(['"])(system:backup:[^'"]+)\1\s*\)/g)]
  .map((match) => match[2]);
const expectedKeys = new Set(reads.map((key) => prefix + key));

function extractSets(script: string): string[] {
  const active = script.split(/\r?\n/).filter((line) => !line.trimStart().startsWith('#')).join('\n');
  if (!/\bredis-cli\b/.test(active)) return [];
  const direct = [...active.matchAll(/\bredis-cli\b[^\n]*?\bSET\s+(?:"([^"]+)"|'([^']+)'|([^\s"'\\]+))/g)]
    .map((match) => match[1] ?? match[2] ?? match[3]);
  // backup-postgres передаёт команды в stdin redis-cli через printf.
  const stdin = [...active.matchAll(/^\s*["']SET\s+([^\s"']+)/gm)].map((match) => match[1]);
  return [...direct, ...stdin];
}

function verifyBackupKeys(keys: string[]): void {
  const backupKeys = keys.filter((key) => key.includes('system:backup:'));
  expect(backupKeys.length, 'Не найдены SET-команды меток бэкапа').toBeGreaterThan(0);
  for (const key of backupKeys) {
    expect(expectedKeys.has(key), 'Ключ ' + key + ' не совпадает с keyPrefix + client.get').toBe(true);
  }
  expect(new Set(backupKeys)).toEqual(expectedKeys);
}

describe('контракт Redis-меток резервного копирования', () => {
  it('извлекает префикс и все три чтения из живого приложения', () => {
    expect(prefix).toBe('pilingtrack:');
    expect(reads).toHaveLength(3);
    expect(new Set(reads).size).toBe(reads.length);
  });

  it('проверяет каждый scripts/*.sh, пишущий метки через redis-cli', () => {
    const writers = readdirSync(path.join(root, 'scripts'))
      .filter((name) => name.endsWith('.sh'))
      .map((name) => ({ name, keys: extractSets(readFileSync(path.join(root, 'scripts', name), 'utf8')) }))
      .filter(({ keys }) => keys.some((key) => key.includes('system:backup:')));
    expect(writers.map(({ name }) => name)).toContain('backup-postgres.sh');
    expect(writers.map(({ name }) => name)).toContain('backup.sh');
    for (const writer of writers) {
      expect(() => verifyBackupKeys(writer.keys), writer.name).not.toThrow();
    }
  });

  it('понимает прямые SET с кавычками и без них', () => {
    expect(extractSets('redis-cli -u "$REDIS_URL" SET "pilingtrack:system:backup:last_size" 42'))
      .toEqual(['pilingtrack:system:backup:last_size']);
    expect(extractSets("redis-cli SET 'pilingtrack:system:backup:s3_synced' true"))
      .toEqual(['pilingtrack:system:backup:s3_synced']);
    expect(extractSets('redis-cli SET pilingtrack:system:backup:last_timestamp now'))
      .toEqual(['pilingtrack:system:backup:last_timestamp']);
  });

  it('понимает stdin-команды backup-postgres.sh', () => {
    const script = [
      "printf '%s\\n' \\",
      '  "SET pilingtrack:system:backup:last_timestamp now EX 172800" \\',
      '  "SET pilingtrack:system:backup:last_size 42 EX 172800" \\',
      '  "SET pilingtrack:system:backup:s3_synced true EX 172800" | redis-cli',
    ].join('\n');
    verifyBackupKeys(extractSets(script));
  });

  it('отвергает прежние непрефиксованные команды backup-postgres.sh', () => {
    const oldScript = [
      "printf '%s\\n' \\",
      '  "SET system:backup:last_timestamp now EX 172800" \\',
      '  "SET system:backup:last_size 42 EX 172800" \\',
      '  "SET system:backup:s3_synced true EX 172800" | redis-cli',
    ].join('\n');
    expect(() => verifyBackupKeys(extractSets(oldScript))).toThrow();
  });

  it('не принимает отсутствующую метку и не учитывает комментарии', () => {
    expect(() => verifyBackupKeys([...expectedKeys].slice(1))).toThrow();
    expect(extractSets('# redis-cli SET system:backup:last_size 42')).toEqual([]);
  });
});
