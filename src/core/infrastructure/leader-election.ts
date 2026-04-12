/**
 * Leader Election — Redis-based distributed lock
 *
 * Ensures only ONE worker instance is active at a time.
 * Other instances stand by and take over if the leader dies.
 *
 * Algorithm: SET resource_name value NX PX ttl
 *   - NX  = only set if Not eXists
 *   - PX  = auto-expire (prevents deadlocks if leader crashes)
 *
 * Lock is NOT renewable — leader re-acquires it periodically.
 * This is simpler and safer than Redlock for single-resource election.
 *
 * Usage (in worker):
 *   const election = new LeaderElection('outbox-worker', { ttl: 30_000 });
 *   await election.start();
 *
 *   if (election.isLeader()) {
 *     // do work
 *   }
 *
 *   // On shutdown:
 *   await election.stop();
 */

import { getRedisClient } from '@/lib/redis-cache';
import { logger } from '@/lib/logger';

export interface LeaderElectionConfig {
  /** Lock TTL in ms. Leader must re-acquire before this expires. */
  ttl: number;
  /** How often to re-acquire the lock (should be < ttl). */
  renewInterval: number;
  /** Node identifier. Defaults to hostname + PID. */
  nodeId: string;
}

function defaultNodeId(): string {
  return `${process.env.HOSTNAME || 'unknown'}-${process.pid}`;
}

export class LeaderElection {
  private readonly resource: string;
  private readonly config: LeaderElectionConfig;
  private isLeaderFlag = false;
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /** Callback fired when this node becomes leader. */
  onBecomeLeader?: () => void;
  /** Callback fired when this node loses leadership. */
  onLoseLeadership?: () => void;

  constructor(resource: string, config: Partial<LeaderElectionConfig> = {}) {
    this.resource = `leader:${resource}`;
    this.config = {
      ttl: config.ttl ?? 30_000,
      renewInterval: config.renewInterval ?? 10_000,
      nodeId: config.nodeId ?? defaultNodeId(),
    };

    // Safety: renew interval must be less than TTL
    if (this.config.renewInterval >= this.config.ttl) {
      throw new Error(
        `LeaderElection: renewInterval (${this.config.renewInterval}ms) must be less than ttl (${this.config.ttl}ms)`
      );
    }
  }

  /**
   * Start the election loop. Tries to acquire leadership immediately,
   * then renews periodically.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    logger.info('Leader election started', {
      resource: this.resource,
      nodeId: this.config.nodeId,
      ttl: this.config.ttl,
    });

    // Try to acquire immediately
    await this.tryAcquire();

    // Start renewal loop
    this.renewTimer = setInterval(() => {
      this.tryAcquire().catch((err) => {
        logger.error('Leader election: renew failed', {
          resource: this.resource,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.config.renewInterval);
  }

  /**
   * Stop the election loop and release leadership if held.
   */
  async stop(): Promise<void> {
    this.running = false;

    if (this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }

    if (this.isLeaderFlag) {
      await this.release();
    }

    logger.info('Leader election stopped', {
      resource: this.resource,
      nodeId: this.config.nodeId,
    });
  }

  /**
   * Returns true if this node is currently the leader.
   */
  isLeader(): boolean {
    return this.isLeaderFlag;
  }

  /**
   * Returns the current leader node ID (may be stale).
   */
  async getLeader(): Promise<string | null> {
    const client = await getRedisClient();
    if (!client) return null;

    try {
      return await client.get(this.resource);
    } catch {
      return null;
    }
  }

  /**
   * Get election stats.
   */
  getStats(): {
    resource: string;
    nodeId: string;
    isLeader: boolean;
    running: boolean;
    ttl: number;
  } {
    return {
      resource: this.resource,
      nodeId: this.config.nodeId,
      isLeader: this.isLeaderFlag,
      running: this.running,
      ttl: this.config.ttl,
    };
  }

  // ============================================================
  // Internal
  // ============================================================

  private async tryAcquire(): Promise<void> {
    const client = await getRedisClient();
    if (!client) {
      // Redis unavailable — cannot elect. Stay non-leader.
      if (this.isLeaderFlag) {
        this.isLeaderFlag = false;
        this.onLoseLeadership?.();
        logger.warn('Leader election: Redis unavailable, lost leadership', {
          resource: this.resource,
        });
      }
      return;
    }

    try {
      // SET key value NX PX ttl — atomic acquire
      const result = await client.set(this.resource, this.config.nodeId, 'PX', this.config.ttl, 'NX');

      const wasLeader = this.isLeaderFlag;

      if (result === 'OK') {
        // We acquired (or renewed) leadership
        if (!wasLeader) {
          this.isLeaderFlag = true;
          logger.info('Leader election: became leader', {
            resource: this.resource,
            nodeId: this.config.nodeId,
          });
          this.onBecomeLeader?.();
        }
        // else: already leader, just renewed — no callback needed
      } else {
        // Another node holds the lock
        if (wasLeader) {
          this.isLeaderFlag = false;
          logger.warn('Leader election: lost leadership', {
            resource: this.resource,
            nodeId: this.config.nodeId,
          });
          this.onLoseLeadership?.();
        }
      }
    } catch (err) {
      logger.error('Leader election: acquire failed', {
        resource: this.resource,
        error: err instanceof Error ? err.message : String(err),
      });
      // Don't change isLeaderFlag on transient error — wait for next cycle
    }
  }

  private async release(): Promise<void> {
    const client = await getRedisClient();
    if (!client) return;

    try {
      // Only release if we own the lock
      const current = await client.get(this.resource);
      if (current === this.config.nodeId) {
        await client.del(this.resource);
        logger.info('Leader election: released', {
          resource: this.resource,
          nodeId: this.config.nodeId,
        });
      }
    } catch {
      // Best-effort release — TTL will clean up anyway
    }

    this.isLeaderFlag = false;
  }
}

// ============================================================
// Shared instances
// ============================================================

let _outboxElection: LeaderElection | null = null;
let _projectionElection: LeaderElection | null = null;

export function getOutboxLeaderElection(): LeaderElection {
  if (!_outboxElection) {
    _outboxElection = new LeaderElection('outbox-worker');
  }
  return _outboxElection;
}

export function getProjectionLeaderElection(): LeaderElection {
  if (!_projectionElection) {
    _projectionElection = new LeaderElection('projection-worker');
  }
  return _projectionElection;
}
