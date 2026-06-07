import { describe, it, expect } from 'vitest';
import { buildMediaKey } from '../media-service';

describe('buildMediaKey', () => {
  it('puts equipment docs into a per-machine folder', () => {
    expect(buildMediaKey('orion', 'equipment', 'eq_123', 'mid', '.jpg'))
      .toBe('media/orion/equipment/eq_123/mid.jpg');
  });

  it('groups by entity type for reports, inspections, maintenance', () => {
    expect(buildMediaKey('orion', 'report', 'r1', 'm', '.pdf')).toBe('media/orion/report/r1/m.pdf');
    expect(buildMediaKey('orion', 'maintenance', 'rec1', 'm', '.png')).toBe('media/orion/maintenance/rec1/m.png');
  });

  it('sanitizes path-unsafe characters in the composite inspection id', () => {
    // inspection photos use entityId = `${inspectionId}__${itemId}`
    expect(buildMediaKey('orion', 'inspection', 'ins1__item1', 'm', '.jpg'))
      .toBe('media/orion/inspection/ins1__item1/m.jpg');
    expect(buildMediaKey('orion', 'site', 'a/b c', 'm', '.jpg'))
      .toBe('media/orion/site/a_b_c/m.jpg');
  });

  it('falls back to misc/ when no entity is given', () => {
    expect(buildMediaKey('orion', null, null, 'm', '.jpg')).toBe('media/orion/misc/m.jpg');
    expect(buildMediaKey('orion', 'equipment', undefined, 'm', '.jpg')).toBe('media/orion/misc/m.jpg');
  });
});
