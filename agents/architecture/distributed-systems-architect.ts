/**
 * Agent 3 — Distributed Systems Architect
 * 
 * Проверяет распределённую архитек PilingTrack:
 * - Масштабируемость
 * - Консистентность данных
 * - Отказоустойчивость
 * - Event streaming
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentReport, TestResult } from '../qa-director';

export default async function distributedSystemsArchitect(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const srcPath = path.join(projectRoot, 'src');

  console.log('    🔍 Анализ распределённой архитектуры...');

  // 1. Масштабируемость
  checkScalability(srcPath, projectRoot, findings);
  
  // 2. Консистентность данных
  checkDataConsistency(srcPath, findings);
  
  // 3. Отказоустойчивость
  checkFaultTolerance(srcPath, projectRoot, findings);
  
  // 4. Event streaming
  checkEventStreaming(srcPath, findings);

  const duration = Date.now() - startTime;
  const status = findings.some(f => f.severity === 'critical' || f.severity === 'high') 
    ? 'failed' 
    : findings.some(f => f.severity === 'medium') 
      ? 'warning' 
      : 'passed';

  return {
    agentName: 'distributed-systems-architect',
    category: 'architecture',
    status,
    findings,
    summary: `Найдено ${findings.length} проблем распределённой архитектуры`,
    executedAt: new Date().toISOString(),
    duration
  };
}

function checkScalability(srcPath: string, projectRoot: string, findings: TestResult[]): void {
  // Проверка горизонтального масштабирования
  const hasStateless = checkStatelessDesign(srcPath);
  if (!hasStateless) {
    findings.push({
      agent: 'distributed-systems-architect',
      category: 'architecture',
      severity: 'high',
      title: 'Приложение может не быть stateless',
      description: 'Для горизонтального масштабирования приложение должно быть stateless. Проверить хранение сессий, кэша, файлов.',
      recommendation: 'Вынести состояние в Redis (сессии, кэш) и объектное хранилище (файлы)'
    });
  }

  // Проверка database scalability
  const dbPath = path.join(srcPath, 'lib', 'db.ts');
  if (fs.existsSync(dbPath)) {
    const db = fs.readFileSync(dbPath, 'utf-8');
    
    // Проверка read replicas
    if (!db.includes('replica') && !db.includes('read') && !db.includes('write')) {
      findings.push({
        agent: 'distributed-systems-architect',
        category: 'architecture',
        severity: 'medium',
        title: 'Отсутствует read/write разделение БД',
        description: 'Одна БД для чтения и записи ограничивает масштабируемость. Для SaaS с аналитикой нужно разделение.',
        file: 'src/lib/db.ts',
        recommendation: 'Настроить read replicas для аналитики и отчётов, write — для основной БД'
      });
    }
  }

  // Проверка Docker scaling
  const composePath = path.join(projectRoot, 'docker-compose.production.yml');
  if (fs.existsSync(composePath)) {
    const compose = fs.readFileSync(composePath, 'utf-8');
    if (!compose.includes('replicas') && !compose.includes('deploy:')) {
      findings.push({
        agent: 'distributed-systems-architect',
        category: 'architecture',
        severity: 'medium',
        title: 'Docker Compose не настроен для scaling',
        description: 'Нет настройки replicas для горизонтального масштабирования.',
        file: 'docker-compose.production.yml',
        recommendation: 'Добавить deploy.replicas для app сервиса'
      });
    }
  }
}

function checkDataConsistency(srcPath: string, findings: TestResult[]): void {
  // Проверка транзакций
  const hasTransactions = searchInDir(srcPath, /\$transaction|prisma\.\$transaction|BEGIN|COMMIT/i);
  
  if (!hasTransactions) {
    findings.push({
      agent: 'distributed-systems-architect',
      category: 'architecture',
      severity: 'critical',
      title: 'Возможно отсутствие транзакций',
      description: 'Операции с несколькими моделями (создание отчёта + сваи + простои) должны быть в транзакции для консистентности.',
      recommendation: 'Обернуть multi-model операции в Prisma $transaction'
    });
  }

  // Проверка optimistic concurrency control
  const hasOptimisticLock = searchInDir(srcPath, /version|optimistic|lock.*row/i);
  if (!hasOptimisticLock) {
    findings.push({
      agent: 'distributed-systems-architect',
      category: 'architecture',
      severity: 'high',
      title: 'Отсутствует контроль конкурентности',
      description: 'При одновременном редактировании отчётов несколькими пользователями возможны lost updates.',
      recommendation: 'Добавить version поле к Report и проверять при обновлении (optimistic locking)'
    });
  }

  // Проверка eventual consistency
  const hasConsistency = searchInDir(srcPath, /eventual|consistency|saga|outbox/i);
  if (!hasConsistency) {
    findings.push({
      agent: 'distributed-systems-architect',
      category: 'architecture',
      severity: 'medium',
      title: 'Нет паттернов eventual consistency',
      description: 'Для распределённой системы нужны паттерны: Saga, Outbox, CQRS.',
      recommendation: 'Реализовать Outbox pattern для надёжной доставки событий'
    });
  }
}

function checkFaultTolerance(srcPath: string, projectRoot: string, findings: TestResult[]): void {
  // Проверка health checks
  const hasHealthChecks = searchInDir(srcPath, /health.*check|healthcheck|\/health|\/api\/health/i);
  
  if (!hasHealthChecks) {
    findings.push({
      agent: 'distributed-systems-architect',
      category: 'architecture',
      severity: 'high',
      title: 'Отсутствуют health check endpoints',
      description: 'Для orchestrator (Kubernetes/Docker) нужны health checks для автоматического restart.',
      recommendation: 'Добавить /api/health с проверкой БД, Redis, внешних сервисов'
    });
  }

  // Проверка circuit breaker
  const hasCircuitBreaker = searchInDir(srcPath, /circuit.*breaker|opossum|brakes/i);
  if (!hasCircuitBreaker) {
    findings.push({
      agent: 'distributed-systems-architect',
      category: 'architecture',
      severity: 'medium',
      title: 'Отсутствует circuit breaker pattern',
      description: 'При падении внешних сервисов (Telegram, AI) запросы будут timeout без circuit breaker.',
      recommendation: 'Внедрить circuit breaker для внешних API: Telegram, AI recognition, PDF generation'
    });
  }

  // Проверка retry logic
  const hasRetry = searchInDir(srcPath, /retry|retry.*policy|exponential.*backoff/i);
  if (!hasRetry) {
    findings.push({
      agent: 'distributed-systems-architect',
      category: 'architecture',
      severity: 'medium',
      title: 'Отсутствует retry логика',
      description: 'При временных сбоях сети или БД запросы падают без retry. Нужно для reliability.',
      recommendation: 'Добавить retry с exponential backoff и jitter для БД и внешних API'
    });
  }

  // Проверка graceful shutdown
  const hasGracefulShutdown = searchInDir(srcPath, /SIGTERM|SIGINT|graceful.*shutdown|beforeExit/i);
  if (!hasGracefulShutdown) {
    findings.push({
      agent: 'distributed-systems-architect',
      category: 'architecture',
      severity: 'high',
      title: 'Отсутствует graceful shutdown',
      description: 'При перезапуске/деплое активные запросы могут прерваться. Это приводит к ошибкам у пользователей.',
      recommendation: 'Реализовать graceful shutdown с завершением активных запросов перед остановкой'
    });
  }
}

function checkEventStreaming(srcPath: string, findings: TestResult[]): void {
  // Проверка event streaming
  const hasEventStream = searchInDir(srcPath, /kafka|event.*stream|log.*stream|cdc/i);
  
  if (!hasEventStream) {
    findings.push({
      agent: 'distributed-systems-architect',
      category: 'architecture',
      severity: 'medium',
      title: 'Отсутствует event streaming',
      description: 'Для industrial IoT (датчики техники, GPS) нужен event streaming для обработки в реальном времени.',
      recommendation: 'Внедрить Apache Kafka или Redpanda для stream processing IoT данных'
    });
  }

  // Проверка real-time updates
  const hasRealtime = searchInDir(srcPath, /websocket|socket\.io|server.*sent.*event|SSE/i);
  if (!hasRealtime) {
    findings.push({
      agent: 'distributed-systems-architect',
      category: 'architecture',
      severity: 'medium',
      title: 'Отсутствует real-time обновление',
      description: 'Операторы и диспетчеры не получают обновления в реальном времени (новые отчёты, статус техники).',
      recommendation: 'Добавить WebSocket для real-time updates: статусы отчётов, уведомления, IoT данные'
    });
  }
}

// Утилиты
function checkStatelessDesign(srcPath: string): boolean {
  // Проверка на использование in-memory хранилищ
  const hasInMemory = searchInDir(srcPath, /Map\(\)|Set\(\)|global\.\w+\s*=|let\s+\w+\s*=\s*\[\]/);
  return !hasInMemory; // Если нет in-memory состояния, то stateless
}

function searchInDir(dir: string, pattern: RegExp): boolean {
  try {
    const { execSync } = require('child_process');
    const command = process.platform === 'win32'
      ? `findstr /S /R /C:"${pattern.source}" "${dir}\\*.ts" "${dir}\\*.tsx" 2>nul || true`
      : `grep -r -E "${pattern.source}" ${dir} --include="*.ts" --include="*.tsx" 2>/dev/null || true`;
    
    const result = execSync(command, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}
