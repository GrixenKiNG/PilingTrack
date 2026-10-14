# QW10 — Зависимости, конфигурация, мёртвый код

Версия кода: `aad416cc` (main, 14.10.2026). Отчёт составил Claude вручную: Qwen на этой задаче не завершился (218 мин, без коммита). Правок кода нет, только чтение и поиск. Числа взяты из команд, указанных в «Методике».

## Итог

- Прямых зависимостей: 49 рабочих и 22 для разработки (71 всего). `npm audit --omit=dev`: **0 уязвимостей**.
- **9 рабочих зависимостей без единой ссылки в коде**: `next-themes`, `pino`, пять пакетов `@opentelemetry/*`, плюс `@radix-ui/react-toast` (используется только мёртвой цепочкой toast), `jsdom` (dev). Три из них (OpenTelemetry, next-themes, pino) уже были удалены из кода отдельными коммитами, а из `package.json` не ушли.
- Две библиотеки анимации с одним назначением: `tailwindcss-animate` и `tw-animate-css`.
- Мёртвый код: цепочка toast (3 файла) и ещё 14 файлов-«сирот» (в основном индексные файлы-обёртки).
- Устаревшие версии в основном патчи; крупные отложенные скачки (TypeScript 7, ESLint 10, Prisma 8 rc, happy-dom 21) уже решены владельцем в сентябре–октябре и здесь не пересматриваются.
- `.env.example` короткий (25 строк): в коде используется ~78 переменных окружения, в трёх примерах описано 31.

Топ-5 пунктов (по пользе/риску):
1. Убрать 5 пакетов OpenTelemetry, `pino`, `next-themes`, `jsdom` — подсистемы удалены в коммитах `e521cac1`, `dc65f105`, `73d27c30`. Заодно уйдёт `overrides` на `@opentelemetry/otlp-transformer` и транзитивные пакеты.
2. Удалить цепочку toast: `src/components/ui/toaster.tsx`, `src/lib/hooks/use-toast.ts`, `src/components/ui/toast.tsx` и пакет `@radix-ui/react-toast`. Уведомления идут через `sonner`.
3. Выбрать одну из `tailwindcss-animate` / `tw-animate-css`.
4. Убрать из `.env.production.example` переменные, которые код не читает (`PIN_LOOKUP_SECRET`, `OTEL_*`).
5. Дополнить `.env.example` переменными, без которых прод не стартует или молча меняет поведение (список в разделе «Конфигурация»).

## Методика

Всё воспроизводимо из корня репозитория.

1. Использование зависимости: для каждого имени из `package.json` поиск `rg -l -F` по `"имя"`, `'имя'`, `"имя/`, `'имя/` в `src scripts e2e tests prisma config load-tests chaos examples agents deploy observability .github`, корневых конфигах и Dockerfile (без `*.md`, `src/generated`). Ноль совпадений плюс отсутствие в `scripts` из `package.json` — кандидат. Каждого кандидата перепроверил отдельным `rg` по всему репозиторию и `npm ls`.
2. Осиротевшие файлы: скрипт собирает все импорты (`@/`, относительные) по `src scripts e2e tests prisma config`, исключает входные точки Next (`page`, `route`, `layout`, `instrumentation`, `proxy`…) и тесты. Из 967 файлов без импортёров — 21, из них без упоминания пути где-либо ещё — 17.
3. Когда подсистему убрали: `git log -S"<строка импорта>" -- src`.
4. Устаревшее: `npm outdated`, `npm audit --omit=dev`.
5. Переменные окружения: `rg -o "process\.env\.[A-Z_]+"` по коду против трёх файлов `.env*.example`.

## Находки

### А. Зависимости без использования

| # | Объект | Файл:строка | Вид | Доказательство | Рекомендация | Статус |
|---|--------|-------------|-----|----------------|--------------|--------|
| 1 | `@opentelemetry/api`, `exporter-trace-otlp-http`, `instrumentation`, `sdk-trace-base`, `semantic-conventions` | `package.json:72-76` | мёртвые рабочие зависимости | `rg` по коду: 0 импортов; `npm ls`: никто, кроме корня, их не требует; подсистема удалена коммитом `e521cac1` «remove dead OpenTelemetry tracing subsystem (never wired)» | удалить 5 пакетов и `overrides["@opentelemetry/otlp-transformer"]` (`package.json:121`) | ПРОЙДЕНО |
| 2 | `pino` | `package.json:106` | мёртвая рабочая зависимость | 0 импортов; второй pino-логгер удалён коммитом `dc65f105`; единственное упоминание — строка-подсказка в `agents/devops/devops-agents.ts:363` | удалить | ПРОЙДЕНО |
| 3 | `next-themes` | `package.json:104` | мёртвая рабочая зависимость | 0 импортов; тёмная тема убрана коммитом `73d27c30`, владелец решил не возвращать | удалить | ПРОЙДЕНО |
| 4 | `jsdom` | `package.json:147` | лишняя dev-зависимость | `vitest.config.ts:32` — окружение `happy-dom`; `jsdom` встречается только в комментарии `src/components/piling/admin-users/__tests__/admin-users.test.tsx:56`; в `npm ls` виден как опциональный peer vitest | удалить после пробного прогона тестов | ГИПОТЕЗА (peer vitest не проверял на отказ) |
| 5 | `@radix-ui/react-toast` | `package.json` | зависимость мёртвой цепочки | единственный импорт — `src/components/ui/toast.tsx`, который нужен только `use-toast.ts` и `toaster.tsx`; `toaster.tsx` нигде не импортируется; в `src/app/layout.tsx:6` смонтирован `Toaster` из `sonner` | удалить цепочку и пакет | ПРОЙДЕНО |
| 6 | `@swc/helpers` | `package.json:90` | прямая зависимость без импортов | 0 импортов в коде; тот же пакет приходит через `next` и `pdfkit` (`npm ls`) | можно убрать прямую запись | ГИПОТЕЗА (мог быть закреплён намеренно для сборки) |

Не считать мёртвым: `@types/*`, `@vitest/coverage-v8` (подключаются по соглашению, а не импортом).

### Б. Дубли назначения

| # | Объект | Файл:строка | Доказательство | Рекомендация |
|---|--------|-------------|----------------|--------------|
| 7 | `tailwindcss-animate` и `tw-animate-css` | `tailwind.config.ts:2`, `src/app/globals.css:2` | два пакета анимаций Tailwind подключены одновременно | оставить один (при Tailwind 4 это `tw-animate-css`), проверить классы `animate-*` визуально |

### В. Мёртвый код (проверено поиском по всему репозиторию)

| # | Файл | Вид | Доказательство | Рекомендация |
|---|------|-----|----------------|--------------|
| 8 | `src/components/ui/toaster.tsx` (34 строки) | цепочка toast | 0 импортёров; `rg "ui/toaster"` пусто | удалить вместе с п. 9, 10 |
| 9 | `src/lib/hooks/use-toast.ts` | цепочка toast | единственный импортёр — `toaster.tsx` | удалить |
| 10 | `src/components/ui/toast.tsx` | цепочка toast | единственный импортёр — `use-toast.ts` и `toaster.tsx` | удалить |
| 11 | `src/lib/hooks/use-mobile.ts` (20 строк) | неиспользуемый хук | `rg "hooks/use-mobile"` пусто | удалить |
| 12 | `src/lib/seed/equipment.seed.ts` (74 строки) | неиспользуемый посев | `rg "equipment.seed"` пусто | удалить или перенести в `prisma/seed.ts` |
| 13 | `src/core/shared/types/event-contracts.ts` (256 строк) | неиспользуемые типы | `rg "event-contracts"` пусто | сначала сверить с реестром схем событий, затем удалить |
| 14 | `src/components/piling/admin-reports/index.tsx` (3 строки), `admin-reports/types.ts` | остаток после переноса | ни одного импортёра | удалить |
| 15 | Индексные файлы-обёртки без импортёров: `src/core/application/index.ts`, `src/core/error-boundary/index.ts`, `src/core/event-bus/index.ts`, `src/core/notifications/index.ts`, `src/core/storage/index.ts`, `src/modules/crews/application/{commands,queries}/index.ts`, `src/modules/equipment/application/{commands,queries}/index.ts`, `src/modules/telemetry/index.ts`, `src/services/reports/index.ts` | обёртки | 0 импортёров. Часть может быть задумана как публичный фасад (`CLAUDE.md`: импортировать из `@/modules/<x>`) | не удалять без решения: фасад `modules/<x>/index.ts` по правилам проекта должен существовать |

### Г. Конфигурация

| # | Объект | Файл:строка | Доказательство | Рекомендация | Статус |
|---|--------|-------------|----------------|--------------|--------|
| 16 | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER_ARG` в примерах; `OTEL_ENABLED=false` | `setup.sh:80`, `scripts/generate-env-docker.ps1:89` | в коде `process.env.OTEL_*` нет | убрать вместе с зависимостями (п. 1) | ПРОЙДЕНО |
| 17 | `PIN_LOOKUP_SECRET` | `Dockerfile:26`, `prisma/schema.prisma:100` (комментарий) | код читает `DEVICE_KEY_LOOKUP_SECRET`, а `PIN_LOOKUP_SECRET` нигде не читается | убрать из Dockerfile и примеров, если PIN-вход не возвращается | ГИПОТЕЗА (не проверял историю PIN-входа) |
| 18 | `.env.example` (25 строк) | `.env.example` | в трёх примерах 31 переменная, в коде ~78; нет, например, `METRICS_SCRAPE_TOKEN`, `TRUST_PROXY`, `DB_IDENTITY_ROLE`, `TELEGRAM_API_BASE`, `S3_*`, `DEVICE_KEY_LOOKUP_SECRET`; `TRUST_PROXY` описан в `scripts/validate-env.ts:133` | завести единый перечень в одном примере с пометкой «обязательна на проде» | ПРОЙДЕНО (разница посчитана); часть переменных могла жить в `.env` сервера — НЕ ПРОВЕРЕНО |
| 19 | Лишние файлы в корне, лежащие в git | `Dockerfile.quick`, `SETUP-GUIDE.sh`, `setup.bat`, `load-test-results.json` | `Dockerfile.quick` и `load-test-results.json` ссылок кроме `scripts/load-test.js:156` и аудитов не имеют; `setup.bat` упомянут в `README.md:13,41`; остальные корневые png/log/dump в git не попали (в `.gitignore`) | `Dockerfile.quick` и `load-test-results.json` — кандидаты на удаление по решению владельца | ПРОЙДЕНО |

### Д. Версии

| # | Объект | Файл:строка | Доказательство | Рекомендация |
|---|--------|-------------|----------------|--------------|
| 20 | Патчи и минорные: `@sentry/nextjs` 11.6.0→11.7.0, `bullmq` 6.3.12→6.3.15, `vitest`, `@vitest/coverage-v8` 5.0.3→5.0.4, `@playwright/test` 1.64.0→1.64.1, `zod` 4.6.5→4.6.7, `@aws-sdk/*` 3.1149→3.1151, `framer-motion`, `lucide-react`, 10 пакетов `@radix-ui/*` | `package.json` | `npm outdated` | одним обновлением с полным прогоном тестов |
| 21 | Крупные скачки: TypeScript 6.0.3→7.0.2, ESLint 9.39.5→10.12.0, Prisma 7.10.0→8.0.0-rc.22, happy-dom 20→21 | `package.json` | `npm outdated` | оставить; решено 10.10.2026 (причины в памяти проекта) |
| 22 | `@types/bcryptjs` | `package.json` | `npm outdated`: текущая 3.0.0, «Latest» 2.4.6 (нумерация откатилась) | не трогать: это не отставание |

## Не проверено

- Неиспользуемые экспорты внутри файлов, которые импортируются (нужен инструмент вроде knip; ставить не стал).
- Динамические импорты со строкой, собранной из переменных, поиск по шаблону не видит.
- Переменные окружения, заданные только в `.env` на сервере: на сервер для этого отчёта не заходил.
- `next.config.ts` и `tsconfig.json` разбирались только на предмет ссылок на зависимости, настройки сборки не оценивались.
- Рабочие копии и файлы вне репозитория (`agents/`, `examples/`, `chaos/`) учитывались как потребители, но сами не разбирались.
