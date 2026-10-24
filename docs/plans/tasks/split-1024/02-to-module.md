# Задание 2 из 4: `to-module.tsx` (923 строки)

Сначала прочитать `00-common.md`. Ветка: `codex/split-to-module`. Не начинать, пока задание 1 не принято. Файл не в замороженной зоне. Внешние импортёры: две страницы (`admin/to/page.tsx`, `admin/safety/page.tsx`) берут только `ToModule`; их не менять.

## Что в файле (сверить с реальным файлом)

| Строки | Содержимое | Куда |
|---|---|---|
| 73–185 | `VIEW_IDS`, `OUTCOME_STATUS`, `STAGE_EVIDENCE_KEY`, `STAGE_EVIDENCE_STATE`, `SETTINGS_IDS`, `TECH_READINESS_PRODUCTION_SHELL_ENABLED`, тексты ошибок, `ModuleSurface`, `SURFACE_*`, `surfaceOfView`, `parseView`, `parseSettingsSection` | `to-module-config.ts` |
| 186–276 | `WorkspaceIssue`, `readOptionalCollectionWithIssue`, `readOptionalJsonWithIssue`, `readAuthoritativeCollection`, `EMPTY_PERMITS_PAGE`, `readReadinessPartial` — чистые асинхронные функции чтения | `to-module-data.ts` |
| 277–923 | `ToModule` — один компонент: ~70 `useState`, эффекты, `loadWorkspace` (≈215 строк), `useMemo`, JSX | **остаётся в `to-module.tsx`** |

Экспортируемое снаружи (`ToModule`, `ModuleSurface`, `TECH_READINESS_PRODUCTION_SHELL_ENABLED`) остаётся доступным из `to-module.tsx` — переэкспортом.

## Порядок шагов

1. Базовая линия + `npx vitest run src/components/piling/to/__tests__/to-module-shell.test.tsx src/components/piling/to/__tests__/to-panels-mobile-targets.test.tsx` — записать числа.
2. Перенос 73–185 → `to-module-config.ts`.
3. Перенос 186–276 → `to-module-data.ts`.
4. Финальные проверки; `check-pure-move.cjs` с кодом 0.

## Что не делать

- **Не трогать `ToModule`**: не выносить `loadWorkspace` в хук, не группировать состояния, не менять зависимости эффектов. Это правка поведения по рискам (гонки загрузки, `AbortController`).
- Ожидаемый итог — `to-module.tsx` около 720 строк; цель «≤ 500» не обязательна. В отчёте указать, что вынос `loadWorkspace` в отдельный хук — следующая задача, которую надо оценивать отдельно.
- Проверить, что `TECH_READINESS_PRODUCTION_SHELL_ENABLED` читает ту же переменную окружения тем же способом: если значение вычисляется при загрузке модуля, место вычисления в новом файле не должно менять момент или источник (Next подставляет `NEXT_PUBLIC_*` при сборке — выражение копировать дословно, без динамического доступа по имени).

## Готово, когда

Критерии `00-common.md`; тесты `to-module-shell` и `to-panels-mobile-targets` с теми же числами, что в базовой линии; обе страницы собираются (`npm run build`).
