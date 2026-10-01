/**
 * API Route Smoke Tests
 *
 * Verifies that all critical API route files exist and export correct handlers.
 * Does NOT test actual business logic — that's covered by E2E tests.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';
import * as ts from 'typescript';

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
  'alerts/webhook/route.ts#POST': 'T-API-CONTRACT-b: разобрать — токен вебхука сверяет локальная isAuthorized, но это не вызов известной функции проверки, поэтому одним вызовом защита не доказывается',
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
  /** Объявление метода — исходный текст экспортируемой строки. */
  declaration: string;
  /**
   * Имена, которые обработчик вызывает как функцию, — в своём теле и в телах
   * локальных функций, которые он действительно запускает. Собраны по AST,
   * поэтому упоминание имени в комментарии, строке или объекте-литерале
   * (`{ isAuthorized: false }`) вызовом не считается.
   */
  calls: Set<string>;
  wrapped: boolean;
}

interface RouteFacts {
  path: string;
  source: string;
  methods: RouteMethod[];
}

/**
 * Разбор ведётся по AST (пакет typescript уже в node_modules): текстовый поиск
 * принимал за вызов упоминание имени — в комментарии, строке, недостижимом
 * коде или объекте-литерале (`{ isAuthorized: false }`) — и приписывал методу
 * проверку личности, которой в нём нет. Узел вызова (CallExpression) от
 * упоминания неотличим только текстом; в дереве он виден явно.
 */
function isExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

/** Тела локальных — не экспортируемых — функций файла: имя → узел тела. */
function localFunctionBodies(sf: ts.SourceFile): Map<string, ts.Node> {
  const bodies = new Map<string, ts.Node>();
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      bodies.set(statement.name.text, statement.body);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
        const { initializer } = declaration;
        if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
          bodies.set(declaration.name.text, initializer.body);
        }
      }
    }
  }
  return bodies;
}

interface HandlerSite {
  /** Узел, с которого начинается разбор вызовов: тело или обёртка обработчика. */
  node: ts.Node;
  /** Исходный текст объявления — для проверок обёртки и CSRF. */
  text: string;
}

/**
 * Объявление обработчика по AST: `export const GET = withApi(handleGet)`,
 * `export async function GET(...)` и псевдоним `export const PATCH = POST;`.
 * Тело берётся из дерева, поэтому скобка в аннотации типа возврата
 * (`Promise<{ user: User }>`) больше не принимается за начало тела.
 * `null` — метода в файле нет.
 */
function handlerSite(sf: ts.SourceFile, bodies: Map<string, ts.Node>, method: string): HandlerSite | null {
  for (const statement of sf.statements) {
    if (!isExported(statement)) continue;

    let node: ts.Node | null = null;
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === method) {
      node = statement.body ?? statement;
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === method && declaration.initializer) {
          node = declaration.initializer;
          break;
        }
      }
    }
    if (node === null) continue;

    // `export const PATCH = POST;` — псевдоним, а не отдельный обработчик:
    // защита стоит на том методе, на который он указывает.
    if (ts.isIdentifier(node)) {
      const aliased = handlerSite(sf, bodies, node.text);
      if (aliased !== null) return aliased;
      const local = bodies.get(node.text);
      if (local !== undefined) return { node: local, text: local.getText(sf) };
    }

    return { node, text: statement.getText(sf) };
  }
  return null;
}

/** Узел-функция: его тело — отдельная область выполнения. */
function isFunctionLikeNode(node: ts.Node): boolean {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node);
}

/**
 * Имя, под которым объявлена функция (`function helper()`,
 * `const helper = () => …`). У анонимной функции имени нет — её запускает
 * только тот вызов, аргументом которого она стоит.
 */
function declaredFunctionName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node)) return node.name?.text ?? null;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent;
    if (parent !== undefined && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
  }
  return null;
}

/**
 * Имена, запускаемые в этой области: вызовы `f(...)` и колбэки-аргументы
 * вызовов (`db.$transaction(async tx => …)`, `promise.then(() => …)`) — их
 * выполнит тот, кому их передали. В тела прочих вложенных функций обход не
 * идёт: чтобы зайти в них, нужно доказательство запуска.
 */
function collectInvokedNames(node: ts.Node, invoked: Set<string>): void {
  if (ts.isCallExpression(node)) {
    if (ts.isIdentifier(node.expression)) invoked.add(node.expression.text);
    for (const argument of node.arguments) {
      if (isFunctionLikeNode(argument)) collectInvokedNames(argument, invoked);
    }
  }
  ts.forEachChild(node, (child) => {
    if (isFunctionLikeNode(child)) return;
    collectInvokedNames(child, invoked);
  });
}

/**
 * Имена, вызываемые как функции (`f(...)`), в выполняемом коде узла — только по
 * AST. Во вложенную функцию обход заходит, лишь когда есть доказательство, что
 * её действительно запускают: (а) она передана аргументом вызова (колбэк) либо
 * (б) объявлена под именем, которое эта область вызывает
 * (`const check = () => …; check()`). Невызванная
 * `const unused = () => requireAuth(request)` доказательством защиты не
 * является: R80/Codex — «ложное защищён» пропускает незащищённый маршрут.
 */
function calledIdentifiers(node: ts.Node, calls: Set<string>): void {
  const invoked = new Set<string>();
  collectInvokedNames(node, invoked);
  scanExecutedCode(node, calls, invoked);
}

function scanExecutedCode(node: ts.Node, calls: Set<string>, invoked: Set<string>): void {
  if (ts.isCallExpression(node)) {
    if (ts.isIdentifier(node.expression)) calls.add(node.expression.text);
    // Колбэк вызова выполняется — заходим в его тело.
    for (const argument of node.arguments) {
      if (isFunctionLikeNode(argument)) calledIdentifiers(argument, calls);
    }
  }
  ts.forEachChild(node, (child) => {
    if (isFunctionLikeNode(child)) {
      // Вложенная функция: заходим, только если область её запускает по имени.
      const name = declaredFunctionName(child);
      if (name !== null && invoked.has(name)) calledIdentifiers(child, calls);
      return;
    }
    scanExecutedCode(child, calls, invoked);
  });
}

/**
 * Локальные функции, которые узел действительно запускает: вызванные по имени
 * (`helper()`) или переданные обёртке аргументом-идентификатором
 * (`withApi(handleGet)` — обёртка вызовет handleGet). Аргумент-идентификатор
 * считается запуском только у известных обёрток: `console.log(helper)` функцию
 * не выполняет, и тело helper защитой не становится.
 */
function invokedLocalNames(node: ts.Node, names: Set<string>): void {
  if (ts.isCallExpression(node)) {
    if (ts.isIdentifier(node.expression)) names.add(node.expression.text);
    if (ts.isIdentifier(node.expression) && WRAPPERS.includes(node.expression.text)) {
      for (const argument of node.arguments) {
        if (ts.isIdentifier(argument)) names.add(argument.text);
      }
    }
  }
  ts.forEachChild(node, (child) => invokedLocalNames(child, names));
}

/**
 * Вызовы, досягаемые из обработчика: прямо в его теле и в телах локальных
 * функций, которые он запускает, — на два уровня вглубь. Дальше не ходим:
 * цепочка вызовов ушла бы в половину файла и перестала что-либо доказывать.
 */
function reachableCalls(site: ts.Node, bodies: Map<string, ts.Node>): Set<string> {
  const calls = new Set<string>();
  const seen = new Set<string>();
  let level: ts.Node[] = [site];

  for (let depth = 0; depth < 3 && level.length > 0; depth++) {
    const next: ts.Node[] = [];
    for (const node of level) {
      calledIdentifiers(node, calls);
      const invoked = new Set<string>();
      invokedLocalNames(node, invoked);
      for (const name of invoked) {
        if (seen.has(name)) continue;
        seen.add(name);
        const body = bodies.get(name);
        if (body !== undefined) next.push(body);
      }
    }
    level = next;
  }

  return calls;
}

function collectRouteFacts(): RouteFacts[] {
  const apiDir = join(process.cwd(), 'src', 'app', 'api');
  return findRouteFiles(apiDir).map((rel) => {
    const source = readFileSync(join(process.cwd(), 'src', rel), 'utf8');
    // findRouteFiles отдаёт путь от src/ разделителем этой ОС; приводим к
    // единому виду, иначе списки исключений пришлось бы держать в двух.
    const path = rel.split(sep).slice(2).join('/');

    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const bodies = localFunctionBodies(sourceFile);

    const methods: RouteMethod[] = [];
    for (const method of HTTP_METHODS) {
      const site = handlerSite(sourceFile, bodies, method);
      if (site === null) continue;

      methods.push({
        key: path + '#' + method,
        path,
        method,
        declaration: site.text,
        calls: reachableCalls(site.node, bodies),
        wrapped: WRAPPERS.some((w) => site.text.includes('= ' + w + '(')),
      });
    }

    return { path, source, methods };
  });
}

/**
 * Проверки разбора на синтетических исходниках: настоящие маршруты обязаны
 * оставаться закрытыми, но убедиться, что разбор не путает вызов с упоминанием,
 * можно только на исходнике, где упоминание и есть. Тексты — строкой в тесте.
 */
describe('Контракт маршрутов — разбор тела обработчика', () => {
  function callsOf(source: string, method: string): Set<string> | null {
    const sf = ts.createSourceFile('synthetic.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const bodies = localFunctionBodies(sf);
    const site = handlerSite(sf, bodies, method);
    return site === null ? null : reachableCalls(site.node, bodies);
  }

  it('упоминание имени проверки без вызова защитой не считается', () => {
    const source = [
      "import { withApi } from '@/core/api-wrapper';",
      "import { requireAuth } from '@/lib/auth';",
      'async function isAuthorized(request: Request) {',
      '  const { error } = await requireAuth(request);',
      '  return error === null;',
      '}',
      'export const GET = withApi(async (request: Request) => {',
      '  const flags = { isAuthorized: false };',
      '  return Response.json(flags);',
      '});',
    ].join('\n');

    const calls = callsOf(source, 'GET');
    // GET лишь упоминает isAuthorized как поле объекта: тело помощника не
    // достраивается, requireAuth в него не протекает.
    expect(calls?.has('isAuthorized')).toBe(false);
    expect(calls?.has('requireAuth')).toBe(false);
  });

  it('проверка личности только в комментарии или строке защитой не считается', () => {
    const source = [
      "import { withApi } from '@/core/api-wrapper';",
      'export const GET = withApi(async (request: Request) => {',
      '  // requireAuth(request) — так было бы закрыто, но вызова нет',
      "  const note = 'requireAuth(request)';",
      '  return Response.json({ note });',
      '});',
    ].join('\n');

    expect(callsOf(source, 'GET')?.has('requireAuth')).toBe(false);
  });

  it('аннотация типа возврата с объектом не мешает найти тело', () => {
    const source = [
      "import { withApi } from '@/core/api-wrapper';",
      "import { requireAuth } from '@/lib/auth';",
      'async function loadUser(request: Request): Promise<{ user: unknown }> {',
      '  const { user, error } = await requireAuth(request);',
      '  if (error) throw error;',
      '  return { user };',
      '}',
      'export const GET = withApi(loadUser);',
    ].join('\n');

    // Раньше первая «{» из `Promise<{ user: unknown }>` принималась за начало
    // тела, и помощник с проверкой не достраивался.
    expect(callsOf(source, 'GET')?.has('requireAuth')).toBe(true);
  });

  it('невызванная вложенная функция с проверкой защитой не считается', () => {
    const source = [
      "import { withApi } from '@/core/api-wrapper';",
      "import { requireAuth } from '@/lib/auth';",
      'export const GET = withApi(async (request: Request) => {',
      '  const unused = () => requireAuth(request);',
      '  return Response.json({});',
      '});',
    ].join('\n');

    // Раньше обход заходил в тело `unused` и находил requireAuth, будто проверка
    // выполняется; на деле функцию никто не вызывает.
    expect(callsOf(source, 'GET')?.has('requireAuth')).toBe(false);
  });

  it('помощник, переданный console.log, а не обёртке, защитой не считается', () => {
    const source = [
      "import { withApi } from '@/core/api-wrapper';",
      "import { requireAuth } from '@/lib/auth';",
      'async function helper(request: Request) {',
      '  await requireAuth(request);',
      '}',
      'export const GET = withApi(async (request: Request) => {',
      '  console.log(helper);',
      '  return Response.json({});',
      '});',
    ].join('\n');

    // Раньше любой идентификатор-аргумент считался запуском: console.log(helper)
    // засчитывал проверку из тела helper.
    expect(callsOf(source, 'GET')?.has('requireAuth')).toBe(false);
  });

  it('проверка в колбэке вызова защитой считается', () => {
    const source = [
      "import { withApi } from '@/core/api-wrapper';",
      "import { requireAuth } from '@/lib/auth';",
      "declare const db: { $transaction: (fn: (tx: unknown) => Promise<void>) => Promise<void> };",
      'export const GET = withApi(async (request: Request) => {',
      '  await db.$transaction(async (tx) => {',
      '    await requireAuth(request);',
      '  });',
      '  return Response.json({});',
      '});',
    ].join('\n');

    // Колбэк выполняется вместе с вызовом — в его тело обход обязан заходить.
    expect(callsOf(source, 'GET')?.has('requireAuth')).toBe(true);
  });

  it('проверка в вызванной по имени локальной функции защитой считается', () => {
    const source = [
      "import { withApi } from '@/core/api-wrapper';",
      "import { requireAuth } from '@/lib/auth';",
      'export const GET = withApi(async (request: Request) => {',
      '  const check = () => requireAuth(request);',
      '  check();',
      '  return Response.json({});',
      '});',
    ].join('\n');

    expect(callsOf(source, 'GET')?.has('requireAuth')).toBe(true);
  });
});

describe('Контракт маршрутов — у каждого есть замок', () => {
  const routes = collectRouteFacts();
  const allMethods = routes.flatMap((r) => r.methods);

  it('обходит все маршруты и находит в каждом хотя бы один метод', () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.filter((r) => r.methods.length === 0).map((r) => r.path)).toEqual([]);
  });

  it('каждый метод либо проверяет личность, либо назван публичным с причиной', () => {
    const unguarded = allMethods
      .filter((m) => !AUTH_GATES.some((gate) => m.calls.has(gate)))
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
      return method !== undefined && AUTH_GATES.some((gate) => method.calls.has(gate));
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
