# N17-48 — Внешние ресурсы страниц PilingTrack: что загружается из других сайтов

Версия (git rev-parse HEAD): `98e406f130403d3a1fde016afaa4924ead301726`, ветка `hermes/code-1011`.
Тип работы: только чтение. Изменён/создан один файл — этот отчёт.

> Примечание о путях. В тексте задания рабочая папка названа `D:/PillingR/wt-night-code-code`,
> но такой папки нет; фактическая рабочая папка — `D:/PillingR/wt-night-code` (совпадает с
> `hermes/code-1011` и с AGENTS.md). Работал в ней.

## Итог

Резюме для владельца (5 строк):

1. Критичных утечек нет. Ни один скрипт или стиль сторонних сайтов на экраны приложения не подключается: шрифты раздаются со своего домена, аналитики/карт/CAPTCHA нет.
2. Из других адресов страницы реально тянут только две вещи: картинки фотоотчётов (напрямую с внешнего S3/R2 по presigned-ссылке) и клиентскую отправку ошибок в Sentry (через свой же путь `/_relay`).
3. Единственные данные, уходящие третьей стороне из-за функций страницы: координаты площадки/телефона в Open-Meteo (сервер ходит сам) и байты фото на внешний S3-хост. Данные пользователя (cookie, IP, заголовки) туда не передаются.
4. В закрытой сети объекта приложение работает: шрифты, CSS, JS — свои. Ломается только одно — фото из хранилища (внешний хост) и тихо пропадает телеметрия Sentry.
5. Нашёл 13 находок: 0 критично, 2 важно, 11 мелочь. Всё остальное — ложные срабатывания (xmlns, schema.org, data:URI) либо замороженный сайт ORION.

Счёт по серьёзности: **критично — 0, важно — 2, мелочь — 11.** Статус всех выводов — ПРОЙДЕНО (по коду/конфигу), если не указано иное.

Топ-5 по значимости:
1. (важно) Фото грузятся и загружаются напрямую на внешний S3/R2-хост — `src/components/piling/admin-reports/report-thumbnail.tsx:86`.
2. (важно) Координаты площадки/телефона уходят третьей стороне (Open-Meteo) — `src/services/weather/weather-client.ts:82`.
3. (мелочь) Sentry DSN зашит в исходник, клиент в проде активен всегда — `src/instrumentation-client.ts:9`.
4. (мелочь) CSP разрешает картинки и соединения с любого https-хоста — `src/proxy.ts:175`.
5. (мелочь) Диагностика «Sentry настроен» расходится с фактическим зашитым DSN — `src/modules/system/application/queries/system-service.ts:64`.

## Методика

Инвентарь адресов (повторяемо, из корня репозитория):

- `rg -n 'https?://' src --glob '!**/*.test.*' -g '!**/*.spec.*' -g '!**/__tests__/**'` — все внешние адреса в исходниках приложения (без тестов).
- `rg -n -i 'googleapis|gstatic|unpkg|jsdelivr|cdnjs|cloudflare|yandex|metrica|google-analytics|gtag|mapbox|openstreetmap|fontawesome|recaptcha|stripe|sentry|open-meteo|next/font|@import|fonts\.' src public next.config.ts package.json` — поиск по именам CDN/шрифтов/аналитики.
- `rg -n -i 'preconnect|dns-prefetch|<link|url\(http|@font-face|fonts\.gstatic' src --glob '!**/*.test.*'` — подключения шрифтов/стилей (ссылок нет).
- `rg -n "fetch\(|new WebSocket|new EventSource" src/core src/lib src/services src/modules src/workers` — исходящие сетевые вызовы.
- `rg -n 'target="_blank"|<iframe' src` — внешние ссылки/врезки.
- `rg -n "uploadUrl" src` — прямая загрузка в хранилище из браузера.
- `rg -n -i 'CDN_BASE_URL|S3_ENDPOINT|NEXT_PUBLIC_APP_URL|NEXT_PUBLIC_SITE_URL|WEATHER_API_BASE|TELEGRAM_API_BASE' src deploy` — откуда берётся внешний хост.

Открытые вручную файлы (ключевые): `src/app/layout.tsx`, `src/app/globals.css`, `src/proxy.ts`,
`next.config.ts`, `src/instrumentation-client.ts`, `sentry.server.config.ts`,
`src/lib/sentry-data-collection.ts`, `src/services/weather/weather-client.ts`,
`src/app/api/weather/route.ts`, `src/app/api/media/download-batch/route.ts`,
`src/core/media/media-service.ts`, `src/components/piling/admin-reports/report-thumbnail.tsx`,
`src/components/piling/admin-equipment/detail/equipment-photos.tsx`,
`src/components/piling/monitoring/equipment-tile-block.tsx`,
`src/components/piling/report-form/photo-section.tsx`, `src/components/piling/operator-v2/weather-card.tsx`,
`src/app/operator/v5/page.tsx`, `src/core/notifications/telegram.ts`,
`deploy/cloudflare-worker/README.md`, `src/app/orion/page.tsx`.

Ложные срабатывания, которые НЕ являются внешними ресурсами (проверено чтением): `xmlns`/`xlink`
в SVG и `public/logo.svg`, схемы OOXML в `src/lib/xlsx-writer.ts:88`, `@context: 'https://schema.org'`
в `src/app/orion/page.tsx:42`, `data:image/svg+xml` в `src/app/globals.css:289`. Это пространства имён и
встроенные данные — браузер по ним никуда не ходит.

## Инвентарь внешних адресов

| Адрес / хост | Тип | На каких страницах | Данные пользователя наружу | Нужен для работы | Риск |
|---|---|---|---|---|---|
| `https://o4511443929530368.ingest.de.sentry.io/4511443960332368` (Sentry EU) | скрипт SDK + отправка ошибок | все экраны приложения в проде (клиентский бандл) | нет: `sentryDataCollection` запрещает userInfo, cookie, authorization, IP, тела, query-токены (`src/lib/sentry-data-collection.ts:7`) | нет (наблюдаемость) | мелочь; в закрытой сети просто тихо не работает |
| `https://api.open-meteo.com` (серверный `fetch`) | HTTP API (ветер/температура) | карточка погоды оператора через `/api/weather` | координаты площадки или телефона (широта/долгота), не идентификаторы | нет: нет ответа — ручной ввод (`src/app/api/weather/route.ts:58`) | важно (геоданные третьей стороне) |
| внешний S3/R2-хост (`S3_ENDPOINT` / `CDN_BASE_URL`) | картинки (presigned GET) и прямая загрузка (PUT) | журнал отчётов, галерея установки, мониторинг, осмотры, ТО, форма отчёта, мобильное место оператора | байты фото; заголовок Referer — только origin (политика `strict-origin-when-cross-origin`) | да для фото; ядро работает и без них | важно (в закрытой сети фото не откроются) |
| `next/font/google` (Inter, JetBrains Mono; Oswald, PT_Sans на `/operator/v5`) | шрифты | все экраны + `/operator/v5` | нет: файлы скачиваются на сборке и раздаются со своего домена | да (вид), для работы — нет | мелочь (интернет нужен только на этапе сборки) |
| `https://api.telegram.org` (или Cloudflare Worker-прокси) | HTTP API уведомлений (серверный `fetch`) | прямых ресурсов страницы нет; уведомления из воркеров | текст отчёта и PDF-документы уходят в Telegram (серверная сторона) | нет для страниц | мелочь (вне области «ресурсы страниц») |
| `https://geomek.se/...`, `liesekogroup`, `liebherr`, `gruzovik`, `exkavator` и др. | обычные ссылки-источники (`<a>`, не загрузка) | сайт ORION (заморожен) | нет | нет | не ресурс; `rel="noreferrer"` есть (`src/components/orion/orion-hero.tsx:24`) |
| `/icons/*`, `/apple-touch-icon.png`, `/favicon-32.png` | иконки | все экраны (метаданные) | нет | да (вид) | нет — это свой домен (`src/app/layout.tsx:86`) |

## Находки

| # | Серьёзность | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `src/components/piling/admin-reports/report-thumbnail.tsx:86` | Фотоотчёт открывается как `next/image` (`unoptimized`) по presigned-ссылке на внешний S3/R2-хост | В закрытой сети объекта внешний хост недоступен — миниатюры и фото пропадают; байты фото идут на сторонний хост | Если объект без интернета — проксировать картинки через свой домен либо хранить медиа локально |
| 2 | важно | `src/components/piling/report-form/photo-section.tsx:105` | Загрузка фото идёт прямым `PUT` в браузере на внешний `uploadUrl` (presigned) | Байты фото уходят на внешний хост из браузера оператора; в закрытой сети загрузка не сработает | Оставить как есть осознанно и задокументировать; либо серверный прокси загрузки |
| 3 | мелочь | `src/instrumentation-client.ts:9` | Sentry DSN зашит в исходник клиента (не из env) | Прод-сборка всегда шлёт ошибки в конкретный проект; переключение только через `NODE_ENV` (`:10`) | Вынести DSN в `NEXT_PUBLIC_SENTRY_DSN` |
| 4 | мелочь | `src/modules/system/application/queries/system-service.ts:64` | Диагностика `sentry.configured` читает env `SENTRY_DSN`, а клиент использует зашитый DSN | Экран диагностики скажет «Sentry не настроен», хотя клиент реально шлёт данные | Сверить источник: тот же DSN, что в `instrumentation-client.ts:9` |
| 5 | мелочь | `src/proxy.ts:175` | `img-src 'self' data: blob: https:` — картинки с любого https-хоста | Расширяет поверхность (маячок-эксфильтрация при внедрении текста); оправдано presigned-ссылками S3 | Заменить `https:` на список хостов хранилища, если он стабилен |
| 6 | мелочь | `src/proxy.ts:179` | `connect-src 'self' https:` — соединения с любого https-хоста | То же; нужно для прямой загрузки/выгрузки в S3 из браузера | Точечный allowlist хостов хранилища |
| 7 | мелочь | `src/app/layout.tsx:2` | `next/font/google` скачивает шрифты при сборке | На машине без интернета `npm run build` не соберётся (шрифты не скачаются); в рантайме обращений к Google нет | Зафиксировать: сборка требует сети; при необходимости — self-hosted шрифты |
| 8 | мелочь | `src/app/operator/v5/page.tsx:2` | Второй набор `next/font/google` (Oswald, PT_Sans) — та же зависимость сборки | см. №7 | см. №7 (файл заморожен — только к сведению) |
| 9 | мелочь | `deploy/cloudflare-worker/README.md:5` | Уведомления Telegram идут через внешний Cloudflare Worker-прокси | Документы отчётов проходят через сторонний сервис (серверная сторона, не ресурс страницы) | Осознанное решение; держать в карте зависимостей |
| 10 | мелочь | `src/core/notifications/telegram.ts:239` | Токен бота подставляется прямо в URL запроса к Telegram/прокси | Токен может попасть в логи прокси/промежуточных узлов | Передавать токен заголовком/через `SHARED_SECRET` (README уже это описывает) |
| 11 | мелочь | `src/components/piling/monitoring/equipment-tile-block.tsx:120` | Комментарий фиксирует: фото мониторинга — обычный `<img>` на presigned S3-хост | Дублирует №1 по механике; в закрытой сети блок пуст | см. №1 |
| 12 | мелочь | `src/app/api/weather/route.ts:21` | Комментарий утверждает, что «строгая CSP не пускает страницу на чужие хосты», но `connect-src`/`img-src` пускают любой https (`src/proxy.ts:175`) | Внутреннее противоречие документации и политики: браузер технически может ходить на любой https-хост | Привести комментарий и CSP в соответствие |
| 13 | мелочь | `src/proxy.ts:174` | В dev `img-src`/`connect-src` дополнительно разрешают `http://localhost:*` | Только режим разработки; на прод не влияет | Не требует действий; зафиксировано для полноты |

Дополнение (без нумерации, `path:line` — не ресурсы страниц, приведено как доказательство отсутствия находок):
`src/app/globals.css:289` (встроенный `data:` SVG), `src/lib/xlsx-writer.ts:88` (пространства имён OOXML),
`src/app/orion/page.tsx:42` (`schema.org` — контекст JSON-LD), `src/components/piling/admin-crews/crew-form-dialog.tsx:514`
(`xmlns` SVG), `next.config.ts:114` (PWA/сервис-воркер убран — кэша внешних ресурсов нет, страницы полностью сетевые),
`src/services/weather/weather-client.ts:85` (координаты в строке запроса к Open-Meteo), `src/components/piling/operator-v2/weather-card.tsx:70` (браузер шлёт координаты на свой `/api/weather`, не наружу).

## Не проверено

- **Точный внешний хост хранилища** (`S3_ENDPOINT`/`CDN_BASE_URL`) — значения в `.env*` не читал (AGENTS.md §1), поэтому «внешний S3/R2» — по коду и комментариям (`src/core/media/media-service.ts:507`, `:315`), а не по факту.
- **Фактическое поведение браузера.** Не запускал приложение и браузер; вывод «браузер шлёт ошибки в Sentry через свой `/_relay`» основан на конфиге (`next.config.ts:150`) и комментарии, а не на сетевом захвате.
- **Сборка без интернета** (пункты №7, №8) — не собирал; поведение `next/font/google` при недоступности Google взято из документации Next и комментариев в коде, не воспроизведено.
- **Наличие интернета у прод-сервера к Open-Meteo/Telegram** и фактическую маршрутизацию через Cloudflare Worker — не проверял (нет доступа к проду).
- **Полный список внешних адресов в замороженном сайте ORION** не проверял за пределами `https?://`-поиска: сайт заморожен, править/предлагать удаление нельзя.
- **PDF-предпросмотр** (`src/components/piling/pdf-preview-dialog.tsx:60`): source `previewUrl` не прослеживал до конца — по контексту это blob/свой маршрут, внешнего хоста не подтверждено и не опровергнуто.
