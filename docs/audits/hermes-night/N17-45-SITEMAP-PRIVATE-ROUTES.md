# N17-45-SITEMAP-PRIVATE-ROUTES — Карта сайта и robots: попадают ли служебные страницы

Версия (`git rev-parse HEAD` рабочей папки): `644cb5bcc511720d7a9f400a87354f7c1adfbb83`
Ветка: `hermes/code-1011`. Рабочая папка: `D:/PillingR/wt-night-code` (в тексте задания указана `D:/PillingR/wt-night-code-code` — такой папки нет; работал в текущей по указанию владельца). Режим: только чтение — код приложения не менялся, создан и закоммичен только этот файл.

## Резюме для владельца

1. **В карту сайта служебные страницы не попадают.** `src/app/sitemap.ts:12-20` отдаёт ровно один адрес — `/orion`; ни админки, ни оператора, ни отчётов, ни страниц с идентификаторами там нет. Ответ на главный вопрос задания — «нет».
2. **Карта и robots отдаются всем без входа** — это нормально и так задумано: `sitemap.xml` генерирует маршрут метаданных Next (`src/app/sitemap.ts`), `robots.txt` — статический файл `public/robots.txt` (копируется в образ, `Dockerfile:97`). Ни на том, ни на другом нет проверки сессии.
3. **Главный дефект robots: два блока разрешают всё.** `public/robots.txt:30-34` — `User-agent: Twitterbot` и `User-agent: facebookexternalhit` с `Allow: /` **без единого `Disallow`**. По правилам robots для такого агента применяется только его собственный блок, поэтому `Disallow` из блока `*` (`:38-45`) на них не действует: им открыты `/admin`, `/api`, `/_relay`, `/print`. Это прямо противоречит собственному комментарию файла (`:1-6`).
4. **Список запретов неполон:** нет `/print` (реальный маршрут `src/app/print/briefing-journal/page.tsx:18`), нет `/assistant` (`src/app/(app)/assistant/page.tsx:12`), нет `/no-access` (`src/app/(app)/no-access/page.tsx:21`). Из четырёх путей, названных в задании (`/admin`, `/api`, `/operator`, `/print`), в robots присутствуют три, `/print` — отсутствует.
5. **Данные под этими страницами всё равно закрыты сервером:** без сессии `journal` отвечает 401 (`src/app/api/briefings/journal/route.ts:29`), `/admin/*` — серверный redirect (`src/app/(app)/admin/layout.tsx:8-9`). Реальной утечки данных в находках нет — серьёзность «критично»/«важно» не подтвердилась.

## Итог

- Всего находок: **8**. По важности: **критично — 0**, **важно — 0**, **мелочь — 8**.
- Ответы на вопросы задания:
  1. В карту попадает **только `/orion`** (`src/app/sitemap.ts:12-20`). Админских (`/admin/**`), операторских (`/operator/**`), отчётных (`/report`, `/admin/reports`), служебных (`/print`, `/no-access`) и страниц с идентификаторами (`/inspections/[id]`, `/admin/equipment/[id]`) в карте **нет** — ПРОЙДЕНО.
  2. Карта и robots **отдаются всем без входа** (нет `requireAuth`, нет `withApi`) — ПРОЙДЕНО по коду.
  3. В robots.txt запрещены `/admin`, `/operator`, `/report`, `/monitoring`, `/history`, `/inspections`, `/login`, `/api/` (`public/robots.txt:8-45`) — эти префиксы совпадают с реальными маршрутами. **Не запрещены** `/print`, `/assistant`, `/no-access`; `Disallow: /api/` не покрывает ровно `/api`.
  4. В карте адресов с данными объектов или людей **нет**; из публично достижимых адресов параметры несёт только `/print/briefing-journal?from=&to=` — это даты, не идентификаторы.
  5. Теста на `sitemap`/`robots.txt` **нет** (`rg` по `e2e`, `tests`, `src` — 0 совпадений).
- Топ-5:
  1. (мелочь) `public/robots.txt:30-34` — Twitterbot/facebookexternalhit: `Allow: /` без `Disallow`, блок `*` на них не действует.
  2. (мелочь) `public/robots.txt:36-45` — нет `Disallow: /print`; реальный маршрут `src/app/print/briefing-journal/page.tsx:18`.
  3. (мелочь) `public/robots.txt:36-45` — нет `Disallow: /assistant` (`src/app/(app)/assistant/page.tsx:12`).
  4. (мелочь) `public/robots.txt:45` — `Disallow: /api/` не покрывает ровно `/api` (`src/app/api/route.ts:13`).
  5. (мелочь) теста на `sitemap`/`robots.txt` нет (см. «Методику»).

## Методика

Только чтение, повторяемо (bash, `rg` + чтение файлов; `sed`/`head`/`ls` в этом окружении недоступны — использовал `rg` и инструмент чтения файлов):

- Точка входа: `git rev-parse HEAD`; перечисление маршрутов — `rg --files src/app -g "page.tsx" -g "layout.tsx" -g "route.ts"` и чтение каталогов `src/app/**`.
- robots/sitemap: `rg -n "robots" src public` (даёт 0 — в самом `public/robots.txt` слово «robots» не встречается), `rg -n "sitemap" .`, `rg --files -g "*robots*"`, чтение `public/robots.txt` и `src/app/sitemap.ts` целиком.
- Защита разделов: чтение `src/app/(app)/layout.tsx`, `src/app/(app)/admin/layout.tsx`, `src/app/(app)/(safety)/layout.tsx`, `src/app/(app)/(readiness-admin)/layout.tsx`, `src/app/page.tsx`, `src/app/(auth)/login/page.tsx`; поиск серверных гвардов (`readPageSessionUser`, `redirect`) по `layout.tsx`.
- Данные: `src/app/api/briefings/journal/route.ts`, `src/app/api/settings/route.ts`, `src/app/api/route.ts`, `src/app/api/health/route.ts`, `src/app/api/metrics/route.ts`.
- Прочее: `rg -n "noindex|index: false|robots:" src` (0), `next.config.ts` (`headers()`, `tunnelRoute`), `Dockerfile` (копирование `public`).
- Тест: `rg -n -i "sitemap|robots\.txt|/print|briefing-journal" e2e tests src --glob '*test*' --glob '*spec*'` — совпадения только по `/print/briefing-journal` (функциональный тест печати), ни одного по `sitemap`/`robots.txt`.
- Соглашение о статусах: **ПРОЙДЕНО** = подтверждено чтением кода по указанному `path:line`; **ГИПОТЕЗА** = вывод о последствии, воспроизведением не подтверждён; **НЕ ПРОВЕРЕНО** = не смотрел/не запускал. Ни один тест/сборка/сервер не запускались (задача — только чтение).

## Таблица «адрес или шаблон | доступен без входа | что раскрывает | файл:строка | рекомендация»

| Адрес / шаблон | Доступен без входа | Что раскрывает | Файл:строка | Рекомендация |
|---|---|---|---|---|
| `/orion` (единственный в sitemap) | да — публичная витрина, так задумано | название компании, телефон/почта/адрес в JSON-LD | `src/app/sitemap.ts:15`; `src/app/orion/page.tsx:44-56` | оставить: это и есть публичный сайт |
| `/sitemap.xml` | да (маршрут метаданных, без авторизации) | только `/orion` | `src/app/sitemap.ts:12-20` | оставить |
| `/robots.txt` | да (статический файл из `public/`) | список запретов | `public/robots.txt`; `Dockerfile:97` | оставить, дополнить запреты (см. ниже) |
| `/admin`, `/admin/**` (в т.ч. `/admin/to`, `/admin/safety`) | нет — серверный redirect на `/login` | ничего | `src/app/(app)/admin/layout.tsx:8-9`; `(safety)/layout.tsx:20-21`; `(readiness-admin)/layout.tsx:10-11` | есть в robots (`:38,41,44`), оставить |
| `/operator`, `/operator/v2`, `/operator/v3` (и замороженные `/operator/v5,v7,v10`) | оболочка HTTP 200 без данных (клиентский редирект) — ГИПОТЕЗА по коду | названия разделов, разметка навигации | `src/app/(app)/operator/page.tsx:20-25`; `src/app/(app)/layout.tsx:301-359` | есть в robots (`:39`), оставить |
| `/report` | оболочка HTTP 200 без данных — ГИПОТЕЗА по коду | ничего | `src/app/(app)/report/page.tsx:1-6` | есть в robots (`:40`), оставить |
| `/monitoring`, `/history` | оболочка HTTP 200 без данных — ГИПОТЕЗА по коду | названия разделов | `src/app/(app)/monitoring/page.tsx:1-23`; `src/app/(app)/history/page.tsx:1-7` | есть в robots (`:41,42`), оставить |
| `/inspections`, `/inspections/[id]`, `/inspections/new` | оболочка HTTP 200; в `[id]` — UUID объекта в URL | UUID проверки в адресе | `src/app/(app)/inspections/page.tsx:1-7`; `src/app/(app)/inspections/[id]/page.tsx` | есть в robots (`:43`), оставить |
| `/assistant` | оболочка HTTP 200 без данных | название рабочего места помощника | `src/app/(app)/assistant/page.tsx:12-14` | добавить `Disallow: /assistant` |
| `/no-access?from=…` | нет — серверный redirect на `/login` | ничего (в robots не перечислен) | `src/app/(app)/no-access/page.tsx:26-27` | добавить `Disallow: /no-access` |
| `/print/briefing-journal?from=&to=` | да, оболочка; данные — 401 | заголовок «Журнал регистрации инструктажей по охране труда»; в адресе только даты | `src/app/print/briefing-journal/page.tsx:18`; `src/components/piling/briefings/briefing-journal-print.tsx:132-149`; `src/app/api/briefings/journal/route.ts:29` | добавить `Disallow: /print` |
| `/login` | да — это экран входа | интерфейс входа | `src/app/(auth)/login/page.tsx:9-23` | есть в robots (`:16`), оставить |
| `/api`, `/api/*` | `/api` и `/api/health` публичны (узкий ответ), остальное 401 | `status/version/uptime` | `src/app/api/route.ts:13`; `src/app/api/health/route.ts:24-37` | `Disallow: /api/` не покрывает `/api` — добавить строкой `/api` |
| `/_relay` (тоннель Sentry, POST) | не страница (GET обрабатывается rewrite) | ничего | `next.config.ts:150` | при желании `Disallow: /_relay` |

## Находки

| # | важность | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | мелочь | `public/robots.txt:30-34`; контекст `:1-6` | Блоки `User-agent: Twitterbot` и `User-agent: facebookexternalhit` содержат `Allow: /` и **ни одного `Disallow`**. По семантике robots применяется блок конкретного агента, и `Disallow` из блока `*` (`:38-45`) на них не распространяется. | Эти два агента получают разрешение обойти всю систему, включая `/admin`, `/api`, `/_relay`, `/print` — именно то, от чего файл защищает остальных (комментарий `:1-6` предупреждает про это свойство, но два блока остались без запретов). Данные не утекают (за страницами — 401/redirect), поэтому «мелочь»: реальный сценарий — обход краулером служебных адресов и индексация пустых оболочек. | Добавить в оба блока тот же список `Disallow`, что и в `*` (или `Allow: /orion` + `Disallow: /`). |
| 2 | мелочь | `public/robots.txt:36-45` | Нет `Disallow: /print`. Реальный маршрут: `src/app/print/briefing-journal/page.tsx:18`; без сессии страница отдаёт оболочку, данные — 401 (`src/components/piling/briefings/briefing-journal-print.tsx:132-149`; `src/app/api/briefings/journal/route.ts:29`). | `/print` назван в задании как ожидаемый запрет, но не запрещён. Краулер, которому разрешено (агенты из находки №1 и любые, кому подходит `*`, кроме Google/Bing), проиндексирует страницу с заголовком «Журнал регистрации инструктажей по охране труда» и текстом «Сессия истекла» — раскрывает название документа, не данные. | Добавить `Disallow: /print`. |
| 3 | мелочь | `public/robots.txt:36-45` | Нет `Disallow: /assistant`. Маршрут `src/app/(app)/assistant/page.tsx:12`; серверного гварда нет (своей папки `layout.tsx` нет, общий `(app)/layout.tsx` — клиентский, `:301-359`). | Внутреннее рабочее место помощника машиниста попадает в индекс как пустая оболочка; структурная подсказка о системе. Данных нет. | Добавить `Disallow: /assistant`. |
| 4 | мелочь | `public/robots.txt:45`; `src/app/api/route.ts:13` | `Disallow: /api/` — префикс с косой чертой; адрес ровно `/api` (публичный health, `src/app/api/route.ts:13`) под него не подпадает. | Публичный JSON `{"status":"ok","version":…}` остаётся доступен для обхода краулерами, хотя в комментарии он отнесён к закрытым (`public/robots.txt:2`). Данных не раскрывает (health умышленно узкий, см. `src/app/api/health/route.ts:4-15`). | Добавить отдельной строкой `Disallow: /api` (без косой черты) либо заменить `/api/` на `/api`. |
| 5 | мелочь | `e2e` / `tests` / `src` (поиск, 0 совпадений) | Нет ни одного теста на `sitemap` и `robots.txt` (см. «Методику»). Существующие совпадения по `/print/briefing-journal` — функциональные тесты печати, не SEO. | Регрессию robots/sitemap (например, случайное добавление служебного адреса в `sitemap.ts`) ничто не поймает — а задача №4 как раз про появление приватных адресов в карте. | Добавить по одному дешёвому тесту: `sitemap()` содержит только `/orion`; список `Disallow` включает `/admin`, `/operator`, `/print`. |
| 6 | мелочь | `public/robots.txt:47`; `src/app/sitemap.ts:10` | Домен зашит дважды: `Sitemap: https://orionpiling.ru/sitemap.xml` (жёстко) и дефолт `NEXT_PUBLIC_SITE_URL ?? 'https://orionpiling.ru'`. | При переносе на новый домен (и/или если `NEXT_PUBLIC_SITE_URL` не проброшен на сборке — известно из `docs/audits/hermes-night/AU163-S7-ENV-DOCKER-COMPOSE-DRIFT.md:80,146`) и карта, и директива `Sitemap:` укажут на старый домен. Приватных адресов не добавляет; перекликается с уже зафиксированным `W108-HARDCODED-HOSTS.md:43`. | Держать домен в одной переменной окружения и подставлять в оба места; по возможности не полагаться на дефолт. |
| 7 | мелочь | `next.config.ts:150` | Тоннель Sentry `/_relay` не упомянут в robots.txt. | Это POST-обработчик, страницы за ним нет; GET уходит в rewrite. Практического индекса нет; приведено для полноты списка «служебных» путей. | Не обязательно; при желании добавить `Disallow: /_relay`. |
| 8 | мелочь | `src/app/sitemap.ts:15` | `lastModified: new Date()` при `export const dynamic = 'force-dynamic'` в корневом `layout.tsx:15` — метка «изменено» меняется на каждом запросе. | Не приватность, а качество сигнала: «дата изменения» всегда «сейчас», поиск не может отличить обновление от перезапроса. | Если карта реально не меняется, отдавать фиксированную дату или убрать `lastModified`. |

## Приложение: проверено, замечаний нет

- Карта сайта содержит единственный публичный адрес и не тянет ничего из служебного: `src/app/sitemap.ts:12-20` (ПРОЙДЕНО по коду).
- Заголовок комментария карты («всё приложение `/admin`, `/operator`, `/report`, `/api` закрыто входом») для серверно-гвардированных разделов верен: `src/app/(app)/admin/layout.tsx:8-9`, `src/app/(app)/(safety)/layout.tsx:20-21`, `src/app/(app)/(readiness-admin)/layout.tsx:10-11`, `src/app/page.tsx:10-23`.
- Префиксы `Disallow`, которые уже есть в robots, совпадают с реальными маршрутами: `/admin` (`src/app/(app)/admin/page.tsx`), `/operator` (`src/app/(app)/operator/page.tsx:20`), `/report` (`src/app/(app)/report/page.tsx`), `/monitoring` (`src/app/(app)/monitoring/page.tsx`), `/history` (`src/app/(app)/history/page.tsx`), `/inspections` (`src/app/(app)/inspections/page.tsx`), `/login` (`src/app/(auth)/login/page.tsx`), `/api/` (`src/app/api/route.ts`).
- `public/robots.txt` реально доедет до прода: `Dockerfile:97` копирует `/app/public` в образ.
- Данные служебных страниц за API закрыты: `src/app/api/briefings/journal/route.ts:27-34` (`withApi` + `requireAuth`), `src/app/api/settings/route.ts:16-22`. `src/app/print/briefing-journal/page.tsx:14-16` прямо описывает, что отдельной защиты у страницы нет и данные берутся под 401.
- В коде нет `noindex` и метаданных `robots` (`rg -n "noindex|index: false|robots:" src` → 0); корневой `src/app/layout.tsx:79-98` таких директив не задаёт.

## Что не проверено

- **Сервер не запускался, `npm run build`/тесты не выполнялись.** Задача — только чтение. Утверждения «оболочка отдаётся HTTP 200 без входа» для `/operator`, `/report`, `/monitoring`, `/history`, `/inspections`, `/assistant` выведены из кода (клиентский `(app)/layout.tsx:301-359`, отсутствие серверных `layout.tsx` в этих папках) и помечены ГИПОТЕЗОЙ по последствию: реальный HTTP-код ответа и содержимое HTML не измерял.
- Не проверял фактическое поведение краулеров Twitterbot/facebookexternalhit: вывод о неприменении блока `*` к агенту с собственным блоком — по правилам robots (и по комментарию `public/robots.txt:1-6`), не по эксперименту.
- Не проверял `sitemap.xml`/`robots.txt` в продакшене (нет доступа к боевому сайту и запуска): отдаётся ли `sitemap.xml` фактически по адресу `https://orionpiling.ru/sitemap.xml` и совпадает ли прод-robots с рабочей копией — не сопоставлял.
- Замороженные зоны (экраны оператора `/operator/v5,v7,v10`, сайт ORION) читал только на предмет маршрутов и robots; логику экранов не разбирал, правок не предлагал.
- Полный перечень API-маршрутов на «публичность» не аудировал (вне рамок): за пределами проверки остались все `src/app/api/**`, кроме `route.ts`, `health`, `metrics`, `settings`, `briefings/journal`. Находка №4 касается только части `robots.txt`, не самих API.
- Существующие отчёты `W108-HARDCODED-HOSTS.md`, `AU163-S7-ENV-DOCKER-COMPOSE-DRIFT.md`, `N17-40-DEV-ONLY-ROUTES-IN-PROD.md` прочитаны выборочно (по совпадениям в `rg`); полного пересечения находок не сверял.
