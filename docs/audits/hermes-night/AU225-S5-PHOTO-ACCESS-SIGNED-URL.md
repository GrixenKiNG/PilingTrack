# AU225-S5-PHOTO-ACCESS-SIGNED-URL — доступ к фото: подписанные ссылки

Версия кода: `git rev-parse HEAD` → `30203c9cf2d5c17d93cd23b16bcad7d3d5b67044` (ветка `hermes/q4-0926`).
Только чтение: код приложения не изменялся. Существующие отчёты в `docs/audits/`, `docs/strategy/`,
`CODEX-REPORT*` не читались.

## Итог

Для владельца, 5 строк:

1. Фото и документы выдаются браузеру только подписанной ссылкой на хранилище (R2/MinIO/S3), срок жизни — 1 час; сама выдача ссылки всегда идёт через вход в систему и проверку прав конкретного файла.
2. Прямых «дыр» (выдача чужого фото без проверки) в действующих маршрутах я не нашёл: 0 находок уровня «критично».
3. Главное: в `src/core/media/media-service.ts:337-340` стоит заготовка «проверка организации» — комментарий вместо кода, и метод никем не вызывается; сейчас вреда нет, но если его подключат, он будет отдавать ссылку на любой файл по id.
4. Второе по важности: если в окружении задан `CDN_BASE_URL`, ссылка на фото становится постоянной и без проверки входа (сохраняется в базе при подтверждении загрузки) — это гипотеза, значение переменной я не проверял.
5. Мелочи: нет ограничения частоты на выдачу ссылок, разные «дефолтные» бакеты в четырёх местах, пакетная выдача не отдаёт работнику миниатюру его собственного документа.

Числа: находок 13 — критично 0, важно 4, мелочь 9. Маршрутов, выдающих ссылку, — 4.

## Методика

Что искал и как (можно повторить):

```bash
git rev-parse HEAD                                              # 30203c9c…
find src/core/media src/core/storage -type f
find src/app/api -name route.ts | grep -iE "photo|media|download|pdf|document"
rg -l -i "presign|SignedUrl|minio|S3Client|putObject|getObject" src/
rg -n "getSignedUrl|generateDownloadUrl|generateUploadUrl|presign" src/ -g '!*.test.*'
rg -n "getDownloadUrl|generateDownloadUrl|generateUploadUrl|listFiles\b" . --glob '!node_modules' --glob '!.next'
rg -n "cdnUrl|CDN_BASE_URL|S3_BUCKET" src/ -g '!*.test.*'
awk '/^model Report /,/^}/' prisma/schema.prisma
awk '/^model Media /,/^}/' prisma/schema.prisma
```

Прочитаны целиком или в значимой части (полные пути от корня): `src/core/media/media-service.ts`,
`src/core/media/media-content.ts`, `src/core/media/media-auth.ts`, `src/core/storage/s3-service.ts`,
`src/app/api/media/route.ts`, `src/app/api/media/[id]/route.ts`, `src/app/api/media/[id]/confirm/route.ts`,
`src/app/api/media/[id]/download/route.ts`, `src/app/api/media/download-batch/route.ts`,
`src/core/api-wrapper.ts` (withApi/withMutation), `src/lib/auth.ts` (requireAuth),
`src/lib/tenant.ts` (requireTenantId), `src/lib/media-thumbnails.ts`, `src/lib/pdf-generator/storage.ts`,
`src/app/api/reports/pdf/route.ts`, `src/app/api/reports/single-pdf/route.ts`,
`src/modules/monitoring/application/queries/fleet-monitoring.service.ts:150-200`,
`src/modules/reports/application/queries/report-query.service.ts:160-260`,
клиенты: `src/components/piling/report-form/photo-section.tsx`,
`src/components/piling/admin-equipment/detail/equipment-photos.tsx`,
`src/components/piling/inspections/inspection-item-photos.tsx`,
`src/components/piling/monitoring/equipment-tile-block.tsx`.
Замороженные зоны (варианты экрана оператора, сайт ORION) не аудировались.

## Маршруты выдачи файлов

| Маршрут | файл:строка | проверка | срок | риск |
| --- | --- | --- | --- | --- |
| `POST /api/media` (ссылка на загрузку) | `src/app/api/media/route.ts:19-61` | `requireAuth` + `assertCanAccessMediaEntity(mutate)` (`src/core/media/media-auth.ts:30`) + `requireTenantId` (`src/lib/tenant.ts:25`); tenant берётся из сессии, ключ собирается из него же (`src/core/media/media-content.ts:166-176`) | 3600 с (`src/core/media/media-service.ts:163`, дефолт `src/core/media/media-content.ts:82`) | низкий. При `entityType` без `entityId` ключ уходит в `media/<tenant>/misc/` — читает только загрузивший (ПРОЙДЕНО) |
| `GET /api/media` (список файлов сущности) | `src/app/api/media/route.ts:63-89` | `requireAuth` + `assertCanAccessMediaEntity(read)`; выборка строго по тенанту (`src/core/media/media-service.ts:419-430`) | ссылок нет, только метаданные | низкий. В ответе есть `key` объекта (находка 9) |
| `GET /api/media/[id]/download` (ссылка на файл) | `src/app/api/media/[id]/download/route.ts:9-75` | `requireAuth` + `assertCanAccessMedia(read)` (`src/core/media/media-auth.ts:177`) + дополнительно «это мой документ работника» (`src/core/media/media-auth.ts:164`, вызов `:34`) | 3600 с, зашито строкой (`:69`, `:72`) | низкий: проверка на каждую запись, `isDeleted`/`uploadStatus` отсекаются (`:23-24`) |
| `GET /api/media/download-batch` (до 100 файлов) | `src/app/api/media/download-batch/route.ts:31-113` | `requireAuth` + `filterReadableMedia` — тот же per-row `assertCanAccessMedia(read)` (`src/core/media/media-auth.ts:136-149`) | 3600 с (`:29`, `:99`) | низкий: недоступные записи молча выпадают (ПРОЙДЕНО). Расхождение с одиночным маршрутом — находка 5 |
| `POST /api/media/[id]/confirm` | `src/app/api/media/[id]/confirm/route.ts:8-36` | `withMutation` (CSRF+лимит) + `assertCanAccessMedia(mutate)`; `tenantId` включён в выборку (`:17-20`) | — | низкий |
| `DELETE /api/media/[id]` | `src/app/api/media/[id]/route.ts:9-43` | `withMutation` + `assertCanAccessMedia(mutate)` + запись в журнал аудита (`:36-39`) | — | низкий |
| `GET /api/reports/pdf?action=download` (PDF за период) | `src/app/api/reports/pdf/route.ts:223-230`, отдача `:341-358` | `requireAuth` + `reports.read_all`; **владелец задачи не проверяется** | поток байт через сервер, TTL файла не ограничен кодом | важно — находка 3 |
| `GET /api/reports/single-pdf?action=download` | `src/app/api/reports/single-pdf/route.ts:214-225` | `requireAuth` + `reports.read_all` + сверка владельца задачи (`getPdfJobOwnerId`, `src/lib/pdf-queue.ts`) | поток байт через сервер | низкий — эталон для находки 3 |

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление | статус |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | важно | `src/core/media/media-service.ts:337-340` | Метод `getDownloadUrl` содержит вместо проверки организации только комментарий: `if (media.tenantId) { /* In production: verify request tenant matches media tenant */ }`. Метод не вызывается нигде: поиск по репозиторию находит только определение (`src/core/media/media-service.ts:327`), маршруты подписывают ссылки сами | Сейчас ущерба нет — код мёртвый. Но это «мина»: при первом подключении (например, чтобы убрать дублирование из маршрута) любой вошедший пользователь получит подписанную ссылку на файл по чужому id, и комментарий будет утверждать, что проверка есть | либо удалить метод (с доказательством по AGENTS.md §4), либо реализовать проверку и вызывать только его; убрать вводящий в заблуждение комментарий | ПРОЙДЕНО (что не вызывается) |
| 2 | важно | `src/core/media/media-service.ts:312-314`, `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:188` | Если задан `CDN_BASE_URL`, при подтверждении загрузки в базу пишется `cdnUrl` = `«<CDN>/<ключ>»` — постоянный адрес без подписи и без проверки входа; выборка фото техники предпочитает именно его (`m.cdnUrl ?? …`) | Фото установок, отчётов и документов становятся доступны по неизменяемой ссылке любому, у кого она оказалась (пересылка, лог, кэш браузера, история). Подписанная ссылка на час в этом случае не защищает | если CDN нужен — только приватный CDN с подписью на лету; иначе не заполнять `CDN_BASE_URL` и не хранить `cdnUrl` в базе | ГИПОТЕЗА: `CDN_BASE_URL` встречается только в `src/core/media/media-service.ts:507`, в документации не описан, фактическое значение env не проверялось (см. «Не проверено») |
| 3 | важно | `src/app/api/reports/pdf/route.ts:223` и `:230` → `:341-358` | Скачивание PDF за период по `jobId` не проверяет, чья это задача: нет ни `getPdfJobOwnerId`, ни сверки тенанта. В соседнем маршруте такая проверка есть (`src/app/api/reports/single-pdf/route.ts:214-225`) | Пользователь с правом `reports.read_all`, получивший `jobId` (пересланная ссылка, скриншот, лог), скачает агрегат за период по всей организации, включая чужие смены. Перебор исключён (`jobId` — свой UUID, `src/app/api/reports/pdf/route.ts:212`), но сама ссылка является предъявительской | повторить проверку из single-pdf: владелец задачи или право `reports.read_cross_user` | ПРОЙДЕНО (что проверки нет) |
| 4 | важно | `src/app/api/media/[id]/download/route.ts:74`, `src/app/api/media/download-batch/route.ts:112` | Выдача подписанных ссылок без ограничения частоты: обработчики передают только `{ domain: 'media.download' }`, а лимиты применяет лишь `withMutation` (`src/core/api-wrapper.ts:213`); `withApi` лимит не ставит | Любой вошедший пользователь может массово подписывать ссылки (пакет до 100 id за запрос, `src/app/api/media/download-batch/route.ts:28`), создавая нагрузку на хранилище и «вытягивая» ссылки пакетами для дальнейшей пересылки | добавить `rateLimit` в опции `withApi` для обоих маршрутов (например, как в `src/app/api/reports/pdf/route.ts:27-32`) | ПРОЙДЕНО (по коду) |
| 5 | мелочь | `src/app/api/media/download-batch/route.ts:65` против `src/app/api/media/[id]/download/route.ts:34` | Пакетная выдача не знает про «файл, приложенный к документу работника»: `filterReadableMedia` (`src/core/media/media-auth.ts:136-149`) применяет только общее правило, поэтому загруженный администратором документ работника в пакет не попадает, а одиночный маршрут его отдаёт | Работник видит миниатюру «нет фото» там, где одиночный маршрут отдал бы файл; расхождение будет всплывать как загадочный 403/пустая плитка | либо учитывать `ownsUserDocumentMedia` в отборе, либо задокументировать, что документы работника идут только одиночным маршрутом | ПРОЙДЕНО (по коду) |
| 6 | мелочь | `src/core/media/media-service.ts:502`, `src/app/api/media/[id]/download/route.ts:50`, `src/core/storage/s3-service.ts:45`, `src/lib/pdf-generator/storage.ts:58` | Четыре разных «дефолтных» бакета: `pilingtrack-media`, `pilingtrack`, `pilingtrack-reports` (дважды) | Если `S3_BUCKET` не задан в окружении, загрузка и выдача ссылаются на разные бакеты: фото загрузится, а ссылка будет подписана на пустой бакет (NoSuchKey). В проде переменная задана (`docs/deployment.md:56`), т.е. риск конфигурационный | один общий дефолт или явная ошибка старта при незаданном `S3_BUCKET` | ПРОЙДЕНО (по коду) |
| 7 | мелочь | `src/app/api/media/[id]/download/route.ts:41-49`, `src/app/api/media/download-batch/route.ts:70-78` | Свой `S3Client` создаётся на каждый запрос, в обход `s3CircuitBreaker` и общего клиента сервиса (`src/core/media/media-service.ts:162`, `:209`, `:288`) | При недоступности хранилища маршрут не отсекается предохранителем, каждый запрос ждёт тайм-аут; на списке из 100 плиток это умножается. Дублирование конфигурации — источник находки 6 | переиспользовать один сконфигурированный клиент/сервис и его предохранитель | ПРОЙДЕНО (по коду) |
| 8 | мелочь | `src/core/media/media-service.ts:327`, `src/core/storage/s3-service.ts:76-89` | `getDownloadUrl(mediaId, expiresIn?)` и `generateDownloadUrl(key, expiresIn = 3600)` принимают срок жизни от вызывающего и ничем его не ограничивают; ни один не вызывается | Мёртвый код с открытым параметром: при подключении TTL ссылки будет определять клиент, а не сервер | убрать параметр из публичного контракта или ограничить сверху; либо удалить неиспользуемое (по правилу доказательства) | ПРОЙДЕНО (что не вызывается) |
| 9 | мелочь | `src/app/api/media/route.ts:88` | Список отдаёт полный `MediaRecord`, включая `key` — путь объекта в хранилище (`src/core/media/media-service.ts:479`) и `cdnUrl` | Клиент получает внутреннюю структуру хранилища с идентификатором организации и сущности (`media/<tenant>/<entityType>/<entityId>/…`). Сама по себе ссылкой не является, но упрощает целевые попытки | отдавать только нужные поля (`id`, `fileName`, `contentType`, `thumbnailKey != null`, `createdAt`) | ПРОЙДЕНО (по коду) |
| 10 | мелочь | `src/modules/reports/application/queries/report-query.service.ts:178` и `:247` | Выборка медиа по отчётам идёт без `tenantId`: `where: { entityType: 'report', entityId: { in: … } }` — нарушение правила «тенант закрывается по умолчанию» | Утечки нет: `entityId` здесь — `Report.reportId`, объявленный уникальным (`prisma/schema.prisma:1930`), коллизия между организациями невозможна. Нарушение проявится, если уникальность когда-нибудь снимут | добавить `tenantId` в оба условия | ПРОЙДЕНО (утечка невозможна при текущей схеме) |
| 11 | мелочь | `src/lib/media-thumbnails.ts:33`, `:42`, `:76`, `:114` | Кэш подписанных ссылок живёт в памяти модуля 50 минут и не сбрасывается при выходе из системы: `clearThumbnailCache` вызывается только тестами (`:114`) | На общем рабочем компьютере после смены пользователя (без перезагрузки вкладки) остатки ссылок могут примениться к чужому экрану; сами ссылки живут до часа | сбрасывать кэш при выходе/смене пользователя | ПРОЙДЕНО (по коду) |
| 12 | мелочь | `src/core/media/media-auth.ts:50-53` | Поиск отчёта при загрузке фото: `db.report.findFirst({ where: { OR: [{ id: entityId }, { reportId: entityId }] } })` — без `tenantId` (правило проекта требует строгого равенства) | Утечки нет: далее идёт проверка владельца `report.userId !== actor.id` → 403 (`:56`), а для не найденного (черновик) отчёта доступ ограничен только загрузкой «своего» media | добавить `tenantId` в условие, если отчёт найден | ПРОЙДЕНО |
| 13 | мелочь | `src/app/api/media/[id]/download/route.ts:66-70` | Подписанная ссылка не привязана ни к сессии, ни к адресу пользователя — это обычное свойство подписи S3 (предъявительская ссылка на 1 час) | Ссылка из истории браузера, лога или переписки работает у третьего лица час. Осознанное свойство механизма, но владельцу стоит знать | если требуется — короткий TTL для «открыть сейчас», либо раздача через свой маршрут с проверкой сессии вместо ссылки на хранилище | ПРОЙДЕНО (поведение подтверждено кодом) |

Сверх списка: то же отсутствие проверки владельца задачи подписей не касается (там нет подписи) — см. находку 3.

## Что прошло проверку (для полноты)

- Загрузка: размер проверяется до выдачи ссылки и повторно по факту загруженного объекта
  (`src/core/media/media-service.ts:118-130`, `:224-240`), тип содержимого сверяется с реальными байтами
  (`src/core/media/media-service.ts:266`, `src/core/media/media-content.ts:138`), расширение берётся из типа,
  а не из имени файла (`src/core/media/media-content.ts:98-112`), ключ обеззараживается
  (`src/core/media/media-content.ts:173-175`). ПРОЙДЕНО.
- Загрузка без `entityType` попадает в `media/<tenant>/misc/…` и читается только загрузившим
  (`src/core/media/media-auth.ts:193-199`). ПРОЙДЕНО.
- Подмена чужого отчёта «своим» фото не проходит: для сохранённого отчёта требуется совпадение
  владельца (`src/core/media/media-auth.ts:56`). ПРОЙДЕНО.
- Подтверждение и удаление файла требуют права уровня «управлять» и пишут след в журнал
  (`src/app/api/media/[id]/route.ts:34-39`). ПРОЙДЕНО.
- Кэширование ответов для маршрутов медиа не включено (`_opts.cache` не задан), поэтому подписанная
  ссылка не может закэшироваться на другого пользователя (`src/core/api-wrapper.ts:82-95`). ПРОЙДЕНО.
- Проверка хранилища в `/api/health/deep` отдаёт наружу только «ok/degraded/down», без имён и
  сообщений (`src/app/api/health/deep/route.ts:17-19`, `:45-58`). ПРОЙДЕНО.

## Не проверено

1. Фактические значения `S3_BUCKET`, `S3_ENDPOINT`, `CDN_BASE_URL`, `MEDIA_MAX_FILE_SIZE`. Файлы `.env*` не читались по прямому запрету AGENTS.md §1 — поэтому находка 2 осталась гипотезой, а не подтверждённым дефектом.
2. Публичность бакета и политика доступа в R2/MinIO (production и стенд). Нет доступа к хранилищу; из кода видно только, что приложение раздаёт файлы подписанными ссылками.
3. Реальное поведение подписи у провайдера: расхождение часов, обработка `ResponseContentDisposition`, поведение при истёкшей ссылке. Проверялось только по коду.
4. Тесты (`src/core/media/__tests__/*`) не запускались: задача — чтение кода. Значит, «зелёность» проверок прав на фото здесь не подтверждена.
5. Замороженная зона: маршруты и экраны мобильного приложения оператора (`src/components/piling/operator-mobile/**`, `src/modules/operator-mobile/**`, `src/app/operator/**`) не аудировались, кроме факта, что загрузка снимка идёт в общий `POST /api/media` и `POST /api/media/[id]/confirm` (`src/components/piling/operator-mobile/api.ts:668-733`).
6. Сквозной проверки «чужой пользователь + реальный id» на живом стенде не делал: выводы о доступе сделаны по чтению кода маршрутов и правил.
7. Не проверял ни одного существующего отчёта в `docs/audits/` и `docs/strategy/` (запрет задачи), поэтому возможное пересечение с прежними находками не оценено.
