/**
 * API Route Smoke Tests
 *
 * Verifies that all critical API route files exist and export correct handlers.
 * Does NOT test actual business logic — that's covered by E2E tests.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';

function findRouteFiles(dir: string): string[] {
  const results: string[] = [];

  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      results.push(...findRouteFiles(fullPath));
    } else if (entry === 'route.ts') {
      results.push(relative(join(process.cwd(), 'src'), fullPath));
    }
  }

  return results;
}

describe('API Routes — File existence', () => {
  const apiDir = join(process.cwd(), 'src', 'app', 'api');
  const routeFiles = findRouteFiles(apiDir);

  it('has route files for all critical endpoints', () => {
    const criticalPaths = [
      'health/route.ts',
      'auth/login/route.ts',
      'auth/me/route.ts',
      'auth/logout/route.ts',
      'sites/route.ts',
      'dictionary/all/route.ts',
      'equipment/route.ts',
      'crews/route.ts',
      'reports/my/route.ts',
      'telegram/configs/route.ts',
    ];

    for (const criticalPath of criticalPaths) {
      const fullPath = join(apiDir, criticalPath);
      expect(existsSync(fullPath)).toBe(true);
    }
  });

  it('has reasonable number of route files', () => {
    // Should have at least 20 route files
    expect(routeFiles.length).toBeGreaterThanOrEqual(20);
  });
});

describe('Authorization Service', () => {
  it('exports required functions', async () => {
    const auth = await import('@/services/auth/authorization-service');
    expect(auth.can).toBeDefined();
    expect(auth.assertCan).toBeDefined();
    expect(auth.isPrivilegedRole).toBeDefined();
    expect(auth.resolveUserScope).toBeDefined();
  });

  it('ADMIN has all abilities', async () => {
    const { can } = await import('@/services/auth/authorization-service');

    const abilities = [
      'analytics.read',
      'reports.read_all',
      'reports.manage_all',
      'sites.manage',
      'users.manage',
      'equipment.manage',
      'crews.manage',
      'dictionary.manage',
      'telegram.manage',
    ];

    for (const ability of abilities) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
      expect(can({ role: 'ADMIN' }, ability as any)).toBe(true);
    }
  });

  it('OPERATOR cannot manage sites', async () => {
    const { can } = await import('@/services/auth/authorization-service');
    expect(can({ role: 'OPERATOR' }, 'sites.manage')).toBe(false);
    expect(can({ role: 'OPERATOR' }, 'users.manage')).toBe(false);
    expect(can({ role: 'OPERATOR' }, 'dictionary.manage')).toBe(false);
  });

  it('DISPATCHER can read reports and sites', async () => {
    const { can } = await import('@/services/auth/authorization-service');
    expect(can({ role: 'DISPATCHER' }, 'reports.read_all')).toBe(true);
    expect(can({ role: 'DISPATCHER' }, 'sites.read_all')).toBe(true);
    expect(can({ role: 'DISPATCHER' }, 'crews.read')).toBe(true);
  });
});

describe('Resource Access Service', () => {
  it('file exists', () => {
    const filePath = join(process.cwd(), 'src', 'services', 'auth', 'resource-access-service.ts');
    expect(existsSync(filePath)).toBe(true);
  });
});

describe('Session Service', () => {
  it('file exists', () => {
    const filePath = join(process.cwd(), 'src', 'services', 'auth', 'session-service.ts');
    expect(existsSync(filePath)).toBe(true);
  });
});

describe('Rate Limiter', () => {
  it('exports rate limiter', async () => {
    const rl = await import('@/lib/rate-limiter');
    expect(rl.rateLimiter).toBeDefined();
    expect(rl.rateLimiter.check).toBeDefined();
    expect(rl.rateLimiter.reset).toBeDefined();
  });

  it('has correct default configs', async () => {
    const { AUTH_RATE_LIMIT } = await import('@/lib/rate-limiter');

    expect(AUTH_RATE_LIMIT.maxAttempts).toBe(5);
  });
});


// ============================================================================
// Контракт маршрутов
//
// Здесь не проверяется, что делает конкретный обработчик, — на это есть тесты
// рядом с каждым маршрутом. Здесь проверяется свойство, верное сразу для всех
// маршрутов: у каждого есть замок, и он нужного вида.
//
// Такую проверку нельзя написать по одному файлу за раз. Забытый requireAuth в
// новом маршруте — не ошибка внутри маршрута, её видно только на фоне всех
// остальных: «этот один не такой, как сто двадцать один». Отсюда и форма —
// обход каталога, а не список ожиданий.
//
// Проверка идёт по каждому методу отдельно, а не по файлу. Файл проходил бы
// зачёт по любому упоминанию защиты в любом месте — так и вышло на
// place-presets: POST шёл через withReadinessCommand, а объявленный рядом
// DELETE не был закрыт ничем, и файл всё равно считался закрытым. Поэтому
// личность проверяется там же, где CSRF, — по телу обработчика, а списки
// исключений ключуются методом (`путь#МЕТОД`), а не файлом (R80 №3).
//
// Ручной withCsrf перестал быть доказательством защиты изменяющего метода
// (R80 №4). Обёртка withMutation закрывает и межсайтовый вызов, и лимит
// запросов; ручной вызов — только первое, лимита у него нет вовсе. Раньше
// эти два состояния считались одним, поэтому телеметрия жила мимо правила
// «POST передаётся в withMutation». Теперь ручной CSRF допустим лишь для
// строки из MANUAL_CSRF_METHODS — с причиной и на разбор.
//
// Списки исключений — не «замазать красное». Каждая строка называет причину, и
// тест ломается в обе стороны: и когда защита пропала у нового маршрута, и
// когда исключение протухло (файл удалён или защиту в него вернули). Список,
// который не может разъехаться с кодом, — единственный, который живёт.
// ============================================================================

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const STATE_CHANGING: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** Всё, что доказывает личность вызывающего. */
const AUTH_GATES = [
  'requireAuth',                     // сессия приложения
  'resolveReadinessRequestContext',  // тот же requireAuth + тенант + матрица доступов
  'withReadinessCommand',            // обёртка вокруг него же
  'resolveOperatorV3RequestContext', // тот же requireAuth + роль OPERATOR + тенант
  'withOperatorV3Command',           // обёртка вокруг него же
  'authenticateDevice',              // ключ устройства в заголовке X-Device-Key
  'ALERTMANAGER_WEBHOOK_TOKEN',      // общий секрет, сверяется constantTimeEquals
];

/**
 * Полная защита изменяющего метода: межсайтовый вызов и лимит запросов в одной
 * обёртке. Все три внутри себя вызывают withMutation, а тот — withCsrf и
 * rateLimiter.check.
 */
const FULL_CSRF_GATES = ['withMutation', 'withReadinessCommand', 'withOperatorV3Command'];

/** Вызов CSRF руками, в теле обработчика; лимита не даёт. */
const MANUAL_CSRF_GATE = 'withCsrf';

/** Всё, что ловит исключение до того, как оно уйдёт наружу стеком. */
const WRAPPERS = ['withApi', 'withMutation', 'withReadinessCommand', 'withOperatorV3Command'];

/**
 * Методы без проверки личности — и почему это правильно.
 * Ключ — `путь#МЕТОД`, как в остальных списках: файл целиком исключением не
 * бывает, рядом с публичным GET однажды появится закрытый POST.
 */
const PUBLIC_METHODS: Record<string, string> = {
  'auth/login/route.ts#POST': 'выдаёт сессию — требовать сессию здесь было бы замкнутым кругом',
  'health/route.ts#GET': 'проба живости для балансировщика; отдаёт только статус и версию',
  'health/deep/route.ts#GET': 'проба зависимостей для внешнего мониторинга; только ok/down, из кеша фонового трекера',
  'liveness/route.ts#GET': 'проба живости контейнера',
  'ready/route.ts#GET': 'проба готовности к приёму трафика',
  'readiness/route.ts#GET': 'устаревший синоним /api/ready, отдаёт заголовок Sunset',
  'route.ts#GET': 'корень /api — отдаёт версию, данных не касается',
  'orion/lead/route.ts#POST': 'форма заявки публичного сайта; закрыта иначе — лимит по IP, ловушка для ботов, экранирование',
  'telemetry/ingest/route.ts#GET': 'справка для контроллера: статус, версия и точки входа, данных не касается. R80: разобрать — проверка по методу показала его впервые',
};

/**
 * Изменяющие данные методы без CSRF — и почему это правильно. Ключ вида
 * `путь#МЕТОД`. Все до одного — точки входа, куда браузер с чужой страницы не
 * дотянется: либо сессии ещё нет, либо вызывающий вообще не браузер.
 */
const CSRF_EXEMPT_METHODS: Record<string, string> = {
  'auth/login/route.ts#POST': 'сессии ещё нет — угонять нечего',
  'orion/lead/route.ts#POST': 'публичная форма без сессии; защита — лимит по IP и ловушка для ботов',
  'alerts/webhook/route.ts#POST': 'вызывает Alertmanager по общему секрету, не браузер',
  'telemetry/ingest/route.ts#POST': 'вызывает контроллер по ключу устройства, не браузер',
  'telemetry/ingest/route.ts#PATCH': 'то же самое — настройка порогов на устройстве',
};

/**
 * Изменяющие данные методы, закрытые вручную, — и почему это пока терпимо.
 * Ключ вида `путь#МЕТОД`. Полной защитой такой вызов не является: лимит
 * обёртки (per-route ключ `mut:<путь>:<сессия>:<ip>` и общий `mut:source:<ip>`)
 * к маршруту не применяется. Список — очередь на перевод в withMutation, где
 * лимит задаётся опцией `rateLimit`; уйти из него можно только вместе с
 * ручным вызовом, иначе тест протухания не отпустит.
 */
const MANUAL_CSRF_METHODS: Record<string, string> = {
  'telemetry/route.ts#POST': 'R80 №2: withApi + withCsrf руками; лимит обёртки не применяется — перевести на withMutation с { rateLimit }',
  'telemetry/batch/route.ts#POST': 'R80 №2: то же самое на пакетной записи телеметрии — перевести на withMutation с { rateLimit }',
};

/** Методы без обёртки — и почему. Ключ вида `путь#МЕТОД`. */
const NO_WRAPPER_METHODS: Record<string, string> = {
  'alerts/webhook/route.ts#POST': 'ответ Alertmanager должен быть голым, без обвязки',
  'feedback/stream/route.ts#GET': 'SSE: обёртка дождалась бы конца потока и тем его сломала',
  'health/route.ts#GET': 'проба обязана отвечать, даже когда обвязка сломана',
  'health/deep/route.ts#GET': 'проба зависимостей, по той же причине',
  'liveness/route.ts#GET': 'проба живости, по той же причине',
  'ready/route.ts#GET': 'проба готовности, по той же причине',
  'readiness/route.ts#GET': 'устаревший синоним /api/ready, по той же причине',
  'orion/lead/route.ts#POST': 'публичная форма со своей обработкой ошибок',
};

interface RouteMethod {
  /** `путь#МЕТОД` — так же, как в списках исключений. */
  key: string;
  path: string;
  method: string;
  /** Объявление метода: от его export до следующего export в файле. */
  declaration: string;
  /**
   * Тело обработчика: объявление плюс тела локальных функций и констант этого
   * же файла, названных в объявлении, — то, что реально исполняется на запрос.
   * Нужно, чтобы объявление вида `withApi(handleGet)` не выглядело незакрытым.
   */
  handlerText: string;
  wrapped: boolean;
}

interface RouteFacts {
  path: string;
  source: string;
  methods: RouteMethod[];
}

/**
 * Вырезать объявление одного метода: от его export до следующего export.
 * Так проверка не засчитывает соседнему методу защиту, стоящую в этом.
 */
function sliceMethod(source: string, method: string): string | null {
  const asConst = source.indexOf('export const ' + method + ' ');
  const asFn = source.indexOf('export async function ' + method + '(');
  const start = asConst >= 0 ? asConst : asFn;
  if (start < 0) return null;

  const nextExports = HTTP_METHODS.flatMap((m) => [
    source.indexOf('export const ' + m + ' ', start + 1),
    source.indexOf('export async function ' + m + '(', start + 1),
  ]).filter((i) => i > start);

  return source.slice(start, nextExports.length > 0 ? Math.min(...nextExports) : undefined);
}

/**
 * Конец строкового литерала или комментария, начавшегося в позиции i; -1,
 * если там обычный код. Нужно дважды: чтобы найти закрывающую скобку тела, не
 * споткнувшись о скобку внутри строки, и чтобы не принимать имена из строк за
 * вызовы. Без второго сканер тянул в помощники чужой метод — в телеметрии
 * строка «POST /api/telemetry/ingest» называла экспортированный POST.
 */
function literalEnd(source: string, i: number): number {
  const char = source[i];
  if (char === '/' && source[i + 1] === '/') {
    const newline = source.indexOf('\n', i);
    return newline < 0 ? source.length : newline;
  }
  if (char === '/' && source[i + 1] === '*') {
    const close = source.indexOf('*/', i);
    return close < 0 ? source.length : close + 2;
  }
  if (char === "'" || char === '"' || char === '`') {
    for (let j = i + 1; j < source.length; j++) {
      if (source[j] === '\\') { j++; continue; }
      if (source[j] === char) return j + 1;
    }
    return source.length;
  }
  return -1;
}

/** Тот же текст, но содержимое строк и комментариев заменено пробелами. */
function withoutLiterals(source: string): string {
  let plain = '';
  for (let i = 0; i < source.length; i++) {
    const end = literalEnd(source, i);
    if (end >= 0) {
      plain += ' '.repeat(end - i);
      i = end - 1;
      continue;
    }
    plain += source[i];
  }
  return plain;
}

/**
 * Объявление локальной — не экспортируемой — функции или константы: от имени до
 * закрывающей скобки тела. Экспортированные обработчики сюда не попадают:
 * `export const GET = …` стоит на своём месте, а не в помощниках соседа.
 */
function localDefinition(source: string, name: string): string | null {
  let start = -1;
  for (const pattern of ['function ' + name + '(', 'const ' + name + ' = ']) {
    let from = 0;
    while (start < 0) {
      const found = source.indexOf(pattern, from);
      if (found < 0) break;
      // Перед объявлением на строке — только пробелы и, может быть, `async`.
      if (/^(async\s+)?$/.test(source.slice(source.lastIndexOf('\n', found) + 1, found))) {
        start = found;
        break;
      }
      from = found + 1;
    }
    if (start >= 0) break;
  }
  if (start < 0) return null;

  // От конца списка параметров — до открывающей скобки тела. Строки и
  // комментарии пропускаем: в типах параметров бывают фигурные скобки
  // (`{params: Promise<{id: string}>}`), и без пропуска счёт сошёл бы с ума.
  let cursor = start + source.slice(start).indexOf(name) + name.length;
  if (source[cursor] === '(' || /^\s*=\s*(async\s*)?\(/.test(source.slice(cursor, cursor + 20))) {
    let parens = 0;
    while (cursor < source.length) {
      const end = literalEnd(source, cursor);
      if (end >= 0) { cursor = end; continue; }
      if (source[cursor] === '(') parens++;
      else if (source[cursor] === ')') { parens--; if (parens === 0) { cursor++; break; } }
      cursor++;
    }
  }
  // Между списком параметров и телом бывает аннотация типа возврата
  // (`function isAuthorized(...): boolean {`), поэтому ищем открывающую скобку,
  // а не требуем её сразу за скобкой параметров. До `;` — иначе константа со
  // значением не-функцией (`const X = (a) => a;`) была бы принята за функцию.
  const body = /^\s*(=>\s*)?[^{;]*\{/.exec(source.slice(cursor));
  if (body === null) return null;
  const bodyStart = cursor + (body[0].length - 1);

  let depth = 0;
  for (let j = bodyStart; j < source.length; j++) {
    const end = literalEnd(source, j);
    if (end >= 0) { j = end - 1; continue; }
    if (source[j] === '{') depth++;
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(start, j + 1); }
  }
  return source.slice(start);
}

/**
 * Имена, названные в тексте, — кандидаты в помощники обработчика. Достаточно
 * самого имени: если локального объявления с ним нет, кандидат просто не
 * найдётся. Точка перед именем исключена — `obj.method` это не помощник.
 */
function referencedNames(text: string): Set<string> {
  const names = new Set<string>();
  const pattern = /(?<![.\w$])([A-Za-z_$][\w$]*)/g;
  let match = pattern.exec(text);
  while (match !== null) {
    names.add(match[1]);
    match = pattern.exec(text);
  }
  return names;
}

/**
 * Тело обработчика: его объявление и, рекурсивно, тела локальных функций и
 * констант, которые в объявлении названы. Проверка личности идёт по нему, а не
 * по файлу, — но и не только по одной строке `export const DELETE = withMutation(
 * handleDelete)`: сама проверка живёт в handleDelete, и без достройки
 * незакрытым выглядел бы каждый маршрут с вынесенным обработчиком
 * (readiness/*: `withApi(handleGet)`).
 */
function handlerText(source: string, declaration: string): string {
  const chunks = [declaration];
  const seen = new Set<string>();
  let level = [declaration];

  // Три уровня: обработчик → его помощник → помощник помощника. Дальше не
  // ходим — цепочка вызовов ушла бы в половину файла и перестала что-либо
  // доказывать.
  for (let depth = 0; depth < 3 && level.length > 0; depth++) {
    const next: string[] = [];
    for (const chunk of level) {
      for (const name of referencedNames(withoutLiterals(chunk))) {
        if (seen.has(name)) continue;
        seen.add(name);
        const definition = localDefinition(source, name);
        if (definition !== null && !chunks.includes(definition)) {
          chunks.push(definition);
          next.push(definition);
        }
      }
    }
    level = next;
  }

  return chunks.join('\n');
}

function collectRouteFacts(): RouteFacts[] {
  const apiDir = join(process.cwd(), 'src', 'app', 'api');
  return findRouteFiles(apiDir).map((rel) => {
    const source = readFileSync(join(process.cwd(), 'src', rel), 'utf8');
    // findRouteFiles отдаёт путь от src/ разделителем этой ОС; приводим к
    // единому виду, иначе списки исключений пришлось бы держать в двух.
    const path = rel.split(sep).slice(2).join('/');

    const methods: RouteMethod[] = [];
    for (const method of HTTP_METHODS) {
      let declaration = sliceMethod(source, method);
      if (declaration === null) continue;

      // `export const PATCH = POST;` — псевдоним, а не отдельный обработчик:
      // защита стоит на том методе, на который он указывает. Без этой ветки
      // тест требовал бы замок там, где нет и тела.
      const alias = HTTP_METHODS.find((m) => declaration?.startsWith('export const ' + method + ' = ' + m + ';'));
      if (alias !== undefined) declaration = sliceMethod(source, alias) ?? declaration;

      methods.push({
        key: path + '#' + method,
        path,
        method,
        declaration,
        handlerText: handlerText(source, declaration),
        wrapped: WRAPPERS.some((w) => declaration.includes('= ' + w + '(')),
      });
    }

    return { path, source, methods };
  });
}

describe('Контракт маршрутов — у каждого есть замок', () => {
  const routes = collectRouteFacts();
  const allMethods = routes.flatMap((r) => r.methods);

  it('обходит все маршруты и находит в каждом хотя бы один метод', () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.filter((r) => r.methods.length === 0).map((r) => r.path)).toEqual([]);
  });

  it('каждый метод либо проверяет личность, либо назван публичным с причиной', () => {
    const unguarded = allMethods
      .filter((m) => !AUTH_GATES.some((gate) => m.handlerText.includes(gate)))
      .filter((m) => !(m.key in PUBLIC_METHODS))
      .map((m) => m.key);

    expect(unguarded).toEqual([]);
  });

  it('каждый изменяющий данные метод закрыт от межсайтового вызова', () => {
    const unguarded = allMethods
      .filter((m) => STATE_CHANGING.includes(m.method))
      .filter((m) => !FULL_CSRF_GATES.some((gate) => m.declaration.includes(gate)))
      .filter((m) => !(m.key in CSRF_EXEMPT_METHODS))
      // Ручной CSRF закрывает только межсайтовый вызов: лимита запросов у него
      // нет, а правило требует обоих. Поэтому такой метод обязан быть в
      // списке на перевод, а не считаться защищённым сам по себе.
      .filter((m) => !(m.declaration.includes(MANUAL_CSRF_GATE) && m.key in MANUAL_CSRF_METHODS))
      .map((m) => m.key);

    expect(unguarded).toEqual([]);
  });

  it('каждый метод проходит через withApi — иначе исключение уйдёт наружу стеком', () => {
    const unwrapped = allMethods
      .filter((m) => !m.wrapped)
      .filter((m) => !(m.key in NO_WRAPPER_METHODS))
      .map((m) => m.key);

    expect(unwrapped).toEqual([]);
  });
});

// Проверки ниже — против протухания списков. Без них исключение, выписанное
// однажды, переживёт и удаление файла, и возврат защиты, и будет молча
// прикрывать следующий маршрут, который попадёт на то же место.
describe('Контракт маршрутов — списки исключений не протухли', () => {
  const routes = collectRouteFacts();
  const byKey = new Map(routes.flatMap((r) => r.methods).map((m) => [m.key, m]));

  it.each([
    ['публичных', PUBLIC_METHODS],
    ['без CSRF', CSRF_EXEMPT_METHODS],
    ['с ручным CSRF', MANUAL_CSRF_METHODS],
    ['без обёртки', NO_WRAPPER_METHODS],
  ])('в списке %s нет строк про несуществующие методы', (_label, list) => {
    expect(Object.keys(list).filter((k) => !byKey.has(k))).toEqual([]);
  });

  it('в списке публичных нет методов, куда защиту уже вернули', () => {
    const stale = Object.keys(PUBLIC_METHODS).filter((k) => {
      const method = byKey.get(k);
      return method !== undefined && AUTH_GATES.some((gate) => method.handlerText.includes(gate));
    });

    expect(stale).toEqual([]);
  });

  it('в списке без CSRF нет методов, куда защиту уже вернули', () => {
    const stale = Object.keys(CSRF_EXEMPT_METHODS).filter((k) => {
      const method = byKey.get(k);
      return method !== undefined && FULL_CSRF_GATES.some((gate) => method.declaration.includes(gate));
    });

    expect(stale).toEqual([]);
  });

  it('в списке с ручным CSRF нет методов, у которых ручной вызов уже убрали', () => {
    const stale = Object.keys(MANUAL_CSRF_METHODS).filter((k) => {
      const method = byKey.get(k);
      return method !== undefined && !method.declaration.includes(MANUAL_CSRF_GATE);
    });

    expect(stale).toEqual([]);
  });

  it('в списке без обёртки нет методов, которые уже обёрнуты', () => {
    expect(Object.keys(NO_WRAPPER_METHODS).filter((k) => byKey.get(k)?.wrapped === true)).toEqual([]);
  });

  it('каждая причина в списках исключений написана, а не оставлена пустой', () => {
    const empty = [PUBLIC_METHODS, CSRF_EXEMPT_METHODS, MANUAL_CSRF_METHODS, NO_WRAPPER_METHODS]
      .flatMap((list) => Object.entries(list))
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([key]) => key);

    expect(empty).toEqual([]);
  });
});

/**
 * Серверные раскладки и страницы — отдельный класс путей к базе.
 *
 * Обёртка `withApi` открывает контекст организации, но через неё проходят
 * только маршруты API. Серверный компонент страницы читает базу напрямую, и
 * под строгими политиками RLS его запрос возвращает пусто. На бою 19.08.2026
 * это уронило весь раздел администратора: раскладка не находила пользователя,
 * уходила на /login, страница входа возвращала на /admin — три перехода в
 * секунду, пока браузер не закроют.
 *
 * Проверка простая: серверный компонент вне `api/` не имеет права дёргать
 * `db.` напрямую. Ему полагается `readPageSessionUser` (lib/page-session) или
 * собственный `runWithTenantContext`.
 */
describe('серверные страницы не ходят в базу без организации', () => {
  const APP_DIR = join(process.cwd(), 'src', 'app');

  function collectPageFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'api' || entry.name === '__tests__') continue;
        collectPageFiles(full, found);
      } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
        found.push(full);
      }
    }
    return found;
  }

  it('ни один серверный компонент страницы не обращается к db напрямую', () => {
    const offenders = collectPageFiles(APP_DIR)
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        if (source.includes("'use client'")) return false;
        // Вызов модели: db.user., db.report. и подобное. Строки в комментариях
        // отсекаются тем, что ищем именно вызов с открывающей скобкой.
        return /\bdb\.[a-zA-Z]+\.(findUnique|findFirst|findMany|count|create|update|delete|upsert|aggregate|groupBy)\(/.test(
          source
        );
      })
      .map((file) => relative(process.cwd(), file).split(sep).join('/'));

    expect(offenders).toEqual([]);
  });
});
