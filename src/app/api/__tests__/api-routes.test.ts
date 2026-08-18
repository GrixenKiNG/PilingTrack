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
    const { AUTH_RATE_LIMIT, PIN_RATE_LIMIT } = await import('@/lib/rate-limiter');

    expect(AUTH_RATE_LIMIT.maxAttempts).toBe(5);
    expect(PIN_RATE_LIMIT.maxAttempts).toBe(3);
    expect(PIN_RATE_LIMIT.maxAttempts).toBeLessThan(AUTH_RATE_LIMIT.maxAttempts);
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
// DELETE не был закрыт ничем, и файл всё равно считался закрытым.
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
  'authenticateDevice',              // ключ устройства в заголовке X-Device-Key
  'ALERTMANAGER_WEBHOOK_TOKEN',      // общий секрет, сверяется constantTimeEquals
];

/** Всё, что закрывает межсайтовый вызов с чужой страницы. */
const CSRF_GATES = ['withMutation', 'withReadinessCommand', 'withCsrf'];

/** Всё, что ловит исключение до того, как оно уйдёт наружу стеком. */
const WRAPPERS = ['withApi', 'withMutation', 'withReadinessCommand'];

/**
 * Маршруты без проверки личности — и почему это правильно.
 * Ключ — путь от src/app/api, значение — причина.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  'auth/login/route.ts': 'выдаёт сессию — требовать сессию здесь было бы замкнутым кругом',
  'auth/pin/route.ts': 'то же самое для входа по ПИН-коду',
  'auth/refresh/route.ts': 'учётные данные здесь — сама refresh-кука, её проверяет обработчик',
  'health/route.ts': 'проба живости для балансировщика; отдаёт только статус и версию',
  'health/deep/route.ts': 'проба зависимостей; поднимается изнутри контура, наружу закрыта Caddy',
  'liveness/route.ts': 'проба живости контейнера',
  'ready/route.ts': 'проба готовности к приёму трафика',
  'readiness/route.ts': 'устаревший синоним /api/ready, отдаёт заголовок Sunset',
  'route.ts': 'корень /api — отдаёт версию, данных не касается',
  'orion/lead/route.ts': 'форма заявки публичного сайта; закрыта иначе — лимит по IP, ловушка для ботов, экранирование',
};

/**
 * Изменяющие данные методы без CSRF — и почему это правильно. Ключ вида
 * `путь#МЕТОД`. Все до одного — точки входа, куда браузер с чужой страницы не
 * дотянется: либо сессии ещё нет, либо вызывающий вообще не браузер.
 */
const CSRF_EXEMPT_METHODS: Record<string, string> = {
  'auth/login/route.ts#POST': 'сессии ещё нет — угонять нечего',
  'auth/pin/route.ts#POST': 'то же самое для входа по ПИН-коду',
  'orion/lead/route.ts#POST': 'публичная форма без сессии; защита — лимит по IP и ловушка для ботов',
  'alerts/webhook/route.ts#POST': 'вызывает Alertmanager по общему секрету, не браузер',
  'telemetry/ingest/route.ts#POST': 'вызывает контроллер по ключу устройства, не браузер',
  'telemetry/ingest/route.ts#PATCH': 'то же самое — настройка порогов на устройстве',
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

  it('каждый маршрут либо проверяет личность, либо назван публичным с причиной', () => {
    const unguarded = routes
      .filter((r) => !AUTH_GATES.some((gate) => r.source.includes(gate)))
      .filter((r) => !(r.path in PUBLIC_ROUTES))
      .map((r) => r.path);

    expect(unguarded).toEqual([]);
  });

  it('каждый изменяющий данные метод закрыт от межсайтового вызова', () => {
    const unguarded = allMethods
      .filter((m) => STATE_CHANGING.includes(m.method))
      .filter((m) => !CSRF_GATES.some((gate) => m.declaration.includes(gate)))
      .filter((m) => !(m.key in CSRF_EXEMPT_METHODS))
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
  const knownPaths = new Set(routes.map((r) => r.path));
  const byKey = new Map(routes.flatMap((r) => r.methods).map((m) => [m.key, m]));

  it('в списке публичных нет строк про несуществующие файлы', () => {
    expect(Object.keys(PUBLIC_ROUTES).filter((p) => !knownPaths.has(p))).toEqual([]);
  });

  it.each([
    ['без CSRF', CSRF_EXEMPT_METHODS],
    ['без обёртки', NO_WRAPPER_METHODS],
  ])('в списке %s нет строк про несуществующие методы', (_label, list) => {
    expect(Object.keys(list).filter((k) => !byKey.has(k))).toEqual([]);
  });

  it('в списке публичных нет маршрутов, куда защиту уже вернули', () => {
    const stale = Object.keys(PUBLIC_ROUTES).filter((p) => {
      const route = routes.find((r) => r.path === p);
      return route !== undefined && AUTH_GATES.some((gate) => route.source.includes(gate));
    });

    expect(stale).toEqual([]);
  });

  it('в списке без CSRF нет методов, куда защиту уже вернули', () => {
    const stale = Object.keys(CSRF_EXEMPT_METHODS).filter((k) => {
      const method = byKey.get(k);
      return method !== undefined && CSRF_GATES.some((gate) => method.declaration.includes(gate));
    });

    expect(stale).toEqual([]);
  });

  it('в списке без обёртки нет методов, которые уже обёрнуты', () => {
    expect(Object.keys(NO_WRAPPER_METHODS).filter((k) => byKey.get(k)?.wrapped === true)).toEqual([]);
  });

  it('каждая причина в списках исключений написана, а не оставлена пустой', () => {
    const empty = [PUBLIC_ROUTES, CSRF_EXEMPT_METHODS, NO_WRAPPER_METHODS]
      .flatMap((list) => Object.entries(list))
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([key]) => key);

    expect(empty).toEqual([]);
  });
});
