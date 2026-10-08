# W90 — уязвимости npm: что нас касается напрямую, а что приходит «поездом»

Повод: `npm audit` в корне проекта. Владельцу нужно понять, что реально опасно для
сервера. Задача выполнена только чтением; `package.json` и `package-lock.json` не
менялись, `npm audit fix` не запускался.

Смотрел: вывод `npm audit --json` (запущен в этом worktree, сеть была доступна),
`package.json`, `package-lock.json`, `npm ls --omit=dev --all`, `next.config.ts`,
`src/core/media/*`, поиск по `src/`.

## Итог

- **Уточнение к формулировке задачи.** В контексте задачи перечислены 3 уязвимости
  high (braces, deepmerge-ts, mysql2). Фактический `npm audit` показывает **12 high**
  (critical 0). Из них **прямых** — 4 (`next`, `sharp`, `eslint-config-next`, `prisma`),
  остальные 8 — транзитивные. Ниже разобраны все 12.
- my severity: **критично — 0**, **важно — 2**, **мелочь — 10**.
- **Топ-5 (по важности для сервера):**
  1. `next` 16.3.6 (прямая, рантайм) — среди advisory SSRF в Image Optimization и
     отравление кеша SSG/ISR. Фикс не-мажорный (16.4.0). Ранняя оценка достижимости —
     низкая (нет `remotePatterns`, нет ISR), но обновиться дёшево [находка 1].
  2. `sharp` 0.35.4 (прямая, рантайм) — обрабатывает **фотографии, загруженные
     пользователем** (`src/core/media/media-service.ts:277`). Фикс не-мажорный (0.35.5)
     [находка 2].
  3. Цепочка `prisma → @prisma/config → deepmerge-ts` и `prisma → mysql2` — прямых в
     `src/` вызовов нет, `mysql2` не используется вовсе (провайдер PostgreSQL)
     [находки 4–7].
  4. Линтерный инструментарий `eslint-config-next → … → braces/micromatch/fast-glob` —
     только dev/CI, на сервер не уезжает [находки 7–9].
  5. `source-map-js` — сборочный (postcss), в рантайме не участвует [находка 10].
- **Одна строка:** серверу сейчас ничего критичного не грозит; стоит планово
  обновить `next` (16.3.6 → 16.4.0) и `sharp` (0.35.4 → 0.35.5) — оба не-мажорные;
  цепочку `prisma`/`eslint` не трогать, `npm audit fix --force` не запускать
  (он откатывает prisma 7 → 6).

## Методика (воспроизводимо)

1. Аудит без изменений: `npm audit --json > <файл>` (exit code 1 = есть находки;
   файл разобран через `node -e "require(...)"`).
2. Разбор по severity/прямоте/через кого — из того же JSON
   (`metadata.vulnerabilities`, `vulnerabilities[*].severity/isDirect/via/fixAvailable`).
3. Версии и признак «dev» — из lock:
   `node -e "const l=require('./package-lock.json').packages; console.log(l['node_modules/<pkg>'].version, l[...].dev)"`.
   Прямые объявления ищутся в `package.json` (`dependencies`/`devDependencies`/`overrides`).
4. Кто кого тянет: обход всех `packages[*].dependencies/peerDependencies/optionalDependencies`
   и реверс-индекс «кто зависит от X» (node-скрипт).
5. Что реально в прод-дереве (без dev): `npm ls --omit=dev --all | grep …`.
6. Использование в коде: `grep -rn "<pkg>" src/`; для sharp/next — просмотр
   `src/core/media/media-service.ts`, `src/core/media/media-content.ts`, `next.config.ts`,
   поиск `use cache|unstable_cache|revalidate|generateStaticParams` по `src/app`.
7. Контекст CI: `grep -rn "npm run lint" .github`.

## Находки

Порядок — от того, что касается сервера, к тому, что не касается.

| # | severity | path:line | проблема | сценарий / почему важно | что сделать |
|---|---|---|---|---|---|
| 1 | важно | `package.json:103` (объявлен `"next": "16.3.6"`); `package-lock.json` → `node_modules/next` v16.3.6; advisory: SSRF GHSA-cjq9-62q9-8jv4 (high, CVSS 6.5), кеш-отравление SSG/ISR GHSA-4jqv-mc3x-m676 / GHSA-mcj8-r9mp-w47p (moderate), утечка Draft Mode GHSA-3w37-wq28-93x7 (moderate), dev-MCP GHSA-39w2-rjm5-chcv (low); `next.config.ts` (весь файл) | **Прямая** зависимость, это и есть веб-сервер приложения. Все advisory закрыты с 16.3.8, фикс предлагается как **16.4.0, isSemVerMajor: false**. Достижимость у нас ограничена: в `next.config.ts` **нет** блока `images` (ни `remotePatterns`, ни `localPatterns` — проверено грепом по `next.config.ts` и `src/app`), поэтому SSRF через Image Optimization для чужих URL не открыт; ISR/`use cache`/`generateStaticParams` в `src/app` не найдены — кеш-отравление SSG/ISR не про наш рендеринг. То есть сейчас это «латентно», но сервер интернет-доступен и обновление не-мажорное | Обновить `next` до 16.4.0 (не-мажорно, ломаться не должно; прогонять `npm run build` + смоук). Не через `npm audit fix --force` |
| 2 | важно | `package.json:112` (`"sharp": "^0.35.3"`), `package.json:126` (override `sharp ^0.35.3`); lock `node_modules/sharp` v0.35.4; использование — `src/core/media/media-service.ts:277-285`; advisory GHSA-wq5f-xc86-pv6w (high, CVE-2026-96889, librsvg) | **Прямая** зависимость, вызывается **в рантайме на пользовательском вводе**: `await import('sharp')` → `sharp(sourceBytes)` при подтверждении загрузки фото (`media-service.ts:266-285`). Фикс доступен и не-мажорный: 0.35.5 (`fixAvailable: true`). Важная оговорка (снижает риск): CVE — про **librsvg**, т.е. путь SVG, а allowlist типов (`src/core/media/media-content.ts:65-80`) SVG **не разрешает** (только jpeg/png/webp/gif/heic/heif + pdf/doc/docx), плюс есть проверка magic-bytes (`media-content.ts:138-143`, вызов `media-service.ts:266`). Дополнительно: бинарь libvips в поставке **содержит** librsvg (grep по `node_modules/@img/sharp-win32-x64/lib/libvips-42.dll` находит `librsvg`/`svgload`) — то есть уязвимый код физически есть, но дотянуться до него вводом через приложение нельзя | Обновить override и зависимости `sharp` до `^0.35.5` (не-мажорно). Правку `package.json` делает владелец — я не менял |
| 3 | мелочь | `package.json:146` (`"prisma": "^7.8.0"`, **devDependencies**); lock `node_modules/prisma` v7.10.0 (`dev=false`); `package.json:78` (`@prisma/client ^7.8.0`) | `prisma` объявлен dev-зависимостью, но `npm ls --omit=dev --all` показывает его **в прод-дереве** (peer `@prisma/client` → `prisma`): строки вывода 215–216, 240, 394. Отсюда и «high» в скане — это CLI-подграф, не рантайм. Рантайм использует `@prisma/client` + `@prisma/adapter-pg` (`src/lib/db.ts:13,98`, провайдер `postgresql`). Advisory `prisma` — сводный (via `@prisma/config`, `mysql2`), отдельных своих CVE в этом выпуске нет | Сверить с R62: пакет «уезжает» в образ воркеров (это отдельная тема про размер). Обновлять/чинить не срочно; ждать релиза Prisma. Фикс `npm audit fix --force` откатывает prisma 7→6 — нельзя |
| 4 | мелочь | lock `node_modules/@prisma/config` v7.10.0; advisory range `6.13.0-dev.1 - 8.1.0-dev.4`, via `deepmerge-ts`; вызов — `node_modules/@prisma/config/dist/index.js:621` | Транзитивная (через `prisma`). Уязвимой является именно вложенная `deepmerge-ts`. В `src/` нет ни одного импорта `prisma/config` (грепал) — конфиг грузится только CLI при `prisma migrate`. Риск низкий | Ничего не делать (ждать обновления Prisma); см. R62 |
| 5 | мелочь | lock `node_modules/deepmerge-ts` v7.1.5 (`dev=false`); advisory GHSA-ggr8-5vv4-36mx (high, CWE-674, стек-истощение при слиянии цикличных объектов) | Транзитивная (через `@prisma/config`). В `src/` импортов нет. Единственная точка исполнения — загрузка `prisma.config.ts` в migrate-контейнере; вход — собственный файл репозитория, не пользовательские данные | Не форсировать override; см. находку 4 и R62 |
| 6 | мелочь | lock `node_modules/mysql2` v3.15.3 (`dev=false`); advisory GHSA-3f6p-5ww8-9rcr (high) + GHSA-rgwj-5xj2-c3m3 (moderate); `npm audit --json` via `prisma` | Транзитивная (через `prisma`), **в коде не используется**: `grep -rn "mysql2" src/` — 0 совпадений. Провайдер БД — PostgreSQL (`prisma/schema.prisma`), доступ через `@prisma/adapter-pg` (`src/lib/db.ts:13,98`). `mysql2` подключается лениво и только для mysql-провайдера. Риск для сервера — **отсутствует** | Ничего. Это подтверждение вывода R62 (machen-verified) |
| 7 | мелочь | `package.json:141` (`"eslint-config-next": "^16.3.6"`, devDependencies); lock `node_modules/eslint-config-next` v16.3.6 (`dev=true`); advisory range `>=14.3.0-canary.0`, via `@next/eslint-plugin-next` | **Прямая**, но **только dev**: линтер. На сервер (прод-образ) не уезжает. Исполняется в CI: `.github/workflows/ci.yml:56` → `npm run lint` (`package.json:18`). «Фикс» сканера — **даунгрейд до 14.2.35, isSemVerMajor: true** — делать нельзя | Ничего; игнорировать. При обновлении `next` подтянется и эта пара |
| 8 | мелочь | lock `node_modules/@next/eslint-plugin-next` v16.3.6 (`dev=true`); lock `node_modules/fast-glob` v3.3.1 (`dev=true`); lock `node_modules/micromatch` v4.0.8 (`dev=true`) | Транзитивные dev-зависимости линтера: `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`. В прод-образ не входят, в рантайме не участвуют | Ничего |
| 9 | мелочь | lock `node_modules/braces` v3.0.3 (`dev=true`); advisory GHSA-vfj7-8cjw-p6xm (high, CWE-674), range `<=3.0.3` | Транзитивная **dev**-зависимость (`micromatch` → `braces`), только линтер/сборка. Рантайма сервера не касается. `grep -rn "braces" src/` — только слово в комментарии (`src/services/telemetry/device-key-service.ts:134`), не пакет | Ничего срочного. Обновится само при обновлении `eslint-config-next` |
| 10 | мелочь | lock `node_modules/source-map-js` v1.2.1 (`dev=false`); advisory GHSA-68fv-2mgg-jv7q (high, CWE-1284), range `1.0.0 - 1.2.1` | Транзитивная; тянется через `postcss` (от `next`), а также `css-tree`/`@tailwindcss/node`/`magicast` (`css-tree`/`@tailwindcss/node` — dev). `postcss` обрабатывает исходники **на сборке**, в рантайме не вызывается; в `src/` импортов `source-map-js` нет. Фикс доступен (`fixAvailable: true`) | Ничего; подтянется при обновлении postcss/next |

## Не проверено

- **Точный состав прод-образов и версия libvips на Linux.** Локально установлен
  win32-бинарь (`node_modules/@img/sharp-win32-x64`); содержит ли linux-сборка
  librsvg с тем же CVE — не проверял (нет Docker-сборки в этой сессии). Это влияет
  только на «насколько deep» риск по находке 2 — сама рекомендация обновиться не
  меняется.
- **Достижимость advisory `next` в бою** оценена по конфигу (`next.config.ts` без
  `images`/`remotePatterns`; `use cache`/ISR не найдены), но не воспроизведена
  реальным запросом к Image Optimization / не проверено поведение дефолтного
  image-оптимизатора на этой версии.
- **Наличие свежих релизов** `next 16.4.0` и `sharp 0.35.5` в реестре — версии взяты
  из ответа `npm audit --json`, отдельно `npm view` не запускал.
- **CI deploy.yml/integration.yml** целиком не читал (смотрел только строку про
  `npm run lint` в `ci.yml`).
- **Рантайм воркеров** (исполняет ли он загрузку конфига Prisma) — унаследовано из
  R62 как непроверенное, здесь не перепроверял.
