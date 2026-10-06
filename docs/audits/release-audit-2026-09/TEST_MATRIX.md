# TEST_MATRIX — матрица бизнес-сценариев и покрытия

**Ревизия:** `054ee768` · **Дата:** 21.09.2026
**Оси покрытия:** unit · integration · API · E2E · security · offline · mobile · migration · observability

## Матрица покрытия

| Бизнес-сценарий | unit | integration | API | E2E | security | offline | mobile | migration | observability |
|---|---|---|---|---|---|---|---|---|---|
| Допуск → приёмка → осмотр → готовность | ✅ | ✅ (tech-readiness-*) | ✅ | ⚠️ (spec есть, не прогнан) | ⚠️ | — | ✅ (spec) | — | ✅ |
| Смена оператора (Работа/Сваи/События/Смена) | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ | — | ✅ |
| Паспорт сваи (проект/факт, допуски, QC) | ✅ | ✅ | ✅ | — | ⚠️ | — | ⚠️ | — | — |
| Завершение смены → квитанция | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | — | — | ✅ |
| Отчёты (создание/редактирование/периоды/PDF/Excel) | ✅ | ✅ | ✅ | ⚠️ (report-creation-flow) | ⚠️ | — | — | — | — |
| Справочники/пользователи/бригады | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | — | ✅ (spec) | — | — |
| ТО и наряды (maintenance) | ✅ | ✅ | ✅ | ⚠️ (inspection-to-flow) | ⚠️ | — | — | — | ✅ |
| Техготовность — гонки и атомарность | ✅ | ✅ (гонка 20 стартов) | ✅ | ⚠️ | ⚠️ | — | — | — | ✅ |
| Offline-очередь и дедупликация | ✅ | ✅ | — | — | — | ✅ | — | — | ✅ (outbox checker) |
| Rate limiting / login | ✅ | — | ✅ | ✅ (прошёл) | ✅ | — | — | — | — |
| Миграции и схема | — | ✅ | — | — | — | — | — | ✅ | — |
| Мультитенантность / RLS | ✅ | ✅ (rls-tenant-enforcement — skip) | ✅ | — | ⚠️ | — | — | — | — |
| Наблюдаемость / health | ✅ | — | ✅ | ✅ (health check) | — | — | — | — | ✅ |

**Обозначения:** ✅ подтверждено (тест есть и прошёл) · ⚠️ тест есть, но не прогнан/частично · — покрытие не обнаружено.

## Пробелы покрытия (по приоритету)
1. **Негативные security-сценарии.** Чужой отчёт, подмена `reportId`, чужая организация, отозванная сессия и «действую как» — ✅ закрыты тестами 22.09.2026 (`report-command-service.test.ts`, `api-wrapper.test.ts`). Остаются непокрытыми заблокированный пользователь и просроченная сессия сквозным прогоном по ролям — это E2E-пробел, см. п. 2.
2. **Полный E2E по 7 ролям и техготовности** — spec-файлы существуют (`tech-readiness-production.spec.ts`, `role-audit.spec.js`), но не прогнаны.
3. **Отключённые интеграционные наборы:** `tests/integration/rls-tenant-enforcement.spec.ts` (5 skipped), `tech-readiness-write-pipeline.spec.ts` (6 skipped), `tests/contract/tech-readiness-api.spec.ts` (13 skipped) — пропущенные проверки RLS/write-pipeline.
4. **Миграции:** нет теста применения на пустой БД и откатов.
5. **Формула-инъекция CSV/Excel** — теста нет.
6. **Mobile** — покрытие частичное (spec на mobile viewport есть в E2E, но не прогнан).

## Тестовые файлы (факт)
- Тест/спек-файлов в `src`: **219**; каталогов `__tests__`: **112**.
- E2E-spec в `e2e/`: **11** (`admin-dictionaries`, `admin-users`, `app`, `inspection-to-flow`, `monitoring-tile-editor`, `operator-report-smoke`, `orion-industrial-cinematic`, `rate-limit-e2e`, `report-creation-flow`, `smoke-e2e`, `tech-readiness-production`) + `role-audit.spec.js`.
- Playwright-проекты: `chromium`, `Mobile Safari`, `Mobile Chrome`, `unauthenticated` (только `login.spec.ts`).
