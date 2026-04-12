/**
 * Agent 6 — API Testing Engineer
 * Agent 7 — Concurrency Engineer  
 * Agent 8 — Performance Engineer
 * 
 * Комплексная проверка backend качества
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentReport, TestResult } from '../qa-director';

// ============================================================================
// Agent 6 — API Testing Engineer
// ============================================================================

export async function apiTestingEngineer(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const apiPath = path.join(projectRoot, 'src', 'app', 'api');

  console.log('    🔍 API тестирование...');

  // Генерация тестовых сценариев
  generateTestScenarios(apiPath, findings);

  // Проверка edge cases
  checkEdgeCases(apiPath, findings);

  // Проверка нагрузочных тестов
  checkLoadTests(projectRoot, findings);

  return createReport('api-testing-engineer', 'backend', findings, startTime);
}

function generateTestScenarios(apiPath: string, findings: TestResult[]): void {
  if (!fs.existsSync(apiPath)) return;

  const routeFiles = getAllRouteFiles(apiPath);
  const scenarios: string[] = [];

  for (const routeFile of routeFiles) {
    const content = fs.readFileSync(routeFile, 'utf-8');
    const relativePath = path.relative(apiPath, routeFile);

    if (content.includes('POST')) {
      scenarios.push(`POST ${relativePath} — успешное создание`);
      scenarios.push(`POST ${relativePath} — невалидные данные`);
      scenarios.push(`POST ${relativePath} — дубликат`);
      scenarios.push(`POST ${relativePath} — без авторизации`);
    }

    if (content.includes('GET')) {
      scenarios.push(`GET ${relativePath} — успешное получение`);
      scenarios.push(`GET ${relativePath} — ресурс не найден`);
      scenarios.push(`GET ${relativePath} — пустой список`);
    }

    if (content.includes('PUT')) {
      scenarios.push(`PUT ${relativePath} — успешное обновление`);
      scenarios.push(`PUT ${relativePath} — частичное обновление (PATCH)`);
      scenarios.push(`PUT ${relativePath} — обновление несуществующего`);
    }

    if (content.includes('DELETE')) {
      scenarios.push(`DELETE ${relativePath} — успешное удаление`);
      scenarios.push(`DELETE ${relativePath} — удаление с зависимостями`);
    }
  }

  findings.push({
    agent: 'api-testing-engineer',
    category: 'backend',
    severity: 'info',
    title: `Сгенерировано ${scenarios.length} тестовых сценариев`,
    description: scenarios.join('\n'),
    recommendation: 'Реализовать эти сценарии как интеграционные тесты'
  });

  // Проверка отсутствия тестов
  const testDirs = ['__tests__', 'tests', '__test__', 'test'];
  let hasTests = false;

  for (const testDir of testDirs) {
    const testPath = path.join(projectRoot, testDir);
    if (fs.existsSync(testPath)) {
      hasTests = true;
      break;
    }
  }

  const hasTestFiles = fs.readdirSync(projectRoot, { recursive: true })
    .some((f: any) => /\.(test|spec)\.(ts|js)$/.test(f.toString()));

  if (!hasTests && !hasTestFiles) {
    findings.push({
      agent: 'api-testing-engineer',
      category: 'backend',
      severity: 'critical',
      title: 'Отсутствуют API тесты',
      description: 'Нет интеграционных тестов для API endpoints. Это production risk.',
      recommendation: 'Создать тесты с Vitest/Jest для всех API endpoints'
    });
  }
}

function checkEdgeCases(apiPath: string, findings: TestResult[]): void {
  // Проверка обработки пустых значений
  const hasEmptyCheck = searchInDir(apiPath, /isEmpty|length\s*===\s*0|!.*\.length/i);
  if (!hasEmptyCheck) {
    findings.push({
      agent: 'api-testing-engineer',
      category: 'backend',
      severity: 'medium',
      title: 'Возможны edge cases с пустыми значениями',
      description: 'API может не обрабатывать пустые массивы/строки корректно.',
      recommendation: 'Тестировать: пустые body, null значения, пустые массивы'
    });
  }

  // Проверка обработки больших значений
  const hasLimitCheck = searchInDir(apiPath, /\.slice\(|\.limit\(|MAX_|LIMIT_/i);
  if (!hasLimitCheck) {
    findings.push({
      agent: 'api-testing-engineer',
      category: 'backend',
      severity: 'medium',
      title: 'Возможны edge cases с большими данными',
      description: 'API может не ограничивать размер запросов и ответов.',
      recommendation: 'Добавить лимиты: pagination, max body size, max response size'
    });
  }
}

function checkLoadTests(projectRoot: string, findings: TestResult[]): void {
  // Проверка наличие нагрузочных тестов
  const hasLoadTests = searchInDir(projectRoot, /k6|artillery|loadtest|wrk|ab /i);
  
  if (!hasLoadTests) {
    findings.push({
      agent: 'api-testing-engineer',
      category: 'backend',
      severity: 'high',
      title: 'Отсутствуют нагрузочные тесты',
      description: 'Нет тестов производительности API. Нельзя оценить scalability.',
      recommendation: 'Использовать k6 или Artillery для нагрузочного тестирования'
    });
  }
}

// ============================================================================
// Agent 7 — Concurrency Engineer
// ============================================================================

export async function concurrencyEngineer(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const srcPath = path.join(projectRoot, 'src');

  console.log('    🔍 Анализ конкурентности...');

  // Проверка race conditions
  checkRaceConditions(srcPath, findings);

  // Проверка deadlocks
  checkDeadlocks(srcPath, findings);

  // Проверка data corruption
  checkDataCorruption(srcPath, findings);

  return createReport('concurrency-engineer', 'backend', findings, startTime);
}

function checkRaceConditions(srcPath: string, findings: TestResult[]): void {
  // Проверка read-modify-write паттернов
  const hasReadModifyWrite = searchInDir(srcPath, /const\s+\w+\s*=.*await.*\.\w+\(\)[\s\S]{0,500}await.*\.\w+\(/i);
  
  if (hasReadModifyWrite) {
    findings.push({
      agent: 'concurrency-engineer',
      category: 'backend',
      severity: 'high',
      title: 'Возможны race conditions',
      description: 'Найдены read-modify-write паттерны без транзакций. Параллельные запросы вызовут lost updates.',
      recommendation: 'Обернуть в Prisma $transaction или использовать optimistic locking'
    });
  }

  // Проверка increment операций
  const hasIncrement = searchInDir(srcPath, /\bcount\b.*=.*\bcount\b.*\+|\bcount\+\+|\+\+\bcount\b/i);
  if (hasIncrement) {
    findings.push({
      agent: 'concurrency-engineer',
      category: 'backend',
      severity: 'high',
      title: 'Небезопасные increment операции',
      description: 'Ручное увеличение счётчиков уязвимо для race conditions.',
      recommendation: 'Использовать Prisma increment: { count: { increment: 1 } }'
    });
  }

  // Проверка singleton/global state
  const hasGlobalState = searchInDir(srcPath, /let\s+\w+\s*=\s*|global\.\w+|Map\(\)|Set\(\)/i);
  if (hasGlobalState) {
    findings.push({
      agent: 'concurrency-engineer',
      category: 'backend',
      severity: 'medium',
      title: 'Глобальное состояние в приложении',
      description: 'Глобальные переменные не безопасны для concurrent requests в serverless/cluster.',
      recommendation: 'Использовать Redis или БД для хранения состояния'
    });
  }
}

function checkDeadlocks(srcPath: string, findings: TestResult[]): void {
  // Проверка множественных транзакций
  const hasMultipleTransactions = searchInDir(srcPath, /\$transaction.*\$transaction|\$transaction[\s\S]{0,1000}\$transaction/i);
  
  if (hasMultipleTransactions) {
    findings.push({
      agent: 'concurrency-engineer',
      category: 'backend',
      severity: 'medium',
      title: 'Возможны deadlocks',
      description: 'Вложенные или последовательные транзакции могут вызвать deadlocks при блокировке ресурсов.',
      recommendation: 'Убедиться что транзакции в одном порядке, использовать timeout'
    });
  }
}

function checkDataCorruption(srcPath: string, findings: TestResult[]): void {
  // Проверка валидации перед записью
  const hasValidation = searchInDir(srcPath, /safeParse|validate|\.parse\(/i);
  const hasWrite = searchInDir(srcPath, /\.create\(|\.update\(|\.upsert\(/i);

  if (hasWrite && !hasValidation) {
    findings.push({
      agent: 'concurrency-engineer',
      category: 'backend',
      severity: 'high',
      title: 'Запись без валидации',
      description: 'Данные записываются без валидации, что может привести к corruption.',
      recommendation: 'Валидировать все данные перед записью в БД'
    });
  }

  // Проверка целостности связей
  const hasCascadeDelete = searchInDir(srcPath, /onDelete:\s*Cascade/i);
  const hasSoftDelete = searchInDir(srcPath, /deletedAt|isDeleted|soft.*delete/i);

  if (hasCascadeDelete && !hasSoftDelete) {
    findings.push({
      agent: 'concurrency-engineer',
      category: 'backend',
      severity: 'low',
      title: 'Используется hard delete',
      description: 'Каскадные удаления могут удалить важные данные. Soft delete безопаснее.',
      recommendation: 'Рассмотреть soft delete для аудита и восстановления данных'
    });
  }
}

// ============================================================================
// Agent 8 — Performance Engineer
// ============================================================================

export async function performanceEngineer(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const srcPath = path.join(projectRoot, 'src');

  console.log('    🔍 Анализ производительности...');

  // Проверка нагрузки
  checkLoad(srcPath, findings);

  // Проверка latency
  checkLatency(srcPath, findings);

  // Проверка throughput
  checkThroughput(srcPath, projectRoot, findings);

  return createReport('performance-engineer', 'backend', findings, startTime);
}

function checkLoad(srcPath: string, findings: TestResult[]): void {
  // Проверка N+1 запросов
  const hasNPlus1 = checkNPlusOne(srcPath);
  
  if (hasNPlus1) {
    findings.push({
      agent: 'performance-engineer',
      category: 'backend',
      severity: 'high',
      title: 'Обнаружены N+1 запросы',
      description: 'Prisma запросы в цикле создают N+1 запросов к БД.',
      recommendation: 'Использовать include или отдельный запрос с WHERE IN'
    });
  }

  // Проверка отсутствия pagination
  const hasUnlimitedQueries = searchInDir(srcPath, /findMany\(\)|\.findMany\(\s*\)/i);
  if (hasUnlimitedQueries) {
    findings.push({
      agent: 'performance-engineer',
      category: 'backend',
      severity: 'medium',
      title: 'Запросы без лимита',
      description: 'findMany() без take/limit возвращает все записи, что медленно и затратно по памяти.',
      recommendation: 'Всегда использовать take и skip для pagination'
    });
  }

  // Проверка select vs load all fields
  const hasSelectAll = searchInDir(srcPath, /findMany|findFirst|findUnique/i);
  const hasSelect = searchInDir(srcPath, /select:\s*\{/i);

  if (hasSelectAll && !hasSelect) {
    findings.push({
      agent: 'performance-engineer',
      category: 'backend',
      severity: 'medium',
      title: 'Загружаются все поля',
      description: 'SELECT * загружает ненужные поля, увеличивая latency и memory usage.',
      recommendation: 'Использовать select: { field1: true, field2: true } для конкретных полей'
    });
  }
}

function checkLatency(srcPath: string, findings: TestResult[]): void {
  // Проверка кэширования
  const hasCaching = searchInDir(srcPath, /cache|lru-cache|redis.*get|memory.*cache/i);
  
  if (!hasCaching) {
    findings.push({
      agent: 'performance-engineer',
      category: 'backend',
      severity: 'high',
      title: 'Отсутствует кэширование',
      description: 'Словари, конфигурации, частые запросы не кэшируются. Каждый запрос идёт в БД.',
      recommendation: 'Кэшировать словари, config, частые запросы в Redis или in-memory'
    });
  }

  // Проверка индексации (через Prisma)
  const hasIndexHints = searchInDir(srcPath, /orderBy|sortBy/i);
  if (hasIndexHints) {
    findings.push({
      agent: 'performance-engineer',
      category: 'backend',
      severity: 'low',
      title: 'Запросы с сортировкой',
      description: 'ORDER BY без индекса медленный. Убедиться что поля сортировки индексированы.',
      recommendation: 'Добавить индексы на поля сортировки (date, createdAt)'
    });
  }
}

function checkThroughput(srcPath: string, projectRoot: string, findings: TestResult[]): void {
  // Проверка асинхронных операций
  const hasSyncOps = searchInDir(srcPath, /fs\.readFileSync|fs\.writeFileSync|execSync/i);
  
  if (hasSyncOps) {
    findings.push({
      agent: 'performance-engineer',
      category: 'backend',
      severity: 'critical',
      title: 'Синхронные файловые операции',
      description: 'Sync операции блокируют event loop, снижая throughput.',
      recommendation: 'Заменить на async: fs.promises.readFile, exec'
    });
  }

  // Проверка PDF генерации
  const hasPDFGen = searchInDir(srcPath, /pdfkit|pdf|execFile.*pdf/i);
  if (hasPDFGen) {
    findings.push({
      agent: 'performance-engineer',
      category: 'backend',
      severity: 'medium',
      title: 'PDF генерация в request cycle',
      description: 'Генерация PDF в API запросе блокирует thread и увеличивает latency.',
      recommendation: 'Вынести PDF генерацию в фоновую задачу (queue worker)'
    });
  }

  // Проверка compression
  const nextConfigPath = path.join(projectRoot, 'next.config.ts');
  if (fs.existsSync(nextConfigPath)) {
    const config = fs.readFileSync(nextConfigPath, 'utf-8');
    if (!config.includes('compress') && !config.includes('gzip')) {
      findings.push({
        agent: 'performance-engineer',
        category: 'backend',
        severity: 'medium',
        title: 'Возможно отсутствует compression',
        description: 'Без compression ответы больше и медленнее передаются.',
        file: 'next.config.ts',
        recommendation: 'Включить compression в Next.js config'
      });
    }
  }
}

function checkNPlusOne(srcPath: string): boolean {
  // Поиск циклов с Prisma запросами
  try {
    const { execSync } = require('child_process');
    const command = process.platform === 'win32'
      ? `findstr /S /N "for.*await.*prisma\\|for.*await.*\\.findMany\\|for.*await.*\\.findUnique" "${srcPath}\\*.ts" 2>nul || true`
      : `grep -r -n "for.*await.*prisma\\|for.*await.*\\.findMany\\|for.*await.*\\.findUnique" ${srcPath} --include="*.ts" 2>/dev/null || true`;
    
    const result = execSync(command, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

// Утилиты
function getAllRouteFiles(apiPath: string): string[] {
  let files: string[] = [];
  if (!fs.existsSync(apiPath)) return files;

  const items = fs.readdirSync(apiPath);
  for (const item of items) {
    const fullPath = path.join(apiPath, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      files = files.concat(getAllRouteFiles(fullPath));
    } else if (item === 'route.ts') {
      files.push(fullPath);
    }
  }
  return files;
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
