# W100 — Неиспользуемые зависимости (пакеты без импортов)

## Итог

- Всего прямых пакетов в `package.json`: **71** — 49 в `dependencies` (`package.json:69-118`) и 22 в `devDependencies` (`package.json:128-151`).
- Пакетов **без единого импорта/вызова** в коде проекта (src/, scripts/, prisma/, e2e/, tests/, конфиги, Dockerfile, docker-compose): **16** — 9 в `dependencies`, 7 в `devDependencies`.
- Ещё 3 пакета импортируются, но **только из кода, который сам нигде не подключён/не читается** (см. №17-19).
- По важности: **критично — 0, важно — 11, мелочь — 8** (всего 19 записей).
- Топ-5 (самое ценное):
  1. `next-themes` (`package.json:104`) — runtime-зависимость, ноль упоминаний в коде вообще (ни импорта, ни строки в конфиге). Тёмная тема удалена 2026-08-09 (см. комментарий `src/app/globals.css:4-14`).
  2. `pino` (`package.json:106`) — логгер; во всём репозитории нет ни одного `from 'pino'`. Второй логгер `src/core/observability/logger.ts`, на который ссылался старый аудит `docs/audits/hermes-night/23-console-and-any.md:16`, **уже удалён** — в каталоге `src/core/observability/` его нет.
  3. `jsdom` (`package.json:144`) — devDep размером в десятки МБ, но vitest настроен на `happy-dom` (`vitest.config.ts:32`); ни один спек не просит jsdom (`@vitest-environment node` — только `node`).
  4. `cookie` (`package.json:97`) — ни одного импорта; единственное «упоминание» — строковый литерал в списке для маскирования `src/modules/readiness/domain/audit/mask.ts:9`.
  5. `@opentelemetry/*` — 5 прямых пакетов (`package.json:72-76`), в коде проекта не импортируются; приносят вес в прод-образ впустую.

## Методика

- Список пакетов взят из `package.json` (`dependencies` + `devDependencies`), 71 шт.
- Рекурсивный обход всего репозитория node-скриптом (лежал в скратче, в репозиторий не добавлялся) с исключением `node_modules/`, `.next/`, `.git/`, `coverage/`, `test-results/`, `playwright-report/`, временных каталогов. Для каждого пакета — регексп на импортные формы: `from "pkg"`, `from "pkg/sub"`, `require("pkg")`, `import("pkg")`, `vi.mock("pkg")`, `import "pkg"`, CSS `@import "pkg"`. Дополнительно — упоминание строкой в конфигах (`postcss.config.mjs` plugins, `vitest.config.ts` environment, `package.json` scripts, `Dockerfile*`, `docker-compose*.yml`).
- Точечные проверки (отдельные поиски): `next-themes`, `@swc/helpers`, `@opentelemetry/*`, `@types/*`, `pino`, `cookie`, `jsdom`, `@radix-ui/react-toast`, `tailwindcss-animate`, `@prisma/client`.
- Полностью прочитаны конфиги: `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `tailwind.config.ts`, `vitest.config.ts`, `components.json`, `tsconfig.json`.
- Для оценки «нужен ли тип-пакет» прочитаны `node_modules/pdfkit/package.json`, `node_modules/pg/package.json`, `node_modules/bcryptjs/package.json` (поле `types`); для объяснения косвенной роли OTel — `node_modules/@sentry/opentelemetry/package.json`, `node_modules/@sentry/node/package.json`; для jsdom — `node_modules/vitest/package.json` (optional peer).
- Итоговую классификацию («есть импорт» / «только строка в конфиге» / «нигде») можно воспроизвести теми же регекспами без запуска сборки.

## Находки

| # | severity | path:line | пакет | где упоминается | комментарий |
| --- | --- | --- | --- | --- | --- |
| 1 | важно | `package.json:104` | `next-themes` | нигде (только `package.json`, `package-lock.json:46,11825`) | Мёртвая runtime-зависимость. Тёмная тема и ThemeProvider удалены — `src/app/globals.css:4-14`. Удалить из `dependencies`. |
| 2 | важно | `package.json:106` | `pino` | нигде (единственная ссылка — текст аудита `docs/audits/hermes-night/23-console-and-any.md:49`) | Логгер не подключён нигде: ни один файл не делает `from 'pino'`. Рабочий логгер — рукописный `src/lib/logger.ts` (без pino). Секунда-логгер `src/core/observability/logger.ts` отсутствует в каталоге. |
| 3 | важно | `package.json:144` | `jsdom` | нигде | Vitest работает на `happy-dom` (`vitest.config.ts:32`). Ни один спек не задаёт `@vitest-environment jsdom` (есть только `node`). `jsdom` — optional peer vitest, но фактически не выбирается. Кандидат на удаление. |
| 4 | важно | `package.json:97` | `cookie` | только строковый литерал `src/modules/readiness/domain/audit/mask.ts:9` | Ни одного `from 'cookie'`/`require('cookie')`/`import('cookie')`. Работа с куками идёт через Next/JWT. Кандидат на удаление. |
| 5 | важно | `package.json:72` | `@opentelemetry/api` | только сгенерированный `src/generated/postgres-client/runtime/*.js` (код Prisma, не наш) | В коде проекта не импортируется. Является peer `@sentry/opentelemetry`, но тащится и транзитивно через `@sentry/node` (его `dependencies`), так что прямая запись не обоснована. См. «Не проверено» о peer-разрешении. |
| 6 | важно | `package.json:73` | `@opentelemetry/exporter-trace-otlp-http` | нигде | Ни импорта, ни строки в конфиге. Не peer и не dependency `@sentry/opentelemetry`/`@sentry/node`. Наиболее вероятно — остаток от удалённой трассировки. Кандидат на удаление. |
| 7 | важно | `package.json:74` | `@opentelemetry/instrumentation` | нигде | Не импортируется в проекте; у `@sentry/node` это собственная dependency (`node_modules/@sentry/node/package.json`), поэтому прямая запись дублирует транзитивную. |
| 8 | важно | `package.json:75` | `@opentelemetry/sdk-trace-base` | нигде | Не импортируется; peer `@sentry/opentelemetry` и dependency `@sentry/node`. Прямая запись дублирует транзитивную. |
| 9 | важно | `package.json:76` | `@opentelemetry/semantic-conventions` | нигде | Ни импорта, ни конфига. Кандидат на удаление. |
| 10 | важно | `package.json:88` | `@radix-ui/react-toast` | только `src/components/ui/toast.tsx:4` | Импортируется лишь «мёртвым» кластером `src/components/ui/toast.tsx` + `toaster.tsx` + `src/lib/hooks/use-toast.ts`: `toaster.tsx` не импортирован никем, `use-toast.ts` — только из `toaster.tsx`. Живые тосты — `sonner` (`src/app/layout.tsx:6`). Согласуется с аудитом `docs/audits/hermes-night/R135-in-app-notifications.md:55`. |
| 11 | важно | `package.json:115` | `tailwindcss-animate` | только `tailwind.config.ts:2` | Импортируется только из `tailwind.config.ts`, который Tailwind v4 (CSS-first) читает лишь по директиве `@config` — её в `globals.css` нет (поиск `@config` по репо пуст), а в `components.json:7` поле `tailwind.config` пустое. Актуальная замена — `tw-animate-css` (`globals.css:2`). Требует проверки сборкой (см. «Не проверено»). |
| 12 | мелочь | `package.json:90` | `@swc/helpers` | нигде | Прямых импортов нет; подставляется компилятором SWC/Next в скомпилированный вывод. Обычно держат явной записью ради резолва — удалять рискованно без проверки сборкой. |
| 13 | мелочь | `package.json:133` | `@types/bcryptjs` | нигде | `bcryptjs@3.0.3` сам поставляет типы (`node_modules/bcryptjs/package.json` → `types: umd/index.d.ts`), поэтому отдельный `@types/*`-пакет избыточен. |
| 14 | мелочь | `package.json:134` | `@types/pdfkit` | нигде (ссылки только в тексте, напр. `docs/audits/hermes-night/R134-pdf-print-content.md:8`) | Типы, нужны `tsc`: `pdfkit@0.18.0` своих типов не поставляет (`node_modules/pdfkit/package.json` без `types`). Импортируется самим pdfkit-кодом (`src/lib/pdf-generator/render.ts:1`). |
| 15 | мелочь | `package.json:135` | `@types/pg` | нигде | Прямых `from 'pg'` в `src/` нет (только `scripts/`, `e2e/`, исключённые из `tsconfig.json:48,49`), `pg@8.23.0` своих типов не поставляет. Похоже, для typecheck не нужен; возможен резолв типами `@prisma/adapter-pg` (при `skipLibCheck: true` — маловероятно). |
| 16 | мелочь | `package.json:136` | `@types/react` | нигде | Явных ссылок нет, но нужен компилятору: `tsconfig.json` не задаёт `types`, значит `@types/*` подхватываются автоматически для JSX/React. Оставить. |
| 17 | мелочь | `package.json:137` | `@types/react-dom` | нигде | То же, что №16 — нужен `tsc` для `react-dom` (`src/components/piling/to/readiness/shared/command-dialog.tsx:10`). Оставить. |
| 18 | мелочь | `package.json:139` | `@vitest/coverage-v8` | нигде | Явных импортов нет, но подключается витстом по флагу `--coverage` (`package.json:39-40`, `vitest.config.ts:50` provider `v8`). Нужен для `npm run test:coverage`. Оставить. |
| 19 | мелочь | `package.json:78` | `@prisma/client` | `prisma/seed-test-data.ts:6`, `scripts/explain-analyze.ts:18` | Оба файла вне сборки (`tsconfig.json:48,60` исключает `scripts/` и `prisma/seed-test-data.ts`). Приложение работает с `src/generated/postgres-client`, чей runtime ссылается на `@prisma/client-runtime-utils`, а не на `@prisma/client` (`src/generated/postgres-client/package.json:110`). Судьба снятия записи — см. «Не проверено». |

Приложение (пакеты без импорта, но используемые строкой в конфиге/CLI — не мёртвые, в таблицу не включены):
`@tailwindcss/postcss` (`postcss.config.mjs:2`), `happy-dom` (`vitest.config.ts:32`), `tsx` (`package.json` scripts + `Dockerfile.workers:99`) — используются строками/CLI, не импортом.

## Не проверено

- **Сборка, tsc, vitest не запускались** (задача read-only; удаление пакетов не выполнялось). Безопасность удаления любого из кандидатов не подтверждена практикой — только отсутствием ссылок.
- **Читается ли `tailwind.config.ts` сборкой Tailwind v4** — не проверено запуском сборки; вывод «не читается» сделан из отсутствия директивы `@config` в `globals.css` и пустого `tailwind.config` в `components.json`. Если Tailwind v4 всё же подхватывает файл, то `tailwindcss-animate` — живой (через мёртвый конфиг), и вывод №11 ослабляется.
- **Peer-разрешение npm** для `@opentelemetry/*` после удаления прямой записи не проверялось (не запускал `npm ls`/`npm install`); «тащится транзитивно» основано на чтении `package.json` пакетов Sentry, а не на фактическом дереве.
- **Нужен ли `@prisma/client` в рантайме** (движки/резолв генератора, `patch-postgres-client.js`) не проверено — в коде `src/` прямого импорта нет, но косвенную потребность исключить не могу.
- **`@types/pg`** — не проверено, ссылаются ли на типы `pg` `.d.ts`-файлы `@prisma/adapter-pg` (при `skipLibCheck: true` это обычно игнорируется).
- **Реальные размеры docker-образов** и вклад отдельных пакетов не измерялись (Docker не запускался).
