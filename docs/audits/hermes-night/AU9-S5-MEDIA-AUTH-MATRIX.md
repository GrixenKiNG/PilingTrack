# AU9-S5-MEDIA-AUTH-MATRIX — матрица доступа к медиа и вопрос M7

Версия кода: `git rev-parse HEAD` = **52359d07eac753ec8957eaa175c8789888a0e98d** (ветка `hermes/q4-0926`, дерево чистое).

Область: `src/core/media/media-auth.ts` (200 строк) и все маршруты `src/app/api/media/**` (5 файлов, 556 строк суммарно с media-auth). Только чтение; приложение не менялось.

## Итог

- Построена матрица «сущность × действие × роль» по коду; ключевая точка — 2 разные функции проверки: `assertCanAccessMediaEntity` (выдача URL на загрузку и список) и `assertCanAccessMedia` (существующая запись: confirm/delete/download).
- Находка M7 подтверждена: ветка `report` (`media-auth.ts:50-53`) ищет отчёт по `OR [{id},{reportId}]` **без** фильтра организации. Чужой отчёт и несуществующий различимы по ответу: чужой → 403 «Нет доступа» (`:56`), несуществующий → пропуск (`:54`). Это oracle существования, работающий и внутри одной организации. Статус **ПРОЙДЕНО** (поведение подтверждено кодом и тестом `media-auth.test.ts:99-109`).
- Второй независимый пробел: `safety_incident` / `equipment_defect` (`media-auth.ts:63-68`) пропускают любого непривилегированного актора по формату id — без роли, владельца, организации и без проверки существования команды.
- Всего находок: **критично — 0, важно — 3, мелочь — 6** (9 штук). Кросс-организационный характер M7 делает его «критично перед тенантом #2», но в проде один тенант — сейчас «важно».
- Самый важный пункт: M7 — oracle существования отчёта по организации наружу (`media-auth.ts:50-56`), закрывается одной строкой.

## Методика

Что и как искал (повторяемо):

1. Прочитаны целиком (read_file): `src/core/media/media-auth.ts`, `src/core/media/media-service.ts`, все 5 маршрутов `src/app/api/media/**`, `src/services/auth/authorization-service.ts`, `src/lib/types.ts` (resolveEffectiveRole), `src/lib/tenant.ts` (requireTenantId).
2. Модели БД: `prisma/schema.prisma` — `model Report` (строки 1927-1987), `model Media` (2720-2747) — читал `read_file` с offset.
3. Поиск потребителей: `search_files` по `assertCanAccessMedia*`, `filterReadableMedia`, `ownsUserDocumentMedia`, `entityType`, `media.upload`, `db.media.findUnique/findMany`, `getDownloadUrl`.
4. Команды (вывод — числа из них):
   - `git rev-parse HEAD` → 52359d07eac753ec8957eaa175c8789888a0e98d
   - `git log -1 --format='%H %ci'` → 52359d07eac753ec8957eaa175c8789888a0e98d 2026-10-09 01:07:05 +0300
   - `wc -l src/core/media/media-auth.ts src/app/api/media/route.ts src/app/api/media/[id]/route.ts src/app/api/media/[id]/download/route.ts src/app/api/media/[id]/confirm/route.ts src/app/api/media/download-batch/route.ts` → 200, 89, 43, 75, 36, 113
   - `ls src/app/api/media` → `[id]`, `download-batch`, `route.ts`
5. Все `path:line` в отчёте проверены открытием файла (номера строк существуют).

Сущности, реально встречающиеся в коде как `entityType`: `report`, `equipment`, `inspection` (`inspection-commands.ts:251`), `maintenance` (в route select — `[id]/confirm/route.ts:20`), `safety_incident` (`operator-mobile/.../incidents.ts:150`), `equipment_defect` (`operator-mobile/.../shared.ts:356`). Значение `site` упомянуто только в комментарии схемы (`schema.prisma:2731`), кода, который пишет медиа с `entityType:'site'`, не найдено (см. Н4).

## Матрица доступа

Роли: А=ADMIN, Д=DISPATCHER, О=OPERATOR, Ас=ASSISTANT, М=MECHANIC, Ма=FOREMAN (Мастер), ИО=SAFETY_ENGINEER (Инженер ОТ). Роли считаются по ИСПОЛНЯЕМОЙ роли (`resolveEffectiveRole`, `types.ts:74-76`).

### 1) `assertCanAccessMediaEntity(actor, entityType, entityId, 'read'|'mutate')` — загрузка URL (POST /api/media) и список (GET /api/media)

| сущность | действие | А | Д | О | Ас | М | Ма | ИО | правило (path:line) |
|---|---|---|---|---|---|---|---|---|---|
| equipment | read | ✔ | ✔ (нужен tenantId + `equipment.read`) | ✘ | ✘ | ✔ | ✘ | ✔ | `media-auth.ts:37` (иначе нужен ADMIN `:38`) |
| equipment | mutate | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | `media-auth.ts:38` — только ADMIN |
| report | read | ✔ | ✔ | своя/черновик ✔, чужая ✘ | — | своя/черновик ✔, чужая ✘ | ✔ (чужая своего тенанта, `reports.read_cross_user`) | ✔ (то же) | `media-auth.ts:42,50-57` |
| report | mutate | ✔ | ✔ | своя/черновик ✔, чужая ✘ | чужая ✘ | своя/черновик ✔, чужая ✘ | своя ✔, чужая ✘ | своя ✔, чужая ✘ | `media-auth.ts:56` |
| safety_incident | read/mutate | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | `media-auth.ts:63-68` — только формат id |
| equipment_defect | read/mutate | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | `media-auth.ts:63-68` — только формат id |
| maintenance | read/mutate | ✔ | ✔ | ✘ | ✘ | ✔ | ✘ | ✔ | `media-auth.ts:79-81` — нужен tenantId + `maintenance.manage` |
| inspection | read | ✔ | ✔ | своя ✔, чужая ✘ | ✘ | ✔ (через `maintenance.manage`) | ✘ | ✔ | `media-auth.ts:86-97` |
| inspection | mutate | ✔ | ✔ | своя ✔, чужая ✘ | ✘ | своя ✔, чужая ✘ | ✘ | ✘ | `media-auth.ts:96` |
| site / прочее | люб. | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | `media-auth.ts:100` (`site` не поддержан) |
| — без entityType/entityId | люб. | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | `media-auth.ts:44-46` (400) |

А=ADMIN/Д=DISPATCHER проходят раньше ветки report на `media-auth.ts:42` (`isPrivilegedRole`) — в базу не ходят (подтверждено тестом `media-auth.test.ts:89-92`).

### 2) `assertCanAccessMedia(actor, media, 'read'|'mutate')` — существующая запись: confirm/delete (mutate), download/download-batch (read)

| сущность | действие | А | Д | О | Ас | М | Ма | ИО | правило |
|---|---|---|---|---|---|---|---|---|---|
| equipment | read | ✔ (нужен tenantId, сверка организации) | ✔ | ✔ (свой тенант) | ✔ (свой тенант) | ✔ | ✔ | ✔ | `media-auth.ts:182-188` — только равенство тенанта |
| equipment | mutate | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | `media-auth.ts:189` |
| report | read | ✔ | ✔ | загрузивший ✔; чужую того же тенанта ✘ | ✘ | загрузивший ✔ | загрузивший ✔ / `read_cross_user` ✔ | ✔ | `media-auth.ts:194-198` |
| report | mutate | ✔ | ✔ | загрузивший ✔ | только загрузивший | загрузивший ✔ | загрузивший ✔ | загрузивший ✔ | `media-auth.ts:194,199` |
| inspection/maintenance | read/mutate | ✔ | ✔ | загрузивший ✔ | только загрузивший | `maintenance.manage` ✔ | загрузивший ✔ | ✔ | `media-auth.ts:195-197` |
| safety_incident/equipment_defect | read/mutate | ✔ | ✔ | загрузивший ✔ | только загрузивший | загрузивший ✔ | загрузивший ✔ | загрузивший ✔ | `media-auth.ts:194,199` (нет ветки `read_cross_user`) |

Общая точка отсечения: `isPrivilegedRole` (`media-auth.ts:193`) пропускает ADMIN/DISPATCHER **до** любой проверки тенанта — платформенное поведение по модели доверия AGENTS.md.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| Н1 (M7) | важно (критично перед тенантом #2; oracle работает и внутри одного тенанта) | `src/core/media/media-auth.ts:50-56` | Запрос отчёта ведёт `findFirst({ where: { OR: [{id},{reportId}] } })` без `tenantId`. Чужой/чужерганизационный отчёт → `throw 403` (`:56`), несуществующий id → `return` (`:54`, пропуск). Ответы различимы. | Любой непривилегированный актор (О/Ас/М/Ма/ИО) шлёт `POST /api/media` или `GET /api/media?entityType=report&entityId=<id>`: 403 ⇒ отчёт существует и не его; 200 ⇒ не существует. Перебор/подтверждение существования чужих отчётов, в т.ч. **другой организации** (фильтра тенанта нет вовсе). `reportId` — uuid (`services/reports/event-handlers.ts:61-65`), но он утекает в URL/PDF (`single-pdf/route.ts:167`, `report-history.tsx:137`), поэтому oracle реализуем. | Минимально, одна строка после `:53`: `if (report.tenantId && report.tenantId !== actor.tenantId) return;` — чужой тенант трактуется как черновик (как «не найдено»), cross-org oracle исчезает, семантика «свой/чужой внутри тенанта» и разрешение черновика не меняются. **Что ломает для ADMIN/DISPATCHER — ничего**: они возвращаются на `media-auth.ts:42` до ветки report (тест `media-auth.test.ts:89-92`: в базу не ходят). Альтернатива (жёстче): `where: { tenantId: actor.tenantId, OR:[...] }` + `if (!actor.tenantId) throw 403`, но тогда legacy-отчёты с `Report.tenantId = NULL` (`schema.prisma:1929`) перестают находиться — риск загрязнения, поэтому предпочтительна правка выше. |
| Н2 | важно | `src/core/media/media-auth.ts:63-68` | `safety_incident`/`equipment_defect`: пропуск по единственному условию — формат `entityId` (regex `:64`). Нет проверки роли, владельца, тенанта и существования команды. | Любой непривилегированный актор (включая ASSISTANT, у которого `can()` = false на всё, `authorization-service.ts:158-159`) получает presigned URL на любой `commandId`, в т.ч. чужой/чужерганизационный. Создаётся orphan-медиа с `entityId` чужой команды. Владельца проверяет только сама команда при подтверждении (комментарий `:60-62`) — не проверено, см. «Не проверено». | Добавить проверку организации и владельца до `return` (как в maintenance `:79-81`), либо явно ограничить набор ролей (`OPERATOR`). |
| Н3 | важно | `media-auth.ts:37` vs `media-auth.ts:182-188` | Расхождение правил чтения фото `equipment`: список/выдача URL требует `equipment.read` (`:37`), а чтение существующего файла (download) — лишь равенства тенанта (`:182-188`, любая роль). | OPERATOR/FOREMAN/ASSISTANT получают 403 на список медиа установки (`GET /api/media?entityType=equipment`), но по известному `id` могут скачать любой файл своего тенанта (`GET /api/media/[id]/download`). Список закрыт, поштучная выдача — нет. | Привести `assertCanAccessMedia` для `equipment read` к тому же `equipment.read` (`:37`), либо смягчить список — решить одно. |
| Н4 | мелочь | `media-auth.ts:100`; `prisma/schema.prisma:2731` | `entityType = 'site'` задокументирован в схеме, но в `media-auth` ветки нет — падает в `:100` (403 для всех не-ADMIN). | Если появится загрузка медиа к объекту (`site`), она молча закроется 403. Сейчас потребителя нет (см. Методику). | Либо добавить ветку, либо убрать `site` из комментария схемы. **ГИПОТЕЗА** по будущему использованию. |
| Н5 | мелочь | `authorization-service.ts:50,132` | Право `media.upload` объявлено и расписано по ролям, но в коде нигде не проверяется (grep: только определение, `media-auth` его не вызывает). | Мёртвое право. Реальная защита загрузки — владение сущностью в `media-auth`, а не `media.upload`. У читателя создаётся ложное впечатление, что загрузка гейтится этим правом. | Удалить право либо начать использовать его в `assertCanAccessMediaEntity`. |
| Н6 | мелочь | `media-auth.ts:38` | Для `equipment` отказ `read` (когда роли нет в `equipment.read`) отдаёт текст «Только администратор может управлять фото установок» — про «управлять» на операции чтения. | OPERATOR/FOREMAN/ASSISTANT видят вводящее в заблуждение сообщение при попытке чтения. | Разделить текст для read и mutate. |
| Н7 | мелочь | `media-auth.ts:193` | `isPrivilegedRole` пропускает ADMIN/DISPATCHER в `assertCanAccessMedia` до сверки тенанта: любую медиа запись любого тенанта можно читать/подтверждать/удалять по `id`. | По модели доверия AGENTS.md — платформенные роли видят все тенанты by design. Отмечаю как «перед тенантом #2»: delete/confirm чужой организации по угаданному `id` (`[id]/route.ts:28`, `[id]/confirm/route.ts:26`). | Не правка, а напоминание: при появлении тенанта #2 решить, должно ли удаление медиа быть межтенантным. |
| Н8 | мелочь | `media-auth.ts:196`, `authorization-service.ts:120` | `inspection` read для «чужих» опирается на `maintenance.manage` (`:196`), хотя есть отдельное `inspection.perform` (`:120`). OPERATOR (у которого `inspection.perform` есть) не читает чужие осмотры вовсе, а MECHANIC/SAFETY_ENGINEER читают через `maintenance.manage`. | Несогласованность двух систем прав (ср. предупреждение в памяти проекта). Осознанное сужение «только свои» для оператора (`:118-119`), но основание выбрано не то. | Использовать `inspection.perform` явно, если цель — «свои осмотры». |
| Н9 | мелочь | `core/media/media-service.ts:337-340` | В `getDownloadUrl` проверка тенанта — заглушка-комментарий («In production: verify request tenant matches media tenant»), реальной сверки нет. | Метод маршрутами не используется (роуты строят подписанный URL сами, `download/route.ts:41-72`). Если кто-то вызовет `getDownloadUrl`, получит ссылку без проверки тенанта. | Либо удалить метод (с доказательством неиспользования), либо дописать проверку. |

Статусы: Н1 — **ПРОЙДЕНО** (подтверждено кодом `media-auth.ts:50-56` и тестом `media-auth.test.ts:99-110`); Н2 — **ПРОЙДЕНО** по коду `:63-68`, но влияние «что проверяет команда при подтверждении» — **НЕ ПРОВЕРЕНО**; Н3, Н5, Н6, Н8 — **ПРОЙДЕНО** (по коду/тестам); Н4, Н9 — **ГИПОТЕЗА** (потребителя в коде не нашли, но живого подтверждения «мёртво» нет).

## Отдельный разбор M7

**Можно ли по разнице ответов отличить чужой отчёт от несуществующего?** Да.

Ветка report (`media-auth.ts:48-58`) для непривилегированного актора:
- `report` не найден → `return` (`:54`) — пропуск, дальше выдаётся presigned URL / пустой список. HTTP 200.
- `report` найден, `report.userId !== actor.id` → `throw new ServiceError('Нет доступа', 403)` (`:56`). HTTP 403.
- Фильтра `tenantId` в запросе нет (`:50-53`) — находится отчёт **любой** организации.

Итого различаются три состояния `entityId`: «мой отчёт» (200), «чужой отчёт» (403), «не существует» (200). Состояния «чужой» и «не существует» различимы, а «чужой между организациями» вообще не отфильтрован — это oracle существования по организации наружу. Работает и на `POST /api/media` (выдача URL на загрузку, `route.ts:41`), и на `GET /api/media` (список, `route.ts:78`, при 403 vs пустом 200).

**Минимальная правка.** После `:53` добавить:
```ts
if (report.tenantId && report.tenantId !== actor.tenantId) return;
```
Отчёт другой организации трактуется как «черновик/не найдено» — ответ совпадает с несуществующим id, cross-org oracle закрыт. Разрешение черновика и правило «свой/чужой внутри тенанта» не меняются, поэтому оператор по-прежнему прикрепляет фото к своему несохранённому `reportId`.

**Что сломается для ADMIN/DISPATCHER.** Ничего. Ветка report недостижима для них: `isPrivilegedRole` (`media-auth.ts:42`) возвращает управление раньше, до запроса к БД (тест `media-auth.test.ts:89-92` подтверждает, что `reportFindFirst` не вызывается). Правка не влияет ни на их доступ к медиа, ни на число запросов в базу.

Остаточный риск: oracle «чужой своего тенанта vs несуществующий» (403 vs 200) сохраняется — он неустраним без отказа от разрешения черновиков (иначе ломается загрузка фото до отправки смены, `:20-28,104-109`). Предложенная правка закрывает именно межорганизационную часть, которая и была сутью M7 («ищет отчёт без организации»).

## Не проверено

- **Поведение команд при подтверждении медиа `safety_incident`/`equipment_defect`** (`operator-mobile/.../incidents.ts:150`, `shared.ts:356`): действительно ли команда сверяет владельца, тенант, тип и `image/*` (обещано комментарием `media-auth.ts:60-62`). Модуль `operator-mobile` — заморожен, e2e-прогон не делал. Статус этого пункта — НЕ ПРОВЕРЕНО.
- **Динамика в рантайме**: тесты/приложение не запускал (только `git`/`wc -l`/grep). Выводы основаны на статическом чтении кода; фактические HTTP-коды (200/403) выведены из `NextResponse.json(..., {status})` маршрутов, а не из живого запроса.
- **Реальная эксплуатируемость перебора `reportId`**: не проверял, попадают ли id отчётов других пользователей в места, доступные непривилегированной роли (подтверждена только утечка в одних экранах: `report-history.tsx:137`, `single-pdf/route.ts:167` — но это админские/свои экраны).
- **Наличие живых данных с `Report.tenantId = NULL`** (`schema.prisma:1929`) — влияет на выбор варианта правки Н1; БД не читал.
- **`entityType = 'site'` и `media.upload`** — «мёртвость» подтверждена только текстовым поиском по `src/`; в `e2e/`, `scripts/`, `prisma/` не искал дополнительно (для этих двух не критично).
- Отчёты в `docs/audits/**` (кроме этого файла), `CODEX-REPORT*`, `docs/strategy` не открывал — независимость первого прохода соблюдена.
