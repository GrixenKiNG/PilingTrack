# AU212-S5-AUDIT-EXPORT-ACCESS: Выгрузки: кто что может скачать

Ревью: `git rev-parse HEAD` = `8e585a150e5e1c54b113dfdd50e2f7de77821345`, ветка `hermes/q4-0926`.
Только чтение: код приложения не менялся, создан один файл — этот отчёт.

## Итог

Проверены все 7 маршрутов, отдающих файл или ссылку на файл: `reports/export` (CSV/XLSX),
`reports/pdf` (сводный PDF), `reports/single-pdf` (PDF одного отчёта), `pile-passports/export`
(журнал забивки XLSX), `readiness/export` (CSV), `media/[id]/download` и `media/download-batch`
(подписанные ссылки). Фильтр по `tenantId` присутствует и **fail-closed** во всех пяти
файловых выгрузках — прямого кросс-тенантного чтения данных не найдено.

Найдено: **критично — 0, важно — 3, мелочь — 6** (плюс 3 наблюдения-гипотезы).
Топ-5:
1. Excel/CSV отчётов защищены правом `reports.export` (только ADMIN), а PDF **того же**
   состава данных — правом `reports.read_all` (ещё DISPATCHER, FOREMAN, SAFETY_ENGINEER).
   Одно право обходится другим маршрутом;
2. `readiness/export` выгружает полные справочники техники и нарядов-допусков CSV под правом
   `readiness.read` — тем же, что и просмотр экранов (отдельное право заведено только для audit);
3. тяжёлая выгрузка `reports/export` (до 92 дней, все дочерние коллекции) — без ограничения
   частоты, хотя `pile-passports/export` и `reports/pdf` его себе добавили;
4. ветка `jobId` у сводного PDF не проверяет владельца задачи (у одиночного PDF — проверяет);
5. `getPdfJobStatus` возвращает клиенту внутренний путь файла/S3-ключ (`filePath`).

## Методика

- Точка входа: `search_files` по `src/app/api/**/route.ts` для `Content-Disposition|content-disposition`,
  затем полное чтение всех найденных маршрутов (список выше).
- Права: `src/services/auth/authorization-service.ts` (таблица `abilityRoles`) и
  `src/modules/readiness/domain/capability-defaults.ts` (матрица контура готовности).
- Фильтр тенанта прослежен до конца: `src/modules/reports/application/queries/report-export.service.ts`,
  `.../pile-journal-list.ts`, `src/modules/reports/application/queries/pile-journal-export.ts`,
  `src/core/infrastructure/raw-queries.ts`, `src/core/media/media-auth.ts`.
- Права на файлы: `src/core/media/media-auth.ts` (`assertCanAccessMedia`, `filterReadableMedia`,
  `ownsUserDocumentMedia`), `src/services/auth/resource-access-service.ts` (`ensureTenantAccess`,
  `assertCanAccessReportOwner`).
- PDF-очередь: `src/lib/pdf-queue.ts`, `src/workers/pdf-worker.ts`, `src/lib/pdf-generator/storage.ts`.
- Проверки лимитов частоты: `search_files` по `rateLimiter.check` в `src/app/api`.
- Повторить: `rg -n "Content-Disposition" src/app/api`; `rg -n "rateLimiter.check" src/app/api`;
  `rg -n "abilityRoles" src/services/auth/authorization-service.ts`.

## Таблица маршрутов

| Маршрут | Файл:строка | Право | Фильтр tenantId | Что попадает в файл | Риск |
|---|---|---|---|---|---|
| GET /api/reports/export (csv/xlsx) | `src/app/api/reports/export/route.ts:24` | `reports.export` = только ADMIN (`authorization-service.ts:66`) | да, `requireTenantId` (:27) → строгий `where.tenantId` (`report-export.service.ts:121,125`) | все отчёты тенанта за период ≤92 дней: объект, оператор, экипаж, установка, сваи/бурение/простои, топливо, черновики | ПРОЙДЕНО (кроме отсутствия лимита частоты) |
| GET/POST /api/reports/pdf (сводный PDF, period) | `src/app/api/reports/pdf/route.ts:80,223` | `reports.read_all` = ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER (`authorization-service.ts:64`) | да, `tenantId` в raw-запрос → fail-closed (`raw-queries.ts:69-72`) | тот же состав отчётов тенанта, что и CSV, плюс название компании/установки | важно: право шире, чем у CSV того же периода |
| GET/POST /api/reports/single-pdf | `src/app/api/reports/single-pdf/route.ts:92-94,265` | владелец отчёта ИЛИ `reports.read_cross_user`; tenant — `ensureTenantAccess` | да (`resource-access-service.ts:80`, строгое равенство, 404) | один отчёт | ПРОЙДЕНО; мелочь — имя в filename (`:119`) |
| GET /api/pile-passports/export (журнал забивки .xlsx) | `src/app/api/pile-passports/export/route.ts:62` | `piles.manage` = ADMIN, DISPATCHER, FOREMAN (`authorization-service.ts:71`) | да, `requireTenantId` (:64) → `pile-journal-list.ts:51` строгое равенство | нормативный журнал: сваи, залоги, отметки, решение мастера, машинист, титул с реквизитами | ПРОЙДЕНО; лимит 6/мин есть (:53) |
| GET /api/readiness/export (csv) | `src/app/api/readiness/export/route.ts:28` | `audit` → `readiness.audit.export` (по умолчанию только ADMIN); `fleet/permit/reports/dictionary` → `readiness.read` | да, `context.tenantId` везде (`:45,60,103,114`) | техника, наряды-допуски, снимки готовности, журнал (с хэшами) | важно: выгрузка под «читающим» правом |
| GET /api/media/[id]/download | `src/app/api/media/[id]/download/route.ts:28` | `assertCanAccessMedia` (владелец ИЛИ тенант+право ИЛИ привилегированная роль) + `ownsUserDocumentMedia` (:34) | tenantId в `select` (:21), не в `where` (:19) — проверка внутри правила | подписанная ссылка (TTL 3600) на фото/скан | ПРОЙДЕНО; гипотеза по `equipment` (см. #8) |
| GET /api/media/download-batch | `src/app/api/media/download-batch/route.ts:65` | тот же `assertCanAccessMedia` через `filterReadableMedia` | нет в `where` (:56-62) — отбор внутри правила | до 100 подписанных ссылок | ПРОЙДЕНО; мелочь — нет лимита частоты |

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Что сделать |
|---|---|---|---|---|---|
| 1 | важно | `src/app/api/reports/export/route.ts:24` + `src/app/api/reports/pdf/route.ts:80` | Разные права на один и тот же состав данных: CSV/XLSX — `reports.export` (только ADMIN), PDF периода — `reports.read_all` (ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER). | Диспетчер/мастер/инженер ОТ не могут скачать .xlsx, но могут получить PDF со всеми теми же отчётами (и через `/api/reports/period` JSON). Право `reports.export` как «контроль выноса данных» обходится соседним маршрутом. | Либо поднять PDF до `reports.export`, либо свести оба маршрута к одному явному праву «выгрузка отчётов», определив его по владельцу. |
| 2 | важно | `src/app/api/readiness/export/route.ts:28` | Пять наборов (fleet, permits, reports, dictionary, audit) выгружаются CSV; четыре из них требуют лишь `readiness.read` — то же право, что открывает экраны (`capability-defaults.ts:66-135`). Отдельное право (`readiness.audit.export`) есть только у audit. | Роль с просмотром экрана (в т.ч. будущий помощник/механик с `readiness.read`) выгружает полный список установок и нарядов-допусков тенанта файлом — это вынос данных за пределы экрана без отдельного полномочия. | Завести `readiness.*.export` для всех наборов (или один `readiness.export`) и выдать его тем же ролям, что сейчас, но осознанно; проверять его в `:28` наравне с audit. |
| 3 | важно | `src/app/api/reports/export/route.ts:18-86` | У GET-выгрузки отчётов нет ограничения частоты: `withApi` лимит не даёт (`rateLimiter.check` — только `withMutation`), а сам маршрут его не добавляет. `pile-passports/export:53` и `reports/pdf:244` свои лимиты имеют. | Запрос выгружает все отчёты за окно до 92 дней со всеми дочерними коллекциями (сваи, бурение, простои, фото-проверка). Серия параллельных выгрузок занимает процесс целиком; права достаточно у одной роли (ADMIN). | Добавить `rateLimiter.check` с ключом `reports-export:get:${user.id}` по образцу `pile-passports/export:28-59`. |
| 4 | мелочь | `src/app/api/reports/pdf/route.ts:223-231` | Ветка `jobId` (status/download) сводного PDF проверяет только `reports.read_all`, но не владельца задачи. В одиночном PDF та же ветка владельца проверяет: `single-pdf/route.ts:214-221`. | Один пользователь с `reports.read_all` может опросить/скачать PDF, поставленный другим. Содержимое — всё равно данные этого тенанта, а `jobId` — UUIDv4 (`pdf-queue.ts:170`), поэтому практический риск ниже. | Добавить проверку `getPdfJobOwnerId` по образцу `single-pdf/route.ts:214-221`. |
| 5 | мелочь | `src/lib/pdf-queue.ts:196-209` + `src/app/api/reports/pdf/route.ts:324-327` | `getPdfJobStatus` возвращает клиенту `result.filePath` — внутренний путь на диске или S3-ключ (`pdf-generator/storage.ts:29-40`). | Аутентифицированный пользователь видит структуру серверного хранилища временных PDF; полезно атакующему для дальнейших попыток. | Не отдавать `filePath` в API-ответе (оставить `jobId/fileSize/generatedAt`), путь — только в лог. |
| 6 | мелочь | `src/app/api/reports/single-pdf/route.ts:119` | В синхронном fallback имя файла строится из `context.report.user?.name` без обеззараживания, тогда как остальные маршруты санитизируют даты (`single-pdf:274`, `reports/pdf:139`). | Имя пользователя — произвольная строка из БД и уходит в заголовок `Content-Disposition`; кавычки/разделители ломают имя файла (характер значения зависит от среды ответа — не проверено). | Прогонять имя через белый список символов или заменить на `safeDate` (как в `:274`). |
| 7 | мелочь | `src/app/api/reports/pdf/route.ts:107-114` | У сводного PDF нет ограничения окна выгрузки (в `reports/export:12` стоит 92 дня), а генерация синхронная и в память собираются все отчёты периода. | Пользователь с `reports.read_all` может запросить период в годы; тяжёлая синхронная агрегация+PDFKit. Смягчено лимитом 20/5мин (`:26-30,244`). | Ввести то же окно 92 дня или переносить в очередь без синхронного рендера. |
| 8 | мелочь | `src/core/media/media-auth.ts:182-188` | Для чтения файлов установки (`entityType === 'equipment'`) правило требует только совпадения `tenantId`, без права `equipment.read`; путь загрузки (`:36-40`) это право требует. | Роль без `equipment.read` (напр. OPERATOR/ASSISTANT — их нет в `abilityRoles['equipment.read']`, `authorization-service.ts:103`) получает подписанную ссылку на скан паспорта/страховки/ОТС установки. Комментарий `:105-108` объявляет это намеренным («фото — общий актив тенанта»), но под `entityType 'equipment'` идут и документы. | Решить явно: либо сузить чтение документов установки до `equipment.read`, либо подтвердить намерение в комментарии отдельно для документов. |
| 9 | мелочь | `src/app/api/media/download-batch/route.ts:31-111` | Пакетная выдача ссылок без ограничения частоты (в отличие от PDF/журнала), потолок лишь `MAX_IDS = 100`. | Один запрос отдаёт до 100 подписанных ссылок; серия запросов дёшево генерирует много ссылок. | Добавить лимит частоты на пользователя, как у остальных выгрузок. |

Наблюдения-гипотезы (не подтверждены как дефект):

| # | status | path:line | Наблюдение |
|---|---|---|---|
| Г1 | ГИПОТЕЗА | `src/core/media/media-auth.ts:63-68` | `assertCanAccessMediaEntity` для `safety_incident`/`equipment_defect` пропускает любого не-привилегированного актора, проверяя только формат `entityId`, без сверки тенанта и существования сущности. Это путь загрузки (по замыслу — фото снимается до команды); подтверждение/владелец проверяются позже. Как дефект выгрузки не подтверждено. |
| Г2 | ГИПОТЕЗА | `src/core/media/media-auth.ts:193-199` | Для чтения медиа с `entityType`, не входящим в известный список (`report/inspection/maintenance/equipment`), не-привилегированный пользователь получает доступ только как владелец загрузки. Документы работника закрываются `ownsUserDocumentMedia` (`:164-175`). Проверено чтением кода, сценарии БД не воспроизводились. |
| Г3 | ГИПОТЕЗА | `src/app/api/reports/export/route.ts:30-32` | `siteId`/`userId`/`equipmentId` из query не валидируются как UUID, но подстановка чужого значения лишь сужает выборку в пределах тенанта (`report-export.service.ts:125`) — кросс-тенантного эффекта не даёт. |

## Не проверено

- **Реальные HTTP-запросы и БД.** Аудит только по коду: маршруты не запускались, тесты не гонялись,
  БД не читалась. Все «ПРОЙДЕНО» означают «фильтр присутствует в коде», а не «воспроизведено на данных».
- **Опубликованная матрица доступов организации.** Права контура готовности по умолчанию
  (`capability-defaults.ts`) могут быть переопределены публикацией матрицы (редактируется на ходу,
  `readiness/access-matrix-service.ts`). Что реально опубликовано в проде — не проверено.
- **Инъекция в Content-Disposition (#6).** Не проверено, отфильтрует ли `NextResponse`/undici
  управляющие символы в имени; вывод про «ломает имя файла» — по заголовку, без запуска.
- **Кросс-тенантный сценарий в проде.** Прод одно-тенантный (`orion`); риск #4 оценён как низкий
  именно поэтому. Поведение при втором тенанте не воспроизводилось.
- **Фронтенд.** Какие кнопки «Выгрузить» видны каким ролям на экранах (`src/components/**`) —
  не разбиралось; аудит по серверным маршрутам.
- **Лимиты частоты в Redis.** Наличие конфигурации `rateLimiter` подтверждено кодом; фактическая
  работа (ключи, окна, доступность Redis) не проверялась.
- **`ownsUserDocumentMedia` и админ-загрузки.** Логика чтения собственного документа работника
  прочитана, но сценарий «документ загрузил другой админ» на данных не воспроизводился.

Не читались (по условию задания): существующие отчёты в `docs/audits/`, `CODEX-REPORT*`,
`docs/strategy`. Замороженные зоны (экран оператора, ORION) пропущены.
