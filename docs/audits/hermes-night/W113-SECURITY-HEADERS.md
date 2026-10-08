# W113 — Заголовки безопасности в настройках Next.js и Caddy

## Итог

Опись защитных заголовков: где задан каждый, какое значение, есть ли дублирование
и конфликты между Next и Caddy. Из шести заголовков из задания **нигде нет** —
ни одного (все шесть присутствуют хотя бы в одном источнике на проде), но у
четырёх из шести «дом Next» — это `src/proxy.ts`, который ставит их только в
API-ветке, и ещё у двух дом — только Caddy (HSTS) или только Caddy+proxy с
PDF-исключением (CSP).

Главное: **X-Frame-Options задан в трёх местах с двумя значениями**. На путь
`/api/reports/single-pdf*` одновременно приходят `DENY` (`src/proxy.ts:67`, все
`/api`) и `SAMEORIGIN` (`next.config.ts:93` и `src/app/api/reports/single-pdf/route.ts:253`).
Это расширяет известную находку F-06 (в ней фигурировали только next.config vs
Caddy; proxy-путь туда не попал).

Счёт по важности: критично — 0, важно — 3, мелочь — 5 (всего 8).

Топ-5:
1. X-Frame-Options: `DENY` (proxy) vs `SAMEORIGIN` (next.config + route) на одном
   пути — конфликт/дубль с разными значениями (`src/proxy.ts:67` против
   `next.config.ts:93`).
2. `src/proxy.ts:62-75` ставит заголовки только в API-ветке; HTML-ветка
   (`:231-244`) их не ставит, хотя комментарий `:63-65` обещает закрыть ими
   «развёртывания без Caddy» — на таких развёртываниях HTML-страницы остаются
   без XFO/Referrer-Policy/Permissions-Policy/nosniff.
3. Комментарий `deploy/Caddyfile.prod:17-19` устарел: говорит «CSP stay в
   next.config.ts... переедет в Caddy, когда станет nonce-based», хотя CSP уже
   nonce-based и живёт в `src/proxy.ts:242` — риск, что CSP продублируют в Caddy.
4. Политики CSP не сообщают о нарушениях: нет `report-uri`/`report-to` ни в
   `src/proxy.ts:155-186`, ни в `next.config.ts:95` (архивные M5/M23 — всё ещё
   открыто).
5. Заголовки `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`
   заданы в двух местах (`src/proxy.ts:66-72` и `deploy/Caddyfile.prod:31,33,40`)
   — значения совпадают, поэтому конфликта нет, но два источника = риск
   расхождения (именно так в прошлом ломался HSTS preload).

## Методика

- Конфиг Next: прочитан целиком `next.config.ts` (блок `async headers()`,
  строки 86-118). Отдельного `next.config.js/.mjs` нет (поиск `next.config*` —
  только `next.config.ts` и `playwright.opnext.config.ts`).
- «Middleware» в Next 16 заменён на proxy: файла `middleware.ts`/`src/middleware.ts`
  нет (поиск по имени — 0 совпадений); роль CSP и API-заголовков выполняет
  `src/proxy.ts` (прочитан целиком, 260 строк).
- Поиск по репозиторию значений заголовков (Content-Security-Policy,
  Strict-Transport-Security, X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy, Permissions-Policy) — 26 файлов; из них рабочие — только
  `next.config.ts`, `src/proxy.ts`, `src/app/api/reports/single-pdf/route.ts`,
  `Caddyfile`, `deploy/Caddyfile.prod`. Остальные — документация/архивы/тесты.
- Route handlers: поиск по `src/` (`X-Frame-Options|Content-Security-Policy|
  Strict-Transport-Security`) дал только `src/proxy.ts` и
  `src/app/api/reports/single-pdf/route.ts:253-254` (CSP + XFO на ветке скачивания
  PDF). Прочитаны строки 100-120 и 240-260 этого route.
- Caddy: файлов `Caddyfile` два — корневой (дев, порт :81, заголовки
  закомментированы, строки 36-43) и боевой `deploy/Caddyfile.prod` (прочитан
  целиком). Сервиса `caddy` в `docker-compose*.yml` нет (поиск `caddy` в
  `docker-compose.yml` — только комментарии), т.е. Caddy установлен на хост и
  берёт конфиг из `/etc/caddy/Caddyfile` (см. шапку `deploy/Caddyfile.prod:1-11`).
  Отдельных `*.conf` (nginx), `vercel.json` — нет.
- Разбор маршрутизации proxy: `config.matcher` (`src/proxy.ts:250-260`) матчит
  `/api/**` (исключены только `_next/static`, `_next/image`, `favicon.ico`,
  `icon-`), поэтому API-ветка proxy применяется и к `/api/reports/single-pdf*`.
- Что `headers()` из `next.config` применяется и к Route Handlers — подтверждено
  документацией Next.js (Context7, `/websites/nextjs`, страница
  `config/next-config-js/headers`: «Headers are evaluated before the filesystem,
  which includes pages and public files», есть пример `source: "/api/:path*"`).
- Тесты/ожидания: прочитаны `src/__tests__/proxy-csp.test.ts` и
  `e2e/qa-ac/headers.spec.ts`; `security/zap-config.yaml` (правило 10035),
  архивные отчёты `docs/audits/release-audit-2026-09/{SECURITY,FINDINGS,
  REMEDIATION_PLAN,RELEASE_CHECKLIST}.md` (находка F-06, M5/M22/M23).

## Находки

Порядок: сначала «отсутствующие/почти отсутствующие», затем конфликты, затем
дубли и прочее.

| # | severity | path:line | Проблема | Сценарий / почему важно | Что сделать |
|---|---|---|---|---|---|
| 1 | важно | `src/proxy.ts:67`; `next.config.ts:93`; `src/app/api/reports/single-pdf/route.ts:253`; `deploy/Caddyfile.prod:32` | X-Frame-Options на `/api/reports/single-pdf*` задан тремя источниками с двумя значениями: `DENY` (proxy на всех `/api`; Caddy на всём домене) и `SAMEORIGIN` (next.config + route для PDF) | Браузер получает дубль XFO с противоположными правилами. Встроенный предпросмотр PDF (`Content-Disposition: inline`, `?inline=1`, `route.ts:246-255`) может перестать открываться, а правило становится недетерминированным; сканеры видят «conflicting header» (ранее так ломался HSTS preload / парсинг Observatory) | Исключить `/api/reports/single-pdf` из proxy-ветки (matcher/проверка pathname), либо убрать XFO из next.config и route и оставить единственный источник (Caddy с точечным исключением) |
| 2 | важно | `src/proxy.ts:62-75` (вызовы `:212`, `:225`), HTML-ветка `:231-244` | Заголовки XFO/Referrer-Policy/Permissions-Policy/X-Content-Type-Options ставятся только в API-ветке; HTML-ветка их не ставит вовсе, хотя комментарий `:63-65` заявляет, что они нужны «для развёртываний без Caddy» | На развёртывании без Caddy (dev, локальный прод-стенд) HTML-страницы `/`, `/login`, `/admin` остаются без XFO, Referrer-Policy, Permissions-Policy и nosniff — то есть заявленная страховка не работает там, где она единственная | Вызвать `addSecurityHeaders` и в HTML-ветке (после установки CSP), либо честно поправить комментарий, что HTML-заголовки обеспечивает только Caddy |
| 3 | важно | `deploy/Caddyfile.prod:17-19` | Комментарий противоречит коду: «CSP stays in next.config.ts... will move here once we switch to nonce-based CSP». CSP уже nonce-based (`src/proxy.ts:149-187, 242`), а в next.config.ts осталась только CSP для PDF-пути (`:95`) | Следующий инженер, читая «источник истины» Caddy, может добавить CSP и в Caddy — получится второй CSP рядом с nonce-политикой (браузер объединит/перебьёт политики). Документация источника истины вводит в заблуждение | Обновить комментарий: CSP живёт в `src/proxy.ts`; в Caddy её нет и дублировать нельзя |
| 4 | мелочь | `src/proxy.ts:155-186`; `next.config.ts:95` | Ни в одной CSP нет `report-uri`/`report-to` (`report-uri` в репозитории не встречается вовсе) | Нарушения CSP не собираются и не видны — нельзя поймать регресс политики до жалоб пользователей (архивные находки M5/M23 так и не закрыты) | Добавить `report-to`-эндпоинт либо зафиксировать отказ в комментарии |
| 5 | мелочь | `next.config.ts:109` | `X-XSS-Protection: 0` — устаревший заголовок, оставшийся от старых конфигов | Безвреден, но лишний шум: современные сканеры считают такой заголовок устаревшим, а рядом (`:110`) легитимно живёт `X-DNS-Prefetch-Control: off` | Убрать вместе с ревизией блока, если не нужен осознанно |
| 6 | мелочь | `src/proxy.ts:66`; `:68`; `:72` против `deploy/Caddyfile.prod:31`; `:33`; `:40` | X-Content-Type-Options, Referrer-Policy, Permissions-Policy заданы в двух местах (proxy — только на `/api`, Caddy — на всём домене) | Значения сейчас идентичны (комментарий `:64-65` это подчёркивает), поэтому конфликта нет; но два источника легко расходятся — это ровно тот механизм, которым в прошлом сломали HSTS preload | Оставить один источник истины (Caddy), proxy-версию использовать как осознанный fallback и закрепить тест на совпадение значений |
| 7 | мелочь | `deploy/Caddyfile.prod:41-42` | Caddy ставит `Cross-Origin-Opener-Policy: same-origin` и `Cross-Origin-Resource-Policy: same-origin`; в `src/proxy.ts` их нет | Это тот же класс, что №2: без Caddy этих двух заголовков нет (задание их не перечисляло, но они часть боевой политики) | Если страховка без Caddy нужна — продублировать; иначе зафиксировать осознанный пропуск |
| 8 | мелочь | `deploy/Caddyfile.prod:30`; `Caddyfile:36-43`; `e2e/qa-ac/headers.spec.ts:18` | HSTS есть только в боевом Caddy; в дев-`Caddyfile` он закомментирован, в Next не задан; e2e-спека проверяет `strict-transport-security` | На дев-сервере заголовок всегда «(не задан)» — спека запишет это, но не утверждает (assert только на статусы `:46-47`). Не баг, но при чтении отчёта теста легко принять за проблему | Осознанно оставить; при желании отметить в спеке, что HSTS проверяется только на бою |

## Таблица заголовков

Порядок: сверху — отсутствующие/наименее покрытые, ниже — конфликтные, затем остальные.
Значения даны сокращённо. «Next» = `next.config.ts` + `src/proxy.ts` + route handlers.

| заголовок | Next | Caddy | значение | конфликт | комментарий |
|---|---|---|---|---|---|
| Strict-Transport-Security | нет | да — `deploy/Caddyfile.prod:30` | `max-age=63072000; includeSubDomains; preload` | нет | Только боевой Caddy; в Next и в дев-`Caddyfile:38` отсутствует (там закомментирован) |
| Content-Security-Policy | да — `src/proxy.ts:242` (HTML, nonce); `next.config.ts:95` и `single-pdf/route.ts:254` (PDF) | нет | HTML: `default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic' …`; PDF: `frame-ancestors 'self'` | нет | В Caddy нет; комментарий `deploy/Caddyfile.prod:17-19` устарел (см. находку 3) |
| X-Frame-Options | да — `next.config.ts:93` (`SAMEORIGIN`, PDF) + `src/proxy.ts:67` (`DENY`, все `/api`) + `single-pdf/route.ts:253` (`SAMEORIGIN`) | да — `deploy/Caddyfile.prod:32` | PDF-путь: `SAMEORIGIN`; прочие `/api` и Caddy: `DENY` | **да** | Один путь — три источника, два значения (см. находки 1; F-06 не учитывала `src/proxy.ts`) |
| X-Content-Type-Options | да — `src/proxy.ts:66` (только `/api`) | да — `:31` | `nosniff` | нет | Значения совпадают; на HTML без Caddy заголовка нет (находка 2) |
| Referrer-Policy | да — `src/proxy.ts:68` (только `/api`) | да — `:33` | `strict-origin-when-cross-origin` | нет | Значения совпадают; на HTML без Caddy заголовка нет (находка 2) |
| Permissions-Policy | да — `src/proxy.ts:72` (только `/api`) | да — `:40` | `camera=(), microphone=(), geolocation=(self), payment=(), usb=()` | нет | Значения совпадают намеренно (комментарии `proxy.ts:69-71`, `Caddyfile.prod:34-39`) |
| CSP `report-uri`/`report-to` | нет | нет | — | н/д | Нигде (см. находку 4) |

Дополнительно (вне списка задания, но часть политики): `X-XSS-Protection: 0` и
`X-DNS-Prefetch-Control: off` — только Next (`next.config.ts:109-110`);
`Cross-Origin-Opener-Policy` и `Cross-Origin-Resource-Policy` — только Caddy
(`deploy/Caddyfile.prod:41-42`). `Server`/`X-Powered-By` срезаются в Caddy
(`:28-29`).

## Не проверено

- **Фактический набор заголовков на живом сервере не снимался** (только чтение
  конфигов; дев-сервер не поднимался). В частности, как именно Next.js объединяет
  дубль X-Frame-Options из `next.config` `headers()`, ответа `proxy` и ответа
  route handler в один HTTP-ответ (два значения, массив, порядок) — по коду не
  доказуемо. Всё утверждение о конфликте XFO стоит на чтении `path:line`, а не
  на пробе `curl -I`.
- **Боевой `/etc/caddy/Caddyfile` на VPS не читался** (правила: без прода). Что
  файл на сервере дословно совпадает с `deploy/Caddyfile.prod` — не проверено;
  в шапке файла (`:4-5`) он назван источником истины, но это утверждение самого
  файла.
- **Страховка «без Caddy» не запускалась**: не проверено, действительно ли при
  деплое без обратного прокси HTML-страницы остаются без этих заголовков (вывод
  сделан из отсутствия вызова `addSecurityHeaders` в HTML-ветке `src/proxy.ts`).
- Не проверялось поведение сторонних прокси/CDN перед Caddy (Cloudflare и
  подобных) — упоминаний в конфигах не найдено, но и не исключено.
