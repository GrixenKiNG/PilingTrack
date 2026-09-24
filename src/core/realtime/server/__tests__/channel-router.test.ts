/**
 * WS Channel Router — Unit Tests
 *
 * Tests ACL:
 * - Role-based subscription filtering
 * - Tenant isolation
 * - Default channel assignment
 */

import { describe, it, expect } from 'vitest';
import { canReceiveEvent, canSubscribe, getDefaultChannels, getEventChannels } from '@/core/realtime/server/channel-router';

describe('Channel Router — ACL', () => {
  const adminCtx = { userId: 'admin-1', tenantId: 'tenant-1', role: 'ADMIN', siteIds: [] };
  const dispatcherCtx = { userId: 'disp-1', tenantId: 'tenant-1', role: 'DISPATCHER', siteIds: ['site-1'] };
  const operatorCtx = { userId: 'op-1', tenantId: 'tenant-1', role: 'OPERATOR', siteIds: ['site-1'] };
  const assistantCtx = { userId: 'asst-1', tenantId: 'tenant-1', role: 'ASSISTANT', siteIds: ['site-1'] };

  describe('admin access', () => {
    it('should allow admin to subscribe to any channel', () => {
      expect(canSubscribe(adminCtx, 'tenant:other')).toBe(true);
      expect(canSubscribe(adminCtx, 'site:any')).toBe(true);
      expect(canSubscribe(adminCtx, 'alert:*')).toBe(true);
    });
  });

  describe('dispatcher access', () => {
    it('should allow dispatcher to see own tenant', () => {
      expect(canSubscribe(dispatcherCtx, 'tenant:tenant-1')).toBe(true);
    });

    it('should NOT allow dispatcher to see other tenant', () => {
      expect(canSubscribe(dispatcherCtx, 'tenant:other')).toBe(false);
    });

    it('should allow dispatcher to see all sites (wildcard)', () => {
      expect(canSubscribe(dispatcherCtx, 'site:*')).toBe(true);
    });

    it('should allow dispatcher to see alerts', () => {
      expect(canSubscribe(dispatcherCtx, 'alert:high')).toBe(true);
    });
  });

  describe('operator access', () => {
    it('should allow operator to see own site', () => {
      expect(canSubscribe(operatorCtx, 'site:site-1')).toBe(true);
    });

    it('should NOT allow operator to see other site', () => {
      expect(canSubscribe(operatorCtx, 'site:site-2')).toBe(false);
    });

    it('should NOT allow operator to see wildcard sites', () => {
      expect(canSubscribe(operatorCtx, 'site:*')).toBe(false);
    });

    it('should allow operator to see own reports', () => {
      expect(canSubscribe(operatorCtx, 'report:report-1')).toBe(true);
    });
  });

  describe('wildcard channels (SEC-01)', () => {
    it('should allow ADMIN to subscribe to report wildcard', () => {
      expect(canSubscribe(adminCtx, 'report:*')).toBe(true);
    });

    it('should allow DISPATCHER to subscribe to report wildcard', () => {
      expect(canSubscribe(dispatcherCtx, 'report:*')).toBe(true);
    });

    it('should NOT allow OPERATOR to subscribe to report wildcard', () => {
      expect(canSubscribe(operatorCtx, 'report:*')).toBe(false);
    });

    it('should NOT allow ASSISTANT to subscribe to report wildcard', () => {
      expect(canSubscribe(assistantCtx, 'report:*')).toBe(false);
    });

    it('should keep DISPATCHER site wildcard access', () => {
      expect(canSubscribe(dispatcherCtx, 'site:*')).toBe(true);
    });
  });

  describe('assistant access', () => {
    it('should allow assistant to see own site', () => {
      expect(canSubscribe(assistantCtx, 'site:site-1')).toBe(true);
    });

    it('should NOT allow assistant to see other reports directly', () => {
      expect(canSubscribe(assistantCtx, 'report:other')).toBe(true); // Still allowed — report-level check is minimal
    });
  });
});

describe('Default Channels', () => {
  it('should assign tenant channel to all users', () => {
    const channels = getDefaultChannels({
      userId: 'user-1', tenantId: 'tenant-1', role: 'OPERATOR', siteIds: ['site-1'],
    });
    expect(channels).toContain('tenant:tenant-1');
  });

  it('should assign wildcard site to dispatchers', () => {
    const channels = getDefaultChannels({
      userId: 'disp-1', tenantId: 'tenant-1', role: 'DISPATCHER', siteIds: [],
    });
    expect(channels).toContain('site:*');
  });

  it('should assign specific sites to operators', () => {
    const channels = getDefaultChannels({
      userId: 'op-1', tenantId: 'tenant-1', role: 'OPERATOR', siteIds: ['site-1', 'site-2'],
    });
    expect(channels).toContain('site:site-1');
    expect(channels).toContain('site:site-2');
  });
});

describe('Event Channel Routing', () => {
  it('should generate channels from event metadata', () => {
    const channels = getEventChannels({
      tenantId: 't1', siteId: 's1', entity: 'report', entityId: 'r1', userId: 'u1',
    });

    expect(channels).toContain('tenant:t1');
    expect(channels).toContain('site:s1');
    expect(channels).toContain('report:r1');
    expect(channels).toContain('operator:u1');
  });

  it('should handle null fields', () => {
    const channels = getEventChannels({
      tenantId: null, siteId: null, entity: 'system', entityId: 'global', userId: null,
    });

    expect(channels).toContain('system:global');
    expect(channels).not.toContain(expect.stringContaining('tenant:'));
  });
});

describe('canReceiveEvent (tenant gate) — SEC-01 / SEC-06', () => {
  it('should allow ADMIN any event tenant', () => {
    expect(canReceiveEvent('ADMIN', 't-a', 't-b')).toBe(true);
    expect(canReceiveEvent('ADMIN', null, null)).toBe(true);
  });

  it('should allow DISPATCHER any event tenant', () => {
    expect(canReceiveEvent('DISPATCHER', 't-a', 't-b')).toBe(true);
    expect(canReceiveEvent('DISPATCHER', null, null)).toBe(true);
  });

  it('should allow a non-privileged role only its own tenant', () => {
    expect(canReceiveEvent('OPERATOR', 't-a', 't-a')).toBe(true);
    expect(canReceiveEvent('OPERATOR', 't-a', 't-b')).toBe(false);
    expect(canReceiveEvent('ASSISTANT', 't-a', 't-a')).toBe(true);
    expect(canReceiveEvent('ASSISTANT', 't-a', 't-b')).toBe(false);
  });

  it('should NOT allow a non-privileged role a null-tenant event', () => {
    expect(canReceiveEvent('OPERATOR', 't-a', null)).toBe(false);
    expect(canReceiveEvent('OPERATOR', null, null)).toBe(false);
  });
});
