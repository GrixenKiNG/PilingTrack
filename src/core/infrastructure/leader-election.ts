/**
 * Leader Election - Redis-based distributed lock
 *
 * Ensures only one worker instance is active at a time while allowing
 * standby instances to take over when the leader disappears.
 */

import { getStateRedisClient } from '@/lib/redis-cache';
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

const RENEW_LEASE = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end return 0";
const RELEASE_LEASE = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";

export class LeaderElection {
  private readonly resource: string;
  private readonly config: LeaderElectionConfig;
  private isLeaderFlag = false;
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  private leaseTimer: ReturnType<typeof setTimeout> | null = null;
  private leaseExpiresAt: number | null = null;
  private running = false;
  private generation = 0;
  private ownershipVersion = 0;
  private acquisition: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;

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
    if (this.stopping) await this.stopping;
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;

    if (shouldLogLeaderElectionLifecycle()) {
      logger.info('Leader election started', {
        resource: this.resource,
        nodeId: this.config.nodeId,
        ttl: this.config.ttl,
      });
    }

    await this.tryAcquire(generation);
    if (!this.running || this.generation !== generation) return;

    this.renewTimer = setInterval(() => {
      void this.tryAcquire(generation);
    }, this.config.renewInterval);
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.running = false;
    ++this.generation;
    if (this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }
    this.loseLeadership('stopped', false);

    // Wait for the old request before release; a restart must not race with
    // cleanup of the same nodeId's lease.
    const stopping = (async () => {
      if (this.acquisition) await this.acquisition;
      await this.release();
      if (shouldLogLeaderElectionLifecycle()) {
        logger.info('Leader election stopped', {
          resource: this.resource,
          nodeId: this.config.nodeId,
        });
      }
    })();
    this.stopping = stopping;
    try {
      await stopping;
    } finally {
      if (this.stopping === stopping) this.stopping = null;
    }
  }

  isLeader(): boolean {
    if (this.isLeaderFlag && this.leaseExpiresAt !== null && performance.now() >= this.leaseExpiresAt) {
      this.loseLeadership('lease expired');
    }
    return this.isLeaderFlag;
  }

  async getLeader(): Promise<string | null> {
    try {
      const client = await getStateRedisClient();
      return client ? await client.get(this.resource) : null;
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
      isLeader: this.isLeader(),
      running: this.running,
      ttl: this.config.ttl,
    };
  }

  private async tryAcquire(generation: number): Promise<void> {
    if (!this.running || this.generation !== generation) return;
    if (this.acquisition) return this.acquisition;
    const acquisition = this.acquire(generation);
    this.acquisition = acquisition;
    try {
      await acquisition;
    } finally {
      if (this.acquisition === acquisition) this.acquisition = null;
    }
  }

  private async acquire(generation: number): Promise<void> {
    // The server may apply the command before its reply arrives. Starting the
    // local deadline before any await never grants more time than Redis's TTL.
    // Monotonic time prevents wall-clock corrections extending the lease.
    const deadline = performance.now() + this.config.ttl;
    const ownershipVersion = this.ownershipVersion;
    try {
      const client = await getStateRedisClient();
      if (!this.running || this.generation !== generation) return;
      if (!client) {
        this.loseLeadership('Redis unavailable');
        return;
      }

      const renewed = await client.eval(
        RENEW_LEASE, 1, this.resource, this.config.nodeId, this.config.ttl,
      );
      if (!this.running || this.generation !== generation) return;

      if (this.ownershipVersion !== ownershipVersion) return;
      let ownsLease = renewed === 1;
      if (!ownsLease) {
        this.loseLeadership('owner changed');
        if (this.ownershipVersion !== ownershipVersion) return;
        ownsLease = await client.set(
          this.resource, this.config.nodeId, 'PX', this.config.ttl, 'NX',
        ) === 'OK';
      }

      if (!this.running || this.generation !== generation) return;
      if (this.ownershipVersion !== ownershipVersion) return;
      if (!ownsLease || performance.now() >= deadline) {
        this.loseLeadership('lease not confirmed before deadline');
        return;
      }

      this.leaseExpiresAt = deadline;
      if (this.leaseTimer) clearTimeout(this.leaseTimer);
      this.leaseTimer = setTimeout(() => {
        if (this.generation === generation) this.loseLeadership('lease expired');
      }, deadline - performance.now());

      if (!this.isLeaderFlag) {
        this.isLeaderFlag = true;
        if (shouldLogLeaderElectionLifecycle()) {
          logger.info('Leader election: became leader', {
            resource: this.resource,
            nodeId: this.config.nodeId,
          });
        }
        this.onBecomeLeader?.();
      }
    } catch (err) {
      if (this.generation !== generation) return;
      this.loseLeadership('Redis request failed');
      logger.error('Leader election: acquire failed', {
        resource: this.resource,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private loseLeadership(reason: string, warn = true): void {
    this.leaseExpiresAt = null;
    if (this.leaseTimer) {
      clearTimeout(this.leaseTimer);
      this.leaseTimer = null;
    }
    if (!this.isLeaderFlag) return;
    this.isLeaderFlag = false;
    ++this.ownershipVersion;
    if (warn) {
      logger.warn('Leader election: lost leadership', {
        resource: this.resource,
        nodeId: this.config.nodeId,
        reason,
      });
    }
    try {
      this.onLoseLeadership?.();
    } catch (err) {
      logger.error('Leader election: loss callback failed', {
        resource: this.resource,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async release(): Promise<void> {
    try {
      const client = await getStateRedisClient();
      if (!client) return;
      const released = await client.eval(
        RELEASE_LEASE, 1, this.resource, this.config.nodeId,
      );
      if (released === 1 && shouldLogLeaderElectionLifecycle()) {
        logger.info('Leader election: released', {
          resource: this.resource,
          nodeId: this.config.nodeId,
        });
      }
    } catch {
      // Best-effort release only. TTL cleanup remains the fallback.
    }
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
