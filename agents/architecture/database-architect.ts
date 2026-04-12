/**
 * Agent 4 — Database Architect
 * 
 * Анализирует базу данных PilingTrack:
 * - Структуру БД
 * - Индексы
 * - Нормализацию
 * - Транзакции
 * - Производительность
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentReport, TestResult } from '../qa-director';

export default async function databaseArchitectAgent(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const prismaPath = path.join(projectRoot, 'prisma');

  console.log('    🔍 Анализ базы данных...');

  // Проверка Prisma схем
  const schemaFiles = fs.existsSync(prismaPath) 
    ? fs.readdirSync(prismaPath).filter(f => f.endsWith('.prisma'))
    : [];

  if (schemaFiles.length === 0) {
    findings.push({
      agent: 'database-architect',
      category: 'architecture',
      severity: 'critical',
      title: 'Отсутствует Prisma schema',
      description: 'Не найдены файлы Prisma schema. База данных не определена.',
      recommendation: 'Создать prisma/schema.prisma с моделями'
    });

    return createReport(findings, startTime);
  }

  // Анализ каждой схемы
  for (const schemaFile of schemaFiles) {
    const schemaPath = path.join(prismaPath, schemaFile);
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    
    analyzeSchema(schema, schemaFile, findings, projectRoot);
  }

  // Проверка миграций
  checkMigrations(prismaPath, findings);

  // Проверка seed данных
  checkSeeds(projectRoot, findings);

  return createReport(findings, startTime);
}

function analyzeSchema(
  schema: string, 
  schemaFile: string, 
  findings: TestResult[],
  projectRoot: string
): void {
  const isProduction = schemaFile.includes('postgres');

  // 1. Проверка индексов
  checkIndexes(schema, schemaFile, findings);

  // 2. Проверка нормализации
  checkNormalization(schema, schemaFile, findings);

  // 3. Проверка внешних ключей
  checkForeignKeys(schema, schemaFile, findings);

  // 4. Проверка типов данных
  checkDataTypes(schema, schemaFile, findings);

  // 5. Проверка ограничений
  checkConstraints(schema, schemaFile, findings);

  // 6. Проверка производительности запросов
  checkQueryPerformance(schema, schemaFile, findings, projectRoot);
}

function checkIndexes(schema: string, schemaFile: string, findings: TestResult[]): void {
  // Подсчёт моделей
  const models = schema.match(/model\s+\w+/g) || [];
  const modelCount = models.length;

  // Подсчёт индексов
  const indexes = schema.match(/@@index/g) || [];
  const indexCount = indexes.length;

  // Проверка индексации часто используемых полей
  const hasEmailIndex = schema.includes('@@index') && schema.includes('email');
  const hasDateIndex = schema.includes('@@index') && schema.includes('date');
  const hasForeignKeysIndexed = schema.includes('@@index') && schema.includes('Id');

  if (indexCount === 0) {
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'high',
      title: 'Отсутствуют индексы',
      description: `В ${schemaFile} нет @@index. При росте данных запросы станут очень медленными.`,
      file: `prisma/${schemaFile}`,
      recommendation: 'Добавить @@index на: email, date, siteId, crewId, userId, status'
    });
  } else if (indexCount < modelCount / 2) {
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'medium',
      title: 'Недостаточно индексов',
      description: `Всего ${indexCount} индексов для ${modelCount} моделей. Рекомендуется минимум 1 индекс на модель.`,
      file: `prisma/${schemaFile}`,
      recommendation: 'Добавить индексы на часто используемые поля фильтрации и поиска'
    });
  }

  // Проверка composite индексов
  const hasCompositeIndex = schema.includes('@@index\([');
  if (!hasCompositeIndex) {
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'low',
      title: 'Отсутствуют composite индексы',
      description: 'Составные индексы полезны для запросов с несколькими условиями (siteId + date).',
      file: `prisma/${schemaFile}`,
      recommendation: 'Добавить @@index([siteId, date]) для отчётов, @@index([siteId, status])'
    });
  }
}

function checkNormalization(schema: string, schemaFile: string, findings: TestResult[]): void {
  // Проверка JSON полей
  const hasJson = schema.includes('Json');
  if (hasJson) {
    const jsonMatch = schema.match(/(\w+)\s+Json/g);
    if (jsonMatch) {
      findings.push({
        agent: 'database-architect',
        category: 'data',
        severity: 'medium',
        title: 'Используются JSON поля',
        description: `JSON поля (${jsonMatch.join(', ')}) не нормализованы. Это затрудняет запросы и индексацию.`,
        file: `prisma/${schemaFile}`,
        recommendation: 'Рассмотреть вынос JSON в отдельные таблицы с foreign keys'
      });
    }
  }

  // Проверка enums
  const hasEnums = schema.includes('enum ');
  if (hasEnums) {
    // Enums - это хорошо для нормализации
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'info',
      title: 'Используются enums',
      description: 'Enums обеспечивают целостность данных на уровне БД.',
      file: `prisma/${schemaFile}`,
      recommendation: 'Убедиться, что enums синхронизированы с frontend validation'
    });
  }

  // Проверка Many-to-Many отношений
  const hasManyToMany = schema.includes('ManyToMany') || (schema.match(/\[\]/g) || []).length > 5;
  if (hasManyToMany) {
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'low',
      title: 'Возможны implicit Many-to-Many отношения',
      description: 'Implicit M2M в Prisma создают скрытые junction таблицы. Лучше использовать explicit.',
      file: `prisma/${schemaFile}`,
      recommendation: 'Использовать explicit junction tables с дополнительными полями (createdAt, createdBy)'
    });
  }
}

function checkForeignKeys(schema: string, schemaFile: string, findings: TestResult[]): void {
  // Проверка каскадных удалений
  const hasRelations = schema.includes('@relation');
  const hasCascadeDelete = schema.includes('onDelete: Cascade');
  const hasCascadeNull = schema.includes('onDelete: SetNull');

  if (hasRelations && !hasCascadeDelete && !hasCascadeNull) {
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'high',
      title: 'Не настроены каскадные удаления',
      description: 'При удалении родительских записей (Site, Crew) orphan записи останутся в БД.',
      file: `prisma/${schemaFile}`,
      recommendation: 'Добавить onDelete: Cascade или SetNull ко всем @relation'
    });
  }

  // Проверка orphan записей
  const hasRequiredRelations = schema.includes('@relation');
  const optionalRelations = schema.match(/\?\s+@relation/g);
  const requiredRelations = schema.match(/!\s+@relation/g);

  if (optionalRelations && optionalRelations.length > 5) {
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'medium',
      title: 'Много optional relations',
      description: `${optionalRelations.length} optional foreign keys. Это может привести к orphan данным.`,
      file: `prisma/${schemaFile}`,
      recommendation: 'Пересмотреть哪些 отношения должны быть required'
    });
  }
}

function checkDataTypes(schema: string, schemaFile: string, findings: TestResult[]): void {
  // Проверка DateTime usage
  const hasDateTime = schema.includes('DateTime');
  if (hasDateTime) {
    // Хорошо, что есть DateTime
  } else {
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'medium',
      title: 'Отсутствует DateTime тип',
      description: 'Для отчётов и аудита нужен DateTime. Проверить использование String вместо DateTime.',
      file: `prisma/${schemaFile}`,
      recommendation: 'Использовать DateTime @default(now()) для timestamp полей'
    });
  }

  // Проверка Decimal для чисел
  const hasDecimal = schema.includes('Decimal');
  const hasFloat = schema.includes('Float');
  
  if (hasFloat && !hasDecimal) {
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'medium',
      title: 'Float вместо Decimal',
      description: 'Float может дать погрешности в расчётах. Для денег и измерений использовать Decimal.',
      file: `prisma/${schemaFile}`,
      recommendation: 'Заменить Float на Decimal для: стоимость, метры, количество'
    });
  }

  // Проверка String lengths
  const hasStrings = schema.match(/String/g) || [];
  const hasUnboundedStrings = schema.match(/String\s*;/g) || [];
  
  if (hasUnboundedStrings.length > 0) {
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'low',
      title: 'String поля без ограничения длины',
      description: `Найдено ${hasUnboundedStrings.length} String полей без @db.VarChar. Это неэффективно.`,
      file: `prisma/${schemaFile}`,
      recommendation: 'Добавить @db.VarChar(255) или @db.Text явно'
    });
  }
}

function checkConstraints(schema: string, schemaFile: string, findings: TestResult[]): void {
  // Проверка unique constraints
  const hasUnique = schema.includes('@unique') || schema.includes('@@unique');
  if (!hasUnique) {
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'high',
      title: 'Отсутствуют unique constraints',
      description: 'Без unique constraints возможны дубликаты (email, название объекта).',
      file: `prisma/${schemaFile}`,
      recommendation: 'Добавить @@unique([email]), @@unique([siteId, name]) и т.д.'
    });
  }

  // Проверка check constraints
  const hasCheck = schema.includes('@@check');
  if (!hasCheck) {
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'medium',
      title: 'Отсутствуют check constraints',
      description: 'Check constraints обеспечивают валидацию на уровне БД (количество > 0, дата не в будущем).',
      file: `prisma/${schemaFile}`,
      recommendation: 'Добавить @@check для: count > 0, duration > 0, date <= NOW()'
    });
  }

  // Проверка default values
  const hasDefaults = schema.includes('@default');
  if (!hasDefaults) {
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'low',
      title: 'Отсутствуют default values',
      description: 'Default values упрощают создание записей и избегают NULL.',
      file: `prisma/${schemaFile}`,
      recommendation: 'Добавить @default(now()), @default(false), @default(0) где уместно'
    });
  }
}

function checkQueryPerformance(
  schema: string, 
  schemaFile: string, 
  findings: TestResult[],
  projectRoot: string
): void {
  // Проверка N+1 запросов в коде
  const srcPath = path.join(projectRoot, 'src');
  const hasNPlus1 = searchInDir(srcPath, /\.findMany.*include:.*\{/g);
  
  if (hasNPlus1) {
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'high',
      title: 'Возможны N+1 запросы',
      description: 'Prisma include может создавать N+1 запросы при определённых условиях.',
      recommendation: 'Проверить Prisma query plan, использовать include с осторожностью, тестировать производительность'
    });
  }

  // Проверка select vs include
  const hasInclude = searchInDir(srcPath, /include:\s*\{/g);
  const hasSelect = searchInDir(srcPath, /select:\s*\{/g);
  
  if (hasInclude && !hasSelect) {
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'medium',
      title: 'Используется include вместо select',
      description: 'Include загружает все связанные записи. Select более эффективен для конкретных полей.',
      recommendation: 'Использовать select для получения только нужных полей'
    });
  }
}

function checkMigrations(prismaPath: string, findings: TestResult[]): void {
  const migrationsPath = path.join(prismaPath, 'migrations');
  
  if (!fs.existsSync(migrationsPath)) {
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'medium',
      title: 'Отсутствует папка миграций',
      description: 'Prisma migrations не найдены. Миграции важны для version control схемы.',
      recommendation: 'Запустить prisma migrate dev для создания миграций'
    });
    return;
  }

  const migrationFolders = fs.readdirSync(migrationsPath).filter(f => {
    const fullPath = path.join(migrationsPath, f);
    return fs.statSync(fullPath).isDirectory();
  });

  if (migrationFolders.length === 0) {
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'low',
      title: 'Нет миграций',
      description: 'Папка migrations пуста. Рекомендуется создать начальную миграцию.',
      recommendation: 'Запустить prisma migrate dev --name init'
    });
  }
}

function checkSeeds(projectRoot: string, findings: TestResult[]): void {
  const seedPath = path.join(projectRoot, 'prisma', 'seed.ts');
  
  if (!fs.existsSync(seedPath)) {
    findings.push({
      agent: 'database-architect',
      category: 'data',
      severity: 'low',
      title: 'Отсутствует seed скрипт',
      description: 'Seed скрипт полезен для development и testing данных.',
      recommendation: 'Создать prisma/seed.ts с демо-данными'
    });
  }
}

function createReport(findings: TestResult[], startTime: number): AgentReport {
  const duration = Date.now() - startTime;
  const status = findings.some(f => f.severity === 'critical' || f.severity === 'high') 
    ? 'failed' 
    : findings.some(f => f.severity === 'medium') 
      ? 'warning' 
      : 'passed';

  return {
    agentName: 'database-architect',
    category: 'architecture',
    status,
    findings,
    summary: `Найдено ${findings.length} проблем базы данных`,
    executedAt: new Date().toISOString(),
    duration
  };
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
