/**
 * Agent 2 — Software Architect
 * 
 * Проверяет архитектуру системы PilingTrack:
 * - Microservices
 * - Event-driven architecture
 * - API Gateway
 * - Message queues
 * - Multi-tenant SaaS
 * - Scalability
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentReport, TestResult } from '../qa-director';

export default async function softwareArchitectAgent(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const srcPath = path.join(projectRoot, 'src');

  console.log('    🔍 Анализ архитектуры PilingTrack...');

  // 1. Проверка на монолитную архитектуру
  const hasMonolith = checkMonolith(srcPath, findings);
  
  // 2. Проверка event-driven архитектуры
  checkEventDriven(srcPath, findings);
  
  // 3. Проверка API Gateway
  checkAPIGateway(projectRoot, findings);
  
  // 4. Проверка message queues
  checkMessageQueues(srcPath, findings);
  
  // 5. Проверка multi-tenant
  checkMultiTenant(srcPath, findings);
  
  // 6. Проверка масштабируемости
  checkScalability(srcPath, projectRoot, findings);

  const duration = Date.now() - startTime;
  const status = findings.some(f => f.severity === 'critical' || f.severity === 'high') 
    ? 'failed' 
    : findings.some(f => f.severity === 'medium') 
      ? 'warning' 
      : 'passed';

  return {
    agentName: 'software-architect',
    category: 'architecture',
    status,
    findings,
    summary: `Найдено ${findings.length} архитектурных замечаний`,
    executedAt: new Date().toISOString(),
    duration
  };
}

function checkMonolith(srcPath: string, findings: TestResult[]): boolean {
  // Подсчёт API endpoints
  const apiPath = path.join(srcPath, 'app', 'api');
  if (!fs.existsSync(apiPath)) return false;

  const apiFiles = countFiles(apiPath, /route\.ts$/);
  
  if (apiFiles > 15) {
    findings.push({
      agent: 'software-architect',
      category: 'architecture',
      severity: 'medium',
      title: 'Монолитная архитектура Next.js',
      description: `Все ${apiFiles} API endpoints находятся в одном Next.js приложении. При росте это станет bottleneck.`,
      recommendation: 'Выделить критичные домены (reports, auth, analytics) в отдельные микросервисы'
    });
    return true;
  }

  // Проверка separation of concerns
  const servicesPath = path.join(srcPath, 'services');
  const serviceCount = fs.existsSync(servicesPath) ? countFiles(servicesPath, /\.ts$/) : 0;
  
  if (serviceCount < 10) {
    findings.push({
      agent: 'software-architect',
      category: 'architecture',
      severity: 'low',
      title: 'Недостаточное разделение доменов',
      description: `Всего ${serviceCount} сервисов. Для industrial SaaS рекомендуется более детальное разделение.`,
      recommendation: 'Разделить по доменам: PileManagement, DrillingOperations, CrewManagement, EquipmentTracking, Reporting, Analytics'
    });
  }

  return false;
}

function checkEventDriven(srcPath: string, findings: TestResult[]): void {
  const hasEventBus = searchInDir(srcPath, /EventEmitter|EventBus|pub.?sub|event.*stream|kafka|rabbitmq|nats/i);
  
  if (!hasEventBus) {
    findings.push({
      agent: 'software-architect',
      category: 'architecture',
      severity: 'high',
      title: 'Отсутствует event-driven архитектура',
      description: 'Для industrial IoT платформы критична обработка событий в реальном времени (датчики техники, GPS, отчёты). Синхронная архитектура не масштабируется.',
      recommendation: 'Внедрить Redis Pub/Sub для событий отчётов, Apache Kafka для IoT данных'
    });
  }

  // Проверка webhook поддержки
  const hasWebhooks = searchInDir(srcPath, /webhook|callback.*url/i);
  if (!hasWebhooks) {
    findings.push({
      agent: 'software-architect',
      category: 'architecture',
      severity: 'low',
      title: 'Отсутствует webhook интеграция',
      description: 'Для интеграции с внешними системами (1С, ERP) нужны webhooks.',
      recommendation: 'Добавить webhook систему для событий: report.created, report.approved, downtime.detected'
    });
  }
}

function checkAPIGateway(projectRoot: string, findings: TestResult[]): void {
  const caddyfilePath = path.join(projectRoot, 'Caddyfile');
  
  if (fs.existsSync(caddyfilePath)) {
    const caddyfile = fs.readFileSync(caddyfilePath, 'utf-8');
    
    // Проверка rate limiting
    if (!caddyfile.includes('rate_limit')) {
      findings.push({
        agent: 'software-architect',
        category: 'architecture',
        severity: 'medium',
        title: 'API Gateway без rate limiting',
        description: 'Caddy не настроен для rate limiting. API уязвим для abuse.',
        file: 'Caddyfile',
        recommendation: 'Настроить rate limiting на API endpoints'
      });
    }

    // Проверка CORS
    if (!caddyfile.includes('header') || !caddyfile.includes('Access-Control')) {
      findings.push({
        agent: 'software-architect',
        category: 'architecture',
        severity: 'low',
        title: 'CORS не настроен на уровне Gateway',
        description: 'CORS должен контролироваться на уровне API Gateway, не только в приложении.',
        file: 'Caddyfile',
        recommendation: 'Настроить CORS policy на Caddy level'
      });
    }
  } else {
    findings.push({
      agent: 'software-architect',
      category: 'architecture',
      severity: 'high',
      title: 'Отсутствует API Gateway',
      description: 'Нет reverse proxy/gateway. Для production SaaS это необходимо для routing, SSL, rate limiting.',
      recommendation: 'Использовать Caddy, Traefik, Kong или AWS API Gateway'
    });
  }
}

function checkMessageQueues(srcPath: string, findings: TestResult[]): void {
  // Проверка фоновых задач
  const hasQueue = searchInDir(srcPath, /bull|bee-queue|amqplib|kafka-node|node-rdkafka/i);
  
  if (!hasQueue) {
    findings.push({
      agent: 'software-architect',
      category: 'architecture',
      severity: 'high',
      title: 'Отсутствует очередь задач',
      description: 'Тяжёлые операции (генерация PDF, отправка Telegram, AI распознавание) выполняются синхронно. Это блокирует request thread и ухудшает UX.',
      recommendation: 'Внедрить Bull (Redis) для: генерации PDF, отправки уведомлений, AI распознавания, экспорта CSV'
    });
  }

  // Проверка async/await паттернов
  const hasAsyncAPI = searchInDir(srcPath, /async.*route|Promise.*route/i);
  if (!hasAsyncAPI) {
    findings.push({
      agent: 'software-architect',
      category: 'architecture',
      severity: 'medium',
      title: 'API могут не использовать async правильно',
      description: 'Проверить все API handlers на корректное использование async/await и обработку Promise rejections.',
      recommendation: 'Обернуть все async handlers в error wrapper с обработкой unhandled rejections'
    });
  }
}

function checkMultiTenant(srcPath: string, findings: TestResult[]): void {
  // Проверка tenant изоляции
  const hasTenant = searchInDir(srcPath, /tenant|organization_id|company_id/i);
  
  if (!hasTenant) {
    findings.push({
      agent: 'software-architect',
      category: 'architecture',
      severity: 'critical',
      title: 'Отсутствует multi-tenant изоляция',
      description: 'SaaS платформа заявлена как multi-tenant, но нет tenant_id в моделях или middleware для фильтрации. Данные разных клиентов могут смешаться.',
      recommendation: 'Добавить tenant_id во все модели, реализовать tenant middleware для автоматической фильтрации'
    });
  }

  // Проверка row-level security
  const prismaPath = path.join(projectRoot, 'prisma');
  if (fs.existsSync(prismaPath)) {
    const schemaFiles = fs.readdirSync(prismaPath).filter(f => f.endsWith('.prisma'));
    let hasRowSecurity = false;
    
    for (const file of schemaFiles) {
      const schema = fs.readFileSync(path.join(prismaPath, file), 'utf-8');
      if (schema.includes('@@map') || schema.includes('@@schema')) {
        hasRowSecurity = true;
      }
    }

    if (!hasRowSecurity && !hasTenant) {
      findings.push({
        agent: 'software-architect',
        category: 'architecture',
        severity: 'high',
        title: 'Нет row-level security',
        description: 'Без tenant_id и row-level security клиенты могут видеть данные друг друга.',
        recommendation: 'Реализовать Prisma middleware для автоматического добавления tenant фильтра ко всем запросам'
      });
    }
  }
}

function checkScalability(srcPath: string, projectRoot: string, findings: TestResult[]): void {
  // Проверка stateless дизайна
  const hasSession = searchInDir(srcPath, /session.*store|redis.*session|jwt/i);
  if (!hasSession) {
    findings.push({
      agent: 'software-architect',
      category: 'architecture',
      severity: 'medium',
      title: 'Возможное состояние в приложении',
      description: 'Если сессии хранятся локально (не в Redis/DB), это препятствует горизонтальному масштабированию.',
      recommendation: 'Использовать Redis для хранения сессий или stateless JWT токены'
    });
  }

  // Проверка CDN usage
  const nextConfigPath = path.join(projectRoot, 'next.config.ts');
  if (fs.existsSync(nextConfigPath)) {
    const config = fs.readFileSync(nextConfigPath, 'utf-8');
    if (!config.includes('images') || !config.includes('remotePatterns')) {
      findings.push({
        agent: 'software-architect',
        category: 'architecture',
        severity: 'low',
        title: 'Image optimization не настроена',
        description: 'Next.js Image component может использовать CDN и оптимизацию для production.',
        file: 'next.config.ts',
        recommendation: 'Настроить image optimization и CDN для статических ресурсов'
      });
    }
  }

  // Проверка database connection pooling
  const dbPath = path.join(srcPath, 'lib', 'db.ts');
  if (fs.existsSync(dbPath)) {
    const db = fs.readFileSync(dbPath, 'utf-8');
    if (!db.includes('pool') && !db.includes('PgBouncer') && !db.includes('connectionLimit')) {
      findings.push({
        agent: 'software-architect',
        category: 'architecture',
        severity: 'medium',
        title: 'Возможно отсутствие connection pooling',
        description: 'Без connection pooling каждый запрос создаёт новое соединение с БД, что не масштабируется.',
        file: 'src/lib/db.ts',
        recommendation: 'Использовать PgBouncer для PostgreSQL или настроить connection pool в Prisma'
      });
    }
  }
}

// Утилиты
function countFiles(dir: string, pattern: RegExp): number {
  let count = 0;
  if (!fs.existsSync(dir)) return count;

  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (item !== 'node_modules' && item !== '.next') {
        count += countFiles(fullPath, pattern);
      }
    } else if (pattern.test(item)) {
      count++;
    }
  }
  return count;
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
