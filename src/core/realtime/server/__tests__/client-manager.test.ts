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
import { ClientManager, WSClient } from '@/core/realtime/server/client-manager';

// ============================================================
// Mock WebSocket factory
// ============================================================

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
      const id = manager.addClient(ws, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });

      manager.removeClient(ws);

      // Client should not be retrievable
      const client = manager.getClient(ws);
      expect(client).toBeUndefined();
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

      const sent = manager.broadcast(JSON.stringify({ type: 'event' }), ['tenant:t1']);

      expect(sent).toBe(2);
      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).toHaveBeenCalledTimes(1);
    });

    it('should not send to clients not subscribed to the channel', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();

      manager.addClient(ws1, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });
      manager.addClient(ws2, { userId: 'u2', tenantId: 't2', role: 'OPERATOR' });

      const sent = manager.broadcast(JSON.stringify({ type: 'event' }), ['tenant:t1']);

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

      const sent = manager.broadcast(JSON.stringify({ type: 'event' }), ['tenant:t1']);

      expect(sent).toBe(1);
    });

    it('should return 0 when no channels match', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'u1', tenantId: 't1', role: 'OPERATOR' });

      const sent = manager.broadcast(JSON.stringify({ type: 'event' }), ['tenant:nonexistent']);

      expect(sent).toBe(0);
    });

    it('should match wildcard channel subscriptions', () => {
      const ws = createMockWs();
      manager.addClient(ws, { userId: 'u1', tenantId: 't1', role: 'DISPATCHER' });
      // DISPATCHER gets site:* by default
      manager.subscribe(ws, 'site:*');

      const sent = manager.broadcast(JSON.stringify({ type: 'event' }), ['site:abc']);

      expect(sent).toBe(1);
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

      manager.addClient(ws1, { userId: 'u1', tenantId: null, role: 'OPERATOR' });
      manager.addClient(ws2, { userId: 'u2', tenantId: null, role: 'OPERATOR' });

      manager.subscribe(ws1, 'alert:high');
      // ws2 NOT subscribed to alert:high

      const sent = manager.broadcast(JSON.stringify({ type: 'alert' }), ['alert:high']);

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
      const before = client!.lastPingAt;

      // Small delay to ensure different timestamp
      const later = Date.now() + 100;
      vi.spyOn(Date, 'now').mockReturnValue(later);

      manager.recordPong(ws);

      const updated = manager.getClient(ws);
      expect(updated!.lastPingAt).toBe(later);
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
});
