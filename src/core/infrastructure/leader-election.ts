/**
 * Leader Election - Redis-based distributed lock
 *
 * Ensures only one worker instance is active at a time while allowing
 * standby instances to take over when the leader disappears.
 */

import { getRedisClient } from '@/lib/redis-cache';
import { logger } from '@/lib/logger';

function shouldLogLeaderElectionLifecycle(): boolean {
  return process.env.LOG_LEADER_ELECTION === 'true';
}

export interface LeaderElectionConfig {
  ttl: number;
  renewInterval: number;
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

  onBecomeLeader?: () => void;
  onLoseLeadership?: () => void;

  constructor(resource: string, config: Partial<LeaderElectionConfig> = {}) {
    this.resource = `leader:${resource}`;
    this.config = {
      ttl: config.ttl ?? 30_000,
      renewInterval: config.renewInterval ?? 10_000,
      nodeId: config.nodeId ?? defaultNodeId(),
    };

    if (this.config.renewInterval >= this.config.ttl) {
      throw new Error(
        `LeaderElection: renewInterval (${this.config.renewInterval}ms) must be less than ttl (${this.config.ttl}ms)`
      );
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    if (shouldLogLeaderElectionLifecycle()) {
      logger.info('Leader election started', {
        resource: this.resource,
        nodeId: this.config.nodeId,
        ttl: this.config.ttl,
      });
    }

    await this.tryAcquire();

    this.renewTimer = setInterval(() => {
      this.tryAcquire().catch((err) => {
        logger.error('Leader election: renew failed', {
          resource: this.resource,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.config.renewInterval);
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }

    if (this.isLeaderFlag) {
      await this.release();
    }

    if (shouldLogLeaderElectionLifecycle()) {
      logger.info('Leader election stopped', {
        resource: this.resource,
        nodeId: this.config.nodeId,
      });
    }
  }

  isLeader(): boolean {
    return this.isLeaderFlag;
  }

  async getLeader(): Promise<string | null> {
    const client = await getRedisClient();
    if (!client) return null;

    try {
      return await client.get(this.resource);
    } catch {
      return null;
    }
  }

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

  private async tryAcquire(): Promise<void> {
    const client = await getRedisClient();
    if (!client) {
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
      const wasLeader = this.isLeaderFlag;
      const currentOwner = await client.get(this.resource);

      if (currentOwner === this.config.nodeId) {
        await client.pexpire(this.resource, this.config.ttl);

        if (!wasLeader) {
          this.isLeaderFlag = true;
          if (shouldLogLeaderElectionLifecycle()) {
            logger.info('Leader election: became leader', {
              resource: this.resource,
              nodeId: this.config.nodeId,
            });
          }
          this.onBecomeLeader?.();
        }
        return;
      }

      const result = await client.set(
        this.resource,
        this.config.nodeId,
        'PX',
        this.config.ttl,
        'NX'
      );

      if (result === 'OK') {
        if (!wasLeader) {
          this.isLeaderFlag = true;
          if (shouldLogLeaderElectionLifecycle()) {
            logger.info('Leader election: became leader', {
              resource: this.resource,
              nodeId: this.config.nodeId,
            });
          }
          this.onBecomeLeader?.();
        }
        return;
      }

      if (wasLeader) {
        this.isLeaderFlag = false;
        logger.warn('Leader election: lost leadership', {
          resource: this.resource,
          nodeId: this.config.nodeId,
        });
        this.onLoseLeadership?.();
      }
    } catch (err) {
      logger.error('Leader election: acquire failed', {
        resource: this.resource,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async release(): Promise<void> {
    const client = await getRedisClient();
    if (!client) return;

    try {
      const current = await client.get(this.resource);
      if (current === this.config.nodeId) {
        await client.del(this.resource);
        if (shouldLogLeaderElectionLifecycle()) {
          logger.info('Leader election: released', {
            resource: this.resource,
            nodeId: this.config.nodeId,
          });
        }
      }
    } catch {
      // Best-effort release only. TTL cleanup remains the fallback.
    }

    this.isLeaderFlag = false;
  }
}

let outboxElection: LeaderElection | null = null;
let projectionElection: LeaderElection | null = null;

export function getOutboxLeaderElection(): LeaderElection {
  if (!outboxElection) {
    outboxElection = new LeaderElection('outbox-worker');
  }
  return outboxElection;
}

export function getProjectionLeaderElection(): LeaderElection {
  if (!projectionElection) {
    projectionElection = new LeaderElection('projection-worker');
  }
  return projectionElection;
}
