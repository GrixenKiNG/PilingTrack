/**
 * Agent 9 — Mobile Web Engineer
 * Agent 10 — Browser Compatibility Engineer
 * Agent 11 — Offline Mode Specialist
 * Agent 12 — Frontend Performance Engineer
 * 
 * Комплексная проверка frontend качества PilingTrack
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentReport, TestResult } from '../qa-director';

// ============================================================================
// Agent 9 — Mobile Web Engineer
// ============================================================================

export async function mobileWebEngineer(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const componentsPath = path.join(projectRoot, 'src', 'components');
  const appPath = path.join(projectRoot, 'src', 'app');

  console.log('    🔍 Анализ mobile web...');

  // Проверка responsive layout
  checkResponsive(componentsPath, appPath, findings);

  // Проверка touch интерфейса
  checkTouchInterface(componentsPath, findings);

  // Проверка мобильного UI
  checkMobileUI(componentsPath, findings);

  return createReport('mobile-web-engineer', 'frontend', findings, startTime);
}

function checkResponsive(componentsPath: string, appPath: string, findings: TestResult[]): void {
  // Проверка Tailwind responsive классов
  const hasResponsiveClasses = searchInDir(componentsPath, /sm:|md:|lg:|xl:|2xl:/i);
  
  if (!hasResponsiveClasses) {
    findings.push({
      agent: 'mobile-web-engineer',
      category: 'frontend',
      severity: 'high',
      title: 'Отсутствует responsive дизайн',
      description: 'Компоненты не используют Tailwind responsive классы. Mobile layout может быть сломан.',
      recommendation: 'Добавить responsive breakpoints: sm (640px), md (768px), lg (1024px)'
    });
  }

  // Проверка viewport meta tag
  const layoutPath = path.join(appPath, 'layout.tsx');
  if (fs.existsSync(layoutPath)) {
    const layout = fs.readFileSync(layoutPath, 'utf-8');
    if (!layout.includes('viewport') && !layout.includes('width=device-width')) {
      findings.push({
        agent: 'mobile-web-engineer',
        category: 'frontend',
        severity: 'critical',
        title: 'Viewport не настроен',
        description: 'Без viewport meta tag mobile браузеры будут использовать desktop viewport.',
        file: 'src/app/layout.tsx',
        recommendation: 'Добавить viewport: { width: \'device-width\', initial-scale: 1 }'
      });
    }
  }

  // Проверка мобильных breakpoints
  const hasMobileBreakpoints = searchInDir(componentsPath, /useMobile|max-w-\[|hidden\s+md:flex|md:hidden/i);
  if (!hasMobileBreakpoints) {
    findings.push({
      agent: 'mobile-web-engineer',
      category: 'frontend',
      severity: 'medium',
      title: 'Возможно отсутствие мобильной адаптации',
      description: 'Не найдены компоненты с мобильной адаптацией. Операторы техники используют мобильные.',
      recommendation: 'Создать мобильные версии компонентов с conditional rendering'
    });
  }
}

function checkTouchInterface(componentsPath: string, findings: TestResult[]): void {
  // Проверка размера touch targets
  const hasTouchTargets = searchInDir(componentsPath, /min-h-\[48px\]|min-w-\[48px\]|h-12|w-12|p-4/i);
  
  if (!hasTouchTargets) {
    findings.push({
      agent: 'mobile-web-engineer',
      category: 'frontend',
      severity: 'high',
      title: 'Touch targets слишком маленькие',
      description: 'Кнопки и интерактивные элементы могут быть меньше 48x48px (рекомендация Google).',
      recommendation: 'Увеличить все интерактивные элементы до минимума 48x48px'
    });
  }

  // Проверка hover-only взаимодействий
  const hasHoverOnly = searchInDir(componentsPath, /:hover(?!:)/i);
  const hasFocusStates = searchInDir(componentsPath, /:focus|focus-visible/i);
  
  if (hasHoverOnly && !hasFocusStates) {
    findings.push({
      agent: 'mobile-web-engineer',
      category: 'frontend',
      severity: 'medium',
      title: 'Hover-only взаимодействия',
      description: 'На мобильных нет hover состояния. Hover-only UI недоступен для touch устройств.',
      recommendation: 'Добавить :focus и :active состояния, использовать click/tap вместо hover'
    });
  }

  // Проверка свайпов и жестов
  const hasGestures = searchInDir(componentsPath, /swipe|touch.*start|gesture|hammer/i);
  if (!hasGestures) {
    findings.push({
      agent: 'mobile-web-engineer',
      category: 'frontend',
      severity: 'low',
      title: 'Отсутствуют жесты',
      description: 'Мобильные пользователи ожидают свайпы и жесты (свайп для обновления, swipe to delete).',
      recommendation: 'Добавить swipe для навигации, pull-to-refresh, swipe actions'
    });
  }
}

function checkMobileUI(componentsPath: string, findings: TestResult[]): void {
  // Проверка operator dashboard для мобильных
  const operatorDashboard = path.join(componentsPath, 'piling', 'operator-dashboard.tsx');
  if (fs.existsSync(operatorDashboard)) {
    const content = fs.readFileSync(operatorDashboard, 'utf-8');
    
    // Проверка bottom tab navigation
    const hasBottomTabs = /bottom|tab.*nav|footer.*nav/i.test(content);
    if (!hasBottomTabs) {
      findings.push({
        agent: 'mobile-web-engineer',
        category: 'frontend',
        severity: 'medium',
        title: 'Отсутствует bottom navigation для мобильных',
        description: 'Операторы техники используют мобильные. Bottom navigation удобнее для больших пальцев.',
        file: 'src/components/piling/operator-dashboard.tsx',
        recommendation: 'Добавить bottom tab bar для мобильной версии оператора'
      });
    }

    // Проверка больших кнопок
    const hasLargeButtons = /btn.*large|button.*lg|h-12|min-h-\[48\]/i.test(content);
    if (!hasLargeButtons) {
      findings.push({
        agent: 'mobile-web-engineer',
        category: 'frontend',
        severity: 'medium',
        title: 'Кнопки могут быть маленькими для операторов',
        description: 'Операторы работают в перчатках. Кнопки должны быть большими.',
        file: 'src/components/piling/operator-dashboard.tsx',
        recommendation: 'Использовать кнопки минимум 48px высотой для мобильного UI'
      });
    }
  }
}

// ============================================================================
// Agent 10 — Browser Compatibility Engineer
// ============================================================================

export async function browserCompatibilityEngineer(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const srcPath = path.join(projectRoot, 'src');

  console.log('    🔍 Анализ совместимости браузеров...');

  // Проверка CSS совместимости
  checkCSSCompatibility(srcPath, findings);

  // Проверка JS совместимости
  checkJSCompatibility(srcPath, findings);

  // Проверка Android WebView
  checkAndroidWebView(srcPath, projectRoot, findings);

  return createReport('browser-compatibility-engineer', 'frontend', findings, startTime);
}

function checkCSSCompatibility(srcPath: string, findings: TestResult[]): void {
  // Проверка использования современных CSS features
  const hasModernCSS = searchInDir(srcPath, /:has\(|container|@layer|grid-template/i);
  
  if (hasModernCSS) {
    findings.push({
      agent: 'browser-compatibility-engineer',
      category: 'frontend',
      severity: 'low',
      title: 'Используются современные CSS features',
      description: ':has(), container queries могут не поддерживаться в старых браузерах.',
      recommendation: 'Добавить fallback для старых браузеров или polyfills'
    });
  }

  // Проверка vendor prefixes
  const hasVendorPrefixes = searchInDir(srcPath, /-webkit-|-moz-|-ms-|-o-/i);
  if (!hasVendorPrefixes) {
    findings.push({
      agent: 'browser-compatibility-engineer',
      category: 'frontend',
      severity: 'low',
      title: 'Отсутствуют vendor prefixes',
      description: 'Autoprefixer должен добавлять vendor prefixes автоматически.',
      recommendation: 'Убедиться что PostCSS Autoprefixer настроен'
    });
  }
}

function checkJSCompatibility(srcPath: string, findings: TestResult[]): void {
  // Проверка использования современных JS features
  const hasModernJS = searchInDir(srcPath, /optional\?\.chaining|nullish\?\?|Array\.at\(/i);
  
  if (hasModernJS) {
    findings.push({
      agent: 'browser-compatibility-engineer',
      category: 'frontend',
      severity: 'info',
      title: 'Используются современные JS features',
      description: 'Optional chaining, nullish coalescing могут не работать в старых браузерах.',
      recommendation: 'Убедиться что Babel/TypeScript транспилирует для target browsers'
    });
  }

  // Проверка tsconfig target
  const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
  if (fs.existsSync(tsconfigPath)) {
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
    const target = tsconfig.compilerOptions?.target;
    
    if (target && ['ES2022', 'ESNext'].includes(target)) {
      findings.push({
        agent: 'browser-compatibility-engineer',
        category: 'frontend',
        severity: 'medium',
        title: 'Высокий target в TypeScript',
        description: `Target ${target} может не поддерживаться в старых браузерах.`,
        file: 'tsconfig.json',
        recommendation: 'Использовать ES2015 или ES2018 для лучшей совместимости'
      });
    }
  }
}

function checkAndroidWebView(srcPath: string, projectRoot: string, findings: TestResult[]): void {
  // Проверка совместимости с Android WebView
  const hasWebViewIssues = searchInDir(srcPath, /localStorage|sessionStorage|indexedDB/i);
  
  if (hasWebViewIssues) {
    findings.push({
      agent: 'browser-compatibility-engineer',
      category: 'frontend',
      severity: 'medium',
      title: 'Возможны проблемы с Android WebView',
      description: 'localStorage/sessionStorage могут быть отключены в WebView или private mode.',
      recommendation: 'Добавить fallback: try-catch для storage, использовать in-memory fallback'
    });
  }

  // Проверка PWA manifest
  const manifestPath = path.join(projectRoot, 'public', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    findings.push({
      agent: 'browser-compatibility-engineer',
      category: 'frontend',
      severity: 'medium',
      title: 'Отсутствует PWA manifest',
      description: 'Без manifest.json приложение не может быть установлено как PWA на Android.',
      recommendation: 'Создать public/manifest.json с иконками, name, theme_color'
    });
  }
}

// ============================================================================
// Agent 11 — Offline Mode Specialist
// ============================================================================

export async function offlineModeSpecialist(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const srcPath = path.join(projectRoot, 'src');
  const publicPath = path.join(projectRoot, 'public');

  console.log('    🔍 Анализ offline режима...');

  // Проверка Service Worker
  checkServiceWorker(publicPath, srcPath, findings);

  // Проверка offline storage
  checkOfflineStorage(srcPath, findings);

  // Проверка offline UX
  checkOfflineUX(srcPath, findings);

  return createReport('offline-mode-specialist', 'frontend', findings, startTime);
}

function checkServiceWorker(publicPath: string, srcPath: string, findings: TestResult[]): void {
  // Проверка service worker файла
  const swPath = path.join(publicPath, 'sw.js');
  const hasSW = fs.existsSync(swPath);

  if (!hasSW) {
    findings.push({
      agent: 'offline-mode-specialist',
      category: 'frontend',
      severity: 'critical',
      title: 'Отсутствует Service Worker',
      description: 'Без Service Worker приложение не работает offline. Для строек с плохим интернетом это критично.',
      recommendation: 'Создать service worker с кэшированием API ответов и статики'
    });
    return;
  }

  // Проверка service worker registration
  const hasRegistration = searchInDir(srcPath, /navigator\.serviceWorker\.register/i);
  if (!hasRegistration) {
    findings.push({
      agent: 'offline-mode-specialist',
      category: 'frontend',
      severity: 'high',
      title: 'Service Worker не регистрируется',
      description: 'Service Worker файл есть, но не регистрируется в приложении.',
      recommendation: 'Зарегистрировать SW в useEffect или layout компоненте'
    });
  }

  // Проверка cache strategies
  const swContent = hasSW ? fs.readFileSync(swPath, 'utf-8') : '';
  const hasCacheFirst = /cacheFirst|CACHE_FIRST/i.test(swContent);
  const hasNetworkFirst = /networkFirst|NETWORK_FIRST/i.test(swContent);
  
  if (!hasCacheFirst && !hasNetworkFirst) {
    findings.push({
      agent: 'offline-mode-specialist',
      category: 'frontend',
      severity: 'medium',
      title: 'Не настроены cache стратегии',
      description: 'Service Worker должен использовать cache-first для статики, network-first для API.',
      recommendation: 'Настроить стратегии: Cache-First для assets, Network-First для API, Stale-While-Revalidate'
    });
  }
}

function checkOfflineStorage(srcPath: string, findings: TestResult[]): void {
  // Проверка использования IndexedDB
  const hasIndexedDB = searchInDir(srcPath, /indexedDB|idb|localforage|dexie/i);
  const hasLocalStorage = searchInDir(srcPath, /localStorage|useLocalStorage/i);

  if (hasLocalStorage && !hasIndexedDB) {
    findings.push({
      agent: 'offline-mode-specialist',
      category: 'frontend',
      severity: 'high',
      title: 'Используется localStorage вместо IndexedDB',
      description: 'localStorage ограничен 5MB и синхронный. Для offline отчётов нужен IndexedDB.',
      recommendation: 'Использовать IndexedDB через idb или localforage для хранения отчётов offline'
    });
  }

  // Проверка offline queue
  const hasOfflineQueue = searchInDir(srcPath, /queue|offline.*store|pending.*report/i);
  if (!hasOfflineQueue) {
    findings.push({
      agent: 'offline-mode-specialist',
      category: 'frontend',
      severity: 'high',
      title: 'Отсутствует offline queue',
      description: 'Отчёты созданные offline не сохраняются для отправки при восстановлении связи.',
      recommendation: 'Реализовать queue для offline отчётов с автоматической отправкой'
    });
  }

  // Проверка network status detection
  const hasNetworkDetection = searchInDir(srcPath, /navigator\.onLine|online|offline.*event/i);
  if (!hasNetworkDetection) {
    findings.push({
      agent: 'offline-mode-specialist',
      category: 'frontend',
      severity: 'medium',
      title: 'Не определяется статус сети',
      description: 'Приложение не знает когда оно online/offline для показа уведомления.',
      recommendation: 'Слушать online/offline события, показывать статус соединения'
    });
  }
}

function checkOfflineUX(srcPath: string, findings: TestResult[]): void {
  // Проверка offline индикаторов
  const hasOfflineIndicator = searchInDir(srcPath, /offline.*banner|connection.*lost|нет.*соединения/i);
  if (!hasOfflineIndicator) {
    findings.push({
      agent: 'offline-mode-specialist',
      category: 'frontend',
      severity: 'high',
      title: 'Отсутствует offline индикатор',
      description: 'Пользователь не знает что приложение offline и данные не отправляются.',
      recommendation: 'Показать banner "Нет соединения. Данные сохранены локально."'
    });
  }

  // Проверка sync UX
  const hasSyncUX = searchInDir(srcPath, /sync.*button|sync.*status|conflict.*resolution/i);
  if (!hasSyncUX) {
    findings.push({
      agent: 'offline-mode-specialist',
      category: 'frontend',
      severity: 'medium',
      title: 'Отсутствует UX для синхронизации',
      description: 'Нет UI для ручной синхронизации и разрешения конфликтов.',
      recommendation: 'Добавить кнопку "Синхронизировать", показать статус pending отчётов'
    });
  }
}

// ============================================================================
// Agent 12 — Frontend Performance Engineer
// ============================================================================

export async function frontendPerformanceEngineer(projectRoot: string): Promise<AgentReport> {
  const findings: TestResult[] = [];
  const startTime = Date.now();
  const srcPath = path.join(projectRoot, 'src');

  console.log('    🔍 Анализ frontend производительности...');

  // Проверка bundle size
  checkBundleSize(projectRoot, findings);

  // Проверка render speed
  checkRenderSpeed(srcPath, findings);

  // Проверка memory usage
  checkMemoryUsage(srcPath, findings);

  return createReport('frontend-performance-engineer', 'frontend', findings, startTime);
}

function checkBundleSize(projectRoot: string, findings: TestResult[]): void {
  // Проверка размера зависимостей
  const packagePath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(packagePath)) {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    const depCount = Object.keys(packageJson.dependencies || {}).length;
    
    if (depCount > 60) {
      findings.push({
        agent: 'frontend-performance-engineer',
        category: 'frontend',
        severity: 'high',
        title: `Большое количество зависимостей (${depCount})`,
        description: 'Много зависимостей увеличивает bundle size и время загрузки.',
        recommendation: 'Удалить неиспользуемые зависимости, использовать dynamic imports'
      });
    }

    // Проверка больших библиотек
    const hasLargeDeps = ['recharts', 'framer-motion', '@mdxeditor/editor'].filter(dep => 
      packageJson.dependencies[dep]
    );
    
    if (hasLargeDeps.length > 0) {
      findings.push({
        agent: 'frontend-performance-engineer',
        category: 'frontend',
        severity: 'medium',
        title: `Крупные зависимости: ${hasLargeDeps.join(', ')}`,
        description: 'Эти библиотеки значительно увеличивают bundle size.',
        recommendation: 'Использовать dynamic import() для lazy loading тяжёлых библиотек'
      });
    }
  }

  // Проверка next.config.js для оптимизаций
  const nextConfigPath = path.join(projectRoot, 'next.config.ts');
  if (fs.existsSync(nextConfigPath)) {
    const config = fs.readFileSync(nextConfigPath, 'utf-8');
    
    if (!config.includes('experimental') || !config.includes('optimizePackageImports')) {
      findings.push({
        agent: 'frontend-performance-engineer',
        category: 'frontend',
        severity: 'low',
        title: 'Не оптимизированы импорты пакетов',
        description: 'Next.js может tree-shake и оптимизировать импорты.',
        file: 'next.config.ts',
        recommendation: 'Включить experimental.optimizePackageImports'
      });
    }
  }
}

function checkRenderSpeed(srcPath: string, findings: TestResult[]): void {
  // Проверка мемоизации
  const hasMemoization = searchInDir(srcPath, /useMemo|useCallback|React\.memo/i);
  
  if (!hasMemoization) {
    findings.push({
      agent: 'frontend-performance-engineer',
      category: 'frontend',
      severity: 'medium',
      title: 'Отсутствует мемоизация',
      description: 'Без useMemo/useCallback компоненты перерендерятся при каждом изменении.',
      recommendation: 'Добавить useMemo для вычислений, useCallback для функций, memo для компонентов'
    });
  }

  // Проверка больших списков
  const hasLargeLists = searchInDir(srcPath, /\.map\(|\.forEach\(/i);
  const hasVirtualization = searchInDir(srcPath, /react-window|react-virtualized|virtuoso/i);
  
  if (hasLargeLists && !hasVirtualization) {
    findings.push({
      agent: 'frontend-performance-engineer',
      category: 'frontend',
      severity: 'medium',
      title: 'Списки без виртуализации',
      description: 'Рендер больших списков (>100 элементов) без виртуализации медленный.',
      recommendation: 'Использовать react-window или @tanstack/react-virtual для длинных списков'
    });
  }

  // Проверка re-renders
  const hasConsoleRenders = searchInDir(srcPath, /console\.log.*render|useEffect.*\[\]/i);
  if (hasConsoleRenders) {
    findings.push({
      agent: 'frontend-performance-engineer',
      category: 'frontend',
      severity: 'low',
      title: 'Возможны лишние рендеры',
      description: 'Debug логи или useEffect без deps могут указывать на проблемы с рендерами.',
      recommendation: 'Удалить console.log, проверить useEffect dependencies'
    });
  }
}

function checkMemoryUsage(srcPath: string, findings: TestResult[]): void {
  // Проверка утечек памяти
  const hasEventListeners = searchInDir(srcPath, /addEventListener|window\.on/i);
  const hasCleanup = searchInDir(srcPath, /removeEventListener|return\s*\(\)\s*=>/i);
  
  if (hasEventListeners && !hasCleanup) {
    findings.push({
      agent: 'frontend-performance-engineer',
      category: 'frontend',
      severity: 'high',
      title: 'Возможные утечки памяти',
      description: 'Event listeners добавляются но не удаляются при unmount.',
      recommendation: 'Возвращать cleanup функцию из useEffect для удаления listeners'
    });
  }

  // Проверка setInterval/setTimeout без очистки
  const hasIntervals = searchInDir(srcPath, /setInterval|setTimeout/i);
  const hasIntervalCleanup = searchInDir(srcPath, /clearInterval|clearTimeout/i);
  
  if (hasIntervals && !hasIntervalCleanup) {
    findings.push({
      agent: 'frontend-performance-engineer',
      category: 'frontend',
      severity: 'high',
      title: 'setInterval/setTimeout без очистки',
      description: 'Таймеры без очистки при unmount создают утечки памяти.',
      recommendation: 'Очищать таймеры в useEffect cleanup функции'
    });
  }

  // Проверка Zustand store cleanup
  const hasZustand = searchInDir(srcPath, /create\(\)|useStore|zustand/i);
  if (hasZustand) {
    // Zustand обычно хорошо управляет памятью
    findings.push({
      agent: 'frontend-performance-engineer',
      category: 'frontend',
      severity: 'info',
      title: 'Используется Zustand',
      description: 'Zustand хорошо управляет памятью, но проверить cleanup для subscriptions.',
      recommendation: 'Убедиться что подписки на store освобождаются при unmount'
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
