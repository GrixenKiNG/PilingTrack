# AU211-S2-INSPECTION-PHOTO-EVIDENCE — Фото в осмотрах и дефектах

Версия: `git rev-parse HEAD` = `6a3ee315524661dab3d18ef6653f1da8f0f56a21`
Ветка: `hermes/q4-0926`. Только чтение; код приложения не изменялся.

## Итог

Один канал загрузки фото (Media + presigned S3), но два несогласованных потребителя: осмотр через `/api/inspections` и чек-лист оператора через `operator-mobile`.

Итог по серьёзности: **критично — 0, важно — 3, мелочь — 6.**

Топ-5:
1. **важно** — дефект, заведённый завершением осмотра (`/api/inspections`), сохраняется **без фото-доказательств**: `evidenceMediaIds` не заполняется, хотя фото в Media есть (`src/modules/inspections/application/commands/inspection-commands.ts:472`).
2. **важно** — `EquipmentDefect.evidenceMediaIds` **не читает никто** в коде (нет ни одного читателя), а `serializeDefect`/`DefectDto` его не отдают: фото дефекта, загруженное чек-листом оператора, не отображается нигде (`src/modules/readiness/application/defects/commands.ts:26`, `src/components/piling/to/readiness/api/contracts.ts:195`).
3. **важно** — политика хранения `runRetention` **никогда не вызывается** (0 вызовов): удалённые и «зависшие» (`pending`) файлы не вычищаются ни из БД, ни из S3 (`src/core/media/media-service.ts:439`).
4. **мелочь** — `download` отдаёт ссылку на оригинал **без проверки, что объект в S3 существует** (проверяется только миниатюра): потерянный файл даёт молча битую картинку вместо сообщения (`src/app/api/media/[id]/download/route.ts:56`).
5. **мелочь** — нет лимита на **количество** фото к пункту/дефекту/происшествию; ограничен только размер файла (`src/components/piling/inspections/inspection-item-photos.tsx:113`, `src/modules/operator-mobile/application/commands/shared.ts:343`).

Для владельца (5 строк):
- Фото грузятся в S3 напрямую, сервер выдаёт разовую ссылку и потом проверяет, что файл долетел и это действительно картинка — этот путь работает и проверен кодом.
- Но у дефектов две независимые дороги: заведённый из осмотра дефект остаётся без снимков, а у дефекта из чек-листа снимки есть в базе, только их нигде не видно.
- Файлы, которые оператор удалил, и загрузки, которые оборвались, никто и никогда не удаляет из хранилища — место на диске растёт бесконечно.
- Если файл в хранилище пропал (чистка бакета, смена бакета), экран показывает битую картинку без объяснения.
- Количество снимков к одному пункту не ограничено — один пункт может утащить в хранилище сколько угодно файлов по 10 МБ.

## Методика

Что искал и как (воспроизводимо):

```
rg -n "photo|Photo|attachment|upload|imageUrl|fileUrl|storage" src
rg -n "photoCount|evidenceMediaIds|entityType: 'inspection'|entityType === 'inspection'" src
rg -n "equipment_defect|safety_incident" src --glob '!**/__tests__/**'
rg -n "runRetention|hardDelete|softDelete|isDeleted" src
rg -n "evidenceMediaIds" src e2e tests
```

Прочитанные файлы-источники канала фото (полные пути от корня):
`prisma/schema.prisma` (модели `Media`:2720, `InspectionAnswer`:1587, `EquipmentDefect`:658, `SafetyIncident`:1298);
`src/core/media/media-service.ts`, `src/core/media/media-content.ts`, `src/core/media/media-auth.ts`;
`src/app/api/media/route.ts`, `src/app/api/media/[id]/confirm/route.ts`, `src/app/api/media/[id]/route.ts`, `src/app/api/media/[id]/download/route.ts`, `src/app/api/media/download-batch/route.ts`;
`src/components/piling/inspections/inspection-item-photos.tsx`, `run-inspection.tsx`;
`src/modules/inspections/application/commands/inspection-commands.ts`, `src/modules/inspections/domain/defect-rules.ts`, `src/modules/inspections/domain/inspection-logic.ts`;
`src/modules/operator-mobile/application/commands/checklist.ts`, `shared.ts`, `incidents.ts`, `src/modules/operator-mobile/domain/checklist-run.ts`, `src/components/piling/operator-mobile/api.ts`;
`src/modules/readiness/application/defects/commands.ts`, `schemas.ts`, `src/modules/readiness/infrastructure/defects/defect-repository.ts`, `src/components/piling/to/readiness/api/contracts.ts`;
`src/app/api/inspections/route.ts`, `src/app/api/inspections/[id]/route.ts`, `src/app/api/inspections/[id]/complete/route.ts`.
Тестовое покрытие проверено: `e2e/*.spec.ts` (19 файлов), `src/core/media/__tests__/` (6 файлов), `src/modules/inspections/application/commands/__tests__/inspection-commands.test.ts`.

## Схема канала: шаг | файл:строка | проверка | риск

| Шаг | Файл:строка | Проверка | Риск |
| --- | --- | --- | --- |
| 1. Выбор файла (осмотр) | `src/components/piling/inspections/inspection-item-photos.tsx:99` | `contentType.startsWith('image/')`, размер ≤ 10 МБ (клиентская константа) | Лимит продублирован клиентом, не читается из env | ПРОЙДЕНО |
| 2. Запрос ссылки | `src/app/api/media/route.ts:19` | `withMutation` (CSRF+rate limit) + `requireAuth` | — | ПРОЙДЕНО |
| 3. Доступ к объекту | `src/core/media/media-auth.ts:86` | `entityType='inspection'`: по `entityId.split('__')[0]`; не свой осмотр → 403 | Композитный id тащит логику извлечения inspectionId | ПРОЙДЕНО |
| 4. Проверка размера/типа (сервер) | `src/core/media/media-service.ts:104` | `fileSize` — целое > 0 и ≤ `maxFileSize`; тип из allowlist | `MEDIA_MAX_FILE_SIZE` парсится `parseInt` без проверки на NaN (лимит может исчезнуть) | ГИПОТЕЗА |
| 5. Загрузка в S3 | `src/components/piling/inspections/inspection-item-photos.tsx:127` | Прямой `PUT` на presigned URL, минуя сервер | Сервер не видит реальный размер до confirm | ПРОЙДЕНО |
| 6. Подтверждение | `src/app/api/media/[id]/confirm/route.ts:8` + `media-service.ts:180` | Скачивание объекта, повторная проверка размера, magic-bytes, миниатюра | Таймаут 30 с; при сбое миниатюры запись всё равно `completed` | ПРОЙДЕНО |
| 7. Чтение галереи | `src/app/api/media/route.ts:63` + `media-service.ts:419` | `listByEntity`: `uploadStatus='completed'`, `isDeleted=false`, строго по tenant | Отказ (403/500) ≠ «фото нет» — обработано на клиенте | ПРОЙДЕНО |
| 8. Подсчёт при сохранении ответов | `src/modules/inspections/application/commands/inspection-commands.ts:240` | `groupBy` по Media, клиентский `photoCount` игнорируется | — | ПРОЙДЕНО |
| 9. Гейт завершения осмотра | `inspection-commands.ts:346` + `src/modules/inspections/domain/inspection-logic.ts:49` | ЕО требует фото только на неисправности; ТО — везде | Гейт считает **любой** `completed`-файл, не только `image/*` | мелочь |
| 10. Дефект из осмотра (API) | `inspection-commands.ts:472` | `equipmentDefect.create` без `evidenceMediaIds` | **Фото к дефекту не прикладываются** | важно |
| 11. Дефект из чек-листа оператора | `src/modules/operator-mobile/application/commands/checklist.ts:214` | Пишет `evidenceMediaIds: draft.mediaIds` после `requireConfirmedImages` | Фото есть в БД, но не отображается | важно |
| 12. Валидация снимков чек-листа | `src/modules/operator-mobile/application/commands/shared.ts:343` | `entityType='equipment_defect'`, `entityId='${clientCommandId}:${itemId}'`, image/*, completed | Проверяет и тип, и привязку пункт↔файл | ПРОЙДЕНО |
| 13. Снимки происшествия | `src/modules/operator-mobile/application/commands/incidents.ts:141` | `entityType='safety_incident'`, image/*, completed, владелец | Счётчик снимков показывается в списке происшествий | ПРОЙДЕНО |
| 14. Удаление фото | `src/app/api/media/[id]/route.ts:9` + `media-service.ts:362` | Soft-delete + audit | Только БД; объект в S3 остаётся | мелочь |
| 15. Политика хранения | `src/core/media/media-service.ts:439` | `runRetention` hard-delete | **0 вызовов во всём репозитории** | важно |
| 16. Отдача файла | `src/app/api/media/[id]/download/route.ts:41` | Presigned URL; существование проверяется только для миниатюры | Оригинал может 404 у S3 → битая картинка | мелочь |

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
| --- | --- | --- | --- | --- | --- |
| 1 | важно | `src/modules/inspections/domain/defect-rules.ts:30`, `src/modules/inspections/application/commands/inspection-commands.ts:472` | `PlannedDefect` не несёт `mediaIds`, а `equipmentDefect.create` не задаёт `evidenceMediaIds` (остаётся `"[]")` | Механик на ТО сфотографировал трещину (фото лежит в Media с `entityType='inspection'`), осмотр завершён, дефект заведён — а в журнале дефектов доказательства нет: `evidenceMediaIds=[]`. Фото «потеряно» для разбора, хотя физически существует | При заведении дефекта из осмотра прокидывать id подтверждённых снимков пункта и писать в `evidenceMediaIds` |
| 2 | важно | `src/modules/readiness/application/defects/commands.ts:26`, `src/components/piling/to/readiness/api/contracts.ts:195`, `src/modules/readiness/infrastructure/defects/defect-repository.ts:63` | `EquipmentDefect.evidenceMediaIds` не возвращает `serializeDefect` и не содержит `DefectDto`; `rg evidenceMediaIds` даёт **ни одного читателя** для дефектов | Фото, загруженное мобильным чек-листом (единственный путь, который их пишет — `checklist.ts:226`), нигде не видно: ни в панели дефектов readiness, ни в отчётах. Аудит-требование «показать доказательство» не выполняется, файл есть — экрана нет | Добавить `evidenceMediaIds` в `serializeDefect`/`DefectDto` и отрисовать галерею в `src/components/piling/to/readiness/screens/defects-panel.tsx` |
| 3 | важно | `src/core/media/media-service.ts:439` | `runRetention()` не вызывается нигде: `rg -n "runRetention" src scripts` → единственное совпадение — определение | Удалённые (soft-delete) фото и «зависшие» загрузки (оборвался PUT/confirm → `uploadStatus='pending'`) остаются в БД и в S3 навсегда. Брошенный черновик осмотра (`entityType='inspection'` без завершения) не чистится: его `isDeleted=false`, поэтому `runRetention` его бы и не тронул | Вызывать `runRetention` из воркер-джобы; добавить уборку `pending`-записей старше N часов |
| 4 | мелочь | `src/app/api/media/[id]/download/route.ts:56` | Проверка `HeadObject` есть только для миниатюры; для оригинала ссылка подписывается без проверки наличия объекта | Если объект пропал из бакета (политика жизненного цикла, смена бакета, ручная чистка), а строка Media осталась `completed`, экран (`inspection-item-photos.tsx:230`) отрисует битую картинку с `unoptimized` — без сообщения | Проверять `HeadObject` для итогового ключа и на 404 возвращать понятную ошибку (как при `thumb`) |
| 5 | мелочь | `src/components/piling/inspections/inspection-item-photos.tsx:113`, `src/modules/operator-mobile/application/commands/shared.ts:343`, `src/modules/operator-mobile/application/commands/incidents.ts:141` | Лимит только на размер файла; число снимков на пункт/дефект/происшествие не ограничено | Оператор может приложить сколько угодно файлов по 10 МБ к одному пункту — неограниченный рост хранилища и трафика; в UI кнопка «Ещё фото» без потолка | Ввести max-счётчик на сущность (клиент + сервер) |
| 6 | мелочь | `src/modules/inspections/application/commands/inspection-commands.ts:247` | `countInspectionPhotos` не фильтрует `contentType`; presign allowlist включает `application/pdf`/`.doc`/`.docx` (`src/core/media/media-content.ts:71`) | Обязательное «фото» пункта можно закрыть PDF-документом: гейт завершения осмотра считает любой `completed`-файл с нужным `entityId` и не проверяет, что это изображение | Добавить `contentType: { startsWith: 'image/' }` в фильтр подсчёта (или в media-auth для `inspection`) |
| 7 | мелочь | `src/core/media/media-service.ts:404` | `hardDelete` удаляет строку БД, даже если удаление объекта из S3 упало (ошибка только логируется) | При сбое S3 строка Media исчезает, а объект остаётся «мусором» в бакете; ссылки (например `evidenceMediaIds`) повисают | Не удалять строку, если S3-удаление не подтвердилось (или помечать `purgeFailed`) |
| 8 | мелочь | `src/components/piling/inspections/inspection-item-photos.tsx:106` | Лимит 10 МБ продублирован константой на клиенте; сервер читает `MEDIA_MAX_FILE_SIZE` (`src/core/media/media-service.ts:508`) | При смене лимита через env клиент останется на 10 МБ — рассинхрон поведения «не загрузится/загрузится» | Отдавать лимит клиенту (например, в ответе presign) вместо хардкода |
| 9 | мелочь | `src/components/piling/operator-mobile/api.ts:658` vs `src/core/media/media-auth.ts:87` | Два формата композитного `entityId`: `'${clientCommandId}:${itemId}'` (оператор) и `'${inspectionId}__${itemId}'` (осмотр) | Разные разделители и разные `entityType` для одной по смыслу задачи «фото пункта» повышают шанс ошибки при добавлении третьего потребителя | Унифицировать конвенцию (документировать один формат) |
| 10 | мелочь | `prisma/schema.prisma:2781` | Модель `ReportPhoto` объявлена и есть в миграциях, но `rg ReportPhoto src` → 0 использований; фото отчётов идут через `Media` (`src/modules/reports/application/queries/report-query.service.ts:178`) | Мёртвая схема вводит в заблуждение; удалять нельзя без доказательства (правило AGENTS §4), но стоит зафиксировать | Пометить как «не используется»; решение об удалении — за владельцем |

## Не проверено

- **Реальные env-значения** `MEDIA_MAX_FILE_SIZE`, `CDN_BASE_URL`, `S3_BUCKET`, `S3_ENDPOINT` — правило AGENTS запрещает читать `.env*`; выводы о лимите сделаны из дефолтов кода (`src/core/media/media-service.ts:508`, `media-content.ts:63-64`). В `.env.production.example` эти переменные не проброшены — не проверено, заданы ли они на проде.
- **Фактическое наполнение хранилища**: есть ли уже потерянные/осиротевшие объекты (пункт 3, 4) — не проверено, доступа к S3/БД нет.
- **Живой путь загрузки** end-to-end (presign → PUT → confirm) в этом окружении не запускался: не поднимал сервер и MinIO. Оценка построена на чтении кода. Покрытие e2e: `rg "photo|media|entityType" e2e/` даёт только комментарий в `e2e/inspection-to-flow.spec.ts:113` — **автотеста на загрузку фото в канале осмотра нет** (НЕ ПРОВЕРЕНО иначе, чем чтением).
- **Роль MECHANIC / права `maintenance.manage`**: чтение фото чужого осмотра в `src/core/media/media-auth.ts:95` зависит от `can(actor,'maintenance.manage')`; соответствует ли фактическая матрица ролей ожиданию — не проверено (матрица публикуется в БД на ходу, `readiness-access-matrix`).
- **Пункты 1–2**: подтверждено чтением кода и `rg`; динамические вызовы (`element.property`) не исключены, но для `evidenceMediaIds` текстовый поиск дал полный список и читателя нет.
- Не проверял `src/services/upload-*`/`src/app/api/uploads` — таких путей в репозитории нет (`ls` пусто), единственный канал — `/api/media`.
