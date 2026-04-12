/**
 * Agent 1 — QA Director Orchestrator
 * 
 * Главный агент, который управляет всей системой тестирования PilingTrack.
 * Оркестрирует работу 24 специализированных агентов и формирует финальный отчёт.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface TestResult {
  agent: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  file?: string;
  line?: number;
  recommendation?: string;
}

export interface AgentReport {
  agentName: string;
  category: string;
  status: 'passed' | 'warning' | 'failed' | 'skipped';
  findings: TestResult[];
  summary: string;
  executedAt: string;
  duration: number;
}

export interface FinalReport {
  timestamp: string;
  projectName: string;
  version: string;
  totalAgents: number;
  agentsExecuted: number;
  agentsPassed: number;
  agentsFailed: number;
  agentsWarning: number;
  agentsSkipped: number;
  findings: {
    critical: TestResult[];
    high: TestResult[];
    medium: TestResult[];
    low: TestResult[];
    info: TestResult[];
  };
  categories: {
    architecture: AgentReport[];
    backend: AgentReport[];
    frontend: AgentReport[];
    devops: AgentReport[];
    data: AgentReport[];
    security: AgentReport[];
    industrial: AgentReport[];
  };
  executiveSummary: string;
  recommendations: string[];
}

class QADirector {
  private reports: AgentReport[] = [];
  private projectRoot: string;
  private outputDir: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.outputDir = path.join(projectRoot, 'agents', 'reports');
    
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Запуск всех агентов тестирования по категориям
   */
  async runAllAgents(): Promise<FinalReport> {
    console.log('🎯 QA Director: Запуск полной системы тестирования PilingTrack');
    console.log('=' .repeat(80));

    const startTime = Date.now();

    // Уровень 1: Architecture Agents
    console.log('\n📐 ARCHITECTURE AUDIT');
    await this.runCategory('architecture', [
      'software-architect',
      'distributed-systems-architect',
      'database-architect'
    ]);

    // Уровень 2: Backend Engineering Agents
    console.log('\n⚙️ BACKEND TESTING');
    await this.runCategory('backend', [
      'backend-lead-engineer',
      'api-testing-engineer',
      'concurrency-engineer',
      'performance-engineer'
    ]);

    // Уровень 3: Frontend Agents
    console.log('\n🖥️ FRONTEND TESTING');
    await this.runCategory('frontend', [
      'mobile-web-engineer',
      'browser-compatibility-engineer',
      'offline-mode-specialist',
      'frontend-performance-engineer'
    ]);

    // Уровень 4: DevOps Agents
    console.log('\n🚀 DEVOPS TESTING');
    await this.runCategory('devops', [
      'devops-architect',
      'cloud-infrastructure-engineer',
      'monitoring-engineer',
      'disaster-recovery-engineer'
    ]);

    // Уровень 5: Data Engineering Agents
    console.log('\n📊 DATA VALIDATION');
    await this.runCategory('data', [
      'data-engineer',
      'data-quality-engineer',
      'analytics-engineer'
    ]);

    // Уровень 6: Security Agents
    console.log('\n🔒 SECURITY AUDIT');
    await this.runCategory('security', [
      'cybersecurity-specialist',
      'saas-security-architect',
      'authentication-specialist'
    ]);

    // Уровень 7: Industrial Automation Agents
    console.log('\n🏗️ INDUSTRIAL PROCESS VALIDATION');
    await this.runCategory('industrial', [
      'industry-4-engineer',
      'construction-process-engineer',
      'ux-specialist-industrial'
    ]);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n' + '=' .repeat(80));
    console.log(`✅ Все агенты завершили работу за ${duration}с`);

    // Генерация финального отчёта
    return this.generateFinalReport();
  }

  /**
   * Запуск категории агентов
   */
  private async runCategory(category: string, agents: string[]): Promise<void> {
    for (const agent of agents) {
      console.log(`  ▶️ Запуск ${agent}...`);
      try {
        const report = await this.runAgent(category, agent);
        this.reports.push(report);
        console.log(`  ✅ ${agent}: ${report.status} (${report.findings.length} находок)`);
      } catch (error) {
        console.error(`  ❌ ${agent} упал:`, error);
        this.reports.push({
          agentName: agent,
          category,
          status: 'failed',
          findings: [{
            agent: agent,
            category,
            severity: 'critical',
            title: `Агент ${agent} не смог完成 работу`,
            description: `Ошибка выполнения: ${error instanceof Error ? error.message : String(error)}`,
            recommendation: 'Проверить агент и запустить повторно'
          }],
          summary: 'Агент завершился с ошибкой',
          executedAt: new Date().toISOString(),
          duration: 0
        });
      }
    }
  }

  /**
   * Запуск конкретного агента
   */
  private async runAgent(category: string, agent: string): Promise<AgentReport> {
    const agentPath = path.join(this.projectRoot, 'agents', category, `${agent}.ts`);
    
    // Если файл агента существует, запускаем его
    if (fs.existsSync(agentPath)) {
      const agentModule = await import(agentPath);
      if (agentModule.default && typeof agentModule.default === 'function') {
        return await agentModule.default(this.projectRoot);
      }
    }

    // Если агента нет, выполняем статический анализ
    return await this.runStaticAnalysis(category, agent);
  }

  /**
   * Статический анализ кодовой базы для агента
   */
  private async runStaticAnalysis(category: string, agent: string): Promise<AgentReport> {
    const findings: TestResult[] = [];
    const startTime = Date.now();

    // Базовые проверки для каждой категории
    switch (category) {
      case 'architecture':
        findings.push(...this.checkArchitecture(agent));
        break;
      case 'backend':
        findings.push(...this.checkBackend(agent));
        break;
      case 'frontend':
        findings.push(...this.checkFrontend(agent));
        break;
      case 'devops':
        findings.push(...this.checkDevOps(agent));
        break;
      case 'data':
        findings.push(...this.checkData(agent));
        break;
      case 'security':
        findings.push(...this.checkSecurity(agent));
        break;
      case 'industrial':
        findings.push(...this.checkIndustrial(agent));
        break;
    }

    const duration = Date.now() - startTime;
    const status = findings.some(f => f.severity === 'critical' || f.severity === 'high') 
      ? 'failed' 
      : findings.some(f => f.severity === 'medium') 
        ? 'warning' 
        : 'passed';

    return {
      agentName: agent,
      category,
      status,
      findings,
      summary: `Найдено ${findings.length} замечаний`,
      executedAt: new Date().toISOString(),
      duration
    };
  }

  // === Методы проверки архитектуры ===
  private checkArchitecture(agent: string): TestResult[] {
    const findings: TestResult[] = [];
    const srcPath = path.join(this.projectRoot, 'src');

    // Проверка на монолитную структуру
    const apiRoutes = this.findFiles(srcPath, /api[/\\].*route\.ts$/);
    if (apiRoutes.length > 20) {
      findings.push({
        agent,
        category: 'architecture',
        severity: 'medium',
        title: 'Монолитная структура API routes',
        description: `Все API routes находятся в одном Next.js приложении (${apiRoutes.length} endpoints). Для industrial SaaS рекомендуется микросервисная архитектура.`,
        recommendation: 'Рассмотреть выделение критичных доменов (reports, auth, analytics) в отдельные микросервисы'
      });
    }

    // Проверка event-driven архитектуры
    const hasEventBus = this.searchCode(srcPath, /EventEmitter|EventBus|pub.?sub|event.*bus/i);
    if (!hasEventBus) {
      findings.push({
        agent,
        category: 'architecture',
        severity: 'high',
        title: 'Отсутствует event-driven архитектура',
        description: 'В системе не обнаруена шина событий или паттерн pub/sub. Для industrial IoT платформы это критично для обработки данных с датчиков в реальном времени.',
        recommendation: 'Внедрить Redis Pub/Sub, Apache Kafka или NATS для обработки событий от техники'
      });
    }

    // Проверка multi-tenant
    const hasTenantIsolation = this.searchCode(srcPath, /tenant|multi.?tenant|organization_id/i);
    if (!hasTenantIsolation) {
      findings.push({
        agent,
        category: 'architecture',
        severity: 'critical',
        title: 'Отсутствует multi-tenant изоляция',
        description: 'SaaS платформа заявлена как multi-tenant, но в коде не найдено механизмов разделения данных между арендаторами.',
        recommendation: 'Добавить tenant_id во все модели и реализовать middleware для автоматической фильтрации по tenant'
      });
    }

    // Проверка API Gateway
    const hasAPIGateway = fs.existsSync(path.join(this.projectRoot, 'Caddyfile'));
    if (hasAPIgateway) {
      findings.push({
        agent,
        category: 'architecture',
        severity: 'info',
        title: 'Используется Caddy как reverse proxy',
        description: 'Caddyfile обнаружен. Для production SaaS рекомендуется рассмотреть Kong, Traefik или AWS API Gateway.',
        recommendation: 'Оценить необходимость API Gateway с rate limiting, authentication и routing'
      });
    }

    // Проверка масштабируемости
    const hasQueue = this.searchCode(srcPath, /bull|bee|queue|worker/i);
    if (!hasQueue) {
      findings.push({
        agent,
        category: 'architecture',
        severity: 'high',
        title: 'Отсутствует очередь задач',
        description: 'Не обнаружено системы очередей для фоновых задач (генерация PDF, отправка Telegram, AI распознавание).',
        recommendation: 'Внедрить Bull (Redis) или RabbitMQ для асинхронной обработки'
      });
    }

    return findings;
  }

  // === Методы проверки backend ===
  private checkBackend(agent: string): TestResult[] {
    const findings: TestResult[] = [];
    const servicesPath = path.join(this.projectRoot, 'src', 'services');
    const apiPath = path.join(this.projectRoot, 'src', 'app', 'api');

    // Проверка обработки ошибок
    const hasTryCatch = this.searchCodeInDir(apiPath, /try\s*\{[\s\S]*?\}\s*catch/i);
    if (!hasTryCatch) {
      findings.push({
        agent,
        category: 'backend',
        severity: 'critical',
        title: 'Отсутствует обработка ошибок в API',
        description: 'API routes не используют try-catch блоки. Необработанные ошибки приведут к 500 ошибкам без информативного сообщения.',
        recommendation: 'Обернуть все API handlers в try-catch с возвратом корректных HTTP статусов'
      });
    }

    // Проверка валидации входных данных
    const hasValidation = this.searchCodeInDir(apiPath, /zod|\.parse\(|\.safeParse\(|validate/i);
    if (!hasValidation) {
      findings.push({
        agent,
        category: 'backend',
        severity: 'high',
        title: 'Отсутствует валидация входных данных',
        description: 'API endpoints не валидируют входные данные. Это риск безопасности и целостности данных.',
        recommendation: 'Использовать Zod для валидации всех request body и query parameters'
      });
    }

    // Проверка SHA-256 для паролей
    const usesSHA256 = this.searchCodeInDir(servicesPath, /sha.?256/i);
    if (usesSHA256) {
      findings.push({
        agent,
        category: 'backend',
        severity: 'critical',
        title: 'Используется SHA-256 для хеширования паролей',
        description: 'SHA-256 не предназначен для хеширования паролей. Он быстрый и уязвим для brute-force атак.',
        recommendation: 'Перейти на bcrypt, argon2 или scrypt с appropriate work factor',
        file: 'src/services/auth/auth-service.ts'
      });
    }

    // Проверка rate limiting
    const hasRateLimiting = this.searchCodeInDir(apiPath, /rate.?limit|throttle/i);
    if (!hasRateLimiting) {
      findings.push({
        agent,
        category: 'backend',
        severity: 'high',
        title: 'Отсутствует rate limiting',
        description: 'API endpoints не защищены rate limiting. Это позволяет brute-force атаки и DoS.',
        recommendation: 'Внедрить rate limiting на login, API endpoints'
      });
    }

    // Проверка pagination
    const hasPagination = this.searchCodeInDir(apiPath, /page|limit|offset|cursor|paginate/i);
    if (!hasPagination) {
      findings.push({
        agent,
        category: 'backend',
        severity: 'medium',
        title: 'Отсутствует пагинация в API',
        description: 'API endpoints возвращают все записи без пагинации. При росте данных это приведёт к проблемам производительности.',
        recommendation: 'Реализовать cursor-based или offset пагинацию для всех list endpoints'
      });
    }

    return findings;
  }

  // === Методы проверки frontend ===
  private checkFrontend(agent: string): TestResult[] {
    const findings: TestResult[] = [];
    const componentsPath = path.join(this.projectRoot, 'src', 'components');
    const appPath = path.join(this.projectRoot, 'src', 'app');

    // Проверка mobile responsiveness
    const hasResponsive = this.searchCodeInDir(componentsPath, /sm:|md:|lg:|xl:|useMobile/i);
    if (!hasResponsive) {
      findings.push({
        agent,
        category: 'frontend',
        severity: 'high',
        title: 'Проблемы с responsive дизайном',
        description: 'Компоненты могут не иметь адаптивности для мобильных устройств операторов техники.',
        recommendation: 'Проверить все компоненты на мобильных viewports (320px, 375px, 414px)'
      });
    }

    // Проверка offline mode
    const hasServiceWorker = this.searchCodeInDir(appPath, /service.?worker|workbox|offline|navigator\.onLine/i);
    if (!hasServiceWorker) {
      findings.push({
        agent,
        category: 'frontend',
        severity: 'high',
        title: 'Отсутствует offline режим',
        description: 'Для операторов на стройплощадке с плохим интернетом offline режим критичен.',
        recommendation: 'Реализовать Service Worker с кэшированием и IndexedDB для offline отчётов'
      });
    }

    // Проверка bundle size
    const packageJsonPath = path.join(this.projectRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const depCount = Object.keys(packageJson.dependencies || {}).length;
      if (depCount > 50) {
        findings.push({
          agent,
          category: 'frontend',
          severity: 'medium',
          title: 'Большое количество зависимостей',
          description: `В проекте ${depCount} зависимостей. Это может привести к большому bundle size и медленной загрузке на мобильных.`,
          recommendation: 'Провести анализ bundle с webpack-bundle-analyzer и удалить неиспользуемые зависимости'
        });
      }
    }

    // Проверка accessibility
    const hasAria = this.searchCodeInDir(componentsPath, /aria-|role=|tabindex/i);
    if (!hasAria) {
      findings.push({
        agent,
        category: 'frontend',
        severity: 'medium',
        title: 'Проблемы доступности (a11y)',
        description: 'Компоненты могут не иметь ARIA атрибутов, что критично для industrial приложений.',
        recommendation: 'Добавить ARIA labels, role атрибуты и keyboard navigation'
      });
    }

    return findings;
  }

  // === Методы проверки DevOps ===
  private checkDevOps(agent: string): TestResult[] {
    const findings: TestResult[] = [];
    const dockerfilePath = path.join(this.projectRoot, 'Dockerfile');
    const composePath = path.join(this.projectRoot, 'docker-compose.production.yml');

    // Проверка Dockerfile
    if (fs.existsSync(dockerfilePath)) {
      const dockerfile = fs.readFileSync(dockerfilePath, 'utf-8');
      
      // Multi-stage build
      if (!dockerfile.includes('FROM') || (dockerfile.match(/FROM/g) || []).length < 2) {
        findings.push({
          agent,
          category: 'devops',
          severity: 'medium',
          title: 'Dockerfile не использует multi-stage build',
          description: 'Multi-stage build уменьшает размер финального image.',
          file: 'Dockerfile',
          recommendation: 'Использовать multi-stage build для минимизации image size'
        });
      }

      // Root user
      if (!dockerfile.includes('USER') || dockerfile.includes('USER root')) {
        findings.push({
          agent,
          category: 'devops',
          severity: 'high',
          title: 'Контейнер запускается от root',
          description: 'Запуск от root пользователя — риск безопасности.',
          file: 'Dockerfile',
          recommendation: 'Добавить USER node или другого non-root пользователя'
        });
      }
    }

    // Проверка docker-compose
    if (fs.existsSync(composePath)) {
      const compose = fs.readFileSync(composePath, 'utf-8');
      
      // Health checks
      if (!compose.includes('healthcheck')) {
        findings.push({
          agent,
          category: 'devops',
          severity: 'medium',
          title: 'Отсутствуют health checks в docker-compose',
          description: 'Health checks важны для production reliability.',
          file: 'docker-compose.production.yml',
          recommendation: 'Добавить healthcheck для всех сервисов'
        });
      }

      // Resource limits
      if (!compose.includes('deploy:') || !compose.includes('resources:')) {
        findings.push({
          agent,
          category: 'devops',
          severity: 'medium',
          title: 'Отсутствуют лимиты ресурсов',
          description: 'Без лимитов контейнеры могут потреблять все ресурсы хоста.',
          file: 'docker-compose.production.yml',
          recommendation: 'Установить memory и CPU limits для контейнеров'
        });
      }
    }

    // Проверка CI/CD
    const hasGitHubActions = fs.existsSync(path.join(this.projectRoot, '.github', 'workflows'));
    const hasGitLabCI = fs.existsSync(path.join(this.projectRoot, '.gitlab-ci.yml'));
    if (!hasGitHubActions && !hasGitLabCI) {
      findings.push({
        agent,
        category: 'devops',
        severity: 'high',
        title: 'Отсутствует CI/CD pipeline',
        description: 'Нет автоматизации тестирования и деплоя. Ручной деплой ведёт к human error.',
        recommendation: 'Настроить GitHub Actions с lint, test, build, deploy stages'
      });
    }

    // Проверка backup
    const hasBackup = this.searchCodeInDir(this.projectRoot, /backup|pg_dump|mysqldump/i);
    if (!hasBackup) {
      findings.push({
        agent,
        category: 'devops',
        severity: 'high',
        title: 'Отсутствует стратегия backup',
        description: 'Для production SaaS backup критичен для disaster recovery.',
        recommendation: 'Реализовать автоматические backup базы данных с cron jobs'
      });
    }

    return findings;
  }

  // === Методы проверки данных ===
  private checkData(agent: string): TestResult[] {
    const findings: TestResult[] = [];
    const prismaPath = path.join(this.projectRoot, 'prisma');

    // Проверка индексов
    const schemaPath = path.join(prismaPath, 'schema.prisma');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      const hasIndexes = schema.includes('@@index');
      if (!hasIndexes) {
        findings.push({
          agent,
          category: 'data',
          severity: 'high',
          title: 'Отсутствуют индексы в базе данных',
          description: 'Без индексов запросы будут full table scan, что медленно при больших объёмах.',
          file: 'prisma/schema.prisma',
          recommendation: 'Добавить @@index на часто используемые поля (email, site_id, crew_id, date)'
        });
      }

      // Проверка нормализации
      const hasJson = schema.includes('Json');
      if (hasJson) {
        findings.push({
          agent,
          category: 'data',
          severity: 'medium',
          title: 'Используются JSON поля в БД',
          description: 'JSON поля не нормализованы и могут привести к проблемам с производительностью и консистентностью.',
          file: 'prisma/schema.prisma',
          recommendation: 'Рассмотреть нормализацию JSON полей в отдельные таблицы'
        });
      }

      // Проверка каскадных удалений
      const hasCascade = schema.includes('onDelete: Cascade');
      if (!hasCascade) {
        findings.push({
          agent,
          category: 'data',
          severity: 'medium',
          title: 'Не настроены каскадные удаления',
          description: 'При удалении родительских записей могут остаться orphan записи.',
          file: 'prisma/schema.prisma',
          recommendation: 'Настроить onDelete: Cascade или Set Null для внешних ключей'
        });
      }
    }

    // Проверка ETL процессов
    const hasETL = this.searchCodeInDir(this.projectRoot, /etl|data.*pipeline|transform/i);
    if (!hasETL) {
      findings.push({
        agent,
        category: 'data',
        severity: 'low',
        title: 'Отсутствуют ETL процессы',
        description: 'Для аналитики и BI могут потребоваться ETL процессы для агрегации данных.',
        recommendation: 'Рассмотреть ETL для nightly aggregations и data warehouse'
      });
    }

    return findings;
  }

  // === Методы проверки безопасности ===
  private checkSecurity(agent: string): TestResult[] {
    const findings: TestResult[] = [];
    const srcPath = path.join(this.projectRoot, 'src');

    // Проверка SQL injection
    const hasRawSQL = this.searchCodeInDir(srcPath, /\$queryRaw|executeRaw|\$queryRawUnsafe/i);
    if (hasRawSQL) {
      findings.push({
        agent,
        category: 'security',
        severity: 'critical',
        title: 'Возможны SQL injection',
        description: 'Используются raw SQL запросы. Если параметры не валидируются, это SQL injection risk.',
        recommendation: 'Использовать параметризованные запросы и валидацию входных данных'
      });
    }

    // Проверка XSS
    const hasDangerousHTML = this.searchCodeInDir(srcPath, /dangerouslySetInnerHTML|innerHTML/i);
    if (hasDangerousHTML) {
      findings.push({
        agent,
        category: 'security',
        severity: 'high',
        title: 'Возможны XSS атаки',
        description: 'Используется dangerouslySetInnerHTML или innerHTML с потенциально user-generated контентом.',
        recommendation: 'Санитизировать HTML с DOMPurify или использовать React Markdown'
      });
    }

    // Проверка CSRF
    const hasCSRFProtection = this.searchCodeInDir(srcPath, /csrf|xsrf|anti.?forgery/i);
    if (!hasCSRFProtection) {
      findings.push({
        agent,
        category: 'security',
        severity: 'high',
        title: 'Отсутствует CSRF защита',
        description: 'POST/PUT/DELETE endpoints не защищены от CSRF атак.',
        recommendation: 'Внедрить CSRF tokens для state-changing операций'
      });
    }

    // Проверка security headers
    const hasSecurityHeaders = this.searchCodeInDir(srcPath, /x.?frame.?options|content.?security.?policy|x.?xss.?protection/i);
    if (!hasSecurityHeaders) {
      findings.push({
        agent,
        category: 'security',
        severity: 'medium',
        title: 'Отсутствуют security headers',
        description: 'Не установлены HTTP security headers (CSP, X-Frame-Options, etc).',
        recommendation: 'Добавить middleware с security headers'
      });
    }

    // Проверка JWT секрет
    const envPath = path.join(this.projectRoot, '.env');
    if (fs.existsSync(envPath)) {
      const env = fs.readFileSync(envPath, 'utf-8');
      if (env.includes('SECRET=') || env.includes('JWT_SECRET=')) {
        const secretMatch = env.match(/(?:JWT_)?SECRET\s*=\s*(.+)/);
        if (secretMatch && secretMatch[1].length < 32) {
          findings.push({
            agent,
            category: 'security',
            severity: 'critical',
            title: 'Слабый SECRET ключ',
            description: 'Секретный ключ слишком короткий. Это позволяет brute-force атаки.',
            file: '.env',
            recommendation: 'Использовать cryptographically secure secret минимум 32 символа'
          });
        }
      }
    }

    return findings;
  }

  // === Методы проверки industrial логики ===
  private checkIndustrial(agent: string): TestResult[] {
    const findings: TestResult[] = [];
    const srcPath = path.join(this.projectRoot, 'src');

    // Проверка IoT интеграции
    const hasIoT = this.searchCodeInDir(srcPath, /mqtt|coap|iot|sensor|gps|modbus/i);
    if (!hasIoT) {
      findings.push({
        agent,
        category: 'industrial',
        severity: 'high',
        title: 'Отсутствует IoT интеграция',
        description: 'Для Industry 4.0 платформы нет интеграции с датчиками техники (GPS, нагрузка, время работы).',
        recommendation: 'Реализовать MQTT/CoAP для получения данных с датчиков буровых установок'
      });
    }

    // Проверка валидации строительных процессов
    const hasPileValidation = this.searchCodeInDir(srcPath, /pile.*count|planned.*actual|проверка.*свая/i);
    if (!hasPileValidation) {
      findings.push({
        agent,
        category: 'industrial',
        severity: 'medium',
        title: 'Нет валидации строительных процессов',
        description: 'Отчёты не проверяют логику (количество свай <= плана, бурение соответствует проекту).',
        recommendation: 'Добавить валидацию: отчёт не может превышать план, проверка последовательности операций'
      });
    }

    // Проверка UX для операторов
    const hasLargeUI = this.searchCodeInDir(srcPath, /large.*button|big.*touch|operator.*friendly/i);
    if (!hasLargeUI) {
      findings.push({
        agent,
        category: 'industrial',
        severity: 'medium',
        title: 'UI не адаптирован для операторов техники',
        description: 'Операторы работают в перчатках, на ярком солнце, в пыли. UI должен учитывать это.',
        recommendation: 'Увеличить touch targets (мин 48x48px), высокий контраст, режим работы в перчатках'
      });
    }

    // Проверка сменных отчётов
    const hasShiftLogic = this.searchCodeInDir(srcPath, /shift|смена|день.*ночь/i);
    if (!hasShiftLogic) {
      findings.push({
        agent,
        category: 'industrial',
        severity: 'low',
        title: 'Отсутствует логика смен',
        description: 'В строительстве используются смены (день/ночь). Логика может быть неполной.',
        recommendation: 'Реализовать корректную обработку смен и учёт работы across midnight'
      });
    }

    return findings;
  }

  // === Утилиты ===
  private findFiles(dir: string, pattern: RegExp): string[] {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        if (item !== 'node_modules' && item !== '.next' && item !== '.git') {
          results = results.concat(this.findFiles(fullPath, pattern));
        }
      } else if (pattern.test(fullPath)) {
        results.push(fullPath);
      }
    }
    return results;
  }

  private searchCode(dir: string, pattern: RegExp): boolean {
    try {
      const { execSync } = require('child_process');
      const result = execSync(`findstr /S /R /C:"${pattern.source}" "${dir}\\*.ts" "${dir}\\*.tsx" 2>nul || true`, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024
      });
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }

  private searchCodeInDir(dir: string, pattern: RegExp): boolean {
    return this.searchCode(dir, pattern);
  }

  // === Генерация финального отчёта ===
  private generateFinalReport(): FinalReport {
    const findings: FinalReport['findings'] = {
      critical: [],
      high: [],
      medium: [],
      low: [],
      info: []
    };

    for (const report of this.reports) {
      for (const finding of report.findings) {
        findings[finding.severity].push(finding);
      }
    }

    const categories: FinalReport['categories'] = {
      architecture: this.reports.filter(r => r.category === 'architecture'),
      backend: this.reports.filter(r => r.category === 'backend'),
      frontend: this.reports.filter(r => r.category === 'frontend'),
      devops: this.reports.filter(r => r.category === 'devops'),
      data: this.reports.filter(r => r.category === 'data'),
      security: this.reports.filter(r => r.category === 'security'),
      industrial: this.reports.filter(r => r.category === 'industrial')
    };

    const totalFindings = Object.values(findings).reduce((sum, arr) => sum + arr.length, 0);
    const criticalCount = findings.critical.length;
    const highCount = findings.high.length;

    const executiveSummary = `
Проведено тестирование PilingTrack SaaS платформы.
Всего агентов: 24
Найдено проблем: ${totalFindings}
  🔴 Критических: ${criticalCount}
  🟠 Высоких: ${highCount}
  🟡 Средних: ${findings.medium.length}
  🟢 Низких: ${findings.low.length}
  ℹ️ Информационных: ${findings.info.length}

Рекомендуется приоритетное исправление критических проблем.
`.trim();

    const recommendations = [
      ...findings.critical.map(f => `🔴 КРИТИЧНО: ${f.title} — ${f.recommendation}`),
      ...findings.high.map(f => `🟠 ВАЖНО: ${f.title} — ${f.recommendation}`),
      ...findings.medium.map(f => `🟡 СРЕДНЕ: ${f.title} — ${f.recommendation}`)
    ];

    const report: FinalReport = {
      timestamp: new Date().toISOString(),
      projectName: 'PilingTrack',
      version: '1.0.0',
      totalAgents: 24,
      agentsExecuted: this.reports.length,
      agentsPassed: this.reports.filter(r => r.status === 'passed').length,
      agentsFailed: this.reports.filter(r => r.status === 'failed').length,
      agentsWarning: this.reports.filter(r => r.status === 'warning').length,
      agentsSkipped: this.reports.filter(r => r.status === 'skipped').length,
      findings,
      categories,
      executiveSummary,
      recommendations
    };

    // Сохранение отчёта
    const reportPath = path.join(this.outputDir, `qa-report-${new Date().toISOString().split('T')[0]}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\n📄 Отчёт сохранён: ${reportPath}`);

    // Вывод summary
    console.log('\n' + '=' .repeat(80));
    console.log('EXECUTIVE SUMMARY');
    console.log('=' .repeat(80));
    console.log(executiveSummary);

    if (recommendations.length > 0) {
      console.log('\n' + '=' .repeat(80));
      console.log('TOP RECOMMENDATIONS');
      console.log('=' .repeat(80));
      recommendations.slice(0, 10).forEach((rec, i) => {
        console.log(`${i + 1}. ${rec}`);
      });
    }

    return report;
  }
}

// Export для запуска
export async function runQADirector(projectRoot: string): Promise<FinalReport> {
  const director = new QADirector(projectRoot);
  return await director.runAllAgents();
}

// Запуск из CLI
if (require.main === module) {
  const projectRoot = process.argv[2] || path.join(__dirname, '..');
  runQADirector(projectRoot)
    .then(report => {
      console.log('\n✅ QA Director завершил работу');
      process.exit(Object.values(report.findings).flat().some(f => f.severity === 'critical') ? 1 : 0);
    })
    .catch(err => {
      console.error('❌ QA Director упал:', err);
      process.exit(1);
    });
}
