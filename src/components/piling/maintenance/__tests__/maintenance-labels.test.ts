import { describe, it, expect } from 'vitest';
import { STATUS_LABEL, STATUS_STYLE, PRIORITY_LABEL, TYPE_LABEL } from '../maintenance-labels';

describe('maintenance-labels', () => {
  it('covers all 6 statuses with label + style', () => {
    const keys = ['PLANNED','ASSIGNED','IN_PROGRESS','ON_HOLD','DONE','CANCELLED'] as const;
    for (const k of keys) { expect(STATUS_LABEL[k]).toBeTruthy(); expect(STATUS_STYLE[k]).toBeTruthy(); }
  });
  it('covers all 4 priorities and 4 types', () => {
    for (const k of ['LOW','NORMAL','HIGH','CRITICAL'] as const) expect(PRIORITY_LABEL[k]).toBeTruthy();
    for (const k of ['SCHEDULED','REPAIR','FAULT','INSPECTION'] as const) expect(TYPE_LABEL[k]).toBeTruthy();
  });
});
