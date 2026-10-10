# AU49-S5-DEPENDENCIES: Зависимости — прямые пакеты, версии, достижимость уязвимостей

Версия (git rev-parse HEAD): `4b9b6bb09677149491fcad168ebcad421c610e08`
Рабочая папка: `D:\PillingR\wt-night` (worktree, ветка `hermes/q4-0926`).
Режим: только чтение кода; создан один файл — этот отчёт. Установок и обращений к сети не было.

## Итог

Найдено 10 замечаний: критично — 0, важно — 5, мелочь — 5.
Всего 49 прямых `dependencies`, 22 `devDependencies`, 4 `overrides`; в `package-lock.json` 1043 записи (lockfileVersion 3).
Ключевое: пять прямых пакетов `@opentelemetry/*` не импортируются нигде в проекте; два из них (`exporter-trace-otlp-http`, `semantic-conventions`) вообще не являются транзитивной зависимостью Sentry — их установку никто не требует.
Мёртвые runtime-зависимости: `next-themes`, `pino`, `cookie` — ноль обращений во всём `src/`; `tailwindcss-animate` подключён только из, по-видимому, нечитаемого конфига `tailwind.config.ts` (Tailwind v4, CSS-first — директивы `@config` нет).
`tsx` в `dependencies` — НЕ ошибка: он нужен прод-воркерам (`Dockerfile.workers:99`), иначе `npm prune --omit=dev` его бы снёс.
Результат `npm audit` — НЕ ПРОВЕРЕНО: готового файла в репозитории нет, сеть недоступна (запрещена условием). Подозрение на «dev-зависимости в dependencies» подтверждено для `dotenv` и `@prisma/client` (оба используются только скриптами/тестами).

## Методика

- Прочитаны: `package.json` (49/22/4), `package-lock.json` (структура + выборочные узлы), `tailwind.config.ts`, `components.json`, `vitest.config.ts`, `scripts/validate-env.ts`, `src/lib/db.ts`, `src/lib/logger.ts`, `src/instrumentation.ts`, `Dockerfile`, `Dockerfile.workers`, `src/app/globals.css`, `src/generated/postgres-client/package.json`.
- Версии: скрипт читал `package.json.dependencies`/`devDependencies` и сопоставлял с `package-lock.json#packages["node_modules/<имя>"].version`. Дубли версий считались по всем узлам lock (имя = подстрока после последнего `node_modules/`).
- Использование в коде: сканер проходил все `*.ts/tsx/js/jsx/mjs/cjs` в `src/` и искал спецификаторы `from 'X'`, `require('X')`, `import('X')`, где `X` совпадает с именем пакета или начинается на `X/`. Эквивалентная ручная команда: `rg -n "from ['\"]<пакет>['\"]" src` (в Git Bash — с двойными кавычками вокруг шаблона).
- Для пакетов с нулём совпадений в `src/` сделан дополнительный поиск по репозиторию (без `node_modules`), чтобы отделить «не используется вообще» от «используется в конфиге/скрипте».
- Пакеты `docs/audits/**` при поиске совпадений открывались только непреднамеренно (совпадения в чужих отчётах в выдаче). Существующие отчёты я НЕ читал и НЕ использовал как источник — выводы построены на собственных командах.
- Все приведённые `path:line` проверены чтением строки (см. блок ниже).

Скрипты метода (scratch, вне репозитория):
`C:\Users\PC\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\hermes\cache\scratch\deps.js` (версии), `deps2.js` (дубли с корректным разбором scoped-имён), `usage.js` (импорты).

## Проверенная выборка строк (evidence)

```
src/core/media/media-service.ts:36  import { S3Client, ... } from '@aws-sdk/client-s3';
src/core/media/media-service.ts:37  import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
src/core/media/media-service.ts:277 const { default: sharp } = await import('sharp');
src/lib/db.ts:13                    import { PrismaPg } from '@prisma/adapter-pg';
src/lib/db.ts:22                    import('server-only').catch(() => {
src/lib/utils.ts:1                  import { clsx, type ClassValue } from "clsx"
src/lib/utils.ts:2                  import { twMerge } from "tailwind-merge"
src/lib/redis-cache.ts:35           import { Redis, RedisOptions } from 'ioredis';
src/core/event-bus/schema-registry/registry.ts:1  import Ajv, { type ValidateFunction } from 'ajv';
src/core/event-bus/schema-registry/registry.ts:2  import addFormats from 'ajv-formats';
src/services/auth/auth-service.ts:1 import { hash as bcryptHash, ... } from 'bcryptjs';
src/services/auth/session-service.ts:1 import { SignJWT, jwtVerify, ... } from 'jose';
src/components/ui/toast.tsx:4       import * as ToastPrimitives from "@radix-ui/react-toast"
src/components/piling/admin-analytics.tsx:17 } from 'recharts';
src/app/layout.tsx:6                import { Toaster } from 'sonner';
src/app/api/admin/dlq/route.ts:1    import { z } from 'zod';
src/lib/pdf-queue.ts:18             import { Queue, Job, QueueEvents } from 'bullmq';
```

## Таблица 1. Прямые dependencies (49)

Версия: `объявлено → разрешено в lock (package.json:строка)`.
Статус: ПРОЙДЕНО = использование подтверждено строкой; НЕ ПРОВЕРЕНО = требует сети/сборки; ГИПОТЕЗА = вывод по косвенным признакам.

| Пакет | Версия | Назначение | Где используется в src (path:line / команда) | Дубль мажора в lock |
|---|---|---|---|---|
| @aws-sdk/client-s3 | ^3.1036.0 → 3.1138.0 (78) | S3-клиент (медиа) | `src/core/media/media-service.ts:36` | нет |
| @aws-sdk/s3-request-presigner | ^3.1036.0 → 3.1138.0 (70-71) | presigned URL | `src/core/media/media-service.ts:37` | нет |
| @opentelemetry/api | ^1.9.1 → 1.9.1 (72) | OTel API | НЕТ в src (только транзитивно: `@sentry/node/package.json:69`) | нет |
| @opentelemetry/exporter-trace-otlp-http | ^0.222.0 → 0.222.0 (73) | OTLP-экспорт трейсов | НЕТ нигде (только root; у Sentry — ОПЦИОНАЛЬНЫЙ peer, `package-lock.json:5132,5143`) | нет |
| @opentelemetry/instrumentation | ^0.222.0 → 0.222.0 (74) | OTel instrumentation | НЕТ в src (транзитивно: `@sentry/node/package.json:70`) | 0.222.0 + 0.220.0 (вложенный у @sentry/node) |
| @opentelemetry/sdk-trace-base | ^2.8.0 → 2.11.0 (75) | OTel tracing SDK | НЕТ в src (транзитивно: `@sentry/node/package.json:71`) | нет |
| @opentelemetry/semantic-conventions | ^1.41.1 → 1.43.0 (76) | OTel семантич. конвенции | НЕТ нигде в проекте | нет |
| @prisma/adapter-pg | ^7.8.0 → 7.10.0 (77) | адаптер Prisma↔pg | `src/lib/db.ts:13` | нет |
| @prisma/client | ^7.8.0 → 7.10.0 (78) | Prisma-клиент | НЕТ в src; только `prisma/seed-test-data.ts:6`, `scripts/explain-analyze.ts:18` | нет |
| @radix-ui/react-alert-dialog | ^1.1.15 → 1.1.23 (79) | UI-примитив | `src/components/ui/alert-dialog.tsx:4` | нет |
| @radix-ui/react-checkbox | ^1.3.3 → 1.3.11 (80) | UI-примитив | `src/components/ui/checkbox.tsx:4` | нет |
| @radix-ui/react-dialog | ^1.1.15 → 1.1.23 (81) | UI-примитив | `src/components/ui/dialog.tsx:4`, `sheet.tsx:4` | нет |
| @radix-ui/react-label | ^2.1.8 → 2.1.15 (82) | UI-примитив | `src/components/ui/label.tsx:4` | нет |
| @radix-ui/react-scroll-area | ^1.2.10 → 1.2.18 (83) | UI-примитив | `src/components/ui/scroll-area.tsx:4` | нет |
| @radix-ui/react-select | ^2.2.6 → 2.3.7 (84) | UI-примитив | `src/components/ui/select.tsx:4` | нет |
| @radix-ui/react-separator | ^1.1.8 → 1.1.15 (85) | UI-примитив | `src/components/ui/separator.tsx:4` | нет |
| @radix-ui/react-slot | ^1.2.4 → 1.3.3 (86) | UI-примитив | `src/components/ui/badge.tsx:2`, `button.tsx:2` | 1.3.3 + 1.2.3 (вложенный) |
| @radix-ui/react-tabs | ^1.1.13 → 1.1.21 (87) | UI-примитив | `src/components/ui/tabs.tsx:4` | нет |
| @radix-ui/react-toast | ^1.2.15 → 1.2.23 (88) | UI-примитив | `src/components/ui/toast.tsx:4` | нет |
| @sentry/nextjs | ^10.53.1 → 10.75.3 (89) | ошибки/трейсинг | `src/instrumentation.ts:5`, `src/app/error.tsx:5` | нет |
| @swc/helpers | ^0.5.21 → 0.5.23 (90) | рантайм-хелперы SWC | НЕТ в src; уже dep у next (`next/package.json:85`) | нет |
| ajv | ^8.20.0 → 8.20.0 (91) | JSON-схемы событий | `src/core/event-bus/schema-registry/registry.ts:1` | 8.20.0 + 6.15.0 (eslint) |
| ajv-formats | ^3.0.1 → 3.0.1 (92) | форматы AJV | `registry.ts:2` | нет |
| bcryptjs | ^3.0.3 → 3.0.3 (93) | хэш паролей | `src/services/auth/auth-service.ts:1` | нет |
| bullmq | ^5.76.1 → 5.81.5 (94) | очереди (PDF) | `src/lib/pdf-queue.ts:18` | нет |
| class-variance-authority | ^0.7.1 → 0.7.1 (95) | варианты классов UI | `src/components/ui/button.tsx:3` | нет |
| clsx | ^2.1.1 → 2.1.1 (96) | склейка классов | `src/lib/utils.ts:1` | нет |
| cookie | ^1.1.1 → 1.1.1 (97) | парсинг cookie | НЕТ (`from 'cookie'` — 0 в src; cookie-логика через `next/headers`, `src/app/page.tsx:2`) | нет |
| dotenv | ^17.4.2 → 17.4.2 (98) | чтение .env | НЕТ в src; только `vitest.config.ts:4`, `scripts/validate-env.ts:12` | 17.4.2 + 16.6.1 |
| framer-motion | ^13.4.2 → 13.4.2 (99) | анимации | `src/app/(app)/layout.tsx:7` | нет |
| ioredis | ^5.10.1 → 5.11.1 (100) | Redis | `src/lib/redis-cache.ts:35` | нет |
| jose | ^6.2.2 → 6.2.12 (101) | JWT | `src/services/auth/session-service.ts:1` | нет |
| lucide-react | ^1.11.0 → 1.47.0 (102) | иконки | `src/components/...` (множество) | нет |
| next | 16.3.6 (точная) → 16.3.6 (103) | фреймворк | `src/app/**` (315 совпадений) | нет |
| next-themes | ^0.4.6 → 0.4.6 (104) | тёмная тема | НЕТ нигде (поиск по репо — только package.json/lock) | нет |
| pdfkit | ^0.18.0 → 0.18.0 (105) | генерация PDF | `src/lib/pdf-generator/render.ts:1` | 0.18.0 + 0.17.6 |
| pino | ^10.3.1 → 10.3.1 (106) | JSON-логгер | НЕТ; рабочий логгер `src/lib/logger.ts` рукописный (без import) | нет |
| react | ^19.2.5 → 19.3.0 (107) | UI | `src/app/**` (231 совпадение) | нет |
| react-dom | ^19.2.5 → 19.3.0 (108) | UI | `src/components/piling/to/.../command-dialog.tsx:10` | нет |
| react-error-boundary | ^6.1.1 → 6.1.6 (109) | Error boundary | `src/components/piling/app-error-boundary.tsx:3` | нет |
| recharts | ^3.8.1 → 3.10.1 (110) | графики | `src/components/piling/admin-analytics.tsx:17` | нет |
| server-only | ^0.0.1 → 0.0.1 (111) | guard клиентских импортов | `src/lib/db.ts:22`, `src/lib/redis-cache.ts:31` | нет |
| sharp | ^0.35.3 → 0.35.4 (112) | обработка изображений | `src/core/media/media-service.ts:277` | нет |
| sonner | ^2.0.7 → 2.0.8 (113) | тосты | `src/app/layout.tsx:6` | нет |
| tailwind-merge | ^3.5.0 → 3.7.0 (114) | слияние классов | `src/lib/utils.ts:2` | нет |
| tailwindcss-animate | ^1.0.7 → 1.0.7 (115) | анимации Tailwind | только `tailwind.config.ts:2` (сам конфиг, вероятно, не читается — см. находку 5) | нет |
| tsx | ^4.22.4 → 4.23.15 (116) | запуск TS | НЕТ в src; npm-скрипты + прод-воркеры `Dockerfile.workers:99` | нет |
| zod | ^4.3.6 → 4.6.5 (117) | валидация схем | `src/app/api/admin/dlq/route.ts:1` | нет |
| zustand | ^5.0.12 → 5.0.15 (118) | клиентский стор | `src/lib/store.ts:1` | нет |

## Таблица 2. devDependencies (22)

Все 22 используются только в тестах/линте/сборке — это ПРОЙДЕНО (ожидаемо):

| Пакет | Версия | Назначение |
|---|---|---|
| @playwright/test | ^1.59.1 → 1.63.0 | e2e |
| @tailwindcss/postcss | ^4 → 4.3.3 | Tailwind v4 плагин |
| @testing-library/jest-dom | ^7.0.1 → 7.0.1 | матчеры |
| @testing-library/react | ^16.3.2 → 16.3.3 | рендер компонентов |
| @types/bcryptjs | ^3.0.0 → 3.0.0 | типы |
| @types/pdfkit | ^0.17.3 → 0.17.6 | типы |
| @types/pg | ^8.20.0 → 8.23.1 | типы |
| @types/react | ^19 → 19.3.0 | типы |
| @types/react-dom | ^19 → 19.3.0 | типы |
| @vitejs/plugin-react | ^6.0.1 → 6.1.1 | vitest |
| @vitest/coverage-v8 | ^5.0.1 → 5.0.1 | покрытие |
| eslint | ^9.39.4 → 9.39.5 | линт |
| eslint-config-next | ^16.3.6 → 16.3.6 | линт |
| eslint-plugin-react-hooks | ^7.1.1 → 7.1.1 | линт |
| happy-dom | ^20.9.0 → 20.14.5 | окружение тестов |
| jsdom | ^30.1.1 → 30.1.1 | окружение тестов |
| pg | ^8.20.0 → 8.23.0 | драйвер (тесты/скрипты) |
| prisma | ^7.8.0 → 7.10.0 | CLI/генерация |
| tailwindcss | ^4 → 4.3.3 | Tailwind |
| tw-animate-css | ^1.4.0 → 1.4.0 | анимации (актуальная замена tailwindcss-animate) |
| typescript | ^6 → 6.0.3 | типы/сборка |
| vitest | ^5.0.1 → 5.0.1 | юнит-тесты |

## Таблица 3. Устаревшие мажоры (по lock) — НЕ ПРОВЕРЕНО

Определение «последней доступной мажорной версии» требует обращения к реестру npm, который по условию задачи недоступен. Поэтому статус: **НЕ ПРОВЕРЕНО** (для всех строк). Локально, только по `package-lock.json`, устаревание не доказуемо.

Косвенный локальный признак «утяжеления версий» — сосуществование нескольких мажоров одного пакета в дереве (26 записей-пакетов, часть из них — разные контексты). Примеры (имя → мажоры → число экземпляров):

| Пакет | Мажоры в lock | Комментарий |
|---|---|---|
| ajv | 6.15.0(×2), 8.20.0 | старый мажор 6 тянет eslint-стек |
| dotenv | 17.4.2, 16.6.1 | старый 16 — транзитивно |
| lru-cache | 11.5.3(×4), 5.1.1 | 5 — из старой цепочки |
| brace-expansion | 5.0.12(×2), 1.1.21 | 1.x — известный старый мажор |
| minimatch | 10.2.6(×2), 3.1.5 | 3.x — устаревший |
| semver | 7.8.5(×4), 6.3.1 | 6.x — устаревший |
| whatwg-url | 17.1.2, 16.0.1, 5.0.0 | три мажора |
| glob-parent | 6.0.2, 5.1.2 | 5.x — устаревший |
| signal-exit, entities, debug, globals, minimatch и др. | — | всего 33 пакета с >1 мажором |

Итог по дублям: `node_modules` содержит 33 пакета с двумя+ мажорами (из 1043 записей). Это не уязвимость сама по себе, но раздувает образ и увеличивает поверхность.

## Таблица 4. npm audit — НЕ ПРОВЕРЕНО

- Отдельного артефакта (`npm audit --json`, `*-audit.json`, текстовый отчёт) в репозитории нет: поиск по именам файлов `*audit*.json` и `*npm*` — 0; поиск строк `"vulnerabilities"`/`npm audit --json` вне `node_modules` находит совпадения ТОЛЬКО внутри файлов `docs/audits/**`, которые по условию задачи читать запрещено.
- В `package.json` нет скрипта `audit` (нет `"audit": "npm audit"`), CI-конфига аудита (renovate/dependabot/.npmrc) в репозитории нет.
- Сеть и `npm install/audit` запрещены условием → команду не запускал. Статус: **НЕ ПРОВЕРЕНО**.

## Находки

| # | Severity | path:line | Проблема | Сценарий / почему важно | Как чинить |
|---|---|---|---|---|---|
| 1 | важно | `package.json:72-76` | Пять прямых `@opentelemetry/*` не импортируются в проекте. У `@sentry/node` (`node_modules/@sentry/node/package.json:69-71`) три из них — уже собственные `dependencies`; `exporter-trace-otlp-http` и `semantic-conventions` не нужны вообще (`exporter-trace-otlp-http` — лишь ОПЦИОНАЛЬНЫЙ peer `@sentry/node-core`, `package-lock.json:5129-5152`; `semantic-conventions` в проекте не встречается). | Прямая запись не даёт ничего, кроме веса в прод-образе: OTel SDK в приложении не инициализируется (в `src/instrumentation.ts:5-26` только Sentry и логгер). Дублирование транзитивных пакетов рассинхронизируется при их обновлении. | Убрать из `dependencies` 5 записей; три останутся транзитивно (`@sentry/node`), две станут не нужны. Требует проверки сборкой (`npm run build`) и `npm ls`. |
| 2 | важно | `package.json:104` | `next-themes` — runtime-зависимость с нулём упоминаний: `from 'next-themes'` нет ни в `src/`, ни в конфигах, ни в скриптах (только `package.json`/`package-lock.json`). | Мёртвый пакет. Установлен как prod-зависимость, попадает в `dependencies`-граф и в аудит-поверхность. | Удалить из `dependencies`. ПРОЙДЕНО по поиску; удаление проверить сборкой. |
| 3 | важно | `package.json:106` | `pino` не используется: `from 'pino'` — 0. Рабочий логгер — рукописный `src/lib/logger.ts` (в первых 50 строках нет ни одного `import`; вывод JSON делает сам файл). | Мёртвая prod-зависимость (логгер-пакет в образе впустую). | Удалить из `dependencies`. |
| 4 | важно | `package.json:97` | `cookie` не используется: `from 'cookie'`/`require('cookie')` — 0 в `src/`. Работа с cookie идёт через `next/headers` (`src/app/page.tsx:2,11-12`, `src/lib/page-session.ts:1,41-42`). | Мёртвая prod-зависимость. | Удалить из `dependencies`. |
| 5 | важно | `package.json:115`; `tailwind.config.ts:2` | `tailwindcss-animate` объявлен prod-зависимостью, но импортируется ТОЛЬКО из `tailwind.config.ts`. Проект на Tailwind v4 CSS-first: `src/app/globals.css:1-2` — `@import "tailwindcss"` + `@import "tw-animate-css"`, директивы `@config` нет; `components.json:7` `tailwind.config` пустое. Вероятно, `tailwind.config.ts` сборкой не читается. Статус — ГИПОТЕЗА (не проверял сборкой). | Если конфиг мёртв, `tailwindcss-animate` — мёртвая зависимость, а его актуальная замена (`tw-animate-css`, devDep) уже стоит. | Подтвердить сборкой; при подтверждении удалить `tailwindcss-animate` (и, возможно, сам `tailwind.config.ts`). |
| 6 | мелочь | `package.json:90`; `node_modules/next/package.json:85` | `@swc/helpers` объявлен прямо, но `next@16.3.6` уже несёт его как собственную `dependency` той же версии (0.5.23). Прямого импорта в `src/` нет. | Избыточная прямая запись; дублирует транзитивную. | Удалить из `dependencies` (останется транзитивно). Проверить `npm ls @swc/helpers`. |
| 7 | мелочь | `package.json:78` | `@prisma/client` в `dependencies`, но в `src/` не импортируется. Единственные обращения — dev-скрипты: `prisma/seed-test-data.ts:6`, `scripts/explain-analyze.ts:18`. Рантайм работает через сгенерированный клиент, у которого в зависимостях только `@prisma/client-runtime-utils` (`src/generated/postgres-client/package.json:110`). | Похоже на dev-only пакет в prod-секции. Статус — ГИПОТЕЗА (не исключаю косвенной потребности генератора/движка). | Кандидат на перенос в `devDependencies`; проверять `npm run build` + `db:generate`. |
| 8 | мелочь | `package.json:98` | `dotenv` в `dependencies`, но используется только `vitest.config.ts:4` и `scripts/validate-env.ts:12` (вызывается из npm-скриптов `dev/build/start`). Прод-контейнер стартует напрямую `node server.js` (`Dockerfile:119`), dotenv там не грузится. | В прод-образе — балласт; но `npm start` вне Docker (Windows) без него сломается. | Либо оставить и задокументировать, либо перенести в `devDependencies` и убрать из `npm start`-пути в контейнере. |
| 9 | мелочь | `package-lock.json` (33 пакета) | В дереве сосуществуют два+ мажора у 33 пакетов: `ajv` 6/8, `dotenv` 16/17, `lru-cache` 5/11, `brace-expansion` 1/5, `minimatch` 3/10, `semver` 6/7, `whatwg-url` 5/16/17 и др. | Раздувает `node_modules`/образ, повышает шанс устаревшего кода в путях и усложняет аудит. | Не требует немедленных действий; при обновлениях подтягивать потребителей старых мажоров. |
| 10 | мелочь | `package.json` (нет скрипта `audit`); репозиторий | Нет закоммиченного результата `npm audit` и нет автоматизации аудита (renovate/dependabot/`.npmrc`/CI-скрипт отсутствуют). | Регрессии уязвимостей не отслеживаются машинно; результат аудита не воспроизводим из репозитория. | Добавить CI-шаг `npm audit --omit=dev --json` и хранить артефакт. |

## Проверено «не проблема» (снятые подозрения)

- `tsx` в `dependencies` (package.json:116): НЕ dev-only. Прод-воркеры стартуют как `npx tsx src/workers/unified-worker.ts` (`Dockerfile.workers:99`) после `npm prune --omit=dev` (`Dockerfile.workers:53`); перенос в devDeps сломает воркеры (это же прямо отмечено комментарием `Dockerfile.workers:50`). Статус: ПРОЙДЕНО.
- `@prisma/adapter-pg` (package.json:77): реально используется рантаймом (`src/lib/db.ts:13`). Статус: ПРОЙДЕНО.
- `server-only`, `ajv`, `ajv-formats`, `bcryptjs`, `jose`, `bcryptjs` и все `@radix-ui/*` — импортируются в `src/`, прямые записи обоснованы. Статус: ПРОЙДЕНО.

## Не проверено

1. **Результат `npm audit`** — сеть и установка запрещены условием; готового файла с выводом в репозитории нет (есть только внутри `docs/audits/**`, которые читать запрещено). Статус: НЕ ПРОВЕРЕНО.
2. **Устаревшие мажорные версии относительно последних в реестре npm** — без сети не определимо. Приведены только признаки сосуществования мажоров внутри lock. Статус: НЕ ПРОВЕРЕНО.
3. **Читается ли `tailwind.config.ts` сборкой Tailwind v4** — не проверял `npm run build` (нужны env/БД). Вывод о мёртвости косвенный (`globals.css:1-2` без `@config`, `components.json:7` пусто). Статус: ГИПОТЕЗА.
4. **Нужен ли `@prisma/client` в рантайме косвенно** (движок/резолвер генератора, `scripts/patch-postgres-client.js`) — в `src/` прямого импорта нет, косвенную потребность исключить не могу. Статус: ГИПОТЕЗА.
5. **Транзитивные уязвимости и их достижимость** — не анализировались: нет данных audit и нет сети; вручную advisories не сверял. Статус: НЕ ПРОВЕРЕНО.
6. **Является ли `overrides` (postcss, sharp, @hono/node-server, protobufjs) достаточным** — не проверял фактическое разрешение версий (`npm ls` без установки недоступен). Статус: НЕ ПРОВЕРЕНО.
7. **Пересечение с devDeps, попадающими в прод-дерево** (например, `prisma` как опциональный peer `@prisma/client`) — обратное направление задачи, не анализировал. Статус: НЕ ПРОВЕРЕНО.
