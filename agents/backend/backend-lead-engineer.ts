/**
 * Agent 5 — Backend Lead Engineer
 * 
 * Проверяет backend PilingTrack:
 * - API endpoints
 * - Бизнес-логика
 * - Валидация данных
 * - Обработка ошибок
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentReport, TestResult } from '../qa-director';

export default async function backendLeadEngineer(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const apiPath = path.join(projectRoot, 'src', 'app', 'api');
  const servicesPath = path.join(projectRoot, 'src', 'services');

  console.log('    🔍 Анализ backend кода...');

  // 1. Проверка API endpoints
  checkAPIEndpoints(apiPath, findings);

  // 2. Проверка бизнес-логики
  checkBusinessLogic(servicesPath, findings);

  // 3. Проверка валидации данных
  checkDataValidation(apiPath, servicesPath, findings);

  // 4. Проверка обработки ошибок
  checkErrorHandling(apiPath, servicesPath, findings);

  // 5. Проверка HTTP методов и статусов
  checkHttpStatus(apiPath, findings);

  // 6. Проверка middleware
  checkMiddleware(apiPath, projectRoot, findings);

  const duration = Date.now() - startTime;
  const status = findings.some(f => f.severity === 'critical' || f.severity === 'high') 
    ? 'failed' 
    : findings.some(f => f.severity === 'medium') 
      ? 'warning' 
      : 'passed';

  return {
    agentName: 'backend-lead-engineer',
    category: 'backend',
    status,
    findings,
    summary: `Найдено ${findings.length} замечаний к backend`,
    executedAt: new Date().toISOString(),
    duration
  };
}

function checkAPIEndpoints(apiPath: string, findings: TestResult[]): void {
  if (!fs.existsSync(apiPath)) {
    findings.push({
      agent: 'backend-lead-engineer',
      category: 'backend',
      severity: 'critical',
      title: 'API routes отсутствуют',
      description: 'Папка src/app/api не найдена. Backend не имеет REST API.',
      recommendation: 'Создать API routes согласно Next.js App Router'
    });
    return;
  }

  // Подсчёт endpoints
  const routeFiles = countFiles(apiPath, /route\.ts$/);
  
  if (routeFiles === 0) {
    findings.push({
      agent: 'backend-lead-engineer',
      category: 'backend',
      severity: 'critical',
      title: 'Нет API routes',
      description: 'В src/app/api нет route.ts файлов.',
      recommendation: 'Создать API endpoints для: auth, sites, reports, crews, equipment'
    });
  } else if (routeFiles > 30) {
    findings.push({
      agent: 'backend-lead-engineer',
      category: 'backend',
      severity: 'low',
      title: 'Большое количество API endpoints',
      description: `${routeFiles} API endpoints могут быть сложны для поддержки. Рассмотреть API versioning.`,
      recommendation: 'Внедрить API versioning (/api/v1/, /api/v2/) для обратной совместимости'
    });
  }

  // Проверка RESTful именование
  const hasRESTfulNaming = checkRESTfulNaming(apiPath, findings);
  if (!hasRESTfulNaming) {
    findings.push({
      agent: 'backend-lead-engineer',
      category: 'backend',
      severity: 'medium',
      title: 'API не следует RESTful conventions',
      description: 'Некоторые endpoints не следуют RESTful naming (например, /reports/my вместо /users/me/reports).',
      recommendation: 'Использовать RESTful ресурсы: GET /sites, POST /sites, GET /sites/:id/reports'
    });
  }
}

function checkBusinessLogic(servicesPath: string, findings: TestResult[]): void {
  if (!fs.existsSync(servicesPath)) {
    findings.push({
      agent: 'backend-lead-engineer',
      category: 'backend',
      severity: 'high',
      title: 'Отсутствует сервисный слой',
      description: 'Нет папки src/services. Бизнес-логика находится в API routes, что нарушает separation of concerns.',
      recommendation: 'Вынести бизнес-логику в сервисы: ReportService, SiteService, AuthService'
    });
    return;
  }

  const serviceFiles = fs.readdirSync(servicesPath).filter(f => f.endsWith('.ts'));
  
  // Проверка размера сервисов
  for (const file of serviceFiles) {
    const filePath = path.join(servicesPath, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').length;

    if (lines > 300) {
      findings.push({
        agent: 'backend-lead-engineer',
        category: 'backend',
        severity: 'medium',
        title: `Сервис ${file} слишком большой`,
        description: `${file} имеет ${lines} строк. Большие сервисы сложно поддерживать.`,
        file: `src/services/${file}`,
        recommendation: 'Разделить сервис на более мелкие по принципу Single Responsibility'
      });
    }
  }

  // Проверка зависимости сервисов
  const hasCircularDeps = checkCircularDependencies(servicesPath, findings);
  if (hasCircularDeps) {
    findings.push({
      agent: 'backend-lead-engineer',
      category: 'backend',
      severity: 'high',
      title: 'Возможны circular зависимости',
      description: 'Сервисы импортируют друг друга, что ведёт к circular dependency ошибкам.',
      recommendation: 'Рефакторинг для устранения circular imports через event emitter или dependency injection'
    });
  }
}

function checkDataValidation(
  apiPath: string, 
  servicesPath: string, 
  findings: TestResult[]
): void {
  // Проверка Zod usage
  const hasZod = searchInDir(apiPath, /zod|z\./i);
  
  if (!hasZod) {
    findings.push({
      agent: 'backend-lead-engineer',
      category: 'backend',
      severity: 'critical',
      title: 'Отсутствует валидация входных данных',
      description: 'API не валидирует request body/query/params. Это риск безопасности и целостности данных.',
      recommendation: 'Использовать Zod схемы для валидации всех входных данных'
    });
    return;
  }

  // Проверка валидации в каждом endpoint
  const routeFiles = getAllRouteFiles(apiPath);
  let unvalidatedEndpoints: string[] = [];

  for (const routeFile of routeFiles) {
    const content = fs.readFileSync(routeFile, 'utf-8');
    const hasValidation = /safeParse|\.parse\(|zod|validate/i.test(content);
    
    // Проверка что endpoint принимает данные (POST/PUT/PATCH)
    const hasMutation = /POST|PUT|PATCH/i.test(content);
    
    if (hasMutation && !hasValidation) {
      const relativePath = path.relative(apiPath, routeFile);
      unvalidatedEndpoints.push(relativePath);
    }
  }

  if (unvalidatedEndpoints.length > 0) {
    findings.push({
      agent: 'backend-lead-engineer',
      category: 'backend',
      severity: 'high',
      title: 'Не все endpoints валидируют данные',
      description: `Endpoints без валидации: ${unvalidatedEndpoints.slice(0, 5).join(', ')}`,
      recommendation: 'Добавить Zod валидацию ко всем POST/PUT/PATCH endpoints'
    });
  }
}

function checkErrorHandling(
  apiPath: string, 
  servicesPath: string, 
  findings: TestResult[]
): void {
  // Проверка try-catch в API
  const routeFiles = getAllRouteFiles(apiPath);
  let unhandledEndpoints: string[] = [];

  for (const routeFile of routeFiles) {
    const content = fs.readFileSync(routeFile, 'utf-8');
    const hasTryCatch = /try\s*\{[\s\S]*?\}\s*catch/i.test(content);
    const hasAsync = /async/i.test(content);
    
    if (hasAsync && !hasTryCatch) {
      const relativePath = path.relative(apiPath, routeFile);
      unhandledEndpoints.push(relativePath);
    }
  }

  if (unhandledEndpoints.length > 0) {
    findings.push({
      agent: 'backend-lead-engineer',
      category: 'backend',
      severity: 'critical',
      title: 'API endpoints без обработки ошибок',
      description: `${unhandledEndpoints.length} endpoints без try-catch. Необработанные ошибки вызовут 500.`,
      recommendation: 'Обернуть async функции в try-catch с возвратом корректных HTTP статусов'
    });
  }

  // Проверка кастомных ошибок
  const hasCustomErrors = searchInDir(servicesPath, /class.*Error|ServiceError|AppError/i);
  if (!hasCustomErrors) {
    findings.push({
      agent: 'backend-lead-engineer',
      category: 'backend',
      severity: 'medium',
      title: 'Отсутствуют кастомные ошибки',
      description: 'Без кастомных ошибок сложно различить типы ошибок (validation, not found, unauthorized).',
      recommendation: 'Создать классы ошибок: ValidationError, NotFoundError, UnauthorizedError'
    });
  }

  // Проверка error response format
  const hasErrorFormat = searchInDir(apiPath, /NextResponse\.json.*error|message.*status/i);
  if (!hasErrorFormat) {
    findings.push({
      agent: 'backend-lead-engineer',
      category: 'backend',
      severity: 'low',
      title: 'Нет единого формата ошибок',
      description: 'API endpoints могут возвращать ошибки в разных форматах.',
      recommendation: 'Стандартизировать формат ошибок: { error: { message, code, details } }'
    });
  }
}

function checkHttpStatus(apiPath: string, findings: TestResult[]): void {
  const routeFiles = getAllRouteFiles(apiPath);
  
  let incorrectStatuses: string[] = [];

  for (const routeFile of routeFiles) {
    const content = fs.readFileSync(routeFile, 'utf-8');
    
    // Проверка POST returning 200 вместо 201
    const hasPOST = content.includes('POST');
    const has200 = content.includes('200') || content.includes('NextResponse.json(');
    const has201 = content.includes('201');
    
    if (hasPOST && has200 && !has201) {
      const relativePath = path.relative(apiPath, routeFile);
      incorrectStatuses.push(relativePath);
    }
  }

  if (incorrectStatuses.length > 0) {
    findings.push({
      agent: 'backend-lead-engineer',
      category: 'backend',
      severity: 'medium',
      title: 'Некорректные HTTP статусы',
      description: 'POST endpoints должны возвращать 201 Created, не 200 OK.',
      recommendation: 'Использовать 201 для создания, 204 для удаления, 200 для обновления'
    });
  }
}

function checkMiddleware(apiPath: string, projectRoot: string, findings: TestResult[]): void {
  // Проверка middleware.ts
  const middlewarePath = path.join(projectRoot, 'src', 'middleware.ts');
  const hasMiddleware = fs.existsSync(middlewarePath);

  if (!hasMiddleware) {
    findings.push({
      agent: 'backend-lead-engineer',
      category: 'backend',
      severity: 'medium',
      title: 'Отсутствует Next.js middleware',
      description: 'Middleware полезен для: auth, logging, rate limiting, CORS.',
      recommendation: 'Создать src/middleware.ts для глобальных проверок'
    });
    return;
  }

  const middleware = fs.readFileSync(middlewarePath, 'utf-8');
  
  // Проверка auth middleware
  const hasAuth = /auth|session|token/i.test(middleware);
  if (!hasAuth) {
    findings.push({
      agent: 'backend-lead-engineer',
      category: 'backend',
      severity: 'high',
      title: 'Middleware не проверяет аутентификацию',
      description: 'Middleware должен проверять сессию до попадания в API route.',
      file: 'src/middleware.ts',
      recommendation: 'Добавить проверку сессии в middleware'
    });
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

function checkRESTfulNaming(apiPath: string, findings: TestResult[]): boolean {
  const routeFiles = getAllRouteFiles(apiPath);
  let nonRESTful: string[] = [];

  for (const routeFile of routeFiles) {
    const relativePath = path.relative(apiPath, routeFile);
    
    // Проверка на non-RESTful naming
    if (/\/my\/|\/all\/|\/manage\/|\/upsert\//i.test(relativePath)) {
      nonRESTful.push(relativePath);
    }
  }

  return nonRESTful.length === 0;
}

function checkCircularDependencies(servicesPath: string, findings: TestResult[]): boolean {
  // Простая проверка: сервис импортирует другой сервис, который импортирует первый
  const serviceFiles = fs.readdirSync(servicesPath).filter(f => f.endsWith('.ts'));
  
  for (const file of serviceFiles) {
    const filePath = path.join(servicesPath, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Получить все импорты
    const imports = content.match(/from\s+['"]\.\/([^'"]+)['"]/g) || [];
    
    for (const imp of imports) {
      const match = imp.match(/from\s+['"]\.\/([^'"]+)['"]/);
      if (match) {
        const importedFile = match[1];
        const importedPath = path.join(servicesPath, importedFile + '.ts');
        
        if (fs.existsSync(importedPath)) {
          const importedContent = fs.readFileSync(importedPath, 'utf-8');
          if (importedContent.includes(`from './${file.replace('.ts', '')}'`)) {
            return true;
          }
        }
      }
    }
  }
  
  return false;
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
