# W131 — `console.log` в коде сервисов и модулей

Дата: 2026-10-08. Ветка: `hermes/q4-0926` (worktree `D:\PillingR\wt-night`). Метод: только чтение — ни один файл кода не изменён и не запускался.
Область: `src/services/`, `src/modules/`, `src/core/`, `src/lib/`. Задание: опись вызовов `console.log / warn / error / info / debug`. Исключены `__tests__`, `*.test.ts(x)` и `scripts/` по условию задачи.

## Итог

* Правило CLAUDE.md §3 «в сервисах `console.log` запрещён, вместо него `logger` из `@/lib/logger`» **соблюдено полностью**: в `src/services/`, `src/modules/`, `src/core/` — **0 вызовов `console.*`** (только одно упоминание в комментарии и моки в тестах).
* Всего в области найдено **8 вызовов `console.*`**: 3 в `src/lib/logger.ts` (это **реализация** логгера — `console` здесь цель, а не нарушение) и 5 в `src/lib/seed/equipment.seed.ts` (dev-сид, для него правило `no-console` выключено конфигом).
* Разбивка по каталогам: `src/services/` — 0, `src/modules/` — 0, `src/core/` — 0, `src/lib/` — 8.
* Severity: **критично — 0, важно — 0, мелочь — 5** (сид) + **информационно — 3** (сам логгер).
* Риск высокого уровня (ПДн / токены / хеши) — **отсутствует**. Ни один вызов не печатает пароль, PIN, токен, email или тело запроса. Логируются строковые константы, `eq.name` из локального массива и объект `error` от Prisma.
* Топ-5 по значимости: (1) `equipment.seed.ts:67` — объект `error` от Prisma в сырой stdout; (2–5) четыре `console.log` в том же сиде. Остального нет.

## Методика

Все команды из корня worktree. Номера строк — из фактических чтений файлов (`read_file`), не из грепа. Проверены обе формы вызова и возможные алиасы (`console[`, `window.console`, `globalThis.console`) — таких нет.

```bash
# 1. Вызовы console.(log|warn|error|info|debug) по каждому целевому каталогу

grep -rn 'console\.(log|warn|error|info|debug)' src/services
grep -rn 'console\.(log|warn|error|info|debug)' src/modules
grep -rn 'console\.(log|warn|error|info|debug)' src/core
grep -rn 'console\.(log|warn|error|info|debug)' src/lib

# 2. Широкий поиск любой формы (ловит console[...], globalThis.console, комментарии) по всему src
grep -rn 'console' src

# 3. Алиасы и косвенные формы
grep -rn 'console\[|globalThis\.console|window\.console|= console\b' src

# 4. Контекст правила no-console
grep -n 'no-console' eslint.config.mjs
```

Итоговый список (8 строк) подтверждён перекрёстно поиском `search_files` (`console.` и одиночный `console`) по четырём каталогам и по всему `src`. Оба сервисных упоминания, не являющиеся вызовом, вынесены в раздел «прочее».

## Находки

### Высокий / средний риск

Пусто. Ни одного вызова, печатающего персональные данные, токены, PIN или хеши, в области не найдено.

### Основная таблица (мелочь)

| # | severity | path:line | уровень | что выводится | риск | почему это важно / сценарий |
|---|----------|-----------|---------|----------------|------|------------------------------|
| 1 | мелочь | `src/lib/seed/equipment.seed.ts:7` | `console.log` | строковая константа `'🌱 Seeding equipment...'` | низкий | Персональных данных нет. Файл — dev-сид, но лежит в `src/` и потому формально попадает под правило о сервисах. |
| 2 | мелочь | `src/lib/seed/equipment.seed.ts:51` | `console.log` | строка + `eq.name` (название оборудования из локального массива строк 11–44) | низкий | Логируется имя из кода, не из БД и не пользовательский ввод. Утечки нет; вопрос только в дурном примере (копирование файла в «правильный» каталог размножит `console.log`). |
| 3 | мелочь | `src/lib/seed/equipment.seed.ts:64` | `console.log` | строка + `eq.name` | низкий | Как №2. |
| 4 | мелочь | `src/lib/seed/equipment.seed.ts:67` | `console.error` | строка + `eq.name` и **объект `error` целиком** (ошибка Prisma при `create`) | низкий | Самый «шумный» вызов: печатает весь объект ошибки Prisma. В dev-сиде риск невелик, но `error` от Prisma может содержать текст SQL/строки подключения — это серверная инфраструктурная деталь в сыром stdout, не ПДн. В проде сид выключен (`SKIP_SEED=1`), поэтому фактического воздействия нет. |
| 5 | мелочь | `src/lib/seed/equipment.seed.ts:71` | `console.log` | строковая константа `'✅ Equipment seeding complete'` | низкий | Как №1. |

### Отдельно: `src/lib/logger.ts` — намеренное использование (не нарушение)

Это **реализация** `logger` из `@/lib/logger` — тот самый объект, которым правило велит заменять `console`. Здесь `console` является целью, поэтому вызовы легальны и правке не подлежат.

| # | severity | path:line | уровень | что выводится | риск |
|---|----------|-----------|---------|----------------|------|
| 6 | информация | `src/lib/logger.ts:71` | `console.error` | сериализованная JSON-строка (сформирована `formatEntry`, строка 67) | низкий |
| 7 | информация | `src/lib/logger.ts:74` | `console.warn` | сериализованная JSON-строка | низкий |
| 8 | информация | `src/lib/logger.ts:78` | `console.log` | сериализованная JSON-строка; строкой 77 закрыт `// eslint-disable-next-line no-console`, т.к. `log` не входит в `allow` из `eslint.config.mjs:43` | низкий |

### Прочие упоминания `console` (вызова нет)

* `src/services/auth/session-service.ts:145` — комментарий «…avoid log forwarding into the browser console…». Не вызов.
* `src/core/outbox/dead-letter-queue.ts:108` — комментарий «// Last resort — log to console», а строкой ниже (109) вызывается `logger.error(...)`. Комментарий вводит в заблуждение (запись идёт структурным JSON, а не в сырой stdout), но это не нарушение.
* `src/core/__tests__/api-wrapper.test.ts:99,241,255,281` — `vi.spyOn(console, 'error')`, это мок в тестах, исключены по условию.

### Контекст правила

* `eslint.config.mjs:43` — `"no-console": ["warn", { "allow": ["warn", "error"] }]`: `console.warn` и `console.error` разрешены **везде** без предупреждения; строгое правило действует только на `console.log/info/debug`.
* `eslint.config.mjs:75` — для `src/lib/seed/**` `no-console` выключен полностью, поэтому 5 вызовов сида линтер не подсветит.
* `logger.error` (строка 95 `src/lib/logger.ts`) пробрасывает только `error.message` и `error.stack` для `Error`-объектов — то есть даже если бы сид использовал `logger.error(..., error)`, в лог попал бы не весь объект Prisma, а message/stack.

## Не проверено

1. **`npm run lint` не выполнялся** — задача read-only. Вывод «сид правило `no-console` не подсвечивает» получен чтением `eslint.config.mjs:75`, а не прогоном линтера.
2. **Динамические/косвенные вызовы `console`** (через вычисленную строку, `new Function`, транспиляцию, переопределение `console`) текстовым поиском не обнаруживаются. Полностью исключить их нельзя; в области таких конструкций не найдено.
3. **Реальные значения объекта `error` от Prisma** при сбое сида не наблюдались (БД не открывалась, сид не запускался). Оценка «может содержать текст SQL/строку подключения» основана на общем поведении Prisma, а не на фактическом выводе.
4. **`logger` не пишет `tenantId`.** Интерфейс `LogEntry` (`src/lib/logger.ts:17-29`) содержит `userId` и `siteId`, но поля `tenantId` нет. Это относится к контексту «лог без контекста тенанта» из задания, но проверкой `console.*` не охватывается и в таблицу находок не вынесено — вынесено как наблюдение.
5. **`src/generated/**`, `scripts/`, `e2e/`, `tests/`** — вне области по условию задачи (и/или в игноре ESLint `eslint.config.mjs:141`), не считались.
