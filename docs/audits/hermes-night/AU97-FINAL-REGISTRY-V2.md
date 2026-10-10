# AU97-FINAL-REGISTRY-V2: сводный реестр находок, версия 2 (после всех отчётов ночи)

Итоговый (только чтение) сводный реестр по всем готовым ночным отчётам
`docs/audits/hermes-night/AU*.md` и `AUDIT-INDEP-HERMES.md`. Код приложения не менялся;
создан единственный файл — этот отчёт.

Версия рабочей папки: `git rev-parse HEAD` = `e36f1821c490373b658232aac558fe27e5e26aa4`
(сокращённо `e36f1821`, ветка `hermes/q4-0926`, рабочая папка `D:\PillingR\wt-night`).
На момент сверки в дереве был один незакоммиченный файл — `AGENTS.md` (не мой, на код ниже не влияет).

Источник свода: прошлый свод `AU50-CONSOLIDATED-REGISTRY.md` (охватывал AU6–AU83, 62 файла) плюс
12 новых отчётов ночи, которых в AU50 ещё не было: **AU84, AU85, AU86, AU87, AU88, AU89, AU90,
AU91, AU92, AU94, AU95, AU96** (файла `AU93` не существует).

## Итог

Всего по ~75 отчётам — порядка **1180 находок**: критично ≈ **46**, важно ≈ **512**,
мелочь ≈ **628** (числа — сумма разделов «Итог» каждого отчёта; шкала severity у отчётов разная,
см. «Не проверено»). В основную таблицу сведены **60 самых ценных**, дубли убраны;
остальное — в приложении (`path:line` без разбора).

Из новых 12 отчётов (AU84–AU96) — **184 находки**: критично **4**, важно **66**, мелочь **114**.
Новые критичные: осмотр с неисправностью не заводит дефект (AU84), форма отчёта показывает
ложное «успешно отправлено» (AU86), кнопка «Новый шаблон» ведёт на несуществующую страницу 404 (AU90),
лимит тарифа `maxUsers` не проверяется при создании пользователя (AU96).

Топ-5 для владельца:

1. **Осмотр с неисправностью не заводит дефект.** Ответы «Замечание»/«Неисправно» 4-статусного
   контроля не входят в список отрицательных (`defect-rules.ts:45`), поэтому штатный пункт сида
   «Наголовник без трещин» (тип `STATUS4`, фото обязательно) не создаёт дефект и не требует фото
   неисправности — вся связка «осмотр→дефект→блокировка допуска» для основного контроля мертва (AU84).
2. **Форма отчёта может соврать «отправлено».** При ответе 200 с не-JSON телом (каптивный портал/прокси)
   `use-report-form.ts:438` даёт `result=null`, проверки тела нет, и показывается
   «Отчёт успешно отправлен!» — отчёт при этом не сохранён (AU86).
3. **Сломанная кнопка в рабочем разделе.** На `/admin/checklists` кнопка «Новый шаблон» ведёт на
   `/admin/checklists/new`, а такой страницы нет (только `page.tsx` и `[id]`) → 404 у 4 ролей (AU90).
4. **Обход допуска к смене и версии наряда** — прежние блокеры «основной системы» из AU18/AU42 и AU65
   (мобильный `accept-equipment` открывает смену без проверки документов/СИЗ; `submit/approve/revoke`
   наряда не двигают `version`) в силе, ссылки на HEAD подтверждены.
5. **ПДн и аудит уходят наружу без маскирования** (email/телефон/ФИО в общий лог, заявка ORION),
   а Sentry, вопреки `sendDefaultPii:false`, отправляет заголовки, куки и query-параметры
   (AU19/AU47/AU95).

## Резюме для владельца (10 строк)

1. Картина та же, что была в прошлом своде: однотенантный режим `orion` пилот выдерживает, но
   «основная система» и SaaS — нет.
2. Главная новая ошибка — мёртвая цепочка «осмотр→дефект→блокировка допуска» на 4-статусном контроле.
3. Вторая — форма отчёта умеет показывать «отправлено» без реального сохранения (каптивный портал).
4. Третья (косметическая, но рабочая) — 404 на кнопке в «Шаблонах чек-листов».
5. Прежние критичные блокеры не закрыты: обход допуска, версия наряда, отсутствие CI-гейта на выкладку.
6. Новые отчёты подтвердили проблемы, о которых раньше не писали: клиентские таймауты/ошибки (AU86),
   Redis (AU87), CORS/CSRF (AU88), индексы БД (AU89), страницы/меню (AU90), англ. тексты (AU91),
   Dockerfile и образы (AU92), локальное хранилище на общем планшете (AU94), Sentry (AU95), квоты (AU96).
7. Для продажи нескольким организациям кода по-прежнему нет: даже `maxUsers` не проверяется (AU96).
8. Замороженные зоны (варианты экрана оператора, ORION) в реестр входят только как источник выводов.
9. Часть «критично» в отчётах — не дефекты продукта, а пробелы тестов (AU54/AU81) и UI (AU29) — шкала разная.
10. Все выводы статические (чтение кода); динамика (БД, Redis, браузер, Playwright, сборка) не запускалась.

## 10 первых действий

1. Закрыть два пути обхода допуска: мобильный `accept-equipment` (AU18/AU42) и веб-отчёт без `requireProductionPermit` (AU18).
2. Добавить `REMARK`/`FAULT` в `NEGATIVE_RESULTS` (или свести UI-словарь к `NO`/`FAIL`) и в `SEVERITY` — AU84 #1,#3.
3. Показывать «успех» формы отчёта только при валидном JSON-теле с ожидаемым полем — AU86 #1.
4. Создать `src/app/(app)/admin/checklists/new/page.tsx` или перевести кнопку на существующий редактор — AU90 #1.
5. Обновлять `version` наряда в `submit/approve/revoke` — AU65.
6. Сделать блок «Проверка» в `deploy-prod.sh` роняющим скрипт и связать выкладку с CI — AU8/AU63.
7. Проверять `Tenant.maxUsers` перед `db.user.create` — AU96 #1.
8. Замаскировать ПДн в аудит-логе и убрать ПДн из лога заявки ORION — AU19/AU47.
9. Включить в бэкап медиа и `.env`/ключи; проверить восстановление — AU28.
10. Задать явный `dataCollection` в Sentry и убрать «обманчивый» `sendDefaultPii` — AU95 #1.

## Методика

Что сделано (повторяемо):

- `git rev-parse HEAD` рабочей папки — версия выше.
- Прочитан прошлый свод `docs/audits/hermes-night/AU50-CONSOLIDATED-REGISTRY.md` целиком
  (он уже свед `/ AU6–AU83` и `AUDIT-INDEP-HERMES.md`); из него взяты 60 отобранных находок R01–R60.
- Прочитаны целиком 12 новых отчётов `AU84`–`AU96` (все, что появились после AU50) — разделы
  «Итог/Резюме», «Методика», «Находки» — и `AUDIT-INDEP-HERMES.md`.
- Первичные отчёты AU6–AU83 построчно **не** перечитывались (объём ≈62 файла): их выводы берутся
  через свод AU50, который эти файлы читал. Это ограничение зафиксировано в «Не проверено».
- **Выборочная проверка ссылок (22 штуки, командой + чтением строк).** Открывал реальные строки
  файлов (не по тексту отчёта): `report-query.service.ts:280-287`,
  `audit-service.ts:995-1002`, `media-content.ts:172-176`, `defects/schemas.ts:18-26`,
  `api-wrapper.ts:178-205`, `csrf-protection.ts:62-80`, `proxy.ts:15-32`,
  `defect-rules.ts:40-50`, `inspection-commands.ts:190-215`, `state-diff.ts:33-45`,
  `template-list.tsx:115-122`, `monitoring/page.tsx:1-12`, `schema.prisma:2295-2302`,
  `use-report-form.ts:435-452`, `api.ts:108-135`, `api-error-message.ts:45-55`,
  `logout/route.ts:14-25`, `sentry.server.config.ts:5-15`, `schema.prisma:15-36`,
  `redis-cache.ts:130-140`, `Dockerfile:95-100`, `telegram/configs/route.ts:15-22`.
  Все открытые ссылки совпали с текстом отчётов.
- Дополнительно проверено командами: `ls src/app/(app)/admin/checklists/` → `[id]`, `layout.tsx`,
  `page.tsx` (страницы `new` нет — подтверждает AU90 #1); `find src/app/api -name route.ts | wc -l` → **141**;
  `find src/app -name page.tsx | wc -l` → **44**; чтение `inspection-controls.tsx:38-48`
  (кнопки `OK/REMARK/FAULT/NA`) и `seed.ts:72-80` (пункт `STATUS4` «Наголовник без трещин`,
  `photoRequired:true`) — подтверждают AU84 #1.
- Крос-отчётная дедупликация — вручную: явные дубли сведены (AU18/AU42 — обход допуска;
  AU57/AU48/AUDIT-INDEP V2 — «Действую как»; AU19/AU47 — аудит-лог; AU8/AU63 — CI+выкладка;
  AU26/AUDIT-INDEP V6 — fail-open сессии; AU10/AU96 — SaaS-управление организациями;
  AU16/AU44/AU82 — выгрузки без лимита; AU33/AU87 — здоровье/Redis).

Обозначения столбца «Ссылка»:
- **✓** — я открыл указанный `path:line`, содержимое совпало;
- **о/р** — ссылка только по тексту отчёта, лично строку не открывал (отчёты писались на разных SHA);
- **≈** — ссылка дана диапазоном/несколькими местами, открывал часть.

Обозначения «Кому отдать»:
- **Hermes (whitelist)** — механическая правка без риска: тексты, подписи, формат, DTO-лейбл, `min-h`;
- **Codex** — правка кода, требующая аккуратности, но не выбора владельца;
- **владелец** — продуктовое решение, замороженная зона, security-файл или инфраструктура.

Обозначения «Блокирует»: **пилот** / **основная** / **SaaS** (по модели доверия AGENTS.md:
ADMIN/DISPATCHER видят все тенанты by design; межтенантные находки = «перед тенантом #2»).

## Находки

| ID | Источник | Суть | path:line | Severity | Ссылка | Кому | Блокирует |
|----|----------|------|-----------|----------|--------|------|-----------|
| R01 | AU18 §1 + AU42 (дубль) | Мобильная команда `accept-equipment` открывает смену (`STARTED`) без проверки документов, СИЗ, инструктажа и знаний — обход всего допуска | `src/modules/operator-mobile/application/commands/equipment.ts:76-107` | критично | о/р (зона заморожена) | владелец | основная |
| R02 | AU18 §2 | Веб-форма отчёта (`upsertReport`) пишет сваи/бурение без `requireProductionPermit` и без проверки состояния смены | `src/modules/reports/application/commands/report-command.service.ts:229-284` | критично | о/р | Codex | основная |
| R03 | AU19 §1 + AU47 §3 (дубль) | Запись аудита пишется в лог целиком, без маскирования: email/телефон/ФИО/данные отчёта уходят в stdout→Loki | `src/services/audit/audit-service.ts:1000` | критично | ✓ | Codex | основная |
| R04 | AU47 §2 | На публичном маршруте ORION в лог пишутся `name`/`contact`/`message` посетителя (ПДн) | `src/app/api/orion/lead/route.ts:83,100` | критично | о/р (зона ORION заморожена) | владелец | основная |
| R05 | AU26 §1 | В репозитории лежат открытые пароли реальных учёток, скрипт без prod-guard и принудительно ставит `isActive:true` | `scripts/reset-passwords.ts:18-31` | критично | о/р | Codex | основная |
| R06 | AU28 §1 | Медиа (фото свай/отчётов — доказательная база) не входит ни в одну резервную копию | `src/core/media/media-content.ts:175`; `src/core/media/media-service.ts:139-152` | критично | ✓ (media-content.ts:175) | владелец | основная |
| R07 | AU28 §2 | `.env`/`ENCRYPTION_KEY`/`DEVICE_KEY_LOOKUP_SECRET` не копируются — дамп БД не самодостаточен | `src/core/security/encryption.ts:74-75`; `src/core/notifications/telegram.ts:88` | критично | о/р | владелец | основная |
| R08 | AU40 §1 | Сумма лимитов памяти контейнеров (4032 МБ) превышает ОЗУ сервера (3.8 ГБ) → риск OOM-kill postgres/app | `docker-compose.prod.yml:34,50,107,118,136` | критично (гипотеза) | о/р | владелец | основная |
| R09 | AU40 §2 | Лимит контейнера Redis (256m) равен `maxmemory 256mb`; реальный RSS выше → cgroup-OOM теряет счётчики и очереди | `docker-compose.prod.yml:118` | критично | ✓ | Codex | основная |
| R10 | AU44 §1 | Вся цепочка аудита готовности читается без `take` на каждый вызов/экспорт | `src/modules/readiness/infrastructure/audit/audit-repository.ts:87` | критично | ✓ | Codex | основная |
| R11 | AU44 §2 + AU16 § (дубль) | Выгрузка готовности (`dataset=reports`) читает все снимки без `take` под serializable-транзакцией | `src/app/api/readiness/export/route.ts:102` | критично | о/р | Codex | основная |
| R12 | AU44 §3 | Выгрузка отчётов CSV/XLSX — `report.findMany` без `take` с детьми в память | `src/modules/reports/application/queries/report-export.service.ts:135` | критично | о/р | Codex | основная |
| R13 | AU44 §4 | KPI-обзор за период грузит весь период дважды без `take` | `src/app/api/admin/analytics/overview/route.ts:52` | критично | о/р | Codex | основная |
| R14 | AU63 §1 + AU8 §1 (дубль) | Ни один путь выкладки не гейтится CI; блок «Проверка» не роняет скрипт — «✔ выкачено» и на unhealthy | `scripts/deploy-prod.sh:124-139`; `.github/workflows/deploy.yml:5-6` | критично | ✓ (deploy-prod.sh) | Codex | основная |
| R15 | AU63 §2 | Новые миграции считают по git-HEAD сервера, а не по `_prisma_migrations` — после частичного прогона миграция выпадет | `scripts/deploy-prod.sh:72,76-80` | критично | ✓ | Codex | основная |
| R16 | AU63 §3 | Барьер смены поколения воркеров без персистентного маркера: kill между STOP и START = сайт лежит | `scripts/replace-worker-generation.sh:111,115,129-130` | критично | о/р | Codex | основная |
| R17 | AU65 §1 | `submit/approve/revoke` наряда не увеличивают `version` → устаревший клиент молча возвращает согласованный наряд в DRAFT | `src/modules/readiness/infrastructure/permits/work-permit-repository.ts:199,247,256` | критично | ✓ (199) | Codex | основная |
| R18 | AU59 §1 | `HANDOVER_PENDING` не закрывается автозакрытием и не отменяется — единственный выход ручной `close-shift` | `src/workers/unified-worker/scheduler.ts:64`; `src/modules/readiness/application/shifts/transitions.ts:11-13` | критично | о/р | Codex | основная |
| R19 | **AU84 §1** | Ответы 4-статусного контроля `REMARK`/`FAULT` НЕ входят в список отрицательных → осмотр с неисправностью не заводит дефект и не требует фото неисправности (штатный пункт сида `STATUS4` «Наголовник без трещин», `photoRequired`) | `src/modules/inspections/domain/defect-rules.ts:45` | критично | ✓ | Codex | основная |
| R20 | **AU86 §1** | Форма отчёта: `res.json().catch(()=>null)`, при `res.ok` с не-JSON телом `result=null`, проверки тела нет, затем безусловно `toast.success('Отчёт успешно отправлен!')` | `src/components/piling/report-form/use-report-form.ts:438,448-449` | критично | ✓ | Hermes | пилот |
| R21 | **AU90 §1** | Кнопка «Новый шаблон» ведёт на `/admin/checklists/new`, а страницы нет (в каталоге только `page.tsx` и `[id]`) → 404 у 4 ролей | `src/components/piling/inspections/template-list.tsx:118` | критично | ✓ | Hermes | пилот |
| R22 | **AU96 §1** | `Tenant.maxUsers` не проверяется при создании пользователя (`createUser` сразу `db.user.create`) — лимит тарифа обходится | `prisma/schema.prisma:19`; `src/services/users/user-service.ts:145-197`; `src/app/api/users/route.ts:40-58` | критично | ✓ (schema:19) | Codex | SaaS |
| R23 | AU57 §3-8 + AU48 §1 + AUDIT-INDEP V2 (дубль) | Режим «Действую как» игнорируется: права/сужения решаются по собственной роли (`settings` PUT, `layout`, `monitoring/template`, `telemetry`, гварды) | `src/app/api/settings/route.ts:27`; `src/modules/reports/application/queries/report-query.service.ts:59,137,284` | важно | о/р | Codex | основная |
| R24 | AUDIT-INDEP V3 | Скачивание PDF по `jobId`: при вычищенной задаче проверка владельца заменяется ролевой (`reports.read_cross_user`) | `src/app/api/reports/single-pdf/route.ts:190-197` | важно | о/р | Codex | основная |
| R25 | AU9 Н7 + AUDIT-INDEP V4 (дубль) | Привилегированные роли читают/меняют медиа любого тенанта по `id` (by design для 1 тенанта, утечка при SaaS) | `src/core/media/media-auth.ts:193` | важно | о/р | владелец | SaaS |
| R26 | AUDIT-INDEP V5 + AU88 §7 (дубль) | В multi-tenant режиме `enforceTenant` доверяет клиентскому заголовку `x-tenant-id` | `src/proxy.ts:86-135` | важно (гипотеза) | о/р | владелец | SaaS |
| R27 | AU26 §8 + AUDIT-INDEP V6 (дубль) | Отзыв сессии fail-open: при недоступности Redis отозванный токен живёт до TTL (12 ч) | `src/services/auth/session-service.ts:88-94,134-154` | важно | о/р | Codex | основная |
| R28 | AU9 Н1 (M7) | Ветка report в media-auth ищет отчёт без `tenantId` → oracle существования отчёта (403 vs 200) | `src/core/media/media-auth.ts:50-56` | важно | ✓ | Codex | SaaS |
| R29 | AU9 Н2 | Медиа `safety_incident`/`equipment_defect` пропускается по формату id — без роли/владельца/тенанта | `src/core/media/media-auth.ts:63-68` | важно | о/р | Codex | основная/SaaS |
| R30 | AU18 §3 | Срок документа считается двумя формулами: `ceil` (списки/допуск) vs `floor` (мобильный экран/выработка) — расходятся на сутки | `src/lib/document-expiry.ts:37-39` vs `src/modules/operator-mobile/domain/operator-admission.ts:47-49` | важно | о/р | Codex | основная |
| R31 | AU18 §4 | `EquipmentDocument.expiresAt` (паспорт/ОСАГО/техосмотр) не читается ни в одном расчётном контуре | `src/modules/equipment/application/commands/equipment-document.ts:15-53` | важно | о/р | Codex | основная |
| R32 | AU18 §9 | Правила наряда (`VALID_WORK_PERMIT_REQUIRED`, `PERMIT_EXPIRED`) выключены по умолчанию, вес `PERMIT`=0 | `src/modules/readiness/domain/readiness-rules.ts:168,188` | важно | о/р | владелец | основная |
| R33 | AU13 §1 + AU59 §4 (дубль) | У `submit-report` нет ключа идемпотентности/проверки «уже сдан» → повтор пишет вторую `ReportAudit` и второе `ReportSubmitted` | `src/modules/operator-mobile/application/commands/shift-close.ts:227` | важно | ✓ | Codex | основная |
| R34 | AU13 §2 | Легаси-старт осмотра по `templateId` создаёт второй `Inspection`+`MaintenanceRecord` (`shiftId=NULL`, уникальный индекс не работает) | `src/modules/inspections/application/commands/inspection-commands.ts:184` | важно | о/р | Codex | основная |
| R35 | AU6 §1 | DTO передачи объявляет `REWORK_REQUESTED`, сервер шлёт `REWORK_REQUIRED` — карта подписей не находит состояние | `src/components/piling/to/readiness/api/contracts.ts:102` vs `.../types.ts:17` | важно | ✓ (contracts.ts:102) | Hermes | пилот |
| R36 | AU6 §2 | Разрешение на пуск — `upsert` одной строки на смену без `before` в журнале: повтор молча затирает прежнее основание и автора | `src/modules/readiness/application/shifts/commands.ts:264-271` | важно | о/р | Codex | основная |
| R37 | AU22 §1 | Рассинхрон дефолтов бакета: presign пишет в `pilingtrack-media`, скачивание читает из `pilingtrack` | `src/core/media/media-service.ts:502` vs `src/app/api/media/[id]/download/route.ts:50` | важно | о/р | Codex | основная |
| R38 | AU22 §2 | `mediaId` документа техники пишется без проверки — можно подшить чужой приватный файл как «документ установки» | `src/modules/equipment/application/commands/equipment-document.ts:50` | важно | о/р | Codex | основная |
| R39 | AU24 §2 | Отчётная ветка не валидирует причину простоя: несуществующий `reasonId` → FK P2003 → 500 + Sentry вместо 400 | `src/modules/reports/application/commands/report-command.service.ts:395-396` | важно | о/р | Codex | основная |
| R40 | AU14 §1 + AU24 §1 (дубль) | Шаг простоя (0,25 ч) enforced только на мобильном экране; API/формы отчёта принимают любой float 0…24 | `src/lib/validation-schemas.ts:280`; `src/components/piling/report-form/downtime-section.tsx:60` | важно | о/р | Hermes/Codex | основная |
| R41 | AU14 §2 | `ReportDowntime.kind='BREAK'` фильтруется только на экране машиниста; в аналитике/выгрузках/PDF сумма без фильтра | `src/services/analytics/site-analytics-service.ts:146-150` | важно | о/р | Codex | основная |
| R42 | AU14 §3 + AU46 (дубль) | Длина сваи считается вручную (`lengthMm/1000`) в обход резолвера `pileLengthMeters` | `src/modules/operator-mobile/application/commands/production.ts:288` | важно | о/р | Codex | основная |
| R43 | AU30 §1-4 | Отчёт не хранит снимок имени: переименование объекта/оператора/установки/марки задним числом переписывает сданные отчёты и PDF | `src/modules/sites/application/commands/site-admin-command.service.ts:182`; `src/services/users/user-service.ts:228` | важно | о/р | Codex | основная |
| R44 | AU27 (13 «важно») | Экраны зовут `getTodayInTimezone()` без пояса тенанта (8 экранов); «сегодня» уедет на сутки у тенанта другого пояса | `src/modules/operator-mobile/application/mobile-shift-query.ts:190`; `src/modules/reports/application/commands/report-validation.service.ts:38` | важно | о/р | Codex | основная/SaaS |
| R45 | AU31 §1 | Комментарий разбора дефекта принимается формой и схемой, но нигде не сохраняется (нет колонки) — решение теряется | `src/modules/readiness/application/defects/schemas.ts:21-25` | важно | ✓ | Codex | основная |
| R46 | AU32 §1 | «Снимок» матрицы прав покрывает 18 из 30 прав и 4 из 7 ролей — зелёный тест не ловит регресс | `tests/integration/authorization-boundaries.spec.ts:42-61` | важно | о/р | Codex | основная |
| R47 | AU33 §1,2 + AU87 §1 (дубль) | `/api/health/deep` считает статус по 7 компонентам, а отдаёт 4; инстанс СОСТОЯНИЯ Redis не пингуется (health проверяет только кэш) | `src/app/api/health/deep/route.ts:40-57`; `src/core/observability/health-tracker/checkers/redis.ts:9` | важно | ✓ (redis-cache.ts) | Codex | основная |
| R48 | AU38 §1 | Нет серверной валидации переходов статуса наряда ТО — любой `status` пишется напрямую (таблица переходов только на клиенте) | `src/modules/equipment/application/commands/equipment-maintenance.ts:228-243` | важно | о/р | Codex | основная |
| R49 | AU43 §1,2 | `BriefingRecord` и `DeadLetterQueue` имеют `tenantId`, но RLS не включён (защита только прикладная) | `prisma/schema.prisma:316`; `prisma/migrations/20260819120000_rls_fail_closed_all/migration.sql:99-107` | важно | ✓ (guard) | Codex | основная/SaaS |
| R50 | AU43 §3 | `BYPASSRLS`-роль `pilingtrack_identity` выдана рабочей роли приложения — любой путь может обойти RLS | `scripts/identity-role-grants.sql:46,50` | важно | ✓ | владелец | SaaS |
| R51 | AU52 §1 | Ровно при 15,0 м/с одновременно горит STOP и чек-лист сам подставляет «ветер в допуске» | `src/components/piling/operator-mobile/safety/known-answers.ts:51` vs `.../work-warnings.ts:102` | важно | о/р | Codex | основная |
| R52 | AU66 §1,2 | Плитки мониторинга подписаны «включая несданные смены», но запрос фильтрует `submitted`; дашборд `/admin` не обновляется сам | `src/components/piling/monitoring/fleet-dashboard.tsx:318,334`; `.../analytics-dashboard/kpi-widgets.tsx:103-119` | важно | о/р | Hermes | пилот |
| R53 | AU82 §1 + AU60 §1 (дубль) | `withApi` не применяет лимит частоты (все 87 GET без лимита); у публичного `alerts/webhook` лимита тоже нет | `src/core/api-wrapper.ts:62`; `src/app/api/alerts/webhook/route.ts:88` | важно | ✓ (api-wrapper) | Codex | основная |
| R54 | AU20 §1,2 + AU33 §8 | TTL пульса планировщиков = 3×интервала (для суточных — 72 ч); пересчёт недельного тренда без пульса/метрики/DLQ | `src/workers/unified-worker/scheduler-heartbeat.ts:40`; `src/modules/reports/application/projections/projection-worker.ts:181` | важно | о/р | Codex | основная |
| R55 | AU21 §3,4 + AU65 §9 | `ReportAudit`/`ReportVersion` объявлены неизменяемыми, но триггера нет; `beforeHash`/`afterHash` — некриптохэш | `prisma/schema.prisma:2007-2028`; `src/services/reports/audit-service.ts:101-109` | важно | о/р | Codex | основная |
| R56 | AU10 §1,2 + AU96 §3 (дубль) | Создать организацию можно только сидом/ручным SQL; нет роли «админ организации» (`users.manage` только у платформенного ADMIN); нет приглашений пользователей | `prisma/seed.ts:119-128`; `src/services/auth/authorization-service.ts:83` | важно | о/р | владелец | SaaS |
| R57 | **AU84 §2** | `startInspection` (legacy) принимает деактивированный шаблон: проверки `isActive` нет, хотя текст ошибки утверждает обратное | `src/modules/inspections/application/commands/inspection-commands.ts:195` | важно | ✓ | Codex | основная |
| R58 | **AU84 §4** | Два контура осмотров дают разные `sourceKey` дефекта (`inspection-item:…` vs `…:stage:…`) — одну неисправность можно завести дважды | `src/modules/inspections/domain/defect-rules.ts:88-90` vs `src/modules/operator-mobile/domain/checklist-run.ts:125` | важно | о/р | Codex | основная |
| R59 | **AU86 §2** | У общего клиента (`src/lib/api.ts`) нет таймаута (`signal`/`AbortSignal`): зависший `fetch` не завершается | `src/lib/api.ts:29-36,130-132` | важно | ✓ | Codex | основная |
| R60 | **AU92 §1 + AU95 §1,2** | В боевые рантайм-образы копируется `prisma/seed.ts` с фиксированными паролями; DSN Sentry зашит в исходники в 3 местах, `sendDefaultPii:false` не выключает заголовки/куки/query | `Dockerfile:98`; `prisma/seed.ts:140-145`; `sentry.server.config.ts:8` | важно | ✓ | Codex | основная |

### Изменения статуса (находки, уже исправленные / подтверждённые на текущем HEAD)

- **AUDIT-INDEP V1** — `src/modules/reports/application/queries/report-query.service.ts:279-286`:
  на HEAD `e36f1821` fail-open устранён — строки 284-286 бросают 403 при пустом `tenantId`,
  есть комментарий «аудит V1». Ссылка **не подтверждает** исходную находку (она уже закрыта).
  Повторно проверено чтением строк. Отдельная задача не нужна.
- **AU31 §7** — подтверждено кодом: у дефектов нет `GET /api/readiness/defects/[id]`
  (в каталоге `[id]` только `triage/resolve/reject`). Находка в силе.
- **AU90 §1** — подтверждено: `src/app/(app)/admin/checklists/` содержит только `[id]`, `layout.tsx`,
  `page.tsx` — страницы `new` нет.

## Что изменилось по сравнению с AU50

1. **Объём.** AU50 сводил AU6–AU83 (62 файла AU + AUDIT-INDEP). После него появились ещё
   12 отчётов (AU84–AU96); они добавлены в реестр — **+184 находки (4 критично, 66 важно, 114 мелочь)**.
   Итоговый охват — ~75 отчётов, ≈1180 находок.
2. **Новые критичные (4):**
   - AU84 §1 — 4-статусный контроль не заводит дефект (`REMARK`/`FAULT` вне `NEGATIVE_RESULTS`);
   - AU86 §1 — ложное «Отчёт успешно отправлен!» при 200 с не-JSON телом;
   - AU90 §1 — 404 на кнопке «Новый шаблон» (`/admin/checklists/new` не существует);
   - AU96 §1 — `Tenant.maxUsers` не проверяется при создании пользователя.
3. **AU96 расширяет/заменяет AU10.** Раньше SaaS-блокер звучал как «нет создания организации
   и роли админа клиента»; AU96 добавляет: **ни одного работающего лимита на организацию**
   (пользователи, объекты, установки, отчёты, фото, хранилище — всё только в схеме, `grep` по `src` = 0),
   нет учёта `storageUsedMB`, `Tenant.isActive` не проверяется при входе.
4. **Новые проблемные области, ранее не покрытые:** клиентские таймауты/401/429 и ложный успех (AU86);
   экземпляры Redis и health (AU87); CORS/CSRF/cookie (AU88); индексы и FK БД (AU89);
   страницы и меню (AU90); остаточный английский в UI (AU91); Dockerfile и образы (AU92);
   localStorage на общем устройстве (AU94); Sentry (AU95).
5. **Уточнения к прежним темам:** AU91 детализует AU29 (пользовательские тексты) — конкретно
   `api-error-message.ts:50` под zod v3 vs проект на zod 4.6.5; AU87/AU33 — здоровье Redis;
   AU88/AU82/AU36 — CSRF/лимиты/CORS; AU92/AU19/AU49/AU61 — образы/секреты; AU95/AU47 — Sentry/логи;
   AU89/AU44 — лимиты выборок и индексы.
6. **Прежние критичные не закрыты** (ссылки на HEAD подтверждены): обход допуска (R01/R02),
   версия наряда (R17), CI+выкладка (R14/R15), бэкап медиа/ключей (R06/R07),
   аудит-лог без маскирования (R03).
7. **Дедупликация.** Явные дубли между AU6–AU83 и AU84–AU96 сведены (например, health/Redis — AU33+AU87;
   CORS/CSRF — AU36+AU88; англ. тексты — AU29+AU91; образы/секреты — AU19+AU92; SaaS — AU10+AU96).
8. **Severity пересчитана, но шкала остаётся чужой.** В таблице сохранены severity исходных отчётов;
   «критично» у UI-текстов (AU29/AU91) и тестового покрытия (AU54/AU81) — не тот же вес, что
   «критично» у безопасности/данных (AU18/AU65/AU84/AU86/AU96).

## Приложение: остальные находки (path:line)

Находки, не вошедшие в 60 (в основном «мелочь» и часть «важно»); полные сценарии — в исходных отчётах.

### Из AU50 (AU6–AU83), без изменений

- **AU6:** `capability-defaults.ts:84-87`; `permits/transitions.ts:40`; `shifts/transitions.ts:4-15,18`; `commands.ts:238-271,406-410`.
- **AU7:** `closing-screen.tsx:69-84`; `next.config.ts:114-116`; `api.ts:647-737`; `offline-queue.ts:139-144`; `operator-mobile-app.tsx:935-939`; `assistant-defect-form.tsx:53-87`.
- **AU8:** `deploy-prod.sh:65,88,108,113`; `ci.yml:96-105`; `integration.yml:23,44`.
- **AU9:** `media-auth.ts:37,100,196`; `authorization-service.ts:38,50,132`; `media-service.ts:337-340`.
- **AU11:** `20260924120000_drop_refresh_token/migration.sql:6`; `20260924120100_site_weekly_trend_tenant_not_null/migration.sql:7`.
- **AU13:** `production-corrections.ts:76`; `checklist.ts:107`; `incidents.ts:61`; `media/route.ts:19-61`; `admission.ts:341`; `equipment.ts:63-108`.
- **AU14:** `schema.prisma:2399,2405`; `fleet-dashboard.tsx:343`; `equipment-tile-block.tsx:193`; `format.ts:22-29`; `report-detail-dialog.tsx:141`; `report-form-dialog.tsx:416`; `report-history-detail-dialog.tsx:168`.
- **AU15:** `step-bar.tsx:70-96,124-125,131-139`; `operator-v10.css:19`; `operator-v10-app.tsx:1712`.
- **AU16:** `readiness/export/route.ts:42,81,114`; `admin-reports.tsx:157-159`; `pile-journal/index.tsx:236`; `single-pdf/route.ts:119`.
- **AU17:** `metrics/route.ts:100,107-137,118`; `lag-monitor.ts:85`; `alerts.yml:172,300`; `thresholds.ts:3`; `prometheus.yml:61-66`.
- **AU18:** `equipment-permits.ts:10-14`; `shared.ts:287-289`; `user-documents.ts:114-145`; `clearance-overview-query.ts:164-166`.
- **AU19:** `Dockerfile:26,119`; `db.ts:45`; `docker-compose.observability.yml:50`; `monitoring-standalone.yml:49`; `reset-passwords.ts:19-30`; `smoke-auth-access.js:203`.
- **AU20:** `health-server.ts:45-54`; `pdf-queue.ts:97`; `outbox-publisher.ts:200-209`; `pm-scheduler.ts:36-37`.
- **AU21:** `reports/delete/route.ts:109`; `report-command.service.ts:280`; `event-handlers.ts:449-453`.
- **AU22:** `media-service.ts:139-152,439-467,337-340`; `equipment-tile-asset-storage.ts:1`; `inspection-commands.ts:247-256`.
- **AU24:** `report.prisma.mapper.ts:49-55`; `downtime-section.tsx:60`; `report-form-dialog.tsx:402-403`; `validation-schemas.ts:275-280`.
- **AU25:** `pm-scheduler.ts:54`; `orion/lead/route.ts:126-148`; `telegram.ts:6-10,205-220`; `event-handlers.ts:307-312`; `durable-alert.ts:28`.
- **AU26:** `reset-passwords.ts:37-43`; `auth.ts:44,133`; `rate-limiter.ts:478-505`; `auth-service.ts:79`; `fix-passwords.sql:4-14`.
- **AU27:** хардкод-MSK/UTC сутки (мониторинг парка, инструктажи ОТ, окно телеметрии).
- **AU28:** `docker-compose.prod.yml:101`; `pitr-basebackup.sh:34`; `backup-postgres.sh:47-56,105-128`; `checkers/backup.ts:89-91`.
- **AU30:** `equipment-analytics-service.ts:121`; `schema.prisma:2406`; `report-history-service.ts:50-64`.
- **AU31:** `defects-panel.tsx:121-124`; `readiness-score.ts:88-94`; `commands.ts:134-135,144`; `queries.ts:46-48,61-63`.
- **AU32:** `authorization-service.ts:64-65,108,128,132`; `role-navigation.ts:97-160`; `telemetry/route.ts:111`.
- **AU33:** `liveness/route.ts:14`; `readiness/route.ts:35`; `checkers/storage.ts:4-16`; `health-checks.ts:121-130`; `prod-smoke.mjs:92`.
- **AU34 (frozen):** `operator/v7/page.tsx:10,13`; `operator-v2/defect-sheet.tsx:54`.
- **AU35:** `response-cache.ts:111-120`; `api-wrapper.ts:144-145`; `(app)/error.tsx:39-45`; `layout.tsx:66-98`.
- **AU36:** `src/proxy.ts:67,225`; `deploy/Caddyfile.prod:30,41,42`; `proxy.ts:155-186`.
- **AU37:** `report-export.service.ts:120-158`; `fleet-monitoring.service.ts:29,115,277-287`; `pile-journal-totals.ts:58-61`; `admin-dashboard.tsx:351`.
- **AU38:** `equipment-maintenance.ts:69-96,211,345-364`; `maintenance-plans/[id]/route.ts:29-57`; `pm-scheduler.ts:129`.
- **AU39:** `crew-command.service.ts:129-159,211-338,256-259`; `crew-query.service.ts:26-27`; `schema.prisma:1886-1902`.
- **AU40:** `docker-compose.yml:237-271`; `docker-compose.prod.yml:50-51,107`; `minio_data` без retention.
- **AU41:** `docs/operator-guide.md`; `docs/onboarding-orion-app.md`; `README.md:58-63`; `PRODUCT.md:56`.
- **AU42:** `shared.ts:287-289`; `shifts/commands.ts:179-180`; `admission.ts:229-235`.
- **AU43:** `20260819120000.../migration.sql:99-107`; `app-role-grants.sql:98`; `identity-role.ts:65`.
- **AU44:** `equipment-query.service.ts:117`; `report-history-service.ts:51-58`; `audit-history-service.ts:110-112`; `clearance-overview-query.ts:205`; `admin/incidents/route.ts:36`; `cached-queries.ts:40`.
- **AU45:** `offline-queue-banner.tsx:147-172`; `pile-passport-form.tsx:287-293`; `operator-dashboard-v3.tsx:177`; `operator-v7.css:558`.
- **AU46:** `site-analytics-service.ts:101-105`; `production-corrections.ts:112-123`; `schema.prisma:1811,1825,1839`.
- **AU47:** `api-wrapper.ts:69-146`; `trace-context.ts:42,56-57`; `event-handlers.ts:473`; `sentry.server.config.ts:19`; `mqtt-ingestion-service.ts:158`; `logger.ts:126-146`.
- **AU48:** `weather-client.ts:70-71`; `work-warnings.ts:61`; `settings/route.ts:15-20,60-69`; `notifications/telegram/test/route.ts:29`; `telegram-config-service.ts`.
- **AU49:** `package.json:72-76,97,104,106,115`.
- **AU51:** `schema.prisma:1341`; `incidents.ts:90,106-117`; `shared.ts:271-277`.
- **AU52:** `work-screen.tsx:40`; `docker-compose.yml:91,184`; `weather-client.ts:82,107`; `production.ts:167-168`.
- **AU53:** `meter-reading.ts:155-159,186`; `meter-readings/route.ts:35-40`; `equipment-metadata.ts:93-97`; `equipment-maintenance.ts:58-100`.
- **AU54:** `vitest.config.ts:69-74`; `report.aggregate.ts`; `pile-journal-*`; `admission.ts`; `mqtt-ingestion-service.ts`.
- **AU55:** `settings/route.ts:32`; `telemetry/ingest/route.ts:115,159`; `media/route.ts:27`; `reports/pdf/route.ts:82`; `single-pdf/route.ts:64`; `feedback/events/route.ts:89`; `sites/[id]/assign/route.ts:46`.
- **AU56:** `pile-journal/index.tsx:419`; `pile-journal-export.ts:138`; `reports/pdf/route.ts:116-128`; `pdf-generator/components.ts:274`; `briefing-journal-print.tsx:241-249`.
- **AU57:** `telemetry/route.ts:366-372`; `audit-service.ts:981-989`; `readPageAbility.ts:22`; `(readiness-admin)/layout.tsx:16`; `equipment/[id]/fuel/route.ts:23`.
- **AU58 (телеметрия спит):** `mqtt-ingestion-service.ts:130,141-146`; `telemetry/ingest/route.ts:96-104,330-332`; `device-key-service.ts:72,155,158`.
- **AU59:** `scheduler.ts:73,76,92-96,169-172,204-218`; `contracts.ts:116-129`; `closeShift` без `assertShiftTransition`.
- **AU60:** `metrics/route.ts:28-31,47`; `device-key-service.ts:16-18,25-31`; `health/deep/route.ts:56`; `ready/route.ts:19-25`; `rate-limiter.ts:177-182`.
- **AU61:** `20260925120000:5-6`; `20260902010000:29-31,35-45`; `20260914090000`; `20260903000000`; `audit-fix-tenancy.sql:32-42`.
- **AU62:** `ops-table.tsx:40`; `admin-equipment.tsx:120`; `admin-dictionaries.tsx:449`; `equipment-table.tsx:46`; `work-order-table.tsx:49`; `admin-dlq.tsx:270-273`; `admin-incidents.tsx:195`.
- **AU64:** `sites/[id]/hierarchy/route.ts:49,99`; `schema.prisma:2199,2377`; `SitePilePlan` без уникальности марки.
- **AU66:** `report-query.service.ts:228-239`; `equipment-tile-block.tsx:110-114,193`; `operational-state.ts:42-49`.
- **AU81:** `disposable-idor.spec.ts:64`; `disposable-rls.spec.ts:7`; `rls-tenant-enforcement.spec.ts:44`; `tenant-transaction-pool.spec.ts:21`; `disposable-m6-m8.spec.ts:12`; `e2e/qa-ac/post-merge-smoke.spec.ts`.
- **AU82:** `reports/export/route.ts:18`; `readiness/export/route.ts:12`; `media/download-batch/route.ts:31`; `rate-limiter.ts:184-192,511-515`; `weather/route.ts:40`.
- **AU83:** `report-export.service.ts:85-87,222,333`; `equipment-detail-overview.tsx:156`; `readiness-centre.tsx:512`; `equipment-detail-parts.tsx:367`; `equipment-analytics.tsx:399-401`; `pdf-generator/components.ts:113-131`.

### Из новых отчётов AU84–AU96 (не вошли в 60)

- **AU84:** `inspection-logic.ts:31`; `inspections/[id]/route.ts:18`; `inspection-commands.ts:281-283,414-417`; `schema.prisma:1587-1600`; `inspection-logic.test.ts:58-82`; `inspection-query.service.ts:21`; `phase-split.ts:49-64`; `safety-checklist-period.ts:48-55,80`; `inspection-controls.tsx:86-106`; `known-answers.ts:45-53`; `evidence.ts:13-18`; `readiness-score.ts:52-62`; `template-commands.ts:27-32`.
- **AU85:** `production.ts:338` (PileWork.depth дубль); `pile-passport-form.tsx:298,351` (int без округления); `command/route.ts:89,96` (границы 10 м/1000); `pile-passport.ts:116-166`; `command/route.ts:104-105,98,99-100`; `pile-journal-list.ts:163-164`; `pile-journal/index.tsx:428`.
- **AU86:** `login-page.tsx:37-49,56-61,64,68`; `api.ts:126-128,130-134,176-193`; `media-thumbnails.ts:63-74`; `use-entity-history.ts:30-37`; `use-feedback-feed.ts:88-102`; `to-module.tsx:231-233`; `photo-section.tsx:89-110`; `client-feedback.ts:29-51`; `fleet-dashboard.tsx:91`; `async-ui.tsx:57-84`; `e2e/rate-limit-e2e.spec.ts:8-20`.
- **AU87:** `workers.ts:59,13`; `health-tracker.test.ts:112`; `pdf-queue.ts:43-49`; `redis.ts:6-20`; `docker-compose.yml:274`.
- **AU88:** `csrf-protection.ts:28-32,41-43,83-98`; `proxy.ts:206,220,38-55`; `session-service.ts:279-291`; `api-wrapper.ts:201`.
- **AU89:** `schema.prisma:1121-1125,1179-1181,1213,1238-1239,1265,1288,1504-1506` (A5–A20); `shift-repository.ts:81`; `work-permit-repository.ts:159`; `telemetry-ingestion-service.ts:290,317`; `bootstrap-query.ts:100`; `feedback-event-service.ts:158`; `equipment-query.service.ts:228`.
- **AU90:** `history/page.tsx:5`; `report/page.tsx:5`; `admin/maintenance/layout.tsx:4`; `workspace-settings.tsx:99,222,270,280,335`; `admin-dashboard.tsx:58-64`; `role-navigation.ts:29-32,106-120`; `e2e/qa-ac/tools/roles-map-md.mjs:25-26`; `inspections/page.tsx:5`; `print/briefing-journal/page.tsx:18-19`.
- **AU91:** `validation-schemas.ts:43,247,260`; `user-dialogs.tsx:105,156,261,311`; `user-detail.tsx:105`; `app/layout.tsx:116`; `login-page.tsx:116`; `telegram/configs/route.ts:19`; `feedback-center.tsx:325`; `equipment-form.tsx:218`; `orion-handoff-site.tsx:333,342` (frozen).
- **AU92:** `Dockerfile:4,20,24-26,37,54,73,107`; `Dockerfile.workers:23,34,43,59,72,73`; `Dockerfile.quick:7,13,14,25-27`; `deploy/Dockerfile.prod:5,43,48,65`; `.dockerignore:33,55,59`; `docker-compose.yml:238,292-293,384`; `docker-compose.observability.yml:16,23,45,50,125`; `docker-compose.monitoring-standalone.yml:25-26,49`; `docker-compose.monitoring-prod.yml:105`; `scripts/Dockerfile.backup:1`; `scripts/deploy-prod.sh:65,113`.
- **AU94:** `store.ts:11-16,105-113,173-183`; `admin-equipment.tsx:33,38`; `equipment-tile-storage.ts:8`; `use-equipment-tile-template.ts:66,75-76`; `design-tuning-panel.tsx:11-12,33-42,68`; `equipment-tile-asset-storage.ts:2-3,111-121`; `logout/route.ts:19-21`; `api.ts:142-148`.
- **AU95:** `api-wrapper.ts:129`; `system-service.ts:63-64`; `instrumentation-client.ts:23,28-33`; `next.config.ts:128,150,163-171`; `proxy.ts:179,250-259`; `sentry.edge.config.ts:9`; `logger.ts:71,78`.
- **AU96:** `schema.prisma:18,20,23-35,65-85`; `auth-service.ts:109-128`; `tenant-iteration.ts:23`; `api/equipment/route.ts:31-69`; `api/sites/create/route.ts:14-46`; `api/reports/upsert/route.ts:17`; `media-service.ts:508`; `bootstrap-query.ts:31-45`; `rate-limiter.ts:511`; `validate-env.ts:95,105`; `tenant-context-service.ts:16,21`.

## Что не проверено

- **Первичные отчёты AU6–AU83 построчно не перечитывались (≈62 файла).** Их выводы взяты через
  свод `AU50-CONSOLIDATED-REGISTRY.md`, который эти файлы читал и сводил. Это значит: для находок
  R01–R18, R23–R56 (из AU6–AU83) я не открывал исходные строки заново — статус «о/р» в колонке «Ссылка».
  Прямо я открыл 22 ссылки (список в «Методике», из них новые AU84–AU96 — почти все «✓»).
- **Динамика не запускалась.** Приложение, БД, Redis, S3, Playwright, `tsc/lint/test/build` не поднимались —
  это read-only задача. Все «критично» основаны на чтении кода, а не на прогоне. Коды завершения команд
  из §6 AGENTS.md не снимались.
- **`AU93` отсутствует.** В каталоге есть AU92 и AU94, файла `AU93` нет — пропуск в нумерации отчётов,
  не моя ошибка; в реестр ничего из него не могло попасть.
- **Числа «≈1180 / 46 / 512 / 628» приблизительные.** Это сумма разделов «Итог» каждого отчёта
  (AU50: ≈42/446/514 + новые 4/66/114). В части отчётов «мелочь/примечания» не отделены строго,
  поэтому точного сведения к одной шкале нет.
- **Severity между отчётами применяется по-разному.** AU29/AU91 (UI-тексты), AU54/AU81 (тестовое покрытие),
  AU84/AU86 (логика/клиент) считают «критично» иначе, чем AU18/AU65 (безопасность/данные).
  Сведение к одной шкале сделано мной и субъективно.
- **Дедупликация — ручная и неполная.** Убраны явные дубли (перечислены в «Методике»); возможны
  невыявленные смысловые пересечения, особенно между «жизненными циклами» (AU6/AU31/AU38/AU51/AU59/AU65/AU84).
- **SaaS-вердикт — по модели доверия AGENTS.md.** Прод однотенантный (`orion`); межтенантные находки
  помечены «SaaS» как «перед тенантом №2», а не как эксплуатируемые сейчас.
- **Замороженные зоны** (варианты экрана оператора, ORION) включены только как источник выводов
  (R01, R04, R51); правки там — решение владельца.
- **Отчёты, помеченные в тексте «ГИПОТЕЗА/НЕ ПРОВЕРЕНО»** (AU40 R08, AU85 #10, AU86 #1,#22, AU87, AU94, AU95),
  сохранены с той же оговоркой, что и в источнике.
- **Диапазоны строк в приложении** приведены как есть из отчётов; в отличие от 22 проверенных ссылок
  основной таблицы, приложенные `path:line` построчно не открывались.
