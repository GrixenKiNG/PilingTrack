/**
 * Agent 13 — DevOps Architect
 * Agent 14 — Cloud Infrastructure Engineer
 * Agent 15 — Monitoring Engineer
 * Agent 16 — Disaster Recovery Engineer
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentReport, TestResult } from '../qa-director';

// ============================================================================
// Agent 13 — DevOps Architect
// ============================================================================

export async function devOpsArchitect(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();

  console.log('    🔍 Анализ DevOps архитектуры...');

  checkDocker(projectRoot, findings);
  checkCICD(projectRoot, findings);
  checkInfrastructure(projectRoot, findings);

  return createReport('devops-architect', 'devops', findings, startTime);
}

function checkDocker(projectRoot: string, findings: TestResult[]): void {
  const dockerfilePath = path.join(projectRoot, 'Dockerfile');
  
  if (!fs.existsSync(dockerfilePath)) {
    findings.push({
      agent: 'devops-architect',
      category: 'devops',
      severity: 'critical',
      title: 'Отсутствует Dockerfile',
      description: 'Нет контейнеризации для production деплоя.',
      recommendation: 'Создать multi-stage Dockerfile для Next.js приложения'
    });
    return;
  }

  const dockerfile = fs.readFileSync(dockerfilePath, 'utf-8');

  // Multi-stage build
  const fromCount = (dockerfile.match(/FROM/g) || []).length;
  if (fromCount < 2) {
    findings.push({
      agent: 'devops-architect',
      category: 'devops',
      severity: 'medium',
      title: 'Dockerfile не использует multi-stage build',
      description: 'Multi-stage build уменьшает размер финального image на 80-90%.',
      file: 'Dockerfile',
      recommendation: 'Использовать 3-stage: deps → builder → runner'
    });
  }

  // Non-root user
  if (!dockerfile.includes('USER ') || dockerfile.includes('USER root')) {
    findings.push({
      agent: 'devops-architect',
      category: 'devops',
      severity: 'high',
      title: 'Контейнер запускается от root',
      description: 'Запуск от root — риск безопасности. Контейнер может быть взломан.',
      file: 'Dockerfile',
      recommendation: 'Добавить USER node перед CMD'
    });
  }

  // .dockerignore
  const dockerignorePath = path.join(projectRoot, '.dockerignore');
  if (!fs.existsSync(dockerignorePath)) {
    findings.push({
      agent: 'devops-architect',
      category: 'devops',
      severity: 'medium',
      title: 'Отсутствует .dockerignore',
      description: 'Без .dockerignore в image попадут node_modules, .git, .next.',
      recommendation: 'Создать .dockerignore с node_modules, .git, .next, db/'
    });
  }

  // Image size optimization
  const hasAlpine = dockerfile.includes('alpine');
  if (!hasAlpine) {
    findings.push({
      agent: 'devops-architect',
      category: 'devops',
      severity: 'low',
      title: 'Не используется Alpine image',
      description: 'Alpine image значительно меньше debian-based.',
      file: 'Dockerfile',
      recommendation: 'Использовать node:20-alpine вместо node:20'
    });
  }
}

function checkCICD(projectRoot: string, findings: TestResult[]): void {
  const githubActionsPath = path.join(projectRoot, '.github', 'workflows');
  const gitlabCIPath = path.join(projectRoot, '.gitlab-ci.yml');
  const jenkinsPath = path.join(projectRoot, 'Jenkinsfile');

  const hasCI = fs.existsSync(githubActionsPath) || 
                fs.existsSync(gitlabCIPath) || 
                fs.existsSync(jenkinsPath);

  if (!hasCI) {
    findings.push({
      agent: 'devops-architect',
      category: 'devops',
      severity: 'high',
      title: 'Отсутствует CI/CD pipeline',
      description: 'Нет автоматизации тестирования и деплоя. Ручной деплой = human error risk.',
      recommendation: 'Настроить GitHub Actions: lint → test → build → deploy'
    });
    return;
  }

  // Проверка stages pipeline
  if (fs.existsSync(githubActionsPath)) {
    const workflows = fs.readdirSync(githubActionsPath).filter(f => f.endsWith('.yml'));
    
    let hasTestStage = false;
    let hasBuildStage = false;
    let hasDeployStage = false;

    for (const workflow of workflows) {
      const content = fs.readFileSync(path.join(githubActionsPath, workflow), 'utf-8');
      hasTestStage = hasTestStage || /test|lint/i.test(content);
      hasBuildStage = hasBuildStage || /build/i.test(content);
      hasDeployStage = hasDeployStage || /deploy/i.test(content);
    }

    if (!hasTestStage) {
      findings.push({
        agent: 'devops-architect',
        category: 'devops',
        severity: 'high',
        title: 'CI pipeline не запускает тесты',
        description: 'Без автоматических тестов баги попадают в production.',
        recommendation: 'Добавить npm test или npm run lint в CI pipeline'
      });
    }

    if (!hasDeployStage) {
      findings.push({
        agent: 'devops-architect',
        category: 'devops',
        severity: 'medium',
        title: 'Отсутствует автоматический деплой',
        description: 'Деплой вручную увеличивает time-to-production.',
        recommendation: 'Настроить auto-deploy на main branch после прохождения тестов'
      });
    }
  }
}

function checkInfrastructure(projectRoot: string, findings: TestResult[]): void {
  // Проверка docker-compose
  const composePath = path.join(projectRoot, 'docker-compose.production.yml');
  
  if (fs.existsSync(composePath)) {
    const compose = fs.readFileSync(composePath, 'utf-8');

    // Health checks
    if (!compose.includes('healthcheck')) {
      findings.push({
        agent: 'devops-architect',
        category: 'devops',
        severity: 'medium',
        title: 'Docker Compose без health checks',
        description: 'Без health checks orchestrator не знает когда сервис готов.',
        file: 'docker-compose.production.yml',
        recommendation: 'Добавить healthcheck для app и postgres сервисов'
      });
    }

    // Resource limits
    if (!compose.includes('deploy:') || !compose.includes('resources:')) {
      findings.push({
        agent: 'devops-architect',
        category: 'devops',
        severity: 'medium',
        title: 'Отсутствуют лимиты ресурсов',
        description: 'Контейнеры могут потреблять все ресурсы хоста.',
        file: 'docker-compose.production.yml',
        recommendation: 'Установить memory: 512M, cpus: 0.5 для app'
      });
    }

    // Restart policy
    if (!compose.includes('restart:')) {
      findings.push({
        agent: 'devops-architect',
        category: 'devops',
        severity: 'low',
        title: 'Отсутствует restart policy',
        description: 'При падении контейнер не перезапустится автоматически.',
        file: 'docker-compose.production.yml',
        recommendation: 'Добавить restart: unless-stopped или always'
      });
    }
  }
}

// ============================================================================
// Agent 14 — Cloud Infrastructure Engineer
// ============================================================================

export async function cloudInfrastructureEngineer(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();

  console.log('    🔍 Анализ cloud инфраструктуры...');

  checkAutoscaling(projectRoot, findings);
  checkHighAvailability(projectRoot, findings);
  checkLoadBalancing(projectRoot, findings);

  return createReport('cloud-infrastructure-engineer', 'devops', findings, startTime);
}

function checkAutoscaling(projectRoot: string, findings: TestResult[]): void {
  const composePath = path.join(projectRoot, 'docker-compose.production.yml');
  
  if (fs.existsSync(composePath)) {
    const compose = fs.readFileSync(composePath, 'utf-8');
    if (!compose.includes('replicas:') && !compose.includes('scale:')) {
      findings.push({
        agent: 'cloud-infrastructure-engineer',
        category: 'devops',
        severity: 'medium',
        title: 'Не настроен autoscaling',
        description: 'Приложение не масштабируется горизонтально при нагрузке.',
        file: 'docker-compose.production.yml',
        recommendation: 'Для Kubernetes: HPA, для Docker Compose: deploy.replicas'
      });
    }
  }

  // Проверка serverless readiness
  const nextConfigPath = path.join(projectRoot, 'next.config.ts');
  if (fs.existsSync(nextConfigPath)) {
    const config = fs.readFileSync(nextConfigPath, 'utf-8');
    if (!config.includes('output:') || !config.includes('standalone')) {
      findings.push({
        agent: 'cloud-infrastructure-engineer',
        category: 'devops',
        severity: 'low',
        title: 'Приложение может не быть serverless-ready',
        description: 'Для serverless деплоя (Vercel, AWS Lambda) нужен output: standalone.',
        file: 'next.config.ts',
        recommendation: 'Включить output: \'standalone\' в next.config'
      });
    }
  }
}

function checkHighAvailability(projectRoot: string, findings: TestResult[]): void {
  // Проверка multi-region
  const hasMultiRegion = searchInDir(projectRoot, /region|multi.?region|us-?east|eu-?west/i);
  
  if (!hasMultiRegion) {
    findings.push({
      agent: 'cloud-infrastructure-engineer',
      category: 'devops',
      severity: 'low',
      title: 'Single region деплой',
      description: 'Приложение в одном регионе. При outage региона приложение недоступно.',
      recommendation: 'Для production SaaS рассмотреть multi-region деплой'
    });
  }

  // Проверка database HA
  const composePath = path.join(projectRoot, 'docker-compose.production.yml');
  if (fs.existsSync(composePath)) {
    const compose = fs.readFileSync(composePath, 'utf-8');
    if (!compose.includes('replication') && !compose.includes('replica')) {
      findings.push({
        agent: 'cloud-infrastructure-engineer',
        category: 'devops',
        severity: 'medium',
        title: 'База данных без HA',
        description: 'Single PostgreSQL instance — single point of failure.',
        file: 'docker-compose.production.yml',
        recommendation: 'Настроить streaming replication или managed DB с HA'
      });
    }
  }
}

function checkLoadBalancing(projectRoot: string, findings: TestResult[]): void {
  const caddyfilePath = path.join(projectRoot, 'Caddyfile');
  
  if (fs.existsSync(caddyfilePath)) {
    const caddyfile = fs.readFileSync(caddyfilePath, 'utf-8');
    if (!caddyfile.includes('reverse_proxy') && !caddyfile.includes('load_balance')) {
      findings.push({
        agent: 'cloud-infrastructure-engineer',
        category: 'devops',
        severity: 'medium',
        title: 'Load balancing не настроен',
        description: 'Caddy не настроен для load balancing между несколькими инстансами.',
        file: 'Caddyfile',
        recommendation: 'Настроить reverse_proxy с load_balancing policy'
      });
    }
  }
}

// ============================================================================
// Agent 15 — Monitoring Engineer
// ============================================================================

export async function monitoringEngineer(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const srcPath = path.join(projectRoot, 'src');

  console.log('    🔍 Анализ мониторинга...');

  checkMetrics(srcPath, findings);
  checkLogging(srcPath, findings);
  checkObservability(srcPath, findings);

  return createReport('monitoring-engineer', 'devops', findings, startTime);
}

function checkMetrics(srcPath: string, findings: TestResult[]): void {
  // Проверка метрик
  const hasMetrics = searchInDir(srcPath, /prom-client|metrics|counter|histogram|gauge/i);
  
  if (!hasMetrics) {
    findings.push({
      agent: 'monitoring-engineer',
      category: 'devops',
      severity: 'high',
      title: 'Отсутствуют application метрики',
      description: 'Нет Prometheus метрик: request rate, error rate, latency, throughput.',
      recommendation: 'Добавить prom-client для метрик: http_requests_total, http_request_duration_seconds'
    });
  }

  // Проверка APM
  const hasAPM = searchInDir(srcPath, /sentry|datadog|new.?relic|opentelemetry/i);
  if (!hasAPM) {
    findings.push({
      agent: 'monitoring-engineer',
      category: 'devops',
      severity: 'high',
      title: 'Отсутствует APM',
      description: 'Нет Application Performance Monitoring. Невозможно отследить проблемы.',
      recommendation: 'Интегрировать Sentry для error tracking и performance monitoring'
    });
  }
}

function checkLogging(srcPath: string, findings: TestResult[]): void {
  // Проверка логирования
  const hasStructuredLogging = searchInDir(srcPath, /JSON\.stringify.*log|pino|winston|bunyan/i);
  const hasConsoleLog = searchInDir(srcPath, /console\.log/i);

  if (hasConsoleLog && !hasStructuredLogging) {
    findings.push({
      agent: 'monitoring-engineer',
      category: 'devops',
      severity: 'medium',
      title: 'Используется console.log вместо structured logging',
      description: 'Console.log не структурирован и сложно парсится в production.',
      recommendation: 'Использовать pino или winston для JSON логирования'
    });
  }

  // Проверка log levels
  const hasLogLevels = searchInDir(srcPath, /logger\.(error|warn|info|debug)/i);
  if (!hasLogLevels) {
    findings.push({
      agent: 'monitoring-engineer',
      category: 'devops',
      severity: 'medium',
      title: 'Отсутствуют log levels',
      description: 'Без log levels сложно фильтровать и анализировать логи.',
      recommendation: 'Использовать logger.error(), logger.warn(), logger.info(), logger.debug()'
    });
  }

  // Проверка log correlation
  const hasCorrelation = searchInDir(srcPath, /correlation.?id|request.?id|trace.?id/i);
  if (!hasCorrelation) {
    findings.push({
      agent: 'monitoring-engineer',
      category: 'devops',
      severity: 'low',
      title: 'Отсутствует log correlation',
      description: 'Без correlation ID сложно отследить запрос через все сервисы.',
      recommendation: 'Добавить correlation-id middleware и включать во все логи'
    });
  }
}

function checkObservability(srcPath: string, findings: TestResult[]): void {
  // Проверка distributed tracing
  const hasTracing = searchInDir(srcPath, /opentelemetry|jaeger|zipkin|trace/i);
  
  if (!hasTracing) {
    findings.push({
      agent: 'monitoring-engineer',
      category: 'devops',
      severity: 'medium',
      title: 'Отсутствует distributed tracing',
      description: 'Нельзя отследить запрос через микросервисы и внешние API.',
      recommendation: 'Внедрить OpenTelemetry для tracing'
    });
  }

  // Проверка alerting
  const hasAlerting = searchInDir(srcPath, /alert|pagerduty|opsgenie|webhook.*alert/i);
  if (!hasAlerting) {
    findings.push({
      agent: 'monitoring-engineer',
      category: 'devops',
      severity: 'medium',
      title: 'Отсутствует alerting',
      description: 'При падении приложения команда не узнает автоматически.',
      recommendation: 'Настроить alerts: high error rate, high latency, downtime'
    });
  }
}

// ============================================================================
// Agent 16 — Disaster Recovery Engineer
// ============================================================================

export async function disasterRecoveryEngineer(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();

  console.log('    🔍 Анализ disaster recovery...');

  checkBackup(projectRoot, findings);
  checkFailover(projectRoot, findings);
  checkDisasterRecovery(projectRoot, findings);

  return createReport('disaster-recovery-engineer', 'devops', findings, startTime);
}

function checkBackup(projectRoot: string, findings: TestResult[]): void {
  // Проверка backup скриптов
  const hasBackup = searchInDir(projectRoot, /pg_dump|backup|mysqldump|boto3.*s3/i);
  
  if (!hasBackup) {
    findings.push({
      agent: 'disaster-recovery-engineer',
      category: 'devops',
      severity: 'critical',
      title: 'Отсутствует стратегия backup',
      description: 'Нет автоматических backup базы данных. При потере данные будут утеряны.',
      recommendation: 'Настроить cron с pg_dump для PostgreSQL ежедневно'
    });
    return;
  }

  // Проверка backup retention
  const hasRetention = searchInDir(projectRoot, /retention|keep.*days|rotate/i);
  if (!hasRetention) {
    findings.push({
      agent: 'disaster-recovery-engineer',
      category: 'devops',
      severity: 'medium',
      title: 'Не настроен backup retention',
      description: 'Backup могут храниться вечно или удаляться сразу.',
      recommendation: 'Настроить retention policy: 7 daily, 4 weekly, 12 monthly'
    });
  }

  // Проверка backup testing
  const hasBackupTest = searchInDir(projectRoot, /restore.*test|backup.*verify|pg_restore/i);
  if (!hasBackupTest) {
    findings.push({
      agent: 'disaster-recovery-engineer',
      category: 'devops',
      severity: 'high',
      title: 'Backup не тестируются на восстановление',
      description: 'Backup без проверки восстановления = нет гарантии что они работают.',
      recommendation: 'Автоматически тестировать восстановление backup weekly'
    });
  }
}

function checkFailover(projectRoot: string, findings: TestResult[]): void {
  // Проверка failover механизмов
  const composePath = path.join(projectRoot, 'docker-compose.production.yml');
  
  if (fs.existsSync(composePath)) {
    const compose = fs.readFileSync(composePath, 'utf-8');
    if (!compose.includes('depends_on:') || !compose.includes('condition:')) {
      findings.push({
        agent: 'disaster-recovery-engineer',
        category: 'devops',
        severity: 'medium',
        title: 'Не настроен failover',
        description: 'При падении PostgreSQL приложение не перезапустится автоматически.',
        file: 'docker-compose.production.yml',
        recommendation: 'Добавить depends_on с condition: service_healthy'
      });
    }
  }
}

function checkDisasterRecovery(projectRoot: string, findings: TestResult[]): void {
  // Проверка DR плана
  const hasDRPlan = searchInDir(projectRoot, /disaster.*recovery|dr.?plan|runbook|playbook/i);
  
  if (!hasDRPlan) {
    findings.push({
      agent: 'disaster-recovery-engineer',
      category: 'devops',
      severity: 'high',
      title: 'Отсутствует DR план',
      description: 'Нет документированного плана восстановления при аварии.',
      recommendation: 'Создать docs/disaster-recovery.md с RTO/RPO целями и процедурами'
    });
  }

  // Проверка RTO/RPO
  const hasRTO = searchInDir(projectRoot, /rto|rpotime.*objective|recovery.*time/i);
  if (!hasRTO) {
    findings.push({
      agent: 'disaster-recovery-engineer',
      category: 'devops',
      severity: 'medium',
      title: 'Не определены RTO/RPO',
      description: 'Без RTO (Recovery Time Objective) и RPO (Recovery Point Objective) сложно планировать DR.',
      recommendation: 'Определить: RTO < 1 час, RPO < 15 минут для production SaaS'
    });
  }
}

// Утилиты
function searchInDir(dir: string, pattern: RegExp): boolean {
  try {
    const { execSync } = require('child_process');
    const command = process.platform === 'win32'
      ? `findstr /S /R /C:"${pattern.source}" "${dir}\\*.ts" "${dir}\\*.tsx" "${dir}\\*.yml" "${dir}\\*.yaml" "${dir}\\*.js" 2>nul || true`
      : `grep -r -E "${pattern.source}" ${dir} --include="*.ts" --include="*.tsx" --include="*.yml" --include="*.yaml" --include="*.js" 2>/dev/null || true`;
    
    const result = execSync(command, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

function createReport(
  agentName: string, 
  category: string, 
  findings: TestResult[], 
  startTime: number
): AgentReport {
  const duration = Date.now() - startTime;
  const status = findings.some(f => f.severity === 'critical' || f.severity === 'high') 
    ? 'failed' 
    : findings.some(f => f.severity === 'medium') 
      ? 'warning' 
      : 'passed';

  return {
    agentName,
    category,
    status,
    findings,
    summary: `Найдено ${findings.length} замечаний`,
    executedAt: new Date().toISOString(),
    duration
  };
}
