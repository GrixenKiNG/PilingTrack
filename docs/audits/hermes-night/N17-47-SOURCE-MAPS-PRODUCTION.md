# N17-47-SOURCE-MAPS-PRODUCTION: исходные карты в боевой сборке

Независимый аудит PilingTrack. Ревизия: `git rev-parse HEAD` = `3ce0aea0d61eef33ed2d59d3ebad15be4d4b6689` (короткий `3ce0aea0`), ветка `hermes/code-1011`, рабочая папка `D:/PillingR/wt-night-code`.
Только чтение: код приложения не менялся, закоммичен только этот отчёт.
Замечание о пути: папки `D:/PillingR/wt-night-code-code` не существует (проверено: `[ -d ] → NO`); работал в фактической рабочей папке `D:/PillingR/wt-night-code`.

## Итог

- Исходных карт клиента в боевой сборке **НЕТ** и публично они **не отдаются**. Причина не в защите, а в связке: `next.config.ts:154` отключает работу Sentry с картами при пустом `SENTRY_AUTH_TOKEN`, а `productionBrowserSourceMaps` не включён нигде, поэтому Next собирает клиент с `devtool = false`.
- Токена `SENTRY_AUTH_TOKEN` **нет на этапе `docker build`**: его не передаёт ни `scripts/deploy-prod.sh`, ни `docker-compose.yml`, а `.dockerignore` исключает `.env*`. Значит карты **не загружаются и в Sentry** → в Sentry стеки минифицированы (важно, наблюдаемость).
- Итоговая боевая утечка исходников сейчас = **нет** (ПРОЙДЕНО). Но защита **хрупкая**: она держится на отсутствии токена, а не на явном запрете/удалении. Стоит добавить токен ради читаемых стеков — появятся карты, и от публикации будет защищать только `deleteSourcemapsAfterUpload`, чьи ошибки удаления глушатся (§ webpack/index.js).
- Ещё одно: edge/серверные карты Next штампует **всегда** (`devtool='source-map'`), и они лежат в образе в `.next/server/**`, не удаляются. По HTTP не отдаются, поэтому — мелочь.
- Всего находок: 0 критично / 2 важно / 13 мелочь (итого 15). Ключевая — связка «нет токена ⇒ нет карт» + отсутствие явного `productionBrowserSourceMaps: false`.

Таблица по вопросам задания:

| вопрос | ответ | файл:строка | риск |
|---|-----|-----|-----|
| 1. Отдаются ли `.map` публично по адресу страницы? | НЕТ в текущей боевой сборке: клиентские карты не генерируются (`devtool=false`), файлов `.map` нет — отдавать нечего. Отдача любых `.next/static/**` фильтра по расширению не имеет, т.е. появившийся `.map` был бы скачиваем. | `next.config.ts:154`; `node_modules/next/dist/build/webpack/config/blocks/base.js:43-49`; `node_modules/@sentry/nextjs/build/esm/config/webpack.js:224-231`; `node_modules/next/dist/server/serve-static.js` | низкий сейчас / средний при появлении токена |
| 2. Загружаются ли карты в Sentry и удаляются ли после загрузки? | В боевом пути НЕ загружаются: токен не попадает в `docker build`. Механизм удаления при наличии токена работает и, судя по коду плагина, удаляет файлы даже при сбое загрузки (удаление в `finally`). | `scripts/deploy-prod.sh:88`; `docker-compose.yml:65-66`; `.dockerignore:16`; `.env.production.example:24-25`; `node_modules/@sentry/bundler-plugins/build/esm/webpack/index.js:195-203` | важно (Sentry нечитаем) |
| 3. Есть ли в картах исходники/комментарии/внутренние пути/адреса стенда? | Если карты появятся — да: `sourcesContent` = полный исходник с комментариями, `sources` = внутренние пути. Адресов стенда/прод-IP в `src/` нет (grep пуст). Статус — ГИПОТЕЗА: фактический вывод сборки не проверял (`.next` в worktree отсутствует). | `node_modules/next/dist/build/webpack-config.js:1047`; `src/proxy.ts:19`; `src/app/sitemap.ts:10` | мелочь (карты не отдаются) |
| 4. Как проверить на стенде без боевого сервера? | Собрать локально (`npm run build`), искать `.map` в `.next/static` (ожидаем 0); поднять `node .next/standalone/server.js` и сделать HEAD на `/_next/static/.../<chunk>.js.map` (ожидаем 404), проверить заголовки `SourceMap`/`X-SourceMap` (ожидаем отсутствие). | `scripts/copy-standalone-assets.js:32-35`; `node_modules/next/dist/server/serve-static.js`; `package.json:8` | — (инструкция) |

## Методика

Что и как искал (повторяемо):

1. Ревизия и состояние: `git rev-parse HEAD`, `git branch --show-current`, `git status --short`.
2. Конфиг Next: прочитан `next.config.ts` целиком (особенно блоки `env`, `turbopack`, `headers`, `withSentryConfig.sourcemaps`).
3. Sentry: прочитаны `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/instrumentation.ts`, `src/instrumentation-client.ts`; прогон по репозиторию `grep -rniE "sourcemap|productionBrowserSourceMaps"` (вне node_modules) и `grep SENTRY_AUTH_TOKEN`.
4. Сборка/образы: прочитаны `Dockerfile`, `deploy/Dockerfile.prod`, `Dockerfile.quick`, `.dockerignore`, `docker-compose.prod.yml`; `grep` по `docker-compose*.yml` на `build/args/APP_VERSION`; прочитан `scripts/deploy-prod.sh`; проверено наличие `.env.sentry-build-plugin` (нет).
5. Скрипты сборки: `package.json` (scripts `build`), `scripts/validate-env.ts`, `scripts/copy-standalone-assets.js`.
6. Поведение библиотек по исходникам (для точного ответа, а не по памяти):
   - `node_modules/@sentry/nextjs/build/esm/config/webpack.js` (когда SDK включает devtool и когда добавляет плагин);
   - `node_modules/@sentry/nextjs/build/esm/config/withSentryConfig/getFinalConfigObjectBundlerUtils.js` (авто-включение `productionBrowserSourceMaps` только для Turbopack);
   - `node_modules/@sentry/nextjs/build/esm/config/getBuildPluginOptions.js` (какие файлы удаляются);
   - `node_modules/@sentry/bundler-plugins/build/esm/webpack/index.js` (порядок upload/delete);
   - `node_modules/@sentry/bundler-plugins/build/esm/core/build-plugin-manager.js` (`canUploadSourceMaps`, `deleteArtifacts`);
   - `node_modules/next/dist/build/webpack/config/blocks/base.js` (дефолтный `devtool` в проде);
   - `node_modules/next/dist/server/serve-static.js` (как отдаётся статика).
7. Диффы/прошлые отчёты: `grep` по `docs/audits/hermes-night/AU170-S7-SENTRY-CONFIG.md`, `AU214`, `AU229`.
8. Поиск потенциальных «секретов» в бандле: `grep -rn "87.242.102.125" src/`; `grep -rniE "staging|\.local|10\.0\.0\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\."` по `src/`.
9. Артефакты: проверено наличие `.next` (нет) и `git ls-files '*.map'` (0 файлов).

Ограничение: приложение не собирал (нужны env/БД, AGENTS.md запрещает подделывать env), поэтому часть выводов — из кода библиотек, а не из фактического вывода сборки. Это отмечено статусом ГИПОТЕЗА.

## Находки

Статусы: ПРОЙДЕНО — проверено в коде; ГИПОТЕЗА — следует из кода, фактический вывод не проверял; НЕ ПРОВЕРЕНО — доступа/данных нет.

| # | серьёзность | статус | path:line | проблема | сценарий / почему важно | как чинить |
|---|---|---|---|---|---|---|
| 1 | важно | ГИПОТЕЗА | `next.config.ts:154` + `node_modules/@sentry/bundler-plugins/build/esm/core/build-plugin-manager.js:493-497` | Защита от публикации карт держится на ОТСУТСТВИИ токена, а не на явном запрете; ошибки удаления карт глушатся (`.catch` в `deleteArtifacts`). | Владелец добавляет `SENTRY_AUTH_TOKEN` на сборку ради читаемых стеков → `sourcemaps.disable=false` → клиент собирается `devtool=hidden-source-map` → появляются `*.js.map`. Если удаление не выполнится (сбой/исключение), файлы останутся в `.next/static` и будут скачиваться: Caddy проксирует всё (`deploy/Caddyfile.prod:51-54`), фильтра по `.map` нет. | Задать явно `productionBrowserSourceMaps: false`; добавить блокировку `*.map` на прокси; не глушить ошибки удаления карт. |
| 2 | важно | ПРОЙДЕНО (что не передаётся) / НЕ ПРОВЕРЕНО (прод-`.env`) | `scripts/deploy-prod.sh:88`, `docker-compose.yml:65-66`, `.dockerignore:16`, `.env.production.example:24-25` | `SENTRY_AUTH_TOKEN` не попадает в `docker build`: в build-arg передаётся только `APP_VERSION`; `.env*` исключены из контекста. | В Sentry стек-трейсы боевых ошибок остаются минифицированными, хотя сам файл `.env.production.example:24-25` прямо требует токен «at BUILD TIME». Наблюдаемость деградирует молча. | Передавать токен на этапе сборки (`--secret`/`--build-arg`) в деплой-скрипте; либо осознанно принять, что стеков нет. |
| 3 | ПРОЙДЕНО | `next.config.ts:154`; `node_modules/next/dist/build/webpack/config/blocks/base.js:43-49`; `node_modules/@sentry/nextjs/build/esm/config/webpack.js:224-231` | В текущей боевой сборке клиентские `.map` не генерируются, публичной утечки нет. | Без токена `disable=true` → блок включения devtool пропускается; `productionBrowserSourceMaps` по умолчанию `false` → `devtool=false` → нет `.js.map` в `.next/static`. | — (подтверждение отсутствия проблемы; укрепить см. #1/#5). |
| 4 | мелочь | ПРОЙДЕНО | `node_modules/@sentry/nextjs/build/esm/config/getBuildPluginOptions.js:126-137` | Удаление карт покрывает только `.next/static/**`; серверные/edge-карты не удаляются. | `filesToDeleteAfterUpload` = `static/**/*.{js,mjs,cjs,css}.map`. `.next/server/**` карты (см. #6) остаются в образе с полным исходником. По HTTP не отдаются → риск низкий. | При необходимости добавить глоб и для `server/**`, либо задокументировать, что серверные карты в образе допустимы. |
| 5 | мелочь | ГИПОТЕЗА | `next.config.ts:5-119` (отсутствие ключа) | Нет явного `productionBrowserSourceMaps: false` — опора на дефолт фреймворка. | Смена бандлера/версии может изменить дефолт. Особенно: Sentry авто-включает `productionBrowserSourceMaps=true`, но ТОЛЬКО для Turbopack (`getFinalConfigObjectBundlerUtils.js:121-132`). Сейчас сборка webpack (`package.json:8`), путь другой, но хрупко. | Добавить `productionBrowserSourceMaps: false` в `nextConfig`. |
| 6 | мелочь | ПРОЙДЕНО | `node_modules/next/dist/build/webpack/config/blocks/base.js:44-46` | Edge-рантайм собирается с `devtool='source-map'` ВСЕГДА, в проде, независимо от Sentry/токена. | `.next/server/**` содержит карты edge/middleware с `sourcesContent`. Они в образе, но не в `.next/static`, поэтому по HTTP недоступны (низкий риск). | Не требует действий; важно для полноты картины «что лежит в образе». |
| 7 | мелочь | ПРОЙДЕНО | `deploy/Caddyfile.prod:51-54`; `next.config.ts:87-118` | Нет ни прокси-правила, ни app-заголовка, блокирующего `/_next/static/**/*.map`. | «Глубокоэшелонированной» защиты нет: если карта появится, её отдадут. Полагаться только на «карт нет» — один слой. | Добавить в Caddy matcher / в `headers()` запрет на `*.map` (404/403). |
| 8 | мелочь | ПРОЙДЕНО | `node_modules/@sentry/nextjs/build/esm/config/webpack.js:229-231` | `hidden-source-map` НЕ удаляет файлы `.map`, только убирает комментарий `//# sourceMappingURL`. | При наличии токена файлы существуют на диске и скачиваемы по прямому URL, даже если браузер их не тянет автоматически. | Помнить при включении токена; комбинировать с блокировкой `*.map` (#7). |
| 9 | мелочь | ПРОЙДЕНО | `node_modules/@sentry/nextjs/build/esm/config/getBuildPluginOptions.js:75-76,91-92` | `widenClientFileUpload: true` (`next.config.ts:132`) расширяет набор загружаемых/удаляемых карт до всего `static/chunks/**`. | Если удаление когда-нибудь сработает не для всех файлов, «площадь» потенциальной утечки больше, чем при узком наборе. | Оставить `widenClientFileUpload` только если реально нужно (сейчас — да для читаемых стеков). |
| 10 | мелочь | ПРОЙДЕНО | `node_modules/@sentry/bundler-plugins/build/esm/webpack/index.js:195-203` | Удаление карт выполняется в `finally` (даже при сбое загрузки) — плюс, но только в хуке `afterEmit`. | Если сборка прервётся (OOM/`kill`) до `afterEmit`, `.map` останутся в `.next/static`, а `Dockerfile:96` скопирует их в образ. | Добавить защитный шаг удаления `*.map` из `.next/static` после сборки (или блокировку на прокси #7). |
| 11 | мелочь | ПРОЙДЕНО | `Dockerfile:95-97`; `scripts/copy-standalone-assets.js:32-35` | И образ, и `copy-standalone-assets.js` копируют `.next/static`/`.next/standalone` БЕЗ фильтрации `.map`. | Любой оставшийся `.map` попадёт в отдаваемый каталог без дополнительной проверки. | Копировать/фильтровать осознанно; проще — блокировка `*.map` на уровне прокси. |
| 12 | мелочь | ГИПОТЕЗА | `node_modules/next/dist/build/webpack-config.js:1047` | В проде вебпак использует дефолтный шаблон имён модулей → в `sources` карт будут внутренние пути `webpack://_N_E/./src/...`. | Если карта утечёт, раскроется структура модулей (имена файлов/каталогов). `sourcesContent` добавит полный исходник с комментариями. | Не требуется, пока карты не публикуются; учесть в оценке риска при включении карт. |
| 13 | мелочь | НЕ ПРОВЕРЕНО | `docs/audits/hermes-night/AU170-S7-SENTRY-CONFIG.md:79,107` | Прошлый отчёт уже поднимал ровно этот вопрос и помечал его как ГИПОТЕЗУ #11 («не проверял фактический вывод сборки»). | Вопрос остаётся неподтверждённым фактической сборкой и здесь: `.next` в worktree отсутствует, сборку не запускал. | Закрыть одним прогоном `npm run build` + `find .next/static -name '*.map'` (см. Q4). |
| 14 | мелочь | ПРОЙДЕНО | `Dockerfile:104`; `src/generated/postgres-client/runtime/*.js` | В образ копируется `src/generated`, где `runtime/*.js` содержат `//# sourceMappingURL=...map`, но самих `.map` в репозитории нет. | Это серверный код (не клиентский бандл), по HTTP не отдаётся. Влияния на публичную утечку нет. | Не трогать; упомянуто, чтобы не принять «sourceMap» из `grep` за находку. |
| 15 | мелочь | ПРОЙДЕНО | `src/proxy.ts:19`, `src/app/sitemap.ts:10` | В исходниках нет прод-IP и адресов стенда; есть только `localhost:3000` и публичный `orionpiling.ru`. | Даже в гипотетическом `sourcesContent` карт реального адреса стенда/боевого сервера не будет. | — (подтверждение). |

Приложение (пути без разбора): `node_modules/@sentry/nextjs/build/esm/config/getFinalConfigObject.js:45`, `node_modules/@sentry/nextjs/build/esm/config/util.js:117-124` (`detectActiveBundler`), `node_modules/@sentry/bundler-plugins/build/esm/core/options-mapping.js:16`, `node_modules/next/dist/server/lib/router-utils/filesystem.js` (нет спец-обработки `.map`), `src/__tests__/sentry-config.test.ts:16`.

## Не проверено

- **Фактический вывод сборки.** Приложение не собирал (нужны env/БД; AGENTS.md запрещает подделывать env). Поэтому утверждение «в `.next/static` нет `.map`» — вывод из кода Next/Sentry, а не из реального `.next`. Папка `.next` в worktree отсутствует (проверено). Прямое подтверждение — прогон Q4.
- **Наличие/содержимое `.env` на боевом сервере.** `.env*` читать запрещено AGENTS.md; проверить, лежит ли там реальный `SENTRY_AUTH_TOKEN`, нельзя. Но даже при его наличии он не попал бы в `docker build` (build-arg не объявлен, `.env*` вне контекста) — это ПРОЙДЕНО по конфигу деплоя.
- **Наличие `.env.sentry-build-plugin` локально** — файла нет (проверено `[ -f ] → NO`), содержимое не читал (это `.env*`).
- **`sourcesContent` в реальной карте вебпака** — не проверял на выходе; поведение выведено из общеизвестного дефолта `source-map`/`hidden-source-map` вебпака и строки `webpack-config.js:1047`. Статус ГИПОТЕЗА.
- **Edge/серверные карты в собранном образе** (файлы `.next/server/**/*.map`) — не подтверждено фактическим выводом; вывод из `base.js:44-46`.
- **Боевой образ** не поднимал; проверка `curl` по `/_next/static/...map` на живом инстансе не выполнялась.
- Замороженные зоны (экраны оператора, сайт ORION) не проверялись и не затрагивались — они к теме не относятся.

## Как проверить на стенде (пошагово, без боевого сервера)

```bash
# 1) собрать (нужны env/БД)
npm run build
# 2) карт нет в статике (ожидаем 0 строк)
find .next/static -name '*.map'
find .next/standalone/.next/static -name '*.map'
# 3) поднять прод-подобно
node .next/standalone/server.js &   # порт 3000
# 4) взять имя клиентского чанка со страницы и постучаться за его картой (ожидаем 404)
CH=$(curl -s http://localhost:3000/login | grep -o '/_next/static/[^"]*\.js' | head -1)
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3000${CH}.map"     # ожидаем 404
curl -sI "http://localhost:3000${CH}" | grep -iE 'sourcemap|x-sourcemap'      # ожидаем пусто
curl -s "http://localhost:3000${CH}" | grep -c sourceMappingURL               # ожидаем 0
# 5) эксперимент «с токеном» (осторожно, только на стенде и без реального токена):
#    SENTRY_AUTH_TOKEN=dummy npm run build
#    find .next/static -name '*.map'   # если появятся — вот он, вектор утечки (#1, #8)
```

Проверять надо именно путь `.map`-файла и заголовки `SourceMap`/`X-SourceMap`: комментарий `//# sourceMappingURL` в проде и так отсутствует (`hidden-source-map`), поэтому по нему наличие карт не определить.
