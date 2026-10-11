# AU229-S7-DEPENDENCY-LICENSES — Лицензии зависимостей PilingTrack

Версия (git rev-parse HEAD): `bcffe47b071821d7eff5d89459f5376c35add081`
Ветка: `hermes/q4-0926`. Источник данных: `package-lock.json` (lockfileVersion 3, 15481 строк), `package.json`. Установка/скачивание не выполнялись.

## Итог

- Прямые зависимости (49 prod + 22 dev, всего 71): ВСЕ под разрешительными лицензиями (MIT / Apache-2.0 / ISC / BSD-2/3-Clause). Копилефта среди прямых зависимостей НЕТ. — ПРОЙДЕНО.
- Всего в lock 1042 установленных записи, 23 разные лицензии; у 1040 есть поле `license`, у 2 — нет.
- Копилефт/ограничивающие семейства (всего / в prod-дереве): LGPL = 14 / 14 (все через `sharp`), FSL = 9 / 9 (через `@sentry/cli`), MPL-2.0 = 25 / 0 (dev-only), EPL-2.0 = 1 / 0 (dev-only). GPL/AGPL/SSPL — НЕТ ни одного.
- Топ-5 по важности:
  1. `@sentry/cli@2.58.6` — лицензия FSL-1.1-MIT (не OSI, source-available с non-compete), находится в prod-дереве и присутствует в локальном `.next/standalone`. `package-lock.json:4869`.
  2. `@img/sharp-libvips-*` / `sharp` — LGPL-3.0-or-later, prod (движок обработки картинок Next). `package-lock.json:1850`.
  3. `png-js@1.1.0` — нет поля `license` в lock, prod (тянется через `pdfkit`). `package-lock.json:12471`.
  4. `seq-queue@0.0.5` — нет поля `license` в lock, dev-only (через `prisma` → `mysql2`). `package-lock.json:13440`.
  5. `caniuse-lite` — CC-BY-4.0 (требует атрибуции), prod-reachable через `browserslist`/`next`. `package-lock.json:7883`.
- Статус в целом: ГИПОТЕЗА по правовым выводам (тексты лицензий не читались), ПРОЙДЕНО по факту «прямые зависимости чистые», ПРОЙДЕНО по факту «нет GPL/AGPL».

## Методика

Воспроизводимо. Скрипты — только чтение JSON, установок нет (внешние скрипты лежали в scratch, в репозиторий не добавлены).

1. Корень: `git rev-parse HEAD` → `bcffe47b...`.
2. Разбор `package-lock.json` через `node` (JSON.parse): таблица `packages`, ключи `node_modules/*`.
3. Прямые зависимости взяты из `package.json` (`dependencies` + `devDependencies`, 71 шт.), для каждой — версия и `license` из соответствующей записи lock.
4. Распределение лицензий по всем 1042 установленным записям; отдельно отмечены записи без поля `license`.
5. Копилефт-семейства искались регуляркой по полю `license`: `AGPL|LGPL|(^|\W)GPL|MPL|EPL|FSL|CDDL|SSPL|EUPL`.
6. Prod-достижимость: обход графа зависимостей от `packages[""].dependencies` (BFS по `dependencies`+`optionalDependencies` с npm-резолвом «вверх по node_modules»). Дало 439 prod-reachable; полный обход (prod+dev) — 967; dev-only — 528. 75 записей lock обходом не достигнуты (см. «Не проверено»).
7. Проверка «нет поля license» на диске: `node_modules/png-js/LICENSE`, `node_modules/seq-queue/LICENSE` (только чтение).
8. Просмотр `Dockerfile` (стадии), `.next/standalone/node_modules` — для оценки, доходит ли транзитивный копилефт до рантайма.
9. Числа в отчёте — только из вывода команд выше.

## Находки

### A. Риск-таблица (копилефт, ограничивающие и неизвестные лицензии)

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое действие |
|---|---|---|---|---|---|
| 1 | важно | D:\PillingR\wt-night\package-lock.json:4869 (license: 4874) | `@sentry/cli@2.58.6` — лицензия `FSL-1.1-MIT` (Functional Source License: не OSI-approved, source-available, запрещает конкурирующее использование в течение 2 лет, затем становится MIT) | Пакет в prod-дереве (через `@sentry/nextjs` → `@sentry/webpack-plugin` → `@sentry/bundler-plugins`), не помечен dev; присутствует в собранном `.next/standalone/node_modules/@sentry/cli` (package.json:8 license FSL-1.1-MIT). Используется как build-инструмент (загрузка source map), в рантайме не вызывается, но по лицензии — не OSS | Оставить (build-time, non-compete не нарушается для своего продукта), но зафиксировать в THIRD-PARTY NOTICES; при правовой проверке перед продажей — учесть |
| 2 | важно | D:\PillingR\wt-night\package-lock.json:1850 (и 10 записей `@img/sharp-libvips-*`, версия 1.3.3) | `@img/sharp-libvips-*` — `LGPL-3.0-or-later` (нативные бинарники libvips); `sharp` тянет их в prod | LGPL-3 — слабый копилефт. Для SaaS на своём сервере (нет дистрибуции бинарника третьим лицам) обязательства обычно не срабатывают; но если docker-образ передаётся заказчику/клиенту — требуется предложить исходники LGPL-компонента и возможность релинковки. `sharp` — prod-зависимость и трассируется Next в standalone | Зафиксировать в NOTICES; если образ когда-либо будет распространяться — приложить исходники libvips / текст LGPL-3 |
| 3 | важно | D:\PillingR\wt-night\package-lock.json:12471 | `png-js@1.1.0` — в lock НЕТ поля `license`; prod (через `pdfkit@0.18.0`) | Неизвестная лицензия в производственном дереве — комплаенс-риск, пока не подтверждена вручную. На диске установлен `node_modules/png-js` версии 2.0.0 с `LICENSE` = MIT (не 1.1.0 из lock) | Подтвердить лицензию именно tarball-а 1.1.0; вероятно MIT, но зафиксировать документально |
| 4 | мелочь | D:\PillingR\wt-night\package-lock.json:13440 | `seq-queue@0.0.5` — в lock НЕТ поля `license`; dev-only (через `prisma@7.10.0` → `mysql2@3.15.3`, отмечен `devOptional`) | В prod-образ (runner копирует только `.next/standalone`) не попадает. На диске `node_modules/seq-queue/LICENSE` = MIT | Ничего не требуется; при желании — приложить к NOTICES |
| 5 | мелочь | D:\PillingR\wt-night\package-lock.json:7883 | `caniuse-lite@1.0.30001810` — `CC-BY-4.0` (требует атрибуции); prod-reachable через `browserslist` и `next` | Данные о поддержке браузеров; используется на этапе сборки CSS/транспиляции. Формально CC-BY требует указания авторства при распространении | Добавить упоминание в NOTICES |
| 6 | мелочь | D:\PillingR\wt-night\package-lock.json:8580 | `elkjs@0.11.1` — `EPL-2.0` (weak copyleft); dev-only (через `prisma@7.10.0` → `@prisma/studio-core`) | В рантайм не попадает. EPL — файловый копилефт | Ничего не требуется |
| 7 | мелочь | D:\PillingR\wt-night\package-lock.json:11037 (и 14717) | `lightningcss@1.32.0` + `vite/node_modules/lightningcss@1.33.0` — `MPL-2.0` (25 записей lock, все dev) | MPL — файловый копилефт; пакет dev-only (сборка Tailwind/CSS) | Ничего не требуется |
| 8 | мелочь | D:\PillingR\wt-night\package-lock.json:9870 (glob); license 129/155 | `glob@13.0.6`, `minimatch@10.2.6`, `lru-cache@11.5.3`, `minipass`, `path-scurry` — `BlueOak-1.0.0` (9 записей; не OSI-approved, но разрешительная) | Часть — prod-reachable (`glob` через build-tooling Sentry; в рантайме не критично) | При желании отразить в NOTICES |
| 9 | мелочь | D:\PillingR\wt-night\LICENSE:1 | В репозитории есть только `LICENSE` (MIT, Copyright 2026 GrixenKiNG). Файла THIRD-PARTY NOTICES / списка лицензий зависимостей НЕТ | Для дистрибутивного продукта принято прикладывать сводку лицензий. Ограничение AGENTS.md (§1) запрещает менять файлы вне отчёта, поэтому только констатация | Завести `THIRD-PARTY-NOTICES` вне рамок этого аудита |
| 10 | мелочь | D:\PillingR\wt-night\package-lock.json:12472 vs node_modules/png-js/package.json:4 | Версия в lock `png-js` = 1.1.0, а установленная в `node_modules` = 2.0.0 (расхождение) | Признак, что локальный `node_modules` не полностью совпадает с lock; на саму лицензию не влияет (MIT и там, и там), но подрывает доверие к локальной установке | Проверить `npm ci` при следующей чистой установке (в этом аудите не выполнялось) |

### B. Таблица прямых зависимостей (71 шт., все без риска копилефта)

Тип: prod = `dependencies`, dev = `devDependencies`. Лицензия и номер строки — из `package-lock.json`.

| пакет | версия в lock | лицензия | lock:строка | тип |
|---|---|---|---|---|
| @aws-sdk/client-s3 | 3.1138.0 | Apache-2.0 | package-lock.json:180 | prod |
| @aws-sdk/s3-request-presigner | 3.1138.0 | Apache-2.0 | package-lock.json:405 | prod |
| @opentelemetry/api | 1.9.1 | Apache-2.0 | package-lock.json:2645 | prod |
| @opentelemetry/exporter-trace-otlp-http | 0.222.0 | Apache-2.0 | package-lock.json:2681 | prod |
| @opentelemetry/instrumentation | 0.222.0 | Apache-2.0 | package-lock.json:2698 | prod |
| @opentelemetry/sdk-trace-base | 2.11.0 | Apache-2.0 | package-lock.json:2818 | prod |
| @opentelemetry/semantic-conventions | 1.43.0 | Apache-2.0 | package-lock.json:2836 | prod |
| @playwright/test | 1.63.0 | Apache-2.0 | package-lock.json:2863 | dev |
| @prisma/adapter-pg | 7.10.0 | Apache-2.0 | package-lock.json:2878 | prod |
| @prisma/client | 7.10.0 | Apache-2.0 | package-lock.json:2890 | prod |
| @radix-ui/react-alert-dialog | 1.1.23 | MIT | package-lock.json:3114 | prod |
| @radix-ui/react-checkbox | 1.3.11 | MIT | package-lock.json:3164 | prod |
| @radix-ui/react-dialog | 1.1.23 | MIT | package-lock.json:3249 | prod |
| @radix-ui/react-label | 2.1.15 | MIT | package-lock.json:3386 | prod |
| @radix-ui/react-scroll-area | 1.2.18 | MIT | package-lock.json:3544 | prod |
| @radix-ui/react-select | 2.3.7 | MIT | package-lock.json:3575 | prod |
| @radix-ui/react-separator | 1.1.15 | MIT | package-lock.json:3619 | prod |
| @radix-ui/react-slot | 1.3.3 | MIT | package-lock.json:3642 | prod |
| @radix-ui/react-tabs | 1.1.21 | MIT | package-lock.json:3660 | prod |
| @radix-ui/react-toast | 1.2.23 | MIT | package-lock.json:3690 | prod |
| @sentry/nextjs | 10.75.3 | MIT | package-lock.json:5071 | prod |
| @swc/helpers | 0.5.23 | Apache-2.0 | package-lock.json:5382 | prod |
| @tailwindcss/postcss | 4.3.3 | MIT | package-lock.json:5727 | dev |
| @testing-library/jest-dom | 7.0.1 | MIT | package-lock.json:5762 | dev |
| @testing-library/react | 16.3.3 | MIT | package-lock.json:5798 | dev |
| @types/bcryptjs | 3.0.0 | MIT | package-lock.json:5846 | dev |
| @types/pdfkit | 0.17.6 | MIT | package-lock.json:6010 | dev |
| @types/pg | 8.23.1 | MIT | package-lock.json:6019 | dev |
| @types/react | 19.3.0 | MIT | package-lock.json:6031 | dev |
| @types/react-dom | 19.3.0 | MIT | package-lock.json:6041 | dev |
| @vitejs/plugin-react | 6.1.1 | MIT | package-lock.json:6874 | dev |
| @vitest/coverage-v8 | 5.0.1 | MIT | package-lock.json:6904 | dev |
| ajv | 8.20.0 | MIT | package-lock.json:7222 | prod |
| ajv-formats | 3.0.1 | MIT | package-lock.json:7238 | prod |
| bcryptjs | 3.0.3 | BSD-3-Clause | package-lock.json:7634 | prod |
| bullmq | 5.81.5 | MIT | package-lock.json:7761 | prod |
| class-variance-authority | 0.7.1 | Apache-2.0 | package-lock.json:7966 | prod |
| clsx | 2.1.1 | MIT | package-lock.json:8000 | prod |
| cookie | 1.1.1 | MIT | package-lock.json:8071 | prod |
| dotenv | 17.4.2 | BSD-2-Clause | package-lock.json:8540 | prod |
| eslint | 9.39.5 | MIT | package-lock.json:8929 | dev |
| eslint-config-next | 16.3.6 | MIT | package-lock.json:8989 | dev |
| eslint-plugin-react-hooks | 7.1.1 | MIT | package-lock.json:9231 | dev |
| framer-motion | 13.4.2 | MIT | package-lock.json:9668 | prod |
| happy-dom | 20.14.5 | MIT | package-lock.json:10004 | dev |
| ioredis | 5.11.1 | MIT | package-lock.json:10270 | prod |
| jose | 6.2.12 | MIT | package-lock.json:10818 | prod |
| jsdom | 30.1.1 | MIT | package-lock.json:10863 | dev |
| lucide-react | 1.47.0 | ISC | package-lock.json:11407 | prod |
| next | 16.3.6 | MIT | package-lock.json:11776 | prod |
| next-themes | 0.4.6 | MIT | package-lock.json:11829 | prod |
| pdfkit | 0.18.0 | MIT | package-lock.json:12253 | prod |
| pg | 8.23.0 | MIT | package-lock.json:12274 | dev |
| pino | 10.3.1 | MIT | package-lock.json:12390 | prod |
| prisma | 7.10.0 | Apache-2.0 | package-lock.json:12624 | dev |
| react | 19.3.0 | MIT | package-lock.json:12790 | prod |
| react-dom | 19.3.0 | MIT | package-lock.json:12799 | prod |
| react-error-boundary | 6.1.6 | MIT | package-lock.json:12811 | prod |
| recharts | 3.10.1 | MIT | package-lock.json:12948 | prod |
| server-only | 0.0.1 | MIT | package-lock.json:13450 | prod |
| sharp | 0.35.4 | Apache-2.0 | package-lock.json:13505 | prod |
| sonner | 2.0.8 | MIT | package-lock.json:13694 | prod |
| tailwind-merge | 3.7.0 | MIT | package-lock.json:14011 | prod |
| tailwindcss | 4.3.3 | MIT | package-lock.json:14021 | dev |
| tailwindcss-animate | 1.0.7 | MIT | package-lock.json:14027 | prod |
| tsx | 4.23.15 | MIT | package-lock.json:14249 | prod |
| tw-animate-css | 1.4.0 | MIT | package-lock.json:14268 | dev |
| typescript | 6.0.3 | Apache-2.0 | package-lock.json:14377 | dev |
| vitest | 5.0.1 | MIT | package-lock.json:15007 | dev |
| zod | 4.6.5 | MIT | package-lock.json:15433 | prod |
| zustand | 5.0.15 | MIT | package-lock.json:15455 | prod |

### C. Распределение лицензий (все 1042 установленные записи lock)

| лицензия | кол-во записей |
|---|---|
| MIT | 796 |
| Apache-2.0 | 107 |
| ISC | 42 |
| MPL-2.0 | 25 |
| BSD-2-Clause | 14 |
| LGPL-3.0-or-later | 10 |
| BlueOak-1.0.0 | 9 |
| FSL-1.1-MIT | 9 |
| BSD-3-Clause | 9 |
| Apache-2.0 AND LGPL-3.0-or-later | 3 |
| MIT-0 | 2 |
| 0BSD | 2 |
| CC0-1.0 | 2 |
| (нет поля license) | 2 |
| Unlicense | 2 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 |
| MIT and ISC | 1 |
| Python-2.0 | 1 |
| CC-BY-4.0 | 1 |
| EPL-2.0 | 1 |
| (MIT AND Zlib) | 1 |
| (MIT OR CC0-1.0) | 1 |
| MIT AND ISC | 1 |
| **итого** | **1042** |

Сводка по копилефт-семействам (всего записей / из них prod-reachable): LGPL 14 / 14; FSL 9 / 9; MPL 25 / 0; EPL 1 / 0. GPL, AGPL, SSPL, CDDL, EUPL — 0.

## Не проверено

- **Тексты лицензий не читались.** Выводы о совместимости FSL-1.1-MIT / LGPL-3.0 / CC-BY-4.0 с закрытым продуктом — ГИПОТЕЗА на уровне общеизвестных свойств этих лицензий, не юридическая консультация. Тексты лицензий (FSL, LGPL) на диске не открывались.
- **`png-js@1.1.0` (версия из lock) не подтверждена.** В `node_modules` лежит 2.0.0 с `LICENSE` = MIT; tarball 1.1.0 не распаковывался (нет установки/сети). Лицензия именно 1.1.0 — НЕ ПРОВЕРЕНО.
- **Не проверялось, попадает ли `@sentry/cli` в реальный docker-образ.** `Dockerfile:15` ставит все зависимости (`npm ci` без `--omit=dev`); runner-стадия (`Dockerfile:95`) копирует только `.next/standalone`. В локальном `.next/standalone/node_modules/@sentry/cli` пакет ПРИСУТСТВУЕТ, но docker-сборка не запускалась — совпадение с образом ГИПОТЕЗА. `Dockerfile.workers:53` делает `npm prune --omit=dev`.
- **Лицензионные сканеры не запускались** (`license-checker` и др.) — запрет на установку. Все числа получены разбором lock через `node`.
- **75 записей lock не достигнуты обходом графа** (1042 установленных vs 967 достижимых prod+dev) — вероятно повторяющиеся платформенно-специфичные бинарники; их принадлежность prod/dev классифицирована по полю `dev` самого lock, без построения полного дерева.
- **Совместимость `overrides` в `package.json`** (protobufjs, postcss, @hono/node-server, sharp) с лицензиями не анализировалась отдельно.
- **Файлы вне рамок задачи не читались** (env, код приложения, существующие отчёты в `docs/audits/` — по условию задания).
