# AU86-S4 — Клиентские запросы: таймауты, повторы, обработка 401 и 429

Версия (git rev-parse HEAD рабочей папки): `fa671b49b8972858923dc7dc132ac13e70ff9094`
Ветка: `hermes/q4-0926`. Только чтение, код приложения не менялся.

## Резюме для владельца

1. Таймаут запроса есть НЕ у всех экранов: у общего клиента (`src/lib/api.ts`) его нет вовсе; 15 с — только у мониторинга, 20 с/120 с — только у экранов машиниста (frozen-зона). Зависший запрос нигде, кроме этих двух мест, не завершается.
2. Повторов у чтения и мутаций нет ни одного; единственный повтор — офлайн-очередь машиниста (каждые 30 с, офлайн — 60 с), она же единственное место, где 429 считается временным.
3. 401 обрабатывается централизованно (выход + сброс сессии), но редирект на вход — не в этом коде, а асинхронно в раскладке; часть запросов идёт мимо общего клиента (`fetch` напрямую) и 401 там не разлогинивает.
4. 429 показывается по-разному на семи экранах, а общий `loadJson` про лимит частоты молчит; заголовок `Retry-After` клиент не читает нигде (кроме поля `retryAfter` у входа).
5. Самый опасный вывод — ложный «успех» формы отчёта: 200 с не-JSON телом ( captive-portal/прокси) показывается как «Отчёт успешно отправлен!», хотя сервер его не сохранил.

## Итог

- Всего находок: 24. По важности: **критично — 1**, **важно — 9**, **мелочь — 14**.
- Топ-5:
  1. (критично) Форма отчёта сообщает об успехе при 200 с не-JSON телом — `src/components/piling/report-form/use-report-form.ts:438,448-449`.
  2. (важно) У общего клиента нет таймаута — зависший `fetch` не завершается — `src/lib/api.ts:29-36,130-132`.
  3. (важно) Общий `loadJson` не распознаёт 429 и не читает `Retry-After` — лимит частоты выглядит как «Не удалось загрузить данные.» — `src/lib/api.ts:112-117`.
  4. (важно) `loadJson` вызывает `res.json()` без защиты: 200 с HTML (прокси/портал Wi-Fi) даёт SyntaxError и выдаётся за «Нет соединения с сервером.» — `src/lib/api.ts:130-134`.
  5. (важно) Один и тот же HTTP-статус читается по-разному на 7 экранах из-за собственных карт сообщений — `src/components/piling/monitoring/fleet-dashboard.tsx:70-76`, `src/components/piling/admin-equipment/use-fleet.ts:18-38`, `src/components/piling/admin-sites/use-sites-overview.ts:63-71`, `src/components/piling/admin-analytics.tsx:133-136`, `src/components/piling/to/readiness/api/client.ts:68-92`, `src/components/piling/to/to-module.tsx:206-237`, `src/components/piling/admin-equipment/detail/equipment-report-export.tsx:41-48`.
- Общий это код или свой: каркас (заголовки, 401, запись сетевых/5xx-событий в ленту) — общий, `src/lib/api.ts`. Но текст для пользователя, таймаут и повторы у каждого экрана свои: общий клиент отвечает только за транспорт и 401.

## Методика

Что искал и как (повторяемо):

- Прочитаны целиком/в части: `src/lib/api.ts`, `src/lib/client-feedback.ts`, `src/lib/store.ts`, `src/lib/api-error-message.ts`, `src/lib/media-thumbnails.ts`, `src/app/(app)/layout.tsx`, `src/components/piling/login-page.tsx`, `src/components/piling/report-form/use-report-form.ts`, `src/components/piling/report-form/photo-section.tsx`, `src/components/piling/admin-crews/use-crews-data.ts`, `src/components/piling/admin-sites/use-sites-overview.ts`, `src/components/piling/admin-equipment/use-fleet.ts`, `src/components/piling/admin-equipment/detail/equipment-report-export.tsx`, `src/components/piling/admin-analytics.tsx`, `src/components/piling/monitoring/fleet-dashboard.tsx`, `src/components/piling/to/readiness/api/client.ts`, `src/components/piling/to/to-module.tsx`, `src/components/piling/to/load-failure.tsx`, `src/components/piling/async-ui.tsx`, `src/components/piling/use-feedback-feed.ts`, `src/components/piling/ops-shell/use-entity-history.ts`, `src/components/piling/operator-mobile/offline-queue.ts`, `src/components/piling/operator-mobile/use-offline-queue.ts`, `src/components/piling/operator-mobile/api.ts` (frozen, только чтение).
- Поиск: `search_files` по `src/` шаблонами `\bfetch\(`, `timeout|AbortController|AbortSignal|signal:`, `retry|backoff|Retry`, `429|Retry-After|retryAfter`, `offline|queue`, `=== 401`, `loadJson|authFetch|authGet|authPost|authPut`.
- Перечисление и чтение размеров: `src/lib/`, `src/lib/hooks/`, список `use-*.ts(x)`.
- Тесты: искал `grep -rl "authFetch|loadJson|loadErrorMessage|LoadFailed"` по `*.test.ts(x)`; отдельного unit-теста на `src/lib/api.ts` нет (список `src/lib/__tests__/` содержит только `auth.test.ts` и прочие, но не `api.test.ts`).
- Соглашение о статусах в таблицах ниже: **ПРОЙДЕНО** = подтверждено чтением кода с указанной строкой; **ГИПОТЕЗА** = вывод о последствии, воспроизведением не подтверждён; **НЕ ПРОВЕРЕНО** = не смотрел/не запускал. Тесты и сборки я не запускал (задача — только чтение).

## Сценарий | где обработан | что видит пользователь | тест / статус

| Сценарий | Где обработан (файл:строка) | Что видит пользователь | Тест / статус |
|---|---|---|---|
| Таймаут — общий клиент | `src/lib/api.ts:29-36` (fetch без `signal`), `:130-132` | никак: запрос может висеть неограниченно | нет теста / ПРОЙДЕНО (наличие) |
| Таймаут — мониторинг | `src/components/piling/monitoring/fleet-dashboard.tsx:91` (`AbortSignal.timeout(15_000)`), `:111-119` | «Сервер не ответил за 15 секунд. Повторите попытку.» | нет теста / ПРОЙДЕНО |
| Таймаут — экраны машиниста (frozen) | `src/components/piling/operator-mobile/api.ts:284-285,322,369,510` | тот же общий текст сетевого сбоя | тесты в `src/components/piling/operator-v5/__tests__/`, `.../operator-v2/__tests__/` / НЕ ПРОВЕРЕНО (не запускал) |
| Таймаут — остальные экраны | отсутствует: `src/components/piling/to/readiness/api/client.ts:159-166`, `src/components/piling/to/to-module.tsx:211` | ничего: экран остаётся в состоянии загрузки | нет теста / ПРОЙДЕНО (по коду) |
| Повторы — общий клиент | отсутствуют (`src/lib/api.ts:29-134`) | ручная кнопка «Повторить» (`src/components/piling/async-ui.tsx:69-81`, `src/components/piling/to/load-failure.tsx:39-47`) | нет теста / ПРОЙДЕНО |
| Повторы — очередь машиниста (frozen) | `src/components/piling/operator-mobile/use-offline-queue.ts:8-9,55-62`; слив `src/components/piling/operator-mobile/offline-queue.ts:435-474` | баннер очереди + автоповтор | `.../operator-mobile/offline-queue-banner.test.tsx` / НЕ ПРОВЕРЕНО (не запускал) |
| 401 — общий клиент | `src/lib/api.ts:57-70` (logout + `store.logout`), редирект `src/app/(app)/layout.tsx:349-353` | уход на /login | нет теста на `api.ts` / ПРОЙДЕНО |
| 401 — readiness | `src/components/piling/to/readiness/api/client.ts:69-71` | «Сессия завершена. Войдите повторно.» | `src/components/piling/to/readiness/api/__tests__/client.test.ts` / НЕ ПРОВЕРЕНО |
| 401 — прочие экраны | `src/components/piling/monitoring/fleet-dashboard.tsx:74`; `src/components/piling/admin-equipment/use-fleet.ts:22-24`; `src/components/piling/admin-analytics.tsx:134,158,181` | «Сессия истекла — войдите снова.» (свой текст у каждого) | нет теста / ПРОЙДЕНО |
| 429 — вход | `src/components/piling/login-page.tsx:56-61` | «Слишком много попыток входа. Повторите через N мин.» | `src/components/piling/__tests__/login-page.test.tsx:171-176` / НЕ ПРОВЕРЕНО (не запускал) |
| 429 — прочие экраны | `src/components/piling/to/readiness/api/client.ts:75-77`; `src/components/piling/monitoring/fleet-dashboard.tsx:71`; `src/components/piling/to/to-module.tsx:219-220,474-475`; `src/components/piling/admin-equipment/detail/equipment-report-export.tsx:44` | у каждого свой текст | нет теста / ПРОЙДЕНО |
| 429 — общий `loadJson` | `src/lib/api.ts:112-117` | «Не удалось загрузить данные.» (про лимит не сказано) | нет теста / ПРОЙДЕНО |
| 429 — очередь машиниста (frozen) | `src/components/piling/operator-mobile/offline-queue.ts:142` (`temporary`) | запись остаётся в очереди | `src/components/piling/operator-mobile/offline-queue-banner.test.tsx` / НЕ ПРОВЕРЕНО |
| 5xx — общий клиент | `src/lib/api.ts:72-88` (событие в ленту), `:115` | «Сервер временно недоступен.» / карточка в ленте | нет теста / ПРОЙДЕНО |
| Обрыв сети — общий клиент | `src/lib/api.ts:37-55` (событие CRITICAL + throw), `:120-123` | «Нет соединения с сервером.» | нет теста / ПРОЙДЕНО |
| Обрыв сети — вход | `src/components/piling/login-page.tsx:44-48` | «Нет связи с сервером. Проверьте интернет и повторите.» | `.../login-page.test.tsx` / НЕ ПРОВЕРЕНО |
| Обрыв сети — to-модуль | `src/components/piling/to/to-module.tsx:226-236,471-480` (через `navigator.onLine`) | «Нет подключения к сети.» / «Не удалось получить ответ от сервера.» | нет теста / ПРОЙДЕНО |
| Обрыв сети — readiness | `src/components/piling/to/readiness/api/client.ts:106-118` (`navigator.onLine`) | «Нет подключения к сети.» | `.../client.test.ts` / НЕ ПРОВЕРЕНО |

## Находки

| # | важность | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | критично | `src/components/piling/report-form/use-report-form.ts:438,448-449` | `const result = await res.json().catch(() => null)`; при `res.ok` (200) с не-JSON телом `result = null`, проверки формы тела нет, затем безусловно `toast.success('Отчёт успешно отправлен!')` | captive-portal/прокси отдаёт на перехваченный POST свою HTML-страницу со статусом 200 — отчёт НЕ сохранён, а человек читает «успешно отправлен» и уходит; сервер записи не получил (по коду; воспроизведением не подтверждал) | показывать успех только если тело — валидный JSON с ожидаемым полем (как отсечение чужого ответа в `operator-mobile/api.ts:242-267`); иначе «Ответ пришёл не от сервера приложения» |
| 2 | важно | `src/lib/api.ts:29-36,130-132` | `authFetch`/`loadJson` не задают `signal`/таймаут | «повисшее» соединение на мобильной сети не завершает `fetch`: экран и кнопки остаются в загрузке, повтор/очередь не запускаются, пока промис не завершится (по коду) | добавить `AbortSignal.timeout(...)` в общий клиент (20 с как у машиниста), истёкший таймаут трактовать как сетевой сбой |
| 3 | важно | `src/lib/api.ts:112-117` | `loadFailureMessage` не различает 429; заголовок `Retry-After` клиент не читает нигде, кроме поля `retryAfter` у входа (`login-page.tsx:56`) | при лимите частоты человек видит «Не удалось загрузить данные.» и жмёт «Повторить» снова, продлевая окно лимита | добавить ветку 429 («Слишком много запросов, повторите через N с») и по возможности паузу по `Retry-After` |
| 4 | важно | `src/lib/api.ts:130-134` | `await res.json()` без try: 200 с HTML/обрезанным телом (прокси, портал Wi-Fi, шлюз) бросает SyntaxError | исключение попадает в общий `catch` экранов и выдаётся за «Нет соединения с сервером.» — причина неверна, человека шлют чинить интернет вместо повтора; тот же класс закрыт в `fleet-dashboard.tsx:97-107` и `operator-mobile/api.ts:255-265` | обернуть разбор тела, отделять «ответ не от нашего сервера» от обрыва связи |
| 5 | важно | `src/lib/api.ts:29-134` | нет ни одного автоматического повтора чтения/мутаций; 5xx и сетевой сбой сразу превращаются в исключение | мигание сети/500 требует ручного нажатия; для чтения списков это лишний шаг, для мутаций — риск двойной отправки при повторном нажатии | рассмотреть один-два повтора с паузой для GET (идемпотентны), не повторять POST/PUT молча |
| 6 | важно | `src/lib/api.ts:57-70`; `src/app/(app)/layout.tsx:349-353` | 401: централизованно сбрасывает сессию, но сам не редиректит — уход на /login висит на эффекте раскладки | между сбросом и редиректом экран может мигнуть «сессия истекла»; при этом запросы, идущие мимо `authFetch`, 401 вообще не разлогинивают: `src/lib/client-feedback.ts:33` (POST /api/feedback/events), `src/components/piling/use-feedback-feed.ts:85` (GET /api/ready), `src/components/piling/login-page.tsx:39` | перевести прямые `fetch` служебных запросов на `authFetch` либо явно обрабатывать 401; редирект держать в одном месте |
| 7 | важно | `src/lib/api.ts:112-117` против `src/components/piling/monitoring/fleet-dashboard.tsx:70-76`; `src/components/piling/admin-equipment/use-fleet.ts:18-38`; `src/components/piling/admin-sites/use-sites-overview.ts:63-71`; `src/components/piling/admin-analytics.tsx:133-136`; `src/components/piling/to/readiness/api/client.ts:68-92` | один и тот же статус читается по-разному: у общего клиента 403→«Нет доступа…», 5xx→«Сервер временно недоступен»; у экранов свои формулировки и свои наборы | диспетчер/механик на разных экранах видит разные объяснения одной ошибки, часть — без различия 401/429/5xx/сети (`use-fleet.ts:26` отдаёт «Сервер вернул {status}») | свести карту «статус → русский текст» в один модуль и переиспользовать на всех экранах |
| 8 | важно | `src/components/piling/to/readiness/api/client.ts:94-166`; `src/components/piling/to/to-module.tsx:211` | у модуля технической готовности и to-модуля нет таймаута запроса | зависший бутстрап оставит экран «загрузка технической готовности» навсегда | применить общий таймаут из находки №2 |
| 9 | важно | `src/components/piling/report-form/use-report-form.ts:220-223` | `loadData` сводит 401/403/429/5xx к одному `setLoadError(true)` и тосту «Не удалось загрузить данные формы» | при 401 `authFetch` уже разлогинил: человек получает уведомление на уходящем экране, причина не названа; при 403 то же — а 403 говорит о правах | различать статусы хотя бы на 401/403/429/5xx |
| 10 | важно | `src/components/piling/admin-analytics.tsx:107-115` | загрузка парка: `if (!res.ok)` даёт один текст «Показатели парка временно недоступны.» без статуса | 401/429/5xx/сеть различить нельзя, при 429 жмут снова | различать статусы (см. №7) |
| 11 | мелочь | `src/lib/api.ts:126-128` | `isAbort` распознаёт только `AbortError` | `DOMException` с именем `TimeoutError` (от `AbortSignal.timeout`) не считается отменой: если такой сигнал где-то появится, экран покажет сбой вместо тихого выхода | учитывать `TimeoutError` наравне с `AbortError` там, где отмена не должна показываться |
| 12 | мелочь | `src/lib/api.ts:176-193`; `src/app/(app)/layout.tsx:305-343` | `probeSession` без таймаута; `bootstrapping` снимается только в `finally` после завершения промиса | зависший `/api/auth/me` оставит «Проверка сессии...» навсегда (проверка сессии не distinguishes «долго» от «висит») | таймаут на probeSession, по истечении — `{ status: 'unknown' }` |
| 13 | мелочь | `src/components/piling/login-page.tsx:37-49,64,68` | вход идёт через `fetch` без `AbortController`; при 200 с не-JSON телом `await res.json()` (стр. 64) бросает английский SyntaxError, который показывается как есть (стр. 68) | зависший вход оставляет кнопку «Войти» в спиннере бесконечно; пользователь читает английский текст парсера | таймаут + разбор тела с дружелюбным русским текстом |
| 14 | мелочь | `src/components/piling/login-page.tsx:56-61` | разбор `retryAfter` из тела есть только у входа | на остальных экранах при 429 человек не знает, сколько ждать (см. №3) | вынести разбор лимита в общий слой |
| 15 | мелочь | `src/lib/media-thumbnails.ts:63-74` | `flush` глотает любую причину: 401/403/429/5xx и обрыв одинаково дают `null` | миниатюры молча отсутствуют, причина не видна даже в ленте | различать статус для служебного лога обратной связи, не меняя поведение «показать запасной вид» |
| 16 | мелочь | `src/components/piling/ops-shell/use-entity-history.ts:30-37` | ошибка сводится к `error: true` без текста и без различения статуса | при 403/429 пользователь видит общее «не удалось» и не понимает причину | отдавать текст по статусу (см. №7) |
| 17 | мелочь | `src/components/piling/use-feedback-feed.ts:88-102` | лента: `!eventsRes.ok` не показывается и не логируется (тихий пропуск); `/api/ready` идёт через `raw fetch` (стр. 85) | при 401/429/5xx карточки в шапке просто не обновляются; 401 от `/api/ready` не разлогинивает | перейти на `authFetch` и фиксировать неуспех в ленте |
| 18 | мелочь | `src/components/piling/to/to-module.tsx:231-233` | в `catch` прямое обращение к `navigator.onLine` без `typeof navigator !== 'undefined'` | в не-браузерном контексте/юнит-тесте обращение к `navigator` может бросить | проверять наличие `navigator`, как в `readiness/client.ts:112` |
| 19 | мелочь | `src/components/piling/report-form/photo-section.tsx:89-110` | PUT в хранилище (стр. 105) — raw `fetch` без authorization (правильно, presigned), но ошибка `!put.ok` (стр. 106) не различает истёкшую подпись/403/сеть | все причины выглядят как «Не удалось загрузить фото. Проверьте связь и повторите.» — людей с истёкшей подписью гонят проверять связь; тот же класс в `equipment-photos.tsx:109`, `work-order-photos.tsx:121`, `inspection-item-photos.tsx:127`, `monitoring/equipment-photo-upload.ts:27` | различать статус загрузки (обновить presign при 403) и сеть |
| 20 | мелочь | `src/lib/client-feedback.ts:29-51` | POST событий — best-effort без повтора и без обработки 401/5xx; `usePilingStore` уже хранит событие локально | при обрыве событие остаётся только в браузере и на сервер не попадёт (до 30 последних) | при желании — повтор через офлайн-подходу, иначе явно принять как потерю телеметрии |
| 21 | мелочь | `src/components/piling/operator-mobile/use-offline-queue.ts:8-9,55-62` (frozen) | повтор очереди фиксированным интервалом 30 с (офлайн — 60 с), без экспоненциальной паузы и без учёта `Retry-After` | длинный хвост после суток без связи бьёт в 429 (классифицируется как временный, `offline-queue.ts:142`, — верно), но паузу не растягивает | не трогать (frozen), но при переносе логики в общий слой учесть backoff |
| 22 | мелочь | `src/components/piling/monitoring/fleet-dashboard.tsx:91` | используется `AbortSignal.timeout` | по сведениям из `operator-mobile/api.ts:310-315` проект целится в Safari 16.4/Chrome 111 и полифилла нет; на более старых iOS вызов может бросить TypeError и любой запрос мониторинга упадёт всегда | при подтверждённой поддержке целевых браузеров — оставить; иначе собирать сигнал вручную, как в `operator-mobile/api.ts:322` (ГИПОТЕЗА) |
| 23 | мелочь | `src/components/piling/async-ui.tsx:57-84`; `src/components/piling/to/load-failure.tsx:28-49` | у двух баннеров ошибки разное поведение: `QueryErrorBanner` умеет `retrying`/заголовок, `LoadFailure` — нет; `LoadFailure` сам переводит `TypeError` в «Нет связи» | один и тот же сбой на разных экранах выглядит по-разному (наличие/отсутствие кнопки «Повторить», блокировки) | свести отображение ошибки загрузки к одному компоненту |
| 24 | мелочь | `e2e/rate-limit-e2e.spec.ts:8-20` | e2e проверяет только серверный 429 на входе (статус ответа), но не клиентское поведение при 429/обрыве/таймауте | клиентская обработка 429/таймаута/401 не покрыта e2e — регрессии по этой задаче не поймаются | добавить e2e/unit на: 429 → текст и отсутствие автоповтора; обрыв → «Нет соединения»; таймаут → завершение запроса |

## Экраны с собственной обработкой, расходящейся с общей

Единый «каркас» (заголовки + 401 + запись сетевых/5xx-событий) живёт в `src/lib/api.ts:29-91`. Всё остальное — текст для пользователя, таймаут, повторы, разбор тела — каждый экран делает сам. Своя обработка:

- Мониторинг парка — `src/components/piling/monitoring/fleet-dashboard.tsx:70-76` (карта статусов c 429/500/403/401), `:91` (таймаут 15 с), `:97-107` (защита разбора тела), `:111-120` (TimeoutError vs сеть).
- Парк для админ-экрана — `src/components/piling/admin-equipment/use-fleet.ts:18-38` (свой 401-текст, остальное «Сервер вернул {status}»).
- Аналитика — `src/components/piling/admin-analytics.tsx:127-189` (401-текст, остальное «Не удалось загрузить…», сеть «Сеть недоступна…»).
- Обзор объектов — `src/components/piling/admin-sites/use-sites-overview.ts:51-71` (класс `OverviewError`, отдельный текст для 403).
- Модуль техготовности — `src/components/piling/to/readiness/api/client.ts:68-92` (своя карта 401/403/429/5xx и «серверных» контрактов), `:94-157` (свой разбор бутстрапа).
- To-модуль — `src/components/piling/to/to-module.tsx:206-237` (свой `readOptionalJsonWithIssue` с 403/429/сетью), `:239-252` (`readAuthoritativeCollection`), `:471-480` (свой текст по статусу установок).
- Выгрузка PDF — `src/components/piling/admin-equipment/detail/equipment-report-export.tsx:41-48` (свои тексты 401/403/429/5xx), `:129-134` (TypeError → «Нет связи»).
- Вход — `src/components/piling/login-page.tsx:37-49,52-61` (своя обработка сети и 429 c `retryAfter`).
- История сущности — `src/components/piling/ops-shell/use-entity-history.ts:30-37` (ошибка = boolean без текста).
- Миниатюры — `src/lib/media-thumbnails.ts:63-74` (любая причина → `null`).
- Экраны машиниста (frozen, только чтение) — `src/components/piling/operator-mobile/api.ts:242-267,284-285,322,369,510` (разбор чужого ответа, таймауты 20 с/120 с, классификация) и очередь `src/components/piling/operator-mobile/offline-queue.ts:139-144,435-474`, `.../use-offline-queue.ts:8-9,55-62`. Это единственная полная реализация таймаутов и повторов — эталон, к которому стоит привести общий клиент (файлы не менять без команды владельца).

## Не проверено

- Ни один тест/сборка не запускались: задача только на чтение, приложение не менялось. Все статусы «ПРОЙДЕНО» означают «подтверждено чтением кода с указанной строкой», не «проверено выполнением».
- Ложный «успех» формы отчёта (находка №1) выведен из кода, воспроизведением с реальным captive-portal/прокси не подтверждён — статус ГИПОТЕЗА.
- Не проверял поведение `probeSession`/`authFetch` при 401 на живом стенде (в т.ч. реальный мигающий редирект между сбросом сессии и `router.replace('/login')` в `src/app/(app)/layout.tsx:349-353`).
- Не проверял поддержку `AbortSignal.timeout` в целевых браузерах проекта (находка №22) — оценка взята из комментария `src/components/piling/operator-mobile/api.ts:310-315`, не из практического прогона.
- Существующие отчёты в `docs/audits/` (кроме этого файла), `CODEX-REPORT*` и `docs/strategy` не читал по условию задачи — совпадения с прежними находками не сверял.
- Frozen-зоны (варианты операторского экрана, сайт ORION) читал выборочно (`operator-mobile/api.ts`, `offline-queue.ts`, `use-offline-queue.ts`) и только для контекста; логику v7/v10/v5/v2 по экранам не разбирал.
- Не проверял серверную сторону 401/429/5xx за пределами клиента (обёртки `withApi`/`withMutation`, `src/core/api-wrapper.ts`) — вне рамок этой задачи.
- Не проверялись `src/services/weather/weather-client.ts:87-90` и `src/core/notifications/telegram.ts:275` — это серверный код, не клиентские запросы браузера.
