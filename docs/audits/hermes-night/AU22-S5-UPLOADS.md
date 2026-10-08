# AU22-S5: Загрузка файлов — проверки типа, размера и пути

Версия (git rev-parse HEAD): `6a3625ce119e58c86f9ae6028c45376ec01a1bd6`
Ветка: `hermes/q4-0926`. Аудит только на чтение; изменён только этот файл.

## Итог

- Проверки, заложенные в код, на месте и покрыты юнит-тестами: magic-bytes в
  `confirmUpload` (файл с чужим содержимым отвергается), жёсткий бакет-контроль
  размера на presign и на реальном объекте, ключ объекта собирается из
  серверных значений и не зависит от имени файла — path traversal через
  `fileName` закрыт. Тесты: `6 files / 68 tests passed`, exit 0.
- Всего находок: критично — 0, важно — 3, мелочь — 10. Импорта файлов в коде
  нет (загрузка только presigned-схемой), поэтому раздел «импорт» — про
  отсутствие пути.
- Топ-5:
  1. (важно) Рассинхрон дефолтов бакета: presign-запись в `pilingtrack-media`,
     а чтение/скачивание — в `pilingtrack`. При незаданном `S3_BUCKET` файлы
     грузятся в один бакет, а читаются из другого.
  2. (важно) `mediaId` у документа техники не проверяется вовсе — можно подшить
     несуществующий/чужой/незавершённый файл, в отличие от документов работника.
  3. (важно) Записи `uploadStatus='pending'` (обрыв загрузки после presign)
     никем не убираются — нет ни TTL, ни воркера; накапливаются бессрочно.
  4. (мелочь) `runRetention()` не вызывается ниоткуда — soft-deleted файлы и их
     объекты в S3 не удаляются никогда.
  5. (мелочь) `MediaService.getDownloadUrl()` содержит пустую проверку тенанта и
     нигде не используется — «спящая» ловушка, если её начнут звать.

## По пунктам задания (статусы)

| Вопрос | Ответ по коду | Файл:строка | Статус |
|---|---|---|---|
| Какие загрузки есть | Единственная схема: `POST /api/media` (presign) → PUT напрямую в S3/MinIO → `POST /api/media/[id]/confirm`. Server-роут байты файла не принимает (multipart/`formData()` в `src/` отсутствуют — поиск по `formData()`/`arrayBuffer()`/`multipart`/`busboy`/`multer` дал только PDF-хранилище). | `src/app/api/media/route.ts:19`, `src/app/api/media/[id]/confirm/route.ts:8` | ПРОЙДЕНО |
| Загрузки документов работника | Скан прикрепляется как `mediaId` при создании/правке документа; связка валидируется. | `src/services/users/user-document-access.ts:54-71`, `src/services/users/user-documents.ts:199` | ПРОЙДЕНО |
| Загрузки документов/фото техники | Фото — через ту же presign-схему (`entityType: 'equipment'`); документ прикрепляет `mediaId` без проверки. | `src/components/piling/monitoring/equipment-photo-upload.ts:8-32`, `src/modules/equipment/application/commands/equipment-document.ts:50` | ГИПОТЕЗА → см. F2 |
| Импорт | Маршрутов импорта файлов (xlsx/csv/bulk upload) в `src/app/api` не найдено. | поиск по `import/`/`bulk`/`upload` в `src/app` | ПРОЙДЕНО (пути нет) |
| Допустимые типы | Allowlist из 10 значения (`MEDIA_CONFIG.allowedContentTypes`), проверка точным сравнением строки на presign. | `src/core/media/media-content.ts:65-80`, `src/core/media/media-service.ts:106-111` | ПРОЙДЕНО |
| Как проверяется тип | Три уровня: (1) строка Content-Type против allowlist; (2) при confirm — реальные байты по сигнатурам (JPEG/PNG/GIF/WebP/HEIC-PDF/DOC/DOCX), fail-closed; (3) отказ → `uploadStatus='failed'`. Расширение выводится из contentType, не из имени файла. | `src/core/media/media-service.ts:266-272`, `src/core/media/media-content.ts:138-157`, `:98-112` | ПРОЙДЕНО |
| Предельный размер | Дефолт 10 МБ (`10485760`), переопределяется `MEDIA_MAX_FILE_SIZE`. | `src/core/media/media-content.ts:63-64`, `src/core/media/media-service.ts:508` | ПРОЙДЕНО |
| Где проверяется размер — клиент | Клиентская проверка у фото отчёта (10 МБ) и у плитки техники (12 МБ — расходится с сервером, F6). | `src/components/piling/report-form/photo-section.tsx:81-84`, `src/components/piling/monitoring/equipment-tile-asset-storage.ts:1,33-34` | ПРОЙДЕНО |
| Где проверяется размер — сервер | На presign: конечное положительное целое ≤ лимита; `ContentLength` вписывается в подпись PUT. На confirm: реальный `ContentLength` объекта, 413 при превышении. | `src/core/media/media-service.ts:118-130`, `:154-164`, `:224-240` | ПРОЙДЕНО |
| Где проверяется размер — прокси | В Caddy лимита тела нет, но он и не нужен: байты файла через прокси не идут (PUT напрямую в хранилище). | `deploy/Caddyfile.prod:52-54` | ПРОЙДЕНО |
| Ключ объекта / path traversal | `media/{tenant}/{entityType}/{entityId}/{uuid}{ext}`; tenant/type/id прогоняются через `safe()` (`[^a-zA-Z0-9_-]`→`_`, обрезка 80), расширение — из фиксированного map, `mediaId` — `crypto.randomUUID()`. `fileName` в ключ не входит. | `src/core/media/media-content.ts:166-176`, `src/core/media/media-service.ts:132-135` | ПРОЙДЕНО |
| Кто может скачать | Ссылку выдаёт `GET /api/media/[id]/download` (одиночный) и `GET /api/media/download-batch` (пачка) после `assertCanAccessMedia(...,'read')`; для документа работника — доп. проверка владельца. | `src/app/api/media/[id]/download/route.ts:26-39`, `src/app/api/media/download-batch/route.ts:64-65`, `src/core/media/media-auth.ts:136-149` | ПРОЙДЕНО |
| Как выдаётся ссылка | Presigned GET S3, TTL 3600 с (жёстко, не из конфига — F13), `Content-Disposition` не задаётся. | `src/app/api/media/[id]/download/route.ts:66-72` | ПРОЙДЕНО |
| Обрыв загрузки → pending | Строка `Media` создаётся со статусом `pending` ДО подписи URL; если клиент не вызвал confirm, строка остаётся `pending` навсегда (нет TTL/воркера). | `src/core/media/media-service.ts:139-152`, `:439-467` | ГИПОТЕЗА → F3 |

## Находки

| # | severity | path:line | Проблема | Почему важно / сценарий | Как чинить |
|---|---|---|---|---|---|
| F1 | важно | `src/core/media/media-service.ts:502` vs `src/app/api/media/[id]/download/route.ts:50`, `src/app/api/media/download-batch/route.ts:79`, `src/core/storage/s3-service.ts:45` | Три разных дефолта имени бакета при незаданном `S3_BUCKET`: запись (`pilingtrack-media`), чтение (`pilingtrack`), PDF (`pilingtrack-reports`) | Если `S3_BUCKET` не проброшен, presign-PUT уходит в один бакет, а подтверждение (confirm скачивает объект из `bucket` сервиса — тот же `pilingtrack-media`, ок) и выдача ссылок DOWNLOAD идут в `pilingtrack` → скачивание даёт 404/отсутствующий объект. Проявляется как «фото загрузилось, но не открывается» | Свести к одному дефолту (или требовать `S3_BUCKET` при старте, как в validate-env) |
| F2 | важно | `src/modules/equipment/application/commands/equipment-document.ts:50`, `:75` | `mediaId` документа техники пишется без проверки: существует ли файл, его тенант, `uploadStatus='completed'`, `isDeleted` | В отличие от документов работника (там есть `requireAttachableMedia`), здесь можно подшить несуществующий/чужой/незавершённый `mediaId`. Админ может сделать чужой приватный снимок (отчёт/документ другого работника) «документом установки», а фото техники читает вся организация (`media-auth.ts:182-191`) → потенциальная переклассификация приватного файла в общедоступный внутри тенанта | Ввести проверку как в `requireAttachableMedia`: тенант + `completed` + не `isDeleted`; для чужого файла — только ADMIN |
| F3 | важно | `src/core/media/media-service.ts:139-152`; отсутствие уборщика — воркеры `src/workers/**` `media` не трогают, `runRetention` (`:439`) фильтрует только `isDeleted` | `pending`-записи от оборванных загрузок не удаляются никогда (ни по TTL, ни шедулером) | Клиент, получив presign и оборвав загрузку, оставляет строку `pending` навсегда; каждое нажатие «загрузить» плодит новые. Рост таблицы и «фантомных» записей; лимита на число presign-запросов нет | Шедулер: удалять `pending` старше `urlExpiresIn`/суток; либо отдавать клиенту TTL и чистить по нему |
| F4 | мелочь | `src/core/media/media-service.ts:439-467` | `runRetention()` не вызывается ниоткуда (поиск `runRetention(`/`hardDelete(` в `src` — только определение) | Soft-deleted файлы (`isDeleted=true`) и их объекты в S3 не удаляются никогда: «отмена» с экрана освобождает UI, но не хранилище — рост бакета и БД | Вызвать из периодического воркера/крона либо удалять объект сразу при soft delete |
| F5 | мелочь | `src/core/media/media-service.ts:337-340` | `getDownloadUrl()` содержит пустышку: `if (media.tenantId) { /* In production: verify ... */ }` — проверка тенанта не реализована; метод нигде не вызывается (поиск `getDownloadUrl` — только определение) | Спящая ловушка: если метод начнут использовать (напр. в новом маршруте), проверка доступа будет «пройдена вхолостую» | Убрать метод или реализовать проверку; не оставлять комментарий-заглушку под видом защиты |
| F6 | мелочь | `src/components/piling/monitoring/equipment-tile-asset-storage.ts:1` vs `src/core/media/media-content.ts:64` | Клиентский лимит плитки техники — 12 МБ, серверный — 10 МБ | Файл 10–12 МБ пройдёт клиентскую проверку и получит внятное «Выбрать…», а затем упадёт на сервере 400 «Размер файла некорректен» — непонятная ошибка для пользователя | Привести клиентский лимит к `MEDIA_MAX_FILE_SIZE` |
| F7 | мелочь | `src/app/api/media/download-batch/route.ts:64-65` vs `src/app/api/media/[id]/download/route.ts:34` | Пакетная выдача ссылок не имеет fallback `ownsUserDocumentMedia`, который есть у одиночного маршрута | Свой документ, загруженный за работника администратором, откроется по одиночной ссылке, но его миниатюра в пакетном списке пропадёт (в `filterReadableMedia` он не проходит) — расхождение поведения | Либо добавить тот же fallback, либо не требовать его в списках (осознанно) |
| F8 | мелочь | `src/core/media/media-service.ts:233`, `:243`, `:267` | При отказе (413/422/несовпадение типа) строка помечается `failed`, но загруженный объект в S3 не удаляется (`DeleteObjectCommand` не вызывается) | Отвергнутая загрузка оставляет мусорный объект в хранилище навсегда | Удалять объект перед/после пометки `failed` |
| F9 | мелочь | `src/core/media/media-service.ts:139-152` vs `:162` | Строка создаётся ДО `getSignedUrl`; если подпись упадёт (circuit breaker), останется `pending`-строка без выданной ссылки | Мусорные записи при сбоях хранилища/сети | Создавать строку после успешной подписи либо удалять её в catch |
| F10 | мелочь | `prisma/schema.prisma:2722` (`fileName String`) | Длина `fileName` не ограничена ни схемой, ни zod в `POST /api/media` (`route.ts:27-37` проверяет только наличие) | Клиент может записать сколь угодно длинное имя в БД (в ключ оно не попадает, XSS закрыт экранированием React) | Ограничить длину (напр. `String @db.VarChar(...)` или zod `.max(255)`) |
| F11 | мелочь | `src/app/api/media/[id]/download/route.ts:66-72` | Presigned GET не привязан к пользователю (у кого ссылка — тот скачает в течение часа), `Content-Disposition` не задаётся | Ссылку можно переслать/залогировать; скачивание отдаётся inline без имени файла | Это стандартный компромисс presigned-схемы; при необходимости — короткий TTL и `ResponseContentDisposition` |
| F12 | мелочь | `src/modules/inspections/application/commands/inspection-commands.ts:247-256` | `countInspectionPhotos` считает снимки по `entityId` без фильтра `userId` | Наличие фото для обязательного пункта засчитывается по любому `completed`-снимку тенанта с таким `entityId`. Обычно создатель только один (проверка в `assertCanAccessMediaEntity` для `inspection`), но привилегированная роль может создать такой снимок за другого | Добавить `userId` в фильтр (как в `incidents.ts:145-154`) |
| F13 | мелочь | `src/app/api/media/[id]/download/route.ts:69`, `src/app/api/media/download-batch/route.ts:29` | TTL ссылок (3600) и лимит пачки (100) захардкожены в маршрутах, а не берутся из `MediaServiceConfig.urlExpiresIn` | Изменение конфига не влияет на фактический TTL выдачи | Читать из конфига сервиса или вынести константу в общее место |

## Что не проверено

- Проброс `S3_BUCKET`, `MEDIA_MAX_FILE_SIZE`, `CDN_BASE_URL` в контейнер `app`
  (`docker-compose*`) — не проверял: файлы объявлены off-limits в AGENTS.md §1.
  Отсюда F1 остаётся ГИПОТЕЗОЙ о поведении при незаданном `S3_BUCKET`; при
  корректно заданном env рассинхрон дефолтов не проявляется.
- Реальные сетевые лимиты хранилища (напр. `ContentLength` в подписи PUT против
  политики бакета R2/MinIO) — не проверено, нет доступа к S3.
- Значения `S3_BUCKET`/`MEDIA_MAX_FILE_SIZE` в `.env*` — не читал (запрет).
- Поведение exif/`sharp` на реальных HEIC-файлах — не проверено (нет образцов);
  по коду при сбое sharp оригинал всё равно сохраняется (`media-service.ts:298-302`).
- Визуальная проверка экранов загрузки — не проводилась (задача read-only,
  операторские экраны — замороженная зона).

## Методика (как повторить)

- `git rev-parse HEAD` → `6a3625ce119e58c86f9ae6028c45376ec01a1bd6`.
- Прочитаны целиком: `src/core/media/**` (3 модуля + 6 тестов), все 5 маршрутов
  `src/app/api/media/**`, `src/modules/equipment/.../equipment-document.ts`,
  `src/services/users/user-documents.ts`, `user-document-access.ts`,
  `src/modules/operator-mobile/application/commands/{shared,incidents}.ts`,
  `src/modules/inspections/.../inspection-commands.ts`, клиенты
  `equipment-photo-upload.ts`, `equipment-tile-asset-storage.ts`,
  `report-form/photo-section.tsx`, `lib/media-thumbnails.ts`, `next.config.ts`,
  `deploy/Caddyfile.prod`, `prisma/schema.prisma` (model Media).
- Поиски (reachability): `formData()|arrayBuffer()|multipart|writeFile|busboy|multer|formidable`
  по `src` (только PDF-хранилище); `mediaId|getPresignedUrl|confirmUpload|uploadStatus`
  по `src`; `getMediaService()`; `runRetention|hardDelete|softDelete`; `S3_BUCKET|pilingtrack*`;
  `import/|bulk|upload` по `src/app`.
- Тесты: `node node_modules/vitest/vitest.mjs run src/core/media` →
  `Test Files 6 passed (6)`, `Tests 68 passed (68)`, `EXIT=0`.
