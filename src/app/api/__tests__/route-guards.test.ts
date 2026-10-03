import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import * as ts from 'typescript';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const MUTATION_WRAPPERS = ['withMutation', 'withReadinessCommand', 'withOperatorV3Command'];
const CALLBACK_WRAPPERS = ['withApi', ...MUTATION_WRAPPERS];

interface HandlerFacts { calls: Set<string>; wrapper: string | null }
interface ParsedSource {
  sf: ts.SourceFile;
  definitions: Map<string, ts.Node>;
  exports: Map<string, string>;
  imports: Map<string, string>;
}

function exported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
}

function parse(source: string): ParsedSource {
  const sf = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const definitions = new Map<string, ts.Node>();
  const exports = new Map<string, string>();
  const imports = new Map<string, string>();
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements) imports.set(binding.name.text, binding.propertyName?.text ?? binding.name.text);
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const binding of statement.exportClause.elements) {
        exports.set(binding.name.text, statement.moduleSpecifier ? `external:${binding.name.text}` : binding.propertyName?.text ?? binding.name.text);
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      definitions.set(statement.name.text, statement);
      if (exported(statement)) exports.set(statement.name.text, statement.name.text);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        definitions.set(declaration.name.text, declaration.initializer);
        if (exported(statement)) exports.set(declaration.name.text, declaration.name.text);
      }
    }
  }
  return { sf, definitions, exports, imports };
}

function callable(node: ts.Node): node is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);
}

function resolve(node: ts.Node, definitions: Map<string, ts.Node>, seen = new Set<string>()): ts.Node {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return resolve(node.expression, definitions, seen);
  }
  if (ts.isIdentifier(node) && definitions.has(node.text) && !seen.has(node.text)) {
    seen.add(node.text);
    const definition = definitions.get(node.text);
    if (definition) return resolve(definition, definitions, seen);
  }
  return node;
}

function nameOf(node: ts.Node, imports: Map<string, string>): string | null {
  if (ts.isIdentifier(node)) return imports.get(node.text) ?? node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const owner = nameOf(node.expression, imports);
    return owner ? `${owner}.${node.name.text}` : null;
  }
  return null;
}

// Разбираются только вызываемые локальные функции и колбэки. Соседний
// HTTP-метод, невызванная функция, строка или комментарий защиту не дают.
function inspect(parsed: ParsedSource, root: ts.Node): HandlerFacts {
  const calls = new Set<string>();
  const visited = new Set<ts.Node>();
  function execute(node: ts.Node, definitions: Map<string, ts.Node>): void {
    const resolved = resolve(node, definitions);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    if (callable(resolved)) {
      if (resolved.body) scan(resolved.body, definitions);
    } else scan(resolved, definitions);
  }
  function scan(node: ts.Node, outer: Map<string, ts.Node>): void {
    let definitions = outer;
    if (ts.isBlock(node)) {
      definitions = new Map(outer);
      for (const statement of node.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name) definitions.set(statement.name.text, statement);
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name) && declaration.initializer) definitions.set(declaration.name.text, declaration.initializer);
          }
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const called = nameOf(node.expression, parsed.imports);
      if (called) calls.add(called);
      if (ts.isIdentifier(node.expression) && definitions.has(node.expression.text)) execute(node.expression, definitions);
      for (const argument of node.arguments) {
        if (callable(argument) || (ts.isIdentifier(argument) && called && CALLBACK_WRAPPERS.includes(called))) execute(argument, definitions);
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const property = nameOf(node, parsed.imports);
      if (property?.startsWith('process.env.')) calls.add(property);
    }
    ts.forEachChild(node, child => {
      if (callable(child) || ts.isMethodDeclaration(child) || ts.isGetAccessor(child) || ts.isSetAccessor(child) || ts.isClassDeclaration(child) || ts.isClassExpression(child)) return;
      scan(child, definitions);
    });
  }
  const resolved = resolve(root, parsed.definitions);
  const wrapper = ts.isCallExpression(resolved) ? nameOf(resolved.expression, parsed.imports) : null;
  execute(resolved, parsed.definitions);
  return { calls, wrapper };
}

function handlers(source: string): Map<string, HandlerFacts> {
  const parsed = parse(source);
  const result = new Map<string, HandlerFacts>();
  for (const method of METHODS) {
    const local = parsed.exports.get(method);
    if (!local) continue;
    const definition = parsed.definitions.get(local);
    // Неразрешённый реэкспорт вызывает ошибку проверки, а не исчезает из обхода.
    result.set(method, definition ? inspect(parsed, definition) : { calls: new Set(), wrapper: null });
  }
  return result;
}

interface Exception { reason: string; required: string[] }
const MUTATION_EXCEPTIONS: Record<string, Exception> = {
  'auth/login/route.ts#POST': {
    reason: 'Вход до сессии; authenticateUserByEmailPassword ограничивает IP и аккаунт.',
    required: ['authenticateUserByEmailPassword', 'getRateLimitIdentifier'],
  },
  'orion/lead/route.ts#POST': {
    reason: 'Публичная форма без сессии; собственный лимит запросов по IP.',
    required: ['rateLimiter.check', 'getRateLimitIdentifier'],
  },
  'alerts/webhook/route.ts#POST': {
    reason: 'Alertmanager использует общий секрет с постоянным временем сравнения, без сессии браузера.',
    required: ['isAuthorized', 'constantTimeEquals', 'timingSafeEqual', 'process.env.ALERTMANAGER_WEBHOOK_TOKEN'],
  },
  'telemetry/ingest/route.ts#POST': {
    reason: 'Контроллер передаёт ключ устройства; отдельный лимит по IP.',
    required: ['authenticateDeviceByKey', 'rateLimiter.check'],
  },
  'telemetry/ingest/route.ts#PATCH': {
    reason: 'Настройка контроллера по ключу устройства; отдельный лимит по IP.',
    required: ['authenticateDeviceByKey', 'rateLimiter.check'],
  },
  'telemetry/route.ts#POST': {
    reason: 'Ручная комбинация CSRF, лимита телеметрии и проверки сессии вместо общей обёртки.',
    required: ['withCsrf', 'rateLimiter.check', 'requireAuth'],
  },
  'telemetry/batch/route.ts#POST': {
    reason: 'Пакетная телеметрия проверяет CSRF, свой лимит запросов и сессию.',
    required: ['withCsrf', 'rateLimiter.check', 'requireAuth'],
  },
};
const PUBLIC_GETS: Record<string, string> = {
  'health/route.ts#GET': 'Публичная проба живости: статус и версия приложения.',
  'health/deep/route.ts#GET': 'Публичная проба зависимостей: только безопасные статусы.',
  'liveness/route.ts#GET': 'Публичная проба живости контейнера для оркестратора.',
  'ready/route.ts#GET': 'Публичная проба готовности инфраструктуры к запросам.',
  'readiness/route.ts#GET': 'Устаревший публичный синоним ready с заголовком Sunset.',
  'route.ts#GET': 'Корень API публикует сведения о версии без бизнес-данных.',
  'telemetry/ingest/route.ts#GET': 'Публичная справка для контроллера, без данных оборудования.',
};
const AUTH_CALLS = ['requireAuth', 'resolveReadinessRequestContext', 'resolveOperatorV3RequestContext'];

function violations(path: string, methods: Map<string, HandlerFacts>): string[] {
  const problems: string[] = [];
  for (const [method, facts] of methods) {
    const key = `${path}#${method}`;
    if (method === 'GET') {
      if (!AUTH_CALLS.some(call => facts.calls.has(call)) && !PUBLIC_GETS[key]) {
        problems.push(`маршрут ${key}: GET без проверки сессии — добавь requireAuth или публичное исключение с причиной`);
      }
    } else if (!facts.wrapper || !MUTATION_WRAPPERS.includes(facts.wrapper)) {
      const exception = MUTATION_EXCEPTIONS[key];
      if (!exception) {
        problems.push(`маршрут ${key}: мутация без withMutation — оберни или добавь в исключения с причиной`);
      } else {
        for (const required of exception.required) {
          if (!facts.calls.has(required)) problems.push(`маршрут ${key}: исключение потеряло собственную защиту ${required}`);
        }
      }
    }
  }
  return problems;
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = join(dir, entry.name);
    return entry.isDirectory() ? routeFiles(file) : entry.name === 'route.ts' ? [file] : [];
  });
}

const apiDir = join(process.cwd(), 'src/app/api');
const inventory = new Map(routeFiles(apiDir).map(file => [relative(apiDir, file).split(sep).join('/'), handlers(readFileSync(file, 'utf8'))]));

function functionFacts(file: string, name: string): HandlerFacts {
  const parsed = parse(readFileSync(join(process.cwd(), file), 'utf8'));
  const definition = parsed.definitions.get(name);
  expect(definition, `${file}: функция ${name} должна существовать`).toBeDefined();
  if (!definition) throw new Error(`${file}: функция ${name} не найдена`);
  return inspect(parsed, definition);
}

describe('Сторож маршрутов API', () => {
  it('инвентаризация не пропускает файлы без распознанных обработчиков', () => {
    expect(inventory.size).toBeGreaterThan(100);
    expect([...inventory].filter(([, methods]) => methods.size === 0).map(([path]) => path)).toEqual([]);
  });

  it('каждый GET и каждый изменяющий метод имеет свою защиту', () => {
    expect([...inventory].flatMap(([path, methods]) => violations(path, methods))).toEqual([]);
  });

  it('исключения существуют, имеют причину и не скрывают возвращённую обёртку', () => {
    for (const [key, exception] of Object.entries(MUTATION_EXCEPTIONS)) {
      const [path, method] = key.split('#');
      const facts = inventory.get(path)?.get(method);
      expect(facts, key).toBeDefined();
      expect(exception.reason.trim().length, key).toBeGreaterThan(20);
      expect(facts?.wrapper && MUTATION_WRAPPERS.includes(facts.wrapper), key).toBeFalsy();
    }
    for (const [key, reason] of Object.entries(PUBLIC_GETS)) {
      const [path, method] = key.split('#');
      const facts = inventory.get(path)?.get(method);
      expect(facts, key).toBeDefined();
      expect(reason.length, key).toBeGreaterThan(20);
      expect(AUTH_CALLS.some(call => facts?.calls.has(call)), key).toBe(false);
    }
  });

  it('косвенная обёртка readiness действительно вызывает withMutation', () => {
    const facts = functionFacts('src/app/api/readiness/_shared/route-adapter.ts', 'withReadinessCommand');
    expect(facts.calls.has('withMutation')).toBe(true);
    expect(facts.calls.has('resolveReadinessRequestContext')).toBe(true);
    expect(functionFacts('src/app/api/readiness/_shared/request-context.ts', 'resolveReadinessRequestContext').calls.has('requireAuth')).toBe(true);
  });

  it('любая используемая обёртка operator-v3 действительно вызывает withMutation', () => {
    // Сейчас обёртки operator-v3 нет. При её появлении нужно проверить
    // реализацию: историческое имя само по себе защиту не доказывает.
    for (const [path, methods] of inventory) {
      if (![...methods.values()].some(facts => facts.wrapper === 'withOperatorV3Command')) continue;
      const parsed = parse(readFileSync(join(apiDir, path), 'utf8'));
      const definition = parsed.definitions.get('withOperatorV3Command');
      expect(definition, `${path}: проверь реализацию импортированной withOperatorV3Command перед допуском`).toBeDefined();
      if (!definition) throw new Error('Реализация withOperatorV3Command не проверена');
      expect(inspect(parsed, definition).calls.has('withMutation')).toBe(true);
    }
  });

  it('исключение логина опирается на реальный лимитер сервиса', () => {
    expect(functionFacts('src/services/auth/auth-service.ts', 'authenticateUserByEmailPassword').calls.has('rateLimiter.check')).toBe(true);
  });
});

describe('Сторож маршрутов — регрессии статического разбора', () => {
  it('находит export { handler as POST } и видит незащищённую мутацию', () => {
    const methods = handlers('const handler = async () => Response.json({}); export { handler as POST };');
    expect([...methods.keys()]).toEqual(['POST']);
    expect(violations('new/route.ts', methods)).toEqual(['маршрут new/route.ts#POST: мутация без withMutation — оберни или добавь в исключения с причиной']);
  });

  it('разрешает export function и const-псевдонимы методов', () => {
    const methods = handlers('export const POST = withMutation(async () => {}); export const PATCH = POST; export async function GET() { await requireAuth(); }');
    expect(methods.get('PATCH')?.wrapper).toBe('withMutation');
    expect(violations('new/route.ts', methods)).toEqual([]);
  });

  it('распознаёт псевдонимы импортов и локальные callbacks', () => {
    const methods = handlers("import { withMutation as mutate, requireAuth as auth } from './guards'; async function handleGet() { await auth(); } const handler = mutate(async () => {}); export { handler as POST }; export const GET = withApi(handleGet);");
    expect(methods.get('POST')?.wrapper).toBe('withMutation');
    expect(methods.get('GET')?.calls.has('requireAuth')).toBe(true);
    expect(violations('new/route.ts', methods)).toEqual([]);
  });

  it('комментарии, строки и проверка соседнего метода не закрывают мутацию', () => {
    const source = "export const GET = withApi(async () => requireAuth()); export async function POST() { /* withMutation() */ return 'rateLimiter.check()'; }";
    expect(violations('new/route.ts', handlers(source))).toHaveLength(1);
    expect(handlers(source).get('POST')?.calls.size).toBe(0);
  });

  it('не принимает вложенный вызов withMutation за обёртку метода', () => {
    expect(violations('new/route.ts', handlers('export async function POST() { const unused = withMutation(async () => {}); return unused; }'))).toHaveLength(1);
  });

  it('невызванные локальные функции и методы объекта не дают проверку сессии', () => {
    const source = 'async function check() { await requireAuth(); } export const GET = withApi(async () => { const unused = () => check(); const object = { guard() { requireAuth(); } }; return object; });';
    expect(handlers(source).get('GET')?.calls.has('requireAuth')).toBe(false);
    expect(violations('new/route.ts', handlers(source))).toHaveLength(1);
  });

  it('ручное исключение не заимствует лимит или CSRF у соседнего метода', () => {
    const source = 'export const GET = withApi(async () => { rateLimiter.check(); withCsrf(); requireAuth(); }); export const POST = withApi(async () => requireAuth());';
    expect(violations('telemetry/route.ts', handlers(source))).toEqual([
      'маршрут telemetry/route.ts#POST: исключение потеряло собственную защиту withCsrf',
      'маршрут telemetry/route.ts#POST: исключение потеряло собственную защиту rateLimiter.check',
    ]);
  });

  it('не скрывает неразрешённый реэкспорт и циклический псевдоним', () => {
    expect(violations('new/route.ts', handlers("export { handler as POST } from './other';"))).toHaveLength(1);
    expect(violations('new/route.ts', handlers('const handler = POST; export const POST = handler;'))).toHaveLength(1);
  });
});
