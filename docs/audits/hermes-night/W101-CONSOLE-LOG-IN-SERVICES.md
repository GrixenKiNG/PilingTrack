# W101 — `console.log` в коде, где правило его запрещает

Дата: 2026-10-08. Ветка: `hermes/q4-0926` (worktree `D:\PillingR\wt-night`). Метод: только чтение, ничего не менялось и не запускалось.
Область: `src/**`, кроме `node_modules`, тестов (`**/__tests__/**`, `*.test.ts(x)`, `*.spec.*`) и сгенерированного клиента Prisma (`src/generated/**`).
Искались вызовы `console.log` / `console.info` / `console.debug` / `console.warn` / `console.error`.

## Итог

* Всего вызовов `console.*` (log/info/debug/warn/error) в области — **10**. Из них в папках, где правило прямо запрещает `console` (`src/services/`, `src/modules/`, `src/core/`) — **0**.
* Правило CLAUDE.md §3 «в сервисах `console.log` не используется, вместо него `logger` из `@/lib/logger`» **соблюдено**: в `src/services/`, `src/modules/`, `src/core/` и в `src/app/api/` нет ни одного вызова `console.*`. Таблица нарушений по этим папкам пуста.
* Разбивка по папкам (задание §2): `src/services/` — 0, `src/modules/` — 0, `src/core/` — 0, `src/lib/` — 8, `src/app/api/` — 0, `src/components/` — 2, остальное (`src/workers/`, корневые файлы `src/*.ts`) — 0.
* Единственные 10 вызовов: 3 в `src/lib/logger.ts` (это **реализация** логгера — `console` тут легален), 5 в `src/lib/seed/equipment.seed.ts` (dev-сид, для него `no-console` выключен конфигом) и 2 в клиентских компонентах (`console.error`).
* Ни один вызов не логирует пароль/PIN/токен/персональные данные.
* Самый важный пункт — №1: `src/components/piling/admin-reports/use-report-history.ts:29` пишет ошибку загрузки истории отчёта только в консоль браузера (в Sentry не уходит), тогда как серверный край проекта в Sentry пишет. Остальное — норма или послабление конфига.
* Важная деталь: `eslint.config.mjs:43` разрешает `console.warn` и `console.error` **везде** (`allow: ["warn","error"]`). То есть оба клиентских `console.error` не дают даже lint-предупреждения — расхождение с правилом CLAUDE.md ловится только глазами. Строгий `no-console` (для `console.log/info/debug`) при этом снят ещё в `src/lib/seed/**` и `src/workers/**` (`eslint.config.mjs:74-75,82`) и в `src/generated/**` (игнор, `eslint.config.mjs:141`).

## Методика

Все команды из корня worktree. Номера строк — из фактических чтений файлов (`read_file`), не из грепа.

```bash
# 1. Все вызовы console.(log|info|debug|warn|error) в src — сколько и где
grep -rn 'console\.(log|info|debug|warn|error)' src \
  | grep -v node_modules | grep -v __tests__ | grep -v '\.test\.' | grep -v '\.spec\.'

# 2. Более широкое «любое упоминание console» — чтобы поймать console[level],
#    window.console, globalThis.console и упоминания в комментариях
grep -rn 'console' src | grep -v node_modules

# 3. Разбивка по папкам (вызовы, без комментариев-упоминаний)
for d in services modules core lib app components workers; do
  grep -rn 'console\.' src/$d --include=*.ts --include=*.tsx \
    | grep -v __tests__ | grep -v '\.test\.' | wc -l
done

# 4. Кто именно и на какой строке (итоговый список 10 строк)
grep -rn 'console\.' src --include=*.ts --include=*.tsx --include=*.js --include=*.mjs \
  | grep -v 'src/generated/' | grep -v __tests__ | grep -v '\.test\.' | grep -v '\.spec\.'

# 5. Контекст правила: как настроен no-console
grep -n 'no-console\|console' eslint.config.mjs
```

Отдельно проверено (положительный результат): `grep -rn 'console' src` поймал бы любую форму (в т.ч. `console['log']`), и в области не осталось ни одной формы, кроме перечисленных ниже и упоминаний в комментариях. Количество файлов, просмотренных грепом: ~1345 `.ts/.tsx` под `src` (без `node_modules`).

## Находки

В папках `src/services/`, `src/modules/`, `src/core/` нарушений нет — таблица по условию задания здесь пуста. Ниже — всё, что вообще нашлось в `src` (10 вызовов), с оценкой, является ли это нарушением.

| # | severity | path:line | Проблема | Сценарий / почему это важно | Предлагаемое исправление |
|---|----------|-----------|----------|------------------------------|--------------------------|
| 1 | мелочь | `src/components/piling/admin-reports/use-report-history.ts:29` | `console.error('useReportHistory failed', { reportId, err })` в клиентском хуке — вместо логгера/Sentry. Логируется `reportId` и `Error`, ПДн нет. | Ошибка загрузки истории отчёта видна только в консоли браузера пользователя; в Sentry не попадает, значит для остальных она невидима. Post-mortem «почему история не грузится» упирается в пользователя. Состояние `error: true` при этом наружу отдаётся (строка 30) и UI его обрабатывает. | Либо убрать (UI уже показывает ошибку), либо отправлять в `@sentry/nextjs` (как это делается на сервере, `src/core/api-wrapper.ts`), как в соседнем компоненте №2. |
| 2 | мелочь | `src/components/piling/to/readiness/boundaries/active-view-error-boundary.tsx:29` | `console.error('Tech readiness active view failed', error, info.componentStack)` в `componentDidCatch`, строкой ниже уже идёт `Sentry.captureException(error, { extra: { componentStack } })` (строка 30). | Дублирование: React и сам печатает ошибку границы в консоль, а рядом та же ошибка уже уходит в Sentry. Строка не несёт ничего сверх строки 30 — просто шум. | Удалить строку 29; `componentStack` уже передаётся в Sentry на строке 30. |
| 3 | информация (не нарушение) | `src/lib/logger.ts:71,74,78` | `console.error(warn/log)` внутри **реализации** логгера — единственное легальное место `console` в `src`. На строке 77 стоит `// eslint-disable-next-line no-console`, потому что `console.log` не входит в `allow`. | Это и есть тот самый `logger` из `@/lib/logger`, вместо которого правило велит писать `console`. Здесь `console` — цель, а не нарушение. | Оставить как есть. |
| 4 | информация (послабление конфига) | `src/lib/seed/equipment.seed.ts:7,51,64,67,71` | 5 вызовов `console.log/error` в `src` — крупнейший кусок «console вместо logger» по строкам. Логируются имена оборудования из локального массива (`eq.name`) и `error` от Prisma; ПДн нет. | Формально это runtime-код в `src`, но фактически dev-сид: `eslint.config.mjs:75` выключает `no-console` для всего `src/lib/seed/**`. Риск — не секреты, а дурной пример: скопированный в «правильный» каталог файл размножит `console.log`. | Не нарушение правила о сервисах. При желании — перенести файл в `scripts/` (там тоже `no-console` off), тогда «console в `src`» останется ровно в реализации логгера. Трогать не обязательно. |
| — | — | `src/core/outbox/dead-letter-queue.ts:108` | Комментарий `// Last resort — log to console`, а строкой ниже (109) вызывается `logger.error(...)`. Вызова `console` нет. | Обманутый читатель при разборе инцидента ищет вывод в сыром stdout, хотя запись идёт структурным JSON через логгер. Не `console`, но вводит в заблуждение. | Заменить комментарий на «последняя попытка — пишем в структурный лог». |
| — | — | `src/services/auth/session-service.ts:145` | Комментарий «…avoid log forwarding into the browser console…». Вызова `console` нет. | Просто упоминание; нарушением не является, приведено для полноты картины (почему это единственное «console» в `src/services/`). | Не требуется. |

Сводка по severity для области `src/` целиком: **критично — 0, важно — 0, мелочь — 2** (№1, №2), плюс 2 информационные пометки (не нарушения) и упоминания в комментариях.
По папкам, где правило запрещает `console` (`src/services/`, `src/modules/`, `src/core/` — плюс `src/app/api/`): **нарушений 0, таблица пуста**.

## Не проверено

1. **`npm run lint` не выполнялся** (задача read-only). Утверждение «оба `console.error` не дают lint-предупреждения» получено чтением `eslint.config.mjs:43` (`allow: ["warn","error"]`), а не запуском линтера.
2. **Динамические/косвенные вызовы `console`** (через `globalThis[...]`, вычисленную строку, `new Function`, транспиляцию) текстовым поиском не обнаруживаются. Полностью исключить их нельзя.
3. **`src/generated/**`** (сгенерированный клиент Prisma) не входит в область и в таблицу не вынесен: там есть `console.*` (≈22 вызова в `.js`-файлах runtime-движка, напр. `src/generated/postgres-client/runtime/client.js`), но это сгенерированный вендорный код, каталог в игноре ESLint (`eslint.config.mjs:141`) и правилом проекта не управляется.
4. **`scripts/`, `e2e/`, `tests/`, `prisma/`** — вне области по условию задачи; там `no-console` выключен конфигом (`eslint.config.mjs:67-82`) и `console.*` почти наверняка есть (первые же совпадения — `scripts/*.ts`). Не считал.
5. **Тесты (`__tests__`, `*.test.tsx`)** исключены; в них `console` встречается как `vi.spyOn(console, 'error')` (напр. `src/core/__tests__/api-wrapper.test.ts:99`) — это мок, а не логирование.
