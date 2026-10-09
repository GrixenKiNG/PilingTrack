# AU116-S7-DEPENDENCIES — зависимости: неиспользуемые и дублирующие

Версия (git rev-parse HEAD): `1ee3e9acd8c3b5c0e020d5c503f87b79af41372c`
Ветка: `hermes/q4-0926`. Аудит только на чтение; код приложения и `package.json` не менялись.

## Итог

Резюме для владельца (5 строк):

1. Из 49 `dependencies` **11 не имеют ни одного импорта** в коде: `pino`, `next-themes`, `cookie`, пять `@opentelemetry/*`, `@swc/helpers` и `tsx` (последний — легитимен, вызывается как CLI, а не импортом). Реальных «мёртвых» пакетов — 9.
2. Пять `@opentelemetry/*` и `@swc/helpers` уже приходят транзитивно (через `@sentry/node` и `next`) — их прямые записи дублируют транзитивные.
3. Дублей по назначению найдено 4 пары: тосты (`sonner` ↔ `@radix-ui/react-toast`), анимации (`tw-animate-css` ↔ `tailwindcss-animate`), тестовый DOM (`happy-dom` ↔ `jsdom`), точка входа Prisma (`@prisma/client` ↔ сгенерированный `src/generated/postgres-client`).
4. То, что задача просила проверить отдельно, **дублей не даёт**: библиотек дат в проекте нет вообще (используется `Intl`), графики — только `recharts`, xlsx-библиотеки нет (свой `src/lib/xlsx-writer.ts`). Это ПРОЙДЕНО по `package.json` и поиску.
5. Один мёртвый прод-пакет (`pino`) тянет за собой риск: в дереве остался несовместимый второй логгер-путь — но второго файла `src/core/observability/logger.ts` в этой версии уже нет (`ls` каталога), сам `pino` не импортируется нигде.

Счёт по важности:

| важность | число |
| --- | --- |
| критично | 0 |
| важно | 8 |
| мелочь | 6 |
| **всего** | **14** |

Топ-5:

1. `pino` (`package.json:106`) — 0 импортов, мёртвая прод-зависимость.
2. `@radix-ui/react-toast` (`package.json:88`) — держится только мёртвым кластером `src/components/ui/toast.tsx` + `toaster.tsx` + `src/lib/hooks/use-toast.ts`; живой тост — `sonner`.
3. `@opentelemetry/api|instrumentation|sdk-trace-base|exporter-trace-otlp-http|semantic-conventions` (`package.json:72-76`) — 0 импортов, все транзитивны.
4. `next-themes` (`package.json:104`) и `cookie` (`package.json:97`) — 0 упоминаний в коде.
5. `jsdom` (`package.json:144`) и `tailwindcss-animate` (`package.json:115`) — неиспользуемые devDeps/прод-зависимость.

## Методика

Всё воспроизводимо, ничего не запускалось на установку и `npm audit` (по условию).

1. `git rev-parse HEAD` → `1ee3e9acd8c3b5c0e020d5c503f87b79af41372c`; `git status --short` → `M AGENTS.md` (не мой файл, не трогал).
2. Список зависимостей взят из `package.json` программно (`node -e`, 49 `dependencies`, 22 `devDependencies`).
3. Для каждого пакета `P` — `rg` по всему репозиторию по шаблону
   `(from|require\(|import\()\s*['"]P(/...)?['"]` плюс `import\s+['"]P['"]` (side-effect импорты),
   исключения: `-g '!node_modules' -g '!docs/**' -g '!package-lock.json' -g '!**/.next/**' -g '!*.md' -g '!src/generated/**'`.
   Считалось число строк с импортом и число уникальных файлов (скрипт — во временном каталоге, в репозиторий не писался).
4. Отдельными точечными `rg` уточнялись спорные случаи: `pino`, `next-themes`, `cookie`, 5×`@opentelemetry/*`, `@swc/helpers`, `jsdom`, `tsx`, `tailwindcss-animate`, `tw-animate-css`.
5. Транзитивный статус проверен чтением `node_modules/<pkg>/package.json` (`dependencies`/`peerDependencies`), а не по памяти.
6. Наличие собственных типов у пакета проверено полем `types`/`typings` в `node_modules/<pkg>/package.json` + `ls` для `.d.ts`.
7. Дубли по назначению — сверка наборов библиотек по категориям (тосты, анимации, тест-DOM, Prisma-вход, даты, графики, xlsx).
8. Существующие отчёты в `docs/audits/` не читались (каталог исключён из всех поисков); выводы построены только на собственных прогонах.

## Таблица зависимостей (49 `dependencies`)

«импортов» — число строк с импортом / число уникальных файлов (по `rg`, шаг 3 методики).

| пакет | версия | импортов (строк/файлов) | вывод |
| --- | --- | --- | --- |
| @aws-sdk/client-s3 | ^3.1036.0 | 11 / 10 | используется |
| @aws-sdk/s3-request-presigner | ^3.1036.0 | 5 / 5 | используется |
| @opentelemetry/api | ^1.9.1 | 0 / 0 | не найдено; транзитивно от `@sentry/node` |
| @opentelemetry/exporter-trace-otlp-http | ^0.222.0 | 0 / 0 | не найдено; peer `@sentry/node-core` |
| @opentelemetry/instrumentation | ^0.222.0 | 0 / 0 | не найдено; транзитивно от `@sentry/node` |
| @opentelemetry/sdk-trace-base | ^2.8.0 | 0 / 0 | не найдено; транзитивно от `@sentry/node` |
| @opentelemetry/semantic-conventions | ^1.41.1 | 0 / 0 | не найдено нигде |
| @prisma/adapter-pg | ^7.8.0 | 17 / 17 | используется (прод + скрипты) |
| @prisma/client | ^7.8.0 | 2 / 2 | используется, но только 2 файла (см. №10) |
| @radix-ui/react-alert-dialog | ^1.1.15 | 1 / 1 | используется (`src/components/ui/alert-dialog.tsx:4`) |
| @radix-ui/react-checkbox | ^1.3.3 | 1 / 1 | используется |
| @radix-ui/react-dialog | ^1.1.15 | 2 / 2 | используется |
| @radix-ui/react-label | ^2.1.8 | 1 / 1 | используется |
| @radix-ui/react-scroll-area | ^1.2.10 | 1 / 1 | используется |
| @radix-ui/react-select | ^2.2.6 | 1 / 1 | используется |
| @radix-ui/react-separator | ^1.1.8 | 1 / 1 | используется |
| @radix-ui/react-slot | ^1.2.4 | 2 / 2 | используется |
| @radix-ui/react-tabs | ^1.1.13 | 1 / 1 | используется |
| @radix-ui/react-toast | ^1.2.15 | 1 / 1 | только мёртвый кластер (см. №4) |
| @sentry/nextjs | ^10.53.1 | 14 / 14 | используется |
| @swc/helpers | ^0.5.21 | 0 / 0 | не найдено; транзитивно от `next` |
| ajv | ^8.20.0 | 1 / 1 | используется (`registry.ts:1`) |
| ajv-formats | ^3.0.1 | 1 / 1 | используется (`registry.ts:2`) |
| bcryptjs | ^3.0.3 | 10 / 10 | используется |
| bullmq | ^5.76.1 | 4 / 4 | используется |
| class-variance-authority | ^0.7.1 | 4 / 4 | используется |
| clsx | ^2.1.1 | 1 / 1 | используется (`src/lib/utils.ts:1`) |
| cookie | ^1.1.1 | 0 / 0 | не найдено |
| dotenv | ^17.4.2 | 25 / 25 | используется |
| framer-motion | ^13.4.2 | 13 / 13 | используется (клиентская анимация) |
| ioredis | ^5.10.1 | 10 / 10 | используется |
| jose | ^6.2.2 | 2 / 2 | используется |
| lucide-react | ^1.11.0 | 23 / 21 | используется (иконки) |
| next | 16.3.6 | 320 / 304 | используется |
| next-themes | ^0.4.6 | 0 / 0 | не найдено |
| pdfkit | ^0.18.0 | 5 / 4 | используется |
| pino | ^10.3.1 | 0 / 0 | не найдено |
| react | ^19.2.5 | 233 / 231 | используется |
| react-dom | ^19.2.5 | 2 / 2 | используется (только `createPortal`) |
| react-error-boundary | ^6.1.1 | 4 / 3 | используется |
| recharts | ^3.8.1 | 1 / 1 | используется (`admin-analytics.tsx:17`) |
| server-only | ^0.0.1 | 2 / 2 | используется (динамический импорт) |
| sharp | ^0.35.3 | 3 / 3 | используется (1 файл src + 2 скрипта) |
| sonner | ^2.0.7 | 107 / 101 | используется |
| tailwind-merge | ^3.5.0 | 1 / 1 | используется (`src/lib/utils.ts:2`) |
| tailwindcss-animate | ^1.0.7 | 1 / 1 | только `tailwind.config.ts:2` (см. №8) |
| tsx | ^4.22.4 | 0 / 0 | используется как CLI в `package.json`, не импортом |
| zod | ^4.3.6 | 47 / 47 | используется |
| zustand | ^5.0.12 | 3 / 2 | используется |

## Дубли по назначению

| категория | библиотека A (живая) | библиотека B | вывод |
| --- | --- | --- | --- |
| Тосты | `sonner` — 107 строк / 101 файл, `src/app/layout.tsx:6,116` | `@radix-ui/react-toast` — 1 файл `src/components/ui/toast.tsx:4` | B держится только мёртвым кластером |
| Анимации | `tw-animate-css` — `src/app/globals.css:2` | `tailwindcss-animate` — `tailwind.config.ts:2` | B подключён только из, по-видимому, нечитаемого конфига (ГИПОТЕЗА) |
| Тестовый DOM | `happy-dom` — `vitest.config.ts:32` | `jsdom` — 0 упоминаний | B не выбирается ни одним спеком |
| Точка входа Prisma | сгенерированный `src/generated/postgres-client` (`src/lib/db.ts:12`) | `@prisma/client` — 2 файла | два способа получить `PrismaClient` |
| Даты | нет библиотеки (используется `Intl`) | — | дублей нет |
| Графики | `recharts` (только он) | — | дублей нет |
| xlsx | свой `src/lib/xlsx-writer.ts` (библиотеки нет) | — | дублей нет |
| Валидация | `zod` (47) | `ajv` + `ajv-formats` (1 файл) | разные слои, не дубль (см. №13) |

## Находки

| # | важность | path:line | проблема | чем грозит / зачем | что сделать |
| --- | --- | --- | --- | --- | --- |
| 1 | важно | `package.json:106` | `pino` объявлен прод-зависимостью, но 0 импортов во всём репозитории (`rg "from 'pino'\|require('pino'"` → пусто). | Мёртвый пакет в прод-образе; кроме того в дереве раньше жил второй логгер на pino — риск, что новый код подключит «не тот» лог. | Удалить `pino` из `dependencies` (перед этим убедиться, что нет вычисляемого динамического импорта). |
| 2 | важно | `package.json:104` | `next-themes` — 0 упоминаний в коде (только `package.json`/lock). | Тёмная тема удалена (`src/app/globals.css:4-14`, комментарий о снятии `ThemeProvider`); пакет мёртв. | Удалить из `dependencies`. |
| 3 | важно | `package.json:97` | `cookie` — 0 импортов (`rg "from 'cookie'\|require('cookie')"` → пусто). | Куки в проекте идут через встроенный API Next.js; сторонний пакет дублирует функциональность и висит в проде. | Удалить из `dependencies`. |
| 4 | важно | `package.json:88`; `src/components/ui/toast.tsx:4`; `src/components/ui/toaster.tsx:3,11`; `src/lib/hooks/use-toast.ts:9` | `@radix-ui/react-toast` импортируется ровно один раз — из `src/components/ui/toast.tsx`, который используется только «мёртвым» кластером `toast.tsx` + `toaster.tsx` + `src/lib/hooks/use-toast.ts`; ничего не импортирует `toaster.tsx`. Живые тосты — `sonner` (`src/app/layout.tsx:6,116`). Дубль по назначению. | Два тост-движка: правка «не того» файла молча ничего не даёт; зависимость держится мёртвым кодом. | Собрать доказательства неиспользуемости по AGENTS.md §4, удалить три файла и `@radix-ui/react-toast`; либо пометить кластер как «не используется». |
| 5 | важно | `package.json:72-76` | Пять `@opentelemetry/*` (`api`, `exporter-trace-otlp-http`, `instrumentation`, `sdk-trace-base`, `semantic-conventions`) — 0 импортов. Все, кроме `semantic-conventions`, транзитивны: `@opentelemetry/api`, `instrumentation`, `sdk-trace-base` — прямые `dependencies` файла `node_modules/@sentry/node/package.json`; `exporter-trace-otlp-http` — peer `node_modules/@sentry/node-core`. | Пять прямых записей дублируют транзитивный граф Sentry; трассировка в коде не подключена (своего `instrumentation.ts` нет). | Удалить пять прямых зависимостей, оставив `@sentry/nextjs`; при сомнении проверить `npm ls @opentelemetry/sdk-trace-base` (не запускалось). |
| 6 | важно | `package.json:90` | `@swc/helpers` — 0 импортов; `node_modules/next/package.json` уже несёт `@swc/helpers: 0.5.23` как собственную dependency. | Прямая запись дублирует транзитивную; версия в проекте — `^0.5.21`. | Удалить из `dependencies` (останется транзитивно от `next`). |
| 7 | важно | `package.json:144` | `jsdom` (devDependency) — 0 упоминаний: ни `from 'jsdom'`/`require('jsdom')`, ни `environment: 'jsdom'`, ни `@vitest-environment jsdom`. Vitest настроен на `happy-dom` (`vitest.config.ts:32`). Дубль по назначению. | Десятки мегабайт devDeps, которые не выбираются; вводит в заблуждение при чтении конфигов тестов. | Удалить `jsdom` из `devDependencies`. |
| 8 | важно | `package.json:115`; `tailwind.config.ts:2` | `tailwindcss-animate` импортируется ровно из `tailwind.config.ts`; в `src/` нет директивы `@config` (`rg "@config" src` → пусто), `components.json:7` `"config": ""`, прод идёт через `@tailwindcss/postcss` (Tailwind v4 CSS-first), а живая замена — `tw-animate-css` (`src/app/globals.css:2`). Статус «конфиг не читается» — ГИПОТЕЗА (сборкой не проверял). | Если конфиг мёртв — мёртвая прод-зависимость и мёртвый файл; кроме того в `tailwind.config.ts:5` остался `darkMode: "class"` при снятой тёмной теме. | Подтвердить сборкой, затем удалить `tailwindcss-animate` (и, возможно, сам `tailwind.config.ts`). Решение за владельцем. |
| 9 | мелочь | `package.json:133` | `@types/bcryptjs` объявлен, но у самого `bcryptjs` 3.0.3 есть свои типы: `node_modules/bcryptjs/package.json` → `"types": "umd/index.d.ts"`, файл `node_modules/bcryptjs/umd/index.d.ts` существует. | Типы-пакет дублирует встроенные и может конфликтовать по версии. | Удалить `@types/bcryptjs` из `devDependencies`. |
| 10 | мелочь | `package.json:78`; `prisma/seed-test-data.ts:6`; `scripts/explain-analyze.ts:18` | `@prisma/client` импортируется только в двух файлах; приложение использует сгенерированный клиент `src/generated/postgres-client` (`src/lib/db.ts:12`, `src/lib/db.ts:28`). У сгенерированного клиента в `src/generated/postgres-client/package.json` зависимость — `@prisma/client-runtime-utils`, ссылок на `@prisma/client` нет. | Две точки входа к Prisma (путаница при импортах, лишний пакет в графе). | Перевести `prisma/seed-test-data.ts:6` и `scripts/explain-analyze.ts:18` на сгенерированный клиент и убрать `@prisma/client`; либо оставить явно с комментарием зачем. |
| 11 | мелочь | `package.json:148`; `src/app/globals.css:2` | `tw-animate-css` лежит в `devDependencies`, но импортируется из `src/app/globals.css` — CSS, который участвует в прод-сборке. | При `npm ci --omit=dev` + `next build` сборка упадёт на отсутствующем `@import "tw-animate-css"`. | Перенести `tw-animate-css` в `dependencies` (или убедиться, что образ ставит devDeps до сборки). Не проверял сборкой/установкой. |
| 12 | мелочь | `package.json:115` | `tailwindcss-animate` (плагин Tailwind, нужен только на этапе сборки) объявлен в `dependencies`, а не в `devDependencies`. | Прод-образ несёт build-time пакет; при живом конфиге это лишняя запись в проде. | Если пакет оставляют (см. №8) — перенести в `devDependencies`. |
| 13 | мелочь | `package.json:91-92`; `src/core/event-bus/schema-registry/registry.ts:1-2` | Два валидатора: `zod` (47 импортов, схемы запросов/домена) и `ajv` + `ajv-formats` (по 1 импорту — только `registry.ts`). | Не дубль по слою (zod — прикладные схемы, ajv — JSON-Schema шины событий), но два механизма валидации в одном дереве требуют дисциплины. | Ничего не менять; зафиксировать назначение в доке/комментарии, чтобы ajv не «расползся». |
| 14 | мелочь | `package.json:99,115,148` | Три пакета анимации: `framer-motion` (13 импортов, JS-анимации), `tw-animate-css` (CSS, живой), `tailwindcss-animate` (мёртвый конфиг). | Пересечение ответственности за анимации; лишний выбор для разработчика. | Определиться с одним CSS-механизмом (`tw-animate-css`) и убрать `tailwindcss-animate` (см. №8); `framer-motion` оставить как JS-путь. |

## Не проверено

- **Сборка и установка не запускались** (по условию задачи). Поэтому выводы «мёртвый пакет» подтверждены только текстовым поиском: вычисляемый динамический импорт (`import(someVar)` / `require(name)`) таким поиском не ловится и исключить его полностью нельзя.
- **Читается ли `tailwind.config.ts` сборкой Tailwind v4** — не проверено запуском `npm run build`; вывод «не читается» — ГИПОТЕЗА из отсутствия `@config` в `src/`, пустого `tailwind.config` в `components.json:7` и стиля Tailwind v4 CSS-first. Если конфиг всё же подхватывается, находка №8 ослабляется (пакет живой, но через конфиг-наследие).
- **`npm ls` / фактическое разрешение peer-зависимостей** `@opentelemetry/*` (не окажется ли удаление прямой записи причиной ошибки резолва) — не проверено, `npm` не запускался.
- **Поведение `npm ci --omit=dev`** для `tw-animate-css` (находка №11) — гипотеза из расположения пакета в `devDependencies`; Docker-стадии не разбирал.
- **`@prisma/client` как обязательная прямая зависимость `prisma generate`** (может ли CLI требовать её при генерации) — не проверено; вывод №10 основан на том, что сгенерированный клиент самодостаточен (`src/generated/postgres-client/package.json`).
- **Не проверял `package-lock.json`** на дубликаты версий одного пакета (несколько копий в дереве) — задача спрашивала про импорты и дубли по назначению.
- **devDependencies просмотрены** только для оценки дублей (`jsdom`/`happy-dom`, `tw-animate-css`, `@types/bcryptjs`); полный разбор каждой devDependency не делался.
