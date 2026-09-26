/**
 * Client Manager — Unit Tests
 *
 * Tests:
 * - Client lifecycle (add/remove)
 * - sendToClient / broadcast / broadcastToChannel
 * - subscribe / unsubscribe
 * - getChannelMembers / getClientCount
 * - Dead connection cleanup
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClientManager } from '@/core/realtime/server/client-manager';

// ============================================================
// Mock WebSocket factory
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
function createMockWs(): any {
  return {
    readyState: 1 /* WebSocket.OPEN */,
    send: vi.fn(),
    terminate: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
  };
}

// Silence logger during tests
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ClientManager', () => {
  let manager: ClientManager;

  beforeEach(() => {
    manager = new ClientManager();
  });

  // ============================================================
  // addClient
  // ============================================================

  describe('addClient', () => {
    it('should add a client and return a unique ID', () => {
      const ws = createMockWs();
      const id = manager.addClient(ws, {
        userId: 'user-1',
        tenantId: 'tenant-1',
        role: 'OPERATOR',
      });

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(manager.size).toBe(1);
    });

    it('should add multiple clients with unique IDs', () => {
      const id1 = manager.addClient(createMockWs(), { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });
      const id2 = manager.addClient(createMockWs(), { userId: 'u2', tenantId: 't1', role: 'OPERATOR' });

      expect(id1).not.toBe(id2);
      expect(manager.size).toBe(2);
    });

    it('should auto-subscribe to tenant channel when tenantId is provided', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });

      const stats = manager.getStats();
      expect(stats.channels).toBeGreaterThanOrEqual(1);
    });

    it('should not add tenant subscription when tenantId is null', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'u1', tenantId: null, role: 'ADMIN' });

      const stats = manager.getStats();
      // Only channels explicitly subscribed should exist
      expect(stats.totalClients).toBe(1);
    });
  });

  // ============================================================
  // removeClient
  // ============================================================

  describe('removeClient', () => {
    it('should remove a client by WebSocket instance', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });
      expect(manager.size).toBe(1);

      manager.removeClient(ws);
      expect(manager.size).toBe(0);
    });

    it('should be a no-op when removing unknown WebSocket', () => {
      const unknownWs = createMockWs();
      expect(() => manager.removeClient(unknownWs)).not.toThrow();
      expect(manager.size).toBe(0);
    });

    it('should remove internal mappings', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });

      manager.removeClient(ws);

      // Client should not be retrievable
      const client = manager.getClient(ws);
      expect(client).toBeUndefined();
    });
  });

  // ============================================================
  // allClients
  // ============================================================

  describe('allClients', () => {
    it('should iterate over every connected client', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      manager.addClient(ws1, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });
      manager.addClient(ws2, { userId: 'u2', tenantId: 't1', role: 'OPERATOR' });

      const clients = Array.from(manager.allClients());
      expect(clients).toHaveLength(2);
      expect(clients.map(c => c.userId).sort()).toEqual(['u1', 'u2']);
    });

    it('should be empty when no clients are connected', () => {
      expect(Array.from(manager.allClients())).toHaveLength(0);
    });
  });

  // ============================================================
  // sendToClient
  // ============================================================

  describe('sendToClient', () => {
    it('should send data to a connected client', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });

      const result = manager.sendToClient(ws, JSON.stringify({ type: 'test' }));

      expect(result).toBe(true);
      expect(ws.send).toHaveBeenCalledTimes(1);
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }));
    });

    it('should return false when WebSocket is not OPEN', () => {
      const ws = createMockWs();
      ws.readyState = 3; // WebSocket.CLOSED
      manager.addClient(ws, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });

      const result = manager.sendToClient(ws, 'data');

      expect(result).toBe(false);
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('should return false when send throws', () => {
      const ws = createMockWs();
      ws.send.mockImplementationOnce(() => {
        throw new Error('connection lost');
      });
      manager.addClient(ws, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });

      const result = manager.sendToClient(ws, 'data');

      expect(result).toBe(false);
    });
  });

  // ============================================================
  // broadcast
  // ============================================================

  describe('broadcast', () => {
    it('should send to all clients subscribed to matching channels', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();

      manager.addClient(ws1, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });
      manager.addClient(ws2, { userId: 'u2', tenantId: 't1', role: 'OPERATOR' });

      const sent = manager.broadcast(JSON.stringify({ type: 'event' }), ['tenant:t1'], 't1');

      expect(sent).toBe(2);
      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).toHaveBeenCalledTimes(1);
    });

    it('should not send to clients not subscribed to the channel', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();

      manager.addClient(ws1, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });
      manager.addClient(ws2, { userId: 'u2', tenantId: 't2', role: 'OPERATOR' });

      const sent = manager.broadcast(JSON.stringify({ type: 'event' }), ['tenant:t1'], 't1');

      expect(sent).toBe(1);
      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).not.toHaveBeenCalled();
    });

    it('should skip clients with closed connections', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      ws2.readyState = 3; // CLOSED

      manager.addClient(ws1, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });
      manager.addClient(ws2, { userId: 'u2', tenantId: 't1', role: 'OPERATOR' });

      const sent = manager.broadcast(JSON.stringify({ type: 'event' }), ['tenant:t1'], 't1');

      expect(sent).toBe(1);
    });

    it('should return 0 when no channels match', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });

      const sent = manager.broadcast(JSON.stringify({ type: 'event' }), ['tenant:nonexistent'], 't1');

      expect(sent).toBe(0);
    });

    it('should match wildcard channel subscriptions', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'u1', tenantId: 't1', role: 'DISPATCHER' });
      // DISPATCHER gets site:* by default
      manager.subscribe(ws, 'site:*');

      const sent = manager.broadcast(JSON.stringify({ type: 'event' }), ['site:abc'], null);

      expect(sent).toBe(1);
    });

    // ============================================================
    // Tenant isolation (SEC-01)
    // ============================================================

    it('should NOT deliver an event of another tenant to a non-privileged client', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'u1', tenantId: 'tenant-a', role: 'OPERATOR' });
      // Client subscribes to a channel that matches the cross-tenant event
      manager.subscribe(ws, 'report:*');
      manager.subscribe(ws, 'tenant:tenant-b');

      // Event of tenant B over a channel the tenant-A client is subscribed to
      const sent = manager.broadcast(JSON.stringify({ type: 'event' }), ['report:r1'], 'tenant-b');

      expect(sent).toBe(0);
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('should deliver an event to a non-privileged client of the same tenant', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'u1', tenantId: 'tenant-a', role: 'OPERATOR' });
      manager.subscribe(ws, 'report:r1');

      const sent = manager.broadcast(JSON.stringify({ type: 'event' }), ['report:r1'], 'tenant-a');

      expect(sent).toBe(1);
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    it('should deliver cross-tenant events to ADMIN', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'a1', tenantId: 'tenant-a', role: 'ADMIN' });
      manager.subscribe(ws, 'report:r1');

      const sent = manager.broadcast(JSON.stringify({ type: 'event' }), ['report:r1'], 'tenant-b');

      expect(sent).toBe(1);
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    it('should deliver cross-tenant events to DISPATCHER', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'd1', tenantId: 'tenant-a', role: 'DISPATCHER' });
      manager.subscribe(ws, 'report:r1');

      const sent = manager.broadcast(JSON.stringify({ type: 'event' }), ['report:r1'], 'tenant-b');

      expect(sent).toBe(1);
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    it('should NOT deliver a null-tenant event to a non-privileged client', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'u1', tenantId: null, role: 'OPERATOR' });
      manager.subscribe(ws, 'system:global');

      const sent = manager.broadcast(JSON.stringify({ type: 'event' }), ['system:global'], null);

      expect(sent).toBe(0);
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('should deliver a null-tenant event to a platform role', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'a1', tenantId: null, role: 'ADMIN' });
      manager.subscribe(ws, 'system:global');

      const sent = manager.broadcast(JSON.stringify({ type: 'event' }), ['system:global'], null);

      expect(sent).toBe(1);
      expect(ws.send).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // subscribe / unsubscribe
  // ============================================================

  describe('subscribe / unsubscribe', () => {
    it('should subscribe a client to a channel', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'u1', tenantId: null, role: 'OPERATOR' });

      const result = manager.subscribe(ws, 'site:site-1');

      expect(result).toBe(true);
    });

    it('should return false when subscribing unknown client', () => {
      const ws = createMockWs();
      const result = manager.subscribe(ws, 'site:site-1');
      expect(result).toBe(false);
    });

    it('should unsubscribe a client from a channel', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'u1', tenantId: null, role: 'OPERATOR' });
      manager.subscribe(ws, 'site:site-1');

      const result = manager.unsubscribe(ws, 'site:site-1');
      expect(result).toBe(true);
    });

    it('should return false when unsubscribing unknown client', () => {
      const ws = createMockWs();
      const result = manager.unsubscribe(ws, 'site:site-1');
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // broadcastToChannel (alias for broadcast with single channel)
  // ============================================================

  describe('broadcast channel targeting', () => {
    it('should send to clients subscribed to a specific channel', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();

      manager.addClient(ws1, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });
      manager.addClient(ws2, { userId: 'u2', tenantId: 't1', role: 'OPERATOR' });

      manager.subscribe(ws1, 'alert:high');
      // ws2 NOT subscribed to alert:high

      const sent = manager.broadcast(JSON.stringify({ type: 'alert' }), ['alert:high'], 't1');

      expect(sent).toBe(1);
      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // recordPong
  // ============================================================

  describe('recordPong', () => {
    it('should update lastPingAt for a known client', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });

      const client = manager.getClient(ws);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
      const before = client!.lastPingAt;

      // Small delay to ensure different timestamp
      const later = Date.now() + 100;
      vi.spyOn(Date, 'now').mockReturnValue(later);

      manager.recordPong(ws);

      const updated = manager.getClient(ws);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
      expect(updated!.lastPingAt).toBe(later);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
      expect(updated!.lastPingAt).toBeGreaterThan(before);

      vi.restoreAllMocks();
    });

    it('should be a no-op for unknown client', () => {
      const ws = createMockWs();
      expect(() => manager.recordPong(ws)).not.toThrow();
    });
  });

  // ============================================================
  // cleanupDeadConnections
  // ============================================================

  describe('cleanupDeadConnections', () => {
    it('should remove clients that have not responded within timeout', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();

      manager.addClient(ws1, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });
      manager.addClient(ws2, { userId: 'u2', tenantId: 't1', role: 'OPERATOR' });

      // Simulate ws2 being idle for longer than timeout
      const client2 = manager.getClient(ws2);
      if (client2) {
        client2.lastPingAt = Date.now() - 70000; // 70s ago
      }

      const removed = manager.cleanupDeadConnections(60000);

      expect(removed).toBe(1);
      expect(manager.size).toBe(1);
      expect(ws2.terminate).toHaveBeenCalledTimes(1);
    });

    it('should return 0 when no dead connections', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });

      const removed = manager.cleanupDeadConnections(60000);
      expect(removed).toBe(0);
      expect(manager.size).toBe(1);
    });
  });

  // ============================================================
  // pingAll
  // ============================================================

  describe('pingAll', () => {
    it('should send ping to all connected clients', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();

      manager.addClient(ws1, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });
      manager.addClient(ws2, { userId: 'u2', tenantId: 't1', role: 'OPERATOR' });

      manager.pingAll();

      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).toHaveBeenCalledTimes(1);

      // Verify ping message format
      const call1 = JSON.parse(ws1.send.mock.calls[0][0]);
      expect(call1.type).toBe('ping');
      expect(call1.serverTs).toBeDefined();
    });

    it('should skip closed connections', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      ws2.readyState = 3; // CLOSED

      manager.addClient(ws1, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });
      manager.addClient(ws2, { userId: 'u2', tenantId: 't1', role: 'OPERATOR' });

      manager.pingAll();

      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // getStats
  // ============================================================

  describe('getStats', () => {
    it('should return correct total clients', () => {
      manager.addClient(createMockWs(), { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });
      manager.addClient(createMockWs(), { userId: 'u2', tenantId: 't2', role: 'OPERATOR' });

      const stats = manager.getStats();
      expect(stats.totalClients).toBe(2);
    });

    it('should return count of unique channels across all clients', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();

      manager.addClient(ws1, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });
      manager.addClient(ws2, { userId: 'u2', tenantId: 't2', role: 'OPERATOR' });

      manager.subscribe(ws1, 'site:s1');
      manager.subscribe(ws2, 'site:s2');

      const stats = manager.getStats();
      expect(stats.channels).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // closeAll
  // ============================================================

  describe('closeAll', () => {
    it('should close all connections and clear maps', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();

      manager.addClient(ws1, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });
      manager.addClient(ws2, { userId: 'u2', tenantId: 't1', role: 'OPERATOR' });

      manager.closeAll();

      expect(ws1.close).toHaveBeenCalledTimes(1);
      expect(ws2.close).toHaveBeenCalledTimes(1);
      expect(manager.size).toBe(0);
    });

    it('should be safe to call on empty manager', () => {
      expect(() => manager.closeAll()).not.toThrow();
    });
  });

  // ============================================================
  // Session liveness (SEC-04)
  // ============================================================

  describe('session expiry storage', () => {
    it('should store expiresAt and sessionVersion on the client', () => {
      const ws = createMockWs();
      manager.addClient(ws, {
        userId: 'u1',
        tenantId: 't1',
        role: 'OPERATOR',
        expiresAt: 1234567890000,
        sessionVersion: 3,
      });

      const client = manager.getClient(ws);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup above
      expect(client!.expiresAt).toBe(1234567890000);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup above
      expect(client!.sessionVersion).toBe(3);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup above
      expect(client!.lastAuthCheck).toBeDefined();
    });

    it('should default to null expiry and zero sessionVersion when not given', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });

      const client = manager.getClient(ws);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup above
      expect(client!.expiresAt).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup above
      expect(client!.sessionVersion).toBe(0);
    });
  });

  describe('checkSessionLiveness', () => {
    it('closes a client whose session expiry has passed with 4001 "session expired"', async () => {
      const ws = createMockWs();
      manager.addClient(ws, {
        userId: 'u1',
        tenantId: 't1',
        role: 'OPERATOR',
        expiresAt: Date.now() - 1000,
        sessionVersion: 1,
      });

      await manager.checkSessionLiveness(async () => true);

      expect(ws.close).toHaveBeenCalledWith(4001, 'session expired');
    });

    it('keeps a client whose session has not expired', async () => {
      const ws = createMockWs();
      manager.addClient(ws, {
        userId: 'u1',
        tenantId: 't1',
        role: 'OPERATOR',
        expiresAt: Date.now() + 60_000,
        sessionVersion: 1,
      });

      await manager.checkSessionLiveness(async () => true);

      expect(ws.close).not.toHaveBeenCalled();
    });

    it('closes a client whose session was revoked with 4001 "session revoked"', async () => {
      const ws = createMockWs();
      manager.addClient(ws, {
        userId: 'u2',
        tenantId: 't1',
        role: 'OPERATOR',
        expiresAt: null,
        sessionVersion: 1,
      });
      // Force the 10-minute re-check interval to fire.
      const client = manager.getClient(ws);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup above
      client!.lastAuthCheck = 0;

      await manager.checkSessionLiveness(async () => false);

      expect(ws.close).toHaveBeenCalledWith(4001, 'session revoked');
    });

    it('does not re-check a client before the 10-minute window', async () => {
      let calls = 0;
      const ws = createMockWs();
      manager.addClient(ws, {
        userId: 'u3',
        tenantId: 't1',
        role: 'OPERATOR',
        expiresAt: null,
        sessionVersion: 1,
      });

      await manager.checkSessionLiveness(async () => {
        calls++;
        return true;
      });

      expect(calls).toBe(0);
      expect(ws.close).not.toHaveBeenCalled();
    });

    it('does not close a client when the re-check throws (DB error) and retries next interval', async () => {
      const ws = createMockWs();
      manager.addClient(ws, {
        userId: 'u4',
        tenantId: 't1',
        role: 'OPERATOR',
        expiresAt: null,
        sessionVersion: 1,
      });
      const client = manager.getClient(ws);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup above
      client!.lastAuthCheck = 0;

      await manager.checkSessionLiveness(async () => {
        throw new Error('db down');
      });

      expect(ws.close).not.toHaveBeenCalled();
      // lastAuthCheck advanced so the next interval retries, not the next tick.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup above
      expect(client!.lastAuthCheck).toBeGreaterThan(0);
    });
  });
});
