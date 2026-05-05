export type ComponentStatus = 'up' | 'down' | 'slow';
export type OutboxStatus = 'ok' | 'backlog' | 'stalled';
export type WorkerStatus = 'running' | 'stopped';
export type StorageProvider = 's3' | 'local';
export type OverallStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ComponentHealth {
  status: ComponentStatus;
  latencyMs?: number;
}

export interface RedisHealth extends ComponentHealth {
  status: ComponentStatus;
}

export interface OutboxHealth {
  status: OutboxStatus;
  pendingCount: number;
  oldestPending?: string;
}

export interface WorkerHealth {
  status: WorkerStatus;
  lastHeartbeat?: string;
}

export interface StorageHealth {
  status: ComponentStatus;
  provider: StorageProvider;
}

export interface WebSocketHealth {
  status: ComponentStatus;
  connections?: number;
}

export interface BackupHealth {
  status: ComponentStatus;
  lastBackupAt?: string;
  lastBackupAgeHours?: number;
  lastBackupSize?: string;
  s3Synced?: boolean;
  source?: 'disabled' | 'redis' | 'filesystem' | 'missing';
}

export interface SystemComponents {
  database: ComponentHealth;
  redis: RedisHealth;
  outbox: OutboxHealth;
  workers: WorkerHealth;
  storage: StorageHealth;
  websocket: WebSocketHealth;
  backup: BackupHealth;
}

export interface SystemMetrics {
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  outboxPending: number;
  dlqPending: number;
  activeWsConnections: number;
}

export interface SystemStatus {
  status: OverallStatus;
  timestamp: string;
  version: string;
  components: SystemComponents;
  metrics: SystemMetrics;
}
