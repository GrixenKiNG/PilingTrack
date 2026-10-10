# AU36-S5-CSP-HEADERS — Заголовки безопасности и CSP

Версия рабочей папки: `9650b26a762182cb525697ad9b9320eb2dedf435` (branch `hermes/q4-0926`)
(команда: `git rev-parse HEAD` в `D:\PillingR\wt-night`)

Область: `src/proxy.ts`, `next.config.ts`, `deploy/Caddyfile.prod`, `Caddyfile` (корневой, dev),
cookie-флаги, полезная нагрузка CSP. Только чтение; код приложения не менялся.

---

## Итог

Критично: 0. Важно: 4. Мелочь: 13. Всего находок: 17 (+ 5 «ПРОЙДЕНО»).

1. **HTML-страницы приложения не получают `X-Frame-Options`, `X-Content-Type-Options`,
   `Referrer-Policy`, `Permissions-Policy`** — в `src/proxy.ts` они ставятся только в ветке `/api`
   (`:225`), а HTML-ветка ставит лишь CSP (`:242`). Комментарий `src/proxy.ts:63-65` утверждает
   обратное. В проде их добавляет Caddy, поэтому риск — развёртывания без него (dev, staging,
   `docker-compose.yml` публикует `3000:3000` на все интерфейсы).
2. **`X-Frame-Options: DENY` из proxy перекрывает `SAMEORIGIN` для `/api/reports/single-pdf`**
   (`src/proxy.ts:67` против `next.config.ts:93` и `src/app/api/reports/single-pdf/route.ts:277`).
   Проверено запросом: в ответе ровно один `x-frame-options: DENY`. Встроенный предпросмотр PDF
   (`src/components/piling/pdf-preview-dialog.tsx:22-25`, `<iframe>`) держится только на
   `frame-ancestors 'self'` (`route.ts:278`).
3. **Caddy в проде ставит `X-Frame-Options: DENY` на весь сайт** (`deploy/Caddyfile.prod:32`),
   включая PDF-эндпоинт, что противоречит намерению «разрешить фрейминг для inline-превью».
4. **`Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`
   заданы только в Caddy** (`deploy/Caddyfile.prod:30,41,42`) и полностью отсутствуют в приложении
   (ни `src/proxy.ts`, ни `next.config.ts`).
5. **В CSP нет `report-uri`/`report-to`** (`src/proxy.ts:155-186`) — браузерные нарушения политики
   никуда не отправляются, «кампания csp-monitoring» (упомянута в `next.config.ts:35`) данных из
   прод-браузеров не получает.

Итого по сути: CSP сделана аккуратно (per-request nonce, `object-src 'none'`, `base-uri`,
`form-action`, self-hosted шрифты), но «неполицейная» часть заголовков живёт в двух местах
(Caddy + app) и они разошлись: у приложения защита HTML неполная, а у PDF-эндпоинта заголовки
конфликтуют.

---

## Методика

Что искал и как (чтобы можно было повторить):

1. `search_files target=files` по `next.config.*`, `Caddyfile`, `proxy.ts`, `middleware.ts` — нашлись
   `next.config.ts`, `Caddyfile` (корень), `deploy/Caddyfile.prod`, `src/proxy.ts`. Файлов
   `middleware.ts` и nginx-конфигов в репозитории нет.
2. Полное чтение: `src/proxy.ts` (260 строк), `next.config.ts` (178), `deploy/Caddyfile.prod` (78),
   `Caddyfile` (49), `src/lib/csrf-protection.ts`, `src/services/auth/session-service.ts`,
   `src/app/layout.tsx`, `src/instrumentation-client.ts`, `src/services/weather/weather-client.ts`,
   `src/app/api/reports/single-pdf/route.ts`, `src/components/piling/pdf-preview-dialog.tsx`.
3. `search_files content` по репозиторию: имена заголовков (`X-Frame-Options|Strict-Transport-Security|
   Referrer-Policy|Permissions-Policy|Content-Security-Policy|X-Content-Type-Options|Cross-Origin`),
   `httpOnly`, `Set-Cookie|cookies.set`, `poweredByHeader`, `next/font|fonts.googleapis`,
   `<script src=`, внешние абсолютные URL. Отдельно проверено: третьей стороны-скриптов нет,
   cookie только один (`pt-session`).
4. **Живая проверка** на уже запущенном dev-сервере `http://localhost:3000` (порт слушался,
   PID 24376). Команды и результаты:

   ```bash
   curl -s -D - -o /dev/null http://localhost:3000/login        # CSP + X-XSS-Protection + X-DNS-Prefetch-Control; НЕТ x-frame/permissions/referrer/x-content-type
   curl -s -D - -o /dev/null http://localhost:3000/             # то же
   curl -s -D - -o /dev/null http://localhost:3000/api/health   # есть permissions-policy, referrer-policy, x-content-type-options, x-frame-options: DENY
   curl -s -D - -o /dev/null "http://localhost:3000/api/reports/single-pdf?jobId=00000000-0000-0000-0000-000000000000&action=status"
                                                                # x-frame-options: DENY (1 вхождение) + Content-Security-Policy: frame-ancestors 'self'; X-Powered-By: Next.js
   curl -s -D - -o /dev/null -H "Origin: http://localhost:3000" http://localhost:3000/api/health
                                                                # отражает origin + access-control-allow-credentials: true
   curl -s -D - -o /dev/null -X OPTIONS -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: POST" http://localhost:3000/api/auth/login
                                                                # 204, те же заголовки безопасности + CORS
   ```

5. Юнит-тест CSP: `node node_modules/vitest/vitest.mjs run src/__tests__/proxy-csp.test.ts`
   → `Test Files 1 passed (1), Tests 8 passed (8)` (в т.ч. «свежий nonce на каждый запрос»,
   «нет unsafe-eval в проде», «нет strict-dynamic в dev»).

**Оговорка про источник эмпирики (важно).** Dev-сервер на порту 3000 поднят не из этой рабочей
папки: его командная строка — `D:\PillingR\my-project\...\start-server.js`, ветка `main`,
HEAD `2ecc754f729ad9b85e83f508c62e08f45c62f6bb`. Перед использованием этих данных я сравнил
файлы: `diff -q` для `src/proxy.ts`, `next.config.ts`, `deploy/Caddyfile.prod`,
`src/lib/csrf-protection.ts`, `src/services/auth/session-service.ts` — различий нет
(файлы побайтово одинаковы в обоих деревьях). Поэтому снятые заголовки относятся и к
аудируемому коду, но статус ниже помечен как проверено на **dev** (NODE_ENV=development),
прод-CSP (nonce/strict-dynamic) в рантайме не снимался.

Статусы: **ПРОЙДЕНО** — проверено кодом и/или командой; **ГИПОТЕЗА** — вывод из кода без
рантайм-проверки; **НЕ ПРОВЕРЕНО** — не удалось подтвердить.

---

## Таблица заголовков

| Заголовок | Значение | Где задаётся | Маршруты | Чего не хватает / замечание |
|---|---|---|---|---|
| Content-Security-Policy (HTML) | прод: `default-src 'self'; script-src 'self' 'nonce-<N>' 'strict-dynamic' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; media-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; frame-src 'self' blob:` | `src/proxy.ts:155-186`, ставится `:242` | все пути, кроме `_next/static`, `_next/image`, `favicon.ico`, `icon-*` и префетчей (`:250-259`) | нет `report-uri`/`report-to`, нет `upgrade-insecure-requests`; `connect-src`/`img-src` с `https:` шире нужного (F5, F6, F7, F15) |
| Content-Security-Policy (PDF) | `frame-ancestors 'self'` | `next.config.ts:95-96`; дубль `src/app/api/reports/single-pdf/route.ts:278` | `/api/reports/single-pdf/:path*` | конфликтует с `X-Frame-Options: DENY` (F2) |
| Strict-Transport-Security | `max-age=63072000; includeSubDomains; preload` | `deploy/Caddyfile.prod:30` | весь прод-сайт | в приложении отсутствует вовсе (F4) |
| X-Frame-Options | `DENY` | `deploy/Caddyfile.prod:32`; `src/proxy.ts:67` | Caddy — весь сайт; proxy — только `/api` | на HTML приложения нет (F1); конфликт с SAMEORIGIN для PDF (F2, F3) |
| X-Frame-Options | `SAMEORIGIN` | `next.config.ts:93`; `route.ts:277` | `/api/reports/single-pdf/:path*` | фактически перекрыт `DENY` — проверено curl (F2) |
| X-Content-Type-Options | `nosniff` | `deploy/Caddyfile.prod:31`; `src/proxy.ts:66` | Caddy — весь сайт; proxy — только `/api` | на HTML приложения нет (F1) |
| Referrer-Policy | `strict-origin-when-cross-origin` | `deploy/Caddyfile.prod:33`; `src/proxy.ts:68` | Caddy — весь сайт; proxy — только `/api` | на HTML приложения нет (F1) |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(self), payment=(), usb=()` | `deploy/Caddyfile.prod:40`; `src/proxy.ts:72` | Caddy — весь сайт; proxy — только `/api` | на HTML приложения нет (F1) |
| Cross-Origin-Opener-Policy | `same-origin` | `deploy/Caddyfile.prod:41` | весь прод-сайт | в приложении нет (F4) |
| Cross-Origin-Resource-Policy | `same-origin` | `deploy/Caddyfile.prod:42` | весь прод-сайт | в приложении нет (F4) |
| X-XSS-Protection | `0` | `next.config.ts:109` | все маршруты (`source: "/(.*)"`) | ПРОЙДЕНО (легаси-фильтр отключён) |
| X-DNS-Prefetch-Control | `off` | `next.config.ts:110` | все маршруты | ПРОЙДЕНО |
| X-Powered-By | `Next.js` (баннер не отключён) | по умолчанию Next; снимается `deploy/Caddyfile.prod:29` | все | `poweredByHeader:false` в `next.config.ts` нет → вне Caddy баннер остаётся (F10) |
| Server | Caddy добавляет? — своего `Server` не ставит; строка `-Server` на `deploy/Caddyfile.prod:28` | `deploy/Caddyfile.prod:28` | прод | вне Caddy баннер может ставить Node/Next |
| Cookie `pt-session` | `HttpOnly; SameSite=Lax; Secure` (только `NODE_ENV==='production'`); `Path=/`; `Max-Age=43200` | `src/services/auth/session-service.ts:283-287` (и `:297-301` при выходе) | все ответы входа/выхода | нет префикса `__Host-` (F12) |

---

## Находки

| # | Severity | path:line | Проблема | Сценарий / почему важно | Как чинить |
|---|---|---|---|---|---|
| F1 | важно | `src/proxy.ts:225` (вызов) против `src/proxy.ts:241-244` (HTML-ветка) | `addSecurityHeaders` вызывается только в ветке `/api` (`:212`, `:225`). HTML-ветка ставит только CSP. Комментарий `:63-65` («здесь они нужны для развёртываний без Caddy») описывает поведение, которого нет. | Проверено curl: `/login` и `/` не несут `x-frame-options`, `x-content-type-options`, `referrer-policy`, `permissions-policy`. В проде их добавляет Caddy, но при развёртывании без него (dev/staging/`docker-compose.yml` c `3000:3000`) HTML-страницы отдаются без кликджекинг-защиты и без `nosniff`. | Добавить `addSecurityHeaders` в HTML-ветку (после `:242`) либо поправить комментарий, если полагаемся только на Caddy. |
| F2 | важно | `src/proxy.ts:67`; `next.config.ts:93`; `src/app/api/reports/single-pdf/route.ts:277` | На одном ответе три источника `X-Frame-Options`: proxy ставит `DENY`, `next.config` и роут — `SAMEORIGIN`. Победил `DENY`. | Проверено curl: `x-frame-options: DENY`, ровно одно вхождение, хотя `next.config.ts:91-93` объявляет `SAMEORIGIN`. Встроенный предпросмотр PDF в `<iframe>` (`src/components/piling/pdf-preview-dialog.tsx:22-25`) работает только потому, что рядом идёт `Content-Security-Policy: frame-ancestors 'self'` (`route.ts:278`), а браузеры при наличии `frame-ancestors` игнорируют XFO. Если CSP на этом маршруте уберут/ослабят — предпросмотр и «Печать» отвалятся. Заявленное разрешение фрейминга фактически не действует. | Не ставить глобальный `DENY` на пути, которым управляет `next.config` (исключить `/api/reports/single-pdf`), либо согласовать: убрать `SAMEORIGIN` и оставить только CSP `frame-ancestors 'self'`, задокументировав. |
| F3 | важно | `deploy/Caddyfile.prod:32` | Caddy ставит `X-Frame-Options "DENY"` внутри сайта, без исключения для PDF-эндпоинта. `header` Caddy задаёт значение (замещая), т.е. `SAMEORIGIN` приложения не доедет. | То же, что F2, но на проде: PDF-эндпоинт получает `DENY`. Выживает лишь за счёт `frame-ancestors 'self'`. Плюс расхождение значений `DENY` (XFO) и `'self'` (CSP) на одном ответе — неочевидная связка, которую легко сломать при правке CSP. | Либо добавить в Caddy отдельный `handle`/matcher для `/api/reports/single-pdf*` со своим `header`, либо снять требование фрейминга и убрать `SAMEORIGIN` из `next.config.ts`. |
| F4 | важно | `deploy/Caddyfile.prod:30,41,42` | HSTS, COOP, CORP заданы только в Caddy. В `src/proxy.ts` и `next.config.ts` их нет ни в каком виде. | Любое развёртывание приложения напрямую (без Caddy) отдаёт HTML без HSTS и без COOP/CORP. Для прод-контура это закрыто тем, что `docker-compose.prod.yml:24-25` публикует порт только на `127.0.0.1:3000` — приложение снаружи не видно, но конфигурация Caddy на сервере — единственный носитель этих правил, и её расхождение с файлом ничем не ловится. | Оставить Caddy источником истины, но добавить в отчёт по выкладке проверку `curl -sI https://orionpiling.ru | grep -i 'strict-transport\|cross-origin'`, либо продублировать HSTS/COOP/CORP в proxy с оговоркой о двойном заголовке. |
| F5 | мелочь | `src/proxy.ts:155-186` | В CSP нет директив отчётов (`report-uri`/`report-to`) и обязательного для CSP3 `report-to`+`Reporting-Endpoints`. | Нарушения политики в браузерах пользователей никуда не уходят: искать регрессии CSP можно только вручную в консоли. В `next.config.ts:34-40` упомянута кампания csp-monitoring — без отчётов она слепа. | Добавить `report-uri`/`report-to` с эндпоинтом приёма (задача вне этого аудита — нужен сервис-приёмник). |
| F6 | мелочь | `src/proxy.ts:179` | `connect-src 'self' https:` в проде разрешает HTTP-запросы fetch/XHR на любой HTTPS-домен. | Sentry в браузере идёт через собственный туннель `/_relay` (same-origin, `next.config.ts:150`), погода запрашивается на сервере (`src/services/weather/weather-client.ts:84-90`). Если верно, что клиентских обращений наружу нет, `https:` избыточен и расширяет поверхность эксфильтрации при XSS. | ГИПОТЕЗА: сузить до `connect-src 'self'` (проверить, что Sentry-туннель не отключается). |
| F7 | мелочь | `src/proxy.ts:175` | `img-src 'self' data: blob: https:` — разрешены изображения с любого HTTPS-домена. | Оправдано только если в проде задан внешний `CDN_BASE_URL` (`src/core/media/media-service.ts:507`, `:312-314`); иначе все картинки свои (`/api/media/...`). | Сузить до конкретного домена CDN либо до `'self' data: blob:`, если CDN не используется. |
| F8 | мелочь | `src/proxy.ts:172` | `style-src 'self' 'unsafe-inline'`. | Задокументировано в коде (`:170-171`). Нужно из-за inline-стилей (Radix/`style=`-атрибуты). Безопасность inline CSS ниже, чем JS. Приемлемо, но это единственная явная поблажка в проде кроме `wasm-unsafe-eval`. | Оставить; при желании перейти на hash/nonce для `<style>`. |
| F9 | мелочь | `src/proxy.ts:169` | В прод `script-src` включён `'wasm-unsafe-eval'`. | Если приложение не использует WebAssembly, директива лишняя и ослабляет политику. | НЕ ПРОВЕРЕНО (не искал использование WASM); убрать, если не нужна. |
| F10 | мелочь | `next.config.ts` (нет `poweredByHeader: false`) | `X-Powered-By: Next.js` не отключён в приложении; снимается только Caddy (`deploy/Caddyfile.prod:29`). | Проверено curl: `X-Powered-By: Next.js` присутствует в dev. Раскрытие стека вне Caddy. | Добавить `poweredByHeader: false` в `next.config.ts`. |
| F11 | мелочь | `src/proxy.ts:19` + `:219-222` | `getAllowedOrigins()` безусловно включает `http://localhost:3000` и `http://127.0.0.1:3000` вне зависимости от NODE_ENV; `Access-Control-Allow-Credentials: true` ставится вместе с отражением Origin. | Проверено curl: `-H "Origin: http://localhost:3000"` → `access-control-allow-origin: http://localhost:3000` + `access-control-allow-credentials: true` и на dev, и так же будет в проде. Смягчено тем, что списком управляет `CORS_ALLOWED_ORIGINS`/`NEXT_PUBLIC_APP_URL`, а чужие домены не отражаются. | Не добавлять localhost-источники, когда `NODE_ENV==='production'`. |
| F12 | мелочь | `src/services/auth/session-service.ts:283-287` | Cookie `pt-session` без префикса `__Host-`. | `__Host-` (обязателен `Secure`, `Path=/`, без Domain) не даёт поддомену подсунуть одноимённый cookie. Сейчас защита держится на значении `Host`-источника. | Переименовать в `__Host-pt-session` (учесть, что старые cookie надо инвалидировать вместе с токенами). |
| F13 | мелочь | `src/proxy.ts:167-168` | В dev `script-src 'self' 'unsafe-eval' 'unsafe-inline'` без nonce и strict-dynamic. | Задокументировано (`:160-166`), включается только при `NODE_ENV==='development'`. Тест `proxy-csp.test.ts:57-77` это фиксирует. Приемлемо. | Оставить. |
| F14 | мелочь | `Caddyfile:9-18` | Корневой (dev) Caddyfile на `:81` не ставит ни одного заголовка безопасности; блок с HSTS/XFO/Referrer/Permissions закомментирован (`:36-43`). | Если этот файл когда-нибудь уедет на стенд, стенд будет без заголовков. | Пометить в файле, что это только dev, либо добавить заголовки и в dev-блок. |
| F15 | мелочь | `src/proxy.ts:155-186` | В CSP нет `upgrade-insecure-requests`. | При смешанном контенте браузер не апгрейдит http-подресурсы; впрочем, `default-src 'self'` их и так запретит. | Добавить `upgrade-insecure-requests` при переходе на прод-CSP. |
| F16 | мелочь | `src/proxy.ts:250-259` | Matcher пропускает `_next/static`, `_next/image`, `favicon.ico`, `icon-*` и префетч-запросы — эти ответы не несут CSP и заголовков безопасности. | Для immutable-ассетов это норма; но оптимизатор изображений (`/_next/image`) отдаёт динамические ответы без `nosniff`. | При желании поставить `X-Content-Type-Options` на `/_next/image` в `next.config.ts`. |
| F17 | мелочь | `deploy/Caddyfile.prod:41-42` | `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Resource-Policy: same-origin` включаются сразу на весь сайт, включая проксируемый `/grafana` (`:46-49`). | COOP `same-origin` разрывает `window.opener`-связи; сценарии «открыть PDF в новом окне» (`equipment-report-export.tsx` через `window.open`) используют `blob:`/новое окно и с одним и тем же origin, поэтому ломаться не должны — но это не проверялось на проде. | НЕ ПРОВЕРЕНО. Проверить открытие PDF/печатных форм под COOP на стенде. |

### «ПРОЙДЕНО» (положительные проверки)

| # | Что | Evidence |
|---|---|---|
| P1 | Per-request nonce, `strict-dynamic` в проде, «свежий nonce на запрос», отсутствие `unsafe-eval` в проде | `src/proxy.ts:169,233-242`; тест `src/__tests__/proxy-csp.test.ts` — 8 passed (команда в «Методике») |
| P2 | `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'` | `src/proxy.ts:181-185` |
| P3 | Шрифты self-hosted (`next/font`), обращения к Google Fonts в рантайме нет; `font-src 'self' data:` | `src/app/layout.tsx:30-40`; `src/proxy.ts:176` |
| P4 | Cookie: `HttpOnly`, `SameSite=Lax`, `Secure` в prod, `Path=/`, TTL 12 ч | `src/services/auth/session-service.ts:8,283-287` |
| P5 | `X-XSS-Protection: 0`, `X-DNS-Prefetch-Control: off` на всех маршрутах | `next.config.ts:107-111`; подтверждено curl |

---

## Не проверено

- **Прод-CSP в рантайме** (nonce + `strict-dynamic` на реальных страницах, штампуется ли nonce на
  все 17 тегов scripts). Снимался только dev (`NODE_ENV=development`) на `localhost:3000`;
  прод-сборка не запускалась. Утверждение `next.config.ts:37-40` («17 из 17 с nonce» под webpack)
  не воспроизводил.
- **Фактические заголовки боевого сайта** `orionpiling.ru`. `deploy/Caddyfile.prod` объявлен
  источником истины, но совпадает ли с `/etc/caddy/Caddyfile` на VPS — не проверял (нет доступа к
  серверу, и это запрещено правилами).
- **Эмпирика снята с соседнего дерева** `D:\PillingR\my-project` (head `2ecc754f`, ветка `main`),
  а не из `wt-night`. Пять релевантных файлов побайтово совпадают (`diff -q` без вывода), но
  собственных запущенных инстансов у аудируемой папки я не поднимал.
- **Проверка `/api/reports/single-pdf` под сессией** (ветка sync/download с `X-Frame-Options`
  внутри `route.ts:271-280`). Запрос без авторизации вернул 401 до этой ветки; поэтому вывод про
  приоритет `DENY` сделан на пути 401, где сам роут заголовков ещё не ставил, а `next.config`
  ставил. Под авторизацией не проверял (нет учётных данных).
- **Значение `CDN_BASE_URL` в проде** — не читал `.env*` (запрещено правилами). Отсюда
  «нужен ли `img-src https:`» — ГИПОТЕЗА (F7).
- **Использует ли клиент WebAssembly** (F9) и остаются ли клиентские обращения к внешним доменам
  кроме туннеля Sentry (F6) — не проверял.
- **Поведение COOP/CORP** на реальных сценариях печати/просмотра PDF (F17) — не проверял.
- **Dev-Caddyfile на `:81`** фактическим запросом не проверял (Caddy на этой машине не запущен).
- **`frame-src 'self' blob:`** — законность `blob:` на практике (нужен ли он вообще) — не проверял.
