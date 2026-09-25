# 05 — Инвентаризация мёртвого кода (dead-code inventory)

Аудит экспортируемых функций, компонентов и файлов в `src/**`, которые не используются нигде в репозитории. Только инвентаризация — ничего не удалялось.

## Итог

- **109 неиспользуемых экспортов** (в 41 файле) — имя не встречается нигде за пределами объявляющего файла (ни импорт, ни ре-экспорт, ни строка). Уверенность **высокая** для всех.
- **25 экспортов, используемых только собственным тестом** (в 20 файлах) — рабочий код их не вызывает.
- **364 экспорта, используемые только внутри собственного файла** (ключевое слово `export` избыточно, т.к. никто не импортирует) — мелочь, отдельным списком не разворачиваю.
- Исключено из подсчёта: `src/generated/**` (автогенерация Prisma), framework-конвенции Next/Sentry (`register`, `onRequestError`, `onRouterTransitionStart` в `src/instrumentation*.ts`, `proxy`/`config` в `src/proxy.ts`), замороженные зоны (operator/orion), telemetry и tenancy.
- Кластеризация по ценности: наибольший вес у мёртвой доменной логики **readiness / safety** (одобрение нарядов, safety-блокеры, оповещение о критических дефектах, ETag-конкурентность) и у неподключённой **наблюдаемости** (tracing коррекляции, cache/lag метрики).

**Топ-5:**
1. `src/modules/readiness/application/defects/notify-critical.ts:24` — `notifyCriticalDefects`: точка оповещения о критических дефектах нигде не вызывается; проверить, что уведомления о критических дефектах подключаются иным путём, иначе это пробел.
2. `src/modules/readiness/domain/readiness-rules.ts:106` — `isSystemSafetyBlocker`: правило системного safety-блокера не вызывается из продакшн-кода.
3. `src/modules/readiness/application/command-pipeline/etag.ts:60` — `assertCurrentVersion`: экспорт для ETag-оптимистичной блокировки не используется; убедиться, что контроль версий в пайплайне команд всё ещё работает через другой путь.
4. `src/lib/api.ts:186/190/197` — `authGet`/`authPost`/`authPut`: мёртвые клиентские fetch-обёртки с авторизацией.
5. `src/lib/cache-strategies.ts:406/415/426` + `src/lib/cache-metrics.ts:42..137` — готовые конкретики кеш-стратегий (`defaultCache`/`lowLatencyCache`/`consistentCache`) и 7 функций учёта метрик кеша — вся подсистема метрик кеша не подключена.

## Методика

- Программа TypeScript (компилятор 6.0.3) собрана над всем репозиторием: `src/`, `e2e/`, `tests/`, `scripts/`, `prisma/`, `agents/`, `next.config.ts`, `vitest.config.ts`, `playwright.config.ts`. Всего 1297 файлов, 3253 экспорта в 839 src-файлах.
- Экспорты собраны по AST (не через `getExportsOfModule`, который в TS6 вернул пусто). Для каждого экспорта `LanguageService.findReferences` (TS6) собрал ссылки; каждая внешняя ссылка классифицирована как ре-экспорт / импорт / использование по родительскому узлу.
- **Отобран раздел «полностью без ссылок»**: экспорт, у которого нет ни одного внешнего использования, ни ре-экспорта, ни использования внутри собственного файла. Для таких кандидатов выполнен контрольный текстовый поиск имени по всему репозиторию (`\bname\b` в .ts/.tsx/.js/.mjs/.json/.prisma; пути src/e2e/tests/scripts/prisma/agents и корневые конфиги) с исключением объявляющего файла и тестов. **Имя не найдено нигде** → «мёртвый» с высокой уверенностью (даже при динамическом импорте по вычисляемому имени литерал имени должен был бы где-то существовать).
- «Тест-only» = имя встречается только в `*.test.*`/`*.spec.*`/`__tests__/**`.
- **Отклонено как недостоверное**: раздел «ре-экспорт без потребителя» (фасадные экспорты index.ts). Эмпирически проверено: `requireTenant`, `tenantWhere`, `withTenantContext`, `generateUploadUrl`, `startRealtimePublisher`, `startAlertEngine` имеют сотни потребителей через `@/core/...` фасады, но `findReferences` видит лишь сам ре-экспорт. Значит, фасадные-только символы **нельзя** считать мёртвыми — этот раздел в отчёт не включён, чтобы не дать ложных срабатываний.
- Судя по контрольному поиску, имени нет в `scripts/`, `agents/`, `prisma/`, `e2e/` — то есть кандидаты не используются ни раннерами/воркерами, ни сидами (строковые ссылки на job/route/registry ключи не найдены).

## Находки

Уверенность (по критерию «имя не встречается нигде в репозитории, кроме объявляющего файла») — **высокая** для всех строк, где не указано иное. Серьёзность: критично/важно/мелочь.

| # | серьёзность | path:line | проблема | почему важно / сценарий | предлагаемое действие |
|---|---|---|---|---|---|
| 1 | важно | `src/modules/readiness/application/defects/notify-critical.ts:24` | `notifyCriticalDefects` не вызывается нигде | Если оповещения о критических дефектах (Telegram/WebSocket) идут только этой функцией — уведомлений нет | Проверить, что критический дефект оповещается иным путём; иначе подключить или удалить |
| 2 | важно | `src/modules/readiness/domain/readiness-rules.ts:106` | `isSystemSafetyBlocker` не вызывается из продакшена | Правило системного safety-блокера готовности не применяется в расчёте | Подключить правило или удалить вместе с неиспользуемыми константами |
| 3 | важно | `src/modules/readiness/application/command-pipeline/etag.ts:60` | `assertCurrentVersion` заброшен | Оптимистичная блокировка на ETag может не применяться в пайплайне команд; риск потерянной правки | Проверить, что контроль версий исполняется в `execute-command.ts`; иначе удалить |
| 4 | важно | `src/lib/api.ts:186,190,197` | `authGet`/`authPost`/`authPut` — мёртвые клиентские обёртки | 401-ретрей и заголовки авторизации дублируются самописно в каждом месте | Удалить или провести единую реализацию |
| 5 | важно | `src/lib/cache-strategies.ts:406,415,426` | `defaultCache`/`lowLatencyCache`/`consistentCache` не подключены | Готовые кеш-конфигурации не используются ни одним вызовом | Подключить или удалить |
| 6 | важно | `src/lib/cache-metrics.ts:42..137` (7 ф-ций) | вся подсистема учёта метрик кеша не вызвана | Нет наблюдаемости попаданий/промахов кеша; `createMetricsResponse` тоже мёртв | Подключить к слою кеша или удалить |
| 7 | важно | `src/lib/request-context.ts:48,56,63,70,104,140,195` | 7 ф-ций tracing (trace/span/id) не используются | Корреляционный контекст OpenTelemetry не задействован в логах | Подключить к `logger`/`withApi` или удалить |
| 8 | важно | `src/core/observability/logger.ts:37,41,127` | `getCorrelationContext`/`runWithCorrelation`/`childLogger` мертвы | Корреляционные заголовки не прошиваются в дочерние логгеры | Подключить или удалить |
| 9 | важно | `src/core/observability/lag-monitor.ts:352,360` | `getLagAlerts`/`getFreshLagMetrics` не вызваны | Metrica лага воркеров не читается (нет API/UI) | Подключить к /api/metrics или удалить |
| 10 | важно | `src/core/observability/error-tracker.ts:140` | `recordRequest` не вызван | Запись запросов в трекер ошибок не ведётся | Подключить или удалить |
| 11 | важно | `src/lib/logger.ts:126` | `withRequestLogging` не используется | Нет единой обёртки логгирования запросов | Подключить или удалить |
| 12 | важно | `src/core/infrastructure/raw-queries.ts:108,171` | `getSiteDailySummaryRaw`/`getCrewsWithDetailsRaw` мертвы | Сырые аналитические запросы по площадкам/бригадам не используются (отчёты не обновлены) | Проверить и удалить |
| 13 | важно | `src/services/system/system-service.ts:20` | `getReadinessStatus` мёртв (старый сервис) | Устаревший system-сервис не обновлён под домен готовности | Удалить |
| 14 | важно | `src/lib/db.ts:206,211` | `postgresDb`/`DatabaseClient` не используются | Второй клиент БД не подключён никуда | Удалить или подключить |
| 15 | важно | `src/lib/pdf-queue.ts:264` | `closePdfQueue` не вызывается | Очередь PDF не закрывается штатно (риск утечки соединения) | Вызывать при завершении или удалить |
| 16 | важно | `src/lib/redis-cache.ts:331` | `closeRedisConnection` не вызывается | Соединение Redis не закрывается | Подключить к shut-down хуку или удалить |
| 17 | важно | `src/modules/readiness/domain/shifts/types.ts:17,30` | `ShiftRecord`/`ShiftHandoverRecord` (типы смен) не используются | Доменные типы смен не задействованы в типах команд | Удалить |
| 18 | важно | `src/modules/readiness/domain/readiness-score.ts:235` | `readinessTone` не вызван | Подсветка тона оценки готовности не применяется | Подключить или удалить |
| 19 | важно | `src/components/piling/to/readiness/api/idempotency.ts:2,15` | `READINESS_IDEMPOTENCY_KEY_HEADER`/`createReadinessIdempotencyKey` мертвы | Идемпотентность клиента готовности не настроена | Подключить или удалить |
| 20 | мелочь | `src/modules/readiness/domain/permits/approval-policy.ts:41` | `requiredApprovalRoles` — мёртвая обёртка | Согласование нарядов реально проверяется через `assertCanApprovePermit`/`isApprovalComplete` (они используются), обёртка избыточна | Удалить |
| 21 | мелочь | `src/core/security/encryption.ts:213` | `generateEncryptionKey` мёртв (security-файл) | Файл в списке off-limits; экспорт для генерации ключей не используется | Не трогать без решения владельца/Claude |
| 22 | мелочь | `src/core/realtime/index.ts:14, types/events.ts:173,179,188` | `ServerWSClient`/`WSClientMessage`/`WSServerMessage`/`toChannel` не используются | Открытые типы WS не задействованы наружу | Удалить типы |
| 23 | мелочь | `src/components/piling/to/readiness-design-views.tsx:149,258,319,379,460,522` | 6 `Readiness*View` — черновые представления | Похоже на референс-наброски (аналогично ORION-концептам); не подключаются нигде | Уточнить у владельца; вероятно удалить |
| 24 | мелочь | `src/components/piling/to/to-module-bits.tsx:22,106,176,186` | `overdueLabel`/`TabButton`/`ChecklistBlock`/`InfoLine` | Вспомогательные UI-компоненты ТО не используются | Удалить |
| 25 | мелочь | `src/components/piling/to/readiness/readiness-labels.ts:32` | `HANDOVER_STATE_LABEL` не используется | Ярлык состояния передачи смены не применяется | Удалить |
| 26 | мелочь | `src/components/piling/admin-equipment/equipment-dialogs.tsx:162` | `DeleteEquipmentDialog` не используется | Удаление оборудования не открывается этим диалогом (есть другой путь) | Проверить и удалить |
| 27 | мелочь | `src/components/piling/admin-sites/hierarchy-tree.tsx:210` | `ExpandedTreeContent` не используется | Часть дерева иерархии площадок не рендерится | Удалить |
| 28 | мелочь | `src/components/piling/admin-reports/types.ts:12,23` | `PeriodSummary`/`ReportWithDetails` не используются | Дублирующиеся типы отчётов | Удалить |
| 29 | мелочь | `src/components/piling/analytics-dashboard/kpi-catalog.ts:47,51` | `ANALYTICS_KPI_WIDGET_IDS`/`analyticsWidgetIdsByZone` | Каталог KPI не используется в редакторе | Удалить |
| 30 | мелочь | `src/components/piling/admin-equipment/equipment-card-template.ts:124` | `cloneEquipmentCardTemplate` не используется | Хелпер клонирования шаблона карточки не применяется (аналогичная логика есть в tile-версии) | Удалить |
| 31 | мелочь | `src/lib/format.ts:8` | `formatPercent` не используется | Утилита форматирования не применяется | Удалить |
| 32 | мелочь | `src/lib/hooks/use-mobile.ts:5` | `useIsMobile` не используется | Hook не применяется (адаптив делается иначе) | Удалить |
| 33 | мелочь | `src/lib/timezone.ts:60,76` | `COMMON_TIMEZONES`/`detectBrowserTimezone` | Время в клиенте настраивается иначе | Удалить |
| 34 | мелочь | `src/lib/haptic-feedback.ts:37` | `hapticSubmit` не используется | Тактильная отдача не подключается | Удалить |
| 35 | мелочь | `src/lib/media-thumbnails.ts:114` | `clearThumbnailCache` не используется | Очистка кеша миниатюр не вызывается | Удалить |
| 36 | мелочь | `src/lib/pagination-cursor.ts:65` | `PaginatedResponse` не используется | Тип курсорной пагинации не подключается | Удалить |
| 37 | мелочь | `src/lib/types.ts:82,87,152,388,452,483` | 6 DTO (Login/Auth/Create*/Telegram/Equipment/Crew) не используются | Типы запросов не применяются (многие схемы перешли в validation-schemas) | Удалить |
| 38 | мелочь | `src/lib/validation-schemas.ts:18,67,207,237,337,371,387,395,442,459..474` (24 шт) | схемы/инпуты не используются ни одним route-handler | Старые zod-схемы и типы вытеснены; не подключены | Удалить мёртвые, оставить живые (`uuidSchema`, `internalIdSchema`, `reportQuerySchema` и т.п. используются внутри) |
| 39 | мелочь | `src/core/shared/types/event-contracts.ts:256` | `TypedEnvelope` не используется | Утилита типизации эвент-контрактов не применяется | Удалить |
| 40 | мелочь | `src/components/piling/monitoring/equipment-tile-template.ts:18,20` | `EQUIPMENT_TILE_COLUMNS`/`EquipmentTileBlockKind` не используются | Константа/тип шаблона плитки не применяются | Удалить |

В таблицу вынесены 40 наиболее ценных; полный список из 109 — в Приложении (path:line).

### Экспорты, используемые только собственным тестом (25)

| path:line | имя | примечание |
|---|---|---|
| `src/core/security/encryption.ts:48` | `__resetEncryptionKeyCacheForTests` | тест-хук; файл off-limits |
| `src/services/auth/session-service.ts:175` | `__setRevocationStoreForTests` | тест-хук; файл off-limits (auth) |
| `src/core/security/tenant-context.ts:100` | `hasTenantContext` | используется тестом; security |
| `src/core/infrastructure/raw-queries.ts:203,254` | `upsertReportRaw`/`bulkDeleteReportsRaw` | рабочий код не использует (аналитика/удаление отчётов) — проверить, что реальные команды не должны их звать |
| `src/services/reports/outbox-publisher.ts:52` | `saveToOutbox` | источником/воркером не вызывается — только тест; проверить публикацию outbox |
| `src/services/weather/weather-client.ts:123` | `getSiteWind` | ветер для площадки не используется в UI/нормировании |
| `src/lib/pagination.ts:74` | `buildPaginationResponse` | |
| `src/lib/pile-length.ts:37` | `lengthMmFromGradeName` | конверсия длины сваи не применяется |
| `src/lib/rate-limiter.ts:462,506` | `createRateLimitMiddleware`/`getTenantRateLimitIdentifier` | rate-limiter.js off-limits |
| `src/lib/validation-schemas.ts:20,315` | `paginationSchema`/`dictionaryItemSchema` | |
| `src/modules/inspections/domain/state-diff.ts:75` | `describeStateChanges` | описание изменений состояния осмотра |
| `src/modules/readiness/domain/permits/transitions.ts:38` | `transitionPermit` | машина состояний наряда: реальный переходы, возможно, должны звать её |
| `src/modules/readiness/domain/shifts/transitions.ts:66,83` | `transitionShift`/`transitionHandover` | машина состояний смены |
| `src/modules/readiness/infrastructure/readiness-worker-entry.ts:21` | `executeReadinessWorkerJob` | точка входа readiness-воркера |
| `src/components/piling/monitoring/equipment-tile-storage.ts:38` | `resetEquipmentTileTemplate` | |
| `src/components/piling/monitoring/equipment-tile-asset-storage.ts:7` | `getEquipmentTileImageAssetId` | |
| `src/components/piling/monitoring/equipment-tile-image-block.tsx:6` | `EquipmentTileImageBlock` | компонент изображения плитки |
| `src/components/piling/to/readiness/api/query-keys.ts:1` | `readinessQueryKeys` | query-ключи реакт-квери |
| `src/components/piling/to/readiness/shared/entity-detail-shell.tsx:31` | `EntityDetailShell` | |
| `src/components/piling/to/to-stats.ts:64,121` | `findOverdueMaintenance`/`findUncrewedEquipment` | расчёт просрочки/неукомплектованности — проверить, что не должны зваться |

## Не проверено

- **Динамический импорт по нестатистически разрешаемой строке** (шаблонная строка с переменной в `import()`/`next/dynamic`): LanguageService не резолвит такие пути. Контрольный поиск литерала имени нашёл 0 совпадений, что делает динамический импорт маловероятным, но не доказывает его отсутствие на 100%.
- **Распространение через бочки с `export *`**: если потребитель берёт экспорт из barrel-файла, использующего `export * from './x'`, имя в barrel не пишется литералом. Однако сам потребитель всё равно содержал бы литерал имени (поиск нашёл бы его), поэтому риск учтён и покрыт.
- **Раздел «ре-экспорт без потребителя» (фасадный)** не включался в отчёт — механизм `findReferences` не следует за потребителями через фасадные barrel (эмпирически доказано на `requireTenant`: 240 вхождений, но `findReferences` видит только ре-экспорт). Для полного покрытия фасадных символов нужен иной анализ (граф импортов по тексту barrel'ов) — не делался.
- **Целые мёртвые файлы** (файл ни разу не импортирован, но хоть один его экспорт имеет ссылку — файл «жив»): анализ посимвольный; выявление именно «файл-полностью-не-импортирован» отдельно не проводилось.
- **Возможные нереализованные намерения**: `notifyCriticalDefects`, `isSystemSafetyBlocker`, `assertCurrentVersion`, `getSiteWind`, `saveToOutbox`, `findOverdueMaintenance`/`findUncrewedEquipment`, `transitionShift`/`transitionHandover`/`transitionPermit` — помечены «проверить», т.к. это доменная логика, которая может быть намеренно отложена (аналогично «выглядит мёртвым, но должен остаться»). Окончательная судьба — за владельцем/Claude.
- **Выполнение сборки/тестов не проводилось** (задача read-only, отчёт-инвентаризация).

## Приложение — остальные мёртвые экспорты (path:line)

```
src/components/piling/admin-reports/types.ts:12
src/components/piling/admin-sites/hierarchy-tree.tsx:210
src/components/piling/monitoring/equipment-tile-template.ts:18,20
src/components/piling/admin-equipment/equipment-card-template.ts:124
src/core/realtime/index.ts:14
src/core/realtime/types/events.ts:173,179,188
src/core/security/encryption.ts:213
src/core/shared/types/event-contracts.ts:256
src/lib/pdf-queue.ts:241
src/lib/cache-strategies.ts:75,79,200
src/lib/request-context.ts:70,104
src/lib/validation-schemas.ts:37,95,127,303,347,379,459,461,476
```

*(Прочие 69 из 109 уже перечислены в таблице выше с полными `path:line`; дублировать здесь не требуется.)*
