# Changelog

Все изменения версий приложения PilingTrack.

Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версионирование — [SemVer](https://semver.org/lang/ru/).

Типы изменений:
- **Added** — новый функционал
- **Changed** — изменения в существующем функционале
- **Fixed** — исправления багов
- **Removed** — удалённый функционал
- **Security** — фиксы безопасности
- **Deploy** — что нужно сделать при деплое сверх обычного

---

## [Unreleased]

_(пока нечего)_

---

## [2.4.1] — 2026-05-18

### Fixed
- **Projection handler skipped все события после 20:14** — фикс в `7f1f0e6` ошибочно предполагал, что `event.aggregateId` это `Report.id` (cuid), и делал лишний lookup. На самом деле outbox emit пишет `state.reportId` (uuid), и handler никогда не находил Report → логи полнились `"ReportAnalytics skipped: report row missing"`. Дашборды показывали ноль для свежих отчётов. Теперь handler пишет `event.aggregateId` напрямую, lookup — fallback для легаси-событий без `siteId/userId` в payload.

### Added
- **Локальная копия прод-БД** для разработки. Скрипты:
  - `npm run db:refresh-prod-snapshot` — снять свежий дамп с прода и развернуть в БД `pilingtrack_prod_copy`
  - `npm run db:use-prod` / `npm run db:use-dev` — переключение `DATABASE_URL` между снимком и dev-БД
  - `npm run db:status` — показать, какая БД активна
  - См. `RELEASE.md` раздел «Локальная копия прод-БД»

### Deploy
- Передеплоить только `workers` (handler живёт там): `docker compose stop workers && docker compose rm -f workers && docker rmi pilingtrack-workers:latest && docker builder prune -af && docker compose build workers && docker compose up -d workers`
- Бэкфилл уже применён на проде, повторный запуск не нужен.

---

## [2.4.0] — 2026-05-17

### Added
- **Паспорт оборудования (Equipment Passport):** новая схема (year, VIN, габариты, движок, молот, ТО), список с фильтром по типу, диалог создания/редактирования, отдельная страница детали `/admin/equipment/[id]` с tabs «Тех. характеристики» и «Эксплуатация».
- **Галерея фото + CRUD документов** на странице паспорта (паспорт ПТС, ОТС, страховка, тех. осмотры). Загрузка фото — через presigned URL в R2.
- **Fleet Monitoring Dashboard** (`/monitoring`): read-only обзор статуса всех установок (active / expected / idle), сегодняшние тоталы по каждой машине.
- **Telematics schema foundation:** таблицы `TelematicsDevice` + `TelematicsDeviceAssignment`. Runtime UI пока нет — фундамент под будущую интеграцию.

### Fixed
- **Submit формы отчёта молча падал** — кнопка «Отправить» была в полупрозрачно-оранжевом «почти готовом» состоянии, кликалась, вызывала только toast.error, который оператор не видел на солнце/в перчатке. Теперь жёстко disabled при пустых полях, серый цвет.
- **Тихие провалы загрузки словарей** в форме отчёта — non-OK от `/api/sites` или `/api/dictionary/all` игнорировался → пустые dropdown'ы → `addPile` молча ничего не делал. Теперь экран ошибки с кнопкой «Повторить».
- **Auto-save черновика пересоздавал interval на каждое нажатие клавиши** (13 deps в useEffect) — на слабом интернете draft мог теряться при teardown/setup. Снапшот через ref, единый interval, финальный flush в cleanup.
- **🔥 ReportAnalytics writes broken** — projection event handler писал `ReportAnalytics.reportId` как cuid (`Report.id`), а все queries джойнят по uuid (`Report.reportId`). Результат: мониторинг показывал нули, дашборд админа врал тоталы. Бэкфилл одной SQL-командой:
  ```sql
  UPDATE "ReportAnalytics" ra SET "reportId" = r."reportId"
    FROM "Report" r WHERE r.id = ra."reportId"
    AND ra."reportId" !~ '^[0-9a-f]{8}-';
  ```
- Валидация формы оборудования принимает `null` для пустых полей (раньше падала на validation error).

### Deploy
- ⚠️ **На VPS освободить диск перед билдом:** `docker system prune -af --volumes` → ≥ 8 GB Avail. Иначе билд упадёт `no space left on device` и контейнеры исчезнут.
- ⚠️ **Билдить `app` и `workers` по очереди** с `docker builder prune -af` между ними. Параллельный билд жрёт x2 диска и риск падения.
- 4 новые миграции (additive only):
  - `20260507200012_add_report_journal_photo`
  - `20260517120000_telematics_device_foundation`
  - `20260517140000_equipment_full_metadata`
  - `20260517160000_equipment_template_fields`
- **Прод-`.env`:** `REDIS_URL` должен включать пароль: `redis://:$REDIS_PASSWORD@redis:6379`. Без пароля все запросы к auth/cache/rate-limit падают fail-closed → 401/503.
- Откат: `git reset --hard v2.3.0` + rebuild. БД миграции additive — откатывать не надо.

---

## [2.3.0] — раньше (теги в репо)

См. `git log v2.2.1..v2.3.0` для деталей. Этот CHANGELOG ведётся с v2.4.0; более ранняя история — только по commit-сообщениям.

## [2.2.1] / [2.2.0] / [2.1.0] — раньше

См. `git log` и теги.
