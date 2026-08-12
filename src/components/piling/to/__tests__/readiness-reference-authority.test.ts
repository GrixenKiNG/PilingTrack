import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

describe('readiness center authority boundary', () => {
  // Экран центра готовности живёт в своём файле; раньше проверка вырезала его
  // из общего readiness-reference-ui.tsx между двумя именами функций. После
  // разбора файла срез стал пустым, и запреты ниже начали проходить впустую —
  // пустая строка не совпадает ни с одним шаблоном. Отсюда явная проверка,
  // что источник вообще прочитан.
  const center = readFileSync(
    resolve(process.cwd(), 'src/components/piling/to/readiness/screens/readiness-centre.tsx'),
    'utf8',
  );

  it('reads the centre source', () => {
    expect(center.length).toBeGreaterThan(1000);
    expect(center).toContain('function ReadinessCentre');
  });

  it('renders decision-bearing center fields from the authoritative presentation', () => {
    expect(center).toContain('buildAuthoritativeReadinessPresentation');
    expect(center).toContain('presentation.stages.map');
    expect(center).toContain('presentation.evidence.map');
    expect(center).toContain('presentation.nextAction');
    expect(center).toContain('presentation.score');
  });

  it('does not chain authoritative values to legacy score or readiness fallbacks', () => {
    expect(center).not.toMatch(/authoritativeCurrent\?\.score\s*\?\?/);
    expect(center).not.toMatch(/scoreResult\?\.score/);
    expect(center).not.toMatch(/readiness\?\.score/);
    expect(center).not.toMatch(/readiness\?\.evidence/);
  });
});
