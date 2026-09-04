#!/usr/bin/env node
/**
 * Проверка боевого стенда сразу после выката.
 *
 * ЗАЧЕМ. Выкат считался успешным, если `docker compose up` не упал. Но контейнер
 * поднимается и со старым образом, и с непринятой миграцией, и с открытым
 * наружу API — по коду выхода этого не видно. Здесь проверяется то, что должно
 * быть верно ПОСЛЕ выката, и главное — что живёт именно тот коммит, который
 * выкатывали: `/api/health` отдаёт APP_VERSION, вшитый в образ при сборке.
 * Расхождение версии означает, что образ не пересобрался, и всё остальное
 * «зелёное» относится к прошлому релизу.
 *
 * БЕЗОПАСНОСТЬ. Только GET и только публичные адреса: скрипт ничего не пишет,
 * не логинится и не требует секретов. Его можно гонять сколько угодно.
 *
 * Использование:
 *   node scripts/prod-smoke.mjs --url https://orionpiling.ru --sha $(git rev-parse --short HEAD)
 *   node scripts/prod-smoke.mjs                # url по умолчанию, версию только показать
 *
 * Код выхода: 0 — всё сошлось, 1 — есть провал (годится как шаг деплоя).
 */

const args = process.argv.slice(2);
const argValue = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const baseUrl = (argValue('url', 'https://orionpiling.ru')).replace(/\/+$/, '');
const expectedSha = argValue('sha');
const timeoutMs = Number(argValue('timeout', '15000'));

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function get(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'cache-control': 'no-cache' },
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* не JSON — так и надо для страниц */ }
    return { status: response.status, text, json };
  } finally {
    clearTimeout(timer);
  }
}

console.log(`\nПроверка стенда ${baseUrl}\n`);

// --- 1. Живость и, главное, выкаченная версия. ---
let deployedVersion = null;
try {
  const health = await get('/api/health');
  record('health отвечает 200', health.status === 200, `HTTP ${health.status}`);
  deployedVersion = health.json?.version ?? null;
  record('health сообщает версию', Boolean(deployedVersion) && deployedVersion !== 'unknown',
    `version=${deployedVersion ?? 'нет поля'}`);

  if (expectedSha) {
    // Главная проверка выката: живёт ли тот коммит, который выкатывали.
    const match = deployedVersion === expectedSha;
    record('версия совпадает с выкаченным коммитом', match,
      match ? deployedVersion : `ожидали ${expectedSha}, живёт ${deployedVersion}`);
  } else {
    console.log(`  · ожидаемый коммит не задан (--sha), версию только показали: ${deployedVersion}`);
  }
} catch (error) {
  record('health отвечает', false, error.message);
}

// --- 2. Зависимости: база, кэш, хранилище, websocket. ---
try {
  const deep = await get('/api/health/deep');
  // По составляющим, а не по коду ответа: /api/health/deep отдаёт 503, когда
  // общий статус «unhealthy», а его на этом стенде делает единственный
  // постоянно лежащий websocket. Валить выкат из-за него нельзя, поэтому
  // судим по каждой зависимости отдельно.
  record('health/deep отвечает', deep.status === 200 || deep.status === 503, `HTTP ${deep.status}`);
  const components = deep.json?.components ?? {};
  for (const [name, state] of Object.entries(components)) {
    // websocket на этом стенде исторически down и не мешает работе — не валим
    // выкат из-за него, но показываем.
    if (name === 'websocket' && state !== 'ok') {
      console.log(`  · websocket: ${state} (известное состояние, выкат не валим)`);
      continue;
    }
    record(`зависимость ${name}`, state === 'ok', String(state));
  }
} catch (error) {
  record('health/deep отвечает', false, error.message);
}

// --- 3. Приложение отдаёт страницы. ---
for (const [label, path] of [['главная', '/'], ['страница входа', '/login']]) {
  try {
    const page = await get(path);
    record(`${label} отвечает`, page.status === 200 || page.status === 307 || page.status === 308,
      `HTTP ${page.status}`);
  } catch (error) {
    record(`${label} отвечает`, false, error.message);
  }
}

// --- 4. Закрытое остаётся закрытым. ---
// Без куки защищённый API обязан ответить отказом. Двойка здесь означала бы,
// что выкат открыл данные наружу, — это важнее любой другой проверки.
for (const path of ['/api/reports/all', '/api/equipment', '/api/users']) {
  try {
    const guarded = await get(path);
    const denied = guarded.status === 401 || guarded.status === 403;
    // 404 — это не «закрыто», а «маршрута нет»: значит проверка смотрит не туда
    // и молча всегда была бы зелёной. Говорим об этом прямо.
    if (guarded.status === 404) {
      record(`${path} закрыт без авторизации`, false, 'HTTP 404 — маршрута нет, поправьте адрес в проверке');
      continue;
    }
    record(`${path} закрыт без авторизации`, denied, `HTTP ${guarded.status}`);
  } catch (error) {
    record(`${path} закрыт без авторизации`, false, error.message);
  }
}

const failed = results.filter((item) => !item.ok);
console.log(`\nИтог: ${results.length - failed.length}/${results.length} проверок пройдено`);
if (failed.length > 0) {
  console.log('\nНе прошли:');
  for (const item of failed) console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
  console.log('\nВыкат считать неуспешным до разбора.\n');
  process.exit(1);
}
console.log('Стенд отвечает как ожидается.\n');
