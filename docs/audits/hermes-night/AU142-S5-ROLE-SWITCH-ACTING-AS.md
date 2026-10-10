# AU142-S5-ROLE-SWITCH-ACTING-AS — Режим «Действую как»: границы и журналирование

Версия (git rev-parse HEAD): `f2cf1820df8e0f19f415af3d0afee60b177790fa`
Дата: 10.10.2026. Только чтение: файлы приложения не менялись.
Отчёты из `docs/audits/**`, `CODEX-REPORT*`, `docs/strategy/**` не читались.

## Итог

Режим «Действую как» включается только администратором (`src/lib/types.ts:58-61`), права считаются по
исполняемой роли на сервере (`src/services/auth/authorization-service.ts:158-159`), подделать заголовок
`x-acting-as` нельзя — `requireAuth` обнуляет замещение для всех, кроме ADMIN (`src/lib/auth.ts:192-193`).
Найдено 22 расхождения. Критичных — 0; **важных — 12**; мелочей — 10.
(Критичных не нашлось: все найденные пути оставляют актором настоящего администратора и не дают чужих данных —
это несоответствия заявленному поведению режима, а не эскалация прав.)
Топ-5:
1. **важно** — пометка о замещении пишется ТОЛЬКО в доказательный журнал контура готовности; общая лента
   (`src/services/audit/audit-service.ts:981-997`) и отчёты (`src/app/api/reports/upsert/route.ts:36,141`)
   пишут настоящую роль ADMIN без `actingAs` — при этом полоса обещает обратное (`src/components/piling/acting-as-banner.tsx:51-52`).
2. **важно** — гварды страниц/разделов не знают об исполняемой роли (`src/lib/page-session.ts:27-31,73`;
   `src/lib/require-page-ability.ts:19-22`): ADMIN в режиме оператора открывает `/admin/...` и получает «полуэкран».
3. **важно** — часть маршрутов решает о правах по СОБСТВЕННОЙ роли, игнорируя замещение:
   `src/app/api/settings/route.ts:27`, `src/app/api/layout/[surfaceId]/route.ts:54,80`,
   `src/app/api/monitoring/template/route.ts:29`, `src/modules/reports/application/queries/report-query.service.ts:59,136,284`.
4. **важно** — доказательный журнал и его CSV-экспорт показывают исполняемую роль вместо настоящей, скрывая ADMIN:
   `src/components/piling/to/readiness/settings/audit-section.tsx:127,154,174`, `src/app/api/readiness/export/route.ts:95`.
5. **важно** — переключение роли — необратимая перезагрузка страницы без подтверждения
   (`src/components/piling/acting-as-banner.tsx:35-38`); черновик спасают только форма отчёта, редакторы раскладки
   и диалоги техники — формы готовности (наряд, дефект, смена) не сохраняются.

## Методика

Поиск по репозиторию (git-bash, `rg`):
- `rg -n "actingAs" src --glob '!**/__tests__/**'` → 132 совпадения в 35 файлах;
- `rg -n "x-acting-as" src` → 12 совпадений (единственный источник заголовка — `src/lib/api.ts:21-24`;
  второй потребитель — ключ кэша `src/core/api-wrapper.ts:44-50`);
- `rg -ln "canActAs" src --glob '!**/__tests__/**'` → 10 файлов;
- `rg -n "role === 'ADMIN'|role === 'DISPATCHER'|role !== 'ADMIN'|isPrivilegedRole\(" src --glob '!**/__tests__/**'`
  → 43 совпадения (из них решения о правах по собственной роли — находки 6-7);
- `rg -n "role: user!?\.?role" src/app/api` → 20 совпадений (actor в журнал без actingAs);
- `rg -ln "beforeunload" src` → 6 файлов (форма отчёта, редакторы раскладки, диалоги техники).
Пути читались целиком либо диапазонами `sed -n`; каждый файл:строка ниже открыт вручную.
Числа в отчёте — только из этих команд и выводов `read_file`.

### Карта поведения (аспект | файл:строка | поведение | статус)

| Аспект | Файл:строка | Поведение | Статус |
|---|---|---|---|
| Кто может включить режим | `src/lib/types.ts:58-61` | Только `role === 'ADMIN'` и только роль из `ACTING_ROLES`; иначе `actingAs` не применяется | ПРОЙДЕНО |
| Список исполняемых ролей | `src/lib/types.ts:40-49` | MECHANIC, FOREMAN, SAFETY_ENGINEER, DISPATCHER, OPERATOR (админ вправе провести смену один) | ПРОЙДЕНО |
| Приём заголовка на сервере | `src/lib/auth.ts:192-201` | `x-acting-as` проверяется `canActAs`; недопустимое значение → `null`; тенант не меняется | ПРОЙДЕНО |
| Кэш сессии не путает роли | `src/lib/auth.ts:120-136` | `actingAs` не входит в 5-секундный кэш сессии, ставится на каждый запрос | ПРОЙДЕНО |
| Клиент шлёт заголовок | `src/lib/api.ts:21-24` | Централизованно в `buildHeaders`, только если заголовка ещё нет | ПРОЙДЕНО |
| Права по исполняемой роли | `src/services/auth/authorization-service.ts:158-159` | `can/assertCan/assertRole` считают по `resolveEffectiveRole` | ПРОЙДЕНО |
| Замещение заменяет, не складывает | `src/modules/readiness/application/capabilities.ts:53-70` | Права исполняемой роли, без объединения со своими | ПРОЙДЕНО |
| Вход в контур готовности | `src/modules/readiness/application/bootstrap-query.ts:134-142` | Раздел открывается по СВОЕЙ роли (чтобы не запереть себя), полномочия внутри — по исполняемой | ПРОЙДЕНО |
| Валидация `?actingAs=` | `src/app/api/readiness/bootstrap/route.ts:30-39` | Лишние параметры → 400; неизвестная роль → 400; не-админ → 403 | ПРОЙДЕНО |
| Запись в журнал готовности | `src/modules/readiness/application/capabilities.ts:114-118`; `src/modules/readiness/infrastructure/audit/append-audit.ts:34-39` | `actor.role='ADMIN'` + `actor.actingAs` реально пишутся в цепочку | ПРОЙДЕНО |
| Медиа-права | `src/core/media/media-auth.ts:38,42,189,193` | Считаются по `resolveEffectiveRole` | ПРОЙДЕНО |
| Общая лента аудита | `src/services/audit/audit-service.ts:981-997` | Роль актора берётся из БД в момент ЧТЕНИЯ; поля `actingAs` нет вовсе | важно |
| Отчёты | `src/app/api/reports/upsert/route.ts:36,141` | `actor: {id, name, role: user.role}` — настоящая роль, без пометки | важно |
| Гвард страниц | `src/lib/page-session.ts:27-31,73` | `PageSessionUser` без `actingAs`; гвард видит ADMIN | важно |
| Роль в UI-журнале | `src/components/piling/to/readiness/settings/audit-section.tsx:127,154,174` | Показывается `actingAs || role` — настоящая роль теряется | важно |

## Находки

| # | severity | файл:строка | проблема | сценарий / почему важно | предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `src/components/piling/acting-as-banner.tsx:51-52` | Полоса обещает: действия «записываются в журнал с пометкой о замещении» | Админ в роли оператора создаёт отчёт: в ленте (`src/services/audit/audit-service.ts:999-1021`) записи нет ни одного признака замещения — владелец читает событие как обычное действие ADMIN. Обещание интерфейса не выполняется | Либо добавить `actingAs` в `AuditEvent` и в запись ленты, либо убрать фразу из текста полосы |
| 2 | важно | `src/services/audit/audit-service.ts:8-16`, `:981-997` | В общем аудите нет поля `actingAs`; роль актора читается из БД при рендере ленты | Смена роли пользователя задним числом переписывает подписи прошлых событий; «кто на самом деле и от чьего имени» в ленте неразличимо | Хранить `userRole`+`actingAs` в самом событии (как в `AuditLog`, `prisma/schema.prisma:2595`) |
| 3 | важно | `src/app/api/reports/upsert/route.ts:36,141`; `src/app/api/reports/delete/route.ts:193`; `src/app/api/reports/pdf/route.ts:157,171,313`; `src/app/api/reports/single-pdf/route.ts:137,151,290,304` | Во всех вызовах журнала отчётов передаётся `role: user.role` (собственная роль) | Админ в режиме механика сдаёт отчёт — запись подписана ADMIN без следа замещения, хотя действие совершалось «как механик» | Прокинуть `user.actingAs` в `actor` и расширить `AuditEvent` (см. № 2) |
| 4 | важно | `src/lib/page-session.ts:27-31,73`; `src/lib/require-page-ability.ts:19-22`; `src/app/(app)/admin/layout.tsx:8-16`; `src/app/(app)/admin/reports/layout.tsx:3-5` | Гварды серверных раскладок считают права по собственной роли (в `PageSessionUser` нет `actingAs`) | ADMIN в режиме OPERATOR открывает `/admin/reports` по прямой ссылке: раскладка пускает (видит ADMIN), а каждый запрос уходит с `x-acting-as: OPERATOR` и получает 403 — «полуэкран» | Читать заголовок `x-acting-as` в раскладке нельзя (его там нет), поэтому либо документировать «вход по своей роли», либо ограничивать редактор адреса по исполняемой роли на клиенте |
| 5 | важно | `src/app/api/settings/route.ts:27` | `PUT /api/settings` пускает по `user!.role !== 'ADMIN'` — без учёта замещения | Админ в режиме механика проходит до записи настроек организации; полномочия не понижены, хотя контур готовности в том же режиме запрещает менять матрицу доступов (`src/modules/readiness/application/capabilities.ts:60-69`) | Сравнивать `resolveEffectiveRole(user.role, user.actingAs)` |
| 6 | важно | `src/app/api/layout/[surfaceId]/route.ts:54,80`; `src/app/api/monitoring/template/route.ts:29` | Права на раскладку дашборда и шаблон мониторинга считаются по собственной роли | То же: режим «Действую как» не понижает права на этих путях | Использовать `resolveEffectiveRole` |
| 7 | важно | `src/modules/reports/application/queries/report-query.service.ts:59,136,284`; `src/modules/sites/application/queries/site-query.service.ts:62`; `src/modules/crews/application/queries/crew-query.service.ts:58` | Тенантная/сквозная выборка включается проверкой `sessionUser.role === 'ADMIN'` без `actingAs` | В режиме замещения чтение идёт полными правами админа — экран показывает не то, что увидит роль, ради которой режим включён | Передавать исполняемую роль (или `can(sessionUser, 'reports.read_cross_user')`) |
| 8 | важно | `src/app/api/equipment/route.ts:67`; `src/app/api/equipment/[id]/route.ts:91`; `src/app/api/equipment/[id]/meter-readings/route.ts:103` | `canDecreaseMeter(user.role)` — снижать счётчик можно по собственной роли | Админ в режиме помощника по-прежнему вправе «вернуть» моточасы назад (`src/modules/equipment/application/commands/meter-reading.ts:74-75`) | Передавать `resolveEffectiveRole` |
| 9 | важно | `src/components/piling/acting-as-banner.tsx:35-38` | Смена роли делает `window.location.reload()` без подтверждения | Админ печатает наряд ТО в контуре готовности и случайно меняет роль в полосе — страница перезагружается, несохранённый ввод теряется | Спрашивать подтверждение при несохранённых данных (как `beforeunload` в редакторе) |
| 10 | важно | `src/components/piling/to/readiness/forms/permit-form.tsx` (нет `beforeunload`); `src/components/piling/report-form/use-report-form.ts:286-299` | От перезагрузки при смене роли защищены только форма отчёта, редакторы раскладки (`src/components/piling/layout-editor/*`) и диалоги техники (`src/components/piling/admin-equipment/equipment-dialogs.tsx:56`) | Форма наряда-допуска, дефекта, смены черновик не сохраняет — данные исчезают молча | Автосохранение черновика либо блокировка переключателя при «грязной» форме |
| 11 | важно | `src/components/piling/to/readiness/settings/audit-section.tsx:127,154,174`; `src/app/api/readiness/export/route.ts:95` | Журнал и CSV-экспорт показывают `actingAs || role`, то есть исполняемую роль вместо настоящей | Действие администратора читается как действие механика/оператора; настоящая роль ADMIN в этих представлениях не видна (в JSON-выдаче `/api/readiness/audit` оба поля есть — `src/app/api/readiness/audit/route.ts:40`) | Показывать «Роль (действует как)», а не подменять значение |
| 12 | важно | `src/modules/readiness/application/bootstrap-query.ts:85-133` | Факт включения замещения фиксируется только при загрузке контура готовности | Админ переключился на оператора и работал в отчётах/справочниках, ни разу не открыв `/admin/to`: в журнале нет ни одной записи «включён режим замещения» | Писать событие в момент смены роли на клиенте (отдельный маршрут) либо в `requireAuth` при первом запросе с новым `actingAs` |
| 13 | мелочь | `src/modules/readiness/application/bootstrap-query.ts:98,116` | Код действия жёстко `acting_as_mechanic` для всех пяти ролей (дедуп тоже по нему) | Функционально верно (сравнивается `after.actingAs`), но код вводит в заблуждение читателя кода и внешние выгрузки; подпись уже исправлена (`src/components/piling/to/readiness/settings/audit-labels.ts:60-63`) | Ввести `acting_as_role` (с совместимым чтением старого кода) |
| 14 | мелочь | `src/components/piling/to/readiness/settings/audit-labels.ts:82-90` | `acting_as_mechanic` входит в `CRITICAL_ACTIONS` — простое переключение роли увеличивает плитку «Критических действий» | Плитка кричит при рутинном переключении роли, маскируя настоящие критические события (отказ в допуске, блокировка пуска) | Убрать код из `CRITICAL_ACTIONS` либо считать отдельно |
| 15 | мелочь | `src/app/(app)/layout.tsx:285-299` | Оболочка (`AdminLayout`/`OperatorLayout`) выбирается по СОБСТВЕННОЙ роли, а навигация внутри — по исполняемой (`:42-43`, `:155-156`) | ADMIN в режиме OPERATOR получает админский каркас с операторскими пунктами меню — оболочка не переключается на «как у роли» | Выбирать оболочку по `resolveEffectiveRole` (или явно ограничить режим разделами) |
| 16 | мелочь | `src/components/piling/admin-equipment/admin-equipment.tsx:23`; `src/components/piling/admin-equipment/detail/equipment-detail.tsx:62`; `src/components/piling/monitoring/equipment-card.tsx:23`; `src/components/piling/feedback-center.tsx:100,288` | UI-гейты по собственной роли (`currentUser.role === 'ADMIN'`) | В режиме механика экран показывает кнопки управления техникой/лентой, которых у механика нет; кнопка либо сработает «как админ», либо даст 403 | Заменить на `can({role, actingAs}, ...)` (`src/lib/use-ability.ts:5-9` — уже умеет) |
| 17 | мелочь | `src/lib/store.ts:174-183` | `actingAs` persist-ится в localStorage и переживает перезагрузку (вход/выход сбрасывают — `:82-88,105-113`) | Две вкладки расходятся: смена роли в одной не меняет значение в памяти другой, и вторая продолжает слать старый `x-acting-as` | Подписка на `storage`-событие либо отказ от persist |
| 18 | мелочь | `src/core/api-wrapper.ts:44-50` | Ключ кэша ответа считается по НЕобработанному заголовку `x-acting-as` | Сессия может создать множество ячеек с разными значениями заголовка; LRU ограничен (`src/core/cache/response-cache.ts:113-115`, 500 записей), поэтому это вытеснение, а не утечка | Хешировать нормализованное (проверенное) значение |
| 19 | мелочь | `src/services/audit/audit-service.ts:999-1000` | Запись события логируется целиком (`logger.info('audit', event)`) | При широком логе туда попадёт и `metadata` события — потенциально чувствительные снимки | Логировать `action`/`scope` без `metadata` |
| 20 | мелочь | `src/modules/readiness/application/permits/commands.ts:264-266` | Согласование наряда идёт «от имени исполняемой роли» (`actingAs ?? actorRole`) и пишет `eventAction` `approved-{role}` | Подпись администратора в режиме диспетчера читается в журнале как «согласован диспетчером»; при этом `actorId` — админ, поэтому различимо только по полю роль | Оставить как есть, но добавить в подпись пометку о замещении |
| 21 | мелочь | `src/components/piling/to/to-module.tsx:404-405` | Повторная загрузка bootstrap с `actingAs` выполняется только если `actor.role === 'ADMIN'` | В остальных случаях (роль мастера/инженера ОТ) запись о замещении не создаётся — смыкается с № 12 | Убрать условие по роли (замещение разрешает только `canActAs`) |
| 22 | мелочь | `src/app/api/readiness/bootstrap/route.ts:48` | `actingAs` передаётся в bootstrap отдельным query-параметром, тогда как команды полагаются на заголовок | Два источника одного факта: расхождение (заголовок «MECHANIC», параметр «FOREMAN») даст экран по одной роли и отказы — по другой | Брать исполняемую роль из `requireAuth` (как в `_shared/request-context.ts:51-65`) |

## Не проверено

- **Поведение в браузере не проверялось** (запуск приложения/Playwright не выполнялся): выводы о «полуэкране»,
  потере черновика и расхождении вкладок сделаны по коду, не по прогону. Это ГИПОТЕЗА на уровне «что увидит человек».
- **Реакция форм контура готовности на смену роли во время заполнения** — проверено сравнением списка файлов с
  `beforeunload` (`rg -l "beforeunload" src` → 6 файлов) против каталога форм; фактического клика по переключателю
  не было.
- **Наличие живых пользователей в ролях** и текущие данные production не проверялись (нет доступа к прод-БД).
- **`x-acting-as` в Sentry** (утечка заголовка в события) — не проверялось, вне предмета задачи.
- **Контур ORION и варианты операторского экрана** (`src/app/operator/**`, `src/components/orion/**`) не разбирались
  по указанию AGENTS.md; встречающиеся там сырые `fetch('/api/...')` могут не нести `x-acting-as`, но это не проверено.
- **Ветка `/api/feedback/events`** (`src/app/api/feedback/events/route.ts:116,154`) использует `user.role` для
  аудитории и подтверждения — относится к находке № 5-7, отдельным прогоном не подтверждено.
