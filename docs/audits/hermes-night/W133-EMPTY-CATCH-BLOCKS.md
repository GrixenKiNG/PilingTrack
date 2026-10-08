# W133 — Пустые блоки catch, которые глотают ошибки

## Итог

Просканирован `src/` без тестов, `src/generated/`, замороженных зон (варианты экрана оператора, сайт ORION). Найдено **28** блоков catch с пустым телом или телом из одного комментария (без `logger`, `throw` или возврата ошибки).

- критично: 1 — `src/lib/api.ts:63` (глушится вызов `/api/auth/logout`; серверная сессия может остаться живой, клиент при этом локально «разлогинивается»).
- важно: 7 — сетевые/внешние вызовы и запись в Redis/обсервабилити (S3 Head-проверка миниатюры ×2, запись LKG-кэша, `recordError` в error-boundary, релиз лидера в Redis, статистика outbox/DLQ, удаление PDF из S3).
- мелочь: 20 — best-effort загрузки UI-деталей и `JSON.parse` тела ответа: экран остаётся рабочим, но сбой невидим в логах.

Топ-5 по значимости: `src/lib/api.ts:63` (сессия); `src/app/api/media/[id]/download/route.ts:61` и `.../media/download-batch/route.ts:90` (S3-проверка миниатюры глотается целиком, включая отказ сети/прав); `src/core/error-boundary/api-error-boundary.ts:176` (провал записи LKG-кэша); `src/core/infrastructure/leader-election.ts:259` (провал релиза лидера); `src/core/observability/health-tracker/aggregate.ts:72` (статистика outbox/DLQ может молча стать нулём).

Отдельно: в `src/services/auth/`, `src/core/security/`, `src/lib/rate-limiter.ts`, `src/lib/csrf-protection.ts` **пустых catch нет** — все ветки либо логируют, либо `throw`, либо возвращают ошибочный результат (см. методику). Это подтверждение, а не пропуск.

## Методика

- Полный перебор `src/**/*.{ts,tsx}` (исключены `node_modules`, `src/generated`, `__tests__`, `*.test.ts(x)`; замороженные зоны — каталоги, в пути которых есть `operator`, и всё `orion` — исключены по §1 AGENTS.md).
- Скрипт на node (лежит вне репозитория, `.../cache/scratch/scan-catch.cjs`) находит ключевое слово `catch` (пропуская promise-`.catch(`), парсит список параметров и с балансом скобок извлекает тело блока; из тела удаляются `/* */` и `//`-комментарии, после чего проверяется пустота. Так ловятся и однострочные `catch {}`, и многострочные `catch {\n}` / `catch (e) { // … }`.
- Независимая перекрёстная проверка регексом `catch\s*(\([^)]*\))?\s*\{\s*\}` по видимым файлам — 0 совпадений (однострочных пустых catch нет, все 28 — с комментарием внутри).
- Дополнительно проверены promise-обработчики `.catch(() => {})` / `.catch((e) => {})` — в `src/` (без generated) 0 совпадений.
- Отдельно прогнаны целевые каталоги/файлы из задания: `src/services/auth/` (4 catch — logger/return), `src/core/security/` (0 catch), `src/lib/rate-limiter.ts` (6 catch — logger/сброс `redisReady`), `src/lib/csrf-protection.ts` (2 catch — `return` 403). Пустых нет.
- Соответствие severity заданию: «высокий» → критично, «средний» → важно, «низкий» → мелочь.

## Находки

Легенда: «logger/throw рядом» — есть ли в теле catch логирование или проброс; у всех 28 в теле только комментарий, поэтому «нет».

| # | severity | path:line | что в `try` (одной строкой) | logger/throw в catch | почему важно | предлагаемая правка |
|---|----------|-----------|------------------------------|----------------------|--------------|---------------------|
| 1 | критично | `src/lib/api.ts:63` | `await fetch('/api/auth/logout')` при ответе 401 | нет (комментарий «Ignore cleanup failures…») | Провал `logout` глушится, а локальное состояние сессии всё равно сбрасывается: серверная сессия/JWT может остаться валидной при «вышедшем» пользователе. Нет ни лога, ни следа. | Оставить сброс локального состояния, но добавить `logger.warn('logout failed', {error})`, чтобы отказ был виден. |
| 2 | важно | `src/app/api/media/[id]/download/route.ts:61` | `s3.send(HeadObjectCommand)` — проверка существования миниатюры | нет (комментарий «thumb missing — serve original») | Глушится не только «миниатюры нет», но и отказ S3/сети/прав: fallback задуман для legacy-записей, а маскирует реальные сбои внешнего сервиса. | Различать `NotFound` (тихо, ожидаемо) и прочие ошибки → `logger.warn`. |
| 3 | важно | `src/app/api/media/download-batch/route.ts:90` | `s3.send(HeadObjectCommand)` в пакетной раздаче миниатюр | нет (комментарий «миниатюры нет — отдаём оригинал») | То же, что №2, но в цикле `Promise.all` — один сбой Head на элемент тихо перекладывает нагрузку на выдачу оригинала. | Как №2: логировать всё, кроме `NotFound`. |
| 4 | важно | `src/core/error-boundary/api-error-boundary.ts:176` | запись LKG-payload в Redis (`client.set`) | нет (комментарий «Cache writes are best-effort.») | Деградация («отдать последний удачный ответ») тихо перестаёт работать — при следующем сбое кэша нет, а причина нигде не видна. | `logger.debug`/`warn` при провале записи (хотя бы debug). |
| 5 | важно | `src/core/error-boundary/api-error-boundary.ts:315` | `recordError(...)` — учёт для circuit breaker / SLO | нет (комментарий «Non-fatal — don't let error tracking crash the response») | Ошибки перестают учитываться молча: размыкатель может не сработать, SLO-метрики занижены, и нет сигнала, что трекинг сломан. | `logger.warn` в catch (ответ всё равно продолжается). |
| 6 | важно | `src/core/infrastructure/leader-election.ts:259` | `client.eval(RELEASE_LEASE, …)` — релиз лидера в Redis | нет (комментарий «Best-effort release only. TTL cleanup remains the fallback.») | Провал релиза скрыт; полагаемся только на TTL. При частых сбоях — лишняя пауза перед переизбранием, без диагностики. | `logger.warn` при провале релиза. |
| 7 | важно | `src/core/observability/health-tracker/aggregate.ts:72` | `getLagMetrics()` / `getOutboxStats()` / `getDlqStats()` | нет (комментарий «best effort») | Сбой чтения статистики даёт `outboxPending=0, dlqPending=0` — health-панель показывает «благополучно», пока очередь растёт. | `logger.warn` и/или явный флаг «неизвестно» вместо нуля. |
| 8 | важно | `src/lib/pdf-generator/storage.ts:76` | `deleteFile(pdfS3Key(jobId))` — удаление PDF из S3 | нет (комментарий «Object may already be gone…») | Молча глушится удаление: при сбое S3/прав результат остаётся в бакете, никто об этом не узнает. | Логировать всё, кроме «нет объекта». |
| 9 | мелочь | `src/app/api/feedback/stream/route.ts:55` | `controller.close()` в обработчике abort SSE | нет (комментарий «already closed») | Нормальный сценарий: клиент отключился, поток уже закрыт. Риск низкий. | Оставить; при желании `logger.debug`. |
| 10 | мелочь | `src/components/piling/admin-equipment/detail/equipment-report-export.tsx:74` | `authFetch('/api/settings')` — часовой пояс для экспорта | нет (комментарий «Пояс не критичен…») | Откат на пояс по умолчанию, экспорт работает. | `logger.debug` при провале (опционально). |
| 11 | мелочь | `src/components/piling/admin-equipment/equipment-card-grid.tsx:121` | `authFetch('/api/layout/…?scope=set')` — раскладка плиток | нет (комментарий «leave the last-known set…») | UI откатывается на шаблон по умолчанию. | Опционально debug-лог. |
| 12 | мелочь | `src/components/piling/admin-equipment/equipment-to-tab.tsx:48` | `authFetch('/api/to/journal?...')` — журнал ТО оборудования | нет (`/* ignore */`) | Список остаётся пустым, вкладка рабочая. | Опционально debug-лог. |
| 13 | мелочь | `src/components/piling/admin-incidents/admin-incidents.tsx:63` | `response.json()` — разбор тела ошибки | нет | Это парсинг UI-данных; ниже подставляется понятный текст. | Оставить. |
| 14 | мелочь | `src/components/piling/admin-reports/report-thumbnail.tsx:45` | `authFetch('/api/media?...')` + `getThumbnailUrl` | нет (`/* silent — list view is best-effort */`) | Строка списка остаётся без превью. | Оставить. |
| 15 | мелочь | `src/components/piling/admin-sites/index.tsx:181` | `authFetch('/api/sites/{id}')` в `refreshTree` | нет (`/* ignore */`) | Дерево не обновляется молча (сосед-эффект на строке 167 хотя бы ставит `treeError`). | Опционально debug-лог. |
| 16 | мелочь | `src/components/piling/layout-editor/use-layout-template.ts:57` | `res.json()` — разбор тела 403 | нет | Парсинг UI-данных, ниже возвращается сообщение по умолчанию. | Оставить. |
| 17 | мелочь | `src/components/piling/monitoring/design-tuning-panel.tsx:65` | `JSON.parse` legacy-настроек + `saveEquipmentTileTemplate` | нет | Миграция нечитаемого legacy-значения намеренно игнорируется, побеждает безопасный дефолт. | Оставить (причина понятна). |
| 18 | мелочь | `src/components/piling/operator-document-reminder.tsx:43` | `authFetch('/api/users/{id}/documents')` | нет | Вспомогательное напоминание молчит, чтобы не заслонять рабочий экран. | Оставить (причина понятна). |
| 19 | мелочь | `src/components/piling/pile-journal/index.tsx:140` | `authFetch('/api/sites/all')` — список объектов для фильтра | нет | Фильтр без списка, журнал работает. | Оставить (причина понятна). |
| 20 | мелочь | `src/components/piling/to/readiness/screens/briefings-screen.tsx:140` | `authFetch('/api/safety/clearance')` — список работников для формы | нет | Пропажа списка не гасит журнал, форма просто пуста. | Опционально debug-лог. |
| 21 | мелочь | `src/components/piling/to/readiness/screens/safety-overview-screen.tsx:169` | `authFetch('/api/briefings/journal?status=awaiting')` — счётчик подписей | нет | Счётчик показывается прочерком, обзор допусков не гасится. | Оставить. |
| 22 | мелочь | `src/components/piling/to/readiness/screens/safety-overview-screen.tsx:188` | `authFetch('/api/briefings/journal')` — последние записи журнала | нет | Ошибка и пусто выглядят одинаково — осознанный компромисс (описан в комментарии выше, строки 175–181). | Оставить. |
| 23 | мелочь | `src/core/event-bus/schema-registry/index.ts:40` | `schemaRegistry.register(schema)` при старте | нет (комментарий «skip duplicates») | Идемпотентная регистрация; глушится и настоящая ошибка формата схемы, но на старте это не критично. | Опционально debug-лог. |
| 24 | мелочь | `src/core/notifications/telegram.ts:314` | `JSON.parse(raw)` тела ответа Telegram | нет | Не-JSON → возвращается исходный текст. Вспомогательный путь предпросмотра. | Оставить. |
| 25 | мелочь | `src/lib/media-thumbnails.ts:71` | `authFetch('/api/media/download-batch?thumb=1…')` — батч миниатюр | нет | Сеть отвалилась → `null`, строка покажет запасной вид. | Опционально debug-лог. |
| 26 | мелочь | `src/lib/pdf-generator/storage.ts:84` | `unlinkSync(filePath)` — удаление локального PDF | нет (комментарий «may already be removed…») | Штатный ENOENT при повторном удалении; задумано тихо. | Оставить. |
| 27 | мелочь | `src/modules/readiness/infrastructure/tenant-transaction.ts:105` | `options.resolveConflictDetails?.()` — диагностика конфликта сериализации | нет | Best-effort диагностика; сам конфликт далее всё равно бросается `ReadinessCommandError`. Задумано. | Оставить (причина понятна). |
| 28 | мелочь | `src/services/reports/event-handlers.ts:400` | `getSettings(tenantId)` — часовой пояс для алерта | нет | При ошибке берётся `Europe/Moscow`; комментарий 392–394 поясняет, что молчать проще, чем терять алерт. | Опционально debug-лог. |

Сводка по каталогам (28): `src/app/api/` — 3; `src/components/piling/` — 13; `src/core/` — 6; `src/lib/` — 4; `src/modules/` — 1; `src/services/` — 1.

## Не проверено

- **Замороженные зоны** (`src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**` — каталоги, `src/modules/operator-mobile/**`, весь `orion`) по §1 AGENTS.md не сканировались. Там могут быть свои пустые catch; это вне задания.
- **Promise-обработчики `.catch(() => {})`** проверены только регексом на пустое тело (0 совпадений в видимом `src/`). Вариант `.catch(console.error)`/`.catch(() => null)` (проглатывание без логирования, но с непустым телом) по определению задания не искался.
- Для находок №9, 10–22, 24–28 «почему важно» выведено из комментария в коде и назначения вызова; **глубина бизнес-последствий не измерялась** (не проверено, есть ли иной слой логирования выше по стеку, который компенсирует молчание).
- `src/generated/**` и тесты исключены по заданию; в `src/generated` регексом видно 13 совпадений `catch {}` (сгенерированный Prisma/PG-клиент) — они не входят в опись и в продукт не вносятся.
- Проверка не запускала `tsc`/`lint`/тесты: задание read-only и не меняет код; паритету CI здесь нечего проверять.
