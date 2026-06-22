# Источники данных и привязка к модулям

> Карта «откуда берутся данные» + аудит честности (нет ли заглушек/фейка в путях, отдающих данные).
> Обновлено: 2026-06-20. Граф знаний: GitNexus PilingTrack (8892 узла / 19816 рёбер / 300 потоков).

## Внешние источники данных (подключения)

| Источник | Где инициализируется | Что питает |
|---|---|---|
| **PostgreSQL** (Prisma, 51 модель) | `src/lib/db.ts` → `@/generated/postgres-client` | основной источник всего — отчёты, объекты, техника, ТО, пользователи, аналитика |
| **Redis** | `src/lib/redis-cache.ts`, `rate-limiter.ts`, `core/realtime/redis/pubsub.ts` | кэш, rate-limit, pub/sub реалтайма, очередь PDF |
| **MinIO / S3** | `src/core/storage/s3-service.ts`, `core/media/media-service.ts` | фото-доказательства отчётов, документы техники, PDF |
| **MQTT / HTTP ingest** | `src/services/telemetry/mqtt-ingestion-service.ts`, `app/api/telemetry/ingest` | телеметрия с боксов (Teltonika/Galileosky) — **дремлет, бокс не подключён** |
| **Telegram** (через CF-прокси) | `src/core/notifications/telegram.ts` | уведомления; прямой `api.telegram.org` заблокирован у провайдера |

## Модули, отдающие данные → их источник

| Модуль / экран | Эндпоинт | Реальный источник |
|---|---|---|
| Аналитика объектов | `getSiteAnalytics` | Prisma: `ReportAnalytics`, `SiteWeeklyTrend`, `SiteDailySummary` |
| Аналитика техники | `equipment-analytics-service` | Prisma: `Report`, `ReportDowntime`, `Equipment` (реальные `groupBy`/`aggregate`) |
| Флот-мониторинг | `/api/monitoring/fleet` → `fleet-monitoring.service` | Prisma: `Equipment`, `Report`, `ReportAnalytics` |
| Карточка техники → телеметрия | `/api/telemetry?equipmentId=` → `telemetry-ingestion-service` | Prisma: `TelemetryRecord` (пусто, пока нет бокса) |
| Дашборд `/admin` | агрегирует `getSiteAnalytics` | те же analytics-таблицы |
| Отчёты / история | `modules/reports/*` (полный DDD) | `Report`, `ReportAudit`, `ReportVersion`, `Media` — см. [[report-evidence-model]] |

## Аудит честности (заглушки / фейк / нестыковки)

**Вывод: фабрикации данных НЕТ.** Все заглушки — намеренные и задокументированные, число никогда не выдумывается.

| Место | Статус | Деталь |
|---|---|---|
| `EquipmentPlaceholder` (телеметрия, ошибки ECU) | ✅ честный плейсхолдер | «ждёт датчик» / «нет данных» — `// Never shows a fabricated number` |
| `equipment-monitoring.tsx` пустой период | ✅ честное пустое состояние | «Телеметрия за этот период не поступала» |
| `notifyEmail` в `core/realtime/alerts/engine.ts` | ⚠️ задокументированная заглушка | email-транспорт не подключён, пишет `logger.warn` видимо |
| `PARAM_SPECS` пороги телеметрии | ✅ референсные константы | помечены «ориентировочные, калибруются по установке» |
| `Math.random` (9 мест) | ✅ всё легитимно | сэмплинг, джиттер ретраев, RUM-id, ширина скелетона |
| Таблицы `TelematicsDevice`/`TelemetryRecord`/`DeviceKey` | ✅ дремлют по дизайну | заполнятся при подключении бокса; синтетических генераторов нет (симулятор удалён) |

**Нестыковок не найдено.** (Ложное подозрение «карточка техники тянет общефлотовый эндпоинт» опровергнуто: это разные файлы — `monitoring/` тянет флот, карточка тянет `/api/telemetry` по `equipmentId`.)

## Связанные заметки
- [[product_equipment_monitoring_wip]] — статус телеметрии (развёрнута, ждёт железо)
- [[report-evidence-model]] — модель доказательств отчётов
- [[reference_prod_infra]] — где живут эти источники в проде
