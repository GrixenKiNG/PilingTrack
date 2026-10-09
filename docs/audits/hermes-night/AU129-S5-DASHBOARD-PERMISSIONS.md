# AU129-S5-DASHBOARD-PERMISSIONS: Дашборд — какие данные видит каждая роль

Версия: `git rev-parse HEAD` = `b4fc5a80c1b9e1dc9877e33fee174dd10c366c0f` (ветка `hermes/q4-0926`). Только чтение, код не менялся.

## Итог

Резюме для владельца (5 строк):
1. Дашборд `/admin` по коду доступен трём ролям — ADMIN, DISPATCHER, FOREMAN (гвард страницы требует `analytics.read`), и все пять его API-вызовов для этих ролей отвечают успешно: «обычная» роль без права получает 403 только на ТО, но экран этот вызов просто не делает.
2. Единственный сценарий массового 403 на дашборде — режим «Действую как»: гварды СТРАНИЦ не читают `x-acting-as`, а API читают, поэтому администратор в роли оператора/механика открывает дашборд и видит «Нет прав на аналитику» вместо экрана отказа.
3. `/api/monitoring/fleet` вообще не проверяет право и сужает выдачу по «настоящей» роли, а не по исполняемой — админ в роли оператора получает парк всего тенанта, которого оператору не видно.
4. В «Рисках дня» ссылка на установку не закрыта правом `equipment.read`, поэтому мастер (FOREMAN) упирается в `/no-access`.
5. Компонент `dashboard-attention.tsx` («Требует решения сейчас») в этой ветке ОТСУТСТВУЕТ — он есть только в `main` (коммит `2f8f2eb0`); в HEAD он не подключён и ничего не вызывает.

Числа (из команд): findings всего 8 — критично 0, важно 3, мелочь 5. Проверено маршрутов 6 (все, что вызывает дашборд в HEAD) + 5 маршрутов блока, существующего только в `main`.

Топ-5:
1. [важно] Гварды страниц игнорируют `x-acting-as`, API учитывают → 403 в режиме «Действую как».
2. [важно] `/api/monitoring/fleet` сужает по `user.role` (настоящей), а не по исполняемой роли.
3. [важно] Ссылки «Рисков дня» на `/admin/equipment/{id}` не закрыты `equipment.read` → тупик для FOREMAN.
4. [мелочь] 403 на fleet/recent/sites показан как сетевой сбой («Сводка неполная»), а не как «нет прав».
5. [мелочь] Раздел `/admin` пускает MECHANIC и SAFETY_ENGINEER, а сама страница `/admin` их выгоняет на `/no-access`.

## Методика

- Точка входа — чтение `src/components/piling/admin-dashboard.tsx` целиком (571 строка) и `src/components/piling/admin-dashboard-bits.tsx`; из комментариев и кода собраны 5 маршрутов.
- Гварды: `src/app/(app)/admin/page.tsx`, `src/app/(app)/admin/layout.tsx`, `src/lib/require-page-ability.ts`, `src/lib/page-session.ts`.
- Права: `src/services/auth/authorization-service.ts` (мапа `abilityRoles`, функция `can`), `src/lib/types.ts` (`ACTING_ROLES`, `canActAs`, `resolveEffectiveRole`), `src/lib/auth.ts` (заголовок `x-acting-as`), `src/lib/api.ts` (клиент шлёт заголовок), `src/lib/store.ts`, `src/lib/use-ability.ts`.
- Маршруты API дашборда: `analytics/sites`, `monitoring/fleet`, `maintenance`, `reports/recent`, `sites/all`; плюс `layout/[surfaceId]`.
- Реакция экрана на отказ — по `src/components/piling/__tests__/admin-dashboard.test.tsx` (строки 99, 109, 208, 247) и по коду.
- Сквозной поиск: `search_files` (ripgrep) по `src/app/(app)/admin/**` на `requirePageAbility(`; `git ls-files | grep -i dashboard`; `git log --all -- '*dashboard-attention*'`.
- Команды: `git rev-parse HEAD`; `git cat-file -e HEAD:src/components/piling/dashboard-attention.tsx` (отсутствует); `git merge-base --is-ancestor 2f8f2eb0 HEAD` (NO); `ls "src/app/(app)/admin/"`.
- Матрица собрана из кода (статически); живого прогона сервера/БД не было (см. «Не проверено»).

## Матрица: источник → маршрут → право → роли → что видит роль без права

| Источник данных | Маршрут API (файл:строка) | Требуемое право (проверка) | Роли с доступом | Что видит роль без права |
|---|---|---|---|---|
| План-факт по объектам (сваи/бурение/простой, план-факт) | GET `/api/analytics/sites` — `src/app/api/analytics/sites/route.ts:18` | `sites.read_all` (`assertCan`) | ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER (`src/services/auth/authorization-service.ts:72`) | 403 → в блоке «План-факт по объектам» текст «Нет прав на аналитику»; остальные блоки остаются на экране (`src/components/piling/admin-dashboard.tsx:137-138`, `:492-495`) |
| Парк установок + KPI «в работе» | GET `/api/monitoring/fleet` — `src/app/api/monitoring/fleet/route.ts:21-33` | права НЕТ: только `requireAuth` + тенант; OPERATOR/ASSISTANT сужаются до своих бригад (`:26-32`) | любая аутентифицированная роль; OPERATOR/ASSISTANT — только свои установки | права не требуется (нет 403 по праву); при 401/500 → баннер «Сводка неполная … парк установок» (`src/components/piling/admin-dashboard.tsx:161`, `:430`) |
| Наряды ТО (ремонт / требует ТО / просрочено) | GET `/api/maintenance` — `src/app/api/maintenance/route.ts:15` | `maintenance.manage` (`assertCan`) | ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER (`authorization-service.ts:108`) | вызов НЕ делается: клиент гейтит `useAbility('maintenance.manage')` (`admin-dashboard.tsx:91`, `:158`); плитка ТО пишет «Недоступно вашей роли» (`:355`); ТО-строк в «Рисках дня» нет |
| Отчёты за сегодня (риск «без фото») | GET `/api/reports/recent` — `src/app/api/reports/recent/route.ts:22` | `reports.read_all` (`assertCan`) | ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER (`authorization-service.ts:64`) | 403 → «Сводка неполная: … отчёты» — тот же баннер, что и при сетевом сбое (`admin-dashboard.tsx:161`, `:430`) |
| Справочник объектов (фильтр «Объект») | GET `/api/sites/all` — `src/app/api/sites/all/route.ts:17` | `sites.read_all` (`assertCan`) | ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER | 403 → «Объекты не загрузились» + кнопка «Повторить» (`admin-dashboard.tsx:184-199`, `:440-450`) |
| Раскладка KPI-плиток (шаблон) | GET `/api/layout/main-dashboard` — `src/app/api/layout/[surfaceId]/route.ts:31-36` | права НЕТ: только `requireAuth` + тенант | любая аутентифицированная роль | права не требуется |
| «Требует решения сейчас» — ТОЛЬКО в `main`, в HEAD отсутствует | `/api/readiness/work-permits` (`:25`), `/shifts` (`:21`), `/current` (`:16`), `/defects` (`:30`) — capability `readiness.read`; `/api/user-documents/control` — `users.documents.read_all` | `readiness.read` (вторая матрица прав) / `users.documents.read_all` | по матрице готовности / ADMIN, DISPATCHER, SAFETY_ENGINEER | источник → `null`; если все `null` — блок скрыт; 403 → «Недостаточно прав…» (`src/components/piling/to/readiness/api/client.ts:72-74`) |

### Вызовы, дающие 403, и реакция экрана

- **`/api/analytics/sites`, `/api/reports/recent`, `/api/sites/all` для роли без прав.** По штатной карте прав таких ролей среди тех, кто вообще попадает на `/admin`, нет (гвард страницы уже требует `analytics.read`, а множество `analytics.read ⊂ sites.read_all ∩ reports.read_all`). Поэтому в обычном режиме 403 на дашборде недостижим штатно; ветка `403 → «Нет прав на аналитику»` (`admin-dashboard.tsx:137-138`) — защитная, покрыта тестом `admin-dashboard.test.tsx:99`,`:109`.
- **`/api/maintenance` для FOREMAN.** Роль без права — мастер: `assertCan(user,'maintenance.manage')` дало бы 403 (`src/app/api/maintenance/route.ts:15`, право `authorization-service.ts:108`). Экран этого вызова не делает: `canReadMaintenance` ложно (`admin-dashboard.tsx:91`), и в `loadOps` маршрут подменён `Promise.resolve(null)` (`:158`). Если вызов всё же случится, 403 неотличим от 500 — попадает в `stale.maint` и баннер «Сводка неполная: … техническое обслуживание» (`:161`, `:166`, `:430-435`).
- **Режим «Действую как» — реальный источник 403.** Гварды СТРАНИЦ (`src/lib/page-session.ts:40-74`) не читают `x-acting-as` (в `PageSessionUser` поля `actingAs` нет, стр.:27-31), а API читают (`src/lib/auth.ts:192-193`) и считают права по исполняемой роли (`authorization-service.ts:158-159`). Итог: ADMIN в режиме `OPERATOR` открывает `/admin` (гвард страницы видит настоящую роль ADMIN) и получает 403 на аналитике, отчётах и справочнике — экран «наполовину сломан»; настоящий OPERATOR туда не попал бы вовсе (`src/app/(app)/admin/layout.tsx:14-15`). Клиентский гейт при этом правильный (`src/lib/use-ability.ts:5-8` читает `store.actingAs`), но клиент и сервер расходятся.

## Находки

| # | severity | path:line | problem | scenario / почему важно | suggested fix |
|---|---|---|---|---|---|
| 1 | важно | `src/lib/page-session.ts:40-74`; `src/app/(app)/admin/page.tsx:6`; `src/lib/require-page-ability.ts:19-22`; `src/lib/auth.ts:192-193`; `src/services/auth/authorization-service.ts:158-159` | Гварды страниц/разделов не учитывают `x-acting-as` (заголовок клиентский, на сервере при рендере его нет), а API его учитывают | ADMIN в режиме «Действую как OPERATOR/MECHANIC» открывает `/admin` и видит 403-«полуэкран» («Нет прав на аналитику», «Объекты не загрузились», «Сводка неполная»), вместо экрана отказа, который получил бы реальный оператор. Превью роли вводит в заблуждение | Прокидывать исполняемую роль в серверный гвард (cookie/заголовок на навигации) или явно гасить режим замещения на входе в раздел; как минимум — привести гвард раздела к исполняемой роли |
| 2 | важно | `src/app/api/monitoring/fleet/route.ts:26-28` | Сужает выдачу по `user.role` (настоящей роли из БД), а не по `resolveEffectiveRole`; остальные маршруты используют `assertCan`/`can` | ADMIN в режиме `OPERATOR` получает `operatorUserId = null` → парк ВСЕГО тенанта, тогда как настоящий OPERATOR видит только свои бригады (`:124-132` в сервисе). «Действую как оператор» показывает больше, чем видит оператор; смысл превью теряется. Эскалации нет (ADMIN и так видит всё) | Считать роль через `resolveEffectiveRole(user.role, user.actingAs)`, как в `authorization-service.ts` |
| 3 | важно | `src/components/piling/admin-dashboard.tsx:277`,`:279`,`:282` (и блок `:271-283`) против `:510-546` и `src/app/(app)/admin/equipment/layout.tsx:4` | Ссылки «Рисков дня» на `/admin/equipment/{id}` не закрыты правом `equipment.read`, хотя секция «Парк установок» его учитывает и прячет ссылки (`:522-546`) | FOREMAN на `/admin` (его домашний экран, `src/lib/routes.ts:30`) видит в «Рисках дня» строки «нет отчётов более 3 дней» / «отчёт ожидается» / «простой» с переходом на `/admin/equipment/{id}`, где `equipment.read` нет → `/no-access`. Тупик ровно там, где секцией парка он уже устранён | Закрыть `href` риск-строк тем же `canReadEquipment`, что и плитки парка (или вести в доступный раздел) |
| 4 | мелочь | `src/components/piling/admin-dashboard.tsx:161`,`:166`,`:430-435` против `:137-142` | 403 на fleet/maintenance/recent/sites не отличается от сетевого сбоя: и то и другое → «Сводка неполная» / «Не удалось загрузить» | Роль (или будущая роль), которой источник недоступен по праву, получает текст «не удалось обновить/обновите страницу» и жмёт «Обновить дашборд» без толку; «нет прав» объясняет только аналитика | Различать `res.status === 403` в `loadOps`/`sites` так же, как в `loadAnalytics`, и писать «Нет прав на …» |
| 5 | мелочь | `src/app/(app)/admin/layout.tsx:14-15` против `src/app/(app)/admin/page.tsx:6` | Раскладка раздела пускает MECHANIC и SAFETY_ENGINEER, а страница `/admin` (дашборд) требует `analytics.read`, которого у них нет → `/no-access` | Комментарий раскладки обещает экран отказа только OPERATOR/ASSISTANT, но механик/инженер ОТ тоже видят `/no-access` при переходе на `/admin` (для них домашние — `/admin/to` и `/admin/safety`, `src/lib/routes.ts:34-35`) | Либо убрать MECHANIC/SAFETY_ENGINEER из списка раскладки, либо пояснить, что это роли раздела, но не дашборда |
| 6 | мелочь | `src/app/api/layout/[surfaceId]/route.ts:31-36` | GET раскладки не проверяет право (только `requireAuth` + тенант), в отличие от PUT/DELETE (`:54`,`:80`, только ADMIN) | Любая аутентифицированная роль читает шаблон KPI-плиток поверхности (структура/идентификаторы виджетов). Данные нечувствительные, но это чтение без права | Ввести `*.read`-право на чтение раскладки или сузить до ролей дашборда |
| 7 | мелочь | `src/components/piling/admin-dashboard.tsx` (нет импорта) ; `git log --all -- '*dashboard-attention*'` | Компонент `src/components/piling/dashboard-attention.tsx` («Требует решения сейчас») в HEAD ОТСУТСТВУЕТ, в дашборд не импортирован | Задача ссылается на файл, которого в этой ветке нет: он есть только в `main` (коммит `2f8f2eb0`, также `c74f146c`, `35897261`). В HEAD ветка «требует решения» не рендерится и её API не вызываются | Уточнить ветку/версию задачи; аудит блока провести на `main` или после мержа |
| 8 | мелочь | `src/app/api/monitoring/fleet/route.ts:21-33` | Маршрут парка не проверяет никакое право — полагается только на `requireAuth` и на сужение по роли | Свежесозданная учётка любой роли (в т.ч. ASSISTANT) может тянуть снимок парка; для OPERATOR/ASSISTANT он сужен, для остальных — весь тенант. Отдельного `*.read` у маршрута нет | Решить явно: либо ввести право чтения парка, либо задокументировать, что парк — данные уровня «аутентифицирован всё видит» |

## Не проверено

- Динамика во время работы: сервер/БД не запускались (нет env), поэтому матрица собрана статически по коду. Фактические коды ответов 403 на `/api/analytics/sites` и пр. по живой сессии не воспроизводились — статусы выведены из `assertCan`.
- Список ролей и их права взяты из `src/services/auth/authorization-service.ts`; вторая матрица (контур готовности, `readiness.read`) живёт отдельно и здесь не разбиралась — пересечение прав двух систем не проверено.
- Поведение компонента `dashboard-attention.tsx` прочитано из git-объекта `2f8f2eb0` (на ветке `main`), но не исполнялось и не проверено на HEAD; какие роли реально получают 403 по `readiness.read` — не проверено.
- Ведёт ли клиентская навигация по ссылке-закладке в режиме «Действую как» к перерисовке страницы с заголовком `x-acting-as` (и, значит, к иному гварду раздела) — не проверено.
- E2E/юнит-прогоны для этих маршрутов не запускались (код не менялся); покрытие 403 для `monitoring/fleet`, `sites/all`, `layout` существует/нет — не проверено.
- Точная эксплуатируемость чтения раскладки (пункт 6) — не оценивалась.
