import { describe, it, expect } from 'vitest';
import { STATUS_LABEL, STATUS_STYLE, PRIORITY_LABEL, TYPE_LABEL, TYPE_STYLE, MAINTENANCE_TYPE_OPTIONS } from '../maintenance-labels';

describe('maintenance-labels', () => {
  it('covers all 6 statuses with label + style', () => {
    const keys = ['PLANNED','ASSIGNED','IN_PROGRESS','ON_HOLD','DONE','CANCELLED'] as const;
    for (const k of keys) { expect(STATUS_LABEL[k]).toBeTruthy(); expect(STATUS_STYLE[k]).toBeTruthy(); }
  });
  it('covers all 4 priorities and maintenance types', () => {
    for (const k of ['LOW','NORMAL','HIGH','CRITICAL'] as const) expect(PRIORITY_LABEL[k]).toBeTruthy();
    expect(MAINTENANCE_TYPE_OPTIONS).toEqual(['EO','TO1','TO2','TO3','SEASONAL','REPAIR','FAULT','SCHEDULED','INSPECTION']);
    for (const k of MAINTENANCE_TYPE_OPTIONS) {
      expect(TYPE_LABEL[k]).toBeTruthy();
      expect(TYPE_STYLE[k]).toBeTruthy();
    }
  });
});
