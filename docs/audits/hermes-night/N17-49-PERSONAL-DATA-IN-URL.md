# N17-49-PERSONAL-DATA-IN-URL: Персональные данные в адресах страниц

Версия рабочей папки: `git rev-parse HEAD` = `13991dc6baadd44eeacd079c6d18fc17b3aad8e4`
(ветка `hermes/code-1011`, рабочая папка `D:\PillingR\wt-night-code`). Только чтение:
код приложения не менялся, создан только этот отчёт. Замороженные зоны (экраны
оператора, сайт ORION) читались, но не правились.

## Итог

Счёт по важности: **критично 0, важно 6, мелочь 16** (всего 22 пункта; ещё 13
мест-получателей параметра сведены в приложение без разбора строки — они того же
класса, что мелочи).

Топ-5:
1. **Свободный поиск уходит в адрес страницы.** `admin-users`: строка поиска
   пишется в `?q=` (`admin-users.tsx:106,116`), а ищет она по ФИО, e-mail и
   телефону (`user-list-model.ts:88-95`). Попадает в историю браузера, в
   same-origin Referer, в лог Caddy при перезагрузке и в Sentry.
2. **То же с фильтром «Кто изменил».** `to-module.tsx:806` пишет `?actor=<имя>`
   в адрес, поле подписано «Имя или должность» (`shared.tsx:190`), и это же
   значение уезжает в API-адрес (`client.ts:39,46`).
3. **GPS-координаты телефона оператора в query.** `/api/weather?lat=&lon=`
   (`operator-v2/weather-card.tsx:70,109-110`) и `/api/operator/mobile/state?`
   (`operator-mobile/api.ts:363-365`) — координаты идут в лог прокси и в Sentry.
   Файлы в замороженной зоне — правка за владельцем.
4. **Sentry не фильтрует эти имена.** `sentry-data-collection.ts:15` — deny-список
   только `forwarded/-ip/remote-/via/-user/token/password`; `userId`, `q`,
   `actor`, `lat`, `lon`, `filterUserId` уходят в Sentry (DE) как есть.
5. **Caddy логирует полный URI с query.** `deploy/Caddyfile.prod:65` (`log`) →
   journald; подтверждено ранее в `R69-alerts-delivery.md:121`. Query с
   идентификаторами людей и координатами виден всем, у кого есть `journalctl`.

Резюме для владельца (5 строк):
1. Критичных утечек нет: ФИО как заголовок страницы, телефон или e-mail в пути
   адреса не встречаются. В адрес попадают в основном идентификаторы (`userId`,
   `operatorId`, `targetId`) и координаты.
2. Реальные ПДн в адресе — это свободный текст поиска (`?q=` на экране
   «Пользователи») и фильтр аудита `?actor=`; и то, и другое может быть ФИО.
3. Эти же адреса уходят в Sentry (Германия): deny-список фильтрует имена
   параметров, а не их содержимое, и наших имён там нет.
4. Лог Caddy содержит полный query — любой `userId` из адреса виден в journald.
5. Быстрые меры: не писать поисковый текст и `actor` в адрес; дополнить deny в
   `sentry-data-collection.ts`; не класть GPS в query погоды.

## Методика

Что искал и чем (только чтение):
- `rg -n 'searchParams|router\.push|router\.replace|href=|useSearchParams|URLSearchParams' src --glob '!**/*.test.*'` — 256 совпадений; отобраны места, где в адрес попадает значение.
- Точечные поиски: `searchParams.set(`, `params.set(`, `userId=`, `operatorId`, `actor`, `lat=`/`lon=`, `location.href`, `get\('userId'\)`, `token=|name=|phone=|email=`.
- Прочитаны целиком/по диапазонам: `src/components/piling/admin-users/admin-users.tsx`, `admin-users/user-list-model.ts`, `to/to-module.tsx:330-389,740-829`, `to/readiness/screens/shared.tsx:125-198`, `to/readiness/settings/audit-section.tsx:36-105`, `to/readiness/api/client.ts:32-49`, `to/readiness/screens/documents-screen.tsx:46-90`, `to/readiness/screens/safety-screen.tsx:100-179`, `to/readiness/screens/equipment-permit-matrix.tsx:55-104`, `components/piling/operator-v2/weather-card.tsx:60-120`, `components/piling/operator-mobile/api.ts:350-380`, `admin-reports/admin-reports.tsx:138-167`, `admin-reports/use-reports-data.ts:232-286`, `report-history.tsx:50-115,165-175`, `report-form/use-report-form.ts:170-215`, `admin-sites/user-assignment.tsx:80-95`, `admin-users/user-documents.tsx:115-205`, `admin-equipment/detail/equipment-report-export.tsx:70-129`, `app/api/weather/route.ts:20-64`, `app/api/readiness/bootstrap/route.ts:25-64`.
- Куда уходит адрес — по инфраструктуре: `deploy/Caddyfile.prod` (полностью), `Caddyfile`, `src/proxy.ts` (полностью), `sentry.server.config.ts`, `src/instrumentation-client.ts`, `src/lib/sentry-data-collection.ts`, `src/core/api-wrapper.ts`.
- Опора на ранее подтверждённое в проекте (не перепроверял заново, но цитирую как источник): `docs/audits/hermes-night/R69-alerts-delivery.md:121` (Caddy логирует полный URI с query), `docs/audits/hermes-night/AU95-S7-SENTRY-DATA.md:13-15,75` (Sentry отправляет query-параметры по deny-списку имён; включён в проде, регион DE), `docs/audits/hermes-night/R74-operator-versions-map.md:161-163` (v3 — единственная версия с параметром пользователя в адресе).

Статусы: ПРОЙДЕНО — прочитано в коде; ГИПОТЕЗА — вывод из документации/соседнего кода, не наблюдалось на живом стенде.

Что считается «ПРОЙДЕНО» и находкой не является:
- Метрики HTTP не содержат URL: `src/core/api-wrapper.ts:144` пишет `domain`, а не адрес (в комментарии `:137-143` это прямо оговорено). ПРОЙДЕНО.
- В `withApi` query-параметры идут только в **ключ кеша в памяти** (`src/core/api-wrapper.ts:98`), а не в лог. ПРОЙДЕНО.
- Тег Sentry для серверных 500 — `pathname` без query (`src/core/api-wrapper.ts:129`). ПРОЙДЕНО.
- Referrer-Policy `strict-origin-when-cross-origin` (`deploy/Caddyfile.prod:33`, `src/proxy.ts:68`): при уходе на чужой сайт Referer содержит только origin, без пути и query. То есть наружу по Referer ПДн из адреса не утекают; внутри сайта (same-origin) Referer полный. ПРОЙДЕНО.
- `?from=` на `/no-access` (`src/app/(app)/no-access/page.tsx:24,29`) — путь раздела, не человек. ПРОЙДЕНО.
- `?token=` у `/api/alerts/webhook` — уже известная находка `R69-alerts-delivery.md:121`, не дублирую; это server-to-server, не браузерный адрес.

## Находки

| # | severity | path:line | problem | scenario / why it matters | suggested fix |
|---|---|---|---|---|---|
| 1 | важно | `src/components/piling/admin-users/admin-users.tsx:106,114-121` | Строка поиска пишется в адрес как `?q=`, выбранный сотрудник — как `?userId=` (`readUrlState`/`writeUrlState`); запись идёт через `history.replaceState` | Поиск ищет по ФИО, e-mail и телефону (`user-list-model.ts:88-95`), значит в `q` может лежать ФИО/почта/номер. Адрес попадает в историю браузера, в same-origin Referer, в лог Caddy при перезагрузке/переходе и в Sentry (см. №5). Диспетчер искал «Иванов» — поисковый текст остался в адресе и уехал наружу | Не хранить текст поиска в адресе (локальное состояние); в адресе оставить только `filter` (и, при необходимости, `userId`). См. комментарий `:89-95` — достаточно пересмотреть его |
| 2 | важно | `src/components/piling/to/to-module.tsx:806-811` | Фильтр аудита `actor` пишется в адрес (`replaceUrlState`), значение — свободный текст | Поле подписано «Кто изменил», placeholder «Имя или должность» (`to/readiness/screens/shared.tsx:190`) — в адрес попадает имя человека. Тот же набор фильтров уходит и в API: `readinessFilterQuery` (`to/readiness/api/client.ts:43-48`) собирает `?actor=` из `ReadinessUrlFilters.actor` (`:39`) | Держать `actor` в состоянии компонента, не писать в адрес; на сервер отправлять идентификатор пользователя, а не введённую строку |
| 3 | важно | `src/components/piling/operator-v2/weather-card.tsx:70,109-110` (замороженная зона) | `/api/weather?lat=${lat}&lon=${lon}`: координаты, полученные `navigator.geolocation`, уходят в query | Координаты телефона — «иной признак человека». Уходят в лог Caddy (journald) и в Sentry (имена `lat`/`lon` не в deny). Серверный маршрут `src/app/api/weather/route.ts:45-53` их принимает | Отправлять координаты телом POST или брать их на сервере по `siteId`; как минимум — добавить `lat/lon` в deny Sentry. Правку в замороженном `operator-v2/**` предлагает владелец |
| 4 | важно | `src/components/piling/operator-mobile/api.ts:363-365` (замороженная зона) | `fetchState` кладёт координаты в `/api/operator/mobile/state?lat=&lon=` | То же, что №3: GPS оператора в адресе запроса → лог прокси + Sentry | Координаты — телом, либо считать на сервере; правка за владельцем (замороженная зона) |
| 5 | важно | `src/lib/sentry-data-collection.ts:15` | `urlQueryParams.deny` фильтрует только имена `forwarded/-ip/remote-/via/-user/token/password`; ключи `userId, q, actor, lat, lon, operatorId, filterUserId, siteId` не перечислены | Deny-список — не белый список: всё, чего в нём нет, уходит в Sentry. Это значит, что поисковый текст (`q`), имя из фильтра аудита (`actor`) и GPS (`lat/lon`) уезжают в внешний сервис в Германии (`sentry.server.config.ts:9`), вопреки цели «152-ФЗ scope» (`:17-18`). Прод: `sentry.server.config.ts:12`, клиент: `src/instrumentation-client.ts:10,25` | Дополнить `deny` (`userid`,`q`,`actor`,`lat`,`lon`,`operatorid`,`filteruserid`) или перейти на allow-list; проверить на живом событии |
| 6 | важно | `deploy/Caddyfile.prod:65` | `log` без настройки формата/фильтра: Caddy пишет полный `request.uri` вместе с query | Любой адрес с `?userId=`, `?q=`, `?actor=`, `?lat=&lon=` попадает в journald (`deploy/Caddyfile.prod:61-65` — файловой ротации нет). Идентификаторы людей и координаты видит каждый, у кого есть `journalctl` (подтверждено ранее: `R69-alerts-delivery.md:121`) | Усечь query в access-логе (`request>uri` без query), либо не класть ПДн в query. ГИПОТЕЗА про поведение прод-логгера на сервере — не проверял |
| 7 | мелочь | `src/components/piling/to/readiness/screens/documents-screen.tsx:73-77` | Открытие карточки работника пишет `?userId=<id>` в адрес через `replaceState` | Идентификатор человека в адресе → история, same-origin Referer, лог Caddy, Sentry. Кнопка ведёт на карточку внутри вкладки: адрес для этого не нужен | Хранить выбранного работника в состоянии вкладки (как `safety-screen` после закрытия карточки уже чистит параметр, `:126-133`) |
| 8 | мелочь | `src/components/piling/to/readiness/screens/safety-screen.tsx:118-133` | Экран читает `?userId=` из адреса (deep-link от «Документов») и удаляет его только при закрытии карточки | Пока карточка открыта, id человека в адресе; после «Назад» параметр убирается. Тот же риск, что №7 | Тот же deep-link передавать без адреса (через состояние модуля) |
| 9 | мелочь | `src/components/piling/admin-users/user-documents.tsx:122,174,203`; `src/components/piling/operator-document-reminder.tsx:37` | Персональный id — в **пути** запроса: `/api/users/{id}/documents` и `/api/users/{id}/documents/{docId}` | Идентификатор работника уходит в лог прокси (путь в `request.uri`). Правило проекта — ПДн не в адресе, включая путь | Ничего не менять в REST-форме (это обычный ресурсный URI), но признать, что id человека всё равно оказывается в логе; при требовании — вынести id в заголовок/тело или принять риск точечно |
| 10 | мелочь | `src/app/api/reports/export/route.ts:31`; `src/components/piling/admin-reports/admin-reports.tsx:143-150` | Выгрузка отчётов идёт GET-адресом `/api/reports/export?...&userId=<id>` | Идентификатор работника (может быть чужой — админ/диспетчер фильтрует «по оператору») в адресе запроса → лог + Sentry | Оставить (GET-выгрузка), но помнить: id в логе. При желании — POST-выгрузка |
| 11 | мелочь | `src/app/api/reports/pdf/route.ts:52,119`; `src/components/piling/admin-equipment/detail/equipment-report-export.tsx:82` | PDF-период собирает `userId` (фильтр по работнику) в query | То же, что №10: id человека в адресе запроса. Ветка `equipment-report-export` подставляет только свои `dateFrom/dateTo/equipmentId`, но серверный параметр `userId` тем же эндпоинтом используется | Без изменений, если не считать id ПДн в логе (см. матрицу) |
| 12 | мелочь | `src/components/piling/report-history.tsx:55-56,91,113,173` | `/api/reports/my?userId=<id>`, `/api/sites?userId=<id>`, `/api/reports/edit?userId=<id>&siteId=&date=` | Идентификатор (свой или чужой при просмотре админом) в адресе GET-запросов → лог + Sentry. `R74:161-163` уже отмечал `userId` в адресе у операторских версий | Эти вызовы можно оставить: риск — только id в логе; при желании убрать `userId` там, где сессия уже его знает |
| 13 | мелочь | `src/app/api/reports/all/route.ts:21`; `src/app/api/reports/period/route.ts:40`; `src/components/piling/admin-reports/use-reports-data.ts:239,244,327-328` | Списки/сводки `/api/reports/all|period?siteId=&userId=` | Фильтр «по оператору» кладёт id работника в адрес запроса (лог + Sentry) | То же |
| 14 | мелочь | `src/components/piling/to/readiness/screens/equipment-permit-matrix.tsx:72` | `/api/safety/equipment-permits?userId=<id>` — id работника, чью карточку открыл админ | Идентификатор человека в адресе запроса; запрос уходит из карточки сотрудника (`employee-card.tsx:234` передаёт `row.userId`) | Оставить, но id в логе — осознанный риск; при требовании — заголовок/тело |
| 15 | мелочь | `src/components/piling/admin-sites/user-assignment.tsx:88` | `DELETE /api/sites/${siteId}/assign?userId=<id>` — назначение/снятие объекта у работника | id человека в query (мутация). Плюс ранее отмечено `AU55:18`: параметр не валидируется | То же; при желании — id в теле или пути |
| 16 | мелочь | `src/app/api/audit/route.ts:19-20`; `src/components/piling/ops-shell/use-entity-history.ts:31` | `GET /api/audit?scope=&targetId=<id>` — история изменения сущности | `targetId` — обычно id техники/справочника, но если сущность = пользователь, это id человека в адресе | Оставить; при `scope=user` считать id ПДн в логе |
| 17 | мелочь | `src/app/api/auth/me/route.ts:25` | `GET /api/auth/me?userId=<id>` — чтение профиля другого работника админом (тест: `auth/me/__tests__/route.test.ts:101,119`) | id человека в адресе запроса → лог + Sentry; в клиенте вызова с `?userId=` не нашёл | Оставить; отмечено как источник id в URL |
| 18 | мелочь | `src/app/api/briefings/journal/route.ts:64` | `GET /api/briefings/journal?userId=<id>` — фильтр журнала инструктажей по работнику | id человека в адресе запроса. Клиентские вызовы в `to/readiness/screens/*` передают `from/to/kind`, но параметр поддержан сервером | Оставить; в клиенте не передавать `userId`, если не нужен |
| 19 | мелочь | `src/app/api/crews/my/route.ts:18` | `GET /api/crews/my?operatorId=<id>` — бригады конкретного машиниста | id человека в адресе запроса → лог + Sentry | То же |
| 20 | мелочь | `src/components/piling/to/to-module.tsx:805-811` | `changeReadinessFilters` пишет в адрес весь набор `status/from/to/shiftType/risk/eventType/actor`; `from/to/shiftType/risk/eventType` — не ПДн | Набор смешан: четыре безобидных фильтра и один (`actor`, №2) персональный. «Заодно» уходит и всё остальное в лог при перезагрузке | Разделять: в адрес — только необязательные фильтры, `actor` — в состояние |
| 21 | мелочь | `src/components/piling/pile-journal/index.tsx:103-109` | `journalParams` пишет `pileNumber` (свободный текст) в адрес | Это номер сваи, не человек; но поле свободное, и станет ПДн, если в него впишут что-то ещё. Считаю безопасным | Оставить; при желании ограничить формат ввода |
| 22 | мелочь | `src/components/piling/to/readiness/screens/fleet-workspace-model.ts:35,43-54` | `fleetQuery` (свободный текст поиска по парку) пишется в адрес | Ищет по установкам/объектам (`buildFleetItems`), не по людям; ПДн не ожидается | Оставить |

### Приложение: получатели параметра того же класса (только путь:строка)

Серверные маршруты, читающие id человека из query (тот же риск — id в логе):
`src/app/api/sites/route.ts:19`; `src/app/api/reports/my/route.ts:18`; `src/app/api/reports/edit/route.ts:18-20`; `src/app/api/reports/pdf/route.ts:285`; `src/app/api/safety/equipment-permits/route.ts:39`; `src/app/api/readiness/audit/route.ts:21`; `src/app/api/readiness/export/route.ts:39`; `src/app/api/sites/[id]/assign/route.ts:46`; `src/app/api/admin/analytics/overview/route.ts` (без userId).

Клиентские вызовы с собственным `userId` в адресе (операторский контур, замороженная
зона, риск = id в логе): `src/components/piling/operator-dashboard.tsx:83-84`;
`src/components/piling/operator-v3/operator-dashboard-v3.tsx:47-48`;
`src/components/piling/report-form/use-report-form.ts:175,212`.

## Не проверено

- **Живой стенд и сеть.** Фактический формат access-лога Caddy на сервере и реальный
  набор полей события Sentry по сети не наблюдал (нет доступа, прод запрещён).
  Вывод по логу — из `deploy/Caddyfile.prod:65` и подтверждения `R69-alerts-delivery.md:121`;
  по Sentry — из конфигурации и `AU95-S7-SENTRY-DATA.md:13-15,75`. Факт утечки
  конкретного `q`/`lat` в Sentry — ГИПОТЕЗА (по коду deny-списка), не перехваченный трафик.
- **Логирует ли Next.js сам URI в проде.** Не проверял: `src/proxy.ts` URL не пишет
  (прочитан целиком), отдельного логирования запросов в `src/` не нашёл, но
  поведение `next start` на стенде не наблюдал.
- **Браузерное поведение.** Что именно остаётся в истории браузера после
  `history.replaceState` (не добавляет ли запись, не переживает ли перезагрузку) —
  по коду ясно, что адрес меняется; практического прогона не делал.
- **Referrer на same-origin.** Политика `strict-origin-when-cross-origin` читается
  из заголовков; реальную отправку Referer внутри сайта (с полным query) не
  воспроизводил.
- **Полнота охвата.** Компоненты в замороженных зонах (все варианты экрана
  оператора, ORION) читал выборочно — по местам со `searchParams`/`URLSearchParams`;
  сплошной пересмотр их адресов не делал. `src/app/orion/**` не аудировал (по правилу
  задачи заморожен, ПДн браузера в адрес там не пишутся — форма шлёт тело).
- **Сборщики вне репозитория** (сам Sentry, ретенция journald на сервере, ротация
  логов Caddy) — не проверял.
