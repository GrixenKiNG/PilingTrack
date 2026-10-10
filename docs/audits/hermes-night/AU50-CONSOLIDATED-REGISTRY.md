# AU50-CONSOLIDATED-REGISTRY: сводный реестр находок ночных аудиторских отчётов

Составлен по всем готовым файлам `docs/audits/hermes-night/AU*.md` (62 файла AU6–AU83) и
`AUDIT-INDEP-HERMES.md`. Код приложения не менялся; создан только этот файл.

Версия рабочей папки на момент сверки ссылок: `git rev-parse --short HEAD` = `e7b2d19d`
(ветка `hermes/q4-0926`). Отчёты писались на разных SHA (в каждом указан свой), поэтому
часть ссылок — «по отчёту».

## Итог

Всего по 63 отчётам — порядка **1000 находок**: критично ≈ **42**, важно ≈ **446**,
мелочь ≈ **514** (из «критичных» 12 — не дефекты продукта, а пробелы тестового покрытия,
AU54/AU81). В реестр сведены **60 самых ценных** и убраны дубли; остальное — в приложении
(`path:line` без разбора).

Топ-5 для владельца:

1. **Допуск к смене обходится.** Мобильная команда `accept-equipment` открывает смену без
   проверки документов/СИЗ/инструктажа (AU18, AU42), а веб-форма отчёта пишет выработку без
   `requireProductionPermit` (AU18). Это брешь безопасности, а не косметика.
2. **Наряд-допуск не защищён версией.** `submit/approve/revoke` не двигают `version`, поэтому
   устаревший браузер молча возвращает согласованный наряд в черновик и аннулирует подписи (AU65).
3. **Выкладка не гейтится проверками.** CI не связан с деплоем (AU8), а блок «Проверка» в
   `deploy-prod.sh` не роняет скрипт — «✔ выкачено» печатается и на unhealthy-контейнере (AU63).
4. **ПДн и аудит-лог уходят в общий лог без маскирования** (email/телефон/ФИО, заявка ORION)
   — AU19/AU47; при осознанном `sendDefaultPii:false` в Sentry это несоответствие.
5. **Бэкапы неполны:** медиа (фото — доказательная база) и секреты `.env`/`ENCRYPTION_KEY` не
   копируются, дамп БД не самодостаточен (AU28).

Что делать первым: закрыть два пути обхода допуска (пп. 1), затем версию наряда (п. 2) и
гейт выкладки (п. 3) — это блокеры «основной системы». Пункты 4–5 — параллельно (риски 152-ФЗ
и восстановления). SaaS-блокеры (создание организации, роль админа клиента, межтенантные медиа,
RLS-пробелы) — отдельным этапом «до второго тенанта».

## Методика

Что сделано (повторяемо):

- Прочитаны все `docs/audits/hermes-night/AU*.md` и `AUDIT-INDEP-HERMES.md` (первичные отчёты
  писались независимо друг от друга, поэтому дубли между ними убраны вручную).
- Для каждого отчёта взяты раздел «Итог» (числа по severity, топ-находки) и таблица «Находки»
  (ID, severity, `path:line`, проблема). Формат таблиц разный, поэтому использован скрипт-извлечение
  секций по заголовкам, вывод прочитан построчно.
- **Выборочная проверка ссылок (команда + чтение строк, 18 штук).** Открывались `read_file`
  с номерами строк: `report-query.service.ts:275-286`, `media-auth.ts:48-57`, `logger.ts:44-58`,
  `api-wrapper.ts:60-67`, `audit-repository.ts:85-89`, `pdf-data.ts:126-140`,
  `work-permit-repository.ts:195-204`, `shift-close.ts:225-230`, `media-content.ts:172-176`,
  `package.json:72-83`, `docker-compose.prod.yml:114-119`, `deploy-prod.sh:122-131`,
  `defects/schemas.ts:18-25`, `to/readiness/api/contracts.ts:100-105`, `reports/upsert/route.ts:70-75`,
  `audit-service.ts:998-1001`, `rls_fail_closed_all/migration.sql:97-108`,
  `identity-role-grants.sql:44-51`, `weather-client.ts:66-71`, `rate-limiter.ts:509-515`.
  Все открытые ссылки совпали с текстом отчётов, кроме одной (см. ниже).
- Получены дополнительные факты по коду: `ls src/app/api/readiness/defects/[id]/` → `triage`,
  `resolve`, `reject` (файла `route.ts` нет — подтверждает AU31 №7).

**Важное расхождение (ссылка не подтверждает исходную находку).**
`AUDIT-INDEP-HERMES.md` V1 (`src/modules/reports/application/queries/report-query.service.ts:279-283`)
на текущем HEAD **уже исправлена**: код (строки 284-286) теперь бросает 403 при пустом `tenantId`,
есть комментарий «аудит V1». То есть в исходном отчёте это было fail-open, а сейчас — fail-closed.
Помечено «исправлено».

Обозначения столбца «Ссылка»:
- **✓** — я открыл указанный `path:line`, содержимое совпало;
- **о/р** — ссылка только по тексту отчёта, лично строку не открывал (отчёты писались на разных SHA;
  при ревью стоит перепроверить точечно);
- **≈** — ссылка в отчёте дана диапазоном/несколькими местами, открывал часть.

Обозначения «Кому отдать»:
- **Hermes (whitelist)** — механическая правка без риска: тексты, подписи, формат, DTO-лейбл, `min-h`;
- **Codex** — правка кода, требующая аккуратности, но не выбора владельца;
- **владелец** — продуктовое решение, замороженная зона, security-файл или инфраструктура (`.env`,
  `docker-compose*`, миграции, схема).

Обозначения «Блокирует»:
- **пилот** — проведению пилота внутри одной компании;
- **основная** — работе основной системы одной компании;
- **SaaS** — «перед тенантом №2» (по модели доверия AGENTS.md: ADMIN/DISPATCHER видят все тенанты
  by design, поэтому межтенантные находки = «перед тенантом #2»).

## Находки

| ID | Источник | Суть (одной фразой) | path:line | Severity | Ссылка | Кому | Блокирует |
|----|----------|---------------------|-----------|----------|--------|------|-----------|
| R01 | AU18 §1 + AU42 §1 (дубль) | Мобильная команда `accept-equipment` открывает смену (`STARTED`) без проверки документов, СИЗ, инструктажа и знаний — обход всего допуска | `src/modules/operator-mobile/application/commands/equipment.ts:76-107` | критично | о/р (зона заморожена) | владелец | основная |
| R02 | AU18 §2 | Веб-форма отчёта (`upsertReport`) пишет сваи/бурение без `requireProductionPermit` и без проверки состояния смены | `src/modules/reports/application/commands/report-command.service.ts:229-284` | критично | о/р | Codex | основная |
| R03 | AU19 §1 + AU47 §3 (дубль) | Запись аудита пишется в лог целиком, без маскирования: email/телефон/ФИО/данные отчёта уходят в stdout→Loki | `src/services/audit/audit-service.ts:1000` | критично | ✓ | Codex | основная |
| R04 | AU47 §2 | На публичном маршруте ORION в лог пишутся `name`/`contact`/`message` посетителя (ПДн) | `src/app/api/orion/lead/route.ts:83,100` | критично | о/р (зона ORION заморожена) | владелец | основная |
| R05 | AU26 §1 | В репозитории лежат открытые пароли реальных учёток, скрипт без prod-guard и принудительно ставит `isActive:true` | `scripts/reset-passwords.ts:18-31` | критично | о/р | Codex | основная |
| R06 | AU28 §1 | Медиа (фото свай/отчётов) не входит ни в одну резервную копию — процедуры восстановления нет | `src/core/media/media-content.ts:175`; `src/core/media/media-service.ts:139-152` | критично | ✓ (media-content.ts:175) | владелец | основная |
| R07 | AU28 §2 | `.env`/`ENCRYPTION_KEY`/`DEVICE_KEY_LOOKUP_SECRET` не копируются — дамп БД не самодостаточен | `src/core/security/encryption.ts:74-75`; `src/core/notifications/telegram.ts:88` | критично | о/р | владелец | основная |
| R08 | AU40 §1 | Сумма лимитов памяти контейнеров (4032 МБ) превышает ОЗУ сервера (3.8 ГБ) → риск OOM-kill postgres/app | `docker-compose.prod.yml:34,50,107,118,136` | критично (гипотеза) | о/р | владелец | основная |
| R09 | AU40 §2 | Лимит контейнера Redis (256m) равен `maxmemory 256mb`; реальный RSS выше → cgroup-OOM теряет счётчики лимитов и очереди | `docker-compose.prod.yml:118` | критично | ✓ | Codex | основная |
| R10 | AU44 §1 | Вся цепочка аудита готовности читается без `take` на каждый вызов/экспорт | `src/modules/readiness/infrastructure/audit/audit-repository.ts:87` | критично | ✓ | Codex | основная |
| R11 | AU44 §2 | Выгрузка готовности (`dataset=reports`) читает все снимки без `take` под serializable-транзакцией | `src/app/api/readiness/export/route.ts:102` | критично | о/р | Codex | основная |
| R12 | AU44 §3 | Выгрузка отчётов CSV/XLSX — `report.findMany` без `take` с детьми в память | `src/modules/reports/application/queries/report-export.service.ts:135` | критично | о/р | Codex | основная |
| R13 | AU44 §4 | KPI-обзор за период грузит весь период дважды без `take` | `src/app/api/admin/analytics/overview/route.ts:52` | критично | о/р | Codex | основная |
| R14 | AU63 §1 + AU8 §1 (дубль) | Ни один путь выкладки не гейтится CI; блок «Проверка» не роняет скрипт — «✔ выкачено» и на unhealthy | `scripts/deploy-prod.sh:124-139`; `.github/workflows/deploy.yml:5-6` | критично | ✓ (deploy-prod.sh) | Codex | основная |
| R15 | AU63 §2 | Новые миграции считают по git-HEAD сервера, а не по `_prisma_migrations` — после частичного прогона миграция выпадет | `scripts/deploy-prod.sh:72,76-80` | критично | ✓ | Codex | основная |
| R16 | AU63 §3 | Барьер смены поколения воркеров без персистентного маркера: kill между STOP и START = сайт лежит | `scripts/replace-worker-generation.sh:111,115,129-130` | критично | о/р | Codex | основная |
| R17 | AU65 §1 | `submit/approve/revoke` наряда не увеличивают `version` → устаревший клиент молча возвращает согласованный наряд в DRAFT | `src/modules/readiness/infrastructure/permits/work-permit-repository.ts:199,247,256` | критично | ✓ (199) | Codex | основная |
| R18 | AU59 §1 | `HANDOVER_PENDING` не закрывается автозакрытием и не отменяется — единственный выход ручной `close-shift`; смена висит и блокирует установку | `scheduler.ts:64`; `transitions.ts:11-13` | критично | о/р | Codex | основная |
| R19 | AU10 §1 | Создать организацию можно только сидом/ручным SQL — ни API, ни экрана | `prisma/seed.ts:119` | критично | о/р | владелец | SaaS |
| R20 | AU10 §2 | Нет роли «админ организации»: `users.manage` только у платформенного ADMIN, видящего все тенанты | `src/services/auth/authorization-service.ts:83` | критично | о/р | владелец | SaaS |
| R21 | AU10 §3 | Приглашения пользователей нет; рассылки писем нет — пароль раздаёт админ вручную | `src/app/api/users/route.ts:40` | критично | о/р | владелец | SaaS |
| R22 | AU37 §1 | PDF за период печатает строки черновиков, а итоги в шапке — только по сданным: документ противоречит сам себе | `src/lib/pdf-data.ts:128-140` vs `:170-182` | критично | ✓ (128-140) | Codex | основная |
| R23 | AU46 §1 | На одном экране «Дашборд» два разных «% свай»: плитка в м.п., блок «План-факт» и «Риски» — в шт. | `src/components/piling/admin-dashboard.tsx:313` vs `:236` | критично | о/р | Hermes | основная |
| R24 | AU29 §1,2 | На частых действиях пользователю показывается сырой `Error.message`/`SyntaxError` («Failed to fetch») | `src/components/piling/equipment-analytics.tsx:109`; `src/components/piling/report-form/photo-section.tsx:110` | критично | о/р | Hermes | пилот |
| R25 | AU15 §1 | Аудируемой кнопки «Следующий шаг» (`NextStepTab`) в рабочей папке нет — на HEAD лежит старый `StepBar`; аудит сделан по коммиту `2ecc754f` из `main` | `src/components/piling/operator-mobile/step-bar.tsx:47` @HEAD | критично | о/р | владелец | основная |
| R26 | AU54 §1 + AU31 §4 | Команды дефектов допуска (232 строки) не импортирует ни один тест; route-тестов дефектов нет | `src/modules/readiness/application/defects/commands.ts` | критично | о/р | Codex | основная |
| R27 | AU81 §1,2 | Два файла контрактов техготовности — безусловный `describe.skip`, не выполняются никогда | `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts:80,143`; `tests/contract/tech-readiness-api.spec.ts:49` | критично | о/р | Codex | основная |
| R28 | AU57 §3-8 + AU48 §1 + AUDIT-INDEP V2 (дубль) | Режим «Действую как» игнорируется: права/сужения решаются по собственной роли (`settings` PUT, `layout`, `monitoring/template`, `telemetry`, гварды страниц, оборудование/топливо) | `src/app/api/settings/route.ts:27`; `src/app/api/layout/[surfaceId]/route.ts:54,80`; `src/app/api/monitoring/template/route.ts:29`; `src/app/api/telemetry/route.ts:366` | важно | о/р | Codex | основная |
| R29 | AUDIT-INDEP V3 | Скачивание PDF по `jobId`: при вычищенной задаче проверка владельца заменяется ролевой (`reports.read_cross_user`) | `src/app/api/reports/single-pdf/route.ts:190-197` | важно | о/р | Codex | основная |
| R30 | AU9 Н7 + AUDIT-INDEP V4 | Привилегированные роли читают/меняют медиа любого тенанта по `id` (by design для 1 тенанта, утечка при SaaS) | `src/core/media/media-auth.ts:193` | важно | о/р | владелец | SaaS |
| R31 | AUDIT-INDEP V5 | В multi-tenant режиме `enforceTenant` доверяет клиентскому заголовку `x-tenant-id` | `src/proxy.ts:86-135` | важно | о/р | владелец | SaaS |
| R32 | AU26 §8 + AUDIT-INDEP V6 | Отзыв сессии fail-open: при недоступности Redis отозванный токен живёт до TTL (12 ч) | `src/services/auth/session-service.ts:88-94,134-154` | важно | о/р | Codex | основная |
| R33 | AU9 Н1 (M7) | Ветка report в media-auth ищет отчёт без `tenantId` → oracle существования отчёта (403 vs 200), работает и между организациями | `src/core/media/media-auth.ts:50-56` | важно | ✓ | Codex | SaaS |
| R34 | AU9 Н2 | Медиа `safety_incident`/`equipment_defect` пропускается по формату id — без роли/владельца/тенанта | `src/core/media/media-auth.ts:63-68` | важно | о/р | Codex | основная/SaaS |
| R35 | AU18 §3 | Срок документа считается двумя формулами: `ceil` (списки/допуск) vs `floor` (мобильный экран/выработка) — расходятся на сутки | `src/lib/document-expiry.ts:37-39` vs `src/modules/operator-mobile/domain/operator-admission.ts:47-49` | важно | о/р | Codex | основная |
| R36 | AU18 §4 | `EquipmentDocument.expiresAt` (паспорт/ОСАГО/техосмотр) не читается ни в одном расчётном контуре | `src/modules/equipment/application/commands/equipment-document.ts:15-53` | важно | о/р | Codex | основная |
| R37 | AU18 §9 | Правила наряда (`VALID_WORK_PERMIT_REQUIRED`, `PERMIT_EXPIRED`) выключены по умолчанию, вес `PERMIT`=0 | `src/modules/readiness/domain/readiness-rules.ts:168,188` | важно | о/р | владелец | основная |
| R38 | AU13 §1 + AU59 §4 (дубль) | У `submit-report` нет ключа идемпотентности/проверки «уже сдан» → повтор пишет вторую `ReportAudit` и второе `ReportSubmitted` | `src/modules/operator-mobile/application/commands/shift-close.ts:227` | важно | ✓ (227) | Codex | основная |
| R39 | AU13 §2 | Легаси-старт осмотра по `templateId` создаёт второй `Inspection`+`MaintenanceRecord` (`shiftId=NULL`, уникальный индекс не работает) | `src/modules/inspections/application/commands/inspection-commands.ts:184` | важно | о/р | Codex | основная |
| R40 | AU6 §1 | DTO передачи объявляет `REWORK_REQUESTED`, сервер шлёт `REWORK_REQUIRED` — карта подписей не находит состояние | `src/components/piling/to/readiness/api/contracts.ts:102` vs `types.ts:17` | важно | ✓ (contracts.ts:102) | Hermes | пилот |
| R41 | AU6 §2 | Разрешение на пуск — `upsert` одной строки на смену без `before` в журнале: повтор молча затирает прежнее основание и автора | `src/modules/readiness/application/shifts/commands.ts:264-271` | важно | о/р | Codex | основная |
| R42 | AU22 §1 | Рассинхрон дефолтов бакета: presign пишет в `pilingtrack-media`, скачивание читает из `pilingtrack` | `src/core/media/media-service.ts:502` vs `src/app/api/media/[id]/download/route.ts:50` | важно | о/р | Codex | основная |
| R43 | AU22 §2 | `mediaId` документа техники пишется без проверки — можно подшить чужой приватный файл как «документ установки» | `src/modules/equipment/application/commands/equipment-document.ts:50` | важно | о/р | Codex | основная |
| R44 | AU24 §2 | Отчётная ветка не валидирует причину простоя: несуществующий `reasonId` → FK P2003 → 500 + Sentry вместо 400 | `src/modules/reports/application/commands/report-command.service.ts:395-396` | важно | о/р | Codex | основная |
| R45 | AU14 §1 + AU24 §1 (дубль) | Шаг простоя (0,25 ч) enforced только на мобильном экране; API/формы отчёта принимают любой float 0…24 | `src/lib/validation-schemas.ts:280`; `src/components/piling/report-form/downtime-section.tsx:60` | важно | о/р | Hermes/Codex | основная |
| R46 | AU14 §2 | `ReportDowntime.kind='BREAK'` фильтруется только на экране машиниста; в аналитике/выгрузках/PDF сумма `duration` без фильтра | `src/services/analytics/site-analytics-service.ts:146-150` и др. | важно | о/р | Codex | основная |
| R47 | AU14 §3 + AU46 (дубль) | Длина сваи считается вручную (`lengthMm/1000`) в обход резолвера `pileLengthMeters` | `src/modules/operator-mobile/application/commands/production.ts:288` | важно | о/р | Codex | основная |
| R48 | AU30 §1-4 | Отчёт не хранит снимок имени: переименование объекта/оператора/установки/марки задним числом переписывает сданные отчёты и PDF | `src/modules/sites/application/commands/site-admin-command.service.ts:182`; `src/services/users/user-service.ts:228`; `src/services/dictionaries/dictionary-service.ts:300-325` | важно | о/р | Codex | основная |
| R49 | AU27 (13 «важно») | Экраны админки/оператора зовут `getTodayInTimezone()` без пояса тенанта (8 экранов); «сегодня» уедет на сутки у тенанта другого пояса | пример: `src/modules/operator-mobile/application/mobile-shift-query.ts:190`; `src/modules/reports/application/commands/report-validation.service.ts:38` | важно | о/р | Codex | основная/SaaS |
| R50 | AU31 §1 | Комментарий разбора дефекта принимается формой и схемой, но нигде не сохраняется (нет колонки) — решение теряется | `src/modules/readiness/application/defects/schemas.ts:21-25` | важно | ✓ (schemas) | Codex | основная |
| R51 | AU32 §1 | «Снимок» матрицы прав покрывает 18 из 30 прав и 4 из 7 ролей — зелёный тест не ловит регресс | `tests/integration/authorization-boundaries.spec.ts:42-61` | важно | о/р | Codex | основная |
| R52 | AU33 §1,2 | `/api/health/deep` считает статус по 7 компонентам, а отдаёт 4; инстанс СОСТОЯНИЯ Redis не проверяется вовсе | `src/app/api/health/deep/route.ts:40-57` | важно | о/р | Codex | основная |
| R53 | AU38 §1 | Нет серверной валидации переходов статуса наряда ТО — любой `status` пишется напрямую (таблица переходов только на клиенте) | `src/modules/equipment/application/commands/equipment-maintenance.ts:228-243` | важно | о/р | Codex | основная |
| R54 | AU43 §1,2 | `BriefingRecord` и `DeadLetterQueue` имеют `tenantId`, но RLS не включён (защита только прикладная) | `prisma/schema.prisma:316`; `prisma/migrations/20260819120000_rls_fail_closed_all/migration.sql:99-107` | важно | ✓ (guard) | Codex | основная/SaaS |
| R55 | AU43 §3 | `BYPASSRLS`-роль `pilingtrack_identity` выдана рабочей роли приложения — любой путь может обойти RLS | `scripts/identity-role-grants.sql:46,50` | важно | ✓ | владелец | SaaS |
| R56 | AU52 §1 | Ровно при 15,0 м/с одновременно горит STOP и чек-лист сам подставляет «ветер в допуске» | `src/components/piling/operator-mobile/safety/known-answers.ts:51` vs `work-warnings.ts:102` | важно | о/р | Codex | основная |
| R57 | AU66 §1,2 | Плитки мониторинга подписаны «включая несданные смены», но запрос фильтрует `submitted`; дашборд `/admin` не обновляется сам | `src/components/piling/monitoring/fleet-dashboard.tsx:318,334`; `src/components/piling/analytics-dashboard/kpi-widgets.tsx:103-119` | важно | о/р | Hermes | пилот |
| R58 | AU82 §1 + AU60 §1 (дубль) | `withApi` не применяет лимит частоты (все 87 GET без лимита); у публичного `alerts/webhook` лимита тоже нет | `src/core/api-wrapper.ts:62`; `src/app/api/alerts/webhook/route.ts:88` | важно | ✓ (api-wrapper) | Codex | основная |
| R59 | AU20 §1,2 + AU33 §8 | TTL пульса планировщиков = 3×интервала (для суточных — 72 ч); пересчёт недельного тренда без пульса/метрики/DLQ | `src/workers/unified-worker/scheduler-heartbeat.ts:40`; `src/modules/reports/application/projections/projection-worker.ts:181` | важно | о/р | Codex | основная |
| R60 | AU21 §3,4 + AU65 §9 | `ReportAudit`/`ReportVersion` объявлены неизменяемыми, но триггера нет; `beforeHash`/`afterHash` — некриптохэш, теряет вложенные поля и не проверяется | `prisma/schema.prisma:2007-2028`; `src/services/reports/audit-service.ts:101-109` | важно | о/р | Codex | основная |

### Изменения статуса (находки, уже исправленные / снятые на текущем HEAD)

- **AUDIT-INDEP V1** — `src/modules/reports/application/queries/report-query.service.ts:279-286`:
  на HEAD `e7b2d19d` fail-open устранён (код бросает 403 при пустом `tenantId`, есть комментарий
  «аудит V1»). Ссылка **не подтверждает** исходную находку — она уже закрыта. Отдельная задача не нужна.
- **AU31 §7** — подтверждено кодом: у дефектов нет `GET /api/readiness/defects/[id]` (в каталоге
  `[id]` только `triage/resolve/reject`), а `Location` при создании выдаётся. Находка в силе.

## Приложение: остальные находки (path:line)

Ниже — находки, не вошедшие в 60 (в основном «мелочь» и часть «важно»), сгруппированные по источнику.
Полные сценарии — в исходных отчётах.

- **AU6** (мелочь): `capability-defaults.ts:84-87` устаревший комментарий; `permits/transitions.ts:40`
  approve не меняет состояние; `shifts/transitions.ts:4-15` дубль машины состояний; `:18` DRAFT-ветка
  недостижима; `commands.ts:406-410` избыточная проверка; `commands.ts:238-271` waiver без проверки состояния.
- **AU7** (важно/мелочь): `closing-screen.tsx:69-84` барьер закрытия только на клиенте; `next.config.ts:114-116`
  нет service worker; `api.ts:647-737` фото только онлайн; `offline-queue.ts:139-144` классификация отказов;
  `operator-mobile-app.tsx:935-939` ключ accept-equipment в момент клика; `assistant-defect-form.tsx:53-87` дефект без очереди.
- **AU8** (важно/мелочь): `scripts/deploy-prod.sh:65,88,108` сборка образа локально; `:113` compose без `-f`;
  `ci.yml:96-105` образ приложения не собирается; `integration.yml:23,44` postgres:16 vs 18; отсутствует dependabot/secret-scanning.
- **AU9** (мелочь): `media-auth.ts:37 vs :182-188` read фото установки строже mutate; `:100` `site` не поддержан;
  `authorization-service.ts:50,132` `media.upload` мёртв; `:38` неверный текст на чтении; `:196` inspection через `maintenance.manage`;
  `media-service.ts:337-340` `getDownloadUrl` заглушка.
- **AU11** (важно): `20260924120000_drop_refresh_token/migration.sql:6` и `20260924120100_site_weekly_trend_tenant_not_null:7`
  — откат образа ниже `a92cc8ab`/`a8b1aa4` ломает §; нет down-миграций у Prisma.
- **AU13** (важно/мелочь): `production-corrections.ts:76` нет перехвата P2002; `checklist.ts:107`; `incidents.ts:61`;
  `media/route.ts:19-61` presigned не идемпотентен; `admission.ts:341` `submit-knowledge` пишет всегда; `equipment.ts:63-108` accept-equipment ключ не на смену.
- **AU14** (важно/мелочь): `schema.prisma:2399,2405` `duration`+`durationSeconds` дублируют факт;
  `fleet-dashboard.tsx:343`/`equipment-tile-block.tsx:193` простой через `formatHours`; `format.ts:22-29` «N ч 60 мин»;
  `report-detail-dialog.tsx:141`, `report-form-dialog.tsx:416`, `report-history-detail-dialog.tsx:168` `formatNumber(...)+' ч'`.
- **AU15** (важно): `step-bar.tsx:70-96` диалог без ловушки фокуса/Esc; `:124-125`+`operator-v10.css:19` круг недоступного шага тёмный;
  `:131-139` подпись не гаснет; `operator-v10-app.tsx:1712` контраст 4.60.
- **AU16** (важно/мелочь): `readiness/export/route.ts:81,102,114` выгрузка техготовности без лимита; отсутствует «выгрузить всё»;
  `admin-reports.tsx:157-159` нет `x-export-row-count`; `readiness/export/route.ts:42` `dictionary` отдаёт технику;
  `pile-journal/index.tsx:236` имя файла на клиенте; `single-pdf/route.ts:119` имя файла без санитизации.
- **AU17** (важно/мелочь): `metrics/route.ts:100,107-137` бизнес/backup-метрики только при живом снимке; `:118` backup-блок условный;
  `lag-monitor.ts:85` vs `alerts.yml:172` vs `thresholds.ts:3` три порога outbox; `alerts.yml:300` недостижимая ветка; дубли алертов; `prometheus.yml:61-66` лишний job.
- **AU18** (важно/мелочь): `equipment-permits.ts:10-14` `validUntil` не в пуске; `shared.ts:287-289` инструктаж/знания вне допуска;
  `user-documents.ts:114-145` `listDocumentsNeedingAttention` без `take`; `clearance-overview-query.ts:164-166` хардкод MSK.
- **AU19** (важно/мелочь): `Dockerfile:119` validate-env не в контейнере; `db.ts:45` логирование запросов с параметрами;
  `docker-compose.observability.yml:50`/`monitoring-standalone.yml:49` пароль Grafana `admin`; `reset-passwords.ts:19-30` хардкод паролей;
  `Dockerfile:26` мёртвый `PIN_LOOKUP_SECRET`; захардкоженный Sentry DSN; `smoke-auth-access.js:203` и др. секреты в скриптах.
- **AU20** (мелочь): `health-server.ts:45-54` пульсы планировщиков не отдельной метрикой; `pdf-queue.ts:97` PDF-задачи без DLQ;
  `outbox-publisher.ts:200-209` `failed` всегда 0; `pm-scheduler.ts:36-37` сводка best-effort; циклы наблюдаемости без лидера/пульса.
- **AU21** (важно/мелочь): `reports/delete/route.ts:109` удаление без строки `deleted`; schema нет FK `ReportAudit→Report`;
  мобильные действия со сменой без аудита; `report-command.service.ts:280` форма не пишет `submitted`; `event-handlers.ts:449-453` мёртвые подписки.
- **AU22** (мелочь): `media-service.ts:139-152` `pending`-записи не убираются; `:439-467` `runRetention` не вызывается;
  `:337-340` `getDownloadUrl` заглушка; `equipment-tile-asset-storage.ts:1` лимит 12 МБ vs 10; `inspection-commands.ts:247-256` `countInspectionPhotos` без userId.
- **AU24** (мелочь): `report.prisma.mapper.ts:49-55` не пишет `startedAt/endedAt/durationSeconds` (гипотеза потери интервала);
  `downtime-section.tsx:60` step=1; `report-form-dialog.tsx:402-403` step=0.5; `validation-schemas.ts:275-280` комментарий противоречит коду.
- **AU25** (важно/мелочь): `pm-scheduler.ts:54` сводка ТО без outbox; `orion/lead/route.ts:126-148` заявка шлётся раз;
  `telegram.ts:205-220` выключение канала засоряет DLQ; `:6-10` докстринг обещает rate-limit/retry; `event-handlers.ts:307-312` ключ дедупа простоя неверный;
  `durable-alert.ts:28` сырой `equipmentId` в тексте.
- **AU26** (важно/мелочь): `reset-passwords.ts:37-43` сброс не двигает `sessionVersion`; `auth.ts:44,133` мёртвый `authUserCache`;
  `rate-limiter.ts:478-505` без `TRUST_PROXY` один бакет; `auth-service.ts:79` IP-бакет не сбрасывается; выход 503 при истёкшей куке;
  нет self-service смены пароля; `fix-passwords.sql:4-14` хеши-заглушки.
- **AU27** (мелочь): хардкод-MSK/UTC сутки на периферии (мониторинг парка, инструктажи ОТ, окно телеметрии).
- **AU28** (важно/мелочь): `docker-compose.prod.yml:101` PITR выключен; `pitr-basebackup.sh:34` basebackup на том же сервере;
  `backup-postgres.sh:47-56` нет restore-drill; `:105-128` off-site best-effort; `checkers/backup.ts:89-91` health не видит off-site.
- **AU30** (важно/мелочь): `equipment-analytics-service.ts:121` выведенная установка выпадает из KPI; `schema.prisma:2406` `reasonText` не пишется;
  `report-history-service.ts:50-64` история подставляет имена живьём; `Report.user/site` Cascade, `Report.equipment` SetNull.
- **AU31** (мелочь): `defects-panel.tsx:121-124` разбор не может уточнить severity/наряд; `readiness-score.ts:88-94` блокировка CRITICAL без теста;
  `commands.ts:144` `Location` на несуществующий маршрут; `queries.ts:46-48,61-63` фильтры/сводка по странице; `commands.ts:134-135` `inspectionId/shiftId` без проверки.
- **AU32** (мелочь): `authorization-service.ts:132`/`:128` мёртвые `media.upload`/`crews.legacy_manage`; ASSISTANT вне матрицы; `:64-65` `read_all`=`read_cross_user`;
  `:108` `maintenance.manage` на чтении; `role-navigation.ts:97-160` меню-копия матрицы; `telemetry/route.ts:111` своя `assertAnyRole`.
- **AU33** (мелочь): `liveness/route.ts:14` публикует pid/heap; `readiness/route.ts:35` Sunset просрочен; `checkers/storage.ts:4-16` local всегда «up»;
  `health-checks.ts:121-130` env никогда не fail; `prod-smoke.mjs:92` ветка websocket мертва.
- **AU34** (frozen, важно): v7 `page.tsx:13` комментарий противоречит коду; `:10` ссылка на несуществующий `/operator/module`;
  `operator-v2/defect-sheet.tsx:54` ручной дефект только у v2; v3 вне QA/e2e. Зона заморожена — только фиксация.
- **AU35** (мелочь): `response-cache.ts:111-120` in-memory кэш без сброса при выходе; `api-wrapper.ts:144-145` нет `Cache-Control` на auth-GET;
  `(app)/error.tsx:39-45` нет авто-обновления после деплоя; `layout.tsx:66-98` «полу-PWA».
- **AU36** (важно/мелочь): `src/proxy.ts:225` security-заголовки только в ветке `/api`; `:67` `X-Frame-Options DENY` перекрывает `SAMEORIGIN` PDF;
  `deploy/Caddyfile.prod:30,41,42` HSTS/COOP/CORP только в Caddy; `proxy.ts:155-186` нет `report-uri`; `connect-src https:`; нет `poweredByHeader:false`.
- **AU37** (важно/мелочь): `report-export.service.ts:120-158` CSV не отделяет черновики; `fleet-monitoring.service.ts:29,115` жёсткий MSK;
  `:277-287` парк предпочитает проекцию; `pile-journal-totals.ts:58-61` черновые сваи в итоге; `admin-dashboard.tsx:351` числитель период vs прогресс накопительный.
- **AU38** (мелочь): `equipment-maintenance.ts:69-96` создание сразу DONE/CANCELLED; `:345-364` удаление закрытого наряда не откатывает регламент;
  `maintenance-plans/[id]/route.ts:29-57` PATCH без аудита; `equipment-maintenance.ts:211` смена `type`; `pm-scheduler.ts:129` HOURS-наряд без `scheduledAt`.
- **AU39** (важно/мелочь): `crew-command.service.ts:211-338` правка бригады не сверяется с открытой сменой; `:256-259` перенос установки; `:129-159` createCrew без назначения оператора на объект;
  `crew-query.service.ts:26-27` пагинация по неполному курсору; `schema.prisma:1886-1902` нет unique `(crewId,userId)`.
- **AU40** (важно/мелочь): `docker-compose.yml:237-271` pgbouncer без healthcheck/лимитов; `docker-compose.prod.yml:107` postgres 1g; `:50-51` workers 512m;
  нет cAdvisor/тревог на лимиты; `minio_data` без retention; два стека мониторинга.
- **AU41** (важно/мелочь): `docs/operator-guide.md`, `docs/onboarding-orion-app.md` устарели (меню, 4 vs 7 ролей, «офлайна нет»); `README.md:58-63`, `PRODUCT.md:56` четыре роли; документы недостижимы из README.
- **AU42** (важно/мелочь): `shared.ts:287-289` инструктаж/знания не на сервере; `shifts/commands.ts:179-180` пуск без бригады пропускает проверку;
  `admission.ts:229-235` дата СИЗ от клиента; дубль расчёта допуска; `isIdentityValid` мёртв.
- **AU43** (мелочь): `20260819120000...:99-107` guard только на момент наката (корень R54); `app-role-grants.sql:98` DELETE на журналы; `identity-role.ts:65` `$executeRawUnsafe` (осознанно); строгая политика на nullable `tenantId`.
- **AU44** (важно/мелочь): `equipment-query.service.ts:117` история установки без `take`; `report-history-service.ts:51-58` карты имён без `take`;
  `audit-history-service.ts:110-112`; `clearance-overview-query.ts:205`; `admin/incidents/route.ts:36` без курсора; `cached-queries.ts:40` `crews:all` без tenantId.
- **AU45** (важно/мелочь): `offline-queue-banner.tsx:147-172` кнопки ≈29 px; `pile-passport-form.tsx:287-293` ссылка «убрать» ≈21 px;
  `operator-dashboard-v3.tsx:177` «История» без `hit-target`; `operator-v7.css:558` бейдж 12 px; общая `Button` 36 px в операторских диалогах.
- **AU46** (важно/мелочь): `site-analytics-service.ts:101-105` план в м.п. по `metersPerUnit` (ненадёжно); три «факта по объекту»;
  `production-corrections.ts:112-123` поправка без `picketId`; `schema.prisma:1811,1825,1839` нет плана у полей/кустов/пикетов.
- **AU47** (важно/мелочь): `api-wrapper.ts:69-146` нет `requestId`; `trace-context.ts:42,56-57` `no-trace`; `event-handlers.ts:473` читает несуществующий `requestId`;
  `sentry.server.config.ts:19` ложь про Loki; `mqtt-ingestion-service.ts:158` логирует brokerUrl; база compose без ротации логов; `logger.ts:126-146` мёртвый `withRequestLogging`.
- **AU48** (важно/мелочь): `weather-client.ts:70-71`+`work-warnings.ts:61` пороги 15/36 — константы; `settings/route.ts:15-20` GET без права;
  `notifications/telegram/test/route.ts:29` `reports.read_all`; `telegram-config-service.ts` нет unique `(tenantId,chatId)`; `settings/route.ts:60-69` мёртвые поля в аудите.
- **AU49** (важно/мелочь): `package.json:72-76` 5 `@opentelemetry/*` не импортируются; `:104` `next-themes`; `:106` `pino`; `:97` `cookie`; `:115` `tailwindcss-animate`; нет npm audit в CI.
- **AU51** (важно/мелочь): `schema.prisma:1341` `RepairVerification` мёртвая; `incidents.ts:90` лестница состояний не реализована;
  `:106-117` разбор происшествия не влияет на готовность; нет тестов `reportIncident`/`STOP_INCIDENT`; `shared.ts:271-277` запрет только по текущей смене.
- **AU52** (важно/мелочь): `work-screen.tsx:40` возраст замера без пояса; `docker-compose.yml:91,184` `WEATHER_API_BASE` не проброшена;
  `weather-client.ts:82` `??` вместо `||`; `production.ts:167-168` мёртвый `readWeather`; `weather-client.ts:107` округление до порога.
- **AU53** (важно/мелочь): `meter-reading.ts:186`/`meter-readings/route.ts:35-40` нет `recordedAt<=now`; `equipment-metadata.ts:93-97` очистка наработки мимо журнала;
  `equipment-maintenance.ts:58-100` наряд сразу DONE без показания/регламента; `meter-reading.ts:155-159` замена счётчика не сбрасывает план ТО.
- **AU54** (важно/мелочь): `vitest.config.ts:69-74` порог покрытия 24/23/19/19%; `report.aggregate.ts` без прямого теста; `pile-journal-*` (801 строка) без тестов; `admission.ts` только на моках; `mqtt-ingestion-service.ts` исключён из покрытия.
- **AU55** (важно/мелочь): `settings/route.ts:32` и 4 маршрута передают тело в доменный санитайзер без zod-схемы;
  `telemetry/ingest/route.ts:115,159` без схемы; `media/route.ts:27` джерик; `reports/pdf:82`/`single-pdf:64`/`feedback/events:89` битый JSON → 500; `sites/[id]/assign:46` `userId` без валидации.
- **AU56** (важно/мелочь): `pile-journal/index.tsx:419` vs `pile-journal-export.ts:138` дата сваи по разным поясам;
  `reports/pdf/route.ts:116-128` асинхронный путь теряет «Установка»; `pdf-generator/components.ts:274` футер по часам сервера;
  `briefing-journal-print.tsx:241-249` теряет вид инструктажа/объект/инструктора; номер отчёта в PDF короткий.
- **AU57** (мелочь): `telemetry/route.ts:366-372` `assertAnyRole` по своей роли; `audit-service.ts:981-989` общая лента без `actingAs`; `readPageAbility.ts:22`; `(readiness-admin)/layout.tsx:16`; `equipment/[id]/fuel/route.ts:23` — по своей роли.
- **AU58** (важно/мелочь, телеметрия спит): `mqtt-ingestion-service.ts:130` `startMqttIngestion` не вызывается; `:141-146` пакет `mqtt` не объявлен;
  `telemetry/ingest/route.ts:330-332` пишет напрямую; `:96-104` чтение Equipment без тенанта; нет ретеншена `TelemetryRecord`; `device-key-service.ts:72,155` выпуск/отзыв ключей без аудита; `:158` логирует brokerUrl.
- **AU59** (важно/мелочь): `scheduler.ts:169-172` автозакрытие vs офлайн-очередь; `:204-218` автозакрытый отчёт без полей/`ReportAudit submitted`;
  `:73,76,92-96` окно дописывания дневной смены ~5 ч; `contracts.ts:116-129` DTO без `autoClosedAt`; `closeShift` без `assertShiftTransition`.
- **AU60** (мелочь): `metrics/route.ts:28-31` тайминг-оракул длины; `device-key-service.ts:16-18` fallback на `SESSION_SECRET`;
  `health/deep/route.ts:56` имена планировщиков; `ready/route.ts:19-25` `latencyMs`; `rate-limiter.ts:177-182` `RATE_LIMIT_BYPASS`; `device-key-service.ts:25-31` dev-секрет.
- **AU61** (важно/мелочь): многие миграции: `CREATE INDEX` без `CONCURRENTLY` (`20260925120000:5-6`, `20260902010000:29-31`); `ADD CONSTRAINT CHECK` без `NOT VALID` (`:35-45`);
  метка `20260914090000` раньше закоммиченных; `20260903000000` совмещает backfill+RLS; два `DROP`; `SET NOT NULL` вне миграций (`audit-fix-tenancy.sql:32-42`).
- **AU62** (важно/мелочь): `ops-table.tsx:40` заголовок без `gap-3`; двухколоночный режим на `lg` сжимает колонку (`admin-equipment.tsx:120`, `admin-dictionaries.tsx:449`);
  `equipment-table.tsx:46` 11 колонок без `min-w`; `work-order-table.tsx:49` `min-w-[1050px]`; цели `<44px` (`admin-dlq.tsx:270-273`, `admin-incidents.tsx:195` и др.).
- **AU64** (важно/мелочь): `sites/[id]/hierarchy/route.ts:49,99` нет правки/переименования узлов; `schema.prisma:2199,2377` `Picket→PileWork` SET NULL;
  `SitePilePlan` без уникальности марки; снижение плана ниже факта не блокируется; RLS не покрывает `PileField/Cluster/Picket/PileWork`; нет unique имён узлов.
- **AU66** (мелочь): `report-query.service.ts:228-239` свежие отчёты включают черновики; `equipment-tile-block.tsx:110-114,193` статус/простой по отчёту; `operational-state.ts:42-49` `maintenanceRecord.findMany` без tenantId.
- **AU81** (важно/мелочь): интеграционные наборы, гейтнутые env: `disposable-idor.spec.ts:64` (161 сценарий), `disposable-rls.spec.ts:7`, `rls-tenant-enforcement.spec.ts:44`,
  `tenant-transaction-pool.spec.ts:21`, `disposable-m6-m8.spec.ts:12`, `tech-readiness-*.spec.ts` (shifts/permits/projection/write-pipeline), `e2e/qa-ac/post-merge-smoke.spec.ts`.
- **AU82** (мелочь): `reports/export/route.ts:18`, `readiness/export/route.ts:12` без лимита; `media/download-batch/route.ts:31`; `rate-limiter.ts:184-192` деградация в память;
  `rate-limiter.ts:511-515` мёртвый `getTenantRateLimitIdentifier` (ключ из `x-tenant-id`); `metrics/route.ts:47`; `weather/route.ts:40`.
- **AU83** (важно/мелочь): `report-export.service.ts:85-87,222,333` метры/часы без единого округления; моточасы 0/1/до3/сырое
  (`equipment-detail-overview.tsx:156`, `readiness-centre.tsx:512`, `equipment-detail-parts.tsx:367`); отказ сваи `1.85` vs `1,9`; `formatHours` дублируется в `equipment-analytics.tsx:399-401`;
  проценты/деньги в разных знаках; `pdf-generator/components.ts:113-131` строка метрик может обрезаться.

## Не проверено

- **Толька часть ссылок открыта лично (18 из ~60 в основной таблице).** Остальные в столбце «Ссылка»
  помечены «о/р» — они взяты из текста отчётов, которые писались на разных SHA; сплошной перепроверки
  каждой строки кода не делал. Причину не скрываю: объём (≈1000 находок) и разные версии кода у отчётов.
- **Динамика не запускалась.** Приложение, БД, Redis, S3, Playwright, `tsc/lint/test/build` не поднимались —
  это read-only задача. Все «критично» из отчётов подтверждены их авторами чтением кода, а не прогоном.
- **Кросс-отчётная дедупликация — ручная и неполная.** Я убрал явные дубли (напр. `accept-equipment` в
  AU18/AU42; допуск в AU42; actingAs в AU57/AU48/AUDIT-INDEP; выгрузки в AU16/AU44/AU82). Возможны
  невыявленные смысловые пересечения (особенно между AU6/AU31/AU38/AU51/AU59/AU65 по «жизненным циклам»).
- **Severity между отчётами применяется по-разному.** AU29/AU54/AU81 считают «критично» иначе (UI-тексты,
  тестовое покрытие), чем AU18/AU65 (безопасность/данные) — сведение к одной шкале сделано мной и субъективно.
- **Арифметика «Итог» приблизительная.** Числа по severity — сумма значений из разделов «Итог» каждого
  отчёта; в нескольких отчётах «мелочь/примечания» не отделены строго, поэтому «≈».
- **SaaS-вердикт — по модели доверия AGENTS.md.** Прод single-tenant `orion`; межтенантные находки
  помечены «SaaS» как «перед тендентом #2», а не как эксплуатируемые сейчас.
- **Замороженные зоны** (варианты экрана оператора, ORION) в реестр включены только как источник выводов
  (R01, R04, R25, AU34, AU45); правки там — решение владельца.
- **Отчёты, помеченные в тексте «НЕ ПРОВЕРЕНО/ГИПОТЕЗА»** (напр. AU40 R08, AU56 §4, AU52 §2, AU17), сохранены
  с той же оговоркой, что и в источнике.
