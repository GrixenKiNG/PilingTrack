/**
 * Agent 20 — Cybersecurity Specialist
 * Agent 21 — SaaS Security Architect
 * Agent 22 — Authentication Specialist
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentReport, TestResult } from '../qa-director';

// ============================================================================
// Agent 20 — Cybersecurity Specialist
// ============================================================================

export async function cybersecuritySpecialist(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const srcPath = path.join(projectRoot, 'src');

  console.log('    🔍 Анализ безопасности...');

  checkSQLInjection(srcPath, findings);
  checkXSS(srcPath, findings);
  checkCSRF(srcPath, findings);

  return createReport('cybersecurity-specialist', 'security', findings, startTime);
}

function checkSQLInjection(srcPath: string, findings: TestResult[]): void {
  // Проверка raw SQL
  const hasRawSQL = searchInDir(srcPath, /\$queryRaw|\$executeRaw|\$queryRawUnsafe/i);
  
  if (hasRawSQL) {
    findings.push({
      agent: 'cybersecurity-specialist',
      category: 'security',
      severity: 'critical',
      title: 'Используются raw SQL запросы',
      description: 'Raw SQL могут быть уязвимы для SQL injection если параметры не валидируются.',
      recommendation: 'Использовать параметризованные запросы или Prisma ORM методы'
    });
  }

  // Проверка динамических запросов
  const hasDynamicQuery = searchInDir(srcPath, /`.*\$\{.*\}.*`.*prisma|\beval\b|\bFunction\b/i);
  if (hasDynamicQuery) {
    findings.push({
      agent: 'cybersecurity-specialist',
      category: 'security',
      severity: 'critical',
      title: 'Динамические запросы с interpolation',
      description: 'Template literals с user input в SQL запросах = SQL injection risk.',
      recommendation: 'Никогда не использовать user input в SQL без параметризации'
    });
  }
}

function checkXSS(srcPath: string, findings: TestResult[]): void {
  // Проверка dangerouslySetInnerHTML
  const hasDangerousHTML = searchInDir(srcPath, /dangerouslySetInnerHTML/i);
  
  if (hasDangerousHTML) {
    findings.push({
      agent: 'cybersecurity-specialist',
      category: 'security',
      severity: 'high',
      title: 'Используется dangerouslySetInnerHTML',
      description: 'Это позволяет выполнять произвольный JavaScript = XSS атака.',
      recommendation: 'Использовать DOMPurify для санитизации HTML'
    });
  }

  // Проверка react-markdown без sanitize
  const hasMarkdown = searchInDir(srcPath, /react-markdown/i);
  const hasSanitize = searchInDir(srcPath, /rehype-sanitize|sanitize/i);
  
  if (hasMarkdown && !hasSanitize) {
    findings.push({
      agent: 'cybersecurity-specialist',
      category: 'security',
      severity: 'medium',
      title: 'Markdown без санитизации',
      description: 'react-markdown может рендерить вредоносный HTML/JS из markdown.',
      recommendation: 'Добавить rehype-sanitize к react-markdown'
    });
  }

  // Проверка innerHTML
  const hasInnerHTML = searchInDir(srcPath, /\.innerHTML\s*=/i);
  if (hasInnerHTML) {
    findings.push({
      agent: 'cybersecurity-specialist',
      category: 'security',
      severity: 'high',
      title: 'Используется innerHTML',
      description: 'innerHTML может выполнить вредоносный скрипт.',
      recommendation: 'Использовать textContent или санитизировать HTML'
    });
  }
}

function checkCSRF(srcPath: string, findings: TestResult[]): void {
  // Проверка CSRF защиты
  const hasCSRFProtection = searchInDir(srcPath, /csrf|xsrf|anti.?forgery/i);
  
  if (!hasCSRFProtection) {
    findings.push({
      agent: 'cybersecurity-specialist',
      category: 'security',
      severity: 'high',
      title: 'Отсутствует CSRF защита',
      description: 'POST/PUT/DELETE endpoints уязвимы для CSRF атак.',
      recommendation: 'Внедрить CSRF tokens или использовать SameSite cookie атрибут'
    });
  }

  // Проверка SameSite cookie
  const hasSameSite = searchInDir(srcPath, /sameSite.*strict|sameSite.*lax/i);
  if (!hasSameSite) {
    findings.push({
      agent: 'cybersecurity-specialist',
      category: 'security',
      severity: 'medium',
      title: 'Cookies без SameSite атрибута',
      description: 'Без SameSite cookies уязвимы для CSRF.',
      recommendation: 'Установить SameSite=Lax или Strict для session cookies'
    });
  }
}

// ============================================================================
// Agent 21 — SaaS Security Architect
// ============================================================================

export async function saasSecurityArchitect(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const srcPath = path.join(projectRoot, 'src');

  console.log('    🔍 Анализ SaaS безопасности...');

  checkMultiTenantSecurity(srcPath, findings);
  checkDataIsolation(srcPath, findings);

  return createReport('saas-security-architect', 'security', findings, startTime);
}

function checkMultiTenantSecurity(srcPath: string, findings: TestResult[]): void {
  // Проверка tenant изоляции
  const hasTenant = searchInDir(srcPath, /tenant_id|organization_id|company_id/i);
  
  if (!hasTenant) {
    findings.push({
      agent: 'saas-security-architect',
      category: 'security',
      severity: 'critical',
      title: 'Отсутствует tenant изоляция',
      description: 'Multi-tenant SaaS без tenant_id. Клиенты могут видеть данные друг друга!',
      recommendation: 'Добавить tenant_id ко всем моделям и запросам'
    });
    return;
  }

  // Проверка tenant middleware
  const hasTenantMiddleware = searchInDir(srcPath, /tenant.*middleware|filter.*tenant/i);
  if (!hasTenantMiddleware) {
    findings.push({
      agent: 'saas-security-architect',
      category: 'security',
      severity: 'critical',
      title: 'Нет tenant middleware',
      description: 'Без автоматической фильтрации по tenant возможен доступ к чужим данным.',
      recommendation: 'Создать Prisma middleware для автоматического добавления tenant фильтра'
    });
  }
}

function checkDataIsolation(srcPath: string, findings: TestResult[]): void {
  // Проверка доступа к данным
  const hasAccessControl = searchInDir(srcPath, /can\(|authorize|checkPermission/i);
  
  if (!hasAccessControl) {
    findings.push({
      agent: 'saas-security-architect',
      category: 'security',
      severity: 'high',
      title: 'Отсутствует контроль доступа к данным',
      description: 'Любой авторизованный пользователь может читать/писать любые данные.',
      recommendation: 'Реализовать RBAC или ABAC для контроля доступа'
    });
  }

  // Проверка data leakage
  const hasDataLeakage = searchInDir(srcPath, /select:\s*\{.*password|include:.*password/i);
  if (hasDataLeakage) {
    findings.push({
      agent: 'saas-security-architect',
      category: 'security',
      severity: 'critical',
      title: 'Возможна утечка sensitive данных',
      description: 'Password или sensitive поля могут возвращаться в API ответах.',
      recommendation: 'Исключить password, hash из API ответов'
    });
  }
}

// ============================================================================
// Agent 22 — Authentication Specialist
// ============================================================================

export async function authenticationSpecialist(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const srcPath = path.join(projectRoot, 'src');

  console.log('    🔍 Анализ аутентификации...');

  checkJWT(srcPath, findings);
  checkOAuth(srcPath, findings);
  checkRBAC(srcPath, findings);

  return createReport('authentication-specialist', 'security', findings, startTime);
}

function checkJWT(srcPath: string, findings: TestResult[]): void {
  // Проверка JWT реализации
  const hasJWT = searchInDir(srcPath, /jwt|jsonwebtoken|sign|verify/i);
  
  if (hasJWT) {
    // Проверка секретного ключа
    const envPath = path.join(projectRoot, '.env');
    if (fs.existsSync(envPath)) {
      const env = fs.readFileSync(envPath, 'utf-8');
      const secretMatch = env.match(/JWT_SECRET\s*=\s*(.+)/);
      
      if (secretMatch && secretMatch[1].length < 32) {
        findings.push({
          agent: 'authentication-specialist',
          category: 'security',
          severity: 'critical',
          title: 'Слабый JWT secret ключ',
          description: 'JWT secret слишком короткий. Это позволяет подделывать токены.',
          file: '.env',
          recommendation: 'Использовать cryptographically secure secret > 32 символов'
        });
      }
    }

    // Проверка expiration
    const hasExpiration = searchInDir(srcPath, /expiresIn|exp.*:.*\d+/i);
    if (!hasExpiration) {
      findings.push({
        agent: 'authentication-specialist',
        category: 'security',
        severity: 'high',
        title: 'JWT без expiration',
        description: 'Токены без срока действия будут действительны вечно.',
        recommendation: 'Установить expiresIn: 12h для access token'
      });
    }

    // Проверка refresh token
    const hasRefreshToken = searchInDir(srcPath, /refresh.*token/i);
    if (!hasRefreshToken) {
      findings.push({
        agent: 'authentication-specialist',
        category: 'security',
        severity: 'medium',
        title: 'Отсутствует refresh token',
        description: 'Без refresh tokens пользователям нужно часто логиниться.',
        recommendation: 'Реализовать refresh token flow'
      });
    }
  }
}

function checkOAuth(srcPath: string, findings: TestResult[]): void {
  // Проверка OAuth
  const hasOAuth = searchInDir(srcPath, /oauth|google.*login|github.*login/i);
  
  if (!hasOAuth) {
    findings.push({
      agent: 'authentication-specialist',
      category: 'security',
      severity: 'low',
      title: 'Отсутствует OAuth',
      description: 'Пользователи могут предпочесть login через Google, GitHub.',
      recommendation: 'Рассмотреть NextAuth.js для OAuth провайдеров'
    });
  }
}

function checkRBAC(srcPath: string, findings: TestResult[]): void {
  // Проверка RBAC
  const hasRBAC = searchInDir(srcPath, /role.*based|can\(|authorize|permission/i);
  
  if (!hasRBAC) {
    findings.push({
      agent: 'authentication-specialist',
      category: 'security',
      severity: 'high',
      title: 'Отсутствует RBAC',
      description: 'Все пользователи имеют одинаковые права. Нужна ролевая модель.',
      recommendation: 'Реализовать RBAC: ADMIN, DISPATCHER, OPERATOR, ASSISTANT'
    });
    return;
  }

  // Проверка enforcement
  const hasEnforcement = searchInDir(srcPath, /assertCan|requireRole|guard/i);
  if (!hasEnforcement) {
    findings.push({
      agent: 'authentication-specialist',
      category: 'security',
      severity: 'medium',
      title: 'RBAC не enforced',
      description: 'Роли есть, но не проверяются в API endpoints.',
      recommendation: 'Проверять роли в middleware и API handlers'
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
