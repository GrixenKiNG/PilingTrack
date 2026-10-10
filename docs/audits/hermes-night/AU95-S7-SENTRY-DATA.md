# AU95-S7-SENTRY-DATA: Sentry и отправка ошибок — что уходит наружу

Версия рабочей папки: `git rev-parse HEAD` = `69bf2343bd32034bbc54258ed8c117696315c2b1`
(ветка `hermes/q4-0926`, рабочая папка `D:\PillingR\wt-night`). Только чтение, код не менялся.
`@sentry/nextjs` = `^10.53.1` (`package.json:89`), `next` = `16.3.6` (`package.json:103`).

## Итог

Счёт по важности: **критично 0, важно 7, мелочь 9** (всего 16 пунктов; плюс отдельно описанные
проверенные «положительные» факты, которые рисками не являются).

Топ-5:
1. `sendDefaultPii: false` в этой версии SDK **не означает «PII не уходит»**: это лишь маппинг на
   `dataCollection` с deny-списками по именам (`defaultPiiToCollectionOptions.js:18-34`). Тела —
   не уходят, но заголовки/куки/query-параметры уходят, если их имя не содержит сниппет.
2. DSN Sentry **зашит в исходники** в трёх местах (`sentry.server.config.ts:8`, `sentry.edge.config.ts:9`,
   `src/instrumentation-client.ts:8`), а `SENTRY_DSN`/`SENTRY_ORG` в окружении app на пути отправки
   не участвуют — переменные создают ложное впечатление управляемости.
3. Все входящие заголовки запроса попадают в событие (кроме deny-сниппетов):
   `captureRequestError.js:9-12` кладёт `headers` целиком, фильтр снимает только имена с `auth/token/cookie/...`.
4. У Sentry воркера нет DSN по умолчанию в compose (`docker-compose.yml:206` пусто) — ошибки
   outbox/projection/pdf могут не уходить вообще (`src/workers/unified-worker/sentry.ts:24`).
5. Точки окончательной очистки события (`beforeSend`) нигде нет — текст исключения и `extra`
   уходят «как есть».

Резюме для владельца (5 строк):
1. Ошибки приложения уходят в Sentry (Германия, `ingest.de.sentry.io`), в проде включено,
   в dev/test выключено; тела запросов и локальные переменные НЕ уходят — это хорошо.
2. `sendDefaultPii: false` защищает меньше, чем кажется: заголовки, куки и query-параметры
   фильтруются по списку имён, а не целиком; сессионная кука `pt-session` фильтруется, прочие — нет.
3. Ключ Sentry жёстко вшит в код в трёх файлах, хотя в примерах окружения он описан как переменная.
4. Ошибки воркеров уходят только если администратор задал `SENTRY_DSN` в окружении контейнера `workers`.
5. Явной «последней чистки» события (`beforeSend`) нет: если код бросит исключение с персональными
   данными в тексте, оно уйдёт в Sentry без правки.

## Методика

- `git rev-parse HEAD`, `git status --short`, `git branch --show-current` — фиксация версии.
- Поиск файлов: `find . -iname '*sentry*'` (без `node_modules/.git/.next`), `search_files` по
  `Sentry|sentry`, `tunnelRoute|beforeSend|sendDefaultPii|tracesSampleRate|dsn:|ingest\.de\.sentry|SENTRY_DSN`.
- Прочитаны целиком: `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/instrumentation.ts`,
  `src/instrumentation-client.ts`, `src/workers/unified-worker/sentry.ts`, `next.config.ts`,
  `src/core/api-wrapper.ts`, `src/lib/logger.ts`, `src/proxy.ts`, три error-boundary/error-файла,
  планировщики воркера, `src/services/system/system-service.ts`, `scripts/validate-env.ts`.
- Проверка фактического поведения SDK — по установленному коду в `node_modules/@sentry/**`
  (а не по памяти): `defaultPiiToCollectionOptions.js`, `filtering-snippets.js`, `filterKeyValueData.js`,
  `filterCookies.js`, `local-variables-sync.js:192`, `captureRequestError.js`, `config/webpack.js`.
- Поведение `sendDefaultPii` в v10 сверено с документацией Sentry через Context7
  (`/websites/sentry_io_platforms_javascript`): `dataCollection` заменяет `sendDefaultPii`, значения по
  умолчанию — cookies/headers/body/query/url = true, ip = false.
- Идентификатор проекта в DSN прочитан побайтово (`node -e` по коду символов), т.к. инструмент
  вывода маскирует длинный ключ как `3954e5...dff0`. Реальная длина ключа — 32 символа, значит строка
  в файле корректная, а не «...».
- Тело запроса; частота; каналы — определялись по файлам конфигурации; что уходит по сети реально
  (живой запрос к `ingest.de.sentry.io`) — НЕ проверялось (нет доступа, см. «Что не проверено»).

## Что отправляется — таблица параметров

| Параметр | Значение | Файл:строка | Риск утечки |
|---|---|---|---|
| DSN (сервер) | зашит ключ 32 симв., проект `4511443960332368`, регион DE | `sentry.server.config.ts:8` | низкий (DSN публичен по природе); конфиг не управляется env |
| DSN (edge) | тот же ключ, дублируется второй раз | `sentry.edge.config.ts:9` | низкий; два места для смены проекта |
| DSN (браузер) | тот же ключ в клиентском бандле | `src/instrumentation-client.ts:8` | низкий; ключ виден в JS-бандле |
| DSN (воркер) | из `process.env.SENTRY_DSN`, тот же проект | `src/workers/unified-worker/sentry.ts:31` | нет (пусто = Sentry выключен, `:24`) |
| Включено? | `enabled: NODE_ENV === 'production'` во всех четырёх конфигах | `sentry.server.config.ts:11`, `sentry.edge.config.ts:10`, `src/instrumentation-client.ts:9`, `src/workers/unified-worker/sentry.ts:32` | в проде ВКЛ (`docker-compose.yml:72,165` → `NODE_ENV=production`); dev/test — выкл |
| Куда идёт (браузер) | через свой туннель `/_relay` | `next.config.ts:150` | обход блокировщиков; канал тот же домен |
| Куда идёт (сервер/воркер) | напрямую в `o4511443929530368.ingest.de.sentry.io` | `sentry.server.config.ts:8`, `sentry.edge.config.ts:9` | данные вне РФ (DE/EU) |
| Частота (ошибки) | 100% (errors не семплируются) | SDK по умолчанию | объём событий не ограничен |
| Частота (трейсы, сервер/edge) | `tracesSampleRate: 0.1` | `sentry.server.config.ts:14`, `sentry.edge.config.ts:11` | 10% транзакций |
| Частота (трейсы, браузер) | интеграция `BrowserTracing` удалена, `tracesSampleRate` не задан → 0 | `src/instrumentation-client.ts:23` | замеры производительности браузера выключены |
| Логи в Sentry | `enableLogs: false` | `sentry.server.config.ts:20`, `sentry.edge.config.ts:13`, `src/instrumentation-client.ts:25`, `src/workers/unified-worker/sentry.ts:35` | логи уходят в Loki, не в Sentry |
| Тела запросов/ответов | `httpBodies: []` при `sendDefaultPii:false` | `node_modules/@sentry/core/build/cjs/utils/data-collection/defaultPiiToCollectionOptions.js:22` | тела НЕ уходят — ПРОЙДЕНО |
| Заголовки запроса | уходят все, кроме имён со сниппетами | `captureRequestError.js:9-12` + `filtering-snippets.js:4,5-27` | средний: кастомные заголовки без сниппета уйдут |
| Куки | уходят, кроме имён со сниппетами (`session`,`auth`,`token`,…,`sid`) | `filterCookies.js:16`, `filtering-snippets.js:28-55` | `pt-session` фильтруется (содержит `session`) — ПРОЙДЕНО для сессии |
| Query-параметры | уходят, кроме ключей со сниппетами | `defaultPiiToCollectionOptions.js:23` | средний: параметры-идентификаторы уйдут |
| Пользователь (identity) | не устанавливается (0 вызовов `Sentry.setUser`) | поиск по `src/` — 0 совпадений | ПРОЙДЕНО |
| Локальные переменные | `stackFrameVariables:true`, но интеграция активна только при `includeLocalVariables` | `local-variables-sync.js:192` | не собираются (опция не задана) — ПРОЙДЕНО |
| Стек и исходный контекст | `frameContextLines`=7; карты грузятся и удаляются | `next.config.ts:152-159`, `webpack.js:226,231` | .map клиента удаляются после загрузки — ПРОЙДЕНО |
| Теги отправки | `{ domain, route: <фактический pathname> }` | `src/core/api-wrapper.ts:129` | мелочь: ID сущностей в пути |
| `extra` отправки | `{ componentStack }` | `src/components/piling/app-error-boundary.tsx:60`, `src/components/piling/to/readiness/boundaries/active-view-error-boundary.tsx:30` | имена компонентов, без пропсов |
| Организация/проект сборки | `org: "9589921309a2"`, `project: "pilingtrack"` зашиты | `next.config.ts:122-123` | низкий |
| Токен загрузки карт | `SENTRY_AUTH_TOKEN` из env; без него карты не грузятся | `next.config.ts:152-154`, `scripts/validate-env.ts:204` | не секрет в коде |
| Что при выключке/блокировке | `enabled:false` → события не создаются; при недоступности транспорта SDK буферизует в памяти и роняет после ретраев, без дискового дозорного журнала | `sentry.server.config.ts:11` | события теряются молча |

## Находки

| # | severity | path:line | problem | scenario / why it matters | suggested fix |
|---|---|---|---|---|---|
| 1 | важно | `node_modules/@sentry/core/build/cjs/utils/data-collection/defaultPiiToCollectionOptions.js:18-34` | `sendDefaultPii: false` — не «выключить PII», а маппинг на `dataCollection`: `cookies`/`httpHeaders`/`urlQueryParams` получают deny-список, а не `false` | Владелец и ревьюер видят `sendDefaultPii:false` и считают, что ничего лишнего не уходит. Реально уходят заголовки и параметры, чьи имена не попали в сниппеты | Задать явный `dataCollection: { cookies:false, httpHeaders:{request:{deny:[...]}}, urlQueryParams:false, userInfo:false }` в каждом `Sentry.init`; `sendDefaultPii` убрать как обманчивый |
| 2 | важно | `sentry.server.config.ts:8`, `sentry.edge.config.ts:9`, `src/instrumentation-client.ts:8` | DSN зашит в исходники (три копии), `SENTRY_DSN` на пути app не читается | `scripts/validate-env.ts:89-92` и `.env*` описывают Sentry переменными, а отправка от них не зависит: смена проекта требует пересборки, а `SENTRY_DSN` в app-контейнере бессмысленна | Читать DSN из env с дефолтом, либо убрать переменные из описания, чтобы не путать |
| 3 | важно | `node_modules/@sentry/nextjs/build/cjs/common/captureRequestError.js:9-12` | `normalizedRequest` кладёт ВСЕ заголовки запроса; отсекаются только имена со сниппетом (`filtering-snippets.js:4,5-27`) | Любой собственный заголовок (`x-tenant-id`, `x-acting-as`, `referer`, `user-agent`) уходит в Sentry вместе с ошибкой маршрута; секрет-подобные имена (`auth`,`cookie`) фильтруются | Добавить `dataCollection.httpHeaders.request.deny`/`allow` с явным белым списком нужных заголовков |
| 4 | важно | `src/core/api-wrapper.ts:128-129` | Непредвиденная ошибка уходит в Sentry с `error.message` как есть; `beforeSend` отсутствует (0 вхождений по репозиторию) | Если бизнес-код бросит исключение с персональными данными в тексте (например, значение из БД), оно уйдёт в Sentry без правки; точка финальной чистки не определена | Добавить `beforeSend`/`beforeSendTransaction` с санитайзером сообщения, либо гарантировать, что исключения не содержат ПДн |
| 5 | важно | `src/workers/unified-worker/sentry.ts:24`, `docker-compose.yml:206` | Sentry воркера включается только при `SENTRY_DSN`, а в compose значение по умолчанию пустое | Ошибки планировщиков, outbox и PDF-воркера (`pdf.ts:103`, `pm-scheduler.ts:63,90`) по умолчанию не уходят в Sentry — остаётся только ротируемый docker-лог | Задать `SENTRY_DSN` в контейнере `workers` (тот же ключ), либо сделать так, чтобы воркер использовал общий конфиг |
| 6 | важно | `sentry.server.config.ts:8`, `sentry.edge.config.ts:9` | Регион отправки — `ingest.de.sentry.io` (Германия) | Данные (включая потенциальные ПДн из текстов ошибок) хранятся вне РФ — вопрос для 152-ФЗ, даже при отключённых телах | Решить осознанно (regulo/DPA) либо перенести на self-hosted/EU-policy, если требование применимо |
| 7 | важно | `src/proxy.ts:179` | CSP `connect-src 'self' https:` в проде разрешает любые HTTPS-соединения из браузера | Расширяет канал эксфильтрации при XSS; туннель Sentry в этом не нуждается (идёт на `'self'`) | Сузить до `connect-src 'self'`, если иных клиентских внешних вызовов нет (проверить) |
| 8 | мелочь | `src/core/api-wrapper.ts:129` | Тег `route` = фактический `request.nextUrl.pathname` | Идентификаторы сущностей (UUID) в пути уходят в Sentry как метка, растёт кардинальность | Использовать шаблон маршрута вместо фактического пути |
| 9 | мелочь | `src/services/system/system-service.ts:63-64` | Флаг диагностики `sentry.configured` считается из `SENTRY_DSN || SENTRY_AUTH_TOKEN`, `sentry.project` — из `SENTRY_PROJECT` | В app всё это не задано → диагностика всегда показывает «Sentry не настроен», хотя фактически включён через зашитый DSN | Считать флаг из факта инициализации SDK, а не из необязательных переменных |
| 10 | мелочь | `src/instrumentation-client.ts:23`, `sentry.server.config.ts:14` | Браузерные трейсы выключены (интеграция `BrowserTracing` удалена), сервер/edge — 0.1 | Асимметрия: скорость клиента не измеряется вовсе; при разборе «тормозит у пользователя» данных не будет | Вернуть интеграцию после фикса SDK (комментарий `instrumentation-client.ts:10-22`) |
| 11 | мелочь | `src/instrumentation-client.ts:28-33` | `ignoreErrors` задан только на клиенте | Сервер/edge не отсеивают шум (расширения, `Network Error`) → «зашумлённость» решают фильтры Sentry вне репозитория | При необходимости добавить `ignoreErrors` и на серверные конфиги |
| 12 | мелочь | `src/instrumentation-client.ts:23`, `sentry.server.config.ts:7` | `integrations` изменяются только на клиенте; поведение `console`-хлебных крошек (по умолчанию включено) не настроено | Клиентские `console.*` становятся breadcrumbs и прикладываются к событию — если туда попадёт данные, они уйдут | Отключить `consoleIntegration`/breadcrumbs или ограничить их |
| 13 | мелочь | `next.config.ts:128,163-171` | `silent`/`release.create`/`release.finalize` завязаны на `SENTRY_AUTH_TOKEN`/`npm_package_version` | Без токена события не привязываются к релизу (`release` может быть `undefined`), `widenClientFileUpload` всё равно включён (`:132`) | Задавать `SENTRY_RELEASE` явно при сборке |
| 14 | мелочь | `src/proxy.ts:250-259` | Matcher прокси не исключает `/_relay` (туннель Sentry) | POST-запросы туннеля проходят HTML-ветку прокси и получают CSP/`x-nonce` — на отправку не влияет (SDK смотрит только статус), но предупреждение `next.config.ts:148-149` остаётся в силе: будущий `return`/redirect в прокси молча оборвёт клиентские события | Исключить `/_relay` из matcher прокси либо покрыть это регресс-тестом |
| 15 | мелочь | `sentry.server.config.ts:8` и `sentry.edge.config.ts:9` | Один и тот же DSN в двух файлах (и третий — в клиенте) | Рассинхрон при частичной правке: сервер уйдёт в один проект, клиент — в другой | Единый источник DSN |
| 16 | мелочь | `src/lib/logger.ts:71,78` | Логгер пишет стек ошибки в stdout без маскирования | Само по себе в Sentry не уходит (логи туда не идут, `enableLogs:false`), но тот же стек/сообщение параллельно уходит в Sentry через `captureException` — два разных контура без общего санитайзера | Единая функция маскирования для обоих контуров |

### Проверенные «положительные» факты (риском не являются)

- **Тела запросов/ответов не уходят** — `httpBodies: []` при `sendDefaultPii:false`
  (`defaultPiiToCollectionOptions.js:22`). ПРОЙДЕНО.
- **Сессионная кука `pt-session` фильтруется** — имя содержит `session`
  (`src/services/auth/session-service.ts:7`, `filtering-snippets.js:9`). ПРОЙДЕНО.
- **Пользовательская идентификация не привязывается** — `Sentry.setUser` не вызывается нигде в `src/`
  (поиск по репозиторию: 0 совпадений). ПРОЙДЕНО.
- **Локальные переменные не собираются** — интеграция `LocalVariables` возвращается сразу, пока не задан
  `includeLocalVariables` (не задан): `local-variables-sync.js:192`. ПРОЙДЕНО.
- **Карты исходников клиента удаляются после загрузки** — `next.config.ts:158`,
  `webpack.js:231` (`.js.map` не лежат в сборке). ПРОЙДЕНО.
- **Саммит `/_relay`** — туннель через свой домен (`next.config.ts:150`), формулировка про приватную папку
  корректна. ПРОЙДЕНО (наличие туннеля); поведение под прокси — см. находку 14, ГИПОТЕЗА.
- **Логи в Sentry не дублируются** — `enableLogs: false` во всех конфигах. ПРОЙДЕНО.

## Что не проверено

- **Живая отправка по сети не наблюдалась**: фактический envelope к `ingest.de.sentry.io` (набор полей
  события) не перехватывался — нет доступа к боевому стенду и запрещено читать `.env*`. Всё выше о составе
  события — вывод из кода установленного SDK (его файлы открыты), а не из перехваченного трафика.
- **`sendDefaultPii` на клиентском рантайме** проверен по общему коду `@sentry/core`; отличается ли
  поведение в браузерной сборке — по коду не подтверждал отдельно (ГИПОТЕЗА: совпадает).
- **Влияет ли `proxy` фактически на `/_relay`** (находка 14): прочитан matcher и HTML-ветка, но реальный
  POST через прокси не выполнялся (нужен запущенный прод-сервер). ГИПОТЕЗА.
- **Значения переменных окружения на бою** (`SENTRY_DSN` в контейнере `workers`, `SENTRY_AUTH_TOKEN`,
  `NEXT_PUBLIC_*`) не читались — `.env*` вне доступа по правилам. Суджу по `docker-compose.yml`
  (проброс есть, значение по умолчанию пустое).
- **Правила алертов и политика хранения в самом Sentry** (вне репозитория) не проверялись.
- **Проброс DSN воркера** подтверждён только по `docker-compose.yml:206`; реальное значение в живом
  контейнере — не проверено.
- **Читались ли `docs/audits/**`, `CODEX-REPORT*`, `docs/strategy`** — нет, по правилу задачи они не
  открывались; совпадения поиска по этим путям в работу не брались.
