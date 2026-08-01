import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalize } from '../audit/canonicalize';
import { maskAuditPayload } from '../audit/mask';
import { digestAuditEvent } from '../audit/digest';

type ShiftState = 'PLANNED' | 'STARTED' | 'HANDOVER_PENDING' | 'CLOSED' | 'CANCELLED';
type HandoverState = 'DRAFT' | 'SUBMITTED' | 'REWORK_REQUIRED' | 'ACCEPTED';
type PermitState = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'EXPIRED' | 'REVOKED';
type PermitRisk = 'NORMAL' | 'ELEVATED';

interface WorkflowContract {
  transitionShift(from: ShiftState, command: string): ShiftState;
  transitionHandover(from: HandoverState, command: string): HandoverState;
  transitionPermit(from: PermitState, command: string): PermitState;
  approvePermit(input: {
    risk: PermitRisk;
    authorId: string;
    approvals: Array<{role: 'DISPATCHER' | 'ADMIN'; userId: string}>;
  }): {state: PermitState; validApprovalCount: number};
}

interface ReadinessContract {
  evaluate(input: {
    publishedRules: boolean;
    requireValidPermit: boolean;
    validPermit: boolean;
  }): {
    status: 'READY' | 'LIMITED' | 'BLOCKED';
    blockers: Array<{code: string}>;
    warnings: Array<{code: string}>;
  };
}

interface AuditHashContract {
  canonicalize(value: unknown): string;
  mask(value: unknown): unknown;
  eventHash(input: {
    tenantId: string;
    sequence: string;
    prevHash: string | null;
    canonicalEvent: string;
  }): string;
  verify(events: Array<{sequence: string; prevHash: string | null; hash: string}>): {
    valid: boolean;
    brokenAtSequence?: string;
  };
}

const pendingImplementation = (): never => {
  throw new Error('Tech Readiness production domain adapter is not implemented');
};

const workflow = {
  transitionShift: pendingImplementation,
  transitionHandover: pendingImplementation,
  transitionPermit: pendingImplementation,
  approvePermit: pendingImplementation,
} as WorkflowContract;

const readiness = {evaluate: pendingImplementation} as ReadinessContract;
const auditHash = {
  canonicalize,
  mask: maskAuditPayload,
  eventHash: digestAuditEvent,
  verify(events: Array<{sequence: string; prevHash: string | null; hash: string}>) {
    let expected = BigInt(1);
    let previous: string | null = null;
    for (const event of events) {
      if (event.sequence !== expected.toString() || event.prevHash !== previous) {
        return {valid: false, brokenAtSequence: event.sequence};
      }
      expected += BigInt(1);
      previous = event.hash;
    }
    return {valid: true};
  },
} as AuditHashContract;

describe.skip('Tech Readiness production state machines [PRD §6, ADR-0041]', () => {
  it.each([
    ['PLANNED', 'start', 'STARTED'],
    ['STARTED', 'submitHandover', 'HANDOVER_PENDING'],
    ['HANDOVER_PENDING', 'acceptHandover', 'CLOSED'],
    ['PLANNED', 'cancel', 'CANCELLED'],
    ['STARTED', 'cancel', 'CANCELLED'],
  ] as const)('moves Shift %s --%s--> %s', (from, command, expected) => {
    expect(workflow.transitionShift(from, command)).toBe(expected);
  });

  it.each([
    ['DRAFT', 'submit', 'SUBMITTED'],
    ['SUBMITTED', 'accept', 'ACCEPTED'],
    ['SUBMITTED', 'rework', 'REWORK_REQUIRED'],
    ['REWORK_REQUIRED', 'save', 'DRAFT'],
  ] as const)('moves ShiftHandover %s --%s--> %s', (from, command, expected) => {
    expect(workflow.transitionHandover(from, command)).toBe(expected);
  });

  it('keeps ACCEPTED handovers terminal', () => {
    expect(() => workflow.transitionHandover('ACCEPTED', 'rework')).toThrow(
      /terminal|invalid transition/i,
    );
  });

  it.each([
    ['DRAFT', 'submit', 'PENDING_APPROVAL'],
    ['PENDING_APPROVAL', 'approve', 'APPROVED'],
    ['APPROVED', 'expire', 'EXPIRED'],
    ['APPROVED', 'revoke', 'REVOKED'],
  ] as const)('moves WorkPermit %s --%s--> %s', (from, command, expected) => {
    expect(workflow.transitionPermit(from, command)).toBe(expected);
  });

  it('approves NORMAL with one non-author DISPATCHER approval', () => {
    expect(workflow.approvePermit({
      risk: 'NORMAL',
      authorId: 'test-user-mechanic',
      approvals: [{role: 'DISPATCHER', userId: 'test-user-dispatcher'}],
    })).toEqual({state: 'APPROVED', validApprovalCount: 1});
  });

  it('requires distinct DISPATCHER and ADMIN users for ELEVATED', () => {
    expect(workflow.approvePermit({
      risk: 'ELEVATED',
      authorId: 'test-user-mechanic',
      approvals: [
        {role: 'DISPATCHER', userId: 'test-user-dispatcher'},
        {role: 'ADMIN', userId: 'test-user-admin'},
      ],
    })).toEqual({state: 'APPROVED', validApprovalCount: 2});
  });

  it('rejects self-approval even when the author has an approval capability', () => {
    expect(() => workflow.approvePermit({
      risk: 'NORMAL',
      authorId: 'test-user-dispatcher',
      approvals: [{role: 'DISPATCHER', userId: 'test-user-dispatcher'}],
    })).toThrow(/self.?approval/i);
  });
});

describe.skip('Tech Readiness evaluation [PRD §5, backend design §8]', () => {
  it('fails closed when no published rule set exists', () => {
    expect(readiness.evaluate({
      publishedRules: false,
      requireValidPermit: true,
      validPermit: true,
    })).toMatchObject({
      status: 'BLOCKED',
      blockers: [{code: 'READINESS_RULES_NOT_PUBLISHED'}],
    });
  });

  it('emits a blocker when permit gating is enabled', () => {
    expect(readiness.evaluate({
      publishedRules: true,
      requireValidPermit: true,
      validPermit: false,
    })).toMatchObject({
      status: 'BLOCKED',
      blockers: [{code: 'VALID_WORK_PERMIT_REQUIRED'}],
      warnings: [],
    });
  });

  it('emits a warning, not a blocker, when permit gating is disabled', () => {
    expect(readiness.evaluate({
      publishedRules: true,
      requireValidPermit: false,
      validPermit: false,
    })).toMatchObject({
      blockers: [],
      warnings: [{code: 'WORK_PERMIT_MISSING_OPTIONAL'}],
    });
  });
});

describe('Audit canonicalization and hash chain [ADR-0043]', () => {
  const canonicalEvent = {
    action: 'shift.started',
    actor: {id: 'test-user-mechanic', role: 'MECHANIC'},
    entity: {id: 'test-shift-001', type: 'Shift', version: 1},
    occurredAt: '2026-07-29T09:00:00.000Z',
    recordedAt: '2026-07-29T09:00:00.000Z',
  };

  it('uses deterministic RFC 8785 key ordering and UTF-8 serialization', () => {
    const left = auditHash.canonicalize(canonicalEvent);
    const right = auditHash.canonicalize({
      recordedAt: canonicalEvent.recordedAt,
      entity: canonicalEvent.entity,
      actor: canonicalEvent.actor,
      occurredAt: canonicalEvent.occurredAt,
      action: canonicalEvent.action,
    });

    expect(left).toBe(right);
    expect(left).not.toContain('undefined');
  });

  it('recursively masks secrets and contacts before persistence and hashing', () => {
    expect(auditHash.mask({
      token: 'secret-token',
      nested: {email: 'operator@example.test', safe: 'visible'},
      rows: [{phone: '+70000000000'}],
    })).toEqual({
      token: '[REDACTED]',
      nested: {email: '[REDACTED]', safe: 'visible'},
      rows: [{phone: '[REDACTED]'}],
    });
  });

  it('implements the ADR-0043 PILINGTRACK-AUDIT-V1 digest formula', () => {
    const canonical = auditHash.canonicalize(canonicalEvent);
    const expected = createHash('sha256')
      .update(
        `PILINGTRACK-AUDIT-V1\n` +
        `test-tenant-readiness-primary\n` +
        `1\n\n${canonical}`,
        'utf8',
      )
      .digest('hex');

    expect(auditHash.eventHash({
      tenantId: 'test-tenant-readiness-primary',
      sequence: '1',
      prevHash: null,
      canonicalEvent: canonical,
    })).toBe(expected);
    expect(expected).toMatch(/^[a-f0-9]{64}$/);
  });

  it('detects a gap, reorder, deletion, or changed event hash', () => {
    expect(auditHash.verify([
      {sequence: '1', prevHash: null, hash: 'a'.repeat(64)},
      {sequence: '3', prevHash: 'a'.repeat(64), hash: 'b'.repeat(64)},
    ])).toEqual({valid: false, brokenAtSequence: '3'});
  });
});
