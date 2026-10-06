# Источники данных и привязка к модулям

> Карта «откуда берутся данные» + аудит честности (нет ли заглушек/фейка в путях, отдающих данные).
> Обновлено: 2026-10-07 (журнал забивки: источник `PileWork`, итоги периода и выгрузка — после W14 `965df4a4`, W21 `59384c2d`, W30 `5baf2fff`).
> Граф знаний GitNexus PilingTrack: **24 935 узлов / 55 355 рёбер / 833 потока** —
> пересчитано из `.gitnexus/meta.json` этого worktree (индексация 2026-10-01, коммит `615b31e2`).
> Прежний снимок 2026-06-20 (8 892 / 19 816 / 300) — исторический, не текущее состояние.
> Ниже перечислены точки инициализации в коде — это НЕ подтверждение production-подключений:
> телеметрия дремлет (бокс не подключён), факт работы остальных источников в проде этим документом не заверяется.

## Внешние источники данных (точки инициализации в коде)

| Источник | Где инициализируется | Что питает |
|---|---|---|
| **PostgreSQL** (Prisma, 83 модели — пересчёт 2026-10-02: `grep -c '^model ' prisma/schema.prisma`) | `src/lib/db.ts` → `@/generated/postgres-client` | основной источник всего — отчёты, объекты, техника, ТО, пользователи, аналитика |
| **Redis** | `src/lib/redis-cache.ts`, `src/lib/rate-limiter.ts`, `src/lib/pdf-queue.ts` (BullMQ), `src/core/infrastructure/leader-election.ts` | кэш, rate-limit, очередь PDF, лидер-выбор воркеров |
| **MinIO / S3** | `src/core/storage/s3-service.ts`, `src/core/media/media-service.ts` | фото-доказательства отчётов, документы техники, PDF |
| **MQTT / HTTP ingest** | `src/services/telemetry/mqtt-ingestion-service.ts`, `src/app/api/telemetry/ingest` | телеметрия с боксов (Teltonika/Galileosky) — **дремлет, бокс не подключён** |
| **Telegram** (через CF-прокси) | `src/core/notifications/telegram.ts` | уведомления; прямой `api.telegram.org` заблокирован у провайдера |

## Модули, отдающие данные → их источник

| Модуль / экран | Эндпоинт | Реальный источник |
|---|---|---|
| Аналитика объектов | `getSiteAnalytics` (`src/services/analytics/site-analytics-service.ts`) | живой SQL по `Report`/`PileWork`/`LeaderDrilling`/`ReportDowntime` (+ планы `SitePilePlan`/`SiteDrillingPlan`); проекции НЕ читаются |
| Аналитика техники | `equipment-analytics-service` | Prisma: `Report`, `ReportDowntime`, `Equipment` (реальные `groupBy`/`aggregate`) |
| Флот-мониторинг | `/api/monitoring/fleet` → `fleet-monitoring.service` | Prisma: `Equipment`, `Report`, `ReportAnalytics` |
| Карточка техники → телеметрия | `/api/telemetry?equipmentId=` → `telemetry-ingestion-service` | Prisma: `TelemetryRecord` (пусто, пока нет бокса) |
| Дашборд `/admin` | агрегирует `getSiteAnalytics` | тот же живой SQL (не projections) |
| Отчёты / история | `modules/reports/*` (полный DDD) | `Report`, `ReportAudit`, `ReportVersion`, `Media` — см. [[report-evidence-model]] |
| Журнал забивки свай | `/api/pile-passports` → `listPilePassports`; выгрузка `/api/pile-passports/export` → `exportPileJournalXlsx` (`src/modules/reports/application/queries/pile-passport.service.ts`) | живой SQL: строки из `PileWork` (одна строка = одна запись выработки), паспорт — `LEFT JOIN PilePassport` по `pileWorkId`; сваи пачкой видны с пометкой «без паспорта» — см. [[pile-journal]] |

## Аудит честности (заглушки / фейк / нестыковки)

**Вывод: фабрикации данных НЕТ.** Все заглушки — намеренные и задокументированные, число никогда не выдумывается.

| Место | Статус | Деталь |
|---|---|---|
| `EquipmentPlaceholder` (телеметрия, ошибки ECU) | ✅ честный плейсхолдер | «ждёт датчик» / «нет данных» — `// Never shows a fabricated number` |
| `equipment-monitoring.tsx` пустой период | ✅ честное пустое состояние | «Телеметрия за этот период не поступала» |
| Email-транспорт уведомлений | ⚠️ отсутствует | своего email-канала в коде нет; алерты доставляет только Telegram — `src/services/notifications/durable-alert-delivery.ts` → `src/core/notifications/telegram.ts` |
| `PARAM_SPECS` пороги телеметрии | ✅ референсные константы | помечены «ориентировочные, калибруются по установке» |
| `Math.random` (9 мест) | ✅ всё легитимно | сэмплинг, джиттер ретраев, RUM-id, ширина скелетона |
| Таблицы `TelematicsDevice`/`TelemetryRecord`/`DeviceKey` | ✅ дремлют по дизайну | заполнятся при подключении бокса; синтетических генераторов нет (симулятор удалён) |

**Нестыковок не найдено.** (Ложное подозрение «карточка техники тянет общефлотовый эндпоинт» опровергнуто: это разные файлы — `monitoring/` тянет флот, карточка тянет `/api/telemetry` по `equipmentId`.)

## Связанные заметки
- [[product_equipment_monitoring_wip]] — статус телеметрии (код есть, бокс не подключён)
- [[report-evidence-model]] — модель доказательств отчётов
- [[reference_prod_infra]] — где живут эти источники в проде
