/**
 * Agent 23 — Industry 4.0 Engineer
 * Agent 24 — Construction Process Engineer
 * Agent 25 — UX Specialist for Industrial Systems
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentReport, TestResult } from '../qa-director';

// ============================================================================
// Agent 23 — Industry 4.0 Engineer
// ============================================================================

export async function industry4Engineer(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const srcPath = path.join(projectRoot, 'src');

  console.log('    🔍 Анализ Industry 4.0 интеграции...');

  checkIoTIntegration(srcPath, findings);
  checkGPS(srcPath, findings);
  checkSensors(srcPath, findings);

  return createReport('industry-4-engineer', 'industrial', findings, startTime);
}

function checkIoTIntegration(srcPath: string, findings: TestResult[]): void {
  // Проверка IoT протоколов
  const hasIoT = searchInDir(srcPath, /mqtt|coap|modbus|opc.?ua|iot.*hub/i);
  
  if (!hasIoT) {
    findings.push({
      agent: 'industry-4-engineer',
      category: 'industrial',
      severity: 'high',
      title: 'Отсутствует IoT интеграция',
      description: 'Для Industry 4.0 нужна интегра с датчиками техники (нагрузка, время работы, расход топлива).',
      recommendation: 'Реализовать MQTT клиент для получения данных с датчиков буровых установок'
    });
  }

  // Проверка telemetry ingestion
  const hasTelemetry = searchInDir(srcPath, /telemetry|sensor.*data|time.*series/i);
  if (!hasTelemetry) {
    findings.push({
      agent: 'industry-4-engineer',
      category: 'industrial',
      severity: 'medium',
      title: 'Нет приёма телеметрии',
      description: 'Данные с датчиков не сохраняются для аналитики.',
      recommendation: 'Создать endpoint для telemetry data и хранение в time-series DB'
    });
  }
}

function checkGPS(srcPath: string, findings: TestResult[]): void {
  // Проверка GPS интеграции
  const hasGPS = searchInDir(srcPath, /gps|latitude|longitude|coordinates|geolocation/i);
  
  if (!hasGPS) {
    findings.push({
      agent: 'industry-4-engineer',
      category: 'industrial',
      severity: 'medium',
      title: 'Отсутствует GPS трекинг техники',
      description: 'Для контроля местоположения буровых установок нужен GPS.',
      recommendation: 'Добавить GPS координаты к отчётам и технике'
    });
  }
}

function checkSensors(srcPath: string, findings: TestResult[]): void {
  // Проверка датчиков
  const hasSensors = searchInDir(srcPath, /sensor|load.*cell|pressure|torque|rpm/i);
  
  if (!hasSensors) {
    findings.push({
      agent: 'industry-4-engineer',
      category: 'industrial',
      severity: 'medium',
      title: 'Нет интеграции с датчиками',
      description: 'Автоматический сбор данных с датчиков уменьшает ручной ввод и ошибки.',
      recommendation: 'Интегрировать с датчиками: нагрузка, давление, крутящий момент'
    });
  }
}

// ============================================================================
// Agent 24 — Construction Process Engineer
// ============================================================================

export async function constructionProcessEngineer(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const srcPath = path.join(projectRoot, 'src');
  const prismaPath = path.join(projectRoot, 'prisma');

  console.log('    🔍 Анализ строительных процессов...');

  checkPileDriving(srcPath, prismaPath, findings);
  checkDrilling(srcPath, prismaPath, findings);
  checkShiftReports(srcPath, findings);

  return createReport('construction-process-engineer', 'industrial', findings, startTime);
}

function checkPileDriving(srcPath: string, prismaPath: string, findings: TestResult[]): void {
  // Проверка моделирования забивки свай
  const hasPileModel = searchInDir(srcPath, /pile.*work|свая|забивк/i);
  
  if (!hasPileModel) {
    findings.push({
      agent: 'construction-process-engineer',
      category: 'industrial',
      severity: 'high',
      title: 'Нет моделирования забивки свай',
      description: 'Отчёты не учитывают забивку свай по маркам, кустам, пикетам.',
      recommendation: 'Реализовать учёт свай: марка, количество, позиция'
    });
  }

  // Проверка валидации плана vs факт
  const hasPlanValidation = searchInDir(srcPath, /planned.*actual|план.*факт|превышен/i);
  if (!hasPlanValidation) {
    findings.push({
      agent: 'construction-process-engineer',
      category: 'industrial',
      severity: 'medium',
      title: 'Нет валидации план vs факт',
      description: 'Отчёт может превысить план. Нужно предупреждать или блокировать.',
      recommendation: 'Добавить валидацию: факт <= план + допустимое отклонение'
    });
  }
}

function checkDrilling(srcPath: string, prismaPath: string, findings: TestResult[]): void {
  // Проверка лидерного бурения
  const hasDrillingModel = searchInDir(srcPath, /drilling|бурен|leader.*drill/i);
  
  if (!hasDrillingModel) {
    findings.push({
      agent: 'construction-process-engineer',
      category: 'industrial',
      severity: 'medium',
      title: 'Нет моделирования бурения',
      description: 'Лидерное бурение не учитывается в отчётах.',
      recommendation: 'Добавить учёт бурения: тип, метры, диаметр'
    });
  }

  // Проверка последовательности операций
  const hasSequence = searchInDir(srcPath, /sequence|order.*of.*operations|сначала.*потом/i);
  if (!hasSequence) {
    findings.push({
      agent: 'construction-process-engineer',
      category: 'industrial',
      severity: 'low',
      title: 'Нет проверки последовательности',
      description: 'Бурение должно быть перед забивкой. Нет валидации последовательности.',
      recommendation: 'Проверять что бурение выполнено перед забивкой свай'
    });
  }
}

function checkShiftReports(srcPath: string, findings: TestResult[]): void {
  // Проверка сменных отчётов
  const hasShiftLogic = searchInDir(srcPath, /shift|смена|день.*ночь|день.*смен/i);
  
  if (!hasShiftLogic) {
    findings.push({
      agent: 'construction-process-engineer',
      category: 'industrial',
      severity: 'medium',
      title: 'Нет логики смен',
      description: 'В строительстве используются смены (день/ночь). Отчёты должны учитывать.',
      recommendation: 'Добавить shift type (день/ночь) к отчётам'
    });
  }

  // Проверка downtime учёта
  const hasDowntime = searchInDir(srcPath, /downtime|простой|reason.*stop/i);
  if (!hasDowntime) {
    findings.push({
      agent: 'construction-process-engineer',
      category: 'industrial',
      severity: 'medium',
      title: 'Нет учёта простоев',
      description: 'Простои техники важны для расчёта эффективности и стоимости.',
      recommendation: 'Добавить учёт простоев с причинами: погода, поломка, ожидание'
    });
  }
}

// ============================================================================
// Agent 25 — UX Specialist for Industrial Systems
// ============================================================================

export async function uxSpecialistIndustrial(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const srcPath = path.join(projectRoot, 'src');
  const componentsPath = path.join(projectRoot, 'src', 'components');

  console.log('    🔍 Анализ UX для операторов техники...');

  checkGlovesUX(componentsPath, findings);
  checkSunlightUX(componentsPath, findings);
  checkOfflineUX(srcPath, findings);
  checkWorkflowUX(componentsPath, findings);

  return createReport('ux-specialist-industrial', 'industrial', findings, startTime);
}

function checkGlovesUX(componentsPath: string, findings: TestResult[]): void {
  // Проверка размера touch targets
  const hasLargeTargets = searchInDir(componentsPath, /min-h-\[48\]|h-12|p-4|text-lg|text-xl/i);
  
  if (!hasLargeTargets) {
    findings.push({
      agent: 'ux-specialist-industrial',
      category: 'industrial',
      severity: 'high',
      title: 'Touch targets太小 для работы в перчатках',
      description: 'Операторы работают в строительных перчатках. Кнопки должны быть >= 48px.',
      recommendation: 'Увеличить все кнопки и интерактивные элементы до 48x48px минимум'
    });
  }

  // Проверка spacing
  const hasSpacing = searchInDir(componentsPath, /gap-4|gap-6|space-y-4|p-6/i);
  if (!hasSpacing) {
    findings.push({
      agent: 'ux-specialist-industrial',
      category: 'industrial',
      severity: 'medium',
      title: 'Недостаточный spacing между элементами',
      description: 'В перчатках сложно попасть в маленькие области. Нужен больший spacing.',
      recommendation: 'Увеличить gap между кнопками до 16px+ (gap-4)'
    });
  }
}

function checkSunlightUX(componentsPath: string, findings: TestResult[]): void {
  // Проверка контраста
  const hasHighContrast = searchInDir(componentsPath, /text-white.*bg-black|bg-yellow|font-bold/i);
  
  if (!hasHighContrast) {
    findings.push({
      agent: 'ux-specialist-industrial',
      category: 'industrial',
      severity: 'high',
      title: 'Низкий контраст для яркого солнца',
      description: 'На стройплощадке яркое солнце. UI должен быть высоко-контрастным.',
      recommendation: 'Использовать высокий контраст: чёрный текст на белом, яркие акценты'
    });
  }

  // Проверка dark mode
  const hasDarkMode = searchInDir(componentsPath, /dark:/i);
  if (!hasDarkMode) {
    findings.push({
      agent: 'ux-specialist-industrial',
      category: 'industrial',
      severity: 'medium',
      title: 'Отсутствует dark mode',
      description: 'Для работы в условиях яркого солнца может быть полезен dark mode.',
      recommendation: 'Реализовать dark/light mode toggle'
    });
  }
}

function checkOfflineUX(srcPath: string, findings: TestResult[]): void {
  // Проверка offline индикаторов
  const hasOfflineIndicator = searchInDir(srcPath, /offline|нет.*соединения|connection.*lost/i);
  
  if (!hasOfflineIndicator) {
    findings.push({
      agent: 'ux-specialist-industrial',
      category: 'industrial',
      severity: 'high',
      title: 'Нет индикации offline режима',
      description: 'Оператор не знает что приложение offline и данные не отправляются.',
      recommendation: 'Показать заметный banner "Нет соединения. Данные сохранены локально."'
    });
  }

  // Проверка auto-sync UX
  const hasAutoSync = searchInDir(srcPath, /auto.*sync|sync.*status|pending.*count/i);
  if (!hasAutoSync) {
    findings.push({
      agent: 'ux-specialist-industrial',
      category: 'industrial',
      severity: 'medium',
      title: 'Нет UX для автоматической синхронизации',
      description: 'Оператор не видит сколько отчётов pending и когда они отправятся.',
      recommendation: 'Показать badge с количеством pending отчётов, auto-sync индикатор'
    });
  }
}

function checkWorkflowUX(componentsPath: string, findings: TestResult[]): void {
  // Проверка workflow отчёта
  const reportFormPath = path.join(componentsPath, 'piling', 'report-form.tsx');
  
  if (fs.existsSync(reportFormPath)) {
    const content = fs.readFileSync(reportFormPath, 'utf-8');
    
    // Проверка простоты формы
    const hasSteps = /step|wizard|multi.?step/i.test(content);
    if (!hasSteps) {
      findings.push({
        agent: 'ux-specialist-industrial',
        category: 'industrial',
        severity: 'medium',
        title: 'Форма отчёта не step-by-step',
        description: 'Длинные формы сложнее заполнять в перчатках и на солнце.',
        file: 'src/components/piling/report-form.tsx',
        recommendation: 'Разбить форму на шаги: 1) Сваи, 2) Бурение, 3) Простоя, 4) Подтверждение'
      });
    }

    // Проверка auto-save
    const hasAutoSave = /auto.*save|draft|local.*storage/i.test(content);
    if (!hasAutoSave) {
      findings.push({
        agent: 'ux-specialist-industrial',
        category: 'industrial',
        severity: 'high',
        title: 'Нет auto-save формы',
        description: 'При потере связи или перезагрузке данные формы будут потеряны.',
        file: 'src/components/piling/report-form.tsx',
        recommendation: 'Автосохранение в localStorage каждые 30 секунд'
      });
    }
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
