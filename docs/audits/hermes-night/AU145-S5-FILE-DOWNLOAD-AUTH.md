# AU145-S5-FILE-DOWNLOAD-AUTH — скачивание файлов: права и срок ссылок

Версия (git rev-parse HEAD): `74ee1236523758d3fc37d59d5a1019810689527b`
Ветка: `hermes/q4-0926`. Только чтение; изменённых файлов нет (кроме этой заметки).
Область: маршруты, отдающие файл или ссылку на файл (media, экспорт CSV/XLSX, PDF).
Замороженные зоны (экран оператора, ORION) не открывались.

## Итог

- Всего найдено скачивающих маршрутов: **7**. Из них с подписанными ссылками S3 — 2 (media), с отдачей файла напрямую через приложение — 5 (два PDF, три выгрузки CSV/XLSX).
- По тяжести: **критично — 0, важно — 1, мелочь — 4.**
- Ни одного маршрута, где файл отдаётся по одному id **без аутентификации**, не найдено: везде вызывается `requireAuth`, отсутствие сессии даёт 401.
- Владелец ссылки на медиа-файл проверяется по-разному и в целом корректно (`assertCanAccessMedia`, `path:line` ниже). Срок подписи ссылки медиа — **3600 с** (жёстко в обоих media-маршрутах, совпадает с `DEFAULT_MEDIA_CONFIG.urlExpiresIn`).
- Главная находка (важно): у периодного отчёта `GET /api/reports/pdf?jobId=...&action=download` **нет проверки, чья это задача и какой организации**, — скачать файл может любой, у кого есть право `reports.read_all`, зная jobId. У соседнего одиночного маршрута такая проверка есть и покрыта регрессионным тестом.
- Топ-5: (1) периодный PDF-job без проверки владельца/тенанта; (2) media-маршруты жёстко задают TTL и создают свой S3-клиент мимо конфига/предохранителя; (3) `getDownloadUrl` в media-service содержит заглушку проверки организации (мёртвый код); (4) подписанная ссылка медиа после выдачи живёт как bearer 1 час; (5) у батч-скачивания медиа нет ограничения частоты.
- Прямых утечек внутри одной организации (однотенантный прод `orion`) по этим маршрутам не видно.

## Методика

Поиск по коду (read-only, никаких прогонов тестов не требовалось):
- каталог маршрутов: `search_files target=files pattern=route.ts path=src/app` — все обработчики лежат под `src/app/api/**`;
- файлы-ответы: `rg -n "Content-Disposition|application/pdf|text/csv|spreadsheetml|attachment" src/app/api`;
- источники байт/ссылок: `rg -n "getSignedUrl|GetObjectCommand|readFileSync|pdfBuffer|new Response\(" src`;
- владельцы PDF: `rg -n "downloadPdf|getPdfJobOwnerId|readPdfResult" src/app/api`;
- тенантность периодной выборки: `src/core/infrastructure/raw-queries.ts:55-72` (пустой tenantId → throw).
Дальше каждый маршрут открыт целиком через `read_file`; проверены цепочки прав
(`requireAuth` → `assertCan`/`assertCanAccessMedia`/`ensureTenantAccess`).

## Маршруты скачивания (карта)

| # | Маршрут | Проверка организации | Проверка роли/владельца | Срок ссылки | файл:строка |
|---|---------|----------------------|-------------------------|-------------|-------------|
| 1 | `GET /api/media/[id]/download` | `assertCanAccessMedia` (тенант строгим равенством; для equipment — обязателен) | read: админ/диспетчер, владелец записи, либо `reports.read_cross_user` по отчёту; фолбэк `ownsUserDocumentMedia` | 3600 с | src/app/api/media/[id]/download/route.ts:26-39, :66-72 |
| 2 | `GET /api/media/download-batch` | `filterReadableMedia` — тот же `assertCanAccessMedia` на каждую строку | как в №1, недоступные строки молча выбрасываются | 3600 с | src/app/api/media/download-batch/route.ts:55-68, :95-110 |
| 3 | `GET /api/reports/pdf` (sync) | `buildPeriodPdfData` с tenantId сессии; пустой → отказ (raw-queries:69) | `assertCan('reports.read_all')` | нет ссылки (буфер), лимит 20/5 мин | src/app/api/reports/pdf/route.ts:192-201, :240-299 |
| 4 | `GET /api/reports/pdf?jobId&action=download` | **НЕТ** (тенант задачи не читается) | только `assertCan('reports.read_all')` | нет ссылки; файл живёт до чистки | src/app/api/reports/pdf/route.ts:222-231, :341-362 |
| 5 | `GET /api/reports/single-pdf` (sync) | `ensureTenantAccess` + `assertCanAccessReportOwner` | владелец отчёта или `reports.read_cross_user` | нет ссылки, лимит 20/5 мин | src/app/api/reports/single-pdf/route.ts:257-267 |
| 6 | `GET /api/reports/single-pdf?jobId&action=download` | проверка владельца задачи (`getPdfJobOwnerId`) + fail-closed при отсутствии задачи | владелец или `reports.read_cross_user` | нет ссылки, лимит 60/мин | src/app/api/reports/single-pdf/route.ts:214-221, :332-353 |
| 7 | `GET /api/reports/export` | `requireTenantId` (бросок при пустом) | `assertCan('reports.export')` = только ADMIN | нет ссылки (буфер) | src/app/api/reports/export/route.ts:24-27, :68-84 |
| 8 | `GET /api/pile-passports/export` | `requireTenantId` | `assertCan('piles.manage')`, лимит 6/мин | нет ссылки | src/app/api/pile-passports/export/route.ts:53-64, :77-93 |
| 9 | `GET /api/readiness/export` | tenantId из контекста (`resolveReadinessRequestContext`) | capability `readiness.read` / `readiness.audit.export` | нет ссылки, `cache-control: no-store` | src/app/api/readiness/export/route.ts:27-33, :157-167 |

Строки 1-9 — это полный перечень маршрутов, отдающих файл/ссылку (по поиску выше; других `route.ts` вне `src/app/api` нет). `briefings/[id]/sign` и `to/journal` проверены — это JSON-записи, не выгрузка файла.

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|----------|-----------|----------|-------------------------|--------------------------|
| 1 | важно | src/app/api/reports/pdf/route.ts:222-231, :341-362 | В ветке `GET ?jobId=&action=download` нет проверки владельца задачи и организации: только `assertCan('reports.read_all')`. Соседний `single-pdf` такую проверку делает (`getPdfJobOwnerId` + `assertCanAccessReportOwner`, src/app/api/reports/single-pdf/route.ts:214-221). | Любой, у кого есть `reports.read_all` (сейчас ADMIN, DISPATCHER; позже FOREMAN/SAFETY_ENGINEER получат людей — authorization-service.ts:64), скачав jobId, получит периодный PDF, собранный другим пользователем, в т.ч. другого тенанта. jobId — случайный UUID, значит нужна утечка id (ссылка в UI, лог, реферер), но сама проверка бесплатна и уже есть у братского маршрута. Скоуп: прод однотенантный, ADMIN/DISPATCHER по решению владельца видят все тенанты → реальная экспозиция «до появления тенанта №2» + когда мастер/инженер ОТ получат живых пользователей. | Повторить в периодном маршруте защиту из single-pdf: импортировать `getPdfJobOwnerId`, при найденной задаче проверять владельца, при отсутствии — `assertCan('reports.read_cross_user')`. |
| 2 | мелочь | src/app/api/media/[id]/download/route.ts:41-70 ; src/app/api/media/download-batch/route.ts:70-79, :99 | TTL подписи `expiresIn: 3600` и учётные данные S3 заданы жёстко в маршруте; создаётся собственный `S3Client` в обход `s3CircuitBreaker` и настроек `media-service`. | Дублирование источника правды: смена `urlExpiresIn`/конфига медиа не изменит эти маршруты; отсутствие предохранителя — падение хранилища бьёт напрямую по запросу. Срок 3600 с сейчас совпадает со `DEFAULT_MEDIA_CONFIG.urlExpiresIn` (src/core/media/media-content.ts:60,82) — расхождения пока нет, но гарантий нет. | Брать TTL/клиент из общей конфигурации медиа (`DEFAULT_MEDIA_CONFIG`/`media-service`), использовать предохранитель, как в остальном коде медиа. |
| 3 | мелочь (ГИПОТЕЗА) | src/core/media/media-service.ts:337-340 | В `getDownloadUrl` «проверка организации» — это комментарий без кода: `if (media.tenantId) { /* In production: verify ... */ }`. Фактической сверки нет. | Потенциальная утечка между тенантами, если метод начнут вызывать: он отдаёт подписанную ссылку без сверки тенанта. Сейчас **мёртвый код** — `getDownloadUrl` не вызывается ни одним маршрутом (поиск `rg "getDownloadUrl" src` дал единственное совпадение — само определение). Не удаляю (AGENTS §4), фиксирую как заготовку с вводящим в заблуждение комментарием. | Либо реализовать сверку строгим равенством и закрытием при отсутствии тенанта, либо убрать заглушку/метод (решение владельца). |
| 4 | мелочь | src/app/api/media/[id]/download/route.ts:66-72 | Подписанная ссылка медиа после выдачи = bearer-URL на 1 час, не привязанный к пользователю/сессии. | Пока ссылка жива, она не проверяет ни роль, ни отзыв сессии: пересланный URL скачает файл любой, у кого он есть. Это стандартный компромисс presigned-схемы; важно понимать при выдаче ссылок на документы работников. | Оставить как есть или сократить TTL для чувствительных типов (документы) — решение владельца. |
| 5 | мелочь | src/app/api/media/download-batch/route.ts:45-53 | У батч-выдачи нет ограничения частоты (GET через `withApi`, лимит есть только у `withMutation`), до 100 id за запрос. | Аутентифицированный пользователь может долбить маршрут подписью ссылок пачками; перебора UUID это не даёт (128-бит), но нагружает S3/CPU без потолка. | Добавить лимит по образцу `/api/pile-passports/export` (ключ `media:batch:<user>`). |

## ПРОЙДЕНО

- Периодная выборка данных fail-closed по тенанту: пустой tenantId → `ServiceError` 403 (src/core/infrastructure/raw-queries.ts:69-72); вызовы — src/app/api/reports/pdf/route.ts:107-114, src/app/api/reports/period/route.ts:52.
- `single-pdf` (jobId) — проверка владельца задачи и fail-closed при удалённой задаче (src/app/api/reports/single-pdf/route.ts:214-221); покрыта тестом src/app/api/reports/single-pdf/__tests__/route.test.ts:82-155.
- Батч медиа не сообщает о существовании недоступных id (молча выброс) — src/core/media/media-auth.ts:136-149.
- `reports/export` (только ADMIN, `reports.export`) и `pile-passports/export` (ADMIN/DISPATCHER/FOREMAN, `piles.manage`) требуют `requireTenantId` — organization обязательна.
- `readiness/export` требует capability и ставит `cache-control: no-store` — src/app/api/readiness/export/route.ts:28-31, :162.
- Всем маршрутам скачивания предпослан `requireAuth`; без сессии — 401.

## Не проверено

- **НЕ ПРОВЕРЕНО:** фактическая выдача подписанных ссылок против реального S3/R2 (нет доступа к хранилищу и `.env` не читаются) — поведение выведено из кода `@aws-sdk/s3-request-presigner`, `expiresIn` = 3600.
- **НЕ ПРОВЕРЕНО:** сквозное поведение `withApi`-кеша для этих маршрутов — `cache` не задан ни в одном из них (src/core/api-wrapper.ts:86-106), значит кеш не задействован; но прогонять не стал.
- **НЕ ПРОВЕРЕНО:** существует ли уникальность `reportId` между тенантами в схеме Prisma — `loadSingleReportPdfContext` ищет по `reportId` без тенанта (src/lib/pdf-data.ts:233-234), а тенант проверяется после загрузки (route.ts:263). Схему (`prisma/schema.prisma`) не открывал по ограничению задачи.
- **НЕ ПРОВЕРЕНО:** реальный TTL/чистка объектов PDF в хранилище — видел только `RESULTS_TTL` Redis = 3600 с (src/lib/pdf-queue.ts:30) и опциональный cleanup (src/lib/pdf-generator/storage.ts:9-10); на сервере не проверялось.
- **ГИПОТЕЗА:** экспозиция находки №1 зависит от того, получат ли живое развёртывание роли FOREMAN/SAFETY_ENGINEER (сейчас «нет пользователей по дизайну», AGENTS §3) — код-путь без этого упирается в ADMIN/DISPATCHER, которые по решению владельца видят все тенанты.
- Не открывал существующие отчёты в `docs/audits/`, CODEX-REPORT*, `docs/strategy` (по условию задачи).
