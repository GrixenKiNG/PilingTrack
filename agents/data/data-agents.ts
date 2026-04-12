/**
 * Agent 17 — Data Engineer
 * Agent 18 — Data Quality Engineer
 * Agent 19 — Analytics Engineer
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentReport, TestResult } from '../qa-director';

// ============================================================================
// Agent 17 — Data Engineer
// ============================================================================

export async function dataEngineer(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const prismaPath = path.join(projectRoot, 'prisma');
  const servicesPath = path.join(projectRoot, 'src', 'services');

  console.log('    🔍 Анализ данных и ETL...');

  checkDataStructure(prismaPath, findings);
  checkETLProcesses(servicesPath, findings);
  checkDataPipelines(projectRoot, findings);

  return createReport('data-engineer', 'data', findings, startTime);
}

function checkDataStructure(prismaPath: string, findings: TestResult[]): void {
  if (!fs.existsSync(prismaPath)) {
    findings.push({
      agent: 'data-engineer',
      category: 'data',
      severity: 'critical',
      title: 'Отсутствует Prisma schema',
      description: 'Структура данных не определена.',
      recommendation: 'Создать prisma/schema.prisma'
    });
    return;
  }

  const schemaFiles = fs.readdirSync(prismaPath).filter(f => f.endsWith('.prisma'));
  
  for (const schemaFile of schemaFiles) {
    const schema = fs.readFileSync(path.join(prismaPath, schemaFile), 'utf-8');
    
    // Проверка auditing полей
    const hasAuditing = schema.includes('createdAt') && schema.includes('updatedAt');
    if (!hasAuditing) {
      findings.push({
        agent: 'data-engineer',
        category: 'data',
        severity: 'medium',
        title: 'Отсутствуют auditing поля',
        description: 'Без createdAt/updatedAt сложно отследить изменения данных.',
        file: `prisma/${schemaFile}`,
        recommendation: 'Добавить createdAt @default(now()) и updatedAt @updatedAt ко всем моделям'
      });
    }

    // Проверка soft delete
    const hasSoftDelete = schema.includes('deletedAt');
    if (!hasSoftDelete) {
      findings.push({
        agent: 'data-engineer',
        category: 'data',
        severity: 'low',
        title: 'Отсутствует soft delete',
        description: 'Hard delete удаляет данные навсегда. Soft delete лучше для аудита.',
        file: `prisma/${schemaFile}`,
        recommendation: 'Добавить deletedAt DateTime? для soft delete'
      });
    }

    // Проверка нормализации
    const hasDenormalization = schema.includes('Json');
    if (hasDenormalization) {
      const jsonFields = schema.match(/(\w+)\s+Json/g) || [];
      findings.push({
        agent: 'data-engineer',
        category: 'data',
        severity: 'medium',
        title: `Денормализация: ${jsonFields.length} JSON полей`,
        description: 'JSON поля затрудняют запросы и агрегацию.',
        file: `prisma/${schemaFile}`,
        recommendation: 'Нормализовать JSON в отдельные таблицы с foreign keys'
      });
    }
  }
}

function checkETLProcesses(servicesPath: string, findings: TestResult[]): void {
  // Проверка ETL логики
  const hasETL = searchInDir(servicesPath, /transform|aggregate|summarize|etl/i);
  
  if (!hasETL) {
    findings.push({
      agent: 'data-engineer',
      category: 'data',
      severity: 'medium',
      title: 'Отсутствуют ETL процессы',
      description: 'Нет агрегации и трансформации данных для аналитики.',
      recommendation: 'Создать nightly jobs для агрегации отчётов, расчёта KPI'
    });
  }

  // Проверка миграций данных
  const scriptsPath = path.join(projectRoot || '', '..', 'scripts');
  if (fs.existsSync(scriptsPath || '')) {
    const hasMigration = searchInDir(scriptsPath || '', /migrate|transform.*data/i);
    if (!hasMigration) {
      findings.push({
        agent: 'data-engineer',
        category: 'data',
        severity: 'low',
        title: 'Нет миграций данных',
        description: 'При изменении схемы могут потребоваться data migrations.',
        recommendation: 'Создать скрипты для миграции данных при изменении схемы'
      });
    }
  }
}

function checkDataPipelines(projectRoot: string, findings: TestResult[]): void {
  // Проверка data pipelines
  const hasPipeline = searchInDir(projectRoot, /pipeline|stream|batch.*process/i);
  
  if (!hasPipeline) {
    findings.push({
      agent: 'data-engineer',
      category: 'data',
      severity: 'low',
      title: 'Отсутствуют data pipelines',
      description: 'Для IoT данных и аналитики нужны data pipelines.',
      recommendation: 'Рассмотреть Apache Airflow или temporal.io для orchestration'
    });
  }
}

// ============================================================================
// Agent 18 — Data Quality Engineer
// ============================================================================

export async function dataQualityEngineer(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const servicesPath = path.join(projectRoot, 'src', 'services');

  console.log('    🔍 Анализ качества данных...');

  checkDuplicates(servicesPath, findings);
  checkInconsistency(servicesPath, findings);
  checkDataErrors(servicesPath, findings);

  return createReport('data-quality-engineer', 'data', findings, startTime);
}

function checkDuplicates(servicesPath: string, findings: TestResult[]): void {
  // Проверка unique constraints
  const prismaPath = path.join(projectRoot, 'prisma');
  if (fs.existsSync(prismaPath)) {
    const schemaFiles = fs.readdirSync(prismaPath).filter(f => f.endsWith('.prisma'));
    
    for (const schemaFile of schemaFiles) {
      const schema = fs.readFileSync(path.join(prismaPath, schemaFile), 'utf-8');
      
      const hasUnique = schema.includes('@unique') || schema.includes('@@unique');
      if (!hasUnique) {
        findings.push({
          agent: 'data-quality-engineer',
          category: 'data',
          severity: 'high',
          title: 'Отсутствуют unique constraints',
          description: 'Возможны дубликаты записей (email, названия объектов).',
          file: `prisma/${schemaFile}`,
          recommendation: 'Добавить @@unique([email]), @@unique([siteId, name])'
        });
      }
    }
  }

  // Проверка дубликатов в коде
  const hasUpsert = searchInDir(servicesPath, /upsert|update.*create|create.*or.*update/i);
  if (!hasUpsert) {
    findings.push({
      agent: 'data-quality-engineer',
      category: 'data',
      severity: 'medium',
      title: 'Не используется upsert',
      description: 'При повторном создании записей возможны дубликаты.',
      recommendation: 'Использовать Prisma upsert для идемпотентности'
    });
  }
}

function checkInconsistency(servicesPath: string, findings: TestResult[]): void {
  // Проверка валидации данных
  const hasValidation = searchInDir(servicesPath, /validate|safeParse|\.parse\(/i);
  
  if (!hasValidation) {
    findings.push({
      agent: 'data-quality-engineer',
      category: 'data',
      severity: 'high',
      title: 'Отсутствует валидация данных',
      description: 'Невалидные данные могут попасть в БД.',
      recommendation: 'Валидировать все данные перед записью'
    });
  }

  // Проверка referential integrity
  const hasRelations = searchInDir(servicesPath, /include:.*\{|select:.*\{/i);
  if (!hasRelations) {
    findings.push({
      agent: 'data-quality-engineer',
      category: 'data',
      severity: 'medium',
      title: 'Возможны orphan записи',
      description: 'Связанные записи могут ссылаться на несуществующие.',
      recommendation: 'Проверить foreign key constraints и каскадные удаления'
    });
  }
}

function checkDataErrors(servicesPath: string, findings: TestResult[]): void {
  // Проверка обработки ошибок при работе с данными
  const hasErrorHandling = searchInDir(servicesPath, /try.*catch|\.catch\(/i);
  
  if (!hasErrorHandling) {
    findings.push({
      agent: 'data-quality-engineer',
      category: 'data',
      severity: 'high',
      title: 'Ошибки данных не обрабатываются',
      description: 'При ошибках БД данные могут быть в неконсистентном состоянии.',
      recommendation: 'Обернуть операции с данными в транзакции с rollback'
    });
  }
}

// ============================================================================
// Agent 19 — Analytics Engineer
// ============================================================================

export async function analyticsEngineer(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const srcPath = path.join(projectRoot, 'src');

  console.log('    🔍 Анализ аналитики...');

  checkAnalytics(srcPath, findings);
  checkReports(srcPath, findings);
  checkBI(projectRoot, findings);

  return createReport('analytics-engineer', 'data', findings, startTime);
}

function checkAnalytics(srcPath: string, findings: TestResult[]): void {
  // Проверка аналитики
  const hasAnalytics = searchInDir(srcPath, /analytics|dashboard|chart|graph|recharts/i);
  
  if (!hasAnalytics) {
    findings.push({
      agent: 'analytics-engineer',
      category: 'data',
      severity: 'high',
      title: 'Отсутствует аналитика',
      description: 'Для SaaS платформы аналитика критична (прогресс по объектам, KPI бригад).',
      recommendation: 'Создать дашборды с прогрессом свай, бурения, простоев'
    });
  }

  // Проверка агрегаций
  const hasAggregations = searchInDir(srcPath, /groupBy|aggregate|count\(|sum\(|avg\(/i);
  if (!hasAggregations) {
    findings.push({
      agent: 'analytics-engineer',
      category: 'data',
      severity: 'medium',
      title: 'Отсутствуют агрегации',
      description: 'Без агрегаций аналитика будет медленной на больших данных.',
      recommendation: 'Создать материализованные представления для частых агрегаций'
    });
  }
}

function checkReports(srcPath: string, findings: TestResult[]): void {
  // Проверка отчётов
  const hasReports = searchInDir(srcPath, /report.*export|csv.*export|pdf.*gen/i);
  
  if (!hasReports) {
    findings.push({
      agent: 'analytics-engineer',
      category: 'data',
      severity: 'medium',
      title: 'Ограниченный экспорт отчётов',
      description: 'Пользователи могут захотеть экспорт в Excel, PDF для внешней аналитики.',
      recommendation: 'Реализовать экспорт в CSV, Excel, PDF'
    });
  }

  // Проверка scheduled reports
  const hasScheduledReports = searchInDir(srcPath, /schedule.*report|cron.*report/i);
  if (!hasScheduledReports) {
    findings.push({
      agent: 'analytics-engineer',
      category: 'data',
      severity: 'low',
      title: 'Отсутствуют scheduled отчёты',
      description: 'Пользователи могут хотеть автоматические отчёты по расписанию.',
      recommendation: 'Добавить scheduled отчёты (daily, weekly, monthly)'
    });
  }
}

function checkBI(projectRoot: string, findings: TestResult[]): void {
  // Проверка BI интеграции
  const hasBI = searchInDir(projectRoot, /metabase|superset|looker|tableau|bi.*tool/i);
  
  if (!hasBI) {
    findings.push({
      agent: 'analytics-engineer',
      category: 'data',
      severity: 'low',
      title: 'Отсутствует BI интеграция',
      description: 'Для глубокой аналитики можно интегрировать BI инструменты.',
      recommendation: 'Рассмотреть Metabase или Superset для self-service аналитики'
    });
  }
}

// Утилиты
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
