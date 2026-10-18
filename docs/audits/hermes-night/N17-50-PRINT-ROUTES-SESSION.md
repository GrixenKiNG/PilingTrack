# N17-50-PRINT-ROUTES-SESSION: Печатные маршруты и формы — вход, роль, объект, индексация, данные

Версия рабочей папки (`git rev-parse HEAD`): `01a038db2aad7e9c23af9da804df7542c09eb46e`
(ветка `hermes/code-1011`, рабочая папка `D:\PillingR\wt-night-code`; в тексте задания
названа `D:/PillingR/wt-night-code-code` — такой папки нет, работал в текущей по
указанию владельца). Режим: **только чтение** — код приложения не менялся, создан и
закоммичен только этот отчёт. Замороженные зоны (экраны оператора `/operator*`, сайт
ORION) читались только для контекста, правок и предложений об удалении нет.

## Итог

- Всего находок: **7**. По важности: **критично 0, важно 1, мелочь 6**. Ответы на пять
  вопросов задания:
  1. **Вход перед выдачей данных есть, но не на самой странице, а на API.** Печатная
     страница `/print/briefing-journal` намеренно без серверного гварда: данные берутся
     запросом `/api/briefings/journal`, который делает `requireAuth` + `requireTenantId`
     (`src/app/api/briefings/journal/route.ts:29,34`); без сессии — 401, лист остаётся
     пустым с русской ошибкой (`briefing-journal-print.tsx:147-149`). ПРОЙДЕНО.
  2. **IDOR по id из адреса в печатных путях не нашёл.** Печатный журнал принимает из
     адреса только `from/to/fromDay/toDay/kind` (`briefing-journal-print.tsx:75-85`), id
     объекта/человека там нет; арендатор берётся из сессии, не из параметра
     (`briefing-journal-query.ts:99,104`). PDF одного отчёта проверяет и арендатора, и
     владельца (`single-pdf/route.ts:92-94,214-221,263-265`). ПРОЙДЕНО.
  3. **Анти-индексации нет.** Ни в metadata страницы, ни заголовком: `page.tsx:5` задаёт
     только `title`; `X-Robots-Tag`/`noindex` в репозитории отсутствуют (0 совпадений);
     `/print` не запрещён в `public/robots.txt:36-45`. Совпадает с ранее
     зафиксированным `N17-45` (мелочь, не дублирую детально).
  4. **В печатных формах данных «сверх нужного» почти нет.** Единственные сомнительные
     места — графа «Должность» печатает системную роль, а не должность
     (`briefing-journal-print.tsx:258`), и карточка наряда ТО печатает внутреннюю
     стоимость и трудозатраты (`maintenance-detail-panel.tsx:101-102` внутри
     `.print-area`). Оба — мелочь.
  5. **Покрытие тестами неполное.** Есть компонентный тест
     (`briefing-journal-print.test.tsx`), доменный тест запрета 403
     (`operator-mobile-rules.test.ts:519-526`), e2e только на счастливый путь
     (`release-critical-path.spec.ts:146-172`). **Нет ни одного маршрутного теста у
     `/api/briefings/journal`** — у соседних PDF-маршрутов они есть (`reports/pdf`,
     `reports/single-pdf`).
- Самый важный пункт — №1: связка «вход + роль + арендатор» кормящего печать API не
  покрыта маршрутным тестом. Реальной дыры доступа в печатных путях нет.

## Методика

Только чтение, повторяемо (bash + `rg` + инструмент чтения файлов; `sed`/`head`/`ls` в
этом окружении недоступны — использовал `rg` и чтение файлов):

- Версия/ветка: `git rev-parse HEAD`, `git branch --show-current`, `git status --porcelain`.
- Перечисление печатных точек: `rg -n "window\.print|print-area|print-screen|@media print" src`
  и `rg --files src/app/print`.
- Вход/роль/арендатор по API: чтение `src/app/api/briefings/journal/route.ts`,
  `src/modules/operator-mobile/application/briefing-journal-query.ts`,
  `src/app/api/settings/route.ts`, `src/app/api/reports/single-pdf/route.ts`,
  `src/app/api/reports/pdf/route.ts`, `src/app/api/reports/export/route.ts`,
  `src/app/api/readiness/export/route.ts`, `src/app/api/admin/equipment-analytics/route.ts`.
- Права: `rg -n "reports\.read_all|reports\.read_cross_user|users\.documents\.read_all|analytics\.read" src/services/auth`.
- Анти-индексация и кэш: `rg -n "X-Robots-Tag|x-robots-tag|noindex" .`,
  `rg -n "cache-control|no-store|Cache-Control" src`, чтение `public/robots.txt`,
  `next.config.ts:86-118`, `src/proxy.ts` (ветка HTML `:231-244`, `frame-ancestors` `:182`).
- Печатные поверхности: чтение `src/app/print/briefing-journal/page.tsx` и `print.css`,
  `src/components/piling/briefings/briefing-journal-print.tsx`,
  `src/components/piling/admin-reports/print-screen.tsx`,
  `src/components/piling/admin-reports/admin-reports.tsx:335-454`,
  `src/components/piling/maintenance/maintenance-detail-panel.tsx:45-166`,
  `src/components/piling/equipment-analytics.tsx:140-170`,
  `src/components/piling/pdf-preview-dialog.tsx:1-45`,
  `src/components/piling/admin-equipment/detail/equipment-report-export.tsx`.
- Гварды экранов: `src/app/(app)/admin/layout.tsx`, `src/app/(app)/layout.tsx:290-349`,
  `src/app/(app)/monitoring/page.tsx`.
- Тесты: `rg -n -i "print|journ|single-pdf|reports/pdf" e2e`;
  `rg -n "listBriefingJournal|mayReadAllDocuments" src`; чтение
  `briefing-journal-print.test.tsx`, `operator-mobile-rules.test.ts:505-527`,
  `e2e/release-critical-path.spec.ts:146-172`, `e2e/qa-ac/rbac-negative.spec.ts:82`;
  `glob src/app/api/briefings/journal/**`, `glob src/app/api/reports/**/__tests__/*.ts`.
- Опора на ранее подтверждённое (цитирую как источник, повторно не перепроверял):
  `N17-45-SITEMAP-PRIVATE-ROUTES.md` (robots/sitemap и `/print`),
  `N17-39-API-CACHE-HEADERS.md` (заголовки кэша и централизованный `no-store`).

Статусы: **ПРОЙДЕНО** — подтверждено чтением кода по указанному `path:line`;
**ГИПОТЕЗА** — вывод о последствии, воспроизведением не подтверждён;
**НЕ ПРОВЕРЕНО** — не смотрел/не запускал. Ни сборка, ни тесты, ни сервер не
запускались (задача — только чтение).

## Таблица «страница | проверка входа | проверка роли и объекта | что отдаётся | файл:строка | риск»

| страница | проверка входа | проверка роли и объекта | что отдаётся | файл:строка | риск |
|---|---|---|---|---|---|
| `/print/briefing-journal` (отдельный лист журнала) | на странице нет (осознанно); данные — 401 без сессии | роль `users.documents.read_all` проверяет API-запрос; арендатор — из сессии, объект по id не запрашивается | шапка (Организация/ИНН/Период/Вид записей) и таблица: ФИО, роль, вид записи, инструкция, результат, «действует до», пустая графа «Подпись» | `src/app/print/briefing-journal/page.tsx:5,14-18`; `src/app/api/briefings/journal/route.ts:29,34,60`; `briefing-journal-print.tsx:216-270` | низкий |
| `/admin/safety?view=briefings` → кнопка «Печатная форма» (открывает лист выше) | серверный гвард раздела | ADMIN/DISPATCHER/FOREMAN/MECHANIC/SAFETY_ENGINEER | передаёт в адрес только период и `kind` (без id) | `src/app/(app)/admin/layout.tsx:8-16`; `to/readiness/screens/briefings-screen.tsx:180-193,297-300` | низкий |
| `/admin/reports` → «Печать» (`window.print()` c `.print-area`) | серверный гвард раздела | та же роль раздела; данные — из уже открытого отчёта пользователя | на лист остаётся только `.print-area` (без шапки/меню) | `src/app/(app)/admin/layout.tsx:8-16`; `admin-reports.tsx:347-353`; `print-screen.tsx:24-37` | низкий |
| карточка наряда ТО (`/admin/maintenance/...`) → «Печать» | серверный гвард раздела | та же роль раздела | карточка наряда: объект, бригада, оператор, наработка, диагностика/выполнено/запчасти, **трудозатраты `ч` и стоимость `₽`**, фото | `maintenance-detail-panel.tsx:60,101-102,159`; `print-screen.tsx:24-37` | низкий-средний (внутренняя стоимость на листе) |
| `/monitoring` → «Печать» (аналитика по установкам) | серверного гварда у страницы нет (общий `(app)` — клиентский); данные — API с 401 | блок виден по праву `analytics.read`; API проверяет то же право + арендатора | страница целиком, **включая администраторскую оболочку** (`.print-area` нет) | `src/app/(app)/monitoring/page.tsx:7-19`; `api/admin/equipment-analytics/route.ts:15,27-29`; `equipment-analytics.tsx:142,150` | низкий |
| PDF карточки отчёта в диалоге (`PdfPreviewDialog`) | страница-обёртка под гвардом раздела | API: `reports.read_cross_user` + арендатор + владелец отчёта | PDF одного отчёта (печать из просмотрщика браузера) | `pdf-preview-dialog.tsx:22-24,33-38`; `single-pdf/route.ts:92-94,263-265` | низкий |
| выгрузка PDF периода (`EquipmentReportExport`) | страница под гвардом раздела | API: `reports.read_all`; арендатор берётся из `user?.tenantId` | PDF периода по установке («Открыть/печать») | `equipment-report-export.tsx:81-84,112,174`; `reports/pdf/route.ts:87,118,303` | низкий |

Примечание: HTML-ответы печатных страниц в проде защищены от встраивания на Caddy
(`X-Frame-Options: DENY`, `deploy/Caddyfile.prod:31-32`) и nonce-CSP
(`frame-ancestors 'self'`, `src/proxy.ts:182`); кэш-заголовков у HTML-страницы нет, но
тело страницы данных не содержит (данные тянутся клиентом через API).

## Находки

| # | severity | статус | path:line | problem | scenario / why it matters | suggested fix |
|---|---|---|---|---|---|---|
| 1 | важно | ПРОЙДЕНО | `src/app/api/briefings/journal/route.ts:27-60` (нет каталога `__tests__`; подтверждено `glob src/app/api/briefings/journal/**`) | У маршрута, кормящего печатный журнал, **нет маршрутного теста** на связку «вход + право + арендатор». Покрытие разнесено: компонент мокает `fetch` (`briefing-journal-print.test.tsx:57-61,74-111`), домен проверяет только флаг (`operator-mobile-rules.test.ts:519-526`), e2e — только счастливый путь (`release-critical-path.spec.ts:146-172`). У соседних PDF-маршрутов маршрутные тесты есть (`reports/pdf/__tests__/route.test.ts`, `reports/single-pdf/__tests__/route.test.ts`). | Печатный журнал — персональные данные всех работников сразу. Если при рефакторинге из маршрута выпадет строка `mayReadAllDocuments: can(actor, 'users.documents.read_all')` (`:60`) или `requireTenantId` (`:34`), ни один быстрый тест этого не поймает: компонент видит только замоканный 403, домен проверяет флаг, который маршрут и должен передать, а e2e требует поднятой БД и в обычном прогоне не участвует. | Добавить один маршрутный тест: без сессии — 401; с сессией без `users.documents.read_all` — 403 (`can` → false); с правом — выборка вызывается с арендатором из сессии. По образцу `reports/pdf/__tests__/route.test.ts`. |
| 2 | мелочь | ПРОЙДЕНО | `src/app/print/briefing-journal/page.tsx:5`; `public/robots.txt:36-45` | Печатный лист не закрыт от индексации: `metadata` задаёт только `title` (нет `robots: {index:false}`), заголовок `X-Robots-Tag` в репозитории отсутствует (`rg` → 0), префикса `/print` в `robots.txt` нет. Дубль ранее зафиксированного `N17-45` (находка 2). | Краулер, которому разрешено (`*`, кроме Google/Bing, и агенты из `robots.txt:30-34` с `Allow: /`), проиндексирует оболочку с заголовком «Журнал регистрации инструктажей по охране труда» и текстом «Сессия истекла» — раскрывает название документа и структуру системы, не данные (за API — 401). | Добавить `Disallow: /print` в `robots.txt` (см. `N17-45`) и/или `robots: { index: false, follow: false }` в `metadata` страницы. |
| 3 | мелочь | ПРОЙДЕНО | `src/app/api/briefings/journal/route.ts:71`; `src/app/print/briefing-journal/page.tsx:18` | Ни ответ журнала, ни HTML печатной страницы не задают `Cache-Control`. Это часть уже описанной общей картины (`N17-39`, находка 1 — в `withApi` централизованно нет `private, no-store`/`Vary`); `readiness/export` — единственный маршрут с явным `no-store` (`readiness/export/route.ts:162`). | Ответ журнала содержит ФИО и должности. Сегодня защиты хватает (Next не кэширует dynamic GET, Caddy не кэширует, см. `N17-39`), но при появлении кэширующего прокси/CDN ответы по URL без `Vary: Cookie` могут переиспользоваться. HTML-оболочка безопасна (данных в теле нет). | Закрывается одной правкой на `withApi` (`N17-39`, находка 1); отдельно HTML печатной страницы защищать не нужно. |
| 4 | мелочь | ПРОЙДЕНО | `briefing-journal-print.tsx:244,258`; `src/lib/types.ts:15-23`; `prisma/schema.prisma:289-301` | Графа листа подписана «Должность», но печатает **системную роль** через `ROLE_LABELS[row.userRole]` («Оператор», «Помощник», …), а не должность работника. В модели поле прямо названо снимком должности: `userRole` (комментарий «СНИМОК ФИО И ДОЛЖНОСТИ», `schema.prisma:289-301`). | Лист журнала подшивают и подписывают. В графе «Должность» проверяющий увидит «Оператор», а не «Машинист буровой установки»/«Помощник машиниста». Подмены данных нет (роль — реальный снимок), но подпись графы ей не соответствует. Отдельного поля «должность» в схеме нет (`rg` по `position|jobTitle` → 0). | Либо переименовать графу в «Роль в системе», либо завести снимок должности в записи журнала и печатать его. Оценка решения — за владельцем. |
| 5 | мелочь | ПРОЙДЕНО | `maintenance-detail-panel.tsx:60,101-102` | В `.print-area` (то есть **на печатный лист**) попадают внутренние показатели наряда: «Стоимость» (`{cost} ₽`) и «Трудозатраты» (`{laborHours} ч`). | Карточку наряда ТО печатают для исполнителя/бригады/подрядчика. Себестоимость работ и нормо-часы уезжают вместе с нарядом к тем, кому они не адресованы. Данные не персональные, поэтому «мелочь»; вопрос уместности — продуктовый. | Если стоимость не для листа — исключить блок «Исполнение»/строки стоимости из области печати (класс-исключение в `print-screen.tsx`), либо оставить осознанно. |
| 6 | мелочь | ПРОЙДЕНО | `equipment-analytics.tsx:142,150`; `print-screen.tsx:13-14,24-37` | Кнопка «Печать» на аналитике по установкам вызывает `window.print()`, но у контейнера **нет класса `.print-area`** (`:142`). Правила печати (`print-screen.tsx`) включаются «только если `print-area` на странице есть» (`:13-14`), поэтому здесь они не работают. | На лист попадает вся администраторская оболочка (шапка, навигация, прокручиваемые контейнеры) — ровно тот дефект, который `print-screen.tsx:6-14` и был призван убрать (R134, находка 1). Это не утечка, а качество документа. | Пометить корневой контейнер `EquipmentAnalytics` классом `print-area` и подключить `PrintScreenStyles` — как в `admin-reports.tsx:347-348`. |
| 7 | мелочь | ПРОЙДЕНО | `src/app/api/reports/pdf/route.ts:230,357-378` | Ветка `GET ?jobId=&action=status|download` защищена только правом `reports.read_all` и **не привязана к владельцу/арендатору задачи** — в отличие от `single-pdf`, где есть `getPdfJobOwnerId` + `assertCanAccessReportOwner`/`assertCan` (`single-pdf/route.ts:214-221`). `jobId` — UUIDv4 (`:225`), перебором не берётся. | Право `reports.read_all` выдают ADMIN/DISPATCHER/FOREMAN/SAFETY_ENGINEER (`authorization-service.ts:64`) — все они платформенные и видят все арендаторы по решению владельца (trust model), поэтому сейчас это не дыра: любой вызывающий и так вправе видеть все отчёты. Становится значимым «ко второму арендатору», если состав роли изменится. | Для единообразия с `single-pdf` привязывать задачу к владельцу (в `enqueuePdfGeneration` уже передаётся `userId: user!.id`, `:129`). Не срочно. |

## Приложение: проверено, замечаний нет (ПРОЙДЕНО)

- **Вход печатной страницы.** `src/app/print/briefing-journal/page.tsx:14-16` прямо
  описывает: отдельной защиты у страницы нет, данные — под 401. Компонент тянет
  `/api/briefings/journal` и `/api/settings` обычным `fetch` с `credentials: 'same-origin'`
  (не `authFetch`), поэтому 401 не разлогинивает рабочую сессию
  (`briefing-journal-print.tsx:133-149`). Оба API требуют сессии
  (`briefings/journal/route.ts:29`; `settings/route.ts:17-20`).
- **Роль журнала.** `users.documents.read_all` (ADMIN/DISPATCHER/SAFETY_ENGINEER,
  `authorization-service.ts:90`) считается на маршруте и передаётся в запрос
  (`route.ts:60`); запрос отказывает 403 до обращения к БД (`briefing-journal-query.ts:94-96`).
- **Арендатор.** `requireTenantId(actor)` (`route.ts:34`); фильтр `tenantId` в запросе
  (`briefing-journal-query.ts:104`); без арендатора — 400 (`:99`). Параметры `userId`/
  `instructorId` из адреса сужают выборку внутри арендатора (`route.ts:64,67`), не
  расширяют её.
- **Ограничение объёма.** `MAX_ROWS = 1000` + флаг `truncated` наружу
  (`briefing-journal-query.ts:27,127,130`), печать показывает предупреждение
  (`briefing-journal-print.tsx:228-233`).
- **IDOR в PDF.** `single-pdf` проверяет арендатора и владельца и до генерации, и в
  ветке задачи, и «fail closed» при отсутствии записи задачи
  (`single-pdf/route.ts:92-94,214-221,263-265`). Есть негативный тест
  (`e2e/qa-ac/rbac-negative.spec.ts:82`) и маршрутные тесты.
- **`/api/settings` для шапки листа** — любой аутентифицированный пользователь читает
  настройки **своего** арендатора (`settings/route.ts:16-22`, `requireTenantId`).
- **`print.css`** задаёт только `@page size/margin` и правила таблицы; данных/утечек не
  добавляет (`src/app/print/briefing-journal/print.css:10-15`).
- **Встраивание HTML во фрейм** закрыто: nonce-CSP `frame-ancestors 'self'`
  (`src/proxy.ts:182`), в проде дополнительно `X-Frame-Options: DENY`
  (`deploy/Caddyfile.prod:32`).
- **`print-screen.tsx`** включается только при наличии `.print-area` и не влияет на
  остальные экраны (`:13-14,24-37`) — это исправление R134 №1, регресса нет.

## Не проверено

- **Живой стенд, сборка, тесты не запускались.** Задача — только чтение. Утверждения о
  HTTP-поведении (например, что `/monitoring` без сессии отдаёт оболочку HTTP 200) —
  **ГИПОТЕЗА** по коду: страница `src/app/(app)/monitoring/page.tsx` клиентская, общего
  серверного гварда у группы `(app)` нет (`src/app/(app)/layout.tsx:1,301-344` —
  `'use client'`, проверка сессии в `useEffect`).
- **Реальные HTTP-заголовки в рантайме** (`Cache-Control`, `X-Robots-Tag`) не измерял;
  вывод — по коду и по `N17-39`.
- **Фактическая индексация** `/print/briefing-journal` краулерами не наблюдалась; вывод о
  последствии — по правилам robots и `N17-45`.
- **Прод-robots и прод-сборка** не сопоставлялись с рабочей копией (нет доступа к серверу).
- **Замороженные зоны** (все варианты `/operator*`, сайт ORION) читал только на предмет
  печати/маршрутов; полноценного аудита их печатных путей не делал.
- **Внутренние PDF-генераторы** (`src/lib/pdf-generator.ts`, `pdf-data.ts`) и очередь
  (`pdf-queue.ts`) читались выборочно (только в части проверок владельца/арендатора);
  содержимое самого PDF-документа не аудировал — это область `R134`/`N17-26`.
- **Справочник должностей.** Проверил, что поля «должность» в схеме нет (`rg` по
  `position|jobTitle` → 0), но полноту модели `User` на предмет близких полей не сверял.
