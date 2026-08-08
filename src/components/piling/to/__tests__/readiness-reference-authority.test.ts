import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

describe('readiness center authority boundary', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/components/piling/to/readiness-reference-ui.tsx'),
    'utf8',
  );
  const center = source.slice(
    source.indexOf('function ReadinessCentre'),
    source.indexOf('function FleetScreen'),
  );

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
